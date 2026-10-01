import asyncio

import pytest

from app.routers import data
from app.services.sheets import GoogleSheetsAdapter


def broken_live_adapter():
    adapter = GoogleSheetsAdapter()
    adapter._connected = True
    adapter._mock_mode = False
    adapter._service = object()  # Fails locally, never contacts Google.
    return adapter


def test_failed_sheet_read_is_not_an_empty_success():
    adapter = broken_live_adapter()
    with pytest.raises(RuntimeError, match="Google Sheets"):
        asyncio.run(adapter.read_companies())
    assert adapter.tab_read_error("companies")


def test_failed_counts_are_unknown_and_sync_state_is_error(monkeypatch):
    monkeypatch.setattr(data, "sheets_adapter", broken_live_adapter())
    status = asyncio.run(data.get_sync_status())
    assert status["state"] == "ERROR"
    assert status["companiesCount"] == -1
    assert "companies" in status["readErrors"]


def test_empty_successful_tab_is_still_zero_and_synced(monkeypatch):
    adapter = GoogleSheetsAdapter()
    adapter._connected = True
    adapter._mock_mode = False

    async def empty(_key):
        return []

    monkeypatch.setattr(adapter, "_read_tab", empty)
    monkeypatch.setattr(data, "sheets_adapter", adapter)
    status = asyncio.run(data.get_sync_status())
    assert status["state"] == "SYNCED"
    assert status["companiesCount"] == 0
    assert status["readErrors"] == []


def test_sheet_read_endpoint_returns_retryable_failure_not_an_empty_list(monkeypatch):
    from fastapi.testclient import TestClient
    from app.main import app
    from app.services.auth import require_auth
    monkeypatch.setattr(data, "sheets_adapter", broken_live_adapter())
    app.dependency_overrides[require_auth] = lambda: None
    try:
        response = TestClient(app, raise_server_exceptions=False).get("/internal/data/companies")
    finally:
        app.dependency_overrides.pop(require_auth, None)
    assert response.status_code == 503
    assert "Google Sheets is temporarily unavailable" in response.json()["detail"]
    assert "object" not in response.text


def test_recovered_live_read_clears_the_error(monkeypatch):
    adapter = broken_live_adapter()
    with pytest.raises(RuntimeError):
        asyncio.run(adapter.read_companies())
    async def recovered(_call):
        return {"values": [["company_id", "company_name"], ["test", "Test company"]]}
    monkeypatch.setattr(adapter, "_execute_google", recovered)
    assert len(asyncio.run(adapter.read_companies())) == 1
    assert adapter.tab_read_error("companies") is None


def test_concurrent_dashboard_reads_share_one_google_request(monkeypatch):
    adapter = broken_live_adapter()
    calls = 0
    async def read(_call):
        nonlocal calls
        calls += 1
        await asyncio.sleep(0.01)
        return {"values": [["company_id"], ["test"]]}
    monkeypatch.setattr(adapter, "_execute_google", read)
    async def run():
        results = await asyncio.gather(*(adapter.read_companies() for _ in range(20)))
        assert all(len(result) == 1 for result in results)
    asyncio.run(run())
    assert calls == 1
