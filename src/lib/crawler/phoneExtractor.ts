/**
 * High-Precision Contextual Phone Number Extraction & Deep Location Linking Engine
 * 
 * Features:
 * - Cheerio DOM Parsing: Automatically strips scripts, styles, SVGs, and attributes.
 * - Explicit tel: link extraction with exact container anchor/ID capture.
 * - Strict Phone Context Enforcement: Only extracts numbers preceded/followed by phone keywords
 *   (Phone, Tel, Mobile, Contact, Helpline, Toll-Free, Fax) or strict phone formatting (+91, 1800, STD code).
 * - False Positive Shield: Discards dates, timestamps, order IDs, pincodes, and tracking numbers.
 * - Scroll-to-Text Deep Linking: Automatically appends W3C/Chromium Text Fragments (`#:~:text=...`)
 *   and DOM section hashes (`#contact`) so the browser jumps directly to the exact location of the number.
 */

import * as cheerio from 'cheerio';

export interface ScrapedPhoneDetail {
  phone: string;
  sourceUrl?: string;
  isPrimary?: boolean;
  rawMatch?: string; // Exact visible text on the webpage for Chrome scroll-to-text highlighting
  sectionId?: string; // Nearest HTML anchor / container ID (e.g. contact-section)
}

/**
 * Builds a browser redirect URL that opens the exact source page
 * and uses Chrome/Edge/Firefox Text Fragments (`#:~:text=...`) to scroll
 * and highlight the exact scraped number location on that page.
 */
export function buildPhoneRedirectUrl(
  phone: string,
  sourceUrl?: string,
  rawMatch?: string,
  sectionId?: string
): string {
  if (!sourceUrl) {
    return `tel:${phone.replace(/\s+/g, '')}`;
  }

  // If sourceUrl already contains a text fragment directive, return it directly
  if (sourceUrl.includes(':~:text=')) {
    return sourceUrl;
  }

  const baseSource = sourceUrl.split('#')[0];
  let url = baseSource;

  // Clean candidate text for Chrome/Edge/Firefox scroll-to-text highlighting
  const highlightCandidate = rawMatch || phone.replace(/^\+91[\s.-]?/, '') || phone;
  const cleanHighlight = highlightCandidate.trim().replace(/\s+/g, ' ');
  const encodedText = encodeURIComponent(cleanHighlight);

  if (sectionId) {
    url += `#${sectionId}:~:text=${encodedText}`;
  } else {
    url += `#:~:text=${encodedText}`;
  }

  return url;
}

export function extractPhoneDetails(htmlOrText: string, sourceUrl: string = ''): ScrapedPhoneDetail[] {
  if (!htmlOrText || typeof htmlOrText !== 'string') return [];

  const foundMap = new Map<string, ScrapedPhoneDetail>();
  const isHtml = htmlOrText.includes('<') && htmlOrText.includes('>');
  const cleanSourceUrl = sourceUrl.split('#')[0];

  const formatIndianMobile = (digits: string) => {
    if (digits.length === 10) {
      return `+91 ${digits.slice(0, 5)} ${digits.slice(5)}`;
    }
    return `+91 ${digits}`;
  };

  const addPhone = (formatted: string, rawMatch: string, sectionId?: string) => {
    if (!formatted || foundMap.has(formatted)) return;

    // Discard repetitive dummy numbers
    const cleanDigits = formatted.replace(/\D/g, '');
    if (/^(\d)\1{7,}$/.test(cleanDigits) || cleanDigits === '1234567890' || cleanDigits === '0123456789') {
      return;
    }

    foundMap.set(formatted, {
      phone: formatted,
      rawMatch: rawMatch.trim(),
      sourceUrl: cleanSourceUrl,
      sectionId: sectionId || '',
      isPrimary: foundMap.size === 0,
    });
  };

  // If input is HTML, parse with Cheerio
  if (isHtml) {
    const $ = cheerio.load(htmlOrText);

    // Step 1: Extract all explicit <a href="tel:..."> links (100% verified phone links!)
    $('a[href^="tel:"], a[href^="TEL:"]').each((_, el) => {
      const href = $(el).attr('href') || '';
      const rawTel = href.replace(/^tel:/i, '').trim();
      const visibleText = $(el).text().trim() || rawTel;
      const containerId = $(el).closest('[id]').attr('id') || $(el).attr('id');

      const digits = rawTel.replace(/\D/g, '');
      let formatted = rawTel;

      if (digits.length === 10 && /^[6-9]/.test(digits)) {
        formatted = formatIndianMobile(digits);
      } else if (digits.length === 12 && digits.startsWith('91') && /^[6-9]/.test(digits.slice(2))) {
        formatted = formatIndianMobile(digits.slice(2));
      } else if (rawTel.startsWith('1800') || digits.startsWith('1800')) {
        formatted = `1800-${digits.slice(4)}`;
      } else if (digits.length >= 8 && digits.length <= 12) {
        formatted = rawTel;
      }

      addPhone(formatted, visibleText, containerId);
    });

    // Step 2: Strip all non-visible noise tags completely
    $('script, style, svg, noscript, iframe, head, meta, link, template, code, pre, object, embed').remove();

    // Step 3: Scan visible text nodes and contact sections
    const bodyText = $('body').text() || $.text();
    extractFromPlainText(bodyText, addPhone);
  } else {
    // Plain text input
    extractFromPlainText(htmlOrText, addPhone);
  }

  return Array.from(foundMap.values()).slice(0, 8);
}

