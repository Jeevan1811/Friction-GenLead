from __future__ import annotations

import asyncio
import json
from types import SimpleNamespace

from app.models.enums import SyncState
from app.routers import data
from app.routers import operations
from app.routers.operations import StartResearchRequest
from app.services.crawler import CrawlResult, ExtractedContact
from app.services.jev import Jev, PipelineStep, ResearchJob


def test_research_request_accepts_a_worldwide_location():
    request = StartResearchRequest(
        location="Vancouver, British Columbia, Canada",
        industry="Mining",
        roles=["Operations Manager"],
    )

    assert request.location == "Vancouver, British Columbia, Canada"
    assert request.industry == "Mining"
    assert request.roles == ["Operations Manager"]


def test_production_research_pipeline_wires_web_search_alongside_overture():
    assert operations.jev.places is not None
    assert operations.jev.web_search is not None


def test_web_search_candidates_are_saved_without_fabricated_site_locations():
    candidate = {
        "provider_id": "firecrawl:northstar-mining.com.au",
        "name": "Northstar Mining Services",
        "source": "FIRECRAWL_SEARCH",
        "website": "https://northstar-mining.com.au/about",
        "source_url": "https://northstar-mining.com.au/about",
        "country": "Australia",
        "country_code": "au",
        "state": "Queensland",
        "source_provenance": {
            "provider": "Firecrawl web search",
            "provider_id": "firecrawl:northstar-mining.com.au",
            "result_title": "Northstar Mining Services | Gladstone",
            "description": "Industrial contractor",
            "query": "Heavy Industry companies in Gladstone, Queensland",
        },
        "source_quality_flags": (
            "WEB_SEARCH_CANDIDATE; COMPANY_IDENTITY_UNVERIFIED; INDUSTRY_UNVERIFIED; "
            "WEBSITE_OWNERSHIP_UNVERIFIED; OPERATING_SITE_UNVERIFIED"
        ),
    }

    class PublicPlaces:
        last_warnings: list[str] = []

        async def search(self, _location: str, _industry: str | None = None):
            return []

    class PublicWebSearch:
        last_warnings: list[str] = ["Web results are unverified candidates; review before use."]

        async def search(self, location: str, industry: str | None = None):
            assert location == "Gladstone, Queensland, Australia"
            assert industry == "Heavy Industry"
            return [candidate]

    class LiveSheets:
        is_live = True

        def __init__(self):
            self.companies: list[dict] = []
            self.locations: list[dict] = []

        async def read_companies(self):
            return []

        async def read_rejected(self):
            return []

        def tab_read_error(self, _tab: str):
            return None

        async def upsert_company(self, row):
            self.companies.append(row)
            return SyncState.SYNCED

        async def upsert_location(self, row):
            self.locations.append(row)
            return SyncState.SYNCED

    sheets = LiveSheets()
    job = ResearchJob(
        job_id="web-search-candidate-test",
        postcode="",
        location_query="Gladstone, Queensland, Australia",
        industry="Heavy Industry",
        target_roles=[],
        steps=[PipelineStep(name=name) for name in ("discover", "verify", "research_contacts", "evaluate")],
    )

    asyncio.run(Jev(sheets=sheets, places=PublicPlaces(), web_search=PublicWebSearch())._step_discover_public_sources(job))

    assert job.steps[0].status.value == "completed"
    assert len(job.companies_found) == 1
    assert len(sheets.companies) == 1
    assert sheets.companies[0]["source"] == "FIRECRAWL_SEARCH"
    assert "Firecrawl web search" in sheets.companies[0]["source_provenance"]
    assert "COMPANY_IDENTITY_UNVERIFIED" in sheets.companies[0]["source_quality_flags"]
    assert sheets.locations == []


