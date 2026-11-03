import re
import logging
from typing import Dict, Any, List, Optional
from bs4 import BeautifulSoup

logger = logging.getLogger("TheScrapper.SiteClassifier")

# Category Definitions with weighted keyword scoring
CATEGORY_KEYWORDS: Dict[str, Dict[str, Any]] = {
    "E-Commerce & Online Store": {
        "icon": "🛒",
        "keywords": [
            "add to cart", "buy now", "checkout", "shopping cart", "view cart",
            "order now", "free shipping", "return policy", "track order", "wishlist",
            "product details", "in stock", "out of stock", "sku", "price",
            "shop now", "sale", "discount", "categories", "bestsellers", "store"
        ],
        "weight": 2.5,
    },
    "Security & Enterprise Defense": {
        "icon": "🛡️",
        "keywords": [
            "security guard", "security guards", "patrol", "surveillance", "psara",
            "bouncers", "armed guard", "security officer", "escort security",
            "command center", "facility protection", "manned guarding", "cctv monitoring",
            "rapid response", "guarding solutions"
        ],
        "weight": 3.0,
    },
    "SaaS & Cloud Software": {
        "icon": "💻",
        "keywords": [
            "saas", "cloud software", "api documentation", "developer api", "sdk",
            "workflow automation", "pricing plans", "start free trial", "request demo",
            "integrations", "enterprise platform", "dashboard", "subscription"
        ],
        "weight": 2.0,
    },
    "IT Services & Tech Consulting": {
        "icon": "⚙️",
        "keywords": [
            "software development", "web development", "mobile app development",
            "it consulting", "digital transformation", "cloud migration",
            "cybersecurity", "devops", "custom software", "tech stack"
        ],
        "weight": 2.0,
    },
    "Healthcare & Medical": {
        "icon": "🏥",
        "keywords": [
            "hospital", "clinic", "patient care", "doctor", "specialists",
            "treatment", "medical services", "surgery", "healthcare", "pharmacy",
            "book appointment", "emergency care"
        ],
        "weight": 2.5,
    },
    "Education & EdTech": {
        "icon": "🎓",
        "keywords": [
            "courses", "academy", "admissions", "curriculum", "students",
            "training program", "degree", "certification", "tuition", "faculty",
            "online learning", "campus"
        ],
        "weight": 2.5,
    },
    "Finance, Banking & Fintech": {
        "icon": "💳",
        "keywords": [
            "banking", "personal loan", "home loan", "investment", "insurance",
            "wealth management", "fintech", "credit card", "mutual funds",
            "fixed deposit", "interest rate", "trading"
        ],
        "weight": 2.5,
    },
    "Real Estate & Construction": {
        "icon": "🏢",
        "keywords": [
            "real estate", "property for sale", "apartments", "villas", "builders",
            "realtor", "commercial property", "floor plan", "residential project",
            "possession"
        ],
        "weight": 2.5,
    },
    "Media, News & Publishing": {
        "icon": "📰",
        "keywords": [
            "breaking news", "latest news", "editorial", "headlines", "opinions",
            "journal", "articles", "stories", "newspaper", "press release"
        ],
        "weight": 2.0,
    },
    "Government & Public Sector": {
        "icon": "🏛️",
        "keywords": [
            "government of", "ministry of", "department of", "municipal corporation",
            "public service", "citizen portal", "statutory", "official portal", "gazette"
        ],
        "weight": 3.0,
    },
}

PHONE_REGEX = re.compile(
    r"(?:\+?91[\s.-]?)?[6-9]\d{4}[\s.-]?\d{5}\b|(?:\+?91[\s.-]?)?[6-9]\d{3}[\s.-]?\d{6}\b|(?:\+?\d{1,3}[-.\s]?)?\(?\d{2,5}\)?[-.\s]?\d{3,5}[-.\s]?\d{3,5}\b"
)

DUMMY_PHONE_SEQUENCES = {
    "1234567890", "0123456789", "0000000000", "1111111111",
    "9999999999", "8888888888", "7777777777", "1800000000",
    "9876543210", "00000000", "12345678", "01234567"
}


