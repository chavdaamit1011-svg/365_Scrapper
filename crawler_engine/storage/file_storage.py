import csv
import json
import re
from pathlib import Path
from typing import Dict, List, Any


def sanitize_filename(name: str) -> str:
    """Replaces unsafe filesystem characters with underscores."""
    return re.sub(r'[^a-zA-Z0-9_.-]', '_', name)


class LocalFileStorage:
    """
    Saves scraped results locally in organized JSON and CSV files.
    Maintains separate output files for:
    - Visited & discovered page URLs
    - Emails
    - Subdomains
    - External links
    - Page metadata
    """

    def __init__(self, base_output_dir: str, domain_name: str):
        self.base_dir = Path(base_output_dir)
        self.safe_domain = sanitize_filename(domain_name)
        
        # Subdirectories for each category
        self.urls_dir = self.base_dir / "urls"
        self.emails_dir = self.base_dir / "emails"
        self.subdomains_dir = self.base_dir / "subdomains"
        self.external_links_dir = self.base_dir / "external_links"
        self.metadata_dir = self.base_dir / "metadata"

        for directory in [
            self.urls_dir,
            self.emails_dir,
            self.subdomains_dir,
            self.external_links_dir,
            self.metadata_dir,
        ]:
            directory.mkdir(parents=True, exist_ok=True)

    def save_urls(self, visited_urls: List[Dict[str, Any]]) -> None:
        """Saves visited URLs to JSON and CSV."""
        json_file = self.urls_dir / f"visited_urls_{self.safe_domain}.json"
        csv_file = self.urls_dir / f"visited_urls_{self.safe_domain}.csv"

        with open(json_file, "w", encoding="utf-8") as f:
            json.dump(visited_urls, f, indent=2, ensure_ascii=False)

        with open(csv_file, "w", newline="", encoding="utf-8") as f:
            writer = csv.writer(f)
            writer.writerow(["URL", "Status Code", "Depth", "Discovered Links Count", "Crawled At"])
            for item in visited_urls:
                writer.writerow([
                    item.get("url", ""),
                    item.get("status_code", ""),
                    item.get("depth", ""),
                    item.get("internal_links_count", 0),
                    item.get("timestamp", ""),
                ])

    def save_emails(self, email_records: List[Dict[str, Any]]) -> None:
        """Saves extracted emails with source URL."""
        json_file = self.emails_dir / f"emails_{self.safe_domain}.json"
        csv_file = self.emails_dir / f"emails_{self.safe_domain}.csv"

        with open(json_file, "w", encoding="utf-8") as f:
            json.dump(email_records, f, indent=2, ensure_ascii=False)

        with open(csv_file, "w", newline="", encoding="utf-8") as f:
            writer = csv.writer(f)
            writer.writerow(["Email", "Source URL", "Domain", "Extracted At"])
            for item in email_records:
                writer.writerow([
                    item.get("email", ""),
                    item.get("source_url", ""),
                    item.get("domain", ""),
                    item.get("timestamp", ""),
                ])

    def save_subdomains(self, subdomain_records: List[Dict[str, Any]]) -> None:
        """Saves discovered subdomains with source page."""
        json_file = self.subdomains_dir / f"subdomains_{self.safe_domain}.json"
        csv_file = self.subdomains_dir / f"subdomains_{self.safe_domain}.csv"

        with open(json_file, "w", encoding="utf-8") as f:
            json.dump(subdomain_records, f, indent=2, ensure_ascii=False)

        with open(csv_file, "w", newline="", encoding="utf-8") as f:
            writer = csv.writer(f)
            writer.writerow(["Subdomain", "Root Domain", "Discovered On URL", "Found At"])
            for item in subdomain_records:
                writer.writerow([
                    item.get("subdomain", ""),
                    item.get("root_domain", ""),
                    item.get("source_url", ""),
                    item.get("timestamp", ""),
                ])

    def save_external_links(self, link_records: List[Dict[str, Any]]) -> None:
        """Saves external links discovered."""
        json_file = self.external_links_dir / f"external_links_{self.safe_domain}.json"
        csv_file = self.external_links_dir / f"external_links_{self.safe_domain}.csv"

        with open(json_file, "w", encoding="utf-8") as f:
            json.dump(link_records, f, indent=2, ensure_ascii=False)

        with open(csv_file, "w", newline="", encoding="utf-8") as f:
            writer = csv.writer(f)
            writer.writerow(["External URL", "Source Page URL", "Discovered At"])
            for item in link_records:
                writer.writerow([
                    item.get("external_url", ""),
                    item.get("source_url", ""),
                    item.get("timestamp", ""),
                ])

    def save_metadata(self, metadata_records: List[Dict[str, Any]]) -> None:
        """Saves extracted page metadata."""
        json_file = self.metadata_dir / f"page_metadata_{self.safe_domain}.json"
        csv_file = self.metadata_dir / f"page_metadata_{self.safe_domain}.csv"

        with open(json_file, "w", encoding="utf-8") as f:
            json.dump(metadata_records, f, indent=2, ensure_ascii=False)

        with open(csv_file, "w", newline="", encoding="utf-8") as f:
            writer = csv.writer(f)
            writer.writerow(["Page URL", "Title", "Meta Description", "Language", "Word Count", "H1 Headings"])
            for item in metadata_records:
                h1_str = " | ".join(item.get("h1_headings", []))
                writer.writerow([
                    item.get("url", ""),
                    item.get("title", ""),
                    item.get("description", ""),
                    item.get("language", ""),
                    item.get("word_count", 0),
                    h1_str,
                ])

