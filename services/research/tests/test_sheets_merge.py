"""Regression tests for the approve/reject data-loss bug.

An approve/reject decision only knows a handful of fields. Before the fix,
the row written back to the Sheet was built from every column with missing
ones defaulting to blank, so approving a company silently wiped its
normalized_name, trading_name, website, industry, ... in the real Sheet.

These run the *real* write path (``_write_row_with_retry``) against a tiny
in-memory fake of the Sheets API.
"""

from __future__ import annotations

import asyncio
import re

from app.models.enums import SyncState
from app.services.sheets import GoogleSheetsAdapter
from app.services.sheets_config import SPREADSHEET_TABS


class _Req:
    def __init__(self, fn):
        self._fn = fn

    def execute(self):
        return self._fn()


class FakeSheets:
    """Just enough of the Sheets v4 client: values().get/update/append."""

    def __init__(self):
        self.tabs: dict[str, list[list[str]]] = {}

    def spreadsheets(self):
        return self

    def values(self):
        return self

    def _tab_and_range(self, rng: str):
        tab, _, cells = rng.partition("!")
        return tab, cells

    def get(self, spreadsheetId, range):  # noqa: A002
        def run():
            tab, cells = self._tab_and_range(range)
            rows = self.tabs.get(tab, [])
            m = re.match(r"A(\d+):Z\d+", cells)
            if m:
                n = int(m.group(1))
                return {"values": [rows[n - 1]]} if n <= len(rows) else {}
            return {"values": rows}

        return _Req(run)

    def update(self, spreadsheetId, range, valueInputOption, body):  # noqa: A002
        def run():
            tab, cells = self._tab_and_range(range)
            n = int(re.match(r"A(\d+)", cells).group(1))
            rows = self.tabs.setdefault(tab, [])
            while len(rows) < n:
                rows.append([])
            rows[n - 1] = list(body["values"][0])
            return {}

        return _Req(run)

    def append(self, spreadsheetId, range, valueInputOption, insertDataOption, body):  # noqa: A002
        def run():
            tab, _ = self._tab_and_range(range)
            self.tabs.setdefault(tab, []).append(list(body["values"][0]))
            return {}

        return _Req(run)


def _adapter_with(fake: FakeSheets) -> GoogleSheetsAdapter:
    a = GoogleSheetsAdapter()
    a._connected = True
    a._mock_mode = False
    a._service = fake
    a.spreadsheet_id = "test"
    return a


def _seed_company(fake: FakeSheets) -> list[str]:
    cols = SPREADSHEET_TABS["companies"]["columns"]
    full = {
        "company_id": "cmp_1",
        "abn": "12345678901",
        "company_name": "Acme Mining Pty Ltd",
        "normalized_name": "acme mining",
        "trading_name": "Acme",
        "website": "https://acme.example",
        "industry": "Mining",
        "abn_status": "ACTIVE",
        "status": "NEW",
        "industry_fit": "TARGET",
        "priority": "2",
        "source": "LEGACY_EXCEL",
        "last_verified": "",
        "last_modified": "2026-09-01",
        "notes": "Call in March",
    }
    fake.tabs["Companies"] = [cols, [full[c] for c in cols]]
    return cols


def test_approve_does_not_wipe_other_fields():
    fake = FakeSheets()
    cols = _seed_company(fake)
    adapter = _adapter_with(fake)

    # Exactly what discovery._persist_company_decision sends on Approve.
    decision = {
        "company_id": "cmp_1",
        "abn": "",
        "company_name": "Acme Mining Pty Ltd",
        "status": "APPROVED",
        "last_modified": "2026-09-24T00:00:00+00:00",
        "last_verified": "2026-09-24T00:00:00+00:00",
        "notes": "",
    }
    state = asyncio.run(adapter.upsert_company(decision))
    assert state == SyncState.SYNCED

    row = dict(zip(cols, fake.tabs["Companies"][1]))
    assert row["status"] == "APPROVED"
    assert row["last_verified"] == "2026-09-24T00:00:00+00:00"
    # Everything the decision did not supply must survive.
    assert row["normalized_name"] == "acme mining"
    assert row["trading_name"] == "Acme"
    assert row["website"] == "https://acme.example"
    assert row["industry"] == "Mining"
    assert row["industry_fit"] == "TARGET"
    assert row["source"] == "LEGACY_EXCEL"
    assert row["abn"] == "12345678901"  # blank incoming ABN must not erase it
    assert len(fake.tabs["Companies"]) == 2  # updated in place, not appended


def test_user_owned_fields_keep_existing_value():
    fake = FakeSheets()
    cols = _seed_company(fake)
    adapter = _adapter_with(fake)

    asyncio.run(
        adapter.upsert_company(
            {"company_id": "cmp_1", "status": "APPROVED", "notes": "overwritten?", "priority": "9"}
        )
    )
    row = dict(zip(cols, fake.tabs["Companies"][1]))
    assert row["notes"] == "Call in March"
    assert row["priority"] == "2"


def test_new_company_is_appended_with_all_supplied_fields():
    fake = FakeSheets()
    cols = _seed_company(fake)
    adapter = _adapter_with(fake)

    asyncio.run(
        adapter.upsert_company(
            {"company_id": "cmp_2", "company_name": "New Co", "status": "NEW", "website": "https://new.example"}
        )
    )
    assert len(fake.tabs["Companies"]) == 3
    row = dict(zip(cols, fake.tabs["Companies"][2]))
    assert row["company_name"] == "New Co" and row["website"] == "https://new.example"


def test_rejection_is_logged_to_rejected_tab():
    fake = FakeSheets()
    fake.tabs["Rejected"] = [SPREADSHEET_TABS["rejected"]["columns"]]  # real tab always has a header
    adapter = _adapter_with(fake)
    state = asyncio.run(
        adapter.add_rejection(
            entity_type="company",
            entity_id="cmp_1",
            entity_name="Acme Mining Pty Ltd",
            reason="Not relevant",
            original_data={"company_id": "cmp_1"},
        )
    )
    assert state == SyncState.SYNCED
    rows = asyncio.run(adapter.read_rejected())
    assert len(rows) == 1
    assert rows[0]["entity_name"] == "Acme Mining Pty Ltd"
    assert rows[0]["reason"] == "Not relevant"
