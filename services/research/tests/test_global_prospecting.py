from __future__ import annotations

import asyncio
import json
from types import SimpleNamespace

import pytest

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
        max_companies=100,
    )

    assert request.location == "Vancouver, British Columbia, Canada"
    assert request.industry == "Mining"
    assert request.roles == ["Operations Manager"]
    assert request.max_companies == 100
    assert StartResearchRequest(location="Mackay, Queensland").max_companies == 30


@pytest.mark.parametrize("count", [9, 101])
def test_research_request_rejects_counts_outside_the_supported_range(count):
    from pydantic import ValidationError

    with pytest.raises(ValidationError):
        StartResearchRequest(location="Mackay, Queensland", max_companies=count)


@pytest.mark.parametrize(("target", "expected"), [(10, 10), (100, 100)])
def test_discovery_writes_no_more_than_the_selected_company_target(target, expected):
    candidates = [
        {
            "provider_id": f"overture:target-{index}",
            "name": f"Industrial Prospect {index}",
            "source": "OVERTURE_MAPS",
            "source_provenance": {"provider": "Overture Maps Places"},
        }
        for index in range(105)
    ]

    class PublicPlaces:
        last_warnings: list[str] = []

        async def search(self, _location: str, _industry: str | None = None):
            return candidates

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
        job_id=f"selected-target-{target}",
        postcode="",
        location_query="Gladstone, Queensland, Australia",
        industry="Valve-focused",
        target_roles=[],
        max_companies=target,
        steps=[PipelineStep(name="discover")],
    )

    asyncio.run(
        Jev(sheets=sheets, places=PublicPlaces())._step_discover_public_sources(job)
    )

    assert job.steps[0].status.value == "completed"
    assert len(job.companies_found) == expected
    assert len(sheets.companies) == expected
    assert any("selected limit" in warning.casefold() for warning in job.warnings)


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

        async def search(self, location: str, industry: str | None = None, *, max_results=30):
            assert location == "Gladstone, Queensland, Australia"
            assert industry == "Heavy Industry"
            assert max_results == 30
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


def test_selected_100_target_flows_through_web_discovery_and_saves_without_fake_map_sites():
    candidates = [
        {
            "source": "FASTCRW_SEARCH",
            "provider_id": f"fastcrw:buyer-{index}.com.au",
            "name": f"Wacol Industrial Buyer {index}",
            "website": f"https://buyer-{index}.com.au/",
            "source_url": f"https://buyer-{index}.com.au/",
            "source_provenance": {"provider": "fastCRW + SearXNG self-hosted search"},
        }
        for index in range(100)
    ]

    class PublicWebSearch:
        last_warnings = []

        async def search(self, location, industry=None, *, max_results=30):
            assert location == "Gladstone, Queensland"
            assert industry == "Valve-focused"
            assert max_results == 100
            return candidates

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

    sheets = FakeSheets()
    job = ResearchJob(
        job_id="fastcrw-100-depth-fixture",
        postcode="",
        location_query="Gladstone, Queensland",
        industry="Valve-focused",
        target_roles=[],
        max_companies=100,
        steps=[PipelineStep(name="discover")],
    )
    asyncio.run(Jev(sheets=sheets, web_search=PublicWebSearch())._step_discover_public_sources(job))

    assert len(job.companies_found) == len(sheets.companies) == 100
    assert not sheets.locations
    assert all(row["source"] == "FASTCRW_SEARCH" for row in sheets.companies)
    assert job.steps[0].result["requested_new_companies"] == 100
    assert job.steps[0].result["new_company_shortfall"] == 0


def test_search_shortfall_reports_filtered_duplicates_and_invalid_rows_separately():
    class SparseWebSearch:
        last_warnings = []

        async def search(self, _location, _industry=None, *, max_results=30):
            assert max_results == 100
            return [
                {"source": "FASTCRW_SEARCH", "provider_id": "fastcrw:fresh.example", "name": "Fresh Boiler Services"},
                {"source": "FASTCRW_SEARCH", "provider_id": "fastcrw:fresh.example", "name": "Duplicate Result"},
                {"source": "FASTCRW_SEARCH", "provider_id": "fastcrw:known.example", "name": "Known Industrial Co"},
                {"source": "FASTCRW_SEARCH", "provider_id": "fastcrw:rejected.example", "name": "Rejected Valve Co"},
                {"source": "FASTCRW_SEARCH", "provider_id": "fastcrw:invalid.example", "name": ""},
            ]

    class FakeSheets:
        is_live = True

        def __init__(self):
            self.companies = []

        async def read_companies(self):
            return [{"company_id": "saved-known", "company_name": "Known Industrial Co"}]

        async def read_locations(self):
            return []

        async def read_rejected(self):
            return [{"entity_type": "COMPANY", "entity_name": "Rejected Valve Co", "original_data": "{}"}]

        def tab_read_error(self, _tab):
            return None

        async def upsert_company(self, row):
            self.companies.append(row)
            return SyncState.SYNCED

    job = ResearchJob(
        job_id="fastcrw-shortfall-fixture",
        postcode="",
        location_query="Wacol, Queensland",
        industry="Valve-focused",
        target_roles=[],
        max_companies=100,
        steps=[PipelineStep(name="discover")],
    )
    sheets = FakeSheets()
    asyncio.run(Jev(sheets=sheets, web_search=SparseWebSearch())._step_discover_public_sources(job))

    assert len(sheets.companies) == len(job.companies_found) == 1
    assert job.steps[0].result["requested_new_companies"] == 100
    assert job.steps[0].result["new_company_shortfall"] == 99
    assert job.steps[0].result["already_known_or_rejected_skipped"] == 3
    assert job.steps[0].result["invalid_candidate_rows"] == 1
    assert any("Found 1 of 100" in warning for warning in job.warnings)


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

        async def search(self, _location: str, _industry: str | None = None, *, max_results=30):
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

        async def search(self, _location: str, _industry: str | None = None, *, max_results=30):
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
    assert not any("limited to 10" in warning for warning in job.warnings)


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
        known_companies_found=[{"company_id": "c-2", "company_name": "Existing Northstar"}],
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
    assert response["known_companies"] == job.known_companies_found
    assert response["known_matches_available"] is True
    assert response["contacts"] == job.contacts_found


