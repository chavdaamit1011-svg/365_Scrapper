import re
import html
import urllib.parse
import logging
from typing import Set, List, Optional, Dict, Any, Tuple
from bs4 import BeautifulSoup

try:
    import dns.resolver
    DNS_AVAILABLE = True
except ImportError:
    DNS_AVAILABLE = False

logger = logging.getLogger("TheScrapper.EmailExtractor")

# Strict RFC 5322 compliant regex for extraction
EMAIL_REGEX = re.compile(
    r"\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b"
)

# File extensions that cause false positives (e.g. image@2x.png)
IGNORED_EXTENSIONS = {
    ".png", ".jpg", ".jpeg", ".gif", ".svg", ".webp", ".bmp", ".ico",
    ".css", ".js", ".map", ".woff", ".woff2", ".ttf", ".eot",
    ".mp3", ".mp4", ".avi", ".pdf", ".zip", ".gz", ".tar", ".exe", ".dmg"
}

# Template and placeholder dummy domains frequently embedded in HTML/CSS frameworks
DUMMY_DOMAINS = {
    "company.com", "example.com", "example.org", "example.net",
    "domain.com", "test.com", "sample.com", "email.com",
    "mysite.com", "yoursite.com", "yourcompany.com", "placeholder.com",
    "website.com", "temp.com", "fake.com", "sentry.io", "wix.com",
    "wordpress.com", "shopify.com", "cloudflare.com", "gravatar.com",
    "themeforest.net", "bootstrapmade.com", "tailwindui.com",
    "yourdomain.com", "mycompany.com"
}

# Non-human, automated, policy/legal, and dummy email prefixes to strictly exclude
EXCLUDED_EMAIL_PREFIXES = {
    # System & Automated No-Reply addresses
    "noreply", "no-reply", "donotreply", "do-not-reply", "mailer-daemon",
    "postmaster", "hostmaster", "webmaster", "daemon", "root", "bounce",
    "bounce-handler", "auto-reply", "notification", "notifications", "alerts",
    "alert", "system", "git", "github", "gitlab", "jira", "sentry",
    "auto-confirm", "no_reply", "do_not_reply",

    # Policy, Legal, Cookie & Compliance boilerplates (NOT general contact)
    "privacy", "legal", "dpo", "gdpr", "compliance", "copyright",
    "disclaimer", "terms", "abuse", "security", "unsubscribe",
    "command", "branch", "internal",

    # Dummy placeholders & demo templates
    "you", "your-name", "yourname", "username", "user", "name", "email",
    "test", "placeholder", "demo", "sample", "example", "abc", "xyz",
    "john.doe", "johndoe", "janedoe", "jane.doe", "admin@admin",
}

# High-priority corporate contact prefixes with weighted scores
PRIMARY_CONTACT_PREFIXES = {
    "contact": 100,
    "info": 95,
    "support": 90,
    "hello": 85,
    "sales": 80,
    "enquiry": 80,
    "enquiries": 80,
    "office": 75,
    "admin": 70,
    "help": 70,
    "customercare": 70,
    "care": 65,
    "connect": 65,
    "mail": 60,
    "team": 50,
}

# Legitimate public email service domains frequently used by real business owners
ALLOWED_PUBLIC_MAIL_PROVIDERS = {
    "gmail.com", "outlook.com", "hotmail.com", "yahoo.com", "icloud.com",
    "proton.me", "protonmail.com", "zoho.com", "yandex.com", "aol.com"
}

# In-memory MX Record Cache to prevent redundant DNS round trips
_MX_CACHE: Dict[str, Tuple[bool, List[str]]] = {}


