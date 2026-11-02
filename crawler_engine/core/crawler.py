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
from crawler_engine.extractors.email_extractor import extract_emails_from_html
from crawler_engine.extractors.metadata_extractor import extract_page_metadata
from crawler_engine.storage.file_storage import LocalFileStorage
from crawler_engine.storage.mongo_storage import MongoStorage
from crawler_engine.core.playwright_engine import PlaywrightFallbackEngine

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

        # Playwright fallback engine (initialized only if requested/needed)
        self.playwright_engine: Optional[PlaywrightFallbackEngine] = None
        if self.config.get("use_playwright_fallback", False):
            self.playwright_engine = PlaywrightFallbackEngine(
                headless=self.config.get("playwright_headless", True),
                timeout_ms=self.config.get("timeout", 10) * 1000,
            )

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
        Fetches HTML content with retries and timeout.
        If content is empty or JS-rendered, attempts Playwright fallback.
        Returns: (html_string, status_code, content_type) or None on failure.
        """
        retries = self.config.get("retries", 2)
        timeout = self.config.get("timeout", 10)

        for attempt in range(1, retries + 2):
            try:
                response = self.session.get(
                    url,
                    timeout=timeout,
                    allow_redirects=True,
                    verify=True,
                )
                
                content_type = response.headers.get("Content-Type", "").lower()
                
                # Only process HTML pages
                if "text/html" not in content_type and "application/xhtml" not in content_type:
                    logger.debug(f"Skipping non-HTML resource ({content_type}): {url}")
                    return None

                html = response.text

                # Check if JavaScript fallback is needed (Next.js, React SPA, or minimal initial HTML)
                is_spa_page = (
                    "__NEXT_DATA__" in html
                    or 'id="__next"' in html
                    or "/_next/static/" in html
                    or 'id="root"' in html
                    or len(html) < 600
                )
                if is_spa_page and self.playwright_engine:
                    logger.info(f"[Playwright Fallback] Dynamic SPA / Next.js detected ({url}). Rendering with headless browser...")
                    rendered = self.playwright_engine.render_page(url)
                    if rendered and len(rendered) > 100:
                        html = rendered

                return html, response.status_code, content_type

            except requests.exceptions.Timeout:
                logger.warning(f"Timeout on {url} (Attempt {attempt}/{retries + 1})")
            except requests.exceptions.SSLError as ssl_err:
                logger.warning(f"SSL Error on {url}: {ssl_err}. Retrying with SSL verification bypassed...")
                try:
                    import urllib3
                    urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)
                    insecure_resp = requests.get(
                        url,
                        timeout=timeout,
                        allow_redirects=True,
                        verify=False,
                        headers=self.session.headers,
                    )
                    ct = insecure_resp.headers.get("Content-Type", "").lower()
                    if "text/html" in ct or "application/xhtml" in ct:
                        return insecure_resp.text, insecure_resp.status_code, ct
                except Exception as inner_e:
                    logger.warning(f"Insecure SSL bypass failed on {url}: {inner_e}")
                break
            except requests.exceptions.RequestException as req_err:
                logger.warning(f"Request error on {url}: {req_err} (Attempt {attempt}/{retries + 1})")

            time.sleep(1.0)

        return None

    def run(self) -> Dict[str, Any]:
        """
        Executes the crawl starting from start_url using Breadth-First Search.
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

        # Queue items format: (url, current_depth)
        queue: List[Tuple[str, int]] = [(self.start_url, 0)]
        self.queued_urls.add(self.start_url)

        pages_crawled = 0

        try:
            while queue and pages_crawled < self.config["max_pages"]:
                current_url, depth = queue.pop(0)

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
                pages_crawled += 1

                logger.info(f"[{pages_crawled}/{self.config['max_pages']}] Crawling (depth {depth}): {current_url}")

                # Fetch page
                fetch_result = self.fetch_page_content(current_url)
                if not fetch_result:
                    continue

                html, status_code, _ = fetch_result

                # Parse HTML with BeautifulSoup
                soup = BeautifulSoup(html, "lxml" if "lxml" in BeautifulSoup.__module__ else "html.parser")

                timestamp_now = datetime.datetime.now().isoformat()

                # 1. Extract Links & Subdomains (from DOM, tags, and raw HTML)
                internal_links, external_links, new_subdomains = extract_links_and_subdomains(
                    soup, html, current_url, self.starting_netloc
                )

                # 2. Extract Visible Emails (strictly filtered against dummy templates and aligned to target)
                emails = extract_emails_from_html(soup, html, target_root_domain=self.root_domain)

                # 3. Extract Metadata
                meta = extract_page_metadata(soup, current_url)
                self.metadata_records.append(meta)

                # Track visited page record
                self.visited_records.append({
                    "url": current_url,
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

                # Record discovered emails
                for email in emails:
                    if email not in self.all_emails:
                        self.all_emails.add(email)
                        self.email_records.append({
                            "email": email,
                            "source_url": current_url,
                            "domain": self.starting_netloc,
                            "timestamp": timestamp_now,
                        })
                        logger.info(f"  [+] Discovered Email: {email}")

                # Record external links
                for ext in external_links:
                    if ext not in self.all_external_links:
                        self.all_external_links.add(ext)
                        self.external_link_records.append({
                            "external_url": ext,
                            "source_url": current_url,
                            "timestamp": timestamp_now,
                        })

                # Enqueue internal links for BFS crawling
                if depth < self.config["max_depth"]:
                    for link in internal_links:
                        if link not in self.visited_urls and link not in self.queued_urls:
                            self.queued_urls.add(link)
                            queue.append((link, depth + 1))

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

        # Sync with MongoDB / Portal (Domain Consolidated Structure)
        logger.info("Synchronizing domain consolidated data with MongoDB / Portal...")

        country_name, country_code, country_flag = detect_country_from_domain(self.root_domain)
        sorted_emails = sorted(list(self.all_emails))
        sorted_subdomains = sorted(list(self.all_subdomains))

        domain_record = {
            "id": f"domain_{self.root_domain}",
            "domain": self.root_domain,
            "rootDomain": self.root_domain,
            "subdomain": self.starting_netloc,
            "subdomains": sorted_subdomains,
            "subdomainCount": len(sorted_subdomains),
            "email": sorted_emails[0] if sorted_emails else "",
            "emails": sorted_emails,
            "emailCount": len(sorted_emails),
            "country": country_name,
            "countryCode": country_code,
            "countryFlag": country_flag,
            "status": "RESOLVED",
            "sourceUrl": self.start_url,
            "pagesCrawled": len(self.visited_records),
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

