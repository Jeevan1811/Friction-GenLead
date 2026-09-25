from __future__ import annotations

import asyncio
from types import SimpleNamespace

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from pydantic import ValidationError

from app.models.enums import EvidenceSource, SyncState
from app.routers import data as data_router
from app.routers import discovery, operations
from app.services.auth import require_auth
from app.services.abr import ABRAdapter, ABREntity
from app.services.jev import Jev, PipelineStep, ResearchJob, StepStatus
from app.services.sheets import GoogleSheetsAdapter
from app.routers import discovery as discovery_router
from app.routers.data import ActivityCreate


def _app(*routers) -> FastAPI:
    app = FastAPI()
    for router in routers:
        app.include_router(router)
    app.dependency_overrides[require_auth] = lambda: None
    return app


def test_research_route_starts_without_returning_demo_claims(monkeypatch):
    async def fake_start_research(**kwargs):
        assert kwargs == {
            "location": "Perth, Western Australia, Australia",
            "industry": None,
            "target_roles": ["Site Manager"],
        }
        return SimpleNamespace(
            job_id="job-public-scrape",
            status="running",
            location_query="Perth, Western Australia, Australia",
            postcode="",
        )

    monkeypatch.setattr(operations.jev, "start_research", fake_start_research)
    monkeypatch.setattr(operations.jev, "sheets", SimpleNamespace(is_live=True))
    app = _app(discovery.router, operations.router)
    with TestClient(app, raise_server_exceptions=False) as client:
        search = client.post(
            "/internal/ops/research",
            json={"location": "Perth, Western Australia, Australia", "roles": ["Site Manager"]},
        )
        discover = client.post("/internal/discover", json={"postcode": "4740"})
        verify = client.post("/internal/verify/company", json={"companyId": "cmp-1", "abn": "12345678901"})
        contacts = client.post(
            "/internal/research/contacts",
            json={"company_id": "a1b2c3d4-0001-4000-8000-000000000001", "roles": []},
        )

    assert search.status_code == 200
    assert search.json()["job_id"] == "job-public-scrape"
    assert "Overture Places" in search.json()["message"]
    assert "public web search" in search.json()["message"]
    assert "ABR name matches" in search.json()["message"]
    assert discover.status_code == 503
    assert contacts.status_code == 503
    assert "No sample" in discover.json()["detail"]
    assert verify.status_code == 422
    assert "checksum-valid ABN" in verify.json()["detail"]


def test_company_verification_uses_public_abr_but_does_not_approve(monkeypatch):
    class FakeABR:
        async def lookup_abn(self, abn: str):
            return ABREntity(
                abn=abn,
                name="Northside Industrial Pty Ltd",
                status="Active",
                state="QLD",
                postcode="4740",
            )

    monkeypatch.setattr(discovery, "ABRAdapter", FakeABR)
    app = _app(discovery.router)
    with TestClient(app) as client:
        response = client.post(
            "/internal/verify/company",
            json={"companyId": "cmp-1", "abn": "19415776361"},
        )

    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "REVIEW"
    assert body["abn_valid"] is True
    assert body["website_reachable"] is None
    assert body["evidence_sources"] == [EvidenceSource.ABR.value]
    assert "does not verify industry" in body["notes"]


def test_contact_research_route_returns_source_backed_unverified_contacts(monkeypatch):
    company_id = "a1b2c3d4-0001-4000-8000-000000000001"
    contact_id = "a1b2c3d4-0001-4000-8000-000000000002"

    class FakeSheets:
        is_live = True

        async def read_companies(self):
            return [{"company_id": company_id, "company_name": "Northside Industrial", "website": "https://example.test"}]

    class FakeJev:
        def __init__(self, sheets):
            self.sheets = sheets
            self.crawler = SimpleNamespace(can_fetch=lambda _url: asyncio.sleep(0, result=True))

        async def _step_research_contacts(self, job):
            job.contacts_found = [{
                "contact_id": contact_id,
                "name": "Taylor Smith",
                "role": "Site Manager",
                "email": "taylor@example.test",
                "phone": "0412 345 678",
            }]
            job.warnings = ["Public source evidence needs review."]

    monkeypatch.setattr(discovery, "sheets_adapter", FakeSheets())
    monkeypatch.setattr(discovery, "Jev", FakeJev)
    app = _app(discovery.router)
    with TestClient(app) as client:
        response = client.post(
            "/internal/research/contacts",
            json={"company_id": company_id, "roles": ["Site Manager"]},
        )

    assert response.status_code == 200
    body = response.json()
    assert body["contacts_found"] == 1
    assert body["contacts"][0]["first_name"] == "Taylor"
    assert body["contacts"][0]["status"] == "NEW"
    assert body["contacts"][0]["source"] == EvidenceSource.OFFICIAL_WEBSITE.value
    assert body["warnings"] == ["Public source evidence needs review."]
    assert body["records_synced"] is True


