"""Australian Business Register (ABR) adapter.

Provides ABN lookup, name search, and ABN checksum validation.
The checksum algorithm is real (weighted-sum mod 89); the lookup and
search methods return mock data until the real ABR API is integrated.
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
# Mock data
# ---------------------------------------------------------------------------

_MOCK_ENTITIES: dict[str, ABREntity] = {
    "54078848745": ABREntity(
        abn="54078848745",
        name="CS Energy Ltd",
        entity_type="Australian Public Company",
        status="Active",
        state="QLD",
        postcode="4000",
        business_names=["CS Energy"],
        registered_date=date(2000, 7, 1),
    ),
    "37078848674": ABREntity(
        abn="37078848674",
        name="Stanwell Corporation Limited",
        entity_type="Australian Public Company",
        status="Active",
        state="QLD",
        postcode="4000",
        business_names=["Stanwell Corporation"],
        registered_date=date(1997, 1, 1),
    ),
    "19074758014": ABREntity(
        abn="19074758014",
        name="Sun Metals Corporation Pty Ltd",
        entity_type="Australian Private Company",
        status="Active",
        state="QLD",
        postcode="4811",
        business_names=["Sun Metals"],
        registered_date=date(1997, 6, 1),
    ),
    "42004080264": ABREntity(
        abn="42004080264",
        name="Incitec Pivot Limited",
        entity_type="Australian Public Company",
        status="Active",
        state="VIC",
        postcode="3000",
        business_names=["Incitec Pivot"],
        registered_date=date(2003, 7, 1),
    ),
}


# ---------------------------------------------------------------------------
# Adapter
# ---------------------------------------------------------------------------

@dataclass
class ABRAdapter:
    """Stub adapter for the Australian Business Register.

    TODO: Replace with real ABR API calls
    (https://abr.business.gov.au/Documentation/WebServiceApi).
    """

    api_guid: str | None = None

    async def lookup_abn(self, abn: str) -> ABREntity | None:
        """Look up a company by its ABN.

        Returns the entity if found, or None. The ABN is validated first;
        an invalid checksum returns None without hitting the API.
        """
        if not validate_abn(abn):
            logger.warning("ABN %s failed checksum validation", abn)
            return None

        clean = "".join(c for c in abn if c.isdigit())
        entity = _MOCK_ENTITIES.get(clean)

        if entity:
            logger.info("ABN lookup hit: %s -> %s", abn, entity.name)
        else:
            logger.info("ABN lookup miss: %s", abn)

        return entity

    async def search_name(self, name: str) -> ABRSearchResult:
        """Search ABR by business or entity name.

        Returns matching entities. Partial, case-insensitive match.
        """
        name_lower = name.lower()
        matches = [
            entity
            for entity in _MOCK_ENTITIES.values()
            if (
                name_lower in entity.name.lower()
                or any(name_lower in bn.lower() for bn in entity.business_names)
            )
        ]

        logger.info("ABR name search '%s': %d result(s)", name, len(matches))

        return ABRSearchResult(
            query=name,
            total_results=len(matches),
            entities=matches,
        )
