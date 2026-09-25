"""Postcode geocoding from the bundled GeoNames table (app/data/au_postcodes.json).

Approximate: the centre of all places sharing a postcode. Good enough to put
a site on the map or to centre a search area; never presented as an exact
address.
"""

from __future__ import annotations

import json
import math
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


def location_map_coordinates(location: dict) -> dict:
    """Return a copy with valid coordinates and an explicit accuracy source.

    Existing sheet coordinates are preserved. If both are empty, Australian
    postcode centroids are offered as approximate map points without writing
    derived data back to the source Sheet.
    """
    result = dict(location)
    raw_lat = result.get("lat")
    raw_lng = result.get("lng")

    def coordinate(value: object, low: float, high: float) -> float | None:
        try:
            number = float(value)
        except (TypeError, ValueError):
            return None
        if not math.isfinite(number) or not low <= number <= high:
            return None
        return number

    lat = coordinate(raw_lat, -90, 90)
    lng = coordinate(raw_lng, -180, 180)
    if lat is not None and lng is not None:
        result["lat"] = lat
        result["lng"] = lng
        result["coordinate_source"] = "SHEET"
        return result

    has_sheet_coordinate = str(raw_lat or "").strip() or str(raw_lng or "").strip()
    if not has_sheet_coordinate:
        centroid = postcode_centroid(result.get("postcode"))
        if centroid is not None:
            result["lat"], result["lng"] = centroid
            result["coordinate_source"] = "POSTCODE_CENTROID"
            return result

    result["lat"] = None
    result["lng"] = None
    result["coordinate_source"] = "UNAVAILABLE"
    return result


def bbox_around(lat: float, lng: float, km: float) -> tuple[float, float, float, float]:
    """(south, west, north, east) box roughly ``km`` from the centre."""
    import math

    dlat = km / 111.0
    dlng = km / (111.0 * max(math.cos(math.radians(lat)), 0.01))
    return (lat - dlat, lng - dlng, lat + dlat, lng + dlng)
