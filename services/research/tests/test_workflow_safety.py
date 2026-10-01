from __future__ import annotations

import asyncio
from types import SimpleNamespace

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from pydantic import ValidationError

from app.models.enums import EvidenceSource, SyncState
from app.routers import chat as chat_router
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


@pytest.mark.parametrize("website_key, expected_mode", [("", "not_required"), ("test-access", "configured")])
def test_provider_status_shows_model_and_credential_state_without_exposing_secret(monkeypatch, website_key, expected_mode):
    secret = "sk-this-must-never-reach-the-browser"
    monkeypatch.setattr(chat_router.llm, "api_key", secret)
    monkeypatch.setattr(chat_router.llm, "model", "meta-llama/llama-3.3-70b-instruct")
    monkeypatch.setattr(operations.jev.web_search, "api_key", website_key)

    with TestClient(_app(operations.router)) as client:
        response = client.get("/internal/ops/provider-status")

    assert response.status_code == 200
    services = {service["id"]: service for service in response.json()["services"]}
    assert services["chatbot"]["provider"] == "OpenRouter"
    assert services["chatbot"]["model"] == "meta-llama/llama-3.3-70b-instruct"
    assert services["chatbot"]["credential_status"] == "configured"
    assert services["jev"]["credential_status"] == expected_mode
    assert "Firecrawl" in services["jev"]["credential_note"]
    assert secret not in response.text
    assert "api_key" not in response.text


def test_research_start_provider_limit_explains_the_cause_without_status_code(monkeypatch):
    async def fail_to_start(**_kwargs):
        raise RuntimeError("upstream returned HTTP 402")

    monkeypatch.setattr(operations.jev, "sheets", SimpleNamespace(is_live=True))
    monkeypatch.setattr(operations.jev, "start_research", fail_to_start)

    with TestClient(_app(operations.router)) as client:
        response = client.post(
            "/internal/ops/research",
            json={"location": "Gladstone, Queensland", "industry": "Valve-focused"},
        )

    assert response.status_code == 503
    assert "billing or usage limit" in response.json()["detail"]
    assert "402" not in response.text


