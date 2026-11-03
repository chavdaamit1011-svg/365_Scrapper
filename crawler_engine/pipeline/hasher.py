"""
The Scrapper - SHA-256 Unique ID & Content Fingerprinting Engine (Component 6 of PDF Architecture)
Generates stable entity IDs and content hashes to identify entities and detect content mutations.
"""

import hashlib
import json
from typing import Any, Dict


def generate_entity_id(entity_type: str, value: str) -> str:
    """
    Generates a deterministic SHA-256 identity hash for an entity.
    E.g. generate_entity_id('domain', 'example.com')
         generate_entity_id('email', 'info@example.com')
         generate_entity_id('subdomain', 'blog.example.com')
         generate_entity_id('url', 'https://example.com/contact')
    """
    clean_type = entity_type.strip().lower()
    clean_val = value.strip().lower()
    identity = f"{clean_type}:{clean_val}"
    return hashlib.sha256(identity.encode("utf-8")).hexdigest()


def generate_content_hash(content: str) -> str:
    """
    Computes SHA-256 hash of HTML or text content.
    Used to detect whether a web page has changed between crawl runs.
    """
    if not content:
        return ""
    return hashlib.sha256(content.strip().encode("utf-8")).hexdigest()


def generate_payload_fingerprint(payload: Dict[str, Any]) -> str:
    """
    Computes deterministic SHA-256 fingerprint of structured data attributes
    (subdomains, emails, category, country) to instantly detect data mutations.
    """
    canonical_dict = {
        "domain": payload.get("domain", "").lower(),
        "subdomains": sorted(payload.get("subdomains", [])),
        "emails": sorted(payload.get("emails", [])),
        "country": payload.get("country", ""),
        "category": payload.get("category", ""),
        "status": payload.get("status", ""),
    }
    encoded = json.dumps(canonical_dict, sort_keys=True)
    return hashlib.sha256(encoded.encode("utf-8")).hexdigest()