def test_wacol_area_search_returns_saved_workbook_matches_and_new_prospects_separately():
    candidates = [
        {
            "provider_id": "overture:allnex-duplicate",
            "name": "Allnex",
            "source": "OVERTURE_MAPS",
            "postcode": "4076",
        },
        {
            "provider_id": "overture:new-wacol-prospect",
            "name": "New Wacol Engineering",
            "source": "OVERTURE_MAPS",
            "suburb": "Wacol",
            "postcode": "4076",
            "source_provenance": {"provider": "Overture Maps Places"},
        },
    ]

    class PublicPlaces:
        last_warnings: list[str] = []

        async def search(self, _location: str, _industry: str | None = None):
            return candidates

    class LiveSheets:
        is_live = True

        def __init__(self):
            self.companies = [
                {"company_id": "cmp-allnex", "company_name": "Allnex", "source": "LEGACY_EXCEL"},
                {"company_id": "cmp-air-liquid", "company_name": "Air Liquide", "source": "LEGACY_EXCEL"},
                {"company_id": "cmp-pure", "company_name": "Pure Environmental", "source": "LEGACY_EXCEL"},
            ]
            self.locations = [
                {"location_id": "loc-allnex", "company_id": "cmp-allnex", "suburb": "Brisbane", "state": "QLD", "postcode": "4076"},
                {"location_id": "loc-air-liquid", "company_id": "cmp-air-liquid", "address": "Factory Road, Wacol", "state": "Queensland", "postcode": ""},
                {"location_id": "loc-pure", "company_id": "cmp-pure", "suburb": "Murarrie", "state": "QLD", "postcode": "4172"},
            ]
            self.company_writes: list[dict] = []
            self.location_writes: list[dict] = []
            self.runs: dict[str, dict] = {}

        async def read_companies(self):
            return list(self.companies)

        async def read_locations(self):
            return list(self.locations)

        async def read_rejected(self):
            return []

        def tab_read_error(self, _tab: str):
            return None

        async def upsert_company(self, row):
            self.company_writes.append(row)
            return SyncState.SYNCED

        async def upsert_location(self, row):
            self.location_writes.append(row)
            return SyncState.SYNCED

        async def upsert_search_run(self, row):
            self.runs[row["job_id"]] = row
            return SyncState.SYNCED

    sheets = LiveSheets()
    job = ResearchJob(
        job_id="wacol-saved-and-new-test",
        postcode="",
        location_query="Wacol, Queensland, Australia",
        industry="Valve-focused",
        target_roles=[],
        steps=[PipelineStep(name="discover")],
    )

    service = Jev(sheets=sheets, places=PublicPlaces())
    asyncio.run(service._step_discover_public_sources(job))
    asyncio.run(service._persist_job(job))

    assert job.steps[0].status.value == "completed"
    assert job.result_known_company_ids == ["cmp-allnex", "cmp-air-liquid"]
    assert [row["company_name"] for row in job.known_companies_found] == ["Allnex", "Air Liquide"]
    assert job.known_companies_found[0]["matched_locations"][0]["postcode"] == "4076"
    assert [row["company_name"] for row in job.companies_found] == ["New Wacol Engineering"]
    assert [row["company_name"] for row in sheets.company_writes] == ["New Wacol Engineering"]
    assert [row["postcode"] for row in sheets.location_writes] == ["4076"]
    assert sheets.runs[job.job_id]["known_company_ids"] == '["cmp-allnex", "cmp-air-liquid"]'


