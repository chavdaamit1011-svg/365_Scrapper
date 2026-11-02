#!/usr/bin/env python3
"""
The Scrapper - Autonomous Python Web Crawler CLI Runner
Usage:
    python run_crawler.py https://example.com
    python run_crawler.py https://target.org --max-pages 50 --max-depth 3 --delay 0.8
"""

import sys
import argparse
from pathlib import Path

# Add project root to sys.path so crawler_engine can be imported cleanly
CURRENT_DIR = Path(__file__).resolve().parent
ROOT_DIR = CURRENT_DIR.parent
if str(ROOT_DIR) not in sys.path:
    sys.path.insert(0, str(ROOT_DIR))

from crawler_engine.core.crawler import WebCrawler
from crawler_engine.config import DEFAULT_CRAWLER_CONFIG


def main():
    parser = argparse.ArgumentParser(
        description="The Scrapper - Web Crawler & OSINT Intelligence Extractor"
    )

    parser.add_argument(
        "url",
        nargs="?",
        help="Target website URL or domain (e.g., https://example.com or example.com)",
    )
    parser.add_argument(
        "--url",
        dest="flag_url",
        help="Target website URL (alternative to positional argument)",
    )
    parser.add_argument(
        "--max-pages",
        type=int,
        default=DEFAULT_CRAWLER_CONFIG["max_pages"],
        help=f"Maximum pages to crawl (default: {DEFAULT_CRAWLER_CONFIG['max_pages']})",
    )
    parser.add_argument(
        "--max-depth",
        type=int,
        default=DEFAULT_CRAWLER_CONFIG["max_depth"],
        help=f"Maximum crawl link depth (default: {DEFAULT_CRAWLER_CONFIG['max_depth']})",
    )
    parser.add_argument(
        "--delay",
        type=float,
        default=DEFAULT_CRAWLER_CONFIG["delay"],
        help=f"Request delay in seconds (default: {DEFAULT_CRAWLER_CONFIG['delay']})",
    )
    parser.add_argument(
        "--timeout",
        type=int,
        default=DEFAULT_CRAWLER_CONFIG["timeout"],
        help=f"Request timeout in seconds (default: {DEFAULT_CRAWLER_CONFIG['timeout']})",
    )
    parser.add_argument(
        "--retries",
        type=int,
        default=DEFAULT_CRAWLER_CONFIG["retries"],
        help=f"Request retries on failure (default: {DEFAULT_CRAWLER_CONFIG['retries']})",
    )
    parser.add_argument(
        "--ignore-robots",
        action="store_true",
        help="Ignore robots.txt restrictions (default: False)",
    )
    parser.add_argument(
        "--playwright",
        action="store_true",
        help="Enable Playwright headless browser fallback for JS-heavy pages",
    )
    parser.add_argument(
        "--mongo-uri",
        default=DEFAULT_CRAWLER_CONFIG["mongodb_uri"],
        help="MongoDB connection URI (default: mongodb://127.0.0.1:27017/the_scraper)",
    )

    args = parser.parse_args()

    target_url = args.url or args.flag_url

    if not target_url:
        print("\n[!] Error: Please provide a target URL to crawl.")
        print("Example: python run_crawler.py https://example.com\n")
        sys.exit(1)

    # Auto prepend https:// if missing
    if not target_url.startswith(("http://", "https://")):
        target_url = f"https://{target_url}"

    config_override = {
        "max_pages": args.max_pages,
        "max_depth": args.max_depth,
        "delay": args.delay,
        "timeout": args.timeout,
        "retries": args.retries,
        "respect_robots_txt": not args.ignore_robots,
        "use_playwright_fallback": args.playwright,
        "mongodb_uri": args.mongo_uri,
    }

    try:
        crawler = WebCrawler(start_url=target_url, config=config_override)
        summary = crawler.run()
        print("\n[+] Crawl finished. Local files saved to:")
        print(f"    {summary['output_directory']}")
    except Exception as err:
        print(f"\n[X] Crawl execution failed: {err}")
        sys.exit(1)


if __name__ == "__main__":
    main()

