#!/usr/bin/env python3
"""PI-001: Legacy Excel Importer for Friction GenLead.

Reads two Queensland business prospect workbooks and produces a unified set
of JSON records ready for Google Sheets import.

Workbooks
---------
- ``Customers - Targets - QLD.xlsx``  (older curated targets)
- ``1. Master - QLD Customers.xlsx``  (newer master with contacts)

Key behaviours
--------------
- Never modifies the original Excel files.
- Same company across sheets enriches one canonical record (merged by
  normalised name, then by ABN if available).
- LinkedIn slugs are marked ``unverified``.
- Operational reports older than 2024 receive ``STALE_LEGACY`` status.
- Postcodes outside 4000-4999 are flagged for manual review.
- ``--dry-run`` (the default) shows what *would* happen; ``--execute``
  writes the output JSON file.

Usage
-----
::

    python migrate.py --source-dir ./data
    python migrate.py --source-dir ./data --execute --output results.json
"""

from __future__ import annotations

import argparse
import json
import logging
import re
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from uuid import uuid4

try:
    import openpyxl
except ImportError:
    sys.exit(
        "openpyxl is required.  Install it with:\n"
        "  pip install -r requirements.txt"
    )

# ---------------------------------------------------------------------------
# Logging
# ---------------------------------------------------------------------------

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)
logger = logging.getLogger("migrate-legacy")

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

TARGETS_FILENAME = "Customers - Targets - QLD.xlsx"
MASTER_FILENAME = "1. Master - QLD Customers.xlsx"

QLD_POSTCODE_MIN = 4000
QLD_POSTCODE_MAX = 4999

# Suffixes stripped during company-name normalisation (case-insensitive).
_COMPANY_SUFFIXES = re.compile(
    r"\b("
    r"pty\s*ltd|pty\s*limited|ltd|limited|inc|incorporated"
    r"|corp|corporation|group|holdings|australia"
    r")\b",
    re.IGNORECASE,
)

# Year cutoff -- operational reports from this year or older are STALE_LEGACY.
STALE_YEAR_CUTOFF = 2023


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def normalize_company_name(name: str) -> str:
    """Normalise a company name for deduplication.

    Strips common corporate suffixes (Pty Ltd, Ltd, etc.), collapses
    whitespace, and lowercases the result.
    """
    if not name:
        return ""
    cleaned = _COMPANY_SUFFIXES.sub("", name)
    cleaned = re.sub(r"[^\w\s]", " ", cleaned)  # punctuation -> space
    cleaned = re.sub(r"\s+", " ", cleaned).strip().lower()
    return cleaned


def is_valid_qld_postcode(postcode: str | None) -> bool:
    """Return True if *postcode* falls within the QLD range 4000-4999."""
    if not postcode:
        return False
    digits = "".join(c for c in str(postcode) if c.isdigit())
    if len(digits) != 4:
        return False
    code = int(digits)
    return QLD_POSTCODE_MIN <= code <= QLD_POSTCODE_MAX


def _safe_str(value: Any) -> str | None:
    """Convert a cell value to a stripped string, or None."""
    if value is None:
        return None
    text = str(value).strip()
    return text if text else None


def _extract_linkedin_slug(url: str | None) -> str | None:
    """Extract a LinkedIn slug from a URL, or return None."""
    if not url:
        return None
    match = re.search(r"linkedin\.com/in/([A-Za-z0-9_-]+)", url)
    return match.group(1) if match else None


# ---------------------------------------------------------------------------
# Row parsers
# ---------------------------------------------------------------------------