def test_operator_supplied_website_is_robot_checked_and_synced_before_crawl(monkeypatch):
    company_id = "a1b2c3d4-0001-4000-8000-000000000001"
    company = {
        "company_id": company_id,
        "company_name": "Northside Industrial",
        "website": "",
        "source_verification": "ABR name match only.",
        "source_quality_flags": "ABR_NAME_MATCH_ONLY",
    }
    crawled: list[dict] = []

    class FakeSheets:
        is_live = True

        async def read_companies(self):
            return [company]

        async def upsert_company(self, updated):
            company.update(updated)
            return SyncState.SYNCED

    class FakeCrawler:
        async def can_fetch(self, url):
            assert url == "https://northside.example"
            return True

    class FakeJev:
        def __init__(self, sheets):
            self.sheets = sheets
            self.crawler = FakeCrawler()

        async def _step_research_contacts(self, job):
            crawled.extend(job.companies_found)

    monkeypatch.setattr(discovery, "sheets_adapter", FakeSheets())
    monkeypatch.setattr(discovery, "Jev", FakeJev)
    app = _app(discovery.router)
    with TestClient(app) as client:
        response = client.post(
            "/internal/research/contacts",
            json={"company_id": company_id, "website_url": "https://northside.example"},
        )

    assert response.status_code == 200
    assert company["website"] == "https://northside.example"
    assert "not independently verified" in company["source_verification"]
    assert "WEBSITE_UNVERIFIED" in company["source_quality_flags"]
    assert crawled[0]["website"] == "https://northside.example"


def test_robots_disallowed_operator_website_is_not_saved_or_crawled(monkeypatch):
    company_id = "a1b2c3d4-0001-4000-8000-000000000001"

    class FakeSheets:
        is_live = True

        async def read_companies(self):
            return [{"company_id": company_id, "company_name": "Northside Industrial", "website": ""}]

        async def upsert_company(self, _updated):
            raise AssertionError("Robots-disallowed URLs must not be saved.")

    class FakeCrawler:
        async def can_fetch(self, _url):
            return False

    class FakeJev:
        def __init__(self, sheets):
            self.sheets = sheets
            self.crawler = FakeCrawler()

        async def _step_research_contacts(self, _job):
            raise AssertionError("Robots-disallowed URLs must not be crawled.")

    monkeypatch.setattr(discovery, "sheets_adapter", FakeSheets())
    monkeypatch.setattr(discovery, "Jev", FakeJev)
    app = _app(discovery.router)
    with TestClient(app) as client:
        response = client.post(
            "/internal/research/contacts",
            json={"company_id": company_id, "website_url": "https://northside.example"},
        )

    assert response.status_code == 422
    assert "robots.txt disallows" in response.json()["detail"]


def test_contact_research_reports_sheet_read_failure_not_company_missing(monkeypatch):
    company_id = "a1b2c3d4-0001-4000-8000-000000000001"

    class FailedReadSheets:
        is_live = True

        async def read_companies(self):
            return []

        def tab_read_error(self, tab_key: str):
            return "temporary outage" if tab_key == "companies" else None

    monkeypatch.setattr(discovery, "sheets_adapter", FailedReadSheets())
    app = _app(discovery.router)
    with TestClient(app) as client:
        response = client.post(
            "/internal/research/contacts",
            json={"company_id": company_id},
        )

    assert response.status_code == 503
    assert "could not be read" in response.json()["detail"].lower()


def test_operator_supplied_website_never_overwrites_a_different_saved_domain(monkeypatch):
    company_id = "a1b2c3d4-0001-4000-8000-000000000001"

    class FakeSheets:
        is_live = True

        async def read_companies(self):
            return [{
                "company_id": company_id,
                "company_name": "Northside Industrial",
                "website": "https://northside.example",
            }]

        async def upsert_company(self, _updated):
            raise AssertionError("A conflicting website must not be written.")

    class FakeJev:
        def __init__(self, sheets):
            self.sheets = sheets
            self.crawler = SimpleNamespace(can_fetch=lambda _url: asyncio.sleep(0, result=True))

    monkeypatch.setattr(discovery, "sheets_adapter", FakeSheets())
    monkeypatch.setattr(discovery, "Jev", FakeJev)
    app = _app(discovery.router)
    with TestClient(app) as client:
        response = client.post(
            "/internal/research/contacts",
            json={"company_id": company_id, "website_url": "https://other.example"},
        )

    assert response.status_code == 409
    assert "different website" in response.json()["detail"]


