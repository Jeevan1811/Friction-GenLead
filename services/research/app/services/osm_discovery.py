"""Bounded, user-triggered discovery of mapped businesses from OpenStreetMap.

The adapter geocodes the user's entered place once, then queries a small nearby
area. It does not crawl OSM detail pages or download regional/planet datasets.
OSM coverage and industry tags vary; results are candidates, not a registry or
proof of company status or industry.
"""

from __future__ import annotations

import asyncio
import logging
import math
import os
import re
import time
from dataclasses import dataclass
from typing import Any, Awaitable, Callable
from urllib.parse import urlparse

import httpx

logger = logging.getLogger(__name__)

USER_AGENT = "FrictionGenLead/1.0 (+https://friction.com.my)"
NOMINATIM_SEARCH_URL = os.getenv(
    "GENLEAD_NOMINATIM_SEARCH_URL",
    "https://nominatim.openstreetmap.org/search",
)
OVERPASS_URL = os.getenv(
    "GENLEAD_OVERPASS_URL",
    "https://overpass-api.de/api/interpreter",
)
OVERPASS_FALLBACK_URLS = os.getenv(
    "GENLEAD_OVERPASS_FALLBACK_URLS",
    "https://overpass.private.coffee/api/interpreter",
)
SEARCH_RADIUS_METERS = 5_000
MAX_RESULTS = 100
MAX_RESPONSE_BYTES = 2 * 1024 * 1024
CACHE_TTL_SECONDS = 24 * 60 * 60
NOMINATIM_MIN_INTERVAL_SECONDS = 1.1
OVERPASS_MIN_INTERVAL_SECONDS = 1.0
INDUSTRY_SEARCH_TERMS = {
    "mining": ("mining", "mine", "quarry", "extraction", "mineral", "coal", "iron ore", "resources"),
    "energy": ("energy", "power", "electricity", "solar", "wind", "renewable", "oil", "gas", "utility"),
    "heavy industry": ("heavy industry", "industrial", "steel", "smelter", "refinery", "foundry", "fabrication"),
    "construction": ("construction", "builder", "civil", "contractor", "earthmoving", "engineering"),
    "transport": ("transport", "logistics", "freight", "trucking", "shipping", "haulage"),
    "manufacturing": ("manufacturing", "factory", "production", "fabrication", "processing", "industrial"),
}
INDUSTRY_COVERAGE_WARNING = (
    "OpenStreetMap coverage is community-mapped and non-exhaustive. Business operation, "
    "industry fit, legal status, websites, and contact details require review."
)


class PlaceNotFoundError(ValueError):
    """The requested free-text location could not be resolved."""


class PublicSourceError(RuntimeError):
    """A configured public data source failed or returned unusable data."""


@dataclass(frozen=True)
class _CacheValue:
    expires_at: float
    value: object


def _validate_endpoint(url: str, setting_name: str) -> str:
    parsed = urlparse(url)
    if parsed.scheme != "https" or not parsed.hostname or parsed.username or parsed.password:
        raise ValueError(f"{setting_name} must be an HTTPS URL without embedded credentials.")
    return url


def _valid_coordinate(value: object, low: float, high: float) -> float | None:
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    if not math.isfinite(number) or not low <= number <= high:
        return None
    return number


def _website_url(value: object) -> str:
    text = str(value or "").strip()
    if not text or len(text) > 2048:
        return ""
    if "://" not in text:
        text = "https://" + text
    parsed = urlparse(text)
    if parsed.scheme not in {"http", "https"} or not parsed.hostname or parsed.username or parsed.password:
        return ""
    return text


def _industry_terms(industry: str) -> tuple[str, ...]:
    normalized = " ".join(industry.casefold().split())
    if normalized in INDUSTRY_SEARCH_TERMS:
        return INDUSTRY_SEARCH_TERMS[normalized]
    safe_term = " ".join(re.sub(r"[^a-z0-9 ]", " ", normalized).split())
    return (safe_term,) if safe_term else ()


