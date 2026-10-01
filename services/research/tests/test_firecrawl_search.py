from __future__ import annotations

import asyncio
import json

import httpx
import pytest

from app.services.firecrawl_search import FirecrawlSearchDiscovery
from app.services.firecrawl_search import _build_queries
from app.services.firecrawl_search import _candidate_name, _host_for_result
from app.services.osm_discovery import PublicSourceError


class _Geocoder:
    async def resolve_place(self, location: str) -> dict[str, str]:
        assert location == "Gladstone, Queensland"
        return {
            "country": "Australia",
            "country_code": "au",
            "region": "Queensland",
            "locality": "Gladstone",
        }


def test_missing_access_key_never_sends_an_unauthenticated_request():
    async def run():
        def unexpected_request(request):
            pytest.fail("Missing credentials must not call the hosted provider")
        async with httpx.AsyncClient(transport=httpx.MockTransport(unexpected_request)) as client:
            service = FirecrawlSearchDiscovery(geocoder=_Geocoder(), client=client, api_key="")
            await service.search("Gladstone, Queensland", "Mining")
    with pytest.raises(PublicSourceError, match="Website discovery is not configured"):
        asyncio.run(run())


@pytest.mark.parametrize("url", ["https://supplier.com/catalog.PDF", "https://supplier.com/report.xlsx?download=1", "https://supplier.com/directory.doc"])
def test_document_downloads_are_not_company_websites(url):
    assert _host_for_result(url) is None


def test_pdf_search_title_is_not_a_company_name():
    assert _candidate_name("[PDF] Argentine Companies at BIOFACH 2017") == ""


def _hit(title: str, url: str, description: str = "") -> dict[str, str]:
    return {"title": title, "url": url, "description": description}


def test_valve_focused_web_queries_cover_the_selected_buyer_sectors():
    queries = _build_queries("Gladstone, Queensland", "Valve-focused")

    assert len(queries) == 3
    joined = " ".join(queries).casefold()
    for sector in ("engineering", "boiler", "food processing", "water utility"):
        assert sector in joined


def test_search_is_localized_bounded_authenticated_and_filters_low_signal_domains():
    requests: list[httpx.Request] = []
    batches = [
        [
            _hit("Northstar Mining Services | Gladstone", "https://www.northstar-mining.com.au/about", "Mining contractor"),
            _hit("Northstar Mining Services", "https://northstar-mining.com.au/contact", "Contact"),
            _hit("Gladstone companies directory", "https://yellowpages.com.au/gladstone/mining", "Directory"),
            _hit("Company profile", "https://www.linkedin.com/company/northstar", "Social profile"),
            _hit("Internal tool", "http://127.0.0.1/admin", "Private address"),
            _hit("Qld contractors list", "https://industry-association.example/members", "Member directory"),
        ],
        [_hit("Aestec Services - Civil Construction", "https://aestec.com.au/", "Regional services")],
        [_hit("Welcome", "https://welcome.example/", "Generic landing page")],
    ]

    async def handler(request: httpx.Request) -> httpx.Response:
        requests.append(request)
        assert request.method == "POST"
        assert str(request.url) == "https://api.firecrawl.dev/v2/search"
        assert request.headers["authorization"] == "Bearer test-only"
        body = json.loads(request.content)
        assert body["limit"] == 5
        assert body["sources"] == ["web"]
        assert body["safe"] is True
        assert body["location"] == "Gladstone, Queensland, Australia"
        assert body["country"] == "AU"
        return httpx.Response(200, json={"success": True, "data": {"web": batches[len(requests) - 1]}})

    async def run() -> tuple[FirecrawlSearchDiscovery, list[dict[str, object]]]:
        async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
            service = FirecrawlSearchDiscovery(geocoder=_Geocoder(), client=client, api_key="test-only")
            results = await service.search("Gladstone, Queensland", "Heavy Industry")
            return service, results

    service, results = asyncio.run(run())

    assert len(requests) == 3
    assert all("Gladstone, Queensland" in json.loads(request.content)["query"] for request in requests)
    assert all("Heavy Industry" in json.loads(request.content)["query"] for request in requests)
    assert [row["name"] for row in results] == [
        "Northstar Mining Services",
        "Aestec Services",
    ]
    assert [row["provider_id"] for row in results] == [
        "firecrawl:northstar-mining.com.au",
        "firecrawl:aestec.com.au",
    ]
    assert results[0]["source"] == "FIRECRAWL_SEARCH"
    assert results[0]["website"] == "https://www.northstar-mining.com.au/about"
    assert results[0]["source_quality_flags"] == (
        "WEB_SEARCH_CANDIDATE; COMPANY_IDENTITY_UNVERIFIED; INDUSTRY_UNVERIFIED; "
        "WEBSITE_OWNERSHIP_UNVERIFIED; OPERATING_SITE_UNVERIFIED"
    )
    assert service.last_warnings
    assert "review" in " ".join(service.last_warnings).casefold()