def test_user_approval_is_not_misreported_as_external_verification(monkeypatch):
    adapter = GoogleSheetsAdapter()
    adapter._connected = True
    adapter._mock_mode = True
    monkeypatch.setattr(discovery_router, "sheets_adapter", adapter)
    app = _app(discovery.router)
    with TestClient(app, raise_server_exceptions=False) as client:
        response = client.post(
            "/internal/verify/location",
            json={"locationId": "loc-1", "companyId": "cmp-1", "action": "approve"},
        )
    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "APPROVED"
    assert body["address_confirmed"] is False
    assert body["site_evidence"] == "UNCERTAIN"
    assert body["evidence_sources"] == ["USER"]
    assert "no external" in body["notes"]


def test_abr_public_search_is_configured_without_an_api_guid():
    assert ABRAdapter().is_configured is True


def test_activity_validation_rejects_blank_notes_and_non_future_followup():
    base = {
        "activityId": "a2debc91-c825-4aa4-9a29-03453cf36000",
        "activityType": "call",
        "notes": "Discussed next quarter.",
        "happenedAt": "2026-09-25T10:00:00+00:00",
    }
    with pytest.raises(ValidationError):
        ActivityCreate(**{**base, "notes": "  "})
    with pytest.raises(ValidationError):
        ActivityCreate(**{**base, "followUpAt": "2026-09-25T09:59:00+00:00"})


def test_activity_is_not_reported_saved_when_sheets_is_mock(monkeypatch):
    adapter = GoogleSheetsAdapter()
    adapter._connected = True
    adapter._mock_mode = True
    adapter._companies["cmp-1"] = {"company_id": "cmp-1", "company_name": "Test Co"}
    monkeypatch.setattr(data_router, "sheets_adapter", adapter)
    app = _app(data_router.router)
    with TestClient(app, raise_server_exceptions=False) as client:
        response = client.post(
            "/internal/data/companies/cmp-1/activities",
            json={
                "activityId": "a2debc91-c825-4aa4-9a29-03453cf36000",
                "activityType": "call",
                "notes": "Customer requested a call next month.",
                "happenedAt": "2026-09-25T10:00:00+00:00",
                "followUpAt": "2026-10-01T10:00:00+00:00",
            },
        )
    assert response.status_code == 503
    assert "not reported as saved" in response.json()["detail"]


def test_search_run_summary_survives_service_object_recreation():
    adapter = GoogleSheetsAdapter()
    adapter._connected = True
    job = ResearchJob(
        job_id="job-1",
        postcode="4740",
        industry="Mining",
        target_roles=["Site Manager"],
        status="completed",
        companies_found=[{"company_name": "A"}, {"company_name": "B"}],
        contacts_found=[{"name": "C"}],
    )
    asyncio.run(Jev(sheets=adapter)._persist_job(job))

    restored = asyncio.run(Jev(sheets=adapter).list_jobs())
    assert len(restored) == 1
    assert restored[0].companies_count == 2
    assert restored[0].contacts_count == 1
    assert restored[0].target_roles == ["Site Manager"]
    assert restored[0].details_available is False


def test_jev_pipeline_stages_are_available_on_service():
    service = Jev(sheets=GoogleSheetsAdapter())
    assert callable(service._step_research_contacts)
    assert callable(service._step_evaluate)


def test_failed_company_discovery_does_not_mark_empty_job_completed():
    service = Jev()

    async def fail_discovery(_postcode: str, _industry: str | None = None):
        raise RuntimeError("offline fixture: discovery unavailable")

    service.abr.search_by_postcode = fail_discovery
    job = ResearchJob(
        job_id="job-discovery-failed",
        postcode="4000",
        industry=None,
        target_roles=[],
        steps=[
            PipelineStep(name="discover"),
            PipelineStep(name="verify"),
            PipelineStep(name="research_contacts"),
            PipelineStep(name="evaluate"),
        ],
    )

    asyncio.run(service._run_pipeline(job))

    assert job.status == "failed"
    assert job.steps[0].status == StepStatus.NEEDS_REVIEW
    assert [step.status for step in job.steps[1:]] == [
        StepStatus.PENDING,
        StepStatus.PENDING,
        StepStatus.PENDING,
    ]
    assert job.companies_found == []
    assert any("discovery did not complete" in error.lower() for error in job.errors)
