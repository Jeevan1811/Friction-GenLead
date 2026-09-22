"""Google Sheets tab and column configuration for Friction GenLead.

This module defines the canonical structure of the Google Sheet used as
the persistent store.  Every tab, its display name, and the ordered list
of column headers are declared here so that the adapter, import pipeline,
and any future migration scripts share a single source of truth.

Column order matters -- the adapter reads/writes by positional index
within each tab.
"""

from __future__ import annotations

from typing import TypedDict


class TabConfig(TypedDict):
    """Schema for a single Google Sheet tab."""

    name: str
    columns: list[str]


SPREADSHEET_TABS: dict[str, TabConfig] = {
    "companies": {
        "name": "Companies",
        "columns": [
            "company_id",
            "abn",
            "company_name",
            "normalized_name",
            "trading_name",
            "website",
            "industry",
            "abn_status",
            "status",
            "industry_fit",
            "priority",
            "source",
            "last_verified",
            "last_modified",
            "notes",
        ],
    },
    "locations": {
        "name": "Locations",
        "columns": [
            "location_id",
            "company_id",
            "site_name",
            "location_type",
            "address",
            "suburb",
            "state",
            "postcode",
            "lat",
            "lng",
            "verification_status",
            "last_verified",
            "last_modified",
        ],
    },
    "contacts": {
        "name": "Contacts",
        "columns": [
            "contact_id",
            "company_id",
            "location_id",
            "name",
            "position",
            "role_bucket",
            "role_priority",
            "business_email",
            "mobile",
            "landline",
            "professional_url",
            "contact_status",
            "last_verified",
            "last_modified",
        ],
    },
    "rejected": {
        "name": "Rejected",
        "columns": [
            "entity_id",
            "entity_type",
            "entity_name",
            "reason",
            "rejected_by",
            "rejected_at",
            "original_data",
        ],
    },
    "sync_log": {
        "name": "SyncLog",
        "columns": [
            "timestamp",
            "entity_type",
            "entity_id",
            "operation",
            "changed_fields",
            "old_values",
            "new_values",
        ],
    },
}