def test_partial_provider_failure_keeps_prior_candidates_without_exposing_body():
    call_count = 0

    async def handler(_request: httpx.Request) -> httpx.Response:
        nonlocal call_count
        call_count += 1
        if call_count == 1:
            return httpx.Response(200, json={
                "success": True,
                "data": {"web": [_hit("Northstar Mining", "https://northstar-mining.com.au/")]},
            })
        return httpx.Response(429, text="private request detail must never be surfaced")

    async def run() -> tuple[FirecrawlSearchDiscovery, list[dict[str, object]]]:
        async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
            service = FirecrawlSearchDiscovery(geocoder=_Geocoder(), client=client, api_key="test-only")
            results = await service.search("Gladstone, Queensland", "Mining")
            return service, results

    service, results = asyncio.run(run())

    assert call_count == 2
    assert len(results) == 1
    warnings = " ".join(service.last_warnings)
    assert "partial" in warnings.casefold()
    assert "private request detail" not in warnings


def test_provider_failure_before_any_result_raises_safe_error_and_does_not_retry():
    call_count = 0

    async def handler(_request: httpx.Request) -> httpx.Response:
        nonlocal call_count
        call_count += 1
        return httpx.Response(429, text="do not surface this")

    async def run() -> None:
        async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
            service = FirecrawlSearchDiscovery(geocoder=_Geocoder(), client=client, api_key="test-only")
            await service.search("Gladstone, Queensland", "Mining")

    with pytest.raises(PublicSourceError, match="limiting requests") as error:
        asyncio.run(run())

    assert call_count == 1
    assert "429" not in str(error.value)
    assert "do not surface" not in str(error.value)


@pytest.mark.parametrize("value", ["https://private.example/path", "owner@example.com"])
def test_search_rejects_private_or_url_like_query_input(value: str):
    async def run() -> None:
        async with httpx.AsyncClient(transport=httpx.MockTransport(lambda _request: httpx.Response(200))) as client:
            service = FirecrawlSearchDiscovery(geocoder=_Geocoder(), client=client, api_key="test-only")
            await service.search(value, "Mining")

    with pytest.raises(ValueError):
        asyncio.run(run())


def test_search_does_not_call_provider_without_resolved_country():
    class UnresolvedGeocoder:
        async def resolve_place(self, _location: str) -> dict[str, str]:
            return {"country": "", "country_code": "", "region": "", "locality": ""}

    async def run() -> None:
        async with httpx.AsyncClient(transport=httpx.MockTransport(lambda _request: httpx.Response(200))) as client:
            service = FirecrawlSearchDiscovery(geocoder=UnresolvedGeocoder(), client=client, api_key="test-only")
            await service.search("Gladstone, Queensland", "Mining")

    with pytest.raises(PublicSourceError, match="country"):
        asyncio.run(run())


def test_identical_search_is_cached_to_bound_provider_usage():
    call_count = 0

    async def handler(_request: httpx.Request) -> httpx.Response:
        nonlocal call_count
        call_count += 1
        return httpx.Response(200, json={
            "success": True,
            "data": {"web": [_hit("Northstar Mining", "https://northstar-mining.com.au/")]},
        })

    async def run() -> tuple[list[dict[str, object]], list[dict[str, object]]]:
        async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
            service = FirecrawlSearchDiscovery(geocoder=_Geocoder(), client=client, api_key="test-only")
            first = await service.search("Gladstone, Queensland", "Mining")
            second = await service.search("Gladstone, Queensland", "Mining")
            return first, second

    first, second = asyncio.run(run())

    assert call_count == 3
    assert first == second
    assert len(first) == 1


def test_credit_limited_search_explains_the_cause_without_showing_status_code():
    async def run() -> None:
        async with httpx.AsyncClient(
            transport=httpx.MockTransport(lambda _request: httpx.Response(402))
        ) as client:
            service = FirecrawlSearchDiscovery(geocoder=_Geocoder(), client=client, api_key="test-only")
            await service.search("Gladstone, Queensland", "Mining")

    with pytest.raises(PublicSourceError) as error:
        asyncio.run(run())

    assert "billing or usage limit" in str(error.value)
    assert "402" not in str(error.value)