def _parse_targets_row(
    row: tuple,
    headers: list[str],
    sheet_name: str,
    row_num: int,
) -> dict | None:
    """Parse a single row from the Targets workbook.

    Returns a raw record dict, or None if the row is empty/unusable.
    """
    cells = {h: _safe_str(row[i]) for i, h in enumerate(headers) if i < len(row)}

    # Heuristic: try common column names for the company name.
    company_name = (
        cells.get("company")
        or cells.get("company name")
        or cells.get("name")
        or cells.get("customer")
        or cells.get("target")
        or cells.get("business name")
    )
    if not company_name:
        return None

    postcode = (
        cells.get("postcode")
        or cells.get("post code")
        or cells.get("zip")
    )

    return {
        "id": str(uuid4()),
        "company_name": company_name,
        "normalized_name": normalize_company_name(company_name),
        "abn": cells.get("abn"),
        "website": cells.get("website") or cells.get("url"),
        "industry": cells.get("industry") or cells.get("sector"),
        "address": cells.get("address") or cells.get("street"),
        "suburb": cells.get("suburb") or cells.get("city") or cells.get("town"),
        "state": cells.get("state") or "QLD",
        "postcode": postcode,
        "phone": cells.get("phone") or cells.get("telephone"),
        "contact_name": cells.get("contact") or cells.get("contact name"),
        "contact_position": cells.get("position") or cells.get("role") or cells.get("title"),
        "contact_email": cells.get("email") or cells.get("e-mail"),
        "contact_phone": cells.get("mobile") or cells.get("contact phone"),
        "linkedin_url": cells.get("linkedin") or cells.get("linkedin url"),
        "notes": cells.get("notes") or cells.get("comments"),
        "provenance": {
            "workbook": TARGETS_FILENAME,
            "sheet": sheet_name,
            "row": row_num,
        },
        "status": "STALE_LEGACY",
        "source": "LEGACY_EXCEL",
    }


def _parse_master_row(
    row: tuple,
    headers: list[str],
    sheet_name: str,
    row_num: int,
) -> dict | None:
    """Parse a single row from the Master workbook.

    Returns a raw record dict, or None if the row is empty/unusable.
    """
    cells = {h: _safe_str(row[i]) for i, h in enumerate(headers) if i < len(row)}

    company_name = (
        cells.get("company")
        or cells.get("company name")
        or cells.get("name")
        or cells.get("customer")
        or cells.get("customer name")
        or cells.get("business name")
    )
    if not company_name:
        return None

    postcode = (
        cells.get("postcode")
        or cells.get("post code")
        or cells.get("zip")
    )

    # The master sheet is newer -- mark as NEW unless report year is stale.
    status = "NEW"
    report_year = cells.get("report year") or cells.get("year")
    if report_year:
        try:
            if int(float(str(report_year))) <= STALE_YEAR_CUTOFF:
                status = "STALE_LEGACY"
        except (ValueError, TypeError):
            pass

    return {
        "id": str(uuid4()),
        "company_name": company_name,
        "normalized_name": normalize_company_name(company_name),
        "abn": cells.get("abn"),
        "website": cells.get("website") or cells.get("url"),
        "industry": cells.get("industry") or cells.get("sector"),
        "address": cells.get("address") or cells.get("street"),
        "suburb": cells.get("suburb") or cells.get("city") or cells.get("town"),
        "state": cells.get("state") or "QLD",
        "postcode": postcode,
        "phone": cells.get("phone") or cells.get("telephone"),
        "contact_name": cells.get("contact") or cells.get("contact name"),
        "contact_position": cells.get("position") or cells.get("role") or cells.get("title"),
        "contact_email": cells.get("email") or cells.get("e-mail"),
        "contact_phone": cells.get("mobile") or cells.get("contact phone"),
        "linkedin_url": cells.get("linkedin") or cells.get("linkedin url"),
        "notes": cells.get("notes") or cells.get("comments"),
        "provenance": {
            "workbook": MASTER_FILENAME,
            "sheet": sheet_name,
            "row": row_num,
        },
        "status": status,
        "source": "LEGACY_EXCEL",
    }


# ---------------------------------------------------------------------------
# Workbook readers
# ---------------------------------------------------------------------------

def read_workbook(
    path: Path,
    parser_fn,
    workbook_label: str,
) -> list[dict]:
    """Read all sheets from an Excel workbook and parse rows.

    Parameters
    ----------
    path:
        Path to the ``.xlsx`` file.
    parser_fn:
        Row-parser function (``_parse_targets_row`` or ``_parse_master_row``).
    workbook_label:
        Human-readable label used in log messages.

    Returns
    -------
    list[dict]
        Parsed raw records.
    """
    logger.info("Opening %s: %s", workbook_label, path)
    wb = openpyxl.load_workbook(path, read_only=True, data_only=True)
    records: list[dict] = []

    for sheet_name in wb.sheetnames:
        ws = wb[sheet_name]
        rows = list(ws.iter_rows(values_only=True))
        if not rows:
            logger.info("  Sheet '%s' is empty, skipping.", sheet_name)
            continue

        # First row = headers (lowercased for lookup)
        raw_headers = rows[0]
        headers = [_safe_str(h).lower() if _safe_str(h) else f"col_{i}" for i, h in enumerate(raw_headers)]

        for row_idx, row in enumerate(rows[1:], start=2):
            record = parser_fn(row, headers, sheet_name, row_idx)
            if record:
                records.append(record)

        logger.info(
            "  Sheet '%s': %d data rows -> %d records parsed.",
            sheet_name,
            len(rows) - 1,
            sum(1 for r in records if r["provenance"]["sheet"] == sheet_name),
        )

    wb.close()
    return records