def test_research_route_starts_without_returning_demo_claims(monkeypatch):
    async def fake_start_research(**kwargs):
        assert kwargs == {
            "location": "Perth, Western Australia, Australia",
            "industry": "Valve-focused",
            "target_roles": ["Site Manager"],
            "max_companies": 80,
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
            json={
                "location": "Perth, Western Australia, Australia",
                "industry": "Valve-focused",
                "roles": ["Site Manager"],
                "max_companies": 80,
            },
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


def test_get_job_recovers_persisted_running_run_as_interrupted():
    row = {
        "job_id": "interrupted-after-process-restart",
        "postcode": "4740",
        "location_query": "Mackay, Queensland",
        "industry": "Valve-focused",
        "status": "running",
        "created_at": "2026-09-29T00:00:00+00:00",
        "updated_at": "2026-09-29T00:01:00+00:00",
        "companies_found": "3",
        "contacts_found": "0",
    }

    class PersistedRuns:
        async def read_search_runs(self):
            return [row]

    recovered = asyncio.run(Jev(sheets=PersistedRuns()).get_job(row["job_id"]))

    assert recovered is not None
    assert recovered.status == "interrupted"
    assert recovered.companies_count == 3
    assert any("server restarted" in message.lower() for message in recovered.errors)


def test_unexpected_background_task_exit_is_saved_as_a_terminal_failure():
    async def scenario():
        job = ResearchJob(
            job_id="unexpected-task-exit",
            postcode="4740",
            industry=None,
            target_roles=[],
        )
        service = Jev()
        from app.services import jev as jev_module

        jev_module._jobs[job.job_id] = job
        failed_task = asyncio.get_running_loop().create_future()
        failed_task.set_exception(RuntimeError("synthetic hidden detail"))
        service._background_tasks[job.job_id] = failed_task
        service._on_background_task_done(job.job_id, failed_task)
        await asyncio.sleep(0)

        assert job.status == "failed"
        assert any("stopped unexpectedly" in message.lower() for message in job.errors)
        for task in service._background_tasks.values():
            task.cancel()
        if service._background_tasks:
            await asyncio.gather(*service._background_tasks.values(), return_exceptions=True)

    asyncio.run(scenario())


def test_public_job_errors_explain_known_failures_without_forwarding_raw_details():
    messages = operations._public_job_errors([
        "Pipeline error: HTTP 401 rejected credential=synthetic-secret-value",
        "The server restarted while this search was running. Companies already saved remain available.",
    ])

    assert any("denied access" in message.lower() for message in messages)
    assert any("server restarted" in message.lower() for message in messages)
    assert "synthetic-secret-value" not in " ".join(messages)


def test_start_research_returns_while_initial_sheet_persistence_is_slow():
    async def scenario():
        release_write = asyncio.Event()
        write_started = asyncio.Event()

        class SlowSheets:
            is_live = True

            async def upsert_search_run(self, _run):
                write_started.set()
                await release_write.wait()
                return SyncState.SYNCED

        service = Jev(sheets=SlowSheets())
        try:
            job = await asyncio.wait_for(
                service.start_research("Mackay, Queensland", "Valve-focused"),
                timeout=0.1,
            )
            assert job.status == "running"
            await asyncio.wait_for(write_started.wait(), timeout=0.1)
        finally:
            release_write.set()
            for task in getattr(service, "_background_tasks", {}).values():
                task.cancel()
            if getattr(service, "_background_tasks", {}):
                await asyncio.gather(*service._background_tasks.values(), return_exceptions=True)

    asyncio.run(scenario())


def test_saved_company_ids_recover_run_details_when_legacy_flag_is_false():
    row = {
        "job_id": "persisted-run-recovery-after-restart",
        "postcode": "",
        "location_query": "Wacol, Queensland, Australia",
        "industry": "Heavy Industry",
        "roles": "[]",
        "status": "completed",
        "companies_found": "1",
        "contacts_found": "0",
        "created_at": "2026-09-25T00:00:00+00:00",
        "updated_at": "2026-09-25T00:01:00+00:00",
        "company_ids": '["cmp-persisted"]',
        "known_company_ids": '["cmp-existing"]',
        "contact_ids": "[]",
        "details_saved": "false",
    }

    class CanonicalSheets:
        async def read_companies(self):
            return [
                {"company_id": "cmp-persisted", "company_name": "Northstar Industrial"},
                {"company_id": "cmp-existing", "company_name": "Existing Wacol Company"},
            ]

        async def read_contacts(self):
            return []

        async def read_locations(self):
            return [{"company_id": "cmp-existing", "suburb": "Wacol", "postcode": "4076"}]

    restored_job = Jev._job_from_run_row(row)
    restored = asyncio.run(Jev(sheets=CanonicalSheets()).get_job_results(restored_job))

    assert restored.details_available is True
    assert restored.companies_found == [
        {"company_id": "cmp-persisted", "company_name": "Northstar Industrial"}
    ]
    assert restored.known_companies_found == [
        {
            "company_id": "cmp-existing",
            "company_name": "Existing Wacol Company",
            "matched_locations": [{"company_id": "cmp-existing", "suburb": "Wacol", "postcode": "4076"}],
        }
    ]


def test_saved_run_with_incomplete_ids_fails_closed_instead_of_showing_partial_results():
    row = {
        "job_id": "persisted-run-incomplete-after-restart",
        "postcode": "",
        "location_query": "Gladstone, Queensland, Australia",
        "industry": "Heavy Industry",
        "roles": "[]",
        "status": "completed",
        "companies_found": "2",
        "contacts_found": "0",
        "created_at": "2026-09-25T00:00:00+00:00",
        "updated_at": "2026-09-25T00:01:00+00:00",
        "company_ids": '["cmp-present"]',
        "contact_ids": "[]",
        "details_saved": "true",
    }

    class CanonicalSheets:
        async def read_companies(self):
            return [{"company_id": "cmp-present", "company_name": "Northstar Industrial"}]

        async def read_contacts(self):
            return []

    restored_job = Jev._job_from_run_row(row)

    with pytest.raises(RuntimeError, match="do not match the persisted summary counts"):
        asyncio.run(Jev(sheets=CanonicalSheets()).get_job_results(restored_job))


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
