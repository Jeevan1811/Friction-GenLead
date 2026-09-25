"""Google Sheets tab and column configuration for Friction GenLead.

This module defines the canonical structure of the Google Sheet used as
the persistent store.  Every tab, its display name, and the ordered list
of column headers are declared here so that the adapter, import pipeline,
and any future migration scripts share a single source of truth.

Headers identify fields; the adapter reads and writes by normalized header
name so harmless column reordering is safe. Schema upgrades append missing
headers and never replace existing columns.
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
            "source_verification",
            "business_landlines",
            "legacy_source_text",
            "source_provenance",
            "source_quality_flags",
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
            "raw_postcode",
            "source_provenance",
            "source_quality_flags",
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
            "professional_url_raw",
            "source_provenance",
            "source_quality_flags",
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
    "activities": {
        "name": "Activities",
        "columns": [
            "activity_id",
            "company_id",
            "contact_id",
            "activity_type",
            "outcome",
            "notes",
            "happened_at",
            "follow_up_at",
            "follow_up_status",
            "follow_up_completed_at",
            "created_at",
        ],
    },
    "search_runs": {
        "name": "SearchRuns",
        "columns": [
            "job_id",
            "postcode",
            "industry",
            "roles",
            "status",
            "companies_found",
            "contacts_found",
            "created_at",
            "updated_at",
            "error_summary",
        ],
    },
    "source_records": {
        "name": "SourceRecords",
        "columns": [
            "source_record_id",
            "record_type",
            "company_id",
            "company_name",
            "source_workbook",
            "source_sheet",
            "source_row",
            "source_field",
            "postcode_raw",
            "contact_name",
            "landline_raw",
            "verification_source_raw",
            "legacy_source_text",
            "raw_data_json",
            "source_sha256",
        ],
    },
}