def test_web_search_failure_does_not_discard_overture_candidates():
    candidate = {
        "provider_id": "overture:place-123",
        "name": "Northstar Industrial",
        "source": "OVERTURE_MAPS",
        "source_provenance": {"provider": "Overture Maps Places"},
    }

    class PublicPlaces:
        last_warnings: list[str] = []

        async def search(self, _location: str, _industry: str | None = None):
            return [candidate]

    class FailedWebSearch:
        last_warnings: list[str] = []

        async def search(self, _location: str, _industry: str | None = None):
            raise RuntimeError("web source unavailable")

    class LiveSheets:
        is_live = True

        async def read_companies(self):
            return []

        async def read_rejected(self):
            return []

        def tab_read_error(self, _tab: str):
            return None

        async def upsert_company(self, _row):
            return SyncState.SYNCED

        async def upsert_location(self, _row):
            return SyncState.SYNCED

    job = ResearchJob(
        job_id="web-search-failure-preserves-map-test",
        postcode="",
        location_query="Toronto, Ontario, Canada",
        industry="Mining",
        target_roles=[],
        steps=[PipelineStep(name="discover")],
    )

    asyncio.run(Jev(sheets=LiveSheets(), places=PublicPlaces(), web_search=FailedWebSearch())._step_discover_public_sources(job))

    assert job.steps[0].status.value == "completed"
    assert [row["company_name"] for row in job.companies_found] == ["Northstar Industrial"]
    assert any("web search" in warning.casefold() for warning in job.warnings)


def test_dense_overture_results_do_not_starve_web_results_under_the_30_company_cap():
    place_candidates = [
        {
            "provider_id": f"overture:place-{index}",
            "name": f"Mapped Industrial Company {index}",
            "source": "OVERTURE_MAPS",
            "source_provenance": {"provider": "Overture Maps Places"},
        }
        for index in range(40)
    ]
    web_candidates = [
        {
            "provider_id": f"firecrawl:web-{index}.com",
            "name": f"Web Industrial Company {index}",
            "source": "FIRECRAWL_SEARCH",
            "website": f"https://web-{index}.com/",
            "source_url": f"https://web-{index}.com/",
            "source_provenance": {"provider": "Firecrawl web search"},
        }
        for index in range(15)
    ]

    class PublicPlaces:
        last_warnings: list[str] = []

        async def search(self, _location: str, _industry: str | None = None):
            return place_candidates

    class PublicWebSearch:
        last_warnings: list[str] = []

        async def search(self, _location: str, _industry: str | None = None):
            return web_candidates

    class LiveSheets:
        is_live = True

        def __init__(self):
            self.companies: list[dict] = []

        async def read_companies(self):
            return []

        async def read_rejected(self):
            return []

        def tab_read_error(self, _tab: str):
            return None

        async def upsert_company(self, row):
            self.companies.append(row)
            return SyncState.SYNCED

        async def upsert_location(self, _row):
            return SyncState.SYNCED

    sheets = LiveSheets()
    job = ResearchJob(
        job_id="source-diversity-limit-test",
        postcode="",
        location_query="Gladstone, Queensland, Australia",
        industry="Heavy Industry",
        target_roles=[],
        steps=[PipelineStep(name="discover")],
    )

    asyncio.run(Jev(sheets=sheets, places=PublicPlaces(), web_search=PublicWebSearch())._step_discover_public_sources(job))

    assert job.steps[0].status.value == "completed"
    assert len(job.companies_found) == 30
    assert sum(row["source"] == "FIRECRAWL_SEARCH" for row in job.companies_found) == 10
    assert any("limited to 10" in warning for warning in job.warnings)


def test_research_results_endpoint_returns_candidate_rows_for_the_ui(monkeypatch):
    job = ResearchJob(
        job_id="result-shape-test",
        postcode="",
        location_query="Perth, Australia",
        industry="Mining",
        target_roles=[],
        status="completed",
        details_available=True,
        companies_found=[{"company_id": "c-1", "company_name": "Northstar"}],
        contacts_found=[{"contact_id": "p-1", "name": "Jordan Lee"}],
    )

    async def get_job(_job_id):
        return job

    async def get_job_results(value):
        return value

    monkeypatch.setattr(operations.jev, "get_job", get_job)
    monkeypatch.setattr(operations.jev, "get_job_results", get_job_results)
    response = asyncio.run(operations.get_research_results(job.job_id))

    assert response["location"] == "Perth, Australia"
    assert response["companies"] == job.companies_found
    assert response["contacts"] == job.contacts_found