# ---------------------------------------------------------------------------
# Deduplication / merge
# ---------------------------------------------------------------------------

def merge_records(records: list[dict]) -> tuple[list[dict], list[dict]]:
    """Merge records with the same normalised company name.

    When the same company appears in multiple sheets, the newer record
    enriches the canonical one (fills blanks, does not overwrite existing
    non-empty values).  Contacts are accumulated.

    Returns
    -------
    (merged_companies, warnings)
        ``merged_companies`` is a list of canonical company dicts.
        ``warnings`` is a list of warning dicts (postcode issues, etc.).
    """
    canonical: dict[str, dict] = {}   # normalized_name -> company dict
    abn_index: dict[str, str] = {}     # abn -> normalized_name
    contacts_by_company: dict[str, list[dict]] = {}
    warnings: list[dict] = []
    duplicates_merged = 0

    for record in records:
        norm = record["normalized_name"]
        abn = record.get("abn")

        # Try ABN-based matching first (strongest signal).
        existing_norm = None
        if abn and abn in abn_index:
            existing_norm = abn_index[abn]
        elif norm in canonical:
            existing_norm = norm

        if existing_norm:
            # Enrich existing canonical record.
            existing = canonical[existing_norm]
            for key in (
                "abn", "website", "industry", "address", "suburb",
                "state", "postcode", "phone",
            ):
                if not existing.get(key) and record.get(key):
                    existing[key] = record[key]

            # Merge provenance (keep a list).
            if "provenances" not in existing:
                existing["provenances"] = [existing.pop("provenance")]
            existing["provenances"].append(record["provenance"])

            # If current record is newer (NEW vs STALE_LEGACY), upgrade status.
            if record.get("status") == "NEW" and existing.get("status") == "STALE_LEGACY":
                existing["status"] = "NEW"

            duplicates_merged += 1
        else:
            # New canonical entry.
            canonical[norm] = record
            if abn:
                abn_index[abn] = norm

        # Collect contacts.
        company_key = existing_norm or norm
        if company_key not in contacts_by_company:
            contacts_by_company[company_key] = []

        contact_name = record.get("contact_name")
        if contact_name:
            linkedin_slug = _extract_linkedin_slug(record.get("linkedin_url"))
            contact = {
                "id": str(uuid4()),
                "name": contact_name,
                "position": record.get("contact_position"),
                "email": record.get("contact_email"),
                "phone": record.get("contact_phone"),
                "linkedin_slug": linkedin_slug,
                "linkedin_verified": False,  # Always unverified for legacy data
                "provenance": record["provenance"],
                "source": "LEGACY_EXCEL",
            }
            contacts_by_company[company_key].append(contact)

    # Deduplicate contacts within each company (by normalised name).
    for company_norm, contacts in contacts_by_company.items():
        seen_names: dict[str, dict] = {}
        deduped: list[dict] = []
        for c in contacts:
            c_norm = c["name"].strip().lower()
            if c_norm in seen_names:
                # Enrich existing contact.
                existing_contact = seen_names[c_norm]
                for key in ("position", "email", "phone", "linkedin_slug"):
                    if not existing_contact.get(key) and c.get(key):
                        existing_contact[key] = c[key]
            else:
                seen_names[c_norm] = c
                deduped.append(c)
        contacts_by_company[company_norm] = deduped

    # Attach contacts and validate postcodes.
    result: list[dict] = []
    for norm, company in canonical.items():
        company["contacts"] = contacts_by_company.get(norm, [])

        # Postcode validation.
        postcode = company.get("postcode")
        if postcode and not is_valid_qld_postcode(postcode):
            warnings.append({
                "type": "SUSPICIOUS_POSTCODE",
                "company": company["company_name"],
                "postcode": postcode,
                "message": (
                    f"Postcode {postcode} is outside QLD range "
                    f"({QLD_POSTCODE_MIN}-{QLD_POSTCODE_MAX}). "
                    f"Flagged for manual review."
                ),
            })

        # Flatten provenance if only one source.
        if "provenances" not in company:
            company["provenances"] = [company.pop("provenance")]

        result.append(company)

    logger.info(
        "Merge complete: %d unique companies, %d duplicates merged.",
        len(result),
        duplicates_merged,
    )
    return result, warnings


