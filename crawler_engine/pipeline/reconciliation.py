"""
The Scrapper - Reconciliation & Master Structured Storage Engine (Components 8, 10, 11 of PDF Architecture)
Handles:
1. Master Relational Schema (domains, subdomains, emails, domain_emails, data_changes, crawl_jobs)
2. Old vs New Crawl Comparison:
   - NEW: Insert new record with first_seen & last_seen
   - CHANGED: Update record with new values & record old/new diff in data_changes
   - SAME: Skip redundant content write; update last_seen timestamp
   - MISSING: Mark as pending recheck (per PDF rule: never immediately delete)
3. Dual Persistence: SQLite Relational Database + MongoDB Master Collections
"""

import sqlite3
import datetime
import logging
from pathlib import Path
from typing import Dict, Any, List, Optional, Tuple, Set

from crawler_engine.pipeline.normalizer import (
    normalize_domain,
    normalize_subdomain,
    normalize_email,
    normalize_crawl_payload,
)
from crawler_engine.pipeline.hasher import (
    generate_entity_id,
    generate_payload_fingerprint,
)
from crawler_engine.pipeline.bloom_filter import BloomFilter

logger = logging.getLogger("TheScrapper.Reconciliation")


class ReconciliationEngine:
    """
    Executes deep reconciliation between existing master database state
    and fresh crawl observation payloads.
    """

    def __init__(
        self,
        sqlite_db_path: Optional[str] = None,
        mongo_storage=None,
    ):
        if sqlite_db_path is None:
            base_dir = Path(__file__).resolve().parent.parent / "storage"
            base_dir.mkdir(parents=True, exist_ok=True)
            sqlite_db_path = str(base_dir / "master_relational.db")

        self.db_path = sqlite_db_path
        self.mongo_storage = mongo_storage
        self.bloom_filter = BloomFilter(expected_elements=100000)

        # Initialize SQLite Relational Schema
        self._init_sqlite_schema()
        self._prime_bloom_filter()

    def _get_connection(self) -> sqlite3.Connection:
        conn = sqlite3.connect(self.db_path)
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA foreign_keys = ON;")
        return conn

    def _init_sqlite_schema(self) -> None:
        """Creates the relational master tables if they do not exist."""
        with self._get_connection() as conn:
            cursor = conn.cursor()

            # 1. Domains Table
            cursor.execute("""
                CREATE TABLE IF NOT EXISTS domains (
                    id TEXT PRIMARY KEY,
                    normalized_domain TEXT UNIQUE NOT NULL,
                    country_name TEXT,
                    country_code TEXT,
                    country_flag TEXT,
                    category TEXT,
                    summary TEXT,
                    status TEXT NOT NULL,
                    error_code TEXT,
                    error_title TEXT,
                    fingerprint TEXT,
                    first_seen TIMESTAMP NOT NULL,
                    last_seen TIMESTAMP NOT NULL
                );
            """)

            # 2. Subdomains Table
            cursor.execute("""
                CREATE TABLE IF NOT EXISTS subdomains (
                    id TEXT PRIMARY KEY,
                    domain_id TEXT NOT NULL,
                    normalized_hostname TEXT UNIQUE NOT NULL,
                    status TEXT NOT NULL,
                    first_seen TIMESTAMP NOT NULL,
                    last_seen TIMESTAMP NOT NULL,
                    FOREIGN KEY (domain_id) REFERENCES domains(id) ON DELETE CASCADE
                );
            """)

            # 3. Emails Table
            cursor.execute("""
                CREATE TABLE IF NOT EXISTS emails (
                    id TEXT PRIMARY KEY,
                    normalized_email TEXT UNIQUE NOT NULL,
                    mx_verified BOOLEAN DEFAULT 0,
                    status TEXT NOT NULL,
                    first_seen TIMESTAMP NOT NULL,
                    last_seen TIMESTAMP NOT NULL
                );
            """)

            # 4. Domain-Emails Join Table (1 Domain <-> Many Emails)
            cursor.execute("""
                CREATE TABLE IF NOT EXISTS domain_emails (
                    domain_id TEXT NOT NULL,
                    email_id TEXT NOT NULL,
                    source_url TEXT,
                    first_seen TIMESTAMP NOT NULL,
                    last_seen TIMESTAMP NOT NULL,
                    PRIMARY KEY (domain_id, email_id),
                    FOREIGN KEY (domain_id) REFERENCES domains(id) ON DELETE CASCADE,
                    FOREIGN KEY (email_id) REFERENCES emails(id) ON DELETE CASCADE
                );
            """)

            # 5. Data Changes Audit Log (Tracks mutations)
            cursor.execute("""
                CREATE TABLE IF NOT EXISTS data_changes (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    domain_id TEXT NOT NULL,
                    entity_type TEXT NOT NULL,
                    entity_id TEXT NOT NULL,
                    change_type TEXT NOT NULL,
                    old_value TEXT,
                    new_value TEXT,
                    detected_at TIMESTAMP NOT NULL
                );
            """)

            # 6. Crawl Jobs Table
            cursor.execute("""
                CREATE TABLE IF NOT EXISTS crawl_jobs (
                    id TEXT PRIMARY KEY,
                    domain_id TEXT NOT NULL,
                    status TEXT NOT NULL,
                    pages_crawled INTEGER DEFAULT 0,
                    started_at TIMESTAMP NOT NULL,
                    completed_at TIMESTAMP,
                    FOREIGN KEY (domain_id) REFERENCES domains(id) ON DELETE CASCADE
                );
            """)

            conn.commit()

    def _prime_bloom_filter(self) -> None:
        """Populates the in-memory Bloom filter from existing DB entity IDs."""
        try:
            with self._get_connection() as conn:
                for row in conn.execute("SELECT id FROM domains UNION SELECT id FROM subdomains UNION SELECT id FROM emails"):
                    self.bloom_filter.add(row["id"])
        except Exception as e:
            logger.debug(f"Bloom filter priming notice: {e}")

    def reconcile_crawl_result(self, raw_payload: Dict[str, Any]) -> Dict[str, Any]:
        """
        Executes complete reconciliation on a new crawl payload:
        1. Normalization
        2. SHA-256 Identity generation
        3. Diff evaluation: NEW, CHANGED, SAME, MISSING
        4. Relational UPSERT and audit logging in data_changes
        5. Sync with MongoDB collections
        Returns: Reconciliation summary report.
        """
        # Step 1: Normalize payload
        norm = normalize_crawl_payload(raw_payload)
        domain = norm["domain"]
        if not domain:
            return {"error": "Invalid empty domain"}

        now_iso = datetime.datetime.now().isoformat()
        domain_id = generate_entity_id("domain", domain)
        new_fingerprint = generate_payload_fingerprint(norm)

        stats = {
            "domain": domain,
            "domain_action": "SAME",
            "new_subdomains": 0,
            "existing_subdomains": 0,
            "missing_subdomains": 0,
            "new_emails": 0,
            "existing_emails": 0,
            "missing_emails": 0,
            "audit_changes_recorded": 0,
        }

        with self._get_connection() as conn:
            cursor = conn.cursor()

            # --- A. RECONCILE DOMAIN ---
            cursor.execute("SELECT * FROM domains WHERE id = ?", (domain_id,))
            existing_domain = cursor.fetchone()

            if not existing_domain:
                # NEW DOMAIN
                stats["domain_action"] = "NEW"
                cursor.execute("""
                    INSERT INTO domains (
                        id, normalized_domain, country_name, country_code, country_flag,
                        category, summary, status, error_code, error_title, fingerprint,
                        first_seen, last_seen
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """, (
                    domain_id,
                    domain,
                    norm["country"],
                    norm["countryCode"],
                    norm["countryFlag"],
                    norm["category"],
                    norm["summary"],
                    norm["status"],
                    norm.get("errorCode"),
                    norm.get("errorTitle"),
                    new_fingerprint,
                    now_iso,
                    now_iso,
                ))
                self.bloom_filter.add(domain_id)
                self._record_change(cursor, domain_id, "domain", domain_id, "NEW", None, domain, now_iso)
                stats["audit_changes_recorded"] += 1
            else:
                # DOMAIN EXISTS -> CHECK IF CHANGED OR SAME
                old_fp = existing_domain["fingerprint"]
                if old_fp != new_fingerprint:
                    stats["domain_action"] = "CHANGED"
                    cursor.execute("""
                        UPDATE domains SET
                            country_name = ?,
                            country_code = ?,
                            country_flag = ?,
                            category = ?,
                            summary = ?,
                            status = ?,
                            error_code = ?,
                            error_title = ?,
                            fingerprint = ?,
                            last_seen = ?
                        WHERE id = ?
                    """, (
                        norm["country"],
                        norm["countryCode"],
                        norm["countryFlag"],
                        norm["category"],
                        norm["summary"],
                        norm["status"],
                        norm.get("errorCode"),
                        norm.get("errorTitle"),
                        new_fingerprint,
                        now_iso,
                        domain_id,
                    ))
                    self._record_change(cursor, domain_id, "domain", domain_id, "CHANGED", old_fp, new_fingerprint, now_iso)
                    stats["audit_changes_recorded"] += 1
                else:
                    # SAME DOMAIN -> Only update last_seen
                    stats["domain_action"] = "SAME"
                    cursor.execute("UPDATE domains SET last_seen = ? WHERE id = ?", (now_iso, domain_id))

            # --- B. RECONCILE SUBDOMAINS ---
            cursor.execute("SELECT id, normalized_hostname, status FROM subdomains WHERE domain_id = ?", (domain_id,))
            existing_subs_map = {row["normalized_hostname"]: row for row in cursor.fetchall()}
            crawled_subs_set = set(norm["subdomains"])

            # 1. New or Existing Subdomains
            for sub in crawled_subs_set:
                sub_id = generate_entity_id("subdomain", sub)
                if sub not in existing_subs_map:
                    # NEW SUBDOMAIN
                    cursor.execute("""
                        INSERT INTO subdomains (id, domain_id, normalized_hostname, status, first_seen, last_seen)
                        VALUES (?, ?, ?, 'ACTIVE', ?, ?)
                        ON CONFLICT(normalized_hostname) DO UPDATE SET
                            domain_id = excluded.domain_id,
                            status = 'ACTIVE',
                            last_seen = excluded.last_seen;
                    """, (sub_id, domain_id, sub, now_iso, now_iso))
                    self.bloom_filter.add(sub_id)
                    self._record_change(cursor, domain_id, "subdomain", sub_id, "NEW", None, sub, now_iso)
                    stats["new_subdomains"] += 1
                    stats["audit_changes_recorded"] += 1
                else:
                    # SAME SUBDOMAIN -> Update last_seen
                    cursor.execute("UPDATE subdomains SET status = 'ACTIVE', last_seen = ? WHERE id = ?", (now_iso, sub_id))
                    stats["existing_subdomains"] += 1

            # 2. Missing Subdomains (seen in previous crawl, but absent in new crawl)
            for sub, sub_row in existing_subs_map.items():
                if sub not in crawled_subs_set:
                    # Mark as MISSING_PENDING_RECHECK (per PDF rule: never delete immediately)
                    cursor.execute("""
                        UPDATE subdomains SET status = 'MISSING_PENDING_RECHECK' WHERE id = ?
                    """, (sub_row["id"],))
                    self._record_change(cursor, domain_id, "subdomain", sub_row["id"], "MISSING", "ACTIVE", "MISSING_PENDING_RECHECK", now_iso)
                    stats["missing_subdomains"] += 1
                    stats["audit_changes_recorded"] += 1

            # --- C. RECONCILE EMAILS & DOMAIN_EMAILS ---
            cursor.execute("""
                SELECT e.id, e.normalized_email, e.status
                FROM emails e
                JOIN domain_emails de ON e.id = de.email_id
                WHERE de.domain_id = ?
            """, (domain_id,))
            existing_emails_map = {row["normalized_email"]: row for row in cursor.fetchall()}
            crawled_emails_set = set(norm["emails"])

            # 1. New or Existing Emails
            for email in crawled_emails_set:
                email_id = generate_entity_id("email", email)
                if email not in existing_emails_map:
                    # NEW EMAIL
                    cursor.execute("""
                        INSERT INTO emails (id, normalized_email, mx_verified, status, first_seen, last_seen)
                        VALUES (?, ?, 1, 'ACTIVE', ?, ?)
                        ON CONFLICT(normalized_email) DO UPDATE SET
                            status = 'ACTIVE',
                            last_seen = excluded.last_seen;
                    """, (email_id, email, now_iso, now_iso))

                    cursor.execute("""
                        INSERT INTO domain_emails (domain_id, email_id, source_url, first_seen, last_seen)
                        VALUES (?, ?, ?, ?, ?)
                        ON CONFLICT(domain_id, email_id) DO UPDATE SET
                            source_url = excluded.source_url,
                            last_seen = excluded.last_seen;
                    """, (domain_id, email_id, norm.get("sourceUrl", ""), now_iso, now_iso))

                    self.bloom_filter.add(email_id)
                    self._record_change(cursor, domain_id, "email", email_id, "NEW", None, email, now_iso)
                    stats["new_emails"] += 1
                    stats["audit_changes_recorded"] += 1
                else:
                    # SAME EMAIL -> Update last_seen
                    cursor.execute("UPDATE emails SET status = 'ACTIVE', last_seen = ? WHERE id = ?", (now_iso, email_id))
                    cursor.execute("UPDATE domain_emails SET last_seen = ? WHERE domain_id = ? AND email_id = ?", (now_iso, domain_id, email_id))
                    stats["existing_emails"] += 1

            # 2. Missing Emails
            for email, email_row in existing_emails_map.items():
                if email not in crawled_emails_set:
                    cursor.execute("""
                        UPDATE emails SET status = 'MISSING_PENDING_RECHECK' WHERE id = ?
                    """, (email_row["id"],))
                    self._record_change(cursor, domain_id, "email", email_row["id"], "MISSING", "ACTIVE", "MISSING_PENDING_RECHECK", now_iso)
                    stats["missing_emails"] += 1
                    stats["audit_changes_recorded"] += 1

            conn.commit()

        # Step 4: Synchronize master collections to MongoDB
        self._sync_to_mongodb_master(domain_id, norm, stats)

        logger.info(
            f"[Reconciliation] Completed for {domain}: "
            f"Action={stats['domain_action']}, "
            f"Subdomains (New={stats['new_subdomains']}, Existing={stats['existing_subdomains']}, Missing={stats['missing_subdomains']}), "
            f"Emails (New={stats['new_emails']}, Existing={stats['existing_emails']}, Missing={stats['missing_emails']})"
        )
        return stats

    def _record_change(
        self,
        cursor: sqlite3.Cursor,
        domain_id: str,
        entity_type: str,
        entity_id: str,
        change_type: str,
        old_val: Optional[str],
        new_val: Optional[str],
        timestamp: str,
    ) -> None:
        """Appends an immutable audit entry to data_changes."""
        cursor.execute("""
            INSERT INTO data_changes (domain_id, entity_type, entity_id, change_type, old_value, new_value, detected_at)
            VALUES (?, ?, ?, ?, ?, ?, ?)
        """, (domain_id, entity_type, entity_id, change_type, old_val, new_val, timestamp))

    def _sync_to_mongodb_master(self, domain_id: str, norm: Dict[str, Any], stats: Dict[str, Any]) -> None:
        """
        Stores structured master records in MongoDB collections
        (`master_domains`, `master_subdomains`, `master_emails`, `data_changes`).
        """
        if not self.mongo_storage or not getattr(self.mongo_storage, "is_connected", False):
            return

        db = self.mongo_storage.db
        if db is None:
            return

        now_iso = datetime.datetime.now().isoformat()

        try:
            # 1. Master Domains
            db["master_domains"].update_one(
                {"id": domain_id},
                {
                    "$set": {
                        "domain": norm["domain"],
                        "country": norm["country"],
                        "countryCode": norm["countryCode"],
                        "countryFlag": norm["countryFlag"],
                        "category": norm["category"],
                        "summary": norm["summary"],
                        "status": norm["status"],
                        "errorCode": norm.get("errorCode"),
                        "errorTitle": norm.get("errorTitle"),
                        "last_seen": now_iso,
                        "reconciliation": stats,
                    },
                    "$setOnInsert": {"first_seen": now_iso},
                },
                upsert=True,
            )

            # 2. Master Subdomains
            for sub in norm["subdomains"]:
                sub_id = generate_entity_id("subdomain", sub)
                db["master_subdomains"].update_one(
                    {"id": sub_id},
                    {
                        "$set": {
                            "domain_id": domain_id,
                            "domain": norm["domain"],
                            "subdomain": sub,
                            "status": "ACTIVE",
                            "last_seen": now_iso,
                        },
                        "$setOnInsert": {"first_seen": now_iso},
                    },
                    upsert=True,
                )

            # 3. Master Emails
            for email in norm["emails"]:
                email_id = generate_entity_id("email", email)
                db["master_emails"].update_one(
                    {"id": email_id},
                    {
                        "$set": {
                            "domain_id": domain_id,
                            "domain": norm["domain"],
                            "email": email,
                            "status": "ACTIVE",
                            "last_seen": now_iso,
                        },
                        "$setOnInsert": {"first_seen": now_iso},
                    },
                    upsert=True,
                )

            # 4. Audit Log
            db["data_changes"].insert_one({
                "domain_id": domain_id,
                "domain": norm["domain"],
                "reconciliation_stats": stats,
                "detected_at": now_iso,
            })
        except Exception as e:
            logger.debug(f"[MongoDB Master Sync Error]: {e}")

    def get_domain_audit_history(self, domain: str) -> List[Dict[str, Any]]:
        """Retrieves audit change log for a domain."""
        domain_id = generate_entity_id("domain", domain)
        with self._get_connection() as conn:
            cursor = conn.cursor()
            cursor.execute("""
                SELECT entity_type, entity_id, change_type, old_value, new_value, detected_at
                FROM data_changes
                WHERE domain_id = ?
                ORDER BY detected_at DESC
                LIMIT 50
            """, (domain_id,))
            return [dict(row) for row in cursor.fetchall()]

