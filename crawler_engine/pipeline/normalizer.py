"""
The Scrapper - Data Cleaning & Normalization Engine (Component 4 of PDF Architecture)
Standardizes domains, subdomains, emails, URLs, and country codes before storage.
"""

import re
from urllib.parse import urlparse, urldefrag
from typing import Dict, Any, List, Optional, Tuple, Set


ISO_COUNTRY_MAP: Dict[str, Tuple[str, str, str]] = {
    "in": ("India", "IN", "🇮🇳"),
    "india": ("India", "IN", "🇮🇳"),
    "us": ("United States", "US", "🇺🇸"),
    "usa": ("United States", "US", "🇺🇸"),
    "united states": ("United States", "US", "🇺🇸"),
    "uk": ("United Kingdom", "GB", "🇬🇧"),
    "gb": ("United Kingdom", "GB", "🇬🇧"),
    "united kingdom": ("United Kingdom", "GB", "🇬🇧"),
    "ca": ("Canada", "CA", "🇨🇦"),
    "canada": ("Canada", "CA", "🇨🇦"),
    "au": ("Australia", "AU", "🇦🇺"),
    "australia": ("Australia", "AU", "🇦🇺"),
    "de": ("Germany", "DE", "🇩🇪"),
    "germany": ("Germany", "DE", "🇩🇪"),
    "fr": ("France", "FR", "🇫🇷"),
    "france": ("France", "FR", "🇫🇷"),
    "jp": ("Japan", "JP", "🇯🇵"),
    "japan": ("Japan", "JP", "🇯🇵"),
    "sg": ("Singapore", "SG", "🇸🇬"),
    "singapore": ("Singapore", "SG", "🇸🇬"),
    "ae": ("United Arab Emirates", "AE", "🇦🇪"),
    "uae": ("United Arab Emirates", "AE", "🇦🇪"),
    "sa": ("Saudi Arabia", "SA", "🇸🇦"),
    "cn": ("China", "CN", "🇨🇳"),
    "china": ("China", "CN", "🇨🇳"),
    "nl": ("Netherlands", "NL", "🇳🇱"),
    "br": ("Brazil", "BR", "🇧🇷"),
    "za": ("South Africa", "ZA", "🇿🇦"),
    "ru": ("Russia", "RU", "🇷🇺"),
    "it": ("Italy", "IT", "🇮🇹"),
    "es": ("Spain", "ES", "🇪🇸"),
    "ch": ("Switzerland", "CH", "🇨🇭"),
    "se": ("Sweden", "SE", "🇸🇪"),
}

EMAIL_REGEX = re.compile(r"^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$")


def normalize_domain(domain_str: str) -> str:
    """
    Normalizes a domain string: trim, lowercase, strip protocols, ports, and paths.
    E.g. 'HTTPS://EXAMPLE.COM:8080/path' -> 'example.com'
    """
    if not domain_str:
        return ""
    d = domain_str.strip().lower()
    if "://" in d:
        try:
            d = urlparse(d).netloc
        except Exception:
            d = d.split("://")[-1]
    d = d.split("/")[0].split("?")[0].split("#")[0]
    d = d.split(":")[0]  # strip port
    return d.strip().strip(".")


def normalize_subdomain(subdomain_str: str) -> str:
    """
    Normalizes a subdomain/hostname string: trim, lowercase, strip protocol/port.
    E.g. 'Blog.EXAMPLE.com' -> 'blog.example.com'
    """
    return normalize_domain(subdomain_str)


def normalize_email(email_str: str) -> Optional[str]:
    """
    Normalizes and validates an email string.
    Removes whitespace, lowercase, strips accidental trailing punctuation,
    and validates format against RFC standard.
    """
    if not email_str:
        return None
    e = email_str.strip().lower()
    # Strip common trailing punctuation from HTML text artifacts
    e = e.rstrip(".,;:)!?'\"")
    if not EMAIL_REGEX.match(e):
        return None
    return e