def test_no_abn_public_business_candidate_is_saved_with_its_location():
    candidate = {
        "provider_id": "gers:place-12345",
        "name": "Northstar Mining Services",
        "country": "Australia",
        "country_code": "au",
        "state": "Western Australia",
        "postcode": "6000",
        "address": "200 St Georges Terrace",
        "lat": -31.9523,
        "lng": 115.8613,
        "website": "https://northstar.example/",
        "source": "OVERTURE_MAPS",
        "source_url": "https://explore.overturemaps.org/?id=gers%3Aplace-12345",
    }

    class PublicSource:
        last_warnings: list[str] = []

        async def search(self, location: str, industry: str | None = None):
            assert location == "Perth, Western Australia, Australia"
            assert industry == "Mining"
            return [candidate]

    class LiveSheets:
        is_live = True

        def __init__(self):
            self.companies: list[dict] = []
            self.locations: list[dict] = []

        async def read_companies(self):
            return []

        async def read_rejected(self):
            return []

        def tab_read_error(self, _tab: str):
            return None

        async def upsert_company(self, row):
            self.companies.append(row)
            return SyncState.SYNCED

        async def upsert_location(self, row):
            self.locations.append(row)
            return SyncState.SYNCED

    sheets = LiveSheets()
    job = ResearchJob(
        job_id="global-location-test",
        postcode="Perth, Western Australia, Australia",
        industry="Mining",
        target_roles=["Operations Manager"],
        steps=[PipelineStep(name="discover")],
    )

    asyncio.run(Jev(sheets=sheets, places=PublicSource())._step_discover(job))

    assert job.steps[0].status.value == "completed"
    assert len(job.companies_found) == 1
    assert job.companies_found[0]["company_name"] == "Northstar Mining Services"
    assert job.companies_found[0]["abn"] == ""
    assert len(sheets.companies) == 1
    assert sheets.companies[0]["website"] == "https://northstar.example/"
    assert len(sheets.locations) == 1
    assert sheets.locations[0]["lat"] == -31.9523
    assert sheets.locations[0]["lng"] == 115.8613
    assert sheets.locations[0]["country"] == "Australia"


def test_global_discovery_crawls_listed_site_and_persists_full_search_results():
    candidate = {
        "provider_id": "gers:place-77123",
        "name": "Northstar Mining Services",
        "country": "Australia",
        "country_code": "au",
        "state": "Western Australia",
        "postcode": "6000",
        "address": "200 St Georges Terrace",
        "lat": -31.9523,
        "lng": 115.8613,
        "website": "https://northstar.example/",
        "source": "OVERTURE_MAPS",
        "source_url": "https://explore.overturemaps.org/?id=gers%3Aplace-77123",
        "source_provenance": {
            "provider": "Overture Maps Places",
            "release": "2026-09-23.0",
            "sources": [{"dataset": "meta", "license": "CDLA-Permissive-2.0"}],
        },
        "phone": "+61 7 5555 0101",
        "email": "hello@example.invalid",
    }

    class PublicSource:
        last_warnings: list[str] = ["Community-mapped source; review candidates."]

        async def search(self, location: str, industry: str | None = None):
            assert location == "Perth, Western Australia, Australia"
            assert industry == "Mining"
            return [candidate]

    class SiteCrawler:
        async def crawl_site(self, website: str, max_pages: int = 4):
            assert website == "https://northstar.example/"
            assert max_pages == 4
            return [CrawlResult(website, 200, "text/html", "public company site", 1)]

        async def extract_contacts(self, body: str, source_url: str):
            assert body == "public company site"
            return [ExtractedContact(
                "Jordan Lee", "Operations Manager", "jordan@example.com", "+61 8 5555 0101", source_url,
            )]

    class LiveSheets:
        is_live = True

        def __init__(self):
            self.companies: dict[str, dict] = {}
            self.locations: dict[str, dict] = {}
            self.contacts: dict[str, dict] = {}
            self.runs: dict[str, dict] = {}

        async def read_companies(self):
            return list(self.companies.values())

        async def read_rejected(self):
            return []

        def tab_read_error(self, _tab: str):
            return None

        async def upsert_company(self, row):
            self.companies[row["company_id"]] = {**self.companies.get(row["company_id"], {}), **row}
            return SyncState.SYNCED

        async def upsert_location(self, row):
            self.locations[row["location_id"]] = row
            return SyncState.SYNCED

        async def upsert_contact(self, row):
            self.contacts[row["contact_id"]] = row
            return SyncState.SYNCED

        async def upsert_search_run(self, row):
            self.runs[row["job_id"]] = row
            return SyncState.SYNCED

    sheets = LiveSheets()
    job = ResearchJob(
        job_id="global-full-flow-test",
        postcode="",
        location_query="Perth, Western Australia, Australia",
        industry="Mining",
        target_roles=["Operations Manager"],
        steps=[PipelineStep(name=name) for name in ("discover", "verify", "research_contacts", "evaluate")],
    )
    service = Jev(sheets=sheets, places=PublicSource(), crawler=SiteCrawler())

    asyncio.run(service._run_pipeline(job))

    assert job.status == "completed"
    assert job.warnings
    assert len(sheets.companies) == 1
    assert len(sheets.locations) == 1
    assert len(sheets.contacts) == 1
    saved_company = next(iter(sheets.companies.values()))
    assert saved_company["source"] == "OVERTURE_MAPS"
    assert saved_company["business_phone"] == "+61 7 5555 0101"
    assert saved_company["business_email"] == "hello@example.invalid"
    assert '"release": "2026-09-23.0"' in saved_company["source_provenance"]
    assert '"license": "CDLA-Permissive-2.0"' in saved_company["source_provenance"]
    assert next(iter(sheets.contacts.values()))["business_email"] == "jordan@example.com"
    assert next(iter(sheets.locations.values()))["lat"] == -31.9523
    assert sheets.runs[job.job_id]["status"] == "completed"
    assert sheets.runs[job.job_id]["company_ids"] == f'["{next(iter(sheets.companies))}"]'


