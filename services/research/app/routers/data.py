"""Data router -- read-only endpoints exposing live Google Sheets data.

Every dashboard list page in the frontend used to render hardcoded mock
data (`apps/web/src/lib/fixtures.ts`). The Google Sheets adapter
(``services/research/app/services/sheets.py``) already has fully
implemented, already-connected read methods -- this router is just the
thin HTTP surface over them, modeled on ``operations.py``.

Field naming
------------
The adapter returns snake_case dicts matching the column lists in
``sheets_config.SPREADSHEET_TABS`` (e.g. ``company_id``,
``normalized_name``). The frontend's TypeScript interfaces
(``Company``/``Location``/``Contact``/``RejectedEntity`` in
``apps/web/src/lib/types.ts``) use camelCase. Every row returned here is
converted with ``_to_camel_case`` so the JSON matches those interfaces
field-for-field with zero reshaping needed on the frontend.
"""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends

from ..services.auth import require_auth
from ..services.sheets_instance import sheets_adapter

router = APIRouter(
    prefix="/internal/data", tags=["data"], dependencies=[Depends(require_auth)]
)


# ---------------------------------------------------------------------------
# snake_case -> camelCase conversion
# ---------------------------------------------------------------------------

def _snake_to_camel(key: str) -> str:
    """Convert a single snake_case key to camelCase.

    ``company_id`` -> ``companyId``, ``abn_status`` -> ``abnStatus``,
    ``last_verified`` -> ``lastVerified``. A key with no underscores is
    returned unchanged.
    """
    first, *rest = key.split("_")
    return first + "".join(word.capitalize() for word in rest)


def _row_to_camel_case(row: dict[str, Any]) -> dict[str, Any]:
    """Convert every key in a single row dict to camelCase."""
    return {_snake_to_camel(k): v for k, v in row.items()}


# Google Sheets returns every cell as a string, and an empty cell inside a
# row as "" (not None). The frontend's optional fields (`tradingName?`,
# `suburb?`, `position?` ...) are written for null/undefined -- e.g.
# `company.tradingName ?? company.companyName` -- and `"" ?? x` is `""`, so
# an empty trading name used to blank out the real company name. Normalize
# empty strings to None here, once, for every optional field.
_NUMERIC_FIELDS: dict[str, type] = {"priority": int, "lat": float, "lng": float}

# Fields the frontend types as required strings stay "" when empty; only
# fields typed optional in apps/web/src/lib/types.ts are nulled.
_OPTIONAL_FIELDS: frozenset[str] = frozenset({
    "tradingName", "website", "industry", "abnStatus", "priority",
    "lastVerified", "notes",
    "address", "suburb", "lat", "lng",
    "locationId", "position", "roleBucket", "businessEmail", "mobile",
    "landline", "professionalUrl",
})


def _clean_row(row: dict[str, Any]) -> dict[str, Any]:
    out = _row_to_camel_case(row)
    for key in list(out):
        value = out[key]
        if key in _OPTIONAL_FIELDS:
            if value is None or (isinstance(value, str) and not value.strip()):
                out[key] = None
                continue
        if key in _NUMERIC_FIELDS and isinstance(value, str):
            try:
                out[key] = _NUMERIC_FIELDS[key](float(value))
            except ValueError:
                out[key] = None
    return out


def _rows_to_camel_case(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    return [_clean_row(r) for r in rows]


# ---------------------------------------------------------------------------
# GET /internal/data/companies
# ---------------------------------------------------------------------------

@router.get("/companies")
async def get_companies() -> list[dict[str, Any]]:
    """All companies from the Companies tab, camelCase-converted.

    Matches the frontend's ``Company`` interface field-for-field --
    every column in ``SPREADSHEET_TABS["companies"]`` has a direct
    camelCase counterpart on ``Company``.
    """
    rows = await sheets_adapter.read_companies()
    return _rows_to_camel_case(rows)


# ---------------------------------------------------------------------------
# GET /internal/data/locations
# ---------------------------------------------------------------------------

@router.get("/locations")
async def get_locations() -> list[dict[str, Any]]:
    """All locations from the Locations tab, camelCase-converted.

    Matches the frontend's ``Location`` interface field-for-field.
    """
    rows = await sheets_adapter.read_locations()
    return _rows_to_camel_case(rows)


# ---------------------------------------------------------------------------
# GET /internal/data/contacts
# ---------------------------------------------------------------------------

@router.get("/contacts")
async def get_contacts() -> list[dict[str, Any]]:
    """All contacts from the Contacts tab, camelCase-converted.

    Matches the frontend's ``Contact`` interface field-for-field.
    """
    rows = await sheets_adapter.read_contacts()
    return _rows_to_camel_case(rows)


# ---------------------------------------------------------------------------
# GET /internal/data/rejected
# ---------------------------------------------------------------------------

@router.get("/rejected")
async def get_rejected() -> list[dict[str, Any]]:
    """All rejected entities from the Rejected tab, camelCase-converted.

    Matches the frontend's ``RejectedEntity`` interface. One column,
    ``original_data`` (a JSON snapshot of the entity at rejection time),
    has no fixture-era counterpart -- it's passed through as
    ``originalData`` and currently unused by the UI.
    """
    rows = await sheets_adapter.read_rejected()
    return _rows_to_camel_case(rows)


# ---------------------------------------------------------------------------
# GET /internal/data/sync-status
# ---------------------------------------------------------------------------

@router.get("/sync-status")
async def get_sync_status() -> dict[str, Any]:
    """Sync health summary, camelCase-converted, with a derived ``state``.

    ``GoogleSheetsAdapter.get_sync_status()`` returns ``connected``,
    ``mode`` ("mock" | "live"), counts, and ``last_sync`` (``None`` if
    nothing has synced yet -- passed through as-is; the frontend shows
    "Never synced" rather than crashing on a null date).

    That raw shape doesn't map 1:1 onto the four states the sidebar's
    ``<SyncIndicator>`` component expects (SYNCED / PENDING / ERROR /
    NEVER), so a ``state`` field is derived here and added to the
    response before camelCase conversion:

    - not connected                -> "ERROR"
    - connected, mode == "mock"    -> "NEVER"  (no real spreadsheet
                                                 configured yet)
    - connected, mode == "live"    -> "SYNCED"
    """
    status = await sheets_adapter.get_sync_status()

    if not status.get("connected"):
        state = "ERROR"
    elif status.get("mode") != "live":
        state = "NEVER"
    else:
        state = "SYNCED"

    status = {**status, "state": state}
    return _row_to_camel_case(status)
