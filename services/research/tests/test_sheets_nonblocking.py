from __future__ import annotations

import asyncio
import threading

from app.services.sheets import GoogleSheetsAdapter


class _Request:
    def __init__(self, result, loop_thread_id: int):
        self._result = result
        self._loop_thread_id = loop_thread_id

    def execute(self):
        assert threading.get_ident() != self._loop_thread_id, (
            "Google Sheets request.execute() must not run on the asyncio event-loop thread"
        )
        return self._result


class _Values:
    def __init__(self, loop_thread_id: int):
        self._loop_thread_id = loop_thread_id

    def get(self, **_kwargs):
        return _Request({"values": [["company_id", "company_name"]]}, self._loop_thread_id)


class _Spreadsheet:
    def __init__(self, loop_thread_id: int):
        self._values = _Values(loop_thread_id)

    def values(self):
        return self._values


class _Service:
    def __init__(self, loop_thread_id: int):
        self._spreadsheet = _Spreadsheet(loop_thread_id)

    def spreadsheets(self):
        return self._spreadsheet


def test_live_sheet_header_read_executes_outside_the_event_loop_thread():
    async def scenario():
        loop_thread_id = threading.get_ident()
        adapter = GoogleSheetsAdapter()
        adapter._connected = True
        adapter._mock_mode = False
        adapter._service = _Service(loop_thread_id)

        assert await adapter._read_tab_headers("companies") == ["company_id", "company_name"]

    asyncio.run(scenario())
