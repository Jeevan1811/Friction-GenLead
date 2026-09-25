from __future__ import annotations

import asyncio

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from pydantic import ValidationError

from app.routers import data as data_router
from app.routers import discovery, operations
from app.services.auth import require_auth
from app.services.abr import ABRAdapter
from app.services.jev import Jev, ResearchJob
from app.services.sheets import GoogleSheetsAdapter
from app.routers import discovery as discovery_router
from app.routers.data import ActivityCreate


def _app(*routers) -> FastAPI:
    app = FastAPI()
    for router in routers:
        app.include_router(router)
    app.dependency_overrides[require_auth] = lambda: None
    return app


def test_research_and_verification_routes_never_return_demo_claims():
    app = _app(discovery.router, operations.router)
    with TestClient(app, raise_server_exceptions=False) as client:
        search = client.post("/internal/ops/research", json={"postcode": "4740", "roles": ["Site Manager"]})
        discover = client.post("/internal/discover", json={"postcode": "4740"})
        verify = client.post("/internal/verify/company", json={"companyId": "cmp-1", "abn": "12345678901"})
        contacts = client.post(
            "/internal/research/contacts",
            json={"company_id": "a1b2c3d4-0001-4000-8000-000000000001", "roles": []},
        )

    for response in (search, discover, verify, contacts):
        assert response.status_code == 503
    assert "No sample" in search.json()["detail"]
    assert "No sample" in discover.json()["detail"]
    assert "no verification claim" in verify.json()["detail"]


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


def test_abr_adapter_does_not_fall_back_to_static_demo_companies():
    with pytest.raises(RuntimeError, match="not implemented"):
        asyncio.run(ABRAdapter().search_by_postcode("4000"))


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
