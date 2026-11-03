import re
import logging
from urllib.parse import urlparse, urljoin, urldefrag
from typing import Dict, Set, Tuple
import requests

logger = logging.getLogger("TheScrapper.LinkExtractor")


def normalize_url(url: str) -> str:
    """Removes fragments and normalizes URL path."""
    if not url:
        return ""
    defragged, _ = urldefrag(url.strip())
    parsed = urlparse(defragged)
    
    # Only keep http and https
    if parsed.scheme not in ("http", "https"):
        return ""
    
    # Clean trailing slash for consistency (except root /)
    path = parsed.path
    if len(path) > 1 and path.endswith("/"):
        path = path[:-1]
        
    return f"{parsed.scheme}://{parsed.netloc}{path}" + (f"?{parsed.query}" if parsed.query else "")


def extract_root_domain(netloc: str) -> str:
    """Extracts base root domain, accurately supporting 2-part ccTLDs (.co.in, .gov.in, etc.)."""
    host = netloc.lower().split(":")[0].strip()
    parts = host.split(".")
    cctlds = {"co.in", "gov.in", "ac.in", "edu.in", "org.in", "net.in", "co.uk", "org.uk", "com.au", "net.au"}
    if len(parts) >= 3 and f"{parts[-2]}.{parts[-1]}" in cctlds:
        return ".".join(parts[-3:])
    return ".".join(parts[-2:]) if len(parts) >= 2 else host


TLD_COUNTRY_MAP = {
    "in": ("India", "IN", "🇮🇳"),
    "co.in": ("India", "IN", "🇮🇳"),
    "gov.in": ("India", "IN", "🇮🇳"),
    "us": ("United States", "US", "🇺🇸"),
    "uk": ("United Kingdom", "GB", "🇬🇧"),
    "co.uk": ("United Kingdom", "GB", "🇬🇧"),
    "ca": ("Canada", "CA", "🇨🇦"),
    "au": ("Australia", "AU", "🇦🇺"),
    "com.au": ("Australia", "AU", "🇦🇺"),
    "de": ("Germany", "DE", "🇩🇪"),
    "fr": ("France", "FR", "🇫🇷"),
    "jp": ("Japan", "JP", "🇯🇵"),
    "sg": ("Singapore", "SG", "🇸🇬"),
    "ae": ("United Arab Emirates", "AE", "🇦🇪"),
    "sa": ("Saudi Arabia", "SA", "🇸🇦"),
    "cn": ("China", "CN", "🇨🇳"),
    "nl": ("Netherlands", "NL", "🇳🇱"),
    "br": ("Brazil", "BR", "🇧🇷"),
    "za": ("South Africa", "ZA", "🇿🇦"),
    "ru": ("Russia", "RU", "🇷🇺"),
    "it": ("Italy", "IT", "🇮🇹"),
    "es": ("Spain", "ES", "🇪🇸"),
    "ch": ("Switzerland", "CH", "🇨🇭"),
    "se": ("Sweden", "SE", "🇸🇪"),
}


def detect_country_from_domain(domain: str) -> Tuple[str, str, str]:
    """Detects country name, country code, and flag from domain TLD."""
    parts = domain.lower().split(".")
    if len(parts) >= 2:
        two_part = f"{parts[-2]}.{parts[-1]}"
        if two_part in TLD_COUNTRY_MAP:
            return TLD_COUNTRY_MAP[two_part]
        tld = parts[-1]
        if tld in TLD_COUNTRY_MAP:
            return TLD_COUNTRY_MAP[tld]
    return ("Global", "INT", "🌐")


