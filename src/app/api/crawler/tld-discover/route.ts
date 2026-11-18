import { NextResponse } from 'next/server';
import { discoverTldRootDomains, normalizeTld } from '@/lib/crawler/tldDiscovery';
import { connectMongo } from '@/lib/mongodb';

export const dynamic = 'force-dynamic';

/**
 * POST /api/crawler/tld-discover
 * Autonomous 24/7 TLD Root Domain Discovery API
 */
export async function POST(req: Request) {
  try {
    const body = await req.json();
    const rawTld = body.tld || body.target || body.domain || '';
    const cycle = Number(body.cycle) || 1;
    const maxPerPass = Number(body.maxPerPass || body.limit) || 250;

    if (!rawTld || typeof rawTld !== 'string') {
      return NextResponse.json(
        { success: false, message: 'Please provide a valid TLD zone (e.g. .in, .com, gov.in)' },
        { status: 400 }
      );
    }

    const cleanTld = normalizeTld(rawTld);
    const result = await discoverTldRootDomains(cleanTld, { cycle, maxPerPass });
    const tldZoneStr = `.${cleanTld}`;

    // Seed master TLD zone & discovered root domains immediately into MongoDB
    try {
      const conn = await connectMongo();
      if (conn?.connection?.db) {
        const db = conn.connection.db;
        const now = new Date().toISOString();

        // 1. Ensure Master TLD Zone record is created/updated
        await db.collection('scraped_results').updateOne(
          { domain: tldZoneStr },
          {
            $setOnInsert: {
              id: `tld_zone_${cleanTld}`,
              domain: tldZoneStr,
              rootDomain: tldZoneStr,
              subdomain: tldZoneStr,
              subdomains: [],
              subdomainCount: 0,
              email: '',
              emails: [],
              verifiedEmails: [],
              phones: [],
              scrapedPhones: [],
              crawledPages: [],
              pagesCrawled: 0,
              category: 'TLD Zone Scope',
              categoryIcon: '🌐',
              isEcommerce: false,
              ecommerceSignals: [],
              technologies: [],
              country: cleanTld === 'in' ? 'India' : 'Global',
              countryCode: cleanTld === 'in' ? 'IN' : 'INT',
              countryFlag: cleanTld === 'in' ? '🇮🇳' : '🌐',
              discoveredAt: now,
              isExplicitTarget: false,
            },
            $set: {
              status: 'CRAWLING',
              isTldZone: true,
              tldZone: tldZoneStr,
              summary: `${tldZoneStr} Top-Level Domain Zone with ${result.totalDiscovered} discovered root domains.`,
              childDomainCount: result.allDomains.length,
              updatedAt: new Date(),
            },
          },
          { upsert: true }
        );

        // 2. Identify any explicit user targets to prevent overwriting their scope
        const existingExplicit = await db
          .collection('scraped_results')
          .find({ domain: { $in: result.allDomains }, isExplicitTarget: true }, { projection: { domain: 1 } })
          .toArray();
        const explicitSet = new Set(existingExplicit.map((d: any) => d.domain.toLowerCase()));

        // 3. Batch seed dynamically discovered root domains
        const ops = [];
        for (const dom of result.allDomains) {
          const domLower = dom.toLowerCase().trim();
          if (explicitSet.has(domLower)) continue;

          // Never seed individual *.gov.in or *.nic.in as independent root cards
          if (cleanTld === 'in') {
            if (domLower !== 'gov.in' && domLower.endsWith('.gov.in')) continue;
            if (domLower !== 'nic.in' && domLower.endsWith('.nic.in')) continue;
          }

          ops.push({
            updateOne: {
              filter: { domain: dom },
              update: {
                $setOnInsert: {
                  id: `dom_${dom.replace(/[^a-z0-9]/gi, '_')}`,
                  domain: dom,
                  rootDomain: dom,
                  subdomain: dom,
                  subdomains: [],
                  subdomainCount: 0,
                  email: '',
                  emails: [],
                  verifiedEmails: [],
                  phones: [],
                  scrapedPhones: [],
                  crawledPages: [],
                  pagesCrawled: 0,
                  category: dom.endsWith('.gov.in') || dom.endsWith('.nic.in') ? 'Government & Public Administration' : 'Corporate & Business Services',
                  categoryIcon: dom.endsWith('.gov.in') || dom.endsWith('.nic.in') ? '🏛️' : '🌐',
                  isEcommerce: false,
                  ecommerceSignals: [],
                  technologies: [],
                  country: cleanTld === 'in' ? 'India' : 'Global',
                  countryCode: cleanTld === 'in' ? 'IN' : 'INT',
                  countryFlag: cleanTld === 'in' ? '🇮🇳' : '🌐',
                  status: 'DISCOVERED',
                  sourceUrl: `https://${dom}`,
                  discoveredAt: now,
                  isTldZone: false,
                },
                $set: {
                  tldZone: tldZoneStr,
                  isExplicitTarget: false,
                  updatedAt: new Date(),
                },
              },
              upsert: true,
            },
          });
        }

        if (ops.length > 0) {
          await db.collection('scraped_results').bulkWrite(ops, { ordered: false });
        }
      }
    } catch (saveErr) {
      console.warn('[tld-discover] Failed to seed discovered root domains into MongoDB:', saveErr);
    }

    return NextResponse.json({
      success: true,
      tld: tldZoneStr,
      cycle: result.cycle,
      totalDiscovered: result.totalDiscovered,
      newCount: result.newDomains.length,
      existingCount: result.existingDomains.length,
      domains: result.allDomains,
      newDomains: result.newDomains,
      existingDomains: result.existingDomains,
      sources: result.sources,
    });
  } catch (err: any) {
    console.error('[API /api/crawler/tld-discover] Error in discovery:', err);
    return NextResponse.json(
      { success: false, message: err?.message || 'TLD Discovery failed' },
      { status: 500 }
    );
  }
}

/**
 * GET /api/crawler/tld-discover?tld=.in&cycle=1
 */
export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const rawTld = searchParams.get('tld') || '.in';
    const cycle = Number(searchParams.get('cycle')) || 1;
    const maxPerPass = Number(searchParams.get('maxPerPass')) || 20;

    const cleanTld = normalizeTld(rawTld);
    const result = await discoverTldRootDomains(cleanTld, { cycle, maxPerPass });

    return NextResponse.json({
      success: true,
      tld: `.${cleanTld}`,
      cycle: result.cycle,
      totalDiscovered: result.totalDiscovered,
      newCount: result.newDomains.length,
      existingCount: result.existingDomains.length,
      domains: result.allDomains,
      newDomains: result.newDomains,
      existingDomains: result.existingDomains,
      sources: result.sources,
    });
  } catch (err: any) {
    return NextResponse.json(
      { success: false, message: err?.message || 'TLD Discovery failed' },
      { status: 500 }
    );
  }
}