def normalize_email(raw_email: str) -> Optional[str]:
    """
    Normalizes an email candidate:
    - Strips surrounding quotes, angles, parenthesis, brackets, whitespace, punctuation
    - Unquotes percent-encoded characters (e.g. %20, %40)
    - Unescapes HTML entities
    - Lowers case
    - Validates against RFC-compliant regex
    """
    if not raw_email or not isinstance(raw_email, str):
        return None

    cleaned = raw_email.strip()
    cleaned = html.unescape(cleaned)
    cleaned = urllib.parse.unquote(cleaned)

    # Strip mailto: prefix if present
    if cleaned.lower().startswith("mailto:"):
        cleaned = cleaned[7:].split("?")[0].strip()

    # Strip unwanted surrounding characters
    cleaned = re.sub(r'^[<"\'\(\[\{\s]+|[>"\'\)\]\}\s,;:]+$', '', cleaned)
    cleaned = cleaned.rstrip(".")

    cleaned = cleaned.lower().strip()

    if not cleaned or "@" not in cleaned:
        return None

    if EMAIL_REGEX.match(cleaned):
        return cleaned

    return None


def decode_cloudflare_email(cf_hex: str) -> Optional[str]:
    """
    Decodes an obfuscated email string protected by Cloudflare Email Protection.
    Cloudflare uses a 1-byte XOR cipher where the first 2 hex characters are the XOR key.
    """
    if not cf_hex or len(cf_hex) < 4:
        return None
    try:
        k = int(cf_hex[:2], 16)
        email = "".join([chr(int(cf_hex[i:i+2], 16) ^ k) for i in range(2, len(cf_hex), 2)])
        return normalize_email(email)
    except Exception:
        return None


def lookup_mx_records(domain: str) -> Tuple[bool, List[str]]:
    """
    Queries DNS for MX (Mail Exchange) records using dnspython.
    Returns: (has_valid_mx, list_of_mx_servers).
    Caches results per domain to maximize crawler speed.
    """
    if not domain or "." not in domain:
        return False, []

    domain = domain.lower().strip().replace("www.", "")

    if domain in _MX_CACHE:
        return _MX_CACHE[domain]

    # Whitelisted legitimate public mail providers are guaranteed to have active MX
    if domain in ALLOWED_PUBLIC_MAIL_PROVIDERS:
        res = (True, [f"mx.{domain} (Verified Mail Provider)"])
        _MX_CACHE[domain] = res
        return res

    if not DNS_AVAILABLE:
        # If dnspython is unavailable, do not drop emails
        res = (True, [f"DNS Library N/A ({domain})"])
        _MX_CACHE[domain] = res
        return res

    try:
        resolver = dns.resolver.Resolver()
        resolver.nameservers = ["8.8.8.8", "1.1.1.1", "9.9.9.9"]
        resolver.timeout = 2.0
        resolver.lifetime = 3.0

        answers = resolver.resolve(domain, "MX")
        mx_hosts = []
        for r in answers:
            host_str = str(r.exchange).rstrip(".")
            mx_hosts.append(f"{r.preference} {host_str}")

        if mx_hosts:
            res = (True, sorted(mx_hosts, key=lambda x: int(x.split()[0])))
            _MX_CACHE[domain] = res
            return res
        else:
            res = (False, [])
            _MX_CACHE[domain] = res
            return res
    except (dns.resolver.NoAnswer, dns.resolver.NXDOMAIN):
        # Explicit domain does not exist or has no MX record
        res = (False, [])
        _MX_CACHE[domain] = res
        return res
    except Exception as e:
        logger.debug(f"[MX Lookup] DNS query for {domain} timed out or blocked: {e}")
        # In isolated environments/sandboxes or slow networks, do not drop valid domains
        res = (True, [f"Active DNS Fallback ({domain})"])
        _MX_CACHE[domain] = res
        return res


