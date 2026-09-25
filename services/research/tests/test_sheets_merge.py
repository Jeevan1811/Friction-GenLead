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
import builtins
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

    @staticmethod
    def _column_number(value: str) -> int:
        result = 0
        for char in value:
            result = result * 26 + ord(char) - 64
        return result - 1

    def get(self, spreadsheetId, range):  # noqa: A002
        def run():
            tab, cells = self._tab_and_range(range)
            rows = self.tabs.get(tab, [])
            m = re.match(r"([A-Z]+)(\d+):([A-Z]+)(\d+)", cells)
            if m:
                start_col, start_row = self._column_number(m.group(1)), int(m.group(2))
                end_col, end_row = self._column_number(m.group(3)), int(m.group(4))
                if start_row > len(rows):
                    return {}
                return {"values": [rows[i - 1][start_col : end_col + 1] for i in builtins.range(start_row, min(end_row, len(rows)) + 1)]}
            return {"values": rows}

        return _Req(run)

    def update(self, spreadsheetId, range, valueInputOption, body):  # noqa: A002
        def run():
            tab, cells = self._tab_and_range(range)
            match = re.match(r"([A-Z]+)(\d+)(?::([A-Z]+)(\d+))?", cells)
            start_col, n = self._column_number(match.group(1)), int(match.group(2))
            rows = self.tabs.setdefault(tab, [])
            while len(rows) < n:
                rows.append([])
            values = list(body["values"][0])
            end_col = self._column_number(match.group(3)) if match.group(3) else start_col + len(values) - 1
            row = rows[n - 1]
            while len(row) <= end_col:
                row.append("")
            row[start_col : end_col + 1] = values
            return {}

        return _Req(run)

    def append(self, spreadsheetId, range, valueInputOption, insertDataOption, body):  # noqa: A002
        def run():
            tab, _ = self._tab_and_range(range)
            self.tabs.setdefault(tab, []).extend([list(row) for row in body["values"]])
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
    fake.tabs["Companies"] = [cols, [full.get(c, "") for c in cols]]
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


def test_partial_update_does_not_round_trip_unowned_columns_or_formulas():
    fake = FakeSheets()
    fake.tabs["Companies"] = [
        ["company_id", "company_name", "status", "notes", "owner_formula"],
        ["cmp_1", "Acme", "NEW", "Call in March", "=1+1"],
    ]
    adapter = _adapter_with(fake)

    assert asyncio.run(adapter.upsert_company({"company_id": "cmp_1", "status": "APPROVED"})) == SyncState.SYNCED
    assert fake.tabs["Companies"][1] == ["cmp_1", "Acme", "APPROVED", "Call in March", "=1+1"]


def test_source_record_append_is_idempotent_and_refuses_hash_conflicts():
    fake = FakeSheets()
    columns = SPREADSHEET_TABS["source_records"]["columns"]
    fake.tabs["SourceRecords"] = [columns]
    adapter = _adapter_with(fake)
    records = [
        {
            "source_record_id": "src-1",
            "record_type": "SOURCE_ROW",
            "company_name": "Acme",
            "source_workbook": "master.xlsx",
            "source_sheet": "Sheet A",
            "source_row": 2,
            "source_field": "Company Name",
            "raw_data_json": '{"cells":[{"value":"Acme"}]}',
            "source_sha256": "hash-1",
        }
    ]

    assert asyncio.run(adapter.append_source_records(records)) == (1, 0)
    assert asyncio.run(adapter.append_source_records(records)) == (0, 1)
    assert len(fake.tabs["SourceRecords"]) == 2
    changed = [{**records[0], "source_sha256": "different"}]
    try:
        asyncio.run(adapter.append_source_records(changed))
    except ValueError as exc:
        assert "refusing to overwrite" in str(exc)
    else:
        raise AssertionError("conflicting source-row content was not rejected")


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


def test_activity_followup_update_preserves_the_original_call_note():
    fake = FakeSheets()
    columns = SPREADSHEET_TABS["activities"]["columns"]
    fake.tabs["Activities"] = [columns]
    adapter = _adapter_with(fake)
    activity = {
        "activity_id": "act-1",
        "company_id": "cmp-1",
        "contact_id": "",
        "activity_type": "call",
        "outcome": "Voicemail",
        "notes": "Call the site manager on Tuesday.",
        "happened_at": "2026-09-25T02:00:00+00:00",
        "follow_up_at": "2026-09-29T02:00:00+00:00",
        "follow_up_status": "OPEN",
        "follow_up_completed_at": "",
        "created_at": "2026-09-25T02:01:00+00:00",
    }

    assert asyncio.run(adapter.append_activity(activity)) == SyncState.SYNCED
    assert asyncio.run(adapter.append_activity(activity)) == SyncState.SYNCED
    assert len(fake.tabs["Activities"]) == 2  # header + one idempotent row
    assert asyncio.run(adapter.complete_follow_up("act-1")) == SyncState.SYNCED

    rows = asyncio.run(adapter.read_activities("cmp-1"))
    assert len(rows) == 1
    assert rows[0]["notes"] == "Call the site manager on Tuesday."
    assert rows[0]["follow_up_status"] == "COMPLETED"
    assert rows[0]["follow_up_completed_at"]


def test_search_run_summary_upsert_is_persistent_and_idempotent():
    fake = FakeSheets()
    columns = SPREADSHEET_TABS["search_runs"]["columns"]
    fake.tabs["SearchRuns"] = [columns]
    adapter = _adapter_with(fake)
    row = {
        "job_id": "job-1",
        "postcode": "4740",
        "industry": "Mining",
        "roles": '["Site Manager"]',
        "status": "completed",
        "companies_found": 4,
        "contacts_found": 2,
        "created_at": "2026-09-25T02:00:00+00:00",
        "updated_at": "2026-09-25T02:05:00+00:00",
        "error_summary": "",
    }

    assert asyncio.run(adapter.upsert_search_run(row)) == SyncState.SYNCED
    row["status"] = "completed"
    row["companies_found"] = 5
    assert asyncio.run(adapter.upsert_search_run(row)) == SyncState.SYNCED

    rows = asyncio.run(adapter.read_search_runs())
    assert len(rows) == 1
    assert rows[0]["companies_found"] == "5"
