"""User-triggered, bounded global business-candidate search using Overture Places.

Overture is a monthly, multi-source map dataset, not a company register. Results
are candidate locations only; company identity, current operation, sector fit,
websites, and contact details still need human review. Per-record source and
license metadata is retained for attribution and audit.
"""

from __future__ import annotations

import asyncio
import logging
import math
import re
import time
from collections.abc import Awaitable, Callable
from typing import Any
from urllib.parse import quote

import httpx

from app.services.osm_discovery import PublicSourceError

logger = logging.getLogger(__name__)

USER_AGENT = "FrictionGenLead/1.0 (+https://friction.com.my)"
STAC_CATALOG_URL = "https://stac.overturemaps.org/catalog.json"
OVERTURE_S3_ROOT = "s3://overturemaps-us-west-2/release"
RELEASE_PATTERN = re.compile(r"^\d{4}-\d{2}-\d{2}\.\d+$")
MAX_RESULTS = 100
SEARCH_RADIUS_METERS = 5_000
RELEASE_CACHE_SECONDS = 24 * 60 * 60
SEARCH_CACHE_SECONDS = 6 * 60 * 60
MAX_CACHE_ITEMS = 128

# Curated Places taxonomy values for the sectors offered by the GenLead UI.
# These values are a discovery filter, not a verified industry classification.
INDUSTRY_CATEGORIES: dict[str, tuple[str, ...]] = {
    "mining": (
        "b2b_mining", "b2b_quarry", "mine", "quarry", "mining_company",
        "coal_mining", "mineral_mining", "mining_service",
    ),
    "energy": (
        "b2b_energy_and_utility_service", "energy_company", "b2b_oil_and_gas",
        "power_plant", "electric_utility", "oil_and_gas_company", "solar_energy_company",
        "wind_farm", "renewable_energy_company",
    ),
    "heavy industry": (
        "commercial_industrial", "industrial_company", "industrial_equipment_manufacturer",
        "b2b_industrial_and_machine_service", "chemical_plant", "steel_mill",
        "metal_fabricator", "manufacturer", "engineering_service", "supplier",
    ),
    "construction": (
        "building_or_construction_service", "engineering_service", "construction_company",
        "civil_engineering_company", "building_contractor", "general_contractor",
        "earthmoving_company", "supplier",
    ),
    "transport": (
        "travel_and_transportation", "logistics_company", "freight_company", "warehouse",
        "trucking_company", "shipping_company", "transport_company", "supplier",
    ),
    "manufacturing": (
        "industrial_equipment_manufacturer", "manufacturer", "factory", "industrial_company",
        "chemical_plant", "food_manufacturer", "metal_fabricator", "supplier",
    ),
}
ALL_BUSINESS_CATEGORIES = tuple(dict.fromkeys(
    category for categories in INDUSTRY_CATEGORIES.values() for category in categories
))

DISCOVERY_WARNING = (
    "Overture Places is a global, multi-source map dataset with uneven local coverage, not a complete "
    "business register. Results are candidates; review company identity, operation, industry, and contacts."
)
ATTRIBUTION_URL = "https://docs.overturemaps.org/attribution/"
PLACES_LICENSES = ("CDLA-Permissive-2.0", "Apache-2.0 (source-dependent)")

Geocoder = Any
ReleaseFetcher = Callable[[], Awaitable[str]]
QueryRunner = Callable[[str, tuple[float, float, float, float], tuple[str, ...], int], list[dict[str, Any]]]


def _first_text(value: object) -> str:
    if isinstance(value, (list, tuple)):
        for item in value:
            if str(item or "").strip():
                return str(item).strip()
        return ""
    return str(value or "").strip()


def _as_object(value: object) -> dict[str, Any]:
    if isinstance(value, dict):
        return value
    if hasattr(value, "items"):
        try:
            return dict(value.items())
        except Exception:
            return {}
    return {}


def _as_list(value: object) -> list[Any]:
    if value is None:
        return []
    if isinstance(value, list):
        return value
    if isinstance(value, tuple):
        return list(value)
    return [value]


