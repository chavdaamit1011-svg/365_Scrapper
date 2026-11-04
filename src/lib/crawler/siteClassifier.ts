/**
 * Site Classification, Meta Intelligence & Technology Detector
 */

import * as cheerio from 'cheerio';
import { SiteIntelligence } from './types';

export function classifySite(html: string, hostname: string): SiteIntelligence {
  if (!html || typeof html !== 'string') {
    return {
      title: hostname,
      metaDescription: '',
      category: 'Corporate & Business Services',
      categoryIcon: '🌐',
      summary: '',
      technologies: [],
      isEcommerce: false,
      ecommerceSignals: [],
      phones: [],
    };
  }

  const $ = cheerio.load(html);

  // 1. Meta Intelligence
  const title = $('title').first().text().trim() || hostname;
  const metaDescription =
    $('meta[name="description"]').attr('content')?.trim() ||
    $('meta[property="og:description"]').attr('content')?.trim() ||
    '';

  const bodyText = $('body').text().toLowerCase();
  const rawHtml = html.toLowerCase();

  // 2. Technology Fingerprints
  const techSet = new Set<string>();
  if (rawHtml.includes('wp-content') || rawHtml.includes('wp-includes')) techSet.add('WordPress');
  if (rawHtml.includes('shopify') || rawHtml.includes('cdn.shopify.com')) techSet.add('Shopify');
  if (rawHtml.includes('woocommerce')) techSet.add('WooCommerce');
  if (rawHtml.includes('bootstrap') || rawHtml.includes('btn-primary')) techSet.add('Bootstrap');
  if (rawHtml.includes('tailwind') || rawHtml.includes('text-')) techSet.add('Tailwind CSS');
  if (rawHtml.includes('react') || rawHtml.includes('__next') || rawHtml.includes('_next/static')) techSet.add('Next.js');
  if (rawHtml.includes('jquery')) techSet.add('jQuery');
  if (rawHtml.includes('google-analytics') || rawHtml.includes('gtag(')) techSet.add('Google Analytics');

  // 3. E-Commerce Signals
  const ecommerceSignals: string[] = [];
  const hasCurrencyINR = bodyText.includes('₹') || bodyText.includes('inr');
  const hasCurrencyUSD = bodyText.includes('$') || bodyText.includes('usd');
  const hasCart = bodyText.includes('add to cart') || bodyText.includes('shopping cart') || rawHtml.includes('cart');
  const hasCheckout = bodyText.includes('checkout') || bodyText.includes('buy now');

  if (hasCurrencyINR) ecommerceSignals.push('Currency: INR (₹)');
  if (hasCurrencyUSD) ecommerceSignals.push('Currency: USD ($)');
  if (hasCart) ecommerceSignals.push('Shopping Cart');
  if (hasCheckout) ecommerceSignals.push('Direct Checkout');

  const isEcommerce = (hasCart || hasCheckout) && (hasCurrencyINR || hasCurrencyUSD || techSet.has('Shopify') || techSet.has('WooCommerce'));

  // 4. Industry Categorization
  let category = 'Corporate & Business Services';
  let categoryIcon = '🌐';

  const isGov = hostname.endsWith('.gov.in') || hostname.endsWith('.nic.in') || hostname.endsWith('.gov');
  const isEducation = /(institute|college|university|school|education|courses|training|academy|admissions)/i.test(bodyText) || /(institute|college|edu)/i.test(hostname);
  const isHealth = /(hospital|healthcare|clinic|doctor|pharmacy|medical)/i.test(bodyText);

  if (isGov) {
    category = 'Government & Public Sector';
    categoryIcon = '🏛️';
  } else if (isEcommerce) {
    category = 'E-Commerce & Online Store';
    categoryIcon = '🛒';
  } else if (isEducation) {
    category = 'Education & EdTech';
    categoryIcon = '🎓';
  } else if (isHealth) {
    category = 'Healthcare & Medicine';
    categoryIcon = '🏥';
  }

  // Summary preview
  const summary = metaDescription || title;

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

