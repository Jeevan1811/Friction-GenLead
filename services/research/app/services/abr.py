"""Australian Business Register (ABR) adapter.

Provides ABN lookup, name search, and ABN checksum validation.
The checksum algorithm is real (weighted-sum mod 89). Network lookup and
search are not implemented; they fail closed instead of returning examples.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass
from datetime import date

from pydantic import BaseModel

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# ABN checksum weights (positions 1-11)
# ---------------------------------------------------------------------------

ABN_WEIGHTS: tuple[int, ...] = (10, 1, 3, 5, 7, 9, 11, 13, 15, 17, 19)


# ---------------------------------------------------------------------------
# Response models
# ---------------------------------------------------------------------------

class ABREntity(BaseModel):
    """A single ABR result."""

    abn: str
    name: str
    entity_type: str
    status: str  # "Active" | "Cancelled"
    state: str
    postcode: str
    business_names: list[str] = []
    registered_date: date | None = None


class ABRSearchResult(BaseModel):
    """Container for ABR search results."""

    query: str
    total_results: int
    entities: list[ABREntity]


# ---------------------------------------------------------------------------
# ABN validation (REAL algorithm)
# ---------------------------------------------------------------------------

def validate_abn(abn: str) -> bool:
    """Validate an Australian Business Number using the official checksum.

    Algorithm (from the ATO):
    1. Subtract 1 from the first digit.
    2. Multiply each digit by its positional weight.
    3. Sum the products.
    4. The ABN is valid if the sum mod 89 == 0.
    """
    # Strip whitespace and non-digit characters
    digits = "".join(c for c in abn if c.isdigit())

    if len(digits) != 11:
        return False

    int_digits = [int(d) for d in digits]

    # Step 1: subtract 1 from the first digit
    int_digits[0] -= 1

    # Step 2 & 3: weighted sum
    total = sum(d * w for d, w in zip(int_digits, ABN_WEIGHTS))

    # Step 4: check mod 89
    return total % 89 == 0


# ---------------------------------------------------------------------------
# Adapter
# ---------------------------------------------------------------------------

@dataclass
class ABRAdapter:
    """ABR service boundary, intentionally unavailable until implemented."""

    api_guid: str | None = None

    @property
    def is_configured(self) -> bool:
        """This adapter remains disabled until real ABR calls are implemented."""
        return False

    async def lookup_abn(self, abn: str) -> ABREntity | None:
        """Validate syntax/checksum, then fail closed until the ABR API exists."""
        if not validate_abn(abn):
            logger.warning("ABN %s failed checksum validation", abn)
            return None

        raise RuntimeError("Live ABR lookup is not implemented; refusing to return sample entities.")

    async def search_by_postcode(self, postcode: str) -> list[dict]:
        """Fail closed rather than return invented postcode prospects."""
        raise RuntimeError("Live postcode search is not implemented; refusing to return sample prospects.")

    async def search_name(self, name: str) -> ABRSearchResult:
        """Fail closed rather than return static demo entities."""
        raise RuntimeError("Live ABR name search is not implemented; refusing to return sample entities.")
