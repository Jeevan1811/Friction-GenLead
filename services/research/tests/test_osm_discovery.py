from __future__ import annotations

import asyncio
from urllib.parse import parse_qs

import httpx
import pytest


def test_openstreetmap_discovery_geocodes_once_parses_business_and_caches():
    try:
        from app.services.osm_discovery import OpenStreetMapDiscovery
    except ImportError:
        pytest.fail("OpenStreetMapDiscovery is missing; global company search has no source adapter.")

    requests: list[httpx.Request] = []

    def handle(request: httpx.Request) -> httpx.Response:
        requests.append(request)
        if request.url.host == "nominatim.test":
            assert request.url.params["q"] == "Perth, Western Australia, Australia"
            assert request.url.params["format"] == "jsonv2"
            return httpx.Response(200, json=[{
                "lat": "-31.9523",
                "lon": "115.8613",
                "display_name": "Perth, Western Australia, Australia",
                "address": {
                    "city": "Perth",
                    "state": "Western Australia",
                    "postcode": "6000",
                    "country": "Australia",
                    "country_code": "au",
                },
            }])

        assert request.url.host == "overpass.test"
        form = parse_qs(request.content.decode("utf-8"))
        query = form["data"][0]
        assert "around:5000,-31.9523,115.8613" in query
        assert '"industry"="mining"' in query
        return httpx.Response(200, json={
            "elements": [
                {
                    "type": "node",
                    "id": 12345,
                    "lat": -31.9523,
                    "lon": 115.8613,
                    "tags": {
                        "name": "Northstar Mining Services",
                        "office": "company",
                        "industry": "mining",
                        "website": "https://northstar.example/",
                        "phone": "+61 8 6000 1111",
                        "addr:city": "Perth",
                        "addr:postcode": "6000",
                    },
                },
                {"type": "node", "id": 987, "lat": -31.95, "lon": 115.86, "tags": {"office": "company"}},
            ]
        })

    async def run():
        async with httpx.AsyncClient(transport=httpx.MockTransport(handle)) as client:
            adapter = OpenStreetMapDiscovery(
                client=client,
                nominatim_search_url="https://nominatim.test/search",
                overpass_url="https://overpass.test/api/interpreter",
            )
            first = await adapter.search("Perth, Western Australia, Australia", "Mining")
            second = await adapter.search("Perth, Western Australia, Australia", "Mining")
            return first, second

    first, second = asyncio.run(run())

    assert len(requests) == 2
    assert first == second
    assert len(first) == 1
    assert first[0]["provider_id"] == "node/12345"
    assert first[0]["name"] == "Northstar Mining Services"
    assert first[0]["website"] == "https://northstar.example/"
    assert first[0]["phone"] == "+61 8 6000 1111"
    assert first[0]["lat"] == -31.9523
    assert first[0]["lng"] == 115.8613
    assert first[0]["country"] == "Australia"
    assert first[0]["country_code"] == "au"
    assert first[0]["source"] == "OPENSTREETMAP"
    assert first[0]["source_url"] == "https://www.openstreetmap.org/node/12345"


def test_selected_industry_filters_unrelated_candidates_and_queries_relevant_tags():
    try:
        from app.services.osm_discovery import OpenStreetMapDiscovery
    except ImportError:
        pytest.fail("OpenStreetMapDiscovery is missing; selected-industry search cannot run.")

    overpass_queries: list[str] = []

    def handle(request: httpx.Request) -> httpx.Response:
        if request.url.host == "nominatim.test":
            return httpx.Response(200, json=[{
                "lat": "-31.95", "lon": "115.86", "address": {"country": "Australia"},
            }])
        query = parse_qs(request.content.decode("utf-8"))["data"][0]
        overpass_queries.append(query)
        return httpx.Response(200, json={"elements": [
            {"type": "node", "id": 1, "lat": -31.95, "lon": 115.86,
             "tags": {"name": "Northstar Mining", "office": "company", "industry": "mining"}},
            {"type": "node", "id": 2, "lat": -31.95, "lon": 115.86,
             "tags": {"name": "Generic Accountants", "office": "company", "industry": "accounting"}},
            {"type": "way", "id": 3, "center": {"lat": -31.96, "lon": 115.87},
             "tags": {"name": "Boulder Quarry", "landuse": "quarry"}},
        ]})

    async def run():
        async with httpx.AsyncClient(transport=httpx.MockTransport(handle)) as client:
            adapter = OpenStreetMapDiscovery(
                client=client,
                nominatim_search_url="https://nominatim.test/search",
                overpass_url="https://overpass.test/api/interpreter",
            )
            return await adapter.search("Perth, Australia", "Mining")

    rows = asyncio.run(run())
    assert len(overpass_queries) == 1
    assert '"industry"="mining"' in overpass_queries[0]
    assert '"industrial"="quarry"' in overpass_queries[0]
    assert '"name"~' not in overpass_queries[0]
    assert {row["provider_id"] for row in rows} == {"node/1", "way/3"}
    assert all(row["requested_industry"] == "Mining" for row in rows)


