import logging
from typing import List, Dict, Any

logger = logging.getLogger("TheScrapper.MongoStorage")

try:
    from pymongo import MongoClient
    from pymongo.errors import PyMongoError
    PYMONGO_AVAILABLE = True
except ImportError:
    PYMONGO_AVAILABLE = False


class MongoStorage:
    """
    Saves and synchronizes scraped results strictly into MongoDB database `the_scraper`,
    collection `scraped_results`.
    """

    def __init__(self, uri: str = "mongodb://127.0.0.1:27017/the_scraper", db_name: str = "the_scraper", collection_name: str = "scraped_results"):
        self.uri = uri
        self.db_name = db_name
        self.collection_name = collection_name
        self.client = None
        self.db = None
        self.collection = None
        self.is_connected = False

        if PYMONGO_AVAILABLE:
            try:
                self.client = MongoClient(self.uri, serverSelectionTimeoutMS=2000)
                # Quick ping to verify active connection
                self.client.admin.command('ping')
                self.db = self.client[self.db_name]
                self.collection = self.db[self.collection_name]
                self.is_connected = True
                logger.info(f"[MongoDB] Successfully connected to database '{self.db_name}', collection '{self.collection_name}'")
            except Exception as e:
                self.is_connected = False
                logger.error(f"[MongoDB] Could not connect to MongoDB at {self.uri}: {e}")
        else:
            logger.error("[MongoDB] pymongo is not installed. Please install pymongo to enable MongoDB storage.")

    def sync_scraped_results(self, records: List[Dict[str, Any]]) -> int:
        """
        Inserts or upserts structured scraped records directly into MongoDB.
        No root JSON fallback files are created.
        """
        if not records:
            return 0

        if not self.is_connected or self.collection is None:
            logger.warning("[MongoDB] Skipping MongoDB sync because connection is not active.")
            return 0

        inserted_count = 0
        try:
            import datetime
            now_iso = datetime.datetime.utcnow().isoformat()
            for r in records:
                record_id = r.get("id") or f"domain_{r.get('domain', '')}"
                r_copy = dict(r)
                r_copy["updatedAt"] = now_iso
                created_at = r_copy.pop("createdAt", now_iso)
                
                self.collection.update_one(
                    {"id": record_id},
                    {
                        "$set": r_copy,
                        "$setOnInsert": {"createdAt": created_at}
                    },
                    upsert=True
                )
                inserted_count += 1
            logger.info(f"[MongoDB] Successfully stored {inserted_count} scraped records into '{self.collection_name}'.")
        except Exception as err:
            logger.error(f"[MongoDB] Database sync error: {err}")

        return inserted_count

    def save_raw_crawl_data(self, raw_data: Dict[str, Any]) -> bool:
        """
        Saves raw page-level crawl observations and history into `raw_crawl_data` collection
        (Component 5 of PDF Architecture).
        """
        if not self.is_connected or self.db is None:
            return False
        try:
            raw_coll = self.db["raw_crawl_data"]
            crawl_id = raw_data.get("crawl_id")
            if crawl_id:
                raw_coll.update_one({"crawl_id": crawl_id}, {"$set": raw_data}, upsert=True)
            else:
                raw_coll.insert_one(raw_data)
            logger.info(f"[MongoDB] Stored raw crawl observation history for {raw_data.get('domain')} into 'raw_crawl_data'.")
            return True
        except Exception as e:
            logger.warning(f"[MongoDB] Failed to save raw crawl data: {e}")
            return False