def clean_and_normalize_phone(raw: str) -> Optional[str]:
    """
    Cleans, validates, and canonicalizes telephone numbers:
    - Rejects postal pin codes (6 digits, e.g. 382330), years (4 digits)
    - Rejects placeholder dummy numbers (1234567890)
    - Formats Indian mobile numbers: +91 XXXXX XXXXX or +91 XXXX XXXXXX
    - Formats international numbers with +{country_code}
    """
    if not raw or not isinstance(raw, str):
        return None

    raw_clean = raw.strip().split("?")[0].strip()
    digits = re.sub(r"\D", "", raw_clean)

    # Validate digit count
    if len(digits) < 8 or len(digits) > 14:
        return None

    # Reject pin codes (6 digits) or years (4 digits)
    if len(digits) in (4, 6):
        return None

    # Reject dummy sequences
    if digits in DUMMY_PHONE_SEQUENCES:
        return None

    # Check for repeating identical digits
    if len(set(digits)) <= 2:
        return None

    # Indian Mobile / Landline formatting
    if len(digits) == 12 and digits.startswith("91") and digits[2] in "6789":
        d = digits[2:]
        if " " in raw_clean and len(raw_clean.split()[0].replace("+91", "")) == 4:
            return f"+91 {d[:4]} {d[4:]}"
        return f"+91 {d[:5]} {d[5:]}"
    elif len(digits) == 10 and digits[0] in "6789":
        return f"+91 {digits[:5]} {digits[5:]}"
    elif len(digits) == 11 and digits.startswith("0") and digits[1] in "6789":
        d = digits[1:]
        return f"+91 {d[:5]} {d[5:]}"
    elif raw_clean.startswith("+"):
        return f"+{digits}"
    elif len(digits) == 10 and digits.startswith("1800"):
        return f"1800 {digits[4:7]} {digits[7:]}"

    return f"+{digits}" if raw_clean.startswith("+") else digits

CURRENCY_PATTERNS = [
    (r"₹|\bINR\b|Rs\.?", "INR (₹)"),
    (r"\$|\bUSD\b", "USD ($)"),
    (r"€|\bEUR\b", "EUR (€)"),
    (r"£|\bGBP\b", "GBP (£)"),
]