def test_cached_openstreetmap_search_restores_its_own_warnings():
    from app.services.osm_discovery import OpenStreetMapDiscovery

    def handle(request: httpx.Request) -> httpx.Response:
        if request.url.host == "nominatim.test":
            return httpx.Response(200, json=[{
                "lat": "-31.95", "lon": "115.86", "address": {"country": "Australia"},
            }])
        return httpx.Response(200, json={"elements": []})

    async def run():
        async with httpx.AsyncClient(transport=httpx.MockTransport(handle)) as client:
            adapter = OpenStreetMapDiscovery(
                client=client,
                nominatim_search_url="https://nominatim.test/search",
                overpass_url="https://overpass.test/api/interpreter",
            )
            await adapter.search("Perth, Australia", "Mining")
            expected = list(adapter.last_warnings)
            await adapter.search("Sydney, Australia", "Energy")
            actual_second = list(adapter.last_warnings)
            await adapter.search("Perth, Australia", "Mining")
            return expected, actual_second, adapter.last_warnings

    expected, _, restored = asyncio.run(run())
    assert expected
    assert restored == expected


def test_overpass_5xx_uses_only_one_configured_fallback():
    from app.services.osm_discovery import OpenStreetMapDiscovery

    endpoints: list[str] = []

    def handle(request: httpx.Request) -> httpx.Response:
        if request.url.host == "nominatim.test":
            return httpx.Response(200, json=[{"lat": "-31.95", "lon": "115.86", "address": {}}])
        endpoints.append(request.url.host)
        if request.url.host == "primary.test":
            return httpx.Response(504, text="upstream timeout")
        return httpx.Response(200, json={"elements": []})

    async def run():
        async with httpx.AsyncClient(transport=httpx.MockTransport(handle)) as client:
            adapter = OpenStreetMapDiscovery(
                client=client,
                nominatim_search_url="https://nominatim.test/search",
                overpass_url="https://primary.test/api/interpreter",
                overpass_fallback_urls=("https://alternate.test/api/interpreter",),
            )
            rows = await adapter.search("Perth, Australia")
            return rows, adapter.last_warnings

    rows, warnings = asyncio.run(run())
    assert rows == []
    assert endpoints == ["primary.test", "alternate.test"]
    assert any("HTTP 504" in warning for warning in warnings)


def test_overpass_429_does_not_rotate_to_fallback_or_retry_during_cooldown():
    from app.services.osm_discovery import OpenStreetMapDiscovery, PublicSourceError

    endpoint_calls = 0

    def handle(request: httpx.Request) -> httpx.Response:
        nonlocal endpoint_calls
        if request.url.host == "nominatim.test":
            return httpx.Response(200, json=[{"lat": "-31.95", "lon": "115.86", "address": {}}])
        endpoint_calls += 1
        return httpx.Response(429, text="rate limited")

    async def run():
        async with httpx.AsyncClient(transport=httpx.MockTransport(handle)) as client:
            adapter = OpenStreetMapDiscovery(
                client=client,
                nominatim_search_url="https://nominatim.test/search",
                overpass_url="https://primary.test/api/interpreter",
                overpass_fallback_urls=("https://alternate.test/api/interpreter",),
            )
            with pytest.raises(PublicSourceError, match="pause"):
                await adapter.search("Perth, Australia")
            with pytest.raises(PublicSourceError, match="cooling down"):
                await adapter.search("Perth, Australia")

    asyncio.run(run())
    assert endpoint_calls == 1