def _query(lat: float, lon: float, industry: str = "") -> str:
    """Return a bounded nearby-business query; user text never enters Overpass QL."""
    radius = SEARCH_RADIUS_METERS
    if industry:
        normalized_industry = " ".join(industry.casefold().split())
        terms = tuple(dict.fromkeys(term.casefold() for term in _industry_terms(industry) if term))
        if not terms:
            return "[out:json][timeout:20];( );out center 100;"
        filters = "".join(
            f'nwr(around:{radius},{lat},{lon})["name"]["industry"="{term}"];'
            f'nwr(around:{radius},{lat},{lon})["name"]["industrial"="{term}"];'
            for term in terms
        )
        if normalized_industry == "mining":
            filters += (
                f'nwr(around:{radius},{lat},{lon})["name"]["landuse"="quarry"];'
                f'nwr(around:{radius},{lat},{lon})["name"]["man_made"="mine"];'
                f'nwr(around:{radius},{lat},{lon})["name"]["man_made"="mineshaft"];'
            )
        return f"[out:json][timeout:20];({filters});out center 100;"

    return (
        "[out:json][timeout:20];("
        f"nwr(around:{radius},{lat},{lon})[\"office\"=\"company\"][\"name\"];"
        f"nwr(around:{radius},{lat},{lon})[\"industrial\"][\"name\"];"
        f"nwr(around:{radius},{lat},{lon})[\"man_made\"=\"works\"][\"name\"];"
        f"nwr(around:{radius},{lat},{lon})[\"landuse\"=\"quarry\"][\"name\"];"
        f"nwr(around:{radius},{lat},{lon})[\"man_made\"=\"mineshaft\"][\"name\"];"
        ");out center 100;"
    )


