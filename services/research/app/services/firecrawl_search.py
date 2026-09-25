"""Bounded, keyless web search for unverified company-site candidates.

Firecrawl expands indexed discovery beyond mapped places, but search results do
not prove company identity, industry, website ownership, or an operating site.
Only generic place/sector queries are sent; result snippets are not persisted.
"""

from __future__ import annotations

import asyncio
import ipaddress
import json
import logging
import re
import time
from collections.abc import Iterable
from typing import Any
from urllib.parse import urlsplit

import httpx

from app.services.osm_discovery import PublicSourceError

logger = logging.getLogger(__name__)

SEARCH_URL = "https://api.firecrawl.dev/v2/search"
USER_AGENT = "FrictionGenLead/1.0 (+https://friction.com.my)"
MAX_SEARCHES = 3
RESULTS_PER_SEARCH = 5
MAX_RESPONSE_BYTES = 1_000_000
SEARCH_CACHE_SECONDS = 6 * 60 * 60
MAX_CACHE_ITEMS = 128
MIN_REQUEST_INTERVAL_SECONDS = 0.5

SEARCH_CANDIDATE_WARNING = (
    "Public web-search results are unverified candidates. Review company identity, sector fit, "
    "website ownership, and current operation before contacting."
)

EXCLUDED_DOMAINS = (
    "yellowpages.com.au",
    "whitepages.com.au",
    "linkedin.com",
    "facebook.com",
    "instagram.com",
    "threads.net",
    "x.com",
    "twitter.com",
    "youtube.com",
    "tiktok.com",
    "wikipedia.org",
    "reddit.com",
    "glassdoor.com",
    "indeed.com",
    "zoominfo.com",
    "crunchbase.com",
    "apollo.io",
    "rocketreach.co",
    "firecrawl.dev",
    "firecrawl.io",
    "google.com",
    "bing.com",
    "duckduckgo.com",
)

LOW_SIGNAL_TITLE = re.compile(
    r"\b(?:directory|directories|business listing|company listings|supplier list|"
    r"members? directory|industry association|trade association|chamber of commerce|"
    r"yellow pages|classifieds?|press release|latest news|news article|top \d+|\blist\b|\bindex\b)",
    re.IGNORECASE,
)
GENERIC_TITLES = {
    "about",
    "about us",
    "contact",
    "contact us",
    "home",
    "official site",
    "official website",
    "services",
    "welcome",
}
EMAIL_OR_URL = re.compile(r"(?:\bhttps?://|\bwww\.|\b[^\s@]+@[^\s@]+\.[^\s@]+)", re.IGNORECASE)
CONTROL_CHARS = re.compile(r"[\x00-\x1f\x7f]")


def _input_text(value: object, *, label: str, maximum: int) -> str:
    text = " ".join(str(value or "").split())
    if not text or len(text) > maximum or CONTROL_CHARS.search(text) or EMAIL_OR_URL.search(text):
        raise ValueError(f"Enter a plain {label} without URLs or email addresses.")
    return text


def _place_label(location: str, place_data: dict[str, Any]) -> str:
    parts: list[str] = []
    for value in (
        place_data.get("locality"),
        place_data.get("region"),
        place_data.get("country"),
    ):
        text = " ".join(str(value or "").split())
        if text and text.casefold() not in {part.casefold() for part in parts}:
            parts.append(text)
    return ", ".join(parts) if parts else location


def _build_queries(location: str, industry: str) -> tuple[str, ...]:
    sector = industry or "business"
    return (
        f"{sector} companies in {location}",
        f"{sector} contractors and services in {location}",
        f"{sector} company official website in {location}",
    )


def _host_for_result(value: object) -> tuple[str, str] | None:
    raw_url = str(value or "").strip()
    if len(raw_url) > 2048:
        return None
    try:
        parts = urlsplit(raw_url)
        host = (parts.hostname or "").encode("idna").decode("ascii").casefold().rstrip(".")
        port = parts.port
    except (UnicodeError, ValueError):
        return None
    if parts.scheme.casefold() not in {"http", "https"} or not host:
        return None
    if parts.username or parts.password or port not in {None, 80, 443}:
        return None
    if host == "localhost" or host.endswith((".localhost", ".local", ".internal", ".example")):
        return None
    try:
        address = ipaddress.ip_address(host)
    except ValueError:
        address = None
    if address is not None and not address.is_global:
        return None
    if "." not in host or host.endswith((".gov", ".gov.au", ".edu", ".edu.au")):
        return None

    canonical_host = host[4:] if host.startswith("www.") else host
    if any(canonical_host == domain or canonical_host.endswith(f".{domain}") for domain in EXCLUDED_DOMAINS):
        return None
    return canonical_host, raw_url


