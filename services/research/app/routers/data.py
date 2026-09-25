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

from datetime import datetime, timezone
from typing import Any, Literal
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field, field_validator, model_validator

from ..services.auth import require_auth
from ..models.enums import SyncState
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
    "lastVerified", "notes", "sourceVerification", "businessLandlines",
    "legacySourceText", "sourceProvenance", "sourceQualityFlags",
    "address", "suburb", "lat", "lng",
    "locationId", "position", "roleBucket", "businessEmail", "mobile",
    "landline", "professionalUrl", "rawPostcode", "professionalUrlRaw",
})


class ActivityCreate(BaseModel):
    model_config = {"populate_by_name": True}

    activity_id: UUID = Field(alias="activityId")
    contact_id: str | None = Field(default=None, alias="contactId", max_length=100)
    activity_type: Literal["call", "email", "meeting", "note"] = Field(alias="activityType")
    outcome: str | None = Field(default=None, max_length=160)
    notes: str = Field(min_length=1, max_length=4000)
    happened_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc), alias="happenedAt")
    follow_up_at: datetime | None = Field(default=None, alias="followUpAt")

    @field_validator("notes")
    @classmethod
    def notes_must_not_be_blank(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("Add a note before saving this activity.")
        return value

    @field_validator("happened_at", "follow_up_at")
    @classmethod
    def normalize_datetime(cls, value: datetime | None) -> datetime | None:
        if value is not None and value.tzinfo is None:
            return value.replace(tzinfo=timezone.utc)
        return value

    @model_validator(mode="after")
    def follow_up_after_activity(self):
        if self.follow_up_at and self.follow_up_at <= self.happened_at:
            raise ValueError("The follow-up must be scheduled after this activity.")
        return self


class FollowUpUpdate(BaseModel):
    completed: bool


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


@router.get("/source-records")
async def get_source_records(
    q: str = Query(default="", max_length=200),
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=50, ge=1, le=200),
) -> dict[str, Any]:
    """Search and page through lossless source rows imported from MSV's workbooks."""
    rows = await sheets_adapter.read_source_records()
    query = q.strip().casefold()
    if query:
        rows = [
            row for row in rows
            if any(
                query in str(value or "").casefold()
                for key, value in row.items()
                if key not in {"source_sha256"}
            )
        ]
    rows.sort(
        key=lambda row: (
            str(row.get("source_workbook", "")),
            str(row.get("source_sheet", "")),
            int(row.get("source_row", 0) or 0) if str(row.get("source_row", "0")).isdigit() else 0,
            str(row.get("source_record_id", "")),
        )
    )
    total = len(rows)
    start = (page - 1) * page_size
    return {
        "items": _rows_to_camel_case(rows[start : start + page_size]),
        "total": total,
        "page": page,
        "page_size": page_size,
    }


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


@router.get("/companies/{company_id}/activities")
async def get_company_activities(company_id: str) -> list[dict[str, Any]]:
    """Read a company's append-only call, note, and follow-up timeline."""
    companies = await sheets_adapter.read_companies()
    if not any(str(row.get("company_id")) == company_id for row in companies):
        raise HTTPException(status_code=404, detail="Company not found")
    rows = await sheets_adapter.read_activities(company_id)
    rows.sort(key=lambda row: str(row.get("happened_at", "")), reverse=True)
    return _rows_to_camel_case(rows)


@router.post("/companies/{company_id}/activities", status_code=201)
async def create_company_activity(
    company_id: str, request: ActivityCreate
) -> dict[str, Any]:
    """Append an activity and confirm it reached the live Google Sheet."""
    companies = await sheets_adapter.read_companies()
    if not any(str(row.get("company_id")) == company_id for row in companies):
        raise HTTPException(status_code=404, detail="Company not found")

    if request.contact_id:
        contacts = await sheets_adapter.read_contacts(company_id)
        if not any(str(row.get("contact_id")) == request.contact_id for row in contacts):
            raise HTTPException(status_code=422, detail="That contact does not belong to this company.")

    row = {
        "activity_id": str(request.activity_id),
        "company_id": company_id,
        "contact_id": request.contact_id or "",
        "activity_type": request.activity_type,
        "outcome": request.outcome or "",
        "notes": request.notes,
        "happened_at": request.happened_at.isoformat(),
        "follow_up_at": request.follow_up_at.isoformat() if request.follow_up_at else "",
        "follow_up_status": "OPEN" if request.follow_up_at else "",
        "follow_up_completed_at": "",
        "created_at": datetime.now(timezone.utc).isoformat(),
    }

    existing = next(
        (item for item in await sheets_adapter.read_activities(company_id)
         if str(item.get("activity_id")) == row["activity_id"]),
        None,
    )
    if existing:
        comparable = ("company_id", "contact_id", "activity_type", "outcome", "notes", "happened_at", "follow_up_at")
        if any(str(existing.get(key, "")) != str(row.get(key, "")) for key in comparable):
            raise HTTPException(status_code=409, detail="This activity ID was already used for different details.")
        result = SyncState.SYNCED
    else:
        result = await sheets_adapter.append_activity(row)

    status_info = await sheets_adapter.get_sync_status()
    if status_info.get("mode") != "live" or result != SyncState.SYNCED:
        raise HTTPException(
            status_code=503,
            detail="Activity could not be confirmed in the live Google Sheet. Your note was not reported as saved; retry safely.",
        )
    return {**_row_to_camel_case(row), "syncStatus": SyncState.SYNCED.value}


@router.get("/follow-ups")
async def get_follow_ups() -> list[dict[str, Any]]:
    """List scheduled follow-ups across all companies, including overdue items."""
    activities = await sheets_adapter.read_activities()
    company_names = {
        str(row.get("company_id")): row.get("trading_name") or row.get("company_name") or "Company"
        for row in await sheets_adapter.read_companies()
    }
    rows = []
    for activity in activities:
        due_at = str(activity.get("follow_up_at", "")).strip()
        if due_at:
            row = dict(activity)
            row["company_name"] = company_names.get(str(activity.get("company_id")), "Company")
            rows.append(row)
    rows.sort(key=lambda row: str(row.get("follow_up_at", "")))
    return _rows_to_camel_case(rows)


@router.patch("/activities/{activity_id}/follow-up")
async def update_follow_up(activity_id: str, request: FollowUpUpdate) -> dict[str, Any]:
    """Complete or reopen a scheduled follow-up without changing its note."""
    try:
        UUID(activity_id)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail="Invalid activity ID") from exc
    result = await sheets_adapter.complete_follow_up(activity_id, request.completed)
    status_info = await sheets_adapter.get_sync_status()
    if status_info.get("mode") != "live" or result != SyncState.SYNCED:
        raise HTTPException(
            status_code=503,
            detail="Follow-up status could not be confirmed in the live Google Sheet.",
        )
    return {
        "activityId": activity_id,
        "followUpStatus": "COMPLETED" if request.completed else "OPEN",
        "syncStatus": SyncState.SYNCED.value,
    }
