"""Postcode geocoding from the bundled GeoNames table (app/data/au_postcodes.json).

Approximate: the centre of all places sharing a postcode. Good enough to put
a site on the map or to centre a search area; never presented as an exact
address.
"""

from __future__ import annotations

import json
import re
from functools import lru_cache
from pathlib import Path

_DATA = Path(__file__).resolve().parent.parent / "data" / "au_postcodes.json"
_PC = re.compile(r"^\d{4}$")


@lru_cache(maxsize=1)
def _table() -> dict[str, list]:
    return json.loads(_DATA.read_text(encoding="utf-8"))


def postcode_centroid(postcode: str | None) -> tuple[float, float] | None:
    """(lat, lng) for an Australian postcode, or None if unknown."""
    pc = (postcode or "").strip()
    if not _PC.match(pc):
        return None
    hit = _table().get(pc)
    return (hit[0], hit[1]) if hit else None


def postcode_place(postcode: str | None) -> str | None:
    """A representative place name for the postcode, e.g. '4744' -> 'Moranbah'."""
    hit = _table().get((postcode or "").strip())
    return hit[2] if hit else None


def bbox_around(lat: float, lng: float, km: float) -> tuple[float, float, float, float]:
    """(south, west, north, east) box roughly ``km`` from the centre."""
    import math

    dlat = km / 111.0
    dlng = km / (111.0 * max(math.cos(math.radians(lat)), 0.01))
    return (lat - dlat, lng - dlng, lat + dlat, lng + dlng)
