import time
import logging
import datetime
from urllib.parse import urlparse
from urllib.robotparser import RobotFileParser
from typing import Dict, Set, List, Any, Optional, Tuple

import requests
from bs4 import BeautifulSoup

from crawler_engine.config import DEFAULT_CRAWLER_CONFIG
from crawler_engine.extractors.link_extractor import (
    extract_links_and_subdomains,
    normalize_url,
    extract_root_domain,
    discover_subdomains_via_osint,
    detect_country_from_domain,
)
from crawler_engine.extractors.email_extractor import (
    extract_emails_from_html,
    rank_emails_by_relevance,
    extract_detailed_emails,
    normalize_email,
    decode_cloudflare_email,
    lookup_mx_records,
    get_email_priority_score,
)
from crawler_engine.extractors.metadata_extractor import extract_page_metadata
from crawler_engine.extractors.site_classifier import classify_website_content
from crawler_engine.storage.file_storage import LocalFileStorage
from crawler_engine.storage.mongo_storage import MongoStorage
from crawler_engine.core.playwright_engine import PlaywrightCrawlerEngine

# Setup Logger
logger = logging.getLogger("TheScrapper.Crawler")
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    datefmt="%H:%M:%S",
)


class WebCrawler:
    """
    Production-ready Python Web Crawler and OSINT Scraper.
    Features:
    - BFS crawl queue with visited tracking & deduplication
    - Separation of www and non-www hostnames
    - Internal vs external link classification
    - Subdomain discovery matching target scope
    - Public visible email extraction (regex validated, no guessing)
    - Structured page metadata extraction (Title, Meta description, H1, words)
    - Resilient network handling (retries, timeouts, broken links)
    - Robots.txt compliance check
    - Playwright JS fallback for empty/hydrated pages
    - Local JSON & CSV persistence + MongoDB synchronization
    """

    def __init__(self, start_url: str, config: Optional[Dict[str, Any]] = None):
        self.config = {**DEFAULT_CRAWLER_CONFIG, **(config or {})}
        
        # Normalize and validate starting URL
        self.start_url = normalize_url(start_url)
        if not self.start_url:
            raise ValueError(f"Invalid starting URL provided: {start_url}")

        parsed_start = urlparse(self.start_url)
        self.starting_netloc = parsed_start.netloc.lower()
        self.scheme = parsed_start.scheme

        # Determine Root Domain (supports ccTLDs like .co.in, .gov.in, etc.)
        self.root_domain = extract_root_domain(self.starting_netloc)

        # Crawl tracking state
        self.visited_urls: Set[str] = set()
        self.queued_urls: Set[str] = set()
        self.all_subdomains: Set[str] = set()
        self.all_emails: Set[str] = set()
        self.all_external_links: Set[str] = set()
        self.verified_emails_map: Dict[str, Dict[str, Any]] = {}

        # Structured record lists for export and MongoDB
        self.visited_records: List[Dict[str, Any]] = []
        self.email_records: List[Dict[str, Any]] = []
        self.subdomain_records: List[Dict[str, Any]] = []
        self.external_link_records: List[Dict[str, Any]] = []
        self.metadata_records: List[Dict[str, Any]] = []
        self.portal_records: List[Dict[str, Any]] = []

        # Storage handlers
        self.file_storage = LocalFileStorage(
            self.config["output_dir"], self.starting_netloc
        )
        self.mongo_storage = MongoStorage(
            uri=self.config["mongodb_uri"],
            db_name=self.config["mongodb_db"],
            collection_name=self.config["mongodb_collection"],
        )

        # HTTP Session with default headers
        self.session = requests.Session()
        self.session.headers.update({
            "User-Agent": self.config["user_agent"],
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
            "Accept-Language": "en-US,en;q=0.9",
        })

        # Robots.txt parser
        self.robot_parser: Optional[RobotFileParser] = None
        if self.config.get("respect_robots_txt", True):
            self._init_robots_txt()

        # Playwright Crawler Engine (initialized if enabled)
        self.playwright_engine: Optional[PlaywrightCrawlerEngine] = None
        if self.config.get("use_playwright_fallback", True):
            self.playwright_engine = PlaywrightCrawlerEngine(
                headless=self.config.get("playwright_headless", True),
                timeout_ms=self.config.get("timeout", 12) * 1000,
            )

        # Website Intelligence state (Category, E-Commerce, Tech, Phones, Summary)
        self.site_intelligence = {
            "category": "Corporate & Business Services",
            "category_icon": "🌐",
            "is_ecommerce": False,
            "ecommerce_signals": [],
            "technologies": [],
            "phones": [],
            "summary": "",
        }

    def _init_robots_txt(self) -> None:
        """Fetches and parses robots.txt for the target domain."""
        robots_url = f"{self.scheme}://{self.starting_netloc}/robots.txt"
        try:
            rp = RobotFileParser()
            rp.set_url(robots_url)
            rp.read()
            self.robot_parser = rp
            logger.info(f"[Robots.txt] Successfully loaded rules from: {robots_url}")
        except Exception as e:
            logger.debug(f"[Robots.txt] Could not read robots.txt ({e}). Proceeding carefully.")
            self.robot_parser = None

    def is_allowed_by_robots(self, url: str) -> bool:
        """Checks if URL is permitted by robots.txt."""
        if not self.robot_parser:
            return True
        try:
            return self.robot_parser.can_fetch(self.config["user_agent"], url)
        except Exception:
            return True

    def fetch_page_content(self, url: str) -> Optional[Tuple[str, int, str]]:
        """
        Fetches HTML content with hybrid Playwright & requests crawler strategy.
        - Root landing page: Renders via Playwright to ensure Next.js/React SPA hydrates.
        - Sub-pages: Fast HTTP requests with automatic Playwright fallback on JS SPAs.
        Returns: (html_string, status_code, content_type) or None on failure.
        """
        # For root landing page: attempt Playwright rendering first if enabled
        if url == self.start_url and self.playwright_engine:
            try:
                logger.info(f"[PlaywrightCrawler] Rendering root landing page with headless browser: {url}")
                rendered = self.playwright_engine.render_page(url)
                if rendered and len(rendered) > 100:
                    return rendered, 200, "text/html"
            except Exception as pw_err:
                logger.warning(f"[PlaywrightCrawler] Root page render fallback to HTTP: {pw_err}")

        retries = self.config.get("retries", 2)
        timeout = self.config.get("timeout", 10)

        for attempt in range(1, retries + 2):
            try:
                response = self.session.get(
                    url,
                    timeout=timeout,
                    allow_redirects=True,
                    verify=self.session.verify,
                )
                
                # If landing page was redirected, sync starting host
                if url == self.start_url and response.url:
                    resp_netloc = urlparse(response.url).netloc.lower()
                    if resp_netloc and self.root_domain in resp_netloc:
                        self.starting_netloc = resp_netloc

                content_type = response.headers.get("Content-Type", "").lower()
                
                # Only process HTML pages
                if "text/html" not in content_type and "application/xhtml" not in content_type:
                    logger.debug(f"Skipping non-HTML resource ({content_type}): {url}")
                    return None

                html = response.text

                # Check if JavaScript fallback is needed (Next.js, React SPA, or anti-bot 403)
                is_spa_page = (
                    "__NEXT_DATA__" in html
                    or 'id="__next"' in html
                    or "/_next/static/" in html
                    or 'id="root"' in html
                    or len(html) < 600
                )
                if (is_spa_page or response.status_code in (401, 403, 429)) and self.playwright_engine:
                    logger.info(f"[Playwright Fallback] Rendering dynamic / protected page ({url}, status {response.status_code})...")
                    rendered = self.playwright_engine.render_page(url)
                    if rendered and len(rendered) > 100:
                        return rendered, 200, "text/html"

                if response.status_code >= 400 and url != self.start_url:
                    logger.debug(f"HTTP {response.status_code} received on {url}")
                    return None

                return html, response.status_code, content_type

            except requests.exceptions.Timeout:
                logger.warning(f"Timeout on {url} (Attempt {attempt}/{retries + 1})")
            except requests.exceptions.SSLError as ssl_err:
                logger.warning(f"SSL Error on {url}: {ssl_err}. Setting session SSL verification to False...")
                self.session.verify = False
                try:
                    import urllib3
                    urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)
                    insecure_resp = self.session.get(
                        url,
                        timeout=timeout,
                        allow_redirects=True,
                        verify=False,
                    )
                    ct = insecure_resp.headers.get("Content-Type", "").lower()
                    if ("text/html" in ct or "application/xhtml" in ct):
                        if insecure_resp.status_code < 400 or url == self.start_url:
                            return insecure_resp.text, insecure_resp.status_code, ct
                except Exception as inner_e:
                    logger.warning(f"Insecure SSL bypass failed on {url}: {inner_e}")
                break
            except requests.exceptions.RequestException as req_err:
                logger.warning(f"Request error on {url}: {req_err} (Attempt {attempt}/{retries + 1})")

            time.sleep(1.0)

        # Fallback to Playwright if static requests failed completely
        if self.playwright_engine:
            logger.info(f"[Playwright Fallback] Static request failed for {url}. Attempting headless browser render...")
            rendered = self.playwright_engine.render_page(url)
            if rendered and len(rendered) > 100:
                return rendered, 200, "text/html"

        return None

    def _sync_checkpoint_to_mongo(self, status: str = "CRAWLING"):
        """
        Saves early / incremental progress directly to MongoDB so the frontend
        and database immediately reflect the discovered intelligence within 2 seconds.
        """
        try:
            country_name, country_code, country_flag = detect_country_from_domain(self.root_domain)
            
            # Sort verified emails with priority scores and mark primary
            sorted_verified = sorted(
                list(self.verified_emails_map.values()),
                key=lambda x: (x.get("priorityScore", 0), x.get("email", "")),
                reverse=True
            )
            for idx, item in enumerate(sorted_verified):
                item["isPrimary"] = (idx == 0)

            ranked_emails = [item["email"] for item in sorted_verified]
            sorted_subdomains = sorted(list(self.all_subdomains))

            domain_record = {
                "id": f"domain_{self.root_domain}",
                "domain": self.root_domain,
                "rootDomain": self.root_domain,
                "subdomain": self.starting_netloc,
                "subdomains": sorted_subdomains,
                "subdomainCount": len(sorted_subdomains),
                "email": ranked_emails[0] if ranked_emails else "",
                "emails": ranked_emails,
                "verifiedEmails": sorted_verified,
                "emailCount": len(ranked_emails),
                "category": self.site_intelligence.get("category", "Corporate & Business Services"),
                "categoryIcon": self.site_intelligence.get("category_icon", "🌐"),
                "isEcommerce": self.site_intelligence.get("is_ecommerce", False),
                "ecommerceSignals": self.site_intelligence.get("ecommerce_signals", []),
                "technologies": self.site_intelligence.get("technologies", []),
                "phones": self.site_intelligence.get("phones", []),
                "summary": self.site_intelligence.get("summary", ""),
                "country": country_name,
                "countryCode": country_code,
                "countryFlag": country_flag,
                "status": status,
                "sourceUrl": self.start_url,
                "pagesCrawled": len(self.visited_records),
                "crawledPages": [
                    {
                        "url": r["url"],
                        "title": r.get("title", ""),
                        "statusCode": r.get("status_code", 200),
                        "depth": r.get("depth", 0),
                        "timestamp": r.get("timestamp"),
                    }
                    for r in self.visited_records
                ],
                "discoveredAt": datetime.datetime.now().isoformat(),
            }
            self.mongo_storage.sync_scraped_results([domain_record])
        except Exception as e:
            logger.warning(f"Failed checkpoint sync to MongoDB: {e}")

    def run(self, on_progress=None) -> Dict[str, Any]:
        """
        Executes the crawl starting from start_url using Breadth-First Search.
        Accepts optional on_progress(pages_crawled, subdomains_count, emails_count) callback.
        """
        logger.info("=" * 60)
        logger.info(f"STARTING CRAWL ON: {self.start_url}")
        logger.info(f"Target Scope Host: {self.starting_netloc} (Root: {self.root_domain})")
        logger.info(f"Max Pages: {self.config['max_pages']} | Max Depth: {self.config['max_depth']}")
        logger.info("=" * 60)

        start_time = datetime.datetime.now()

        # Phase 1: OSINT Certificate Transparency & DNS Subdomain Discovery
        logger.info(f"[Subdomain Recon] Running OSINT discovery for: {self.root_domain}")
        osint_subdomains = discover_subdomains_via_osint(self.root_domain)
        for s in osint_subdomains:
            if s not in self.all_subdomains:
                self.all_subdomains.add(s)
                self.subdomain_records.append({
                    "subdomain": s,
                    "root_domain": self.root_domain,
                    "source_url": "OSINT / Certificate Transparency & DNS",
                    "timestamp": datetime.datetime.now().isoformat(),
                })
                logger.info(f"  [+] Discovered Subdomain (OSINT): {s}")

        # Checkpoint 1: Immediate MongoDB sync with discovered OSINT subdomains within ~1.5s
        logger.info(f"[Checkpoint 1] Saving initial OSINT intelligence for {self.root_domain} to MongoDB...")
        self._sync_checkpoint_to_mongo(status="DISCOVERING")
        if on_progress:
            try:
                on_progress(0, len(self.all_subdomains), len(self.all_emails))
            except Exception:
                pass

        # Queue items format: (priority, depth, url)
        # Priority: Contact/About (100) > Candidate Probes (90) > Services (30) > Standard (10) > Noise (-50)
        def get_url_priority(target_url: str) -> int:
            path_low = urlparse(target_url).path.lower()
            if any(k in path_low for k in ["contact", "contact-us", "contactus", "reach-us", "get-in-touch"]):
                return 100
            if any(k in path_low for k in ["support", "help", "branch", "branches", "locations", "office", "enquiry", "enquiries"]):
                return 80
            if any(k in path_low for k in ["about", "about-us", "aboutus", "team", "leadership"]):
                return 60
            if any(k in path_low for k in ["service", "services", "solution", "solutions", "product", "products", "company"]):
                return 30
            if any(k in path_low for k in ["privacy", "terms", "cookie", "disclaimer", "faq", "cart", "checkout", "login", "register", "blog", "tag", "category"]):
                return -50
            return 10

        queue: List[Tuple[int, int, str]] = [(1000, 0, self.start_url)]
        self.queued_urls.add(self.start_url)

        pages_crawled = 0

        try:
            while queue and pages_crawled < self.config["max_pages"]:
                # Always pop the highest priority URL from the queue
                queue.sort(key=lambda item: item[0], reverse=True)
                prio, depth, current_url = queue.pop(0)

                # Skip if already visited
                if current_url in self.visited_urls:
                    continue

                # Check depth limit
                if depth > self.config["max_depth"]:
                    continue

                # Check robots.txt
                if not self.is_allowed_by_robots(current_url):
                    logger.info(f"[Robots.txt] Blocked: {current_url}")
                    continue

                # Mark as visited
                self.visited_urls.add(current_url)

                is_contact_target = any(k in current_url.lower() for k in ["contact", "reach-us", "get-in-touch", "support", "about", "branch"])

                # Hybrid Fetching Strategy:
                # If contact target and Playwright engine available, use dynamic DOM extraction
                html = None
                status_code = 200
                dynamic_pw_data = None

                if is_contact_target and self.playwright_engine and current_url != self.start_url:
                    logger.info(f"[PlaywrightCrawler] Dynamically rendering internal contact page: {current_url}")
                    dynamic_pw_data = self.playwright_engine.extract_dynamic_page(current_url)
                    if dynamic_pw_data and dynamic_pw_data.get("html") and dynamic_pw_data.get("status_code", 200) < 400:
                        html = dynamic_pw_data["html"]
                        status_code = dynamic_pw_data.get("status_code", 200)

                if not html:
                    fetch_result = self.fetch_page_content(current_url)
                    if not fetch_result:
                        continue
                    html, status_code, _ = fetch_result

                # Discard non-content, empty, or HTTP error responses (allow start_url to discover links)
                if not html or (status_code >= 400 and current_url != self.start_url) or len(html.strip()) < 50:
                    continue

                # Successfully fetched real content! Increment crawled pages counter
                pages_crawled += 1
                logger.info(f"[{pages_crawled}/{self.config['max_pages']}] Successfully Crawled (depth {depth}, prio {prio}): {current_url}")

                # Parse HTML with BeautifulSoup
                soup = BeautifulSoup(html, "lxml" if "lxml" in BeautifulSoup.__module__ else "html.parser")
                timestamp_now = datetime.datetime.now().isoformat()

                # 1. Extract Links & Subdomains (from DOM, tags, and raw HTML)
                internal_links, external_links, new_subdomains = extract_links_and_subdomains(
                    soup, html, current_url, self.starting_netloc
                )

                # If Playwright had extra dynamic links, merge them
                if dynamic_pw_data and dynamic_pw_data.get("links"):
                    for plink in dynamic_pw_data["links"]:
                        if plink and plink.startswith("http") and self.starting_netloc in plink:
                            internal_links.add(plink)

                # 2. Extract Detailed Emails (Normalization, Deduplication, MX Verification, Source URL)
                page_detailed_emails = extract_detailed_emails(
                    soup=soup,
                    raw_html=html,
                    source_url=current_url,
                    target_root_domain=self.root_domain
                )

                for detail in page_detailed_emails:
                    norm_e = detail["email"]
                    if norm_e not in self.verified_emails_map:
                        self.verified_emails_map[norm_e] = detail
                        self.all_emails.add(norm_e)
                        self.email_records.append({
                            "email": norm_e,
                            "source_url": detail["sourceUrl"],
                            "discovery_method": detail["discoveryMethod"],
                            "mx_verified": detail["mxVerified"],
                            "mx_records": detail["mxRecords"],
                            "domain": self.starting_netloc,
                            "timestamp": timestamp_now,
                        })
                        logger.info(f"  [+] Discovered Verified Email: {norm_e} ({detail['discoveryMethod']}, MX: {detail['mxVerified']}) via {current_url}")
                    else:
                        existing = self.verified_emails_map[norm_e]
                        if is_contact_target and not any(k in existing.get("sourceUrl", "").lower() for k in ["contact", "about", "support"]):
                            existing["sourceUrl"] = current_url
                        if detail["discoveryMethod"] in ("mailto_link", "cloudflare_decode"):
                            existing["discoveryMethod"] = detail["discoveryMethod"]

                # If Playwright found dynamic mailto or cf-protected emails, merge them
                if dynamic_pw_data:
                    for m_href in dynamic_pw_data.get("mailtos", []):
                        norm = normalize_email(m_href)
                        if norm and is_valid_email(norm, self.root_domain):
                            if norm not in self.verified_emails_map:
                                has_mx, mx_hosts = lookup_mx_records(norm.split("@")[1])
                                score = get_email_priority_score(norm, self.root_domain)
                                rec = {
                                    "email": norm,
                                    "sourceUrl": current_url,
                                    "discoveryMethod": "playwright_dom",
                                    "mxVerified": has_mx,
                                    "mxRecords": mx_hosts[:3] if mx_hosts else [],
                                    "priorityScore": score,
                                    "isPrimary": False,
                                }
                                self.verified_emails_map[norm] = rec
                                self.all_emails.add(norm)
                                self.email_records.append({
                                    "email": norm,
                                    "source_url": current_url,
                                    "discovery_method": "playwright_dom",
                                    "mx_verified": has_mx,
                                    "mx_records": mx_hosts[:3] if mx_hosts else [],
                                    "domain": self.starting_netloc,
                                    "timestamp": timestamp_now,
                                })
                                logger.info(f"  [+] Discovered Playwright DOM Email: {norm} (MX: {has_mx}) via {current_url}")

                    for cf_hex in dynamic_pw_data.get("cfProtected", []):
                        decoded = decode_cloudflare_email(cf_hex)
                        if decoded and is_valid_email(decoded, self.root_domain):
                            if decoded not in self.verified_emails_map:
                                has_mx, mx_hosts = lookup_mx_records(decoded.split("@")[1])
                                score = get_email_priority_score(decoded, self.root_domain)
                                rec = {
                                    "email": decoded,
                                    "sourceUrl": current_url,
                                    "discoveryMethod": "cloudflare_decode",
                                    "mxVerified": has_mx,
                                    "mxRecords": mx_hosts[:3] if mx_hosts else [],
                                    "priorityScore": score,
                                    "isPrimary": False,
                                }
                                self.verified_emails_map[decoded] = rec
                                self.all_emails.add(decoded)
                                self.email_records.append({
                                    "email": decoded,
                                    "source_url": current_url,
                                    "discovery_method": "cloudflare_decode",
                                    "mx_verified": has_mx,
                                    "mx_records": mx_hosts[:3] if mx_hosts else [],
                                    "domain": self.starting_netloc,
                                    "timestamp": timestamp_now,
                                })
                                logger.info(f"  [+] Discovered Cloudflare Decoded Email: {decoded} via {current_url}")

                # 3. Extract Metadata
                meta = extract_page_metadata(soup, current_url)
                self.metadata_records.append(meta)

                # 4. Classify Website Content, E-Commerce Type & Real Technologies
                if current_url == self.start_url or not self.site_intelligence.get("summary"):
                    intel = classify_website_content(soup, raw_html=html, url=current_url)
                    self.site_intelligence = intel
                    logger.info(f"  [Intelligence] Category: {intel['category_icon']} {intel['category']} (E-Commerce: {intel['is_ecommerce']})")
                    if intel["technologies"]:
                        logger.info(f"  [Tech Stack] Detected: {', '.join(intel['technologies'])}")
                    if intel["phones"]:
                        logger.info(f"  [Contact Phones] Detected: {', '.join(intel['phones'])}")
                elif is_contact_target:
                    contact_intel = classify_website_content(soup, raw_html=html, url=current_url)
                    if contact_intel.get("phones"):
                        existing_phones = self.site_intelligence.get("phones", [])
                        merged = contact_intel["phones"] + [p for p in existing_phones if p not in contact_intel["phones"]]
                        self.site_intelligence["phones"] = merged[:4]
                        logger.info(f"  [Contact Phones Updated] {', '.join(self.site_intelligence['phones'])}")

                # Track visited page record
                self.visited_records.append({
                    "url": current_url,
                    "title": meta.get("title", "") if meta else "",
                    "status_code": status_code,
                    "depth": depth,
                    "internal_links_count": len(internal_links),
                    "timestamp": timestamp_now,
                })

                # Record discovered subdomains
                for sub in new_subdomains:
                    if sub not in self.all_subdomains:
                        self.all_subdomains.add(sub)
                        self.subdomain_records.append({
                            "subdomain": sub,
                            "root_domain": self.root_domain,
                            "source_url": current_url,
                            "timestamp": timestamp_now,
                        })
                        logger.info(f"  [+] Discovered Subdomain: {sub}")

                # Record external links
                for ext in external_links:
                    if ext not in self.all_external_links:
                        self.all_external_links.add(ext)
                        self.external_link_records.append({
                            "external_url": ext,
                            "source_url": current_url,
                            "timestamp": timestamp_now,
                        })

                # Enqueue internal links for prioritized crawling
                if depth < self.config["max_depth"]:
                    for link in internal_links:
                        if link not in self.visited_urls and link not in self.queued_urls:
                            self.queued_urls.add(link)
                            prio_score = get_url_priority(link)
                            queue.append((prio_score, depth + 1, link))

                # Proactive Candidate Contact URL Injection after visiting the root page:
                # Only inject fallback paths if no contact link was discovered from internal_links
                has_contact_in_internal = any(
                    any(k in l.lower() for k in ["contact", "reach-us", "support", "about"])
                    for l in internal_links
                )
                if pages_crawled == 1 and not has_contact_in_internal:
                    contact_candidates = [
                        "/contact", "/contact-us", "/about-us", "/support"
                    ]
                    for path in contact_candidates:
                        probe_candidate = f"{self.scheme}://{self.starting_netloc}{path}"
                        if probe_candidate not in self.visited_urls and probe_candidate not in self.queued_urls:
                            self.queued_urls.add(probe_candidate)
                            queue.append((40, 1, probe_candidate))

                # Incremental Checkpoint: Sync to MongoDB so UI updates live
                if pages_crawled == 1 or new_subdomains or self.verified_emails_map or (pages_crawled % 3 == 0):
                    self._sync_checkpoint_to_mongo(status="CRAWLING")

                # Stream live progress updates to Redis/Worker if callback provided
                if on_progress:
                    try:
                        on_progress(pages_crawled, len(self.all_subdomains), len(self.all_emails))
                    except Exception:
                        pass

                # Polite delay between requests
                delay = self.config.get("delay", 0.5)
                if delay > 0 and queue:
                    time.sleep(delay)

        except KeyboardInterrupt:
            logger.info("Crawl manually interrupted by user.")
        finally:
            if self.playwright_engine:
                self.playwright_engine.stop()

        # Save to local files
        logger.info("Saving results to local JSON & CSV files...")
        self.file_storage.save_urls(self.visited_records)
        self.file_storage.save_emails(self.email_records)
        self.file_storage.save_subdomains(self.subdomain_records)
        self.file_storage.save_external_links(self.external_link_records)
        self.file_storage.save_metadata(self.metadata_records)

        # Component 5 of PDF Architecture: Save raw crawl observations to MongoDB
        logger.info("Saving raw crawl observations to MongoDB collection 'raw_crawl_data'...")
        country_name, country_code, country_flag = detect_country_from_domain(self.root_domain)
        
        # Sort verified emails with priority scores and mark primary
        sorted_verified = sorted(
            list(self.verified_emails_map.values()),
            key=lambda x: (x.get("priorityScore", 0), x.get("email", "")),
            reverse=True
        )
        for idx, item in enumerate(sorted_verified):
            item["isPrimary"] = (idx == 0)

        ranked_emails = [item["email"] for item in sorted_verified]
        sorted_subdomains = sorted(list(self.all_subdomains))

        raw_crawl_doc = {
            "crawl_id": self.config.get("job_id") or f"crawl_{int(time.time())}",
            "domain": self.root_domain,
            "starting_host": self.starting_netloc,
            "pages": [
                {
                    "url": r["url"],
                    "status_code": r.get("status_code", 200),
                    "depth": r.get("depth", 0),
                    "timestamp": r.get("timestamp"),
                }
                for r in self.visited_records
            ],
            "subdomains": sorted_subdomains,
            "subdomain_count": len(sorted_subdomains),
            "emails": ranked_emails,
            "verified_emails": sorted_verified,
            "email_count": len(ranked_emails),
            "country_signals": [country_name] if country_name != "Global" else [],
            "crawled_at": datetime.datetime.now().isoformat(),
        }
        self.mongo_storage.save_raw_crawl_data(raw_crawl_doc)

        # Sync with MongoDB / Portal (Domain Consolidated Structure)
        logger.info("Synchronizing domain consolidated data with MongoDB / Portal...")

        domain_record = {
            "id": f"domain_{self.root_domain}",
            "domain": self.root_domain,
            "rootDomain": self.root_domain,
            "subdomain": self.starting_netloc,
            "subdomains": sorted_subdomains,
            "subdomainCount": len(sorted_subdomains),
            "email": ranked_emails[0] if ranked_emails else "",
            "emails": ranked_emails,
            "verifiedEmails": sorted_verified,
            "emailCount": len(ranked_emails),
            "category": self.site_intelligence.get("category", "Corporate & Business Services"),
            "categoryIcon": self.site_intelligence.get("category_icon", "🌐"),
            "isEcommerce": self.site_intelligence.get("is_ecommerce", False),
            "ecommerceSignals": self.site_intelligence.get("ecommerce_signals", []),
            "technologies": self.site_intelligence.get("technologies", []),
            "phones": self.site_intelligence.get("phones", []),
            "summary": self.site_intelligence.get("summary", ""),
            "country": country_name,
            "countryCode": country_code,
            "countryFlag": country_flag,
            "status": "RESOLVED",
            "sourceUrl": self.start_url,
            "pagesCrawled": len(self.visited_records),
            "crawledPages": [
                {
                    "url": r["url"],
                    "title": r.get("title", ""),
                    "statusCode": r.get("status_code", 200),
                    "depth": r.get("depth", 0),
                    "timestamp": r.get("timestamp"),
                }
                for r in self.visited_records
            ],
            "discoveredAt": datetime.datetime.now().isoformat(),
        }

        self.portal_records = [domain_record]
        self.mongo_storage.sync_scraped_results(self.portal_records)

        elapsed = (datetime.datetime.now() - start_time).total_seconds()

        summary = {
            "start_url": self.start_url,
            "starting_host": self.starting_netloc,
            "root_domain": self.root_domain,
            "pages_crawled": len(self.visited_records),
            "internal_urls_queued": len(self.queued_urls),
            "subdomains_found": len(self.all_subdomains),
            "emails_found": len(self.all_emails),
            "external_links_found": len(self.all_external_links),
            "elapsed_seconds": round(elapsed, 2),
            "output_directory": str(self.file_storage.base_dir),
        }

        logger.info("=" * 60)
        logger.info("CRAWL RUN COMPLETED SUCCESSFULLY")
        logger.info(f"Pages Visited: {summary['pages_crawled']}")
        logger.info(f"Subdomains Found: {summary['subdomains_found']}")
        logger.info(f"Emails Extracted: {summary['emails_found']}")
        logger.info(f"External Links: {summary['external_links_found']}")
        logger.info(f"Elapsed Time: {summary['elapsed_seconds']}s")
        logger.info(f"Local Output Directory: {summary['output_directory']}")
        logger.info("=" * 60)

        return summary