def test_discovery_skips_provider_id_rejected_in_sheet_even_if_name_changed():
    provider_id = "gers:rejected-place-1"
    candidate = {
        "provider_id": provider_id,
        "name": "Current Place Name",
        "source": "OVERTURE_MAPS",
        "source_provenance": {"provider": "Overture Maps Places"},
    }

    class PublicSource:
        last_warnings: list[str] = []

        async def search(self, location: str, industry: str | None = None):
            return [candidate]

    class LiveSheets:
        is_live = True

        def __init__(self):
            self.company_writes: list[dict] = []

        async def read_companies(self):
            return []

        async def read_rejected(self):
            return [{
                "entity_type": "company",
                "entity_name": "Older Place Name",
                "original_data": json.dumps({
                    "source_provenance": json.dumps({"provider_id": provider_id}),
                }),
            }]

        def tab_read_error(self, _tab: str):
            return None

        async def upsert_company(self, row):
            self.company_writes.append(row)
            return SyncState.SYNCED

        async def upsert_location(self, _row):
            return SyncState.SYNCED

    sheets = LiveSheets()
    job = ResearchJob(
        job_id="rejected-provider-dedupe-test",
        postcode="",
        location_query="Toronto, Canada",
        industry="Mining",
        target_roles=[],
        steps=[PipelineStep(name="discover")],
    )

    asyncio.run(Jev(sheets=sheets, places=PublicSource())._step_discover(job))

    assert job.steps[0].status.value == "completed"
    assert job.companies_found == []
    assert sheets.company_writes == []


def test_locations_api_supplies_labeled_approximate_coordinates_for_au_postcodes(monkeypatch):
    async def read_locations():
        return [{
            "location_id": "legacy-melbourne",
            "company_id": "company-1",
            "site_name": "Melbourne office",
            "state": "VIC",
            "postcode": "3000",
            "lat": "",
            "lng": "",
        }]

    monkeypatch.setattr(data.sheets_adapter, "read_locations", read_locations)
    rows = asyncio.run(data.get_locations())

    assert rows[0]["lat"] == -37.814
    assert rows[0]["lng"] == 144.9633
    assert rows[0]["coordinateSource"] == "POSTCODE_CENTROID"
    assert rows[0]["postcode"] == "3000"


def test_locations_api_never_replaces_precise_coordinates(monkeypatch):
    async def read_locations():
        return [{
            "location_id": "global-site",
            "company_id": "company-2",
            "site_name": "Global site",
            "postcode": "3000",
            "lat": "37.7749",
            "lng": "-122.4194",
        }]

    monkeypatch.setattr(data.sheets_adapter, "read_locations", read_locations)
    rows = asyncio.run(data.get_locations())

    assert rows[0]["lat"] == 37.7749
    assert rows[0]["lng"] == -122.4194
    assert rows[0]["coordinateSource"] == "SHEET"