def _candidate_name(title: object) -> str:
    text = " ".join(str(title or "").split())[:240]
    if not text or LOW_SIGNAL_TITLE.search(text):
        return ""
    parts = re.split(r"\s+(?:\||–|—)\s+|\s+-\s+", text)
    for part in parts:
        name = " ".join(part.split()).strip(" :-|–—")
        if len(name) >= 3 and name.casefold() not in GENERIC_TITLES:
            return name[:120]
    return ""


class FirecrawlSearchDiscovery:
    """Run a small localized public-web search and retain only candidate evidence."""

    def __init__(
        self,
        *,
        geocoder: Any,
        client: httpx.AsyncClient | None = None,
        cache_ttl_seconds: int = SEARCH_CACHE_SECONDS,
        minimum_interval_seconds: float = MIN_REQUEST_INTERVAL_SECONDS,
    ) -> None:
        self.geocoder = geocoder
        self.client = client
        self.cache_ttl_seconds = max(0, int(cache_ttl_seconds))
        self.minimum_interval_seconds = max(0.0, float(minimum_interval_seconds))
        self.last_warnings: list[str] = []
        self._search_cache: dict[str, tuple[float, list[dict[str, Any]], list[str]]] = {}
        self._lock = asyncio.Lock()
        self._last_request_at = 0.0

    async def search(self, location: str, industry: str | None = None) -> list[dict[str, Any]]:
        place = _input_text(location, label="location", maximum=160)
        sector = _input_text(industry, label="industry", maximum=80) if industry else ""
        cache_key = f"{place.casefold()}|{sector.casefold()}"
        cached = self._search_cache.get(cache_key)
        if cached and cached[0] > time.monotonic():
            self.last_warnings = list(cached[2])
            return [dict(row) for row in cached[1]]

        async with self._lock:
            cached = self._search_cache.get(cache_key)
            if cached and cached[0] > time.monotonic():
                self.last_warnings = list(cached[2])
                return [dict(row) for row in cached[1]]

            self.last_warnings = []
            try:
                place_data = await self.geocoder.resolve_place(place)
            except Exception as exc:
                logger.warning("Could not localize public web search: %s", type(exc).__name__)
                raise PublicSourceError(
                    "The search location could not be resolved; public web search was not sent."
                ) from exc

            country_code = str(place_data.get("country_code") or "").strip().upper()
            if not re.fullmatch(r"[A-Z]{2}", country_code):
                raise PublicSourceError(
                    "The search location could not be matched to a country; public web search was not sent."
                )
            resolved_location = _place_label(place, place_data)
            queries = _build_queries(resolved_location, sector)
            retrieved_at = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
            candidates: list[dict[str, Any]] = []
            seen_hosts: set[str] = set()
            completed_queries = 0
            failed_request: PublicSourceError | None = None

            async with self._client_context() as client:
                for query in queries[:MAX_SEARCHES]:
                    try:
                        response_rows = await self._request_search(
                            client,
                            query=query,
                            location=resolved_location,
                            country_code=country_code,
                        )
                    except PublicSourceError as exc:
                        failed_request = exc
                        break
                    completed_queries += 1
                    for result in response_rows[:RESULTS_PER_SEARCH]:
                        candidate = self._map_result(
                            result,
                            query=query,
                            location=resolved_location,
                            industry=sector,
                            country=str(place_data.get("country") or ""),
                            country_code=country_code.casefold(),
                            state=str(place_data.get("region") or ""),
                            retrieved_at=retrieved_at,
                        )
                        if not candidate or candidate["provider_id"] in seen_hosts:
                            continue
                        seen_hosts.add(candidate["provider_id"])
                        candidates.append(candidate)

            if failed_request and not completed_queries:
                raise failed_request

            warnings = [SEARCH_CANDIDATE_WARNING]
            if failed_request:
                warnings.append(
                    f"Public web search completed partially ({completed_queries} of {len(queries)} queries); "
                    f"the remaining requests stopped safely ({failed_request})."
                )
            elif not candidates:
                warnings.append(
                    "Public web search found no direct company-site candidates after filtering directories and social profiles."
                )
            self.last_warnings = warnings
            self._cache_result(cache_key, candidates, warnings)
            return [dict(row) for row in candidates]

    async def _request_search(
        self,
        client: httpx.AsyncClient,
        *,
        query: str,
        location: str,
        country_code: str,
    ) -> list[dict[str, Any]]:
        delay = self.minimum_interval_seconds - (time.monotonic() - self._last_request_at)
        if delay > 0:
            await asyncio.sleep(delay)
        self._last_request_at = time.monotonic()
        payload = {
            "query": query,
            "limit": RESULTS_PER_SEARCH,
            "sources": ["web"],
            "location": location,
            "country": country_code,
            "safe": True,
        }
        try:
            async with client.stream("POST", SEARCH_URL, json=payload) as response:
                if response.status_code < 200 or response.status_code >= 300:
                    raise PublicSourceError(
                        f"Firecrawl web search returned HTTP {response.status_code}."
                    )
                body = bytearray()
                async for chunk in response.aiter_bytes():
                    if len(body) + len(chunk) > MAX_RESPONSE_BYTES:
                        raise PublicSourceError("Firecrawl web search response exceeded the safe size limit.")
                    body.extend(chunk)
        except PublicSourceError:
            raise
        except httpx.HTTPError as exc:
            logger.warning("Firecrawl web search request failed: %s", type(exc).__name__)
            raise PublicSourceError("Firecrawl web search is temporarily unavailable.") from exc

        try:
            payload_data = json.loads(body)
        except (UnicodeDecodeError, json.JSONDecodeError) as exc:
            raise PublicSourceError("Firecrawl web search returned invalid JSON.") from exc
        if not isinstance(payload_data, dict) or payload_data.get("success") is False:
            raise PublicSourceError("Firecrawl web search did not complete successfully.")
        data = payload_data.get("data")
        if not isinstance(data, dict):
            raise PublicSourceError("Firecrawl web search returned an invalid result set.")
        rows = data.get("web", [])
        if not isinstance(rows, list):
            raise PublicSourceError("Firecrawl web search returned an invalid result list.")
        return [row for row in rows[:RESULTS_PER_SEARCH] if isinstance(row, dict)]

    def _map_result(
        self,
        result: dict[str, Any],
        *,
        query: str,
        location: str,
        industry: str,
        country: str,
        country_code: str,
        state: str,
        retrieved_at: str,
    ) -> dict[str, Any] | None:
        metadata = result.get("metadata") if isinstance(result.get("metadata"), dict) else {}
        title = result.get("title") or metadata.get("title")
        name = _candidate_name(title)
        parsed = _host_for_result(result.get("url") or metadata.get("url"))
        if not name or not parsed:
            return None
        host, website = parsed
        provider_id = f"firecrawl:{host}"
        source_url = str(result.get("url") or metadata.get("url") or "")[:2048]
        return {
            "provider_id": provider_id,
            "name": name,
            "source": "FIRECRAWL_SEARCH",
            "website": website,
            "source_url": source_url,
            "country": country,
            "country_code": country_code,
            "state": state,
            "source_quality_flags": (
                "WEB_SEARCH_CANDIDATE; COMPANY_IDENTITY_UNVERIFIED; INDUSTRY_UNVERIFIED; "
                "WEBSITE_OWNERSHIP_UNVERIFIED; OPERATING_SITE_UNVERIFIED"
            ),
            "source_provenance": {
                "provider": "Firecrawl web search",
                "provider_id": provider_id,
                "result_title": str(title or "")[:240],
                "record_url": source_url,
                "query": query[:320],
                "location_query": location[:200],
                "requested_industry": industry,
                "retrieved_at": retrieved_at,
                "attribution": "Public web search result; company identity and website ownership are unverified.",
            },
        }

    def _cache_result(
        self,
        key: str,
        candidates: Iterable[dict[str, Any]],
        warnings: list[str],
    ) -> None:
        if self.cache_ttl_seconds <= 0:
            return
        self._search_cache[key] = (
            time.monotonic() + self.cache_ttl_seconds,
            [dict(row) for row in candidates],
            list(warnings),
        )
        if len(self._search_cache) > MAX_CACHE_ITEMS:
            oldest_key = min(self._search_cache, key=lambda item: self._search_cache[item][0])
            self._search_cache.pop(oldest_key, None)

    def _client_context(self):
        if self.client is not None:
            return _ExistingClientContext(self.client)
        return httpx.AsyncClient(
            timeout=httpx.Timeout(20.0),
            headers={
                "User-Agent": USER_AGENT,
                "Accept": "application/json",
                "Content-Type": "application/json",
            },
            follow_redirects=False,
            trust_env=False,
        )


class _ExistingClientContext:
    def __init__(self, client: httpx.AsyncClient) -> None:
        self.client = client

    async def __aenter__(self) -> httpx.AsyncClient:
        return self.client

    async def __aexit__(self, *_exc_info: object) -> None:
        return None
