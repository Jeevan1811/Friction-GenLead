"""PI-003: Google Sheets Adapter for Friction GenLead.

Google Sheets is the persistent store.  This adapter handles read/write
with strict field-ownership semantics, sync tracking, batch operations,
and automatic error recovery.

Field ownership
---------------
USER-OWNED   -- Notes, Priority, Tags, Custom Labels
               The system NEVER overwrites these.  Only the user can edit.

SYSTEM-OWNED -- IDs, created_at, updated_at, verified_at, abn_status, sync_state
               Read-only for the user.  Set by the research pipeline.

SHARED       -- Name, Website, Phone, Address, Industry, ABN, etc.
               Last-write-wins.  Both user and system may update.

Write-failure policy
--------------------
If a Google Sheet write fails, the entity's sync_state is set to PENDING
(never faked as SYNCED).  The UI shows ``Pending`` so the user knows the
data has not been persisted yet.

Credentials
-----------
When ``credentials_path`` is ``None`` the adapter runs in **mock mode**:
all reads return in-memory data and writes succeed immediately.  This lets
the full stack run without a service account during development.
"""

from __future__ import annotations

import json
import logging
import time
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any
from uuid import UUID

from ..models.enums import SyncState
from ..models.schemas import Company, Contact, Location
from .sheets_config import SPREADSHEET_TABS

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Field ownership sets
# ---------------------------------------------------------------------------

USER_OWNED_FIELDS: frozenset[str] = frozenset({
    "notes",
    "priority",
    "tags",
    "custom_labels",
})

SYSTEM_OWNED_FIELDS: frozenset[str] = frozenset({
    "id",
    "created_at",
    "updated_at",
    "verified_at",
    "abn_status",
    "sync_state",
})

# Everything not in USER_OWNED or SYSTEM_OWNED is SHARED (last-write-wins).

# ---------------------------------------------------------------------------
# Sync-log entry
# ---------------------------------------------------------------------------

@dataclass
class SyncLogEntry:
    """A single entry in the SyncLog tab."""

    timestamp: str
    entity_type: str
    entity_id: str
    operation: str  # "insert" | "update" | "delete"
    changed_fields: list[str]
    old_values: dict[str, Any]
    new_values: dict[str, Any]


# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

BATCH_CHUNK_SIZE = 50
MAX_RETRIES = 3
BACKOFF_BASE_SECONDS = 2.0


# ---------------------------------------------------------------------------
# Adapter
# ---------------------------------------------------------------------------