def normalize_url(url_str: str) -> str:
    """
    Applies strict canonical URL policy:
    - Lowercase scheme and host
    - Strip fragments (#...)
    - Remove standard default ports (:80 on http, :443 on https)
    - Normalize empty path to '/' and strip trailing slashes for consistency
    """
    if not url_str:
        return ""
    defragged, _ = urldefrag(url_str.strip())
    parsed = urlparse(defragged)
    if parsed.scheme not in ("http", "https"):
        return ""
    
    scheme = parsed.scheme.lower()
    netloc = parsed.netloc.lower()
    
    # Strip default ports
    if scheme == "http" and netloc.endswith(":80"):
        netloc = netloc[:-3]
    elif scheme == "https" and netloc.endswith(":443"):
        netloc = netloc[:-4]

    path = parsed.path or "/"
    if len(path) > 1 and path.endswith("/"):
        path = path[:-1]

    query = f"?{parsed.query}" if parsed.query else ""
    return f"{scheme}://{netloc}{path}{query}"


def normalize_country(country_name_or_code: str) -> Tuple[str, str, str]:
    """
    Standardizes country signals into (Country Name, ISO Code, Flag).
    Defaults to ('Global', 'INT', '🌐') if unknown.
    """
    if not country_name_or_code:
        return ("Global", "INT", "🌐")
    key = country_name_or_code.strip().lower()
    if key in ISO_COUNTRY_MAP:
        return ISO_COUNTRY_MAP[key]
    return (country_name_or_code.strip().title(), "INT", "🌐")


def normalize_crawl_payload(raw_payload: Dict[str, Any]) -> Dict[str, Any]:
    """
    Normalizes an entire crawl observation payload (Component 4)
    ensuring consistent identities across domains, subdomains, emails, and URLs.
    """
    raw_domain = raw_payload.get("domain", "") or raw_payload.get("root_domain", "")
    norm_domain = normalize_domain(raw_domain)

    # Subdomains
    raw_subs = raw_payload.get("subdomains", [])
    norm_subs: Set[str] = set()
    for s in raw_subs:
        ns = normalize_subdomain(s)
        if ns and ns != norm_domain:
            norm_subs.add(ns)

    # Emails
    raw_emails = raw_payload.get("emails", [])
    norm_emails: Set[str] = set()
    for e in raw_emails:
        ne = normalize_email(e)
        if ne:
            norm_emails.add(ne)

    # Country
    country_input = raw_payload.get("country", "")
    c_name, c_code, c_flag = normalize_country(country_input)

    # Crawled pages
    norm_pages: List[Dict[str, Any]] = []
    for p in raw_payload.get("crawledPages", []) or raw_payload.get("pages", []):
        p_url = normalize_url(p.get("url", ""))
        if p_url:
            norm_pages.append({
                "url": p_url,
                "title": (p.get("title") or "").strip(),
                "statusCode": p.get("statusCode", 200),
                "depth": p.get("depth", 0),
                "timestamp": p.get("timestamp"),
            })

    return {
        "domain": norm_domain,
        "subdomains": sorted(list(norm_subs)),
        "subdomainCount": len(norm_subs),
        "emails": sorted(list(norm_emails)),
        "emailCount": len(norm_emails),
        "country": c_name,
        "countryCode": c_code,
        "countryFlag": c_flag,
        "category": raw_payload.get("category", "Corporate & Business Services"),
        "categoryIcon": raw_payload.get("categoryIcon", "🌐"),
        "summary": (raw_payload.get("summary") or "").strip(),
        "status": raw_payload.get("status", "RESOLVED"),
        "errorCode": raw_payload.get("errorCode"),
        "errorTitle": raw_payload.get("errorTitle"),
        "pages": norm_pages,
        "pagesCrawled": len(norm_pages),
        "sourceUrl": normalize_url(raw_payload.get("sourceUrl", "")),
    }
