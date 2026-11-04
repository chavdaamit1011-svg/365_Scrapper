/**
 * Phase 2 Reconciliation & Master Storage Engine (Native TypeScript / MongoDB)
 * Components:
 * - SHA-256 entity ID generation
 * - Bloom Filter memory pre-check layer (DEFINITELY_NEW vs PROBABLY_EXISTS)
 * - Diff Evaluation: NEW, CHANGED, SAME, MISSING
 * - High-speed MongoDB bulk operations (bulkWrite)
 * - Immutable Audit Logging in data_changes
 * - Master Relational Sync to MongoDB master collections
 */

import { connectMongo } from '../../mongodb';
import { ScrapedDomainRecord, ReconciliationStats, SubdomainItemDetail } from '../types';
import { generateEntityId } from '@/lib/entityId';
import { getSharedBloomFilter } from '../bloomFilter';

export { generateEntityId };

/**
 * Reconciles crawl results against previous observations in MongoDB
 * Tracks mutations and updates master records with nanosecond memory pre-checks
 */
export async function reconcileAndStoreResult(
  record: ScrapedDomainRecord
): Promise<ReconciliationStats> {
  const conn = await connectMongo();
  const stats: ReconciliationStats = {
    domain_action: 'NEW',
    new_subdomains: 0,
    existing_subdomains: 0,
    missing_subdomains: 0,
    new_emails: 0,
    existing_emails: 0,
    missing_emails: 0,
    audit_changes_recorded: 0,
  };

  if (!conn?.connection?.db) {
    return stats;
  }

  const db = conn.connection.db;
  const nowIso = new Date().toISOString();
  const domainId = generateEntityId('domain', record.domain);
  const bloom = getSharedBloomFilter();

  // Prewarm Bloom Filter from MongoDB on first use
  await bloom.prewarmFromMongo(db);

  // 1. Check existing master domain using Bloom Filter 2-tier check
  const domainBloomCheck = bloom.check(record.domain);
  if (domainBloomCheck === 'DEFINITELY_NEW') {
    // 100% guarantee it's not in DB; skip DB read query
    stats.domain_action = 'NEW';
    bloom.add(record.domain);
  } else {
    // PROBABLY_EXISTS: Verify with actual DB query
    const existingMaster = await db.collection('master_domains').findOne({ id: domainId });
    if (existingMaster) {
      stats.domain_action = 'EXISTING_UPDATED';
    } else {
      // False positive confirmed: genuinely new domain
      stats.domain_action = 'NEW';
      bloom.add(record.domain);
    }
  }

  // 2. Subdomains Diff, Lifecycle Tracking & Bulk Operations
  const existingSubDocs = await db.collection('master_subdomains').find({ domain_id: domainId }).toArray();
  const existingSubMap = new Map<string, any>(existingSubDocs.map((s: any) => [(s.subdomain || '').toLowerCase().trim(), s]));
  const crawledSubLowerSet = new Set<string>((record.subdomains || []).map((s) => s.toLowerCase().trim()));
  const subdomainDetails: SubdomainItemDetail[] = [];

  const subBulkOps: any[] = [];
  const changeBulkOps: any[] = [];

  // A. Process Crawled Subdomains (NEW or ACTIVE)
  for (const sub of record.subdomains || []) {
    const subClean = sub.trim();
    const subLower = subClean.toLowerCase();
    const subId = generateEntityId('subdomain', subClean);
    const existing = existingSubMap.get(subLower);

    // Fast memory pre-check with Bloom Filter
    const subBloomCheck = bloom.check(subClean);

    if (subBloomCheck === 'DEFINITELY_NEW' || !existing) {
      // Discovered New Subdomain in this cycle
      stats.new_subdomains++;
      stats.audit_changes_recorded++;
      bloom.add(subClean);

      subdomainDetails.push({
        subdomain: subClean,
        status: 'NEW',
        firstSeen: nowIso,
        lastSeen: nowIso,
      });

      subBulkOps.push({
        updateOne: {
          filter: { id: subId },
          update: {
            $set: { domain_id: domainId, domain: record.domain, subdomain: subClean, status: 'ACTIVE', last_seen: nowIso },
            $setOnInsert: { first_seen: nowIso },
          },
          upsert: true,
        },
      });

      changeBulkOps.push({
        insertOne: {
          document: {
            domain_id: domainId,
            domain: record.domain,
            entity_type: 'subdomain',
            entity_id: subId,
            change_type: 'NEW',
            new_value: subClean,
            detected_at: nowIso,
          },
        },
      });
    } else {
      // Previously existing subdomain
      const wasRemoved = existing.status === 'REMOVED';
      stats.existing_subdomains++;
      subdomainDetails.push({
        subdomain: subClean,
        status: wasRemoved ? 'NEW' : 'ACTIVE',
        firstSeen: existing.first_seen || nowIso,
        lastSeen: nowIso,
      });

      subBulkOps.push({
        updateOne: {
          filter: { id: subId },
          update: { $set: { status: 'ACTIVE', last_seen: nowIso } },
        },
      });

      if (wasRemoved) {
        changeBulkOps.push({
          insertOne: {
            document: {
              domain_id: domainId,
              domain: record.domain,
              entity_type: 'subdomain',
              entity_id: subId,
              change_type: 'REACTIVATED',
              new_value: subClean,
              detected_at: nowIso,
            },
          },
        });
      }
    }
  }

  // B. Detect Missing/Removed Subdomains (existed previously, but not found in current crawl cycle)
  for (const [subKey, existingDoc] of existingSubMap.entries()) {
    if (!crawledSubLowerSet.has(subKey)) {
      stats.missing_subdomains++;
      stats.audit_changes_recorded++;

      subdomainDetails.push({
        subdomain: existingDoc.subdomain,
        status: 'REMOVED',
        firstSeen: existingDoc.first_seen,
        lastSeen: existingDoc.last_seen,
      });

      subBulkOps.push({
        updateOne: {
          filter: { id: existingDoc.id },
          update: { $set: { status: 'REMOVED', last_checked: nowIso } },
        },
      });

      changeBulkOps.push({
        insertOne: {
          document: {
            domain_id: domainId,
            domain: record.domain,
            entity_type: 'subdomain',
            entity_id: existingDoc.id,
            change_type: 'REMOVED',
            old_value: existingDoc.subdomain,
            detected_at: nowIso,
          },
        },
      });
    }
  }

  // Deduplicate all subdomains in memory
  const allSubdomainNames = Array.from(new Set([
    ...(record.subdomains || []),
    ...existingSubDocs.map((s: any) => s.subdomain),
  ])).sort();

  // Execute Subdomain Bulk Operations in single batch
  if (subBulkOps.length > 0) {
    try {
      await db.collection('master_subdomains').bulkWrite(subBulkOps, { ordered: false });
    } catch (bulkErr) {
      console.warn('[Reconciliation] master_subdomains bulkWrite non-fatal warning:', bulkErr);
    }
  }

  // 3. Emails Diff & Bulk Operations
  const existingEmailDocs = await db.collection('master_emails').find({ domain_id: domainId }).toArray();
  const existingEmailMap = new Map(existingEmailDocs.map((e: any) => [e.email, e]));
  const emailBulkOps: any[] = [];

  for (const email of record.emails || []) {
    const emailClean = email.trim().toLowerCase();
    const emailId = generateEntityId('email', emailClean);
    const emailBloomCheck = bloom.check(emailClean);

    if (emailBloomCheck === 'DEFINITELY_NEW' || !existingEmailMap.has(emailClean)) {
      stats.new_emails++;
      stats.audit_changes_recorded++;
      bloom.add(emailClean);

      emailBulkOps.push({
        updateOne: {
          filter: { id: emailId },
          update: {
            $set: { domain_id: domainId, domain: record.domain, email: emailClean, status: 'ACTIVE', last_seen: nowIso },
            $setOnInsert: { first_seen: nowIso },
          },
          upsert: true,
        },
      });

      changeBulkOps.push({
        insertOne: {
          document: {
            domain_id: domainId,
            domain: record.domain,
            entity_type: 'email',
            entity_id: emailId,
            change_type: 'NEW',
            new_value: emailClean,
            detected_at: nowIso,
          },
        },
      });
    } else {
      stats.existing_emails++;
      emailBulkOps.push({
        updateOne: {
          filter: { id: emailId },
          update: { $set: { status: 'ACTIVE', last_seen: nowIso } },
        },
      });
    }
  }

  // Execute Email Bulk Operations in batch
  if (emailBulkOps.length > 0) {
    try {
      await db.collection('master_emails').bulkWrite(emailBulkOps, { ordered: false });
    } catch (bulkErr) {
      console.warn('[Reconciliation] master_emails bulkWrite non-fatal warning:', bulkErr);
    }
  }

  // Execute Audit Change Log Bulk Operations in batch
  if (changeBulkOps.length > 0) {
    try {
      await db.collection('data_changes').bulkWrite(changeBulkOps, { ordered: false });
    } catch (bulkErr) {
      console.warn('[Reconciliation] data_changes bulkWrite non-fatal warning:', bulkErr);
    }
  }

  // 4. Update Master Domain record
  await db.collection('master_domains').updateOne(
    { id: domainId },
    {
      $set: {
        domain: record.domain,
        country: record.country,
        countryCode: record.countryCode,
        countryFlag: record.countryFlag,
        category: record.category,
        summary: record.summary,
        status: record.status,
        errorCode: record.errorCode,
        errorTitle: record.errorTitle,
        last_seen: nowIso,
        reconciliation: stats,
      },
      $setOnInsert: { first_seen: nowIso },
    },
    { upsert: true }
  );

  // 5. Sync to primary dashboard collection: scraped_results (Zero duplicate subdomains)
  await db.collection('scraped_results').updateOne(
    { domain: record.domain },
    {
      $set: {
        ...record,
        subdomains: allSubdomainNames,
        subdomainCount: allSubdomainNames.length,
        subdomainDetails,
        reconciliation: stats,
        updatedAt: nowIso,
      },
      $setOnInsert: {
        id: record.id,
        domain: record.domain,
        createdAt: nowIso,
      },
    },
    { upsert: true }
  );

  return stats;
}
