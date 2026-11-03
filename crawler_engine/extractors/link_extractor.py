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


def discover_subdomains_via_osint(root_domain: str, timeout: int = 8, mongo_storage=None) -> Set[str]:
    """
    Discovers publicly registered subdomains using:
    1. Dynamic MongoDB cross-reference (all targets/subdomains in DB belonging to this root domain)
    2. Certificate Transparency Logs (crt.sh direct & wildcard)
    3. Active concurrent DNS dictionary probing across standard public/state/administrative prefixes
    4. DNS host search (HackerTarget)
    Zero guessing - 100% genuine SSL/DNS records.
    """
    import socket
    from concurrent.futures import ThreadPoolExecutor

    subdomains: Set[str] = set()
    clean_root = root_domain.lower().strip()
    suffix = f".{clean_root}"
    headers = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)"}

    # 1. Dynamic MongoDB Cross-Reference (incorporates any previously discovered/crawled targets)
    if mongo_storage and hasattr(mongo_storage, "get_known_subdomains_for_domain"):
        try:
            db_subs = mongo_storage.get_known_subdomains_for_domain(clean_root)
            for s in db_subs:
                subdomains.add(s)
            if db_subs:
                logger.info(f"[Subdomain Recon] Added {len(db_subs)} subdomains from MongoDB cross-reference.")
        except Exception as e:
            logger.debug(f"MongoDB cross-ref skipped: {e}")

    # 2. Certificate Transparency Logs (crt.sh) - Direct query (fast, bypasses SQL timeout on huge ccTLDs)
    try:
        url = f"https://crt.sh/?q={clean_root}&output=json"
        res = requests.get(url, headers=headers, timeout=timeout)
        if res.status_code == 200:
            for item in res.json():
                name = item.get("name_value", "")
                for sub in name.split("\n"):
                    sub = sub.strip().lower()
                    if "*" in sub:
                        sub = sub.replace("*.", "")
                    if sub.endswith(suffix) and sub != clean_root and all(c.isalnum() or c in "-." for c in sub):
                        subdomains.add(sub)
    except Exception as e:
        logger.debug(f"crt.sh direct query skipped or error: {e}")

    # Wildcard query fallback if direct returned fewer than 20 results
    if len(subdomains) < 20:
        try:
            url_wild = f"https://crt.sh/?q=%.{clean_root}&output=json"
            res_w = requests.get(url_wild, headers=headers, timeout=min(timeout, 5))
            if res_w.status_code == 200:
                for item in res_w.json():
                    name = item.get("name_value", "")
                    for sub in name.split("\n"):
                        sub = sub.strip().lower()
                        if "*" in sub:
                            sub = sub.replace("*.", "")
                        if sub.endswith(suffix) and sub != clean_root and all(c.isalnum() or c in "-." for c in sub):
                            subdomains.add(sub)
        except Exception as e:
            logger.debug(f"crt.sh wildcard query skipped or error: {e}")

    # 3. HackerTarget Host Search
    try:
        url = f"https://api.hackertarget.com/hostsearch/?q={clean_root}"
        res = requests.get(url, headers=headers, timeout=timeout)
        if res.status_code == 200 and "error" not in res.text.lower():
            for line in res.text.splitlines():
                if "," in line:
                    host = line.split(",")[0].strip().lower()
                    if host.endswith(suffix) and host != clean_root:
                        subdomains.add(host)
    except Exception as e:
        logger.debug(f"HackerTarget query skipped or error: {e}")

    # 4. Live Concurrent DNS Dictionary Probing (Generic public/state/administrative services)
    standard_prefixes = [
        "www", "mail", "webmail", "email", "portal", "admin", "login", "auth", "sso",
        "secure", "api", "app", "dashboard", "dev", "beta", "stage", "test", "demo",
        "m", "mobile", "cdn", "static", "media", "assets", "cloud", "vpn", "remote",
        "gateway", "connect", "direct", "support", "help", "services", "service",
        "pay", "payment", "billing", "shop", "store", "cart", "status", "monitor",
        "ns1", "ns2", "dns1", "dns2", "mx1", "mx2", "ftp", "docs", "files",
        # State and regional public services
        "digital", "digitalgujarat", "gujarat", "delhi", "maharashtra", "karnataka",
        "kerala", "tamilnadu", "telangana", "andhra", "rajasthan", "up", "mp", "punjab",
        "haryana", "bihar", "odisha", "bengal", "assam", "jharkhand", "chhattisgarh",
        "india", "mygov", "uidai", "gst", "epfo", "nic", "rbi", "upsc", "ssc", "cbse",
        "irctc", "nvsp", "parivahan", "incometax", "mca", "ayush", "cowin", "digilocker"
    ]

    def _resolve_candidate(pref: str):
        cand = f"{pref}.{clean_root}"
        if cand in subdomains:
            return None
        try:
            socket.gethostbyname(cand)
            return cand
        except Exception:
            return None

    try:
        with ThreadPoolExecutor(max_workers=20) as executor:
            for r in executor.map(_resolve_candidate, standard_prefixes):
                if r:
                    subdomains.add(r)
    except Exception as e:
        logger.debug(f"DNS probe skipped or error: {e}")

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

        # Check if internal (exact host match OR www/non-www variant of target host)
        is_same_host = (
            link_host == starting_host
            or link_host.replace("www.", "") == starting_host.replace("www.", "")
        )

        if is_same_host:
            internal_links.add(normalized)
        else:
            external_links.add(normalized)
            
            # Check if this link is a subdomain of the target root domain
            if link_host.endswith(f".{root_domain}") and not is_same_host:
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
        # Clean hex prefixes from url encoding like 2fwww or 2f2f
        found_host = re.sub(r'^(?:2f)+', '', found_host)
        if (
            found_host != starting_host
            and found_host.endswith(f".{root_domain}")
            and not found_host.startswith(".")
            and all(c.isalnum() or c in "-." for c in found_host)
        ):
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
                    if norm:
                        h = urlparse(norm).netloc.lower().split(":")[0]
                        if h == starting_host or h.replace("www.", "") == starting_host.replace("www.", ""):
                            internal_links.add(norm)
        except Exception:
            pass

    return internal_links, external_links, subdomains
