/**
 * Site Classification, Meta Intelligence & Technology Detector
 * Extracts accurate website business purpose, industry niche, and technology stack.
 */

import * as cheerio from 'cheerio';
import { SiteIntelligence } from './types';

export function classifySite(html: string, hostname: string): SiteIntelligence {
  const cleanHost = String(hostname || '').toLowerCase().replace(/^www\./i, '');

  if (!html || typeof html !== 'string') {
    return {
      title: cleanHost,
      metaDescription: '',
      category: 'Corporate & Business Services',
      categoryIcon: '🌐',
      summary: `Business operations and services for ${cleanHost}.`,
      technologies: [],
      isEcommerce: false,
      ecommerceSignals: [],
      phones: [],
    };
  }

  const $ = cheerio.load(html);

  // 1. Meta & Structured Intelligence Extraction
  const rawTitle = $('title').first().text().replace(/\s+/g, ' ').trim();
  const title = rawTitle && rawTitle.length > 2 ? rawTitle : cleanHost;

  let metaDescription =
    $('meta[name="description"]').attr('content')?.replace(/\s+/g, ' ').trim() ||
    $('meta[property="og:description"]').attr('content')?.replace(/\s+/g, ' ').trim() ||
    $('meta[name="twitter:description"]').attr('content')?.replace(/\s+/g, ' ').trim() ||
    '';

  // Check Schema.org JSON-LD for rich organization description if meta is empty
  if (!metaDescription) {
    try {
      $('script[type="application/ld+json"]').each((_, el) => {
        if (metaDescription) return;
        const text = $(el).text();
        if (text && text.includes('description')) {
          const parsed = JSON.parse(text);
          const obj = Array.isArray(parsed) ? parsed[0] : parsed;
          if (obj?.description && typeof obj.description === 'string') {
            metaDescription = obj.description.replace(/\s+/g, ' ').trim();
          }
        }
      });
    } catch {}
  }

  // If still empty, extract primary headline and lead paragraph
  let leadText = '';
  const h1Text = $('h1').first().text().replace(/\s+/g, ' ').trim();
  $('main p, article p, section p, p').each((_, el) => {
    if (leadText) return;
    const txt = $(el).text().replace(/\s+/g, ' ').trim();
    // Ignore cookie notices, disclaimers, or short links
    if (
      txt.length >= 35 &&
      txt.length <= 350 &&
      !/cookie|privacy policy|terms of|all rights reserved|javascript/i.test(txt)
    ) {
      leadText = txt;
    }
  });

  // Construct accurate, readable website summary
  let summary = '';
  if (metaDescription && metaDescription.length >= 25) {
    summary = metaDescription;
  } else if (leadText) {
    summary = h1Text && !leadText.toLowerCase().includes(h1Text.toLowerCase())
      ? `${h1Text} — ${leadText}`
      : leadText;
  } else if (h1Text && h1Text.length >= 20) {
    summary = `${title}: ${h1Text}`;
  } else {
    summary = title;
  }

  // Ensure clean length and trim
  if (summary.length > 280) {
    summary = summary.slice(0, 277).trim() + '...';
  }

  const bodyText = $('body').text().toLowerCase();
  const rawHtml = html.toLowerCase();

  // 2. Comprehensive Technology Fingerprints
  const techSet = new Set<string>();

  // CMS & Builders
  if (rawHtml.includes('wp-content') || rawHtml.includes('wp-includes')) techSet.add('WordPress');
  if (rawHtml.includes('shopify') || rawHtml.includes('cdn.shopify.com')) techSet.add('Shopify');
  if (rawHtml.includes('woocommerce')) techSet.add('WooCommerce');
  if (rawHtml.includes('wix.com') || rawHtml.includes('_wix_')) techSet.add('Wix');
  if (rawHtml.includes('squarespace.com')) techSet.add('Squarespace');
  if (rawHtml.includes('webflow.com') || rawHtml.includes('w-layout-')) techSet.add('Webflow');
  if (rawHtml.includes('magento') || rawHtml.includes('mage/cookies')) techSet.add('Magento');

  // Frontend Frameworks & Libraries
  if (rawHtml.includes('react') || rawHtml.includes('__next') || rawHtml.includes('_next/static')) techSet.add('Next.js');
  if (rawHtml.includes('tailwind') || rawHtml.includes('text-') || rawHtml.includes('bg-')) techSet.add('Tailwind CSS');
  if (rawHtml.includes('bootstrap') || rawHtml.includes('btn-primary')) techSet.add('Bootstrap');
  if (rawHtml.includes('jquery') || rawHtml.includes('jquery.min.js')) techSet.add('jQuery');
  if (rawHtml.includes('vue.js') || rawHtml.includes('__nuxt')) techSet.add('Vue / Nuxt.js');
  if (rawHtml.includes('angular') || rawHtml.includes('ng-version')) techSet.add('Angular');

  // Cloud & Analytics
  if (rawHtml.includes('google-analytics') || rawHtml.includes('gtag(') || rawHtml.includes('ga(')) techSet.add('Google Analytics');
  if (rawHtml.includes('googletagmanager.com')) techSet.add('Google Tag Manager');
  if (rawHtml.includes('cloudflare')) techSet.add('Cloudflare');
  if (rawHtml.includes('stripe.com') || rawHtml.includes('stripe-')) techSet.add('Stripe Payments');
  if (rawHtml.includes('razorpay.com')) techSet.add('Razorpay');

  // 3. E-Commerce Signals
  const ecommerceSignals: string[] = [];
  const hasCurrencyINR = bodyText.includes('₹') || bodyText.includes('inr') || bodyText.includes('rs.');
  const hasCurrencyUSD = bodyText.includes('$') || bodyText.includes('usd');
  const hasCurrencyEUR = bodyText.includes('€') || bodyText.includes('eur');
  const hasCart = bodyText.includes('add to cart') || bodyText.includes('shopping cart') || rawHtml.includes('cart') || bodyText.includes('basket');
  const hasCheckout = bodyText.includes('checkout') || bodyText.includes('buy now') || bodyText.includes('place order');

  if (hasCurrencyINR) ecommerceSignals.push('Currency: INR (₹)');
  if (hasCurrencyUSD) ecommerceSignals.push('Currency: USD ($)');
  if (hasCurrencyEUR) ecommerceSignals.push('Currency: EUR (€)');
  if (hasCart) ecommerceSignals.push('Shopping Cart');
  if (hasCheckout) ecommerceSignals.push('Direct Checkout');

  const isEcommerce =
    (hasCart || hasCheckout || techSet.has('Shopify') || techSet.has('WooCommerce') || techSet.has('Magento')) &&
    (hasCurrencyINR || hasCurrencyUSD || hasCurrencyEUR || bodyText.includes('price') || bodyText.includes('shipping'));

  // 4. In-Depth Website Work & Business Categorization
  let category = 'Corporate & Business Services';
  let categoryIcon = '🌐';

  // Government & Public Sector
  if (
    cleanHost.endsWith('.gov.in') ||
    cleanHost.endsWith('.nic.in') ||
    cleanHost.endsWith('.gov') ||
    cleanHost.endsWith('.mil') ||
    /(ministry of|department of|government of|municipal corporation|national portal)/i.test(bodyText)
  ) {
    category = 'Government & Public Administration';
    categoryIcon = '🏛️';
  }
  // Software, SaaS & Cloud Solutions
  else if (
    /(saas|cloud platform|api documentation|developer tools|cybersecurity|machine learning|artificial intelligence|devops|data analytics|automation platform|microservices|software solution|crm software|erp system)/i.test(bodyText) ||
    /(tech|software|cloud|cyber|data|ai|app)\./i.test(cleanHost)
  ) {
    category = 'Software, Cloud & SaaS Solutions';
    categoryIcon = '💻';
  }
  // E-Commerce & Retail
  else if (isEcommerce || /(online shopping|shop now|product catalog|free delivery|cash on delivery|retail store)/i.test(bodyText)) {
    category = 'E-Commerce & Online Retail';
    categoryIcon = '🛒';
  }
  // Finance, Fintech & Banking
  else if (
    /(banking|wealth management|investment|mutual fund|fintech|cryptocurrency|credit card|personal loan|insurance policy|trading account|stock broker)/i.test(bodyText)
  ) {
    category = 'Finance, Banking & Fintech';
    categoryIcon = '💳';
  }
  // Healthcare, Hospitals & Medical
  else if (
    /(hospital|clinic|doctor|pharmacy|pharmaceutical|healthcare|patient care|medical diagnosis|telemedicine|laboratory|biotechnology)/i.test(bodyText)
  ) {
    category = 'Healthcare, Hospitals & Medicine';
    categoryIcon = '🏥';
  }
  // Education, Universities & EdTech
  else if (
    /(university|college|school|admissions|curriculum|courses|degrees|students|edtech|online learning|certification program|academy|institute)/i.test(bodyText) ||
    cleanHost.endsWith('.edu') ||
    cleanHost.endsWith('.ac.in')
  ) {
    category = 'Education, Universities & EdTech';
    categoryIcon = '🎓';
  }
  // Real Estate, Builders & Properties
  else if (
    /(real estate|property for sale|apartments|residential project|commercial leasing|architects|realtor|luxury villas|builders|properties)/i.test(bodyText)
  ) {
    category = 'Real Estate & Infrastructure';
    categoryIcon = '🏢';
  }
  // Digital Agency, Marketing & SEO
  else if (
    /(digital marketing|seo agency|creative agency|branding agency|performance marketing|social media management|advertising agency|web development agency)/i.test(bodyText)
  ) {
    category = 'Marketing, SEO & Creative Agency';
    categoryIcon = '📈';
  }
  // Manufacturing, Industrial & Logistics
  else if (
    /(manufacturing|industrial equipment|supply chain|freight forwarder|warehousing|logistics solutions|exporter|importer|factory production|raw materials)/i.test(bodyText)
  ) {
    category = 'Manufacturing, Logistics & Industrial';
    categoryIcon = '🏭';
  }
  // Travel, Tourism & Hospitality
  else if (
    /(hotel booking|resort|vacation packages|travel agency|flight booking|tourism|hospitality|holiday tours)/i.test(bodyText)
  ) {
    category = 'Travel, Hospitality & Tourism';
    categoryIcon = '✈️';
  }
  // News, Media & Journalism
  else if (
    /(breaking news|daily news|editorial|journalism|press release|magazine|entertainment news|broadcast)/i.test(bodyText)
  ) {
    category = 'News, Media & Publishing';
    categoryIcon = '📰';
  }
  // Legal & Corporate Advisory
  else if (
    /(law firm|attorney|legal counsel|solicitor|advocates|litigation|tax advisory|chartered accountants|audit firm)/i.test(bodyText)
  ) {
    category = 'Legal, Tax & Corporate Advisory';
    categoryIcon = '⚖️';
  }
  // Non-Profit & NGO
  else if (
    /(non-profit|ngo|charity foundation|donation|humanitarian|volunteer|donate now)/i.test(bodyText)
  ) {
    category = 'Non-Profit & Humanitarian Organization';
    categoryIcon = '🤝';
  }

  return {
    title,
    metaDescription,
    category,
    categoryIcon,
    summary,
    technologies: Array.from(techSet),
    isEcommerce,
    ecommerceSignals,
    phones: [],
  };
}
