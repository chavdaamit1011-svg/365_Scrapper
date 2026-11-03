import { NextResponse } from 'next/server';
import { connectMongo, MongoScrapedResultModel } from '@/lib/mongodb';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const mongoose = await connectMongo();
    if (!mongoose || mongoose.connection.readyState !== 1) {
      return NextResponse.json(
        { success: false, message: 'MongoDB service not connected', count: 0, data: [] },
        { status: 503 }
      );
    }

    // Query all records directly from MongoDB the_scraper.scraped_results
    const docs = await MongoScrapedResultModel.find({})
      .sort({ updatedAt: -1, _id: -1 })
      .limit(1000)
      .lean();

    const results = docs.map((d: any) => ({
      id: d.id || String(d._id),
      domain: d.domain || '',
      rootDomain: d.rootDomain || d.domain || '',
      subdomain: d.subdomain || d.domain || '',
      subdomains: Array.isArray(d.subdomains) ? d.subdomains : (d.subdomain ? [d.subdomain] : []),
      subdomainCount: typeof d.subdomainCount === 'number' ? d.subdomainCount : (Array.isArray(d.subdomains) ? d.subdomains.length : 0),
      email: d.email || (Array.isArray(d.emails) && d.emails[0]) || '',
      emails: Array.isArray(d.emails) ? d.emails : (d.email ? [d.email] : []),
      verifiedEmails: Array.isArray(d.verifiedEmails) ? d.verifiedEmails : [],
      emailCount: typeof d.emailCount === 'number' ? d.emailCount : (Array.isArray(d.emails) ? d.emails.length : 0),
      category: d.category || 'Corporate & Business Services',
      categoryIcon: d.categoryIcon || '🌐',
      isEcommerce: Boolean(d.isEcommerce),
      ecommerceSignals: Array.isArray(d.ecommerceSignals) ? d.ecommerceSignals : [],
      technologies: Array.isArray(d.technologies) ? d.technologies : [],
      phones: Array.isArray(d.phones) ? d.phones : [],
      summary: d.summary || '',
      crawledPages: Array.isArray(d.crawledPages) ? d.crawledPages : [],
      country: d.country || 'Detected',
      countryCode: d.countryCode || 'INT',
      countryFlag: d.countryFlag || '🌐',
      status: d.status || 'RESOLVED',
      sourceUrl: d.sourceUrl || '',
      pagesCrawled: d.pagesCrawled || 0,
      discoveredAt: d.discoveredAt || d.createdAt || d.updatedAt || new Date().toISOString(),
    }));

    return NextResponse.json({
      success: true,
      count: results.length,
      data: results,
    });
  } catch (error: any) {
    console.error('[API/Crawler Results] Error querying MongoDB:', error);
    return NextResponse.json(
      { success: false, message: error.message || 'Failed to fetch MongoDB results' },
      { status: 500 }
    );
  }
}

export async function DELETE() {
  try {
    const mongoose = await connectMongo();
    if (!mongoose || mongoose.connection.readyState !== 1) {
      return NextResponse.json(
        { success: false, message: 'MongoDB service not connected' },
        { status: 503 }
      );
    }

    const deleteRes = await MongoScrapedResultModel.deleteMany({});

    return NextResponse.json({
      success: true,
      message: `Deleted ${deleteRes.deletedCount || 0} records from MongoDB collection 'scraped_results'.`,
    });
  } catch (error: any) {
    console.error('[API/Crawler Results] Error clearing MongoDB:', error);
    return NextResponse.json(
      { success: false, message: error.message || 'Failed to clear MongoDB results' },
      { status: 500 }
    );
  }
}
