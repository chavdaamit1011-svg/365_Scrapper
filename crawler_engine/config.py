import os
from pathlib import Path

# Base Paths
BASE_DIR = Path(__file__).resolve().parent
OUTPUT_DIR = BASE_DIR / "output"

# Default Crawler Configuration
DEFAULT_CRAWLER_CONFIG = {
    # Target Scope
    "max_pages": 25,
    "max_depth": 2,
    
    # Network and Throttling
    "delay": 0.5,           # Delay in seconds between requests to same domain
    "timeout": 10,          # HTTP request timeout in seconds
    "retries": 2,           # Retry count on network error
    
    # User Agent (Industry-standard Chrome User Agent to avoid false 403 blocks)
    "user_agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36",
    
    # Compliance
    "respect_robots_txt": True,
    
    # Playwright JavaScript Hybrid Crawler Engine
    "use_playwright_fallback": True,
    "playwright_headless": True,
    
    # Storage Configuration
    "output_dir": str(OUTPUT_DIR),
    "save_local_json": True,
    "save_local_csv": True,
    "save_mongodb": True,
    
    # MongoDB Settings
    "mongodb_uri": os.getenv("MONGODB_URI", "mongodb://127.0.0.1:27017/the_scraper"),
    "mongodb_db": "the_scraper",
    "mongodb_collection": "scraped_results",
}