/**
 * Extracts phones strictly from human-visible text using Phone Context Verification
 */
function extractFromPlainText(
  text: string,
  addPhone: (formatted: string, rawMatch: string, sectionId?: string) => void
): void {
  if (!text) return;

  // Phone Context keywords
  const contextPattern = /(?:phone|telephone|mobile|contact|call|helpline|toll[- ]?free|fax|ph\s*:|mo\s*:|cell|support|desk|hotline|reach us|inquiry|enquiry|care)/i;
  // False positive indicators (dates, order ids, pincodes, etc.)
  const falsePositivePattern = /(?:date|ref|order|circular|pincode|pin|challan|gst|pan|version|invoice|tracking|ticket|width|height)/i;

  // 1. Toll-Free numbers (e.g. 1800-11-1950, 1800 233 0440, 1800-233-0440)
  const tollFreeRegex = /\b(1800[\s.-]?\d{3}[\s.-]?\d{3,4})\b/g;
  let tfMatch;
  while ((tfMatch = tollFreeRegex.exec(text)) !== null) {
    const raw = tfMatch[1].trim();
    const cleanToll = raw.replace(/[^\d]/g, '');
    addPhone(`1800-${cleanToll.slice(4)}`, raw);
  }

  // 2. Indian Landlines with STD Code (e.g. 079-23250311, (079) 23250311, 011-23381234, 022-22025656)
  const landlineRegex = /(?:\b|\()0([1-9]\d{1,3})\)?[\s.-](\d{6,8})\b/g;
  let llMatch;
  while ((llMatch = landlineRegex.exec(text)) !== null) {
    const raw = llMatch[0].trim();
    const idx = llMatch.index;
    const surrounding = text.slice(Math.max(0, idx - 45), Math.min(text.length, idx + raw.length + 45));

    // Must have phone context or explicit telephone indicator (hyphen/parenthesis)
    if (contextPattern.test(surrounding) || raw.includes('-') || raw.includes('(')) {
      if (!falsePositivePattern.test(surrounding)) {
        const std = llMatch[1];
        const num = llMatch[2];
        addPhone(`0${std}-${num}`, raw);
      }
    }
  }

  // 3. Explicit +91 Mobile numbers (e.g. +91 98250 12345, +91-9825012345)
  const plus91Regex = /\+91[\s.-]?([6-9]\d{4}[\s.-]?\d{5}|[6-9]\d{9})\b/g;
  let p91Match;
  while ((p91Match = plus91Regex.exec(text)) !== null) {
    const raw = p91Match[0].trim();
    const digits = raw.replace(/\D/g, '').slice(-10);
    if (digits.length === 10) {
      addPhone(`+91 ${digits.slice(0, 5)} ${digits.slice(5)}`, raw);
    }
  }

  // 4. Standalone 10-digit numbers: ONLY accepted if STRICT phone keyword appears right before it!
  const contextualMobileRegex = /\b([6-9]\d{4}[\s.-]?\d{5})\b/g;
  let cMobMatch;
  while ((cMobMatch = contextualMobileRegex.exec(text)) !== null) {
    const raw = cMobMatch[0].trim();
    const idx = cMobMatch.index;
    const prefixText = text.slice(Math.max(0, idx - 40), idx);

    // Must have explicit phone keyword within 40 characters BEFORE the number!
    if (contextPattern.test(prefixText)) {
      if (!falsePositivePattern.test(prefixText)) {
        const digits = raw.replace(/\D/g, '');
        if (digits.length === 10) {
          addPhone(`+91 ${digits.slice(0, 5)} ${digits.slice(5)}`, raw);
        }
      }
    }
  }
}

export function extractPhoneNumbers(htmlOrText: string): string[] {
  return extractPhoneDetails(htmlOrText).map((p) => p.phone);
}
