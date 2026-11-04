/**
 * Indian & International Phone Number Extraction Engine
 */

export function extractPhoneNumbers(htmlOrText: string): string[] {
  if (!htmlOrText || typeof htmlOrText !== 'string') return [];

  const foundNumbers = new Set<string>();

  // Regex patterns:
  // 1. Indian numbers with +91 or 0 prefix: +91 7878 66 3800, +91-9876543210, +91 98765 43210
  const indianMobileRegex = /(?:\+91[\s.-]?)?([6-9]\d{4}[\s.-]?\d{5}|[6-9]\d{3}[\s.-]?\d{2}[\s.-]?\d{4}|[6-9]\d{9})/g;

  // 2. Standard 10-digit format starting with 6,7,8,9
  const tenDigitRegex = /\b([6-9]\d{9})\b/g;

  // 3. Toll-free numbers (1800-xxx-xxxx)
  const tollFreeRegex = /\b(1800[\s.-]?\d{3}[\s.-]?\d{3,4})\b/g;

  // Helper to format clean 10-digit Indian numbers as +91 XXXXX XXXXX
  const formatIndianNumber = (digits: string) => {
    if (digits.length === 10) {
      return `+91 ${digits.slice(0, 5)} ${digits.slice(5)}`;
    }
    return `+91 ${digits}`;
  };

  // 1. Check Indian mobile matches
  const matches1 = htmlOrText.match(indianMobileRegex) || [];
  for (const m of matches1) {
    const digitsOnly = m.replace(/\D/g, '');
    if (digitsOnly.length === 10 && /^[6-9]/.test(digitsOnly)) {
      foundNumbers.add(formatIndianNumber(digitsOnly));
    } else if (digitsOnly.length === 12 && digitsOnly.startsWith('91')) {
      const ten = digitsOnly.slice(2);
      if (/^[6-9]/.test(ten)) {
        foundNumbers.add(formatIndianNumber(ten));
      }
    }
  }

  // 2. Check 10-digit standalone
  const matches2 = htmlOrText.match(tenDigitRegex) || [];
  for (const m of matches2) {
    const digitsOnly = m.replace(/\D/g, '');
    if (digitsOnly.length === 10) {
      foundNumbers.add(formatIndianNumber(digitsOnly));
    }
  }

  // 3. Check toll-free
  const matches3 = htmlOrText.match(tollFreeRegex) || [];
  for (const m of matches3) {
    const cleanToll = m.replace(/[^\d]/g, '');
    foundNumbers.add(`1800-${cleanToll.slice(4)}`);
  }

  return Array.from(foundNumbers).slice(0, 5);
}