def _bounded_area(latitude: float, longitude: float) -> tuple[float, float, float, float]:
    lat_delta = SEARCH_RADIUS_METERS / 111_320
    cosine = max(0.15, abs(math.cos(math.radians(latitude))))
    lon_delta = min(180.0, SEARCH_RADIUS_METERS / (111_320 * cosine))
    return (
        max(-180.0, longitude - lon_delta),
        max(-90.0, latitude - lat_delta),
        min(180.0, longitude + lon_delta),
        min(90.0, latitude + lat_delta),
    )


def _website(value: object) -> str:
    text = _first_text(value)
    if not text or len(text) > 2048:
        return ""
    if not text.startswith(("https://", "http://")):
        text = "https://" + text
    try:
        from urllib.parse import urlparse

        parsed = urlparse(text)
        if parsed.scheme not in {"https", "http"} or not parsed.hostname or parsed.username or parsed.password:
            return ""
    except ValueError:
        return ""
    return text


def _map_record(raw: dict[str, Any], release: str, location: str) -> dict[str, Any] | None:
    record = _as_object(raw)
    names = _as_object(record.get("names"))
    name = _first_text(names.get("primary") or record.get("name"))
    provider_id = _first_text(record.get("id"))
    if not name or not provider_id:
        return None

    taxonomy = _as_object(record.get("taxonomy"))
    primary_category = _first_text(taxonomy.get("primary"))
    basic_category = _first_text(taxonomy.get("basic_category"))
    category = primary_category or basic_category

    bbox = _as_object(record.get("bbox"))
    try:
        west = float(bbox.get("xmin"))
        south = float(bbox.get("ymin"))
        east = float(bbox.get("xmax"))
        north = float(bbox.get("ymax"))
        if not all(math.isfinite(number) for number in (west, south, east, north)):
            return None
        if not (-180 <= west <= east <= 180 and -90 <= south <= north <= 90):
            return None
    except (TypeError, ValueError):
        return None

    address = _as_object(next(iter(_as_list(record.get("addresses"))), {}))
    sources = [_as_object(item) for item in _as_list(record.get("sources")) if item is not None]
    source_licenses = sorted({
        str(item.get("license")).strip()
        for item in sources
        if item.get("license") is not None and str(item.get("license")).strip()
    })
    try:
        confidence = float(record.get("confidence"))
        if not math.isfinite(confidence):
            confidence = None
    except (TypeError, ValueError):
        confidence = None

    website = _website(record.get("websites"))
    phone = _first_text(record.get("phones"))
    email = _first_text(record.get("emails"))
    latitude = (south + north) / 2
    longitude = (west + east) / 2
    return {
        "provider_id": provider_id,
        "name": name,
        "industry": category,
        "country": _first_text(address.get("country")),
        "country_code": _first_text(address.get("country_code")).casefold(),
        "state": _first_text(address.get("region")),
        "postcode": _first_text(address.get("postcode")),
        "suburb": _first_text(address.get("locality")),
        "address": _first_text(address.get("freeform")),
        "lat": latitude,
        "lng": longitude,
        "website": website,
        "phone": phone,
        "email": email,
        "source": "OVERTURE_MAPS",
        "source_url": f"https://explore.overturemaps.org/?id={quote(provider_id, safe='')}"[:2048],
        "source_provenance": {
            "provider": "Overture Maps Places",
            "provider_id": provider_id,
            "release": release,
            "release_cadence": "monthly",
            "retrieved_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            "query_location": location,
            "category_primary": primary_category,
            "category_basic": basic_category,
            "confidence": confidence,
            "operating_status": record.get("operating_status"),
            "sources": sources,
            "source_licenses": source_licenses,
            "places_theme_licenses": list(PLACES_LICENSES),
            "attribution_guide": ATTRIBUTION_URL,
            "attribution_note": "Source-level license details are retained when supplied; follow Overture's current attribution guide for all source and theme terms.",
        },
        "source_quality_flags": (
            "OVERTURE_MAPS_CANDIDATE; INDUSTRY_CATEGORY_MATCH_NOT_VERIFIED; "
            "OPERATING_STATUS_NOT_INDEPENDENTLY_VERIFIED; CONTACT_DETAILS_REQUIRE_REVIEW"
        ),
        "_confidence": confidence if confidence is not None else -1,
    }


