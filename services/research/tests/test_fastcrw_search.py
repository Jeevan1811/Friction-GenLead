"""Local fastCRW/SearXNG contract tests; never call external search or Sheets."""

import asyncio
import json

import httpx
import pytest

from app.models.enums import SyncState
from app.services.fastcrw_search import FastCRWSearchDiscovery, create_web_search
from app.services.firecrawl_search import FirecrawlSearchDiscovery
from app.services.jev import Jev, PipelineStep, ResearchJob
from app.services.osm_discovery import PublicSourceError


class Geocoder:
    async def resolve_place(self, _location):
        return {
            "locality": "Gladstone",
            "region": "Queensland",
            "country": "Australia",
            "country_code": "au",
        }


@pytest.mark.parametrize("target", [10, 30, 100])
def test_fastcrw_search_returns_requested_unique_bounded_candidates_without_paid_auth(target, monkeypatch):
    monkeypatch.setenv("FIRECRAWL_API_KEY", "must-not-be-forwarded")
    calls = []

    def handler(request):
        assert request.url == "http://127.0.0.1:3127/firecrawl/v2/search"
        assert "authorization" not in request.headers
        payload = json.loads(request.content)
        assert set(payload) == {"query", "limit", "sources", "location", "country", "safe"}
        assert 1 <= payload["limit"] <= 100
        calls.append(payload)
        results = [
            {
                "title": f"Industrial Boiler Supplier {len(calls)} {index}",
                "url": f"https://supplier-{len(calls)}-{index}.com.au/",
            }
            for index in range(payload["limit"])
        ]
        return httpx.Response(200, json={"success": True, "data": {"web": results}})

    async def run():
        async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
            adapter = FastCRWSearchDiscovery(
                geocoder=Geocoder(), client=client, minimum_interval_seconds=0,
            )
            return await adapter.search("Gladstone, Queensland", "Valve-focused", max_results=target)

    candidates = asyncio.run(run())
    assert len(candidates) == target
    assert len(calls) <= 3
    assert all(row["source"] == "FASTCRW_SEARCH" for row in candidates)
    assert all(row["provider_id"].startswith("fastcrw:") for row in candidates)
    assert all(row["source_provenance"]["provider"] == "fastCRW + SearXNG self-hosted search" for row in candidates)
    assert all(not {"lat", "lng", "abn"}.intersection(row) for row in candidates)


def test_provider_switch_is_opt_in_and_invalid_selection_fails_closed(monkeypatch):
    monkeypatch.delenv("GENLEAD_WEB_SEARCH_PROVIDER", raising=False)
    assert type(create_web_search(geocoder=Geocoder())) is FirecrawlSearchDiscovery

    monkeypatch.setenv("GENLEAD_WEB_SEARCH_PROVIDER", "fastcrw")
    assert type(create_web_search(geocoder=Geocoder())) is FastCRWSearchDiscovery

    monkeypatch.setenv("GENLEAD_WEB_SEARCH_PROVIDER", "unknown")
    with pytest.raises(ValueError):
        create_web_search(geocoder=Geocoder())


def test_settings_status_identifies_self_hosted_search_without_a_paid_credential(monkeypatch):
    from fastapi import FastAPI
    from fastapi.testclient import TestClient

    from app.routers import operations
    from app.services.auth import require_auth

    monkeypatch.setattr(operations.jev, "web_search", FastCRWSearchDiscovery(geocoder=Geocoder()))
    app = FastAPI()
    app.include_router(operations.router)
    app.dependency_overrides[require_auth] = lambda: None

    with TestClient(app) as client:
        response = client.get("/internal/ops/provider-status")

    assert response.status_code == 200
    jev = next(row for row in response.json()["services"] if row["id"] == "jev")
    assert jev["credential_status"] == "not_required"
    assert "fastCRW + SearXNG self-hosted search" in jev["sources"]
    assert "does not use Firecrawl" in jev["credential_note"]


def test_factory_loads_only_internal_fastcrw_token_from_protected_runtime_file(tmp_path, monkeypatch):
    token_file = tmp_path / "fastcrw-internal-token"
    token_file.write_text("synthetic-internal-token-with-more-than-32-characters", encoding="utf-8")
    monkeypatch.setenv("GENLEAD_WEB_SEARCH_PROVIDER", "fastcrw")
    monkeypatch.setenv("FASTCRW_API_KEY_FILE", str(token_file))

    adapter = create_web_search(geocoder=Geocoder())

    assert isinstance(adapter, FastCRWSearchDiscovery)
    assert adapter.api_key == ""
    assert adapter._authorization_headers() == {
        "Authorization": "Bearer synthetic-internal-token-with-more-than-32-characters",
    }


@pytest.mark.parametrize("url", [
    "https://provider.example", "http://localhost:3127", "http://10.0.0.3:3127",
    "http://127.0.0.1:3127/path", "http://user:password@127.0.0.1:3127",
    "http://127.0.0.1:3127?token=x", "http://127.0.0.1",
])
def test_fastcrw_endpoint_only_accepts_literal_loopback(url):
    with pytest.raises(ValueError):
        FastCRWSearchDiscovery(geocoder=Geocoder(), base_url=url)


def test_fastcrw_failures_give_searxng_guidance_and_no_fallback():
    calls = []

    def handler(_request):
        calls.append(True)
        return httpx.Response(422, json={"error": "private upstream details"})

    async def run():
        async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
            return await FastCRWSearchDiscovery(geocoder=Geocoder(), client=client).search(
                "Gladstone, Queensland", max_results=100,
            )

    with pytest.raises(PublicSourceError) as error:
        asyncio.run(run())
    assert len(calls) == 1
    assert "SearXNG" in str(error.value)
    assert "private upstream" not in str(error.value)


def test_fastcrw_results_flow_to_fake_sheets_at_the_selected_100_cap_without_fake_locations():
    class FakeSheets:
        is_live = True

        def __init__(self):
            self.companies = []
            self.locations = []

        async def read_companies(self):
            return []

        async def read_locations(self):
            return []

        async def read_rejected(self):
            return []

        def tab_read_error(self, _tab):
            return None

        async def upsert_company(self, row):
            self.companies.append(row)
            return SyncState.SYNCED

        async def upsert_location(self, row):
            self.locations.append(row)
            return SyncState.SYNCED

    def handler(request):
        payload = json.loads(request.content)
        batch = len(calls)
        calls.append(payload)
        return httpx.Response(200, json={"success": True, "data": {"web": [
            {
                "title": f"Wacol Industrial Supplier {batch} {index}",
                "url": f"https://wacol-supplier-{batch}-{index}.com.au/",
            }
            for index in range(payload["limit"])
        ]}})

    calls = []
    sheets = FakeSheets()
    job = ResearchJob(
        job_id="fastcrw-fake-sheet-100",
        postcode="",
        location_query="Wacol, Queensland",
        industry="Valve-focused",
        target_roles=[],
        max_companies=100,
        steps=[PipelineStep(name="discover")],
    )

    async def run():
        async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
            adapter = FastCRWSearchDiscovery(
                geocoder=Geocoder(), client=client, minimum_interval_seconds=0,
            )
            await Jev(sheets=sheets, web_search=adapter)._step_discover_public_sources(job)

    asyncio.run(run())
    assert len(sheets.companies) == len(job.companies_found) == 100
    assert len(calls) <= 3
    assert len(sheets.locations) == 0
    assert all(row["source"] == "FASTCRW_SEARCH" for row in sheets.companies)
    assert job.steps[0].result["requested_new_companies"] == 100
    assert job.steps[0].result["new_company_shortfall"] == 0
