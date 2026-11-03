import re
import logging
from typing import Set, List, Optional
from bs4 import BeautifulSoup

logger = logging.getLogger("TheScrapper.EmailExtractor")

# Strict email regex
EMAIL_REGEX = re.compile(
    r"\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b"
)

# File extensions that cause false positives (e.g. image@2x.png)
IGNORED_EXTENSIONS = {
    ".png", ".jpg", ".jpeg", ".gif", ".svg", ".webp", ".bmp", ".ico",
    ".css", ".js", ".map", ".woff", ".woff2", ".ttf", ".eot",
    ".mp3", ".mp4", ".avi", ".pdf", ".zip"
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


def is_valid_email(email: str, target_root_domain: Optional[str] = None) -> bool:
    """
    Validates that an email is legitimate, not a template placeholder,
    not a system/legal policy address, and belongs to the target domain or
    a legitimate public mail provider.
    """
    if not email or "@" not in email:
        return False

    lower = email.lower().strip()

    # 1. Reject static asset file extensions
    for ext in IGNORED_EXTENSIONS:
        if lower.endswith(ext):
            return False

    # 2. Split username and domain
    parts = lower.split("@")
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

    return True


def get_email_priority_score(email: str, root_domain: str = "") -> int:
    """
    Ranks extracted emails by business importance so corporate contact emails
    (contact@, info@, support@) are ALWAYS ranked above city branches or department emails.
    """
    if not email or "@" not in email:
        return 0

    lower = email.lower().strip()
    username, domain = lower.split("@", 1)

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
    unique_emails = list(dict.fromkeys(emails))
    return sorted(
        unique_emails,
        key=lambda e: (get_email_priority_score(e, root_domain), e),
        reverse=True
    )


def extract_emails_from_html(
    soup: BeautifulSoup, raw_html: str = "", target_root_domain: Optional[str] = None
) -> Set[str]:
    """
    Extracts publicly visible, verified email addresses from HTML text and mailto: attributes.
    Excludes scripts, style blocks, hidden inputs, and system/legal boilerplates.
    """
    found_emails: Set[str] = set()

    if not soup:
        return found_emails

    # 1. Extract from explicit mailto: links (highest fidelity)
    for a_tag in soup.find_all("a", href=True):
        href = a_tag["href"].strip()
        if href.lower().startswith("mailto:"):
            email_part = href[7:].split("?")[0].strip()
            if EMAIL_REGEX.match(email_part):
                candidate = email_part.lower()
                if is_valid_email(candidate, target_root_domain):
                    found_emails.add(candidate)

    # 2. Extract from page visible text with non-content elements stripped
    # Clone or clean soup by removing scripts, styles, noscript, svg, inputs
    try:
        # Extract from high-value semantic tags first (footer, header, address, nav)
        semantic_containers = soup.find_all(["footer", "header", "address", "main", "section"])
        for container in semantic_containers:
            container_text = container.get_text(separator=" ")
            for match in EMAIL_REGEX.finditer(container_text):
                candidate = match.group(0).strip().lower()
                if is_valid_email(candidate, target_root_domain):
                    found_emails.add(candidate)

        # General body text extraction
        body = soup.find("body") or soup
        # Collect text from readable elements
        for elem in body.find_all(["p", "span", "div", "li", "td", "h1", "h2", "h3", "h4"]):
            # Ignore script, style, and input elements
            if elem.name in ("script", "style", "noscript", "svg", "input", "textarea"):
                continue
            text = elem.get_text(separator=" ")
            if "@" in text:
                for match in EMAIL_REGEX.finditer(text):
                    candidate = match.group(0).strip().lower()
                    if is_valid_email(candidate, target_root_domain):
                        found_emails.add(candidate)
    except Exception as e:
        logger.warning(f"Error parsing visible text for emails: {e}")

    return found_emails