class OverturePlacesDiscovery:
    """Query a small area from the latest Overture Places release."""

    def __init__(
        self,
        *,
        geocoder: Geocoder,
        release_fetcher: ReleaseFetcher | None = None,
        query_runner: QueryRunner | None = None,
        cache_ttl_seconds: int = SEARCH_CACHE_SECONDS,
    ) -> None:
        self.geocoder = geocoder
        self.release_fetcher = release_fetcher or self._fetch_latest_release
        self.query_runner = query_runner or _query_overture
        self.cache_ttl_seconds = cache_ttl_seconds
        self._release_cache: tuple[float, str] | None = None
        self._search_cache: dict[str, tuple[float, list[dict[str, Any]], list[str]]] = {}
        self._lock = asyncio.Lock()
        self.last_warnings: list[str] = []

    async def search(self, location: str, industry: str | None = None) -> list[dict[str, Any]]:
        place = " ".join(str(location or "").split())
        if not 2 <= len(place) <= 160:
            raise ValueError("Enter a location between 2 and 160 characters.")
        normalized_industry = " ".join(str(industry or "").casefold().split())
        categories = INDUSTRY_CATEGORIES.get(normalized_industry, ALL_BUSINESS_CATEGORIES if not normalized_industry else ())
        if normalized_industry and not categories:
            self.last_warnings = [
                f"No Overture Places category mapping exists for '{industry}'. No broader search was run."
            ]
            return []

        key = f"{place.casefold()}|{normalized_industry}"
        cached = self._search_cache.get(key)
        if cached and cached[0] > time.monotonic():
            self.last_warnings = list(cached[2])
            return [dict(row) for row in cached[1]]

        async with self._lock:
            cached = self._search_cache.get(key)
            if cached and cached[0] > time.monotonic():
                self.last_warnings = list(cached[2])
                return [dict(row) for row in cached[1]]

            place_data = await self.geocoder.resolve_place(place)
            latitude = _coordinate(place_data, "latitude", "lat", -90, 90)
            longitude = _coordinate(place_data, "longitude", "lon", -180, 180)
            if latitude is None or longitude is None:
                raise PublicSourceError("The location service did not return valid coordinates.")
            release = await self._latest_release()
            bounds = _bounded_area(latitude, longitude)
            try:
                raw_rows = await asyncio.to_thread(
                    self.query_runner, release, bounds, tuple(categories), MAX_RESULTS
                )
            except Exception as exc:
                logger.warning("Overture Places query failed: %s", type(exc).__name__)
                raise PublicSourceError(
                    "Global company-candidate search could not reach the Overture Places dataset. Please retry shortly."
                ) from exc

            rows: list[dict[str, Any]] = []
            seen: set[str] = set()
            for raw in raw_rows[:MAX_RESULTS]:
                if not isinstance(raw, dict):
                    continue
                row = _map_record(raw, release, place)
                if not row or row["provider_id"] in seen:
                    continue
                seen.add(row["provider_id"])
                row.pop("_confidence", None)
                row.update({
                    "country": row.get("country") or str(place_data.get("country") or ""),
                    "country_code": row.get("country_code") or str(place_data.get("country_code") or "").casefold(),
                    "state": row.get("state") or str(place_data.get("region") or place_data.get("state") or ""),
                })
                rows.append(row)

            rows.sort(key=lambda row: float(row["source_provenance"].get("confidence") or -1), reverse=True)
            warnings = [DISCOVERY_WARNING, f"Source release: Overture Maps {release} (monthly release)."]
            self.last_warnings = warnings
            self._search_cache[key] = (time.monotonic() + self.cache_ttl_seconds, rows, warnings)
            if len(self._search_cache) > MAX_CACHE_ITEMS:
                oldest_key = min(self._search_cache, key=lambda item: self._search_cache[item][0])
                self._search_cache.pop(oldest_key, None)
            return [dict(row) for row in rows]

    async def _latest_release(self) -> str:
        now = time.monotonic()
        if self._release_cache and self._release_cache[0] > now:
            return self._release_cache[1]
        try:
            release = str(await self.release_fetcher()).strip()
        except Exception as exc:
            logger.warning("Could not resolve Overture release catalog: %s", type(exc).__name__)
            raise PublicSourceError("The latest Overture Places release could not be resolved.") from exc
        if not RELEASE_PATTERN.fullmatch(release):
            raise PublicSourceError("The Overture release catalog returned an invalid release identifier.")
        self._release_cache = (now + RELEASE_CACHE_SECONDS, release)
        return release

    @staticmethod
    async def _fetch_latest_release() -> str:
        timeout = httpx.Timeout(15.0, connect=5.0)
        async with httpx.AsyncClient(
            timeout=timeout,
            headers={"User-Agent": USER_AGENT, "Accept": "application/json"},
            trust_env=False,
        ) as client:
            response = await client.get(STAC_CATALOG_URL)
            response.raise_for_status()
            if len(response.content) > 512_000:
                raise PublicSourceError("The Overture release catalog exceeded the safe size limit.")
            payload = response.json()
        if not isinstance(payload, dict):
            raise PublicSourceError("The Overture release catalog returned invalid metadata.")
        latest = payload.get("latest")
        if not isinstance(latest, str):
            raise PublicSourceError("The Overture release catalog did not include a latest release.")
        return latest