# ---------------------------------------------------------------------------
# Summary report
# ---------------------------------------------------------------------------

def build_summary(
    companies: list[dict],
    warnings: list[dict],
    total_rows: int,
) -> dict:
    """Build a human-readable summary of the migration."""
    total_contacts = sum(len(c.get("contacts", [])) for c in companies)
    stale_count = sum(1 for c in companies if c.get("status") == "STALE_LEGACY")
    new_count = sum(1 for c in companies if c.get("status") == "NEW")

    return {
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "total_rows_processed": total_rows,
        "companies_created": len(companies),
        "contacts_found": total_contacts,
        "duplicates_merged": total_rows - len(companies),
        "stale_legacy_companies": stale_count,
        "new_companies": new_count,
        "warnings_count": len(warnings),
        "suspicious_postcodes": [
            w for w in warnings if w["type"] == "SUSPICIOUS_POSTCODE"
        ],
    }


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main() -> None:
    parser = argparse.ArgumentParser(
        description="Import legacy Excel workbooks into Friction GenLead.",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=__doc__,
    )
    parser.add_argument(
        "--source-dir",
        type=Path,
        required=True,
        help="Directory containing the Excel workbooks.",
    )

    mode = parser.add_mutually_exclusive_group()
    mode.add_argument(
        "--dry-run",
        action="store_true",
        default=True,
        help="Show what would happen without writing output (default).",
    )
    mode.add_argument(
        "--execute",
        action="store_true",
        help="Actually write the output JSON file.",
    )

    parser.add_argument(
        "--output",
        type=Path,
        default=Path("migration_output.json"),
        help="Output JSON file path (default: migration_output.json).",
    )

    args = parser.parse_args()
    source_dir = args.source_dir.resolve()

    if args.execute:
        args.dry_run = False

    # ------------------------------------------------------------------
    # Locate workbooks
    # ------------------------------------------------------------------
    targets_path = source_dir / TARGETS_FILENAME
    master_path = source_dir / MASTER_FILENAME

    missing: list[str] = []
    if not targets_path.exists():
        missing.append(str(targets_path))
    if not master_path.exists():
        missing.append(str(master_path))

    if missing:
        logger.error("Missing workbook(s):\n  %s", "\n  ".join(missing))
        sys.exit(1)

    # ------------------------------------------------------------------
    # Read workbooks
    # ------------------------------------------------------------------
    targets_records = read_workbook(targets_path, _parse_targets_row, "Targets")
    master_records = read_workbook(master_path, _parse_master_row, "Master")

    total_rows = len(targets_records) + len(master_records)
    logger.info(
        "Total raw records: %d (Targets: %d, Master: %d)",
        total_rows,
        len(targets_records),
        len(master_records),
    )

    # ------------------------------------------------------------------
    # Merge
    # ------------------------------------------------------------------
    all_records = targets_records + master_records
    companies, warnings = merge_records(all_records)

    # ------------------------------------------------------------------
    # Summary
    # ------------------------------------------------------------------
    summary = build_summary(companies, warnings, total_rows)

    print("\n" + "=" * 60)
    print("MIGRATION SUMMARY")
    print("=" * 60)
    print(f"  Total rows processed:     {summary['total_rows_processed']}")
    print(f"  Companies created:        {summary['companies_created']}")
    print(f"  Contacts found:           {summary['contacts_found']}")
    print(f"  Duplicates merged:        {summary['duplicates_merged']}")
    print(f"  Stale legacy companies:   {summary['stale_legacy_companies']}")
    print(f"  New companies:            {summary['new_companies']}")
    print(f"  Warnings:                 {summary['warnings_count']}")

    if warnings:
        print("\nWARNINGS:")
        for w in warnings:
            print(f"  [{w['type']}] {w['company']}: {w['message']}")

    # ------------------------------------------------------------------
    # Output
    # ------------------------------------------------------------------
    output_data = {
        "metadata": summary,
        "companies": companies,
        "warnings": warnings,
    }

    if args.dry_run:
        print(f"\n[DRY RUN] Would write {len(companies)} companies to {args.output}")
        print("[DRY RUN] Run with --execute to write the output file.")
    else:
        output_path = args.output.resolve()
        with open(output_path, "w", encoding="utf-8") as f:
            json.dump(output_data, f, indent=2, ensure_ascii=False, default=str)
        logger.info("Output written to %s", output_path)
        print(f"\nOutput written to {output_path}")


if __name__ == "__main__":
    main()