class OpenStreetMapDiscovery:
    """Discover named business/industrial map features near an entered place."""

    def __init__(
        self,
        *,
        client: httpx.AsyncClient | None = None,
        nominatim_search_url: str = NOMINATIM_SEARCH_URL,
        overpass_url: str = OVERPASS_URL,
        overpass_fallback_urls: tuple[str, ...] | None = None,
        cache_ttl_seconds: int = CACHE_TTL_SECONDS,
    ) -> None:
        self.client = client
        self.nominatim_search_url = _validate_endpoint(
            nominatim_search_url, "GENLEAD_NOMINATIM_SEARCH_URL"
        )
        self.overpass_url = _validate_endpoint(overpass_url, "GENLEAD_OVERPASS_URL")
        configured_fallbacks = (
            overpass_fallback_urls
            if overpass_fallback_urls is not None
            else tuple(url.strip() for url in OVERPASS_FALLBACK_URLS.split(",") if url.strip())
        )
        self.overpass_fallback_urls = tuple(
            dict.fromkeys(
                _validate_endpoint(url, "GENLEAD_OVERPASS_FALLBACK_URLS")
                for url in configured_fallbacks
                if url != self.overpass_url
            )
        )
        self.cache_ttl_seconds = cache_ttl_seconds
        self._search_cache: dict[str, _CacheValue] = {}
        self._place_cache: dict[str, _CacheValue] = {}
        self._nominatim_lock = asyncio.Lock()
        self._overpass_lock = asyncio.Lock()
        self._last_nominatim_request = 0.0
        self._last_overpass_request = 0.0
        self._overpass_cooldown_until: dict[str, float] = {}
        self.last_warnings: list[str] = []

    async def search(self, location: str, industry: str | None = None) -> list[dict]:
        place = " ".join(str(location or "").split())
        if len(place) < 2 or len(place) > 160:
            raise ValueError("Enter a location between 2 and 160 characters.")

        normalized_industry = " ".join(str(industry or "").split())[:80]
        cache_key = f"{place.casefold()}|{normalized_industry.casefold()}"
        cached = self._get_cache(self._search_cache, cache_key)
        if cached is not None:
            if isinstance(cached, dict):
                rows = cached.get("rows", [])
                self.last_warnings = list(cached.get("warnings", []))
            else:
                rows = cached
                self.last_warnings = [INDUSTRY_COVERAGE_WARNING]
            return [dict(row) for row in rows]  # type: ignore[arg-type]

        self.last_warnings = []
        if self.client is not None:
            results = await self._search_with_client(self.client, place, normalized_industry)
        else:
            async with httpx.AsyncClient(
                timeout=httpx.Timeout(20.0),
                headers={"User-Agent": USER_AGENT, "Accept": "application/json"},
                trust_env=False,
            ) as client:
                results = await self._search_with_client(client, place, normalized_industry)

        self._put_cache(
            self._search_cache,
            cache_key,
            {"rows": results, "warnings": list(self.last_warnings)},
        )
        return [dict(row) for row in results]

    async def resolve_place(self, location: str) -> dict[str, Any]:
        """Resolve a user-entered place without querying the Overpass API."""
        place = " ".join(str(location or "").split())
        if len(place) < 2 or len(place) > 160:
            raise ValueError("Enter a location between 2 and 160 characters.")
        if self.client is not None:
            (latitude, longitude), address = await self._geocode(self.client, place)
        else:
            async with httpx.AsyncClient(
                timeout=httpx.Timeout(20.0),
                headers={"User-Agent": USER_AGENT, "Accept": "application/json"},
                trust_env=False,
            ) as client:
                (latitude, longitude), address = await self._geocode(client, place)
        return {
            "latitude": latitude,
            "longitude": longitude,
            "country": address.get("country", ""),
            "country_code": address.get("country_code", "").casefold(),
            "region": address.get("state") or address.get("region") or "",
            "locality": address.get("city") or address.get("town") or address.get("village") or "",
        }

    async def _search_with_client(
        self, client: httpx.AsyncClient, place: str, industry: str
    ) -> list[dict]:
        coordinates, address = await self._geocode(client, place)
        lat, lon = coordinates
        payload: object | None = None
        endpoints = (self.overpass_url, *self.overpass_fallback_urls)
        now = time.monotonic()
        if any(self._overpass_cooldown_until.get(endpoint, 0.0) > now for endpoint in endpoints):
            raise PublicSourceError(
                "OpenStreetMap search is cooling down after a rate-limit response. Please try again shortly."
            )
        for index, endpoint in enumerate(endpoints):
            try:
                response = await self._limited_request(
                    self._overpass_lock,
                    "overpass",
                    lambda endpoint=endpoint: client.post(
                        endpoint,
                        data={"data": _query(lat, lon, industry)},
                    ),
                    OVERPASS_MIN_INTERVAL_SECONDS,
                )
            except httpx.HTTPError as exc:
                if index + 1 < len(endpoints):
                    self.last_warnings.append(
                        "A public map search endpoint was unreachable; trying one configured alternate."
                    )
                    continue
                raise PublicSourceError("OpenStreetMap business search could not be reached.") from exc

            if response.status_code in {429, 406}:
                self._overpass_cooldown_until[endpoint] = time.monotonic() + 30
                raise PublicSourceError(
                    "OpenStreetMap search asked the app to pause after a rate-limit response; please try again later."
                )
            if 500 <= response.status_code <= 599 and index + 1 < len(endpoints):
                self.last_warnings.append(
                    f"A public map search endpoint returned HTTP {response.status_code}; trying one configured alternate."
                )
                continue
            payload = self._json_response(response, "OpenStreetMap business search")
            break

        if payload is None:
            raise PublicSourceError("No configured OpenStreetMap search endpoint completed this search.")
        elements = payload.get("elements") if isinstance(payload, dict) else None
        if not isinstance(elements, list):
            raise PublicSourceError("OpenStreetMap business search returned an invalid response.")

        results: list[dict] = []
        seen: set[str] = set()
        for element in elements:
            if not isinstance(element, dict):
                continue
            candidate = _candidate(element, address)
            if not candidate:
                continue
            if industry:
                match_type = _industry_match(candidate, industry)
                if not match_type:
                    continue
                candidate["requested_industry"] = industry
                candidate["industry_match"] = match_type
                candidate["source_quality_flags"] = (
                    "OSM_MAPPED_BUSINESS; INDUSTRY_TAG_OR_FEATURE_MATCH; INDUSTRY_NOT_INDEPENDENTLY_VERIFIED"
                )
            provider_id = candidate["provider_id"]
            if provider_id in seen:
                continue
            seen.add(provider_id)
            results.append(candidate)
            if len(results) >= MAX_RESULTS:
                self.last_warnings.append(
                    f"OpenStreetMap results were capped at {MAX_RESULTS} nearby features."
                )
                break

        self.last_warnings.append(INDUSTRY_COVERAGE_WARNING)
        return results

    async def _geocode(
        self, client: httpx.AsyncClient, place: str
    ) -> tuple[tuple[float, float], dict[str, str]]:
        key = place.casefold()
        cached = self._get_cache(self._place_cache, key)
        if cached is not None:
            return cached  # type: ignore[return-value]

        try:
            response = await self._limited_request(
                self._nominatim_lock,
                "nominatim",
                lambda: client.get(
                    self.nominatim_search_url,
                    params={
                        "q": place,
                        "format": "jsonv2",
                        "addressdetails": "1",
                        "limit": "1",
                    },
                ),
                NOMINATIM_MIN_INTERVAL_SECONDS,
            )
        except httpx.HTTPError as exc:
            raise PublicSourceError("OpenStreetMap could not resolve this location.") from exc

        payload = self._json_response(response, "OpenStreetMap location search")
        if not isinstance(payload, list) or not payload:
            raise PlaceNotFoundError(f"No mapped location found for '{place}'. Add a region/country to narrow it down.")
        first = payload[0]
        if not isinstance(first, dict):
            raise PublicSourceError("OpenStreetMap location search returned an invalid place.")
        lat = _valid_coordinate(first.get("lat"), -90, 90)
        lon = _valid_coordinate(first.get("lon"), -180, 180)
        if lat is None or lon is None:
            raise PublicSourceError("OpenStreetMap returned a place without valid coordinates.")
        raw_address = first.get("address")
        address = {
            str(key): str(value)
            for key, value in raw_address.items()
            if isinstance(raw_address, dict) and value is not None
        } if isinstance(raw_address, dict) else {}
        result = ((lat, lon), address)
        self._put_cache(self._place_cache, key, result)
        return result

    async def _limited_request(
        self,
        lock: asyncio.Lock,
        source: str,
        request: Callable[[], Awaitable[httpx.Response]],
        minimum_interval: float,
    ) -> httpx.Response:
        async with lock:
            last_attr = f"_last_{source}_request"
            last = getattr(self, last_attr)
            delay = minimum_interval - (time.monotonic() - last)
            if delay > 0:
                await asyncio.sleep(delay)
            setattr(self, last_attr, time.monotonic())
            try:
                response = await request()
            except httpx.HTTPError:
                raise
        return response

    @staticmethod
    def _json_response(response: httpx.Response, label: str) -> object:
        if len(response.content) > MAX_RESPONSE_BYTES:
            raise PublicSourceError(f"{label} response exceeded the safe size limit.")
        if response.status_code == 429:
            raise PublicSourceError(f"{label} rate limit was reached; no automatic retry was made.")
        if response.status_code < 200 or response.status_code >= 300:
            raise PublicSourceError(f"{label} returned HTTP {response.status_code}.")
        try:
            return response.json()
        except ValueError as exc:
            raise PublicSourceError(f"{label} returned invalid JSON.") from exc

    def _get_cache(self, cache: dict[str, _CacheValue], key: str) -> object | None:
        item = cache.get(key)
        if item is None:
            return None
        if item.expires_at <= time.monotonic():
            cache.pop(key, None)
            return None
        return item.value

    def _put_cache(self, cache: dict[str, _CacheValue], key: str, value: object) -> None:
        if len(cache) >= 256:
            oldest = min(cache, key=lambda item: cache[item].expires_at)
            cache.pop(oldest, None)
        cache[key] = _CacheValue(time.monotonic() + self.cache_ttl_seconds, value)


