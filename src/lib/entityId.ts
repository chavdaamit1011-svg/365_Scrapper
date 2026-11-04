import crypto from 'crypto';

export type EntityType =
  | 'domain'
  | 'subdomain'
  | 'email'
  | 'phone'
  | 'target'
  | 'job'
  | 'record'
  | 'change';

/**
 * Normalizes entity identity value before hashing:
 * - Trims whitespace
 * - Converts to lowercase
 * - Strips protocol (http://, https://) and path for domains/subdomains/targets
 * - Strips mailto: prefix for emails
 * - Removes non-digit/plus characters for phones
 */
export function normalizeEntityValue(entityType: EntityType, value: string): string {
  let clean = String(value || '').trim().toLowerCase();

  if (entityType === 'domain' || entityType === 'subdomain' || entityType === 'target') {
    clean = clean.replace(/^https?:\/\//i, '');
    clean = clean.split('/')[0].split(':')[0];
    clean = clean.replace(/\.+$/, '');
  } else if (entityType === 'email') {
    clean = clean.replace(/^mailto:/i, '');
  } else if (entityType === 'phone') {
    clean = clean.replace(/[^\d+]/g, '');
  }

  return clean;
}

/**
 * Generates a deterministic, collision-resistant, and stable SHA-256 unique ID with an entity type prefix.
 *
 * Architecture Principles:
 * 1. Idempotency: The same normalized identity (e.g. 'gov.in', 'GOV.IN', 'https://gov.in/')
 *    ALWAYS generates the identical stable ID.
 * 2. Self-Describing Prefix: Entity type prefix ('domain_', 'sub_', 'email_', 'tgt_', 'job_')
 *    ensures clear namespace separation and prevents cross-entity collisions.
 * 3. Database Integrity: Perfect for MongoDB unique constraints and idempotent UPSERT operations.
 *
 * @example
 * generateEntityId('domain', 'gov.in')       // -> "domain_d9d9bc33727fc7dc"
 * generateEntityId('domain', 'https://GOV.IN/') // -> "domain_d9d9bc33727fc7dc" (Identical!)
 * generateEntityId('subdomain', 'uidai.gov.in') // -> "sub_9f83c2e1a4d5b6e7"
 * generateEntityId('email', 'Admin@Target.com') // -> "email_1a2b3c4d5e6f7a8b"
 */
export function generateEntityId(
  entityType: EntityType,
  value: string,
  hashLength: number = 16
): string {
  const normalized = normalizeEntityValue(entityType, value);
  const hash = crypto
    .createHash('sha256')
    .update(`${entityType}:${normalized}`)
    .digest('hex');

  const prefix =
    entityType === 'subdomain'
      ? 'sub'
      : entityType === 'target'
      ? 'tgt'
      : entityType;

  return `${prefix}_${hash.slice(0, hashLength)}`;
}