@dataclass
class GoogleSheetsAdapter:
    """Full-featured adapter for Google Sheets integration.

    When ``credentials_path`` is ``None`` the adapter runs in mock mode
    with in-memory storage.  The API surface is identical so callers
    never need to branch on the mode.

    Tab structure
    -------------
    Companies, Locations, Contacts, Rejected, SyncLog

    Column mappings are defined in ``sheets_config.SPREADSHEET_TABS``.
    """

    spreadsheet_id: str | None = None
    credentials_path: str | None = None
    oauth_client_secret_path: str | None = None
    oauth_token_path: str | None = None
    _connected: bool = False
    _mock_mode: bool = True
    _service: Any = None  # google-api-python-client service object

    # In-memory stores for mock mode.
    _companies: dict[str, dict[str, Any]] = field(default_factory=dict)
    _locations: dict[str, dict[str, Any]] = field(default_factory=dict)
    _contacts: dict[str, dict[str, Any]] = field(default_factory=dict)
    _rejections: list[dict[str, Any]] = field(default_factory=list)
    _sync_log: list[SyncLogEntry] = field(default_factory=list)

    # Column configs (class-level constants for quick access).
    COMPANY_COLUMNS: list[str] = field(
        default_factory=lambda: SPREADSHEET_TABS["companies"]["columns"]
    )
    LOCATION_COLUMNS: list[str] = field(
        default_factory=lambda: SPREADSHEET_TABS["locations"]["columns"]
    )
    CONTACT_COLUMNS: list[str] = field(
        default_factory=lambda: SPREADSHEET_TABS["contacts"]["columns"]
    )
    REJECTED_COLUMNS: list[str] = field(
        default_factory=lambda: SPREADSHEET_TABS["rejected"]["columns"]
    )
    SYNC_LOG_COLUMNS: list[str] = field(
        default_factory=lambda: SPREADSHEET_TABS["sync_log"]["columns"]
    )

    # ------------------------------------------------------------------
    # Connection
    # ------------------------------------------------------------------

    async def connect(
        self,
        spreadsheet_id: str | None = None,
        credentials_path: str | None = None,
        oauth_client_secret_path: str | None = None,
        oauth_token_path: str | None = None,
    ) -> None:
        """Authenticate and bind to a specific Google Sheet.

        Two auth paths are supported, tried in this order:

        1. Service account -- if ``credentials_path`` is provided, loads a
           service account JSON key and authenticates against the Google
           Sheets API (unchanged, existing behavior).
        2. OAuth2 user credentials -- if ``oauth_token_path`` is provided
           and the token file exists, loads (and refreshes, if needed) a
           previously-generated user OAuth token. This path exists for
           accounts where Google Cloud org policy blocks service-account
           key creation (``iam.disableServiceAccountKeyCreation``). The
           token itself is generated out-of-band by running
           ``authorize_sheets.py`` once locally -- this method never
           launches an interactive browser consent flow itself.

        If neither path succeeds, falls back to mock mode. A broken or
        missing credential of either kind degrades to mock mode with a
        warning log -- it never raises and never silently pretends to be
        connected.

        Parameters
        ----------
        spreadsheet_id:
            The Google Sheet ID (from the URL).
        credentials_path:
            Path to a service-account JSON key file.
        oauth_client_secret_path:
            Path to an OAuth2 "Desktop app" client secret JSON file. Only
            needed by the standalone ``authorize_sheets.py`` script to
            generate the token; not required here once a token file exists.
        oauth_token_path:
            Path to a previously-generated OAuth2 user token JSON file
            (as written by ``authorize_sheets.py``).
        """
        if spreadsheet_id:
            self.spreadsheet_id = spreadsheet_id
        if credentials_path:
            self.credentials_path = credentials_path
        if oauth_client_secret_path:
            self.oauth_client_secret_path = oauth_client_secret_path
        if oauth_token_path:
            self.oauth_token_path = oauth_token_path

        if self.credentials_path:
            try:
                self._service = self._build_service(self.credentials_path)
                self._mock_mode = False
                logger.info(
                    "Connected to Google Sheets (spreadsheet=%s) with "
                    "service-account credentials.",
                    self.spreadsheet_id,
                )
            except Exception:
                logger.warning(
                    "Failed to authenticate with Google Sheets using a "
                    "service account. Falling back to mock mode.",
                    exc_info=True,
                )
                self._mock_mode = True
        elif self.oauth_token_path:
            try:
                self._service = self._build_service_oauth(
                    self.oauth_client_secret_path, self.oauth_token_path
                )
                self._mock_mode = False
                logger.info(
                    "Connected to Google Sheets (spreadsheet=%s) with "
                    "OAuth2 user credentials.",
                    self.spreadsheet_id,
                )
            except Exception:
                logger.warning(
                    "Failed to authenticate with Google Sheets using an "
                    "OAuth2 user token. Falling back to mock mode.",
                    exc_info=True,
                )
                self._mock_mode = True
        else:
            self._mock_mode = True
            logger.info(
                "Connected to spreadsheet %s in MOCK mode (no credentials).",
                self.spreadsheet_id,
            )

        self._connected = True

        # Ensure all required tabs exist.
        if not self._mock_mode:
            await self._ensure_tabs_exist()

    def _build_service(self, credentials_path: str) -> Any:
        """Build a Google Sheets API service from a service-account key.

        This is structured for the real implementation but currently raises
        if the google libraries are not installed.
        """
        try:
            from google.oauth2.service_account import Credentials
            from googleapiclient.discovery import build

            scopes = ["https://www.googleapis.com/auth/spreadsheets"]
            creds = Credentials.from_service_account_file(
                credentials_path, scopes=scopes
            )
            return build("sheets", "v4", credentials=creds)
        except ImportError:
            raise ImportError(
                "google-auth and google-api-python-client are required "
                "for real Google Sheets integration.  Install them with:\n"
                "  pip install google-auth google-api-python-client"
            )

    def _build_service_oauth(
        self,
        client_secret_path: str | None,
        token_path: str,
    ) -> Any:
        """Build a Google Sheets API service from a saved OAuth2 user token.

        This is the alternative to ``_build_service`` for accounts where
        Google Cloud org policy blocks service-account key creation. It
        loads (and refreshes, if expired) a token file previously written
        by the standalone ``authorize_sheets.py`` script.

        This method NEVER launches an interactive browser consent flow --
        the backend is a server process with no browser attached to it.
        If no valid token is on disk and it cannot be silently refreshed,
        it raises so the caller (``connect()``) can fall back to mock mode.
        """
        try:
            from google.oauth2.credentials import Credentials as UserCredentials
            from google.auth.transport.requests import Request
            from googleapiclient.discovery import build
            import os

            scopes = ["https://www.googleapis.com/auth/spreadsheets"]
            creds = None
            if os.path.exists(token_path):
                creds = UserCredentials.from_authorized_user_file(token_path, scopes)

            if not creds or not creds.valid:
                if creds and creds.expired and creds.refresh_token:
                    creds.refresh(Request())
                else:
                    raise RuntimeError(
                        f"No valid OAuth token at {token_path}. Run "
                        f"`python authorize_sheets.py` first to generate one."
                    )
                with open(token_path, "w") as f:
                    f.write(creds.to_json())

            return build("sheets", "v4", credentials=creds)
        except ImportError:
            raise ImportError(
                "google-auth-oauthlib and google-auth-httplib2 are required "
                "for OAuth2 Google Sheets integration.  Install them with:\n"
                "  pip install google-auth-oauthlib google-auth-httplib2"
            )

    def _ensure_connected(self) -> None:
        """Raise if the adapter has not been connected."""
        if not self._connected:
            raise RuntimeError(
                "GoogleSheetsAdapter is not connected. Call connect() first."
            )

    async def _ensure_tabs_exist(self) -> None:
        """Create any missing tabs with correct headers.

        In mock mode this is a no-op.  In real mode it checks for each
        tab defined in ``SPREADSHEET_TABS`` and creates it with the
        header row if missing.
        """
        if self._mock_mode or not self._service:
            return

        try:
            sheet_metadata = (
                self._service.spreadsheets()
                .get(spreadsheetId=self.spreadsheet_id)
                .execute()
            )
            existing_titles = {
                s["properties"]["title"]
                for s in sheet_metadata.get("sheets", [])
            }

            requests: list[dict] = []
            for tab_key, tab_config in SPREADSHEET_TABS.items():
                tab_name = tab_config["name"]
                if tab_name not in existing_titles:
                    logger.info("Creating missing tab: %s", tab_name)
                    requests.append({
                        "addSheet": {
                            "properties": {"title": tab_name}
                        }
                    })

            if requests:
                self._service.spreadsheets().batchUpdate(
                    spreadsheetId=self.spreadsheet_id,
                    body={"requests": requests},
                ).execute()

                # Write headers for newly created tabs.
                for tab_key, tab_config in SPREADSHEET_TABS.items():
                    tab_name = tab_config["name"]
                    if tab_name not in existing_titles:
                        header_range = f"{tab_name}!A1"
                        self._service.spreadsheets().values().update(
                            spreadsheetId=self.spreadsheet_id,
                            range=header_range,
                            valueInputOption="RAW",
                            body={"values": [tab_config["columns"]]},
                        ).execute()

        except Exception:
            logger.exception("Failed to ensure tabs exist. Continuing anyway.")

    # ------------------------------------------------------------------
    # Reads
    # ------------------------------------------------------------------

    async def read_companies(self) -> list[dict[str, Any]]:
        """Read all companies from the Companies tab."""
        self._ensure_connected()

        if self._mock_mode:
            return list(self._companies.values())

        return await self._read_tab("companies")

    async def read_locations(
        self,
        company_id: str | None = None,
    ) -> list[dict[str, Any]]:
        """Read locations, optionally filtered by company_id."""
        self._ensure_connected()

        if self._mock_mode:
            locations = list(self._locations.values())
            if company_id:
                locations = [
                    loc for loc in locations
                    if loc.get("company_id") == company_id
                ]
            return locations

        rows = await self._read_tab("locations")
        if company_id:
            rows = [r for r in rows if r.get("company_id") == company_id]
        return rows

    async def read_contacts(
        self,
        company_id: str | None = None,
    ) -> list[dict[str, Any]]:
        """Read contacts, optionally filtered by company_id."""
        self._ensure_connected()

        if self._mock_mode:
            contacts = list(self._contacts.values())
            if company_id:
                contacts = [
                    c for c in contacts
                    if c.get("company_id") == company_id
                ]
            return contacts

        rows = await self._read_tab("contacts")
        if company_id:
            rows = [r for r in rows if r.get("company_id") == company_id]
        return rows

    async def read_rejected(self) -> list[dict[str, Any]]:
        """Read the rejection log."""
        self._ensure_connected()

        if self._mock_mode:
            return list(self._rejections)

        return await self._read_tab("rejected")

    async def _read_tab(self, tab_key: str) -> list[dict[str, Any]]:
        """Read all rows from a tab and return as list of dicts."""
        tab_config = SPREADSHEET_TABS[tab_key]
        tab_name = tab_config["name"]
        columns = tab_config["columns"]

        try:
            result = (
                self._service.spreadsheets()
                .values()
                .get(
                    spreadsheetId=self.spreadsheet_id,
                    range=f"{tab_name}!A:Z",
                )
                .execute()
            )
            rows = result.get("values", [])
            if len(rows) <= 1:
                return []  # Only header row or empty.

            # Skip header row, map to dicts.
            records: list[dict[str, Any]] = []
            for row in rows[1:]:
                record: dict[str, Any] = {}
                for i, col in enumerate(columns):
                    record[col] = row[i] if i < len(row) else None
                records.append(record)
            return records

        except Exception:
            logger.exception("Failed to read tab %s", tab_name)
            return []

    # ------------------------------------------------------------------
    # Writes (with field-ownership enforcement)
    # ------------------------------------------------------------------

    async def upsert_company(self, company: dict[str, Any]) -> SyncState:
        """Write a company to the sheet, preserving user-owned fields.

        If the company already exists (matched by ``company_id``),
        user-owned fields are preserved from the existing record.

        Returns the resulting sync state.  On failure returns PENDING,
        never SYNCED.
        """
        self._ensure_connected()
        company_id = str(company.get("company_id") or company.get("id", ""))

        try:
            if self._mock_mode:
                existing = self._companies.get(company_id)
                if existing:
                    # Preserve user-owned fields.
                    for fld in USER_OWNED_FIELDS:
                        if fld in existing:
                            company[fld] = existing[fld]

                now = datetime.now(timezone.utc).isoformat()
                company["last_modified"] = now
                self._companies[company_id] = company

                # Log to sync log.
                operation = "update" if existing else "insert"
                self._log_sync(
                    entity_type="company",
                    entity_id=company_id,
                    operation=operation,
                    changed_fields=list(company.keys()),
                    old_values=existing or {},
                    new_values=company,
                )

                logger.info("Upserted company %s (mock)", company_id)
                return SyncState.SYNCED

            # Real mode: write to Google Sheets with retry.
            return await self._write_row_with_retry(
                tab_key="companies",
                row_id=company_id,
                row_data=company,
                id_column="company_id",
            )

        except Exception:
            logger.exception("Failed to upsert company %s", company_id)
            return SyncState.PENDING

    async def upsert_location(self, location: dict[str, Any]) -> SyncState:
        """Write a location to the sheet.

        Returns the resulting sync state.
        """
        self._ensure_connected()
        location_id = str(location.get("location_id") or location.get("id", ""))

        try:
            if self._mock_mode:
                existing = self._locations.get(location_id)
                now = datetime.now(timezone.utc).isoformat()
                location["last_modified"] = now
                self._locations[location_id] = location

                operation = "update" if existing else "insert"
                self._log_sync(
                    entity_type="location",
                    entity_id=location_id,
                    operation=operation,
                    changed_fields=list(location.keys()),
                    old_values=existing or {},
                    new_values=location,
                )

                logger.info("Upserted location %s (mock)", location_id)
                return SyncState.SYNCED

            return await self._write_row_with_retry(
                tab_key="locations",
                row_id=location_id,
                row_data=location,
                id_column="location_id",
            )

        except Exception:
            logger.exception("Failed to upsert location %s", location_id)
            return SyncState.PENDING

    async def upsert_contact(self, contact: dict[str, Any]) -> SyncState:
        """Write a contact to the sheet, preserving user-owned fields.

        Returns the resulting sync state.
        """
        self._ensure_connected()
        contact_id = str(contact.get("contact_id") or contact.get("id", ""))

        try:
            if self._mock_mode:
                existing = self._contacts.get(contact_id)
                if existing:
                    for fld in USER_OWNED_FIELDS:
                        if fld in existing:
                            contact[fld] = existing[fld]

                now = datetime.now(timezone.utc).isoformat()
                contact["last_modified"] = now
                self._contacts[contact_id] = contact

                operation = "update" if existing else "insert"
                self._log_sync(
                    entity_type="contact",
                    entity_id=contact_id,
                    operation=operation,
                    changed_fields=list(contact.keys()),
                    old_values=existing or {},
                    new_values=contact,
                )

                logger.info("Upserted contact %s (mock)", contact_id)
                return SyncState.SYNCED

            return await self._write_row_with_retry(
                tab_key="contacts",
                row_id=contact_id,
                row_data=contact,
                id_column="contact_id",
            )

        except Exception:
            logger.exception("Failed to upsert contact %s", contact_id)
            return SyncState.PENDING

    async def add_rejection(
        self,
        entity_type: str,
        entity_id: str,
        entity_name: str,
        reason: str,
        rejected_by: str = "user",
        original_data: dict[str, Any] | None = None,
    ) -> SyncState:
        """Log a rejection to the Rejected tab."""
        self._ensure_connected()

        rejection = {
            "entity_id": str(entity_id),
            "entity_type": entity_type,
            "entity_name": entity_name,
            "reason": reason,
            "rejected_by": rejected_by,
            "rejected_at": datetime.now(timezone.utc).isoformat(),
            "original_data": json.dumps(original_data or {}),
        }

        try:
            if self._mock_mode:
                self._rejections.append(rejection)
                logger.info(
                    "Rejection logged for %s %s (mock)", entity_type, entity_id
                )
                return SyncState.SYNCED

            # Real mode: append to the Rejected tab.
            tab_name = SPREADSHEET_TABS["rejected"]["name"]
            columns = SPREADSHEET_TABS["rejected"]["columns"]
            row = [str(rejection.get(col, "")) for col in columns]

            self._service.spreadsheets().values().append(
                spreadsheetId=self.spreadsheet_id,
                range=f"{tab_name}!A:A",
                valueInputOption="RAW",
                insertDataOption="INSERT_ROWS",
                body={"values": [row]},
            ).execute()

            return SyncState.SYNCED

        except Exception:
            logger.exception("Failed to log rejection for %s", entity_id)
            return SyncState.PENDING

    # ------------------------------------------------------------------
    # Batch operations
    # ------------------------------------------------------------------

    async def batch_upsert_companies(
        self,
        companies: list[dict[str, Any]],
    ) -> dict[str, SyncState]:
        """Upsert multiple companies in chunks of BATCH_CHUNK_SIZE.

        Processes in chunks to stay within Google Sheets API quota limits.

        Returns a dict mapping ``company_id`` -> ``SyncState``.
        """
        results: dict[str, SyncState] = {}

        for i in range(0, len(companies), BATCH_CHUNK_SIZE):
            chunk = companies[i : i + BATCH_CHUNK_SIZE]
            for company in chunk:
                cid = str(company.get("company_id") or company.get("id", ""))
                state = await self.upsert_company(company)
                results[cid] = state

            # Brief pause between chunks to respect rate limits.
            if i + BATCH_CHUNK_SIZE < len(companies):
                logger.debug(
                    "Batch upsert: processed %d/%d companies, pausing...",
                    min(i + BATCH_CHUNK_SIZE, len(companies)),
                    len(companies),
                )
                time.sleep(0.5)

        logger.info(
            "Batch upsert complete: %d companies processed.", len(companies)
        )
        return results

    async def batch_upsert_locations(
        self,
        locations: list[dict[str, Any]],
    ) -> dict[str, SyncState]:
        """Upsert multiple locations in chunks."""
        results: dict[str, SyncState] = {}

        for i in range(0, len(locations), BATCH_CHUNK_SIZE):
            chunk = locations[i : i + BATCH_CHUNK_SIZE]
            for location in chunk:
                lid = str(location.get("location_id") or location.get("id", ""))
                state = await self.upsert_location(location)
                results[lid] = state

            if i + BATCH_CHUNK_SIZE < len(locations):
                time.sleep(0.5)

        return results

    async def batch_upsert_contacts(
        self,
        contacts: list[dict[str, Any]],
    ) -> dict[str, SyncState]:
        """Upsert multiple contacts in chunks."""
        results: dict[str, SyncState] = {}

        for i in range(0, len(contacts), BATCH_CHUNK_SIZE):
            chunk = contacts[i : i + BATCH_CHUNK_SIZE]
            for contact in chunk:
                cid = str(contact.get("contact_id") or contact.get("id", ""))
                state = await self.upsert_contact(contact)
                results[cid] = state

            if i + BATCH_CHUNK_SIZE < len(contacts):
                time.sleep(0.5)

        return results

    # ------------------------------------------------------------------
    # Sync tracking
    # ------------------------------------------------------------------

    def _log_sync(
        self,
        entity_type: str,
        entity_id: str,
        operation: str,
        changed_fields: list[str],
        old_values: dict[str, Any],
        new_values: dict[str, Any],
    ) -> None:
        """Record a sync operation in the SyncLog.

        Every write is tracked so that auditing and conflict resolution
        can review what changed and when.
        """
        entry = SyncLogEntry(
            timestamp=datetime.now(timezone.utc).isoformat(),
            entity_type=entity_type,
            entity_id=str(entity_id),
            operation=operation,
            changed_fields=changed_fields,
            old_values=old_values,
            new_values=new_values,
        )
        self._sync_log.append(entry)

        if not self._mock_mode and self._service:
            try:
                tab_name = SPREADSHEET_TABS["sync_log"]["name"]
                columns = SPREADSHEET_TABS["sync_log"]["columns"]
                row = [
                    entry.timestamp,
                    entry.entity_type,
                    entry.entity_id,
                    entry.operation,
                    json.dumps(entry.changed_fields),
                    json.dumps(entry.old_values, default=str),
                    json.dumps(entry.new_values, default=str),
                ]
                self._service.spreadsheets().values().append(
                    spreadsheetId=self.spreadsheet_id,
                    range=f"{tab_name}!A:A",
                    valueInputOption="RAW",
                    insertDataOption="INSERT_ROWS",
                    body={"values": [row]},
                ).execute()
            except Exception:
                logger.exception("Failed to write sync log entry")

    async def get_sync_status(self) -> dict[str, Any]:
        """Return sync health summary with real counts and last sync time."""
        self._ensure_connected()

        last_sync: str | None = None
        if self._sync_log:
            last_sync = self._sync_log[-1].timestamp

        if self._mock_mode:
            return {
                "connected": self._connected,
                "mode": "mock",
                "spreadsheet_id": self.spreadsheet_id,
                "companies_count": len(self._companies),
                "locations_count": len(self._locations),
                "contacts_count": len(self._contacts),
                "rejections_count": len(self._rejections),
                "sync_log_entries": len(self._sync_log),
                "last_sync": last_sync,
            }

        # Real mode: read counts from each tab.
        counts: dict[str, int] = {}
        for tab_key in ("companies", "locations", "contacts", "rejected"):
            try:
                rows = await self._read_tab(tab_key)
                counts[tab_key] = len(rows)
            except Exception:
                counts[tab_key] = -1

        return {
            "connected": self._connected,
            "mode": "live",
            "spreadsheet_id": self.spreadsheet_id,
            "companies_count": counts.get("companies", 0),
            "locations_count": counts.get("locations", 0),
            "contacts_count": counts.get("contacts", 0),
            "rejections_count": counts.get("rejected", 0),
            "sync_log_entries": len(self._sync_log),
            "last_sync": last_sync,
        }

    # ------------------------------------------------------------------
    # Internal: write with retry and backoff
    # ------------------------------------------------------------------

    async def _write_row_with_retry(
        self,
        tab_key: str,
        row_id: str,
        row_data: dict[str, Any],
        id_column: str,
    ) -> SyncState:
        """Write or update a single row in a tab, with retry on quota errors.

        On quota exceeded (HTTP 429), backs off exponentially up to
        ``MAX_RETRIES`` attempts.  On any other failure, returns PENDING.

        Parameters
        ----------
        tab_key:
            Key in ``SPREADSHEET_TABS`` (e.g. "companies").
        row_id:
            The entity's ID value (used to find existing rows).
        row_data:
            Dict of column values to write.
        id_column:
            The column name that holds the entity ID.

        Returns
        -------
        SyncState
            SYNCED on success, PENDING on failure.
        """
        tab_config = SPREADSHEET_TABS[tab_key]
        tab_name = tab_config["name"]
        columns = tab_config["columns"]

        for attempt in range(1, MAX_RETRIES + 1):
            try:
                # Check for existing row.
                existing_row_num = await self._find_row(tab_name, id_column, row_id, columns)

                # Build the row values in column order.
                row_values = []
                for col in columns:
                    val = row_data.get(col, "")
                    if isinstance(val, (dict, list)):
                        val = json.dumps(val, default=str)
                    row_values.append(str(val) if val is not None else "")

                if existing_row_num:
                    # Preserve user-owned fields from the existing row.
                    existing_data = await self._read_row(tab_name, existing_row_num, columns)
                    for fld in USER_OWNED_FIELDS:
                        if fld in columns:
                            col_idx = columns.index(fld)
                            existing_val = existing_data.get(fld)
                            if existing_val:
                                row_values[col_idx] = str(existing_val)

                    # Update existing row.
                    row_range = f"{tab_name}!A{existing_row_num}"
                    self._service.spreadsheets().values().update(
                        spreadsheetId=self.spreadsheet_id,
                        range=row_range,
                        valueInputOption="RAW",
                        body={"values": [row_values]},
                    ).execute()
                    operation = "update"
                else:
                    # Append new row.
                    self._service.spreadsheets().values().append(
                        spreadsheetId=self.spreadsheet_id,
                        range=f"{tab_name}!A:A",
                        valueInputOption="RAW",
                        insertDataOption="INSERT_ROWS",
                        body={"values": [row_values]},
                    ).execute()
                    operation = "insert"

                # Log the sync operation.
                self._log_sync(
                    entity_type=tab_key,
                    entity_id=row_id,
                    operation=operation,
                    changed_fields=list(row_data.keys()),
                    old_values={},
                    new_values=row_data,
                )

                return SyncState.SYNCED

            except Exception as exc:
                # Check for quota exceeded (HTTP 429).
                exc_str = str(exc)
                if "429" in exc_str or "quota" in exc_str.lower():
                    backoff = BACKOFF_BASE_SECONDS * (2 ** (attempt - 1))
                    logger.warning(
                        "Quota exceeded writing to %s (attempt %d/%d). "
                        "Backing off %.1fs.",
                        tab_name,
                        attempt,
                        MAX_RETRIES,
                        backoff,
                    )
                    time.sleep(backoff)
                    continue

                logger.exception(
                    "Write to %s failed (attempt %d/%d)",
                    tab_name,
                    attempt,
                    MAX_RETRIES,
                )
                if attempt == MAX_RETRIES:
                    return SyncState.PENDING
                time.sleep(BACKOFF_BASE_SECONDS)

        return SyncState.PENDING

    async def _find_row(
        self,
        tab_name: str,
        id_column: str,
        row_id: str,
        columns: list[str],
    ) -> int | None:
        """Find the 1-based row number of a record by its ID column.

        Returns None if the record is not found.
        """
        if id_column not in columns:
            return None

        col_idx = columns.index(id_column)

        try:
            result = (
                self._service.spreadsheets()
                .values()
                .get(
                    spreadsheetId=self.spreadsheet_id,
                    range=f"{tab_name}!A:Z",
                )
                .execute()
            )
            rows = result.get("values", [])
            for i, row in enumerate(rows[1:], start=2):  # Skip header.
                if col_idx < len(row) and row[col_idx] == row_id:
                    return i
        except Exception:
            logger.exception("Failed to search for row in %s", tab_name)

        return None

    async def _read_row(
        self,
        tab_name: str,
        row_num: int,
        columns: list[str],
    ) -> dict[str, Any]:
        """Read a single row by its 1-based row number."""
        try:
            result = (
                self._service.spreadsheets()
                .values()
                .get(
                    spreadsheetId=self.spreadsheet_id,
                    range=f"{tab_name}!A{row_num}:Z{row_num}",
                )
                .execute()
            )
            rows = result.get("values", [])
            if rows:
                row = rows[0]
                return {
                    col: row[i] if i < len(row) else None
                    for i, col in enumerate(columns)
                }
        except Exception:
            logger.exception("Failed to read row %d from %s", row_num, tab_name)

        return {}
