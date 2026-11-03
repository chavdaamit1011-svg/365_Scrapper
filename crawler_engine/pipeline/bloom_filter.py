"""
The Scrapper - High-Performance In-Memory Bloom Filter (Component 7 of PDF Architecture)
Performs fast pre-checks: 'definitely new' vs 'probably exists' before database operations.
Note: Database UNIQUE constraints and actual queries remain the final authority.
"""

import math
import hashlib
from typing import List


class BloomFilter:
    """
    Zero-dependency scalable Bloom filter using SHA-256 and Murmur-like double hashing.
    """

    def __init__(self, expected_elements: int = 100000, false_positive_rate: float = 0.01):
        self.expected_elements = max(expected_elements, 1000)
        self.false_positive_rate = false_positive_rate

        # Optimal bit array size: m = - (n * ln(p)) / (ln(2)^2)
        self.size = int(
            - (self.expected_elements * math.log(self.false_positive_rate)) / (math.log(2) ** 2)
        )
        # Optimal number of hash functions: k = (m / n) * ln(2)
        self.hash_count = max(1, int((self.size / self.expected_elements) * math.log(2)))

        # Bit array storage (using bytearray for compact memory footprint)
        self.byte_count = (self.size + 7) // 8
        self.bit_array = bytearray(self.byte_count)
        self.count = 0

    def _get_hashes(self, item: str) -> List[int]:
        """Generates k bit indices using double hashing from SHA-256."""
        h1 = int(hashlib.sha256(item.encode("utf-8")).hexdigest()[:16], 16)
        h2 = int(hashlib.md5(item.encode("utf-8")).hexdigest()[:16], 16)
        return [(h1 + i * h2) % self.size for i in range(self.hash_count)]

    def add(self, item: str) -> None:
        """Adds an item into the Bloom filter."""
        for bit_index in self._get_hashes(item):
            byte_idx = bit_index // 8
            bit_offset = bit_index % 8
            self.bit_array[byte_idx] |= (1 << bit_offset)
        self.count += 1

    def contains(self, item: str) -> bool:
        """
        Queries the Bloom filter:
        - False: Item is DEFINITELY NEW (not in database)
        - True: Item PROBABLY EXISTS (must verify in actual database)
        """
        for bit_index in self._get_hashes(item):
            byte_idx = bit_index // 8
            bit_offset = bit_index % 8
            if not (self.bit_array[byte_idx] & (1 << bit_offset)):
                return False
        return True