def test_area_match_uses_postcode_place_names_without_leaking_sibling_areas():
    from app.services.jev import _location_matches_area

    wacol = {"suburb": "Brisbane", "state": "QLD", "postcode": "4076"}
    pinkenba = {"suburb": "Pinkenba", "state": "QLD", "postcode": "4008"}
    interstate = {"suburb": "Wacol", "state": "VIC", "country": "Australia", "postcode": "4076"}
    postcode_only = {"state": "QLD", "postcode": "4076"}

    assert _location_matches_area("Wacol, Queensland, Australia", wacol)
    assert not _location_matches_area("Wacol, Queensland, Australia", pinkenba)
    assert _location_matches_area("Pinkenba", pinkenba)
    assert not _location_matches_area("Pinkenba", wacol)
    assert not _location_matches_area("Wacol, Victoria", wacol)
    assert not _location_matches_area("Wacol, QLD, Australia", interstate)
    assert not _location_matches_area("Wacol 4008", pinkenba)
    assert _location_matches_area("Wacol 4076 QLD", postcode_only)


def test_saved_area_results_survive_a_locations_read_failure_after_completion():
    class CanonicalSheets:
        async def read_companies(self):
            return [
                {"company_id": "cmp-new", "company_name": "New Prospect"},
                {"company_id": "cmp-saved", "company_name": "Allnex"},
            ]

        async def read_contacts(self):
            return []

        async def read_locations(self):
            raise RuntimeError("synthetic temporary location-tab outage")

    row = {
        "job_id": "saved-result-location-read-retry",
        "location_query": "Wacol, Queensland",
        "postcode": "",
        "status": "completed",
        "companies_found": "1",
        "contacts_found": "0",
        "company_ids": '["cmp-new"]',
        "known_company_ids": '["cmp-saved"]',
        "contact_ids": "[]",
        "details_saved": "true",
    }
    job = Jev._job_from_run_row(row)

    restored = asyncio.run(Jev(sheets=CanonicalSheets()).get_job_results(job))

    assert [item["company_name"] for item in restored.companies_found] == ["New Prospect"]
    assert [item["company_name"] for item in restored.known_companies_found] == ["Allnex"]
    assert restored.known_companies_found[0]["matched_locations"] == []
    assert restored.known_matches_available is False
    assert any("area evidence is unavailable" in warning for warning in restored.warnings)


def test_locations_read_failure_is_reported_without_blocking_new_results():
    candidate = {
        "provider_id": "overture:read-failure-new",
        "name": "New Candidate",
        "source": "OVERTURE_MAPS",
    }

    class PublicPlaces:
        last_warnings: list[str] = []

        async def search(self, _location: str, _industry: str | None = None):
            return [candidate]

    class PartialSheets:
        is_live = True

        async def read_companies(self):
            return []

        async def read_locations(self):
            raise RuntimeError("synthetic location-tab outage")

        async def read_rejected(self):
            return []

        def tab_read_error(self, _tab: str):
            return None

        async def upsert_company(self, _row):
            return SyncState.SYNCED

        async def upsert_location(self, _row):
            return SyncState.SYNCED

    job = ResearchJob(
        job_id="location-read-failure-keeps-discoveries",
        postcode="",
        location_query="Wacol, Queensland",
        industry="Valve-focused",
        target_roles=[],
        steps=[PipelineStep(name="discover")],
    )

    asyncio.run(Jev(sheets=PartialSheets(), places=PublicPlaces())._step_discover_public_sources(job))

    assert job.steps[0].status.value == "completed"
    assert job.known_matches_available is False
    assert job.known_companies_found == []
    assert len(job.companies_found) == 1
    assert any("Locations tab is unavailable" in warning for warning in job.warnings)


def test_saved_area_matches_complete_even_when_every_public_provider_fails(caplog):
    class FailedPublicSource:
        last_warnings: list[str] = []

        async def search(self, _location: str, _industry: str | None = None, *, max_results=30):
            raise RuntimeError("synthetic public provider outage")

    class ReadOnlySheets:
        async def read_companies(self):
            return [{"company_id": "cmp-saved", "company_name": "Allnex", "source": "LEGACY_EXCEL"}]

        async def read_locations(self):
            return [{"company_id": "cmp-saved", "suburb": "Brisbane", "postcode": "4076"}]

        async def read_rejected(self):
            return []

        def tab_read_error(self, _tab: str):
            return None

    job = ResearchJob(
        job_id="saved-wacol-results-survive-provider-outage",
        postcode="",
        location_query="Wacol, Queensland",
        industry="Valve-focused",
        target_roles=[],
        steps=[PipelineStep(name="discover")],
    )

    asyncio.run(
        Jev(
            sheets=ReadOnlySheets(),
            places=FailedPublicSource(),
            web_search=FailedPublicSource(),
        )._step_discover_public_sources(job)
    )

    assert job.steps[0].status.value == "completed"
    assert [row["company_name"] for row in job.known_companies_found] == ["Allnex"]
    assert job.companies_found == []
    assert job.known_matches_available is True
    assert any("saved area matches are still shown" in warning for warning in job.warnings)
    exhaustion_events = [
        json.loads(record.message)
        for record in caplog.records
        if record.message.startswith("{")
        and json.loads(record.message).get("event") == "search.discovery_sources_exhausted"
    ]
    assert exhaustion_events[0]["outcome"] == "saved_only"
    assert exhaustion_events[0]["category"] == "all_sources_failed_saved_matches_available"
    assert exhaustion_events[0]["saved_area_matches"] == 1


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
