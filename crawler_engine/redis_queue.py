"""
The Scrapper - Python Redis Queue Bridge (Component 2 of PDF Architecture)
Connects to Redis Queue (the_scraper:crawl_queue) with automatic local fallback.
"""

import os
import json
import logging
from typing import Optional, Dict, Any

logger = logging.getLogger("TheScrapper.RedisQueue")

REDIS_URL = os.getenv("REDIS_URL", "redis://127.0.0.1:6379/0")
FALLBACK_FILE = os.path.abspath(
    os.path.join(os.path.dirname(__file__), "..", ".screpper-redis-queue.json")
)


class RedisQueueBridge:
    def __init__(self, redis_url: str = REDIS_URL):
        self.redis_url = redis_url
        self.client = None
        self.is_connected = False
        self._init_redis()

    def _init_redis(self):
        try:
            import redis
            client = redis.Redis.from_url(
                self.redis_url,
                socket_connect_timeout=2,
                socket_timeout=3,
                decode_responses=True,
            )
            client.ping()
            self.client = client
            self.is_connected = True
            logger.info(f"[RedisQueue] Successfully connected to Redis at {self.redis_url}")
        except Exception as e:
            self.is_connected = False
            logger.debug(f"[RedisQueue] Redis server not detected ({e}). Using file fallback.")

    def update_job_status(
        self,
        job_id: str,
        status: str,
        pages_crawled: Optional[int] = None,
        subdomains_count: Optional[int] = None,
        emails_count: Optional[int] = None,
        error: Optional[str] = None,
    ):
        """Updates job status in Redis and local sync file."""
        import datetime
        now = datetime.datetime.now().isoformat()

        # 1. Update in Redis if connected
        if self.is_connected and self.client:
            try:
                updates = {"status": status, "updated_at": now}
                if status == "running":
                    updates["started_at"] = now
                elif status in ("completed", "failed"):
                    updates["completed_at"] = now
                if pages_crawled is not None:
                    updates["pages_crawled"] = str(pages_crawled)
                if subdomains_count is not None:
                    updates["subdomains_count"] = str(subdomains_count)
                if emails_count is not None:
                    updates["emails_count"] = str(emails_count)
                if error:
                    updates["error"] = str(error)

                self.client.hset(f"the_scraper:jobs:{job_id}", mapping=updates)
            except Exception as e:
                logger.debug(f"[RedisQueue] Failed to update Redis hash ({e})")

        # 2. Always sync with fallback file for zero-dependency local reliability
        try:
            if os.path.exists(FALLBACK_FILE):
                with open(FALLBACK_FILE, "r", encoding="utf-8") as f:
                    data = json.load(f)
            else:
                data = {"jobs": [], "queue": []}

            jobs = data.get("jobs", [])
            matched = False
            for j in jobs:
                if j.get("id") == job_id:
                    j["status"] = status
                    j["updatedAt"] = now
                    if status == "running" and not j.get("startedAt"):
                        j["startedAt"] = now
                    elif status in ("completed", "failed") and not j.get("completedAt"):
                        j["completedAt"] = now
                    if pages_crawled is not None:
                        j["pagesCrawled"] = pages_crawled
                    if subdomains_count is not None:
                        j["subdomainsCount"] = subdomains_count
                    if emails_count is not None:
                        j["emailsCount"] = emails_count
                    if error:
                        j["error"] = str(error)
                    matched = True
                    break

            if not matched:
                jobs.append({
                    "id": job_id,
                    "status": status,
                    "createdAt": now,
                    "updatedAt": now,
                    "pagesCrawled": pages_crawled,
                    "subdomainsCount": subdomains_count,
                    "emailsCount": emails_count,
                    "error": error,
                })

            data["jobs"] = jobs
            data["updatedAt"] = now
            with open(FALLBACK_FILE, "w", encoding="utf-8") as f:
                json.dump(data, f, indent=2)
        except Exception as fe:
            logger.debug(f"[RedisQueue] Fallback file update error: {fe}")

    def pop_next_job(self, timeout: int = 5) -> Optional[Dict[str, Any]]:
        """Pops the next crawl job from the Redis queue list (the_scraper:crawl_queue)."""
        if self.is_connected and self.client:
            try:
                item = self.client.blpop("the_scraper:crawl_queue", timeout=timeout)
                if item and len(item) == 2:
                    return json.loads(item[1])
            except Exception as e:
                logger.debug(f"[RedisQueue] blpop error: {e}")

        # Fallback file check
        try:
            if os.path.exists(FALLBACK_FILE):
                with open(FALLBACK_FILE, "r", encoding="utf-8") as f:
                    data = json.load(f)
                queue = data.get("queue", [])
                if queue:
                    job_id = queue.pop(0)
                    data["queue"] = queue
                    with open(FALLBACK_FILE, "w", encoding="utf-8") as f:
                        json.dump(data, f, indent=2)

                    jobs = data.get("jobs", [])
                    for j in jobs:
                        if j.get("id") == job_id:
                            return j
        except Exception:
            pass

        return None