def _coordinate(payload: dict[str, Any], *keys: Any) -> float | None:
    low, high = keys[-2:]
    for key in keys[:-2]:
        try:
            value = float(payload.get(key))
        except (TypeError, ValueError):
            continue
        if math.isfinite(value) and low <= value <= high:
            return value
    return None


def _query_overture(
    release: str,
    bounds: tuple[float, float, float, float],
    categories: tuple[str, ...],
    limit: int,
) -> list[dict[str, Any]]:
    """Run one bounded DuckDB/Parquet query; called in a worker thread."""
    if not RELEASE_PATTERN.fullmatch(release):
        raise ValueError("Invalid Overture release identifier")
    import duckdb

    west, south, east, north = bounds
    parquet_glob = f"{OVERTURE_S3_ROOT}/{release}/theme=places/type=place/*"
    connection = duckdb.connect(
        database=":memory:",
        config={"threads": "2", "memory_limit": "768MB", "enable_progress_bar": "false"},
    )
    try:
        try:
            connection.execute("LOAD httpfs")
        except Exception:
            connection.execute("INSTALL httpfs")
            connection.execute("LOAD httpfs")
        connection.execute("SET s3_region='us-west-2'")
        query = """
            SELECT
                id,
                names.primary AS name,
                taxonomy.primary AS category_primary,
                taxonomy.basic_category AS category_basic,
                confidence,
                operating_status,
                bbox.xmin AS xmin,
                bbox.ymin AS ymin,
                bbox.xmax AS xmax,
                bbox.ymax AS ymax,
                addresses[1].freeform AS address,
                addresses[1].locality AS locality,
                addresses[1].region AS region,
                addresses[1].postcode AS postcode,
                addresses[1].country AS country,
                addresses[1].country_code AS country_code,
                websites[1] AS website,
                phones[1] AS phone,
                emails[1] AS email,
                sources
            FROM read_parquet(?, hive_partitioning = true, union_by_name = true)
            WHERE bbox.xmin BETWEEN ? AND ?
              AND bbox.ymin BETWEEN ? AND ?
              AND names.primary IS NOT NULL
              AND (
                list_contains(?, taxonomy.primary)
                OR list_contains(?, taxonomy.basic_category)
              )
            ORDER BY confidence DESC NULLS LAST
            LIMIT ?
        """
        cursor = connection.execute(
            query,
            [parquet_glob, west, east, south, north, list(categories), list(categories), min(MAX_RESULTS, max(1, limit))],
        )
        columns = [column[0] for column in cursor.description]
        output: list[dict[str, Any]] = []
        for values in cursor.fetchall():
            row = dict(zip(columns, values))
            output.append({
                "id": row.get("id"),
                "names": {"primary": row.get("name")},
                "taxonomy": {"primary": row.get("category_primary"), "basic_category": row.get("category_basic")},
                "confidence": row.get("confidence"),
                "operating_status": row.get("operating_status"),
                "bbox": {"xmin": row.get("xmin"), "ymin": row.get("ymin"), "xmax": row.get("xmax"), "ymax": row.get("ymax")},
                "addresses": [{
                    "freeform": row.get("address"), "locality": row.get("locality"),
                    "region": row.get("region"), "postcode": row.get("postcode"),
                    "country": row.get("country"), "country_code": row.get("country_code"),
                }],
                "websites": [row.get("website")] if row.get("website") else [],
                "phones": [row.get("phone")] if row.get("phone") else [],
                "emails": [row.get("email")] if row.get("email") else [],
                "sources": row.get("sources") or [],
            })
        return output
    finally:
        connection.close()
