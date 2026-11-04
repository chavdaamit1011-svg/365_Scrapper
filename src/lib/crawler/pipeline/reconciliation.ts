/**
 * Phase 2 Reconciliation & Master Storage Engine (Native TypeScript / MongoDB)
 * Components:
 * - SHA-256 entity ID generation
 * - Diff Evaluation: NEW, CHANGED, SAME, MISSING
 * - Immutable Audit Logging in data_changes
 * - Master Relational Sync to MongoDB master collections
 */

import crypto from 'crypto';
import { connectMongo } from '../../mongodb';
import { ScrapedDomainRecord, ReconciliationStats, SubdomainItemDetail } from '../types';

export function generateEntityId(entityType: 'domain' | 'subdomain' | 'email', value: string): string {
  const norm = value.trim().toLowerCase();
  const hash = crypto.createHash('sha256').update(`${entityType}:${norm}`).digest('hex');
  return `${entityType}_${hash.slice(0, 16)}`;
}

/**
 * Reconciles crawl results against previous observations in MongoDB
 * Tracks mutations and updates master records
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

  // 1. Check existing master domain
  const existingMaster = await db.collection('master_domains').findOne({ id: domainId });
  if (existingMaster) {
    stats.domain_action = 'EXISTING_UPDATED';
  } else {
    stats.domain_action = 'NEW';
  }

  // 2. Subdomains Diff, Lifecycle Tracking & Upsert
  const existingSubDocs = await db.collection('master_subdomains').find({ domain_id: domainId }).toArray();
  const existingSubMap = new Map<string, any>(existingSubDocs.map((s: any) => [(s.subdomain || '').toLowerCase().trim(), s]));
  const crawledSubLowerSet = new Set<string>((record.subdomains || []).map((s) => s.toLowerCase().trim()));
  const subdomainDetails: SubdomainItemDetail[] = [];

  // A. Process Crawled Subdomains (NEW or ACTIVE)
  for (const sub of record.subdomains || []) {
    const subClean = sub.trim();
    const subLower = subClean.toLowerCase();
    const subId = generateEntityId('subdomain', subClean);
    const existing = existingSubMap.get(subLower);

    if (!existing) {
      // Discovered New Subdomain in this cycle
      stats.new_subdomains++;
      stats.audit_changes_recorded++;
      subdomainDetails.push({
        subdomain: subClean,
        status: 'NEW',
        firstSeen: nowIso,
        lastSeen: nowIso,
      });

      await db.collection('master_subdomains').updateOne(
        { id: subId },
        {
          $set: { domain_id: domainId, domain: record.domain, subdomain: subClean, status: 'ACTIVE', last_seen: nowIso },
          $setOnInsert: { first_seen: nowIso },
        },
        { upsert: true }
      );
      await db.collection('data_changes').insertOne({
        domain_id: domainId,
        domain: record.domain,
        entity_type: 'subdomain',
        entity_id: subId,
        change_type: 'NEW',
        new_value: subClean,
        detected_at: nowIso,
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

      await db.collection('master_subdomains').updateOne(
        { id: subId },
        { $set: { status: 'ACTIVE', last_seen: nowIso } }
      );

      if (wasRemoved) {
        await db.collection('data_changes').insertOne({
          domain_id: domainId,
          domain: record.domain,
          entity_type: 'subdomain',
          entity_id: subId,
          change_type: 'REACTIVATED',
          new_value: subClean,
          detected_at: nowIso,
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

      await db.collection('master_subdomains').updateOne(
        { id: existingDoc.id },
        { $set: { status: 'REMOVED', last_checked: nowIso } }
      );

      await db.collection('data_changes').insertOne({
        domain_id: domainId,
        domain: record.domain,
        entity_type: 'subdomain',
        entity_id: existingDoc.id,
        change_type: 'REMOVED',
        old_value: existingDoc.subdomain,
        detected_at: nowIso,
      });
    }
  }

  // Deduplicate all subdomains in memory
  const allSubdomainNames = Array.from(new Set([
    ...(record.subdomains || []),
    ...existingSubDocs.map((s: any) => s.subdomain)
  ]));

  // 3. Emails Diff & Upsert
  const existingEmailDocs = await db.collection('master_emails').find({ domain_id: domainId }).toArray();
  const existingEmailMap = new Map(existingEmailDocs.map((e: any) => [e.email, e]));
  const crawledEmailSet = new Set(record.emails);

  for (const email of record.emails) {
    const emailId = generateEntityId('email', email);
    if (!existingEmailMap.has(email)) {
      stats.new_emails++;
      stats.audit_changes_recorded++;
      await db.collection('master_emails').updateOne(
        { id: emailId },
        {
          $set: { domain_id: domainId, domain: record.domain, email, status: 'ACTIVE', last_seen: nowIso },
          $setOnInsert: { first_seen: nowIso },
        },
        { upsert: true }
      );
      await db.collection('data_changes').insertOne({
        domain_id: domainId,
        domain: record.domain,
        entity_type: 'email',
        entity_id: emailId,
        change_type: 'NEW',
        new_value: email,
        detected_at: nowIso,
      });
    } else {
      stats.existing_emails++;
      await db.collection('master_emails').updateOne(
        { id: emailId },
        { $set: { status: 'ACTIVE', last_seen: nowIso } }
      );
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