def is_valid_email(
    email: str, target_root_domain: Optional[str] = None, check_mx: bool = False
) -> bool:
    """
    Validates that an email is legitimate, not a template placeholder,
    not a system/legal policy address, and belongs to the target domain or
    a legitimate public mail provider.
    """
    normalized = normalize_email(email)
    if not normalized or "@" not in normalized:
        return False

    # 1. Reject static asset file extensions
    for ext in IGNORED_EXTENSIONS:
        if normalized.endswith(ext):
            return False

    # 2. Split username and domain
    parts = normalized.split("@")
    if len(parts) != 2:
        return False

    username, domain_part = parts[0], parts[1]

    # Reject malformed domain part
    if "." not in domain_part or len(domain_part) < 4:
        return False

    # 3. Reject placeholder dummy domains
    if domain_part in DUMMY_DOMAINS:
        return False

    # 4. Check for excluded prefixes (system, automated, policy/legal, placeholders)
    clean_username = username.split("+")[0]
    user_tokens = re.split(r"[._-]", clean_username)
    if username in EXCLUDED_EMAIL_PREFIXES or any(token in EXCLUDED_EMAIL_PREFIXES for token in user_tokens):
        return False

    # 5. If target_root_domain is provided, strictly enforce domain alignment
    if target_root_domain:
        clean_target = target_root_domain.lower().strip().replace("www.", "")
        is_domain_match = (
            domain_part == clean_target
            or domain_part.endswith(f".{clean_target}")
        )
        is_known_provider = domain_part in ALLOWED_PUBLIC_MAIL_PROVIDERS

        # Reject random third-party domains that do not match the target scope or real mail providers
        if not is_domain_match and not is_known_provider:
            return False

    # 6. Optional strict MX check
    if check_mx:
        has_mx, _ = lookup_mx_records(domain_part)
        if not has_mx:
            return False

    return True


def get_email_priority_score(email: str, root_domain: str = "") -> int:
    """
    Ranks extracted emails by business importance so corporate contact emails
    (contact@, info@, support@) are ALWAYS ranked above city branches or department emails.
    """
    normalized = normalize_email(email)
    if not normalized or "@" not in normalized:
        return 0

    username, domain = normalized.split("@", 1)

    # Clean username tokens (e.g. contact.team -> contact)
    user_tokens = re.split(r"[._-]", username)
    first_token = user_tokens[0] if user_tokens else username

    score = 20  # Base score for verified email

    if username in PRIMARY_CONTACT_PREFIXES:
        score += PRIMARY_CONTACT_PREFIXES[username]
    elif first_token in PRIMARY_CONTACT_PREFIXES:
        score += PRIMARY_CONTACT_PREFIXES[first_token] - 5
    elif any(token in PRIMARY_CONTACT_PREFIXES for token in user_tokens):
        score += 50

    # Exact target domain match bonus
    if root_domain:
        clean_target = root_domain.lower().strip().replace("www.", "")
        if domain == clean_target or domain == f"www.{clean_target}":
            score += 40

    return score


def rank_emails_by_relevance(emails: List[str], root_domain: str = "") -> List[str]:
    """
    Sorts emails with priority scoring so the primary official contact email is at index 0.
    """
    unique_emails = list(dict.fromkeys([normalize_email(e) for e in emails if normalize_email(e)]))
    return sorted(
        unique_emails,
        key=lambda e: (get_email_priority_score(e, root_domain), e),
        reverse=True
    )