def _candidate(element: dict, geocode_address: dict[str, str]) -> dict | None:
    tags = element.get("tags")
    if not isinstance(tags, dict):
        return None
    name = " ".join(str(tags.get("name") or "").split())
    element_type = str(element.get("type") or "")
    element_id = str(element.get("id") or "")
    if not name or element_type not in {"node", "way", "relation"} or not element_id.isdigit():
        return None
    if not (
        tags.get("office") == "company"
        or tags.get("industrial")
        or tags.get("man_made") in {"works", "mineshaft"}
        or tags.get("landuse") == "quarry"
    ):
        return None

    center = element.get("center") if isinstance(element.get("center"), dict) else element
    lat = _valid_coordinate(center.get("lat"), -90, 90)
    lon = _valid_coordinate(center.get("lon"), -180, 180)
    if lat is None or lon is None:
        return None

    get_address = lambda *keys: next(
        (str(tags[key]).strip() for key in keys if str(tags.get(key) or "").strip()), ""
    )
    street = " ".join(
        item for item in [get_address("addr:housenumber"), get_address("addr:street")] if item
    )
    address = get_address("addr:full") or street
    city = get_address("addr:city", "addr:town", "addr:village", "addr:suburb")
    state = get_address("addr:state") or geocode_address.get("state", "")
    postcode = get_address("addr:postcode") or geocode_address.get("postcode", "")
    country = get_address("addr:country") or geocode_address.get("country", "")
    country_code = get_address("addr:country_code") or geocode_address.get("country_code", "")
    if country_code:
        country_code = country_code.casefold()

    source_url = f"https://www.openstreetmap.org/{element_type}/{element_id}"
    return {
        "provider_id": f"{element_type}/{element_id}",
        "name": name,
        "abn": "",
        "status": "Unknown",
        "state": state,
        "postcode": postcode,
        "country": country,
        "country_code": country_code,
        "address": address,
        "suburb": city,
        "lat": lat,
        "lng": lon,
        "website": _website_url(tags.get("website") or tags.get("contact:website")),
        "phone": str(tags.get("phone") or tags.get("contact:phone") or "").strip(),
        "email": str(tags.get("email") or tags.get("contact:email") or "").strip(),
        "industry": str(tags.get("industry") or tags.get("industrial") or "").strip(),
        "osm_tags": {str(key): str(value) for key, value in tags.items() if value is not None},
        "source": "OPENSTREETMAP",
        "source_url": source_url,
    }


def _industry_match(candidate: dict, industry: str) -> str:
    terms = _industry_terms(industry)
    tags = candidate.get("osm_tags") if isinstance(candidate.get("osm_tags"), dict) else {}
    searchable_fields = ("industry", "industrial", "craft", "shop", "amenity", "office")
    tag_text = " ".join(str(tags.get(key) or "") for key in searchable_fields).casefold()
    if any(term.casefold() in tag_text for term in terms):
        return "TAG_MATCH"

    normalized = " ".join(industry.casefold().split())
    if normalized == "mining" and (
        tags.get("landuse") == "quarry"
        or tags.get("man_made") in {"mine", "mineshaft"}
    ):
        return "INDUSTRY_FEATURE_MATCH"

    name = str(candidate.get("name") or "").casefold()
    if any(term.casefold() in name for term in terms):
        return "NAME_MATCH"
    return ""
