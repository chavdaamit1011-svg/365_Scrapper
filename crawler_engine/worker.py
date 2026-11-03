#!/usr/bin/env python3
"""
The Scrapper - Python Crawler Worker Daemon (Component 3 of PDF Architecture)
Listens to Redis Queue (the_scraper:crawl_queue), crawls target domains,
and saves raw crawl observations to MongoDB (Component 5).
"""

import sys
import os
import time
import json
import logging
import argparse
from pathlib import Path

# Setup paths
CURRENT_DIR = Path(__file__).resolve().parent
ROOT_DIR = CURRENT_DIR.parent
if str(ROOT_DIR) not in sys.path:
    sys.path.insert(0, str(ROOT_DIR))

from crawler_engine.core.crawler import WebCrawler
from crawler_engine.redis_queue import RedisQueueBridge
from crawler_engine.config import DEFAULT_CRAWLER_CONFIG

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] [Worker] %(message):s",
    datefmt="%H:%M:%S",
)
logger = logging.getLogger("TheScrapper.Worker")


def execute_job(job_data: dict, queue_bridge: RedisQueueBridge):
    job_id = job_data.get("id") or job_data.get("job_id") or f"job_{int(time.time())}"
    domain = job_data.get("domain") or job_data.get("url") or job_data.get("target")

    if not domain:
        logger.warning(f"Skipping malformed job {job_id}: No target domain specified.")
        queue_bridge.update_job_status(job_id, "failed", error="No domain provided")
        return

    domain = domain.replace("https://", "").replace("http://", "").split("/")[0].strip().lower()
    start_url = f"https://{domain}"

    max_pages = int(job_data.get("max_pages") or job_data.get("maxPages") or 15)
    max_depth = int(job_data.get("max_depth") or job_data.get("maxDepth") or 2)
    respect_robots = bool(job_data.get("respect_robots_txt", True))

    logger.info("=" * 60)
    logger.info(f"PROCESSING CRAWL JOB: {job_id}")
    logger.info(f"Target: {domain} | Max Pages: {max_pages} | Max Depth: {max_depth}")
    logger.info("=" * 60)

    # 1. Update status to running in Redis
    queue_bridge.update_job_status(job_id, "running")

    try:
        config = {
            "job_id": job_id,
            "max_pages": max_pages,
            "max_depth": max_depth,
            "respect_robots_txt": respect_robots,
            "use_playwright_fallback": True,
            "delay": 0.3,
            "timeout": 10,
        }

        # Progress callback to stream updates to Redis
        def on_crawl_progress(pages_crawled, subdomains_count, emails_count):
            queue_bridge.update_job_status(
                job_id,
                "running",
                pages_crawled=pages_crawled,
                subdomains_count=subdomains_count,
                emails_count=emails_count,
            )

        crawler = WebCrawler(start_url=start_url, config=config)
        summary = crawler.run(on_progress=on_crawl_progress)

        # 2. Mark completed in Redis
        queue_bridge.update_job_status(
            job_id,
            "completed",
            pages_crawled=summary.get("pages_crawled", 0),
            subdomains_count=summary.get("subdomains_found", 0),
            emails_count=summary.get("emails_found", 0),
        )

        logger.info(f"[+] Job {job_id} for {domain} COMPLETED successfully.")
        logger.info(f"    Subdomains: {summary.get('subdomains_found', 0)} | Emails: {summary.get('emails_found', 0)}")
    except Exception as err:
        logger.error(f"[X] Job {job_id} failed: {err}")
        queue_bridge.update_job_status(job_id, "failed", error=str(err))


def run_daemon():
    """Runs continuous worker daemon listening on Redis queue."""
    logger.info("=" * 60)
    logger.info("STARTING PYTHON CRAWLER REDIS WORKER DAEMON")
    logger.info("Listening on Redis queue: the_scraper:crawl_queue")
    logger.info("=" * 60)

    queue_bridge = RedisQueueBridge()

    while True:
        try:
            job = queue_bridge.pop_next_job(timeout=4)
            if job:
                execute_job(job, queue_bridge)
            else:
                time.sleep(0.5)
        except KeyboardInterrupt:
            logger.info("Worker daemon stopped by user.")
            break
        except Exception as e:
            logger.warning(f"Worker loop error: {e}")
            time.sleep(2)


def main():
    parser = argparse.ArgumentParser(description="The Scrapper - Redis Crawler Worker")
    parser.add_argument("--daemon", action="store_true", help="Run as standing daemon worker")
    parser.add_argument("--job-id", type=str, help="Specific job ID to process")
    parser.add_argument("--domain", type=str, help="Target domain for immediate job execution")
    parser.add_argument("--max-pages", type=int, default=15, help="Max pages limit")
    parser.add_argument("--max-depth", type=int, default=2, help="Max depth limit")

    args = parser.parse_args()
    queue_bridge = RedisQueueBridge()

    if args.daemon:
        run_daemon()
    elif args.domain:
        job = {
            "id": args.job_id or f"job_{int(time.time())}",
            "domain": args.domain,
            "max_pages": args.max_pages,
            "max_depth": args.max_depth,
        }
        execute_job(job, queue_bridge)
    else:
        # If no arguments provided, try popping one job or enter daemon mode
        job = queue_bridge.pop_next_job(timeout=2)
        if job:
            execute_job(job, queue_bridge)
        else:
            run_daemon()


if __name__ == "__main__":
    main()