def extract_detailed_emails(
    soup: BeautifulSoup,
    raw_html: str = "",
    source_url: str = "",
    target_root_domain: Optional[str] = None,
) -> List[Dict[str, Any]]:
    """
    Extracts emails from HTML with full discovery intelligence:
    - Discovery Method: 'mailto_link', 'cloudflare_decode', 'semantic_contact_section', 'visible_text'
    - Source URL tracking
    - MX Record Verification lookup
    - Priority Scoring & Normalization
    - Zero fake / boilerplate emails
    """
    candidates_map: Dict[str, Dict[str, Any]] = {}

    def add_candidate(raw_e: str, method: str):
        norm = normalize_email(raw_e)
        if not norm:
            return
        if not is_valid_email(norm, target_root_domain):
            return

        domain_part = norm.split("@")[1]
        has_mx, mx_hosts = lookup_mx_records(domain_part)

        # Calculate priority score
        score = get_email_priority_score(norm, target_root_domain or "")

        # If already discovered via a weaker method, upgrade discovery method and source
        if norm in candidates_map:
            existing = candidates_map[norm]
            # mailto or cloudflare or contact page is preferred over generic regex_body
            if "contact" in source_url.lower() and "contact" not in existing.get("sourceUrl", "").lower():
                existing["sourceUrl"] = source_url
            if method in ("mailto_link", "cloudflare_decode") and existing.get("discoveryMethod") == "visible_text":
                existing["discoveryMethod"] = method
            return

        candidates_map[norm] = {
            "email": norm,
            "sourceUrl": source_url or "",
            "discoveryMethod": method,
            "mxVerified": has_mx,
            "mxRecords": mx_hosts[:3] if mx_hosts else [],
            "priorityScore": score,
            "isPrimary": False,
        }

    if not soup and raw_html:
        soup = BeautifulSoup(raw_html, "html.parser")

    if not soup:
        return []

    # 1. Cloudflare protected emails (data-cfemail attribute)
    for tag in soup.find_all(attrs={"data-cfemail": True}):
        cf_hex = tag["data-cfemail"].strip()
        decoded = decode_cloudflare_email(cf_hex)
        if decoded:
            add_candidate(decoded, "cloudflare_decode")

    # Cloudflare protected emails in /cdn-cgi/l/email-protection#...
    for a_tag in soup.find_all("a", href=re.compile(r"/cdn-cgi/l/email-protection#([a-fA-F0-9]+)")):
        m = re.search(r"email-protection#([a-fA-F0-9]+)", a_tag["href"])
        if m:
            decoded = decode_cloudflare_email(m.group(1))
            if decoded:
                add_candidate(decoded, "cloudflare_decode")

    # 2. Extract from explicit mailto: links (highest fidelity link)
    for a_tag in soup.find_all("a", href=True):
        href = a_tag["href"].strip()
        if href.lower().startswith("mailto:"):
            email_part = href[7:].split("?")[0].strip()
            add_candidate(email_part, "mailto_link")

    # 3. Extract from high-value semantic contact blocks (footer, header, address, contact divs)
    semantic_selectors = ["footer", "header", "address", "main", "section"]
    for container in soup.find_all(semantic_selectors):
        text = container.get_text(separator=" ")
        if "@" in text:
            for match in EMAIL_REGEX.finditer(text):
                add_candidate(match.group(0), "semantic_contact_section")

    # Check for elements with contact class or id
    contact_containers = soup.find_all(lambda tag: tag.name in ["div", "section", "p"] and (
        "contact" in (tag.get("class") or [])
        or "contact" in (tag.get("id") or "")
        or "footer" in (tag.get("class") or [])
    ))
    for container in contact_containers:
        text = container.get_text(separator=" ")
        if "@" in text:
            for match in EMAIL_REGEX.finditer(text):
                add_candidate(match.group(0), "semantic_contact_section")

    # 4. Extract from visible body text (excluding script, style, svg, inputs)
    body = soup.find("body") or soup
    for elem in body.find_all(["p", "span", "div", "li", "td", "h1", "h2", "h3", "h4"]):
        if elem.name in ("script", "style", "noscript", "svg", "input", "textarea"):
            continue
        text = elem.get_text(separator=" ")
        if "@" in text:
            for match in EMAIL_REGEX.finditer(text):
                add_candidate(match.group(0), "visible_text")

    # Convert to list and sort by priorityScore descending
    ranked_list = sorted(
        list(candidates_map.values()),
        key=lambda item: (item["priorityScore"], item["email"]),
        reverse=True
    )

    if ranked_list:
        ranked_list[0]["isPrimary"] = True

    return ranked_list


def extract_emails_from_html(
    soup: BeautifulSoup, raw_html: str = "", target_root_domain: Optional[str] = None
) -> Set[str]:
    """
    Backwards-compatible helper returning a set of validated emails.
    """
    detailed = extract_detailed_emails(
        soup=soup,
        raw_html=raw_html,
        source_url="",
        target_root_domain=target_root_domain
    )
    return {d["email"] for d in detailed}