def discover_subdomains_via_osint(root_domain: str, timeout: int = 8) -> Set[str]:
    """
    Discovers publicly registered subdomains using Certificate Transparency (crt.sh)
    and DNS host search (HackerTarget). Zero guessing - 100% genuine SSL/DNS records.
    """
    subdomains: Set[str] = set()
    headers = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)"}

    # 1. Certificate Transparency Logs (crt.sh)
    try:
        url = f"https://crt.sh/?q=%.{root_domain}&output=json"
        res = requests.get(url, headers=headers, timeout=timeout)
        if res.status_code == 200:
            for item in res.json():
                name = item.get("name_value", "")
                for sub in name.split("\n"):
                    sub = sub.strip().lower()
                    if "*" in sub:
                        sub = sub.replace("*.", "")
                    if sub.endswith(f".{root_domain}") and sub != root_domain:
                        subdomains.add(sub)
    except Exception as e:
        logger.debug(f"crt.sh query skipped or error: {e}")

    # 2. HackerTarget Host Search
    try:
        url = f"https://api.hackertarget.com/hostsearch/?q={root_domain}"
        res = requests.get(url, headers=headers, timeout=timeout)
        if res.status_code == 200 and "error" not in res.text.lower():
            for line in res.text.splitlines():
                if "," in line:
                    host = line.split(",")[0].strip().lower()
                    if host.endswith(f".{root_domain}") and host != root_domain:
                        subdomains.add(host)
    except Exception as e:
        logger.debug(f"HackerTarget query skipped or error: {e}")

    return subdomains


def extract_links_and_subdomains(
    soup, raw_html: str, base_url: str, starting_netloc: str
) -> Tuple[Set[str], Set[str], Set[str]]:
    """
    Extracts internal links, external links, and discovered subdomains from HTML soup
    as well as raw HTML scripts and attributes.
    Preserves www and non-www separation.
    """
    internal_links: Set[str] = set()
    external_links: Set[str] = set()
    subdomains: Set[str] = set()

    starting_host = starting_netloc.lower().split(":")[0]
    root_domain = extract_root_domain(starting_host)

    # 1. Examine all anchor tags
    for a_tag in soup.find_all("a", href=True):
        href = a_tag["href"].strip()
        if not href or href.startswith(("javascript:", "mailto:", "tel:", "#", "data:")):
            continue

        absolute_url = urljoin(base_url, href)
        normalized = normalize_url(absolute_url)
        if not normalized:
            continue

        parsed = urlparse(normalized)
        link_host = parsed.netloc.lower().split(":")[0]

        # Check if internal (exact host match)
        if link_host == starting_host:
            internal_links.add(normalized)
        else:
            external_links.add(normalized)
            
            # Check if this link is a subdomain of the target root domain
            if link_host.endswith(f".{root_domain}") and link_host != starting_host:
                subdomains.add(link_host)

    # 2. Examine script sources, iframes, links
    for tag_name, attr in [("script", "src"), ("iframe", "src"), ("link", "href")]:
        for tag in soup.find_all(tag_name, attrs={attr: True}):
            val = tag[attr].strip()
            if not val or val.startswith(("data:", "javascript:")):
                continue
            abs_url = urljoin(base_url, val)
            norm = normalize_url(abs_url)
            if norm:
                p = urlparse(norm)
                h = p.netloc.lower().split(":")[0]
                if h.endswith(f".{root_domain}") and h != starting_host:
                    subdomains.add(h)

    # 3. Discover subdomains mentioned anywhere in raw HTML content
    subdomain_pattern = re.compile(
        rf"\b[a-zA-Z0-9][-a-zA-Z0-9._]*\.{re.escape(root_domain)}\b",
        re.IGNORECASE,
    )
    for match in subdomain_pattern.finditer(raw_html or soup.get_text()):
        found_host = match.group(0).lower().strip().rstrip(".")
        if found_host != starting_host and found_host.endswith(f".{root_domain}"):
            subdomains.add(found_host)

    # 4. Extract Next.js / SPA internal routes from JSON state (__NEXT_DATA__)
    for next_script in soup.find_all("script", id="__NEXT_DATA__"):
        try:
            raw_text = next_script.string or ""
            path_matches = re.findall(r'"(/[a-zA-Z0-9_\-\/]+)"', raw_text)
            for p in path_matches:
                if not any(p.endswith(ext) for ext in (".js", ".css", ".png", ".jpg", ".svg", ".json", ".ico")):
                    cand_url = urljoin(base_url, p)
                    norm = normalize_url(cand_url)
                    if norm and urlparse(norm).netloc.lower().split(":")[0] == starting_host:
                        internal_links.add(norm)
        except Exception:
            pass

    return internal_links, external_links, subdomains
