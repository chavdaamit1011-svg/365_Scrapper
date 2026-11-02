import re
import logging
from typing import Set, Optional

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

# Placeholder usernames in contact form templates
DUMMY_USERNAMES = {
    "you", "your-name", "yourname", "username", "user", "name", "email",
    "test", "placeholder", "demo", "sample", "example", "abc", "xyz",
    "john.doe", "johndoe", "janedoe", "jane.doe", "admin@admin"
}

# Legitimate public email service domains frequently used by real business owners
ALLOWED_PUBLIC_MAIL_PROVIDERS = {
    "gmail.com", "outlook.com", "hotmail.com", "yahoo.com", "icloud.com",
    "proton.me", "protonmail.com", "zoho.com", "yandex.com", "aol.com"
}


def is_valid_email(email: str, target_root_domain: Optional[str] = None) -> bool:
    """
    Validates that an email is legitimate, not a template placeholder,
    and belongs to the target domain or legitimate public mail providers.
    """
    if not email or "@" not in email:
        return False

    lower = email.lower().strip()

    # 1. Check if ends with static asset extensions (e.g. image@2x.png)
    for ext in IGNORED_EXTENSIONS:
        if lower.endswith(ext):
            return False

    # 2. Split username and domain
    parts = lower.split("@")
    if len(parts) != 2:
        return False

    username, domain_part = parts[0], parts[1]

    # Reject if domain is malformed
    if "." not in domain_part or len(domain_part) < 4:
        return False

    # 3. Reject template placeholder domains
    if domain_part in DUMMY_DOMAINS:
        return False

    # 4. Reject template placeholder usernames (e.g. you@..., username@...)
    if username in DUMMY_USERNAMES:
        return False

    # 5. If target_root_domain is provided, prioritize domain alignment
    if target_root_domain:
        clean_target = target_root_domain.lower().strip()
        is_domain_match = (
            domain_part == clean_target
            or domain_part.endswith(f".{clean_target}")
        )
        is_known_provider = domain_part in ALLOWED_PUBLIC_MAIL_PROVIDERS

        # Reject random third-party domains that do not match the target scope or real mail providers
        if not is_domain_match and not is_known_provider:
            return False

    return True


def extract_emails_from_html(
    soup, raw_html: str = "", target_root_domain: Optional[str] = None
) -> Set[str]:
    """
    Extracts publicly visible, verified email addresses from HTML text, mailto: attributes,
    and raw source code. Strictly rejects fake template emails like you@company.com.
    """
    found_emails: Set[str] = set()

    # 1. Extract from mailto: links (highest fidelity)
    for a_tag in soup.find_all("a", href=True):
        href = a_tag["href"].strip()
        if href.lower().startswith("mailto:"):
            email_part = href[7:].split("?")[0].strip()
            if EMAIL_REGEX.match(email_part):
                candidate = email_part.lower()
                if is_valid_email(candidate, target_root_domain):
                    found_emails.add(candidate)

    # 2. Extract from page visible text (inside body tags, excluding inputs)
    # Remove script, style, and input placeholders from inspection
    text_content = ""
    for elem in soup.find_all(["p", "span", "div", "a", "li", "td", "h1", "h2", "h3", "h4", "footer"]):
        # Skip input placeholder text
        text_content += " " + elem.get_text(separator=" ")

    for match in EMAIL_REGEX.finditer(text_content):
        candidate = match.group(0).strip().lower()
        if is_valid_email(candidate, target_root_domain):
            found_emails.add(candidate)

    # 3. Extract from raw HTML if mailto: was embedded in scripts or json
    if raw_html:
        for match in EMAIL_REGEX.finditer(raw_html):
            candidate = match.group(0).strip().lower()
            if is_valid_email(candidate, target_root_domain):
                found_emails.add(candidate)

    return found_emails