def classify_website_content(soup_or_html: Any, raw_html: str = "", url: str = "") -> Dict[str, Any]:
    """
    Deterministically analyzes page text, DOM elements, schemas, and metadata
    to identify the website category, e-commerce capabilities, technologies,
    and verified phone numbers. Zero fake details are generated.
    """
    if not soup_or_html:
        return {
            "category": "Corporate & Business Services",
            "category_icon": "🌐",
            "is_ecommerce": False,
            "ecommerce_signals": [],
            "technologies": [],
            "phones": [],
            "summary": "",
        }

    if isinstance(soup_or_html, str):
        soup = BeautifulSoup(soup_or_html, "html.parser")
        if not raw_html:
            raw_html = soup_or_html
    else:
        soup = soup_or_html
        if not raw_html:
            raw_html = str(soup)

    # Extract text from visible elements
    body = soup.find("body") or soup
    page_text = body.get_text(separator=" ", strip=True).lower()
    meta_desc = ""
    desc_tag = soup.find("meta", attrs={"name": "description"}) or soup.find("meta", property="og:description")
    if desc_tag and desc_tag.get("content"):
        meta_desc = desc_tag.get("content", "").strip()

    title = ""
    title_tag = soup.find("title") or soup.find("meta", property="og:title")
    if title_tag:
        title = (title_tag.string or title_tag.get("content", "") or "").strip()

    combined_text = f"{title.lower()} {meta_desc.lower()} {page_text[:8000]}"

    # 1. E-Commerce Analysis
    ecommerce_signals: List[str] = []
    has_cart_element = bool(
        soup.find(lambda tag: tag.name in ["a", "button", "div", "span"] and (
            any(c in (tag.get("class") or []) or c in (tag.get("id") or "") for c in ["cart", "checkout", "minicart", "shopping-cart", "basket", "bag"])
            or any(sub in (tag.get("href") or "").lower() for sub in ["/cart", "/checkout", "/basket", "/bag", "view-cart"])
            or tag.get_text().strip().lower() in ["cart", "view cart", "checkout", "my cart", "basket", "shopping bag"]
        ))
        or soup.find("form", action=re.compile(r"cart|checkout", re.I))
    )
    if has_cart_element:
        ecommerce_signals.append("Shopping Cart UI Detected")

    # Product schema check
    has_product_schema = (
        '"@type": "product"' in raw_html.lower()
        or '"@type":"product"' in raw_html.lower()
        or 'itemtype="http://schema.org/product"' in raw_html.lower()
        or bool(soup.find("meta", property="og:type", content=re.compile(r"product", re.I)))
    )
    if has_product_schema:
        ecommerce_signals.append("Schema.org Product Metadata")

    # Add to cart buttons
    has_buy_button = bool(soup.find(lambda tag: tag.name in ["button", "a", "input"] and any(
        w in tag.get_text().lower() for w in ["add to cart", "buy now", "add to bag", "order now"]
    )))
    if has_buy_button:
        ecommerce_signals.append("Direct Buy / Add to Cart Action")

    # Currency signals
    detected_currencies = []
    for pat, label in CURRENCY_PATTERNS:
        if re.search(pat, combined_text, re.IGNORECASE):
            detected_currencies.append(label)
    if detected_currencies:
        ecommerce_signals.append(f"Currency: {', '.join(detected_currencies[:2])}")

    # Classified as e-commerce if 2+ signals, or category is E-Commerce + 1 signal, or has cart/buy action
    is_ecommerce = (
        len(ecommerce_signals) >= 2
        or (has_cart_element and has_buy_button)
        or (has_product_schema and has_cart_element)
    )

    # 2. Category Scoring
    category_scores: Dict[str, float] = {}
    for cat_name, cat_meta in CATEGORY_KEYWORDS.items():
        score = 0.0
        weight = cat_meta["weight"]
        for kw in cat_meta["keywords"]:
            count = combined_text.count(kw)
            if count > 0:
                score += min(count, 5) * weight

        # Special Boosts
        if cat_name == "E-Commerce & Online Store" and is_ecommerce:
            score += 15.0
        if cat_name == "Security & Enterprise Defense" and any(k in combined_text for k in ["suraksha", "security guard", "psara"]):
            score += 20.0

        if score > 0:
            category_scores[cat_name] = score

    # Determine highest scoring category
    if category_scores:
        top_category = max(category_scores.items(), key=lambda x: x[1])[0]
        cat_icon = CATEGORY_KEYWORDS[top_category]["icon"]
    elif is_ecommerce:
        top_category = "E-Commerce & Online Store"
        cat_icon = "🛒"
    else:
        top_category = "Corporate & Business Services"
        cat_icon = "🌐"

    # 3. Technologies Detection
    technologies: List[str] = []
    if "__NEXT_DATA__" in raw_html or "/_next/" in raw_html:
        technologies.append("Next.js")
    if "react" in raw_html.lower() or "data-reactroot" in raw_html:
        technologies.append("React")
    if "cdn.shopify.com" in raw_html or "shopify" in raw_html.lower():
        technologies.append("Shopify")
    if "woocommerce" in raw_html.lower():
        technologies.append("WooCommerce")
    if "wp-content" in raw_html:
        technologies.append("WordPress")
    if "tailwind" in raw_html.lower() or "rounded-3xl" in raw_html:
        technologies.append("Tailwind CSS")
    if "bootstrap" in raw_html.lower():
        technologies.append("Bootstrap")

    # 4. Verified Phone Numbers (Ranked by Authority & Priority)
    phone_candidates: Dict[str, int] = {}

    # Tier 1: Explicit Click-to-Call tel: links & WhatsApp links (Highest Priority = 100)
    for a in soup.find_all("a", href=True):
        href = a["href"].strip()
        if href.lower().startswith("tel:"):
            clean_phone = href[4:].split("?")[0].strip()
            norm = clean_and_normalize_phone(clean_phone)
            if norm:
                phone_candidates[norm] = max(phone_candidates.get(norm, 0), 100)
        elif "wa.me/" in href or "whatsapp.com/send" in href:
            m = re.search(r"(?:wa\.me/|phone=)(\d+)", href)
            if m:
                norm = clean_and_normalize_phone(m.group(1))
                if norm:
                    phone_candidates[norm] = max(phone_candidates.get(norm, 0), 95)

    # Tier 2: Dedicated Contact Zones: header, footer, address, [class*="contact"], [id*="contact"] (Priority = 80)
    semantic_phone_containers = soup.find_all(
        lambda t: t.name in ["header", "footer", "address"]
        or any("contact" in str(c).lower() for c in (t.get("class") or []))
        or "contact" in str(t.get("id", "")).lower()
        or any("phone" in str(c).lower() for c in (t.get("class") or []))
    )
    for container in semantic_phone_containers:
        c_text = container.get_text(separator=" ")
        for match in PHONE_REGEX.finditer(c_text):
            norm = clean_and_normalize_phone(match.group(0))
            if norm:
                phone_candidates[norm] = max(phone_candidates.get(norm, 0), 80)

    # Tier 3: Body text mentions (Priority = 30)
    body = soup.find("body") or soup
    for elem in body.find_all(["p", "span", "div", "li"]):
        if elem.name in ("script", "style", "noscript", "svg", "input"):
            continue
        elem_text = elem.get_text()
        if any(term in elem_text.lower() for term in ["phone", "call", "tel", "contact", "+91", "1800", "mobile"]):
            for match in PHONE_REGEX.finditer(elem_text):
                norm = clean_and_normalize_phone(match.group(0))
                if norm:
                    phone_candidates[norm] = max(phone_candidates.get(norm, 0), 30)

    # Sort strictly by priority score descending (Official tel: links ALWAYS at index 0)
    valid_phones = sorted(
        phone_candidates.keys(),
        key=lambda p: phone_candidates[p],
        reverse=True
    )[:4]

    # Clean summary (1-2 sentences)
    summary = meta_desc if meta_desc else (title if title else "")
    if len(summary) > 220:
        summary = summary[:217] + "..."

    return {
        "category": top_category,
        "category_icon": cat_icon,
        "is_ecommerce": is_ecommerce,
        "ecommerce_signals": ecommerce_signals,
        "technologies": technologies[:5],
        "phones": valid_phones,
        "summary": summary,
    }
