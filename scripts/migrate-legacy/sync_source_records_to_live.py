#!/usr/bin/env python3
"""Lossless, append-only upgrade of the live MSV Google Sheet.

Dry-run is the default. ``--apply`` appends every nonblank source-workbook row
to SourceRecords and fills only the new, previously-empty provenance/raw-data
columns on canonical rows. It does not replace canonical tabs or touch existing
company, location, contact, note, status, staging, or rejection data.

The migration is restartable: stable source IDs plus SHA-256 content checks
skip rows already imported and refuse to overwrite changed source records.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import sys
import time
from collections import defaultdict
from pathlib import Path
from typing import Any

try:
    import openpyxl
except ImportError:
    raise SystemExit("openpyxl is required; install scripts/migrate-legacy/requirements.txt")

ROOT = Path(__file__).resolve().parents[2]
RESEARCH_DIR = ROOT / "services" / "research"
sys.path.insert(0, str(RESEARCH_DIR))

from app.services.sheets_config import SPREADSHEET_TABS  # noqa: E402

DEFAULT_ENV = RESEARCH_DIR / ".env"
DEFAULT_SOURCE_DIR = Path(__file__).resolve().parent / "data"
CANONICAL_TABS = ("companies", "locations", "contacts")
REQUIRED_SOURCE_HEADERS = SPREADSHEET_TABS["source_records"]["columns"]
MAX_RETRIES = 3

_COMPANY_SUFFIXES = re.compile(
    r"\b(pty\s*ltd|pty\s*limited|ltd|limited|inc|incorporated|corp|corporation|"
    r"group|holdings|australia|p/l|pl)\b",
    re.IGNORECASE,
)
_FINANCIAL_SUFFIX = re.compile(r"\s*[-–—]\s*[\d,]+\.\d{2}\s*$")


def _parse_env(path: Path) -> dict[str, str]:
    values: dict[str, str] = {}
    for raw in path.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        values[key.strip()] = value.strip().strip("\"'")
    return values


def _build_service(env_path: Path):
    """Use the project's existing OAuth token without printing or rewriting it."""
    env = _parse_env(env_path)
    spreadsheet_id = env.get("GOOGLE_SHEETS_SPREADSHEET_ID", "").strip()
    token_setting = env.get("GOOGLE_OAUTH_TOKEN_PATH", "").strip()
    if not spreadsheet_id or not token_setting:
        raise RuntimeError("The project env file lacks Google Sheets connection settings")
    token_path = Path(token_setting)
    if not token_path.is_absolute():
        token_path = env_path.parent / token_path
    if not token_path.is_file():
        raise RuntimeError("The configured Google Sheets OAuth token file is missing")

    from google.auth.transport.requests import Request
    from google.oauth2.credentials import Credentials
    from googleapiclient.discovery import build

    credentials = Credentials.from_authorized_user_file(
        str(token_path), ["https://www.googleapis.com/auth/spreadsheets"]
    )
    if not credentials.valid:
        if credentials.expired and credentials.refresh_token:
            credentials.refresh(Request())  # in-memory only; do not rewrite credential files
        else:
            raise RuntimeError("The configured Google Sheets OAuth token is not usable")
    return build("sheets", "v4", credentials=credentials), spreadsheet_id


def _execute(request, label: str):
    for attempt in range(1, MAX_RETRIES + 1):
        try:
            return request.execute()
        except Exception as exc:  # noqa: BLE001
            message = str(exc)
            transient = any(code in message for code in ("429", "500", "503")) or "quota" in message.lower()
            if attempt < MAX_RETRIES and transient:
                time.sleep(1.5 * (2 ** (attempt - 1)))
                continue
            status = getattr(getattr(exc, "resp", None), "status", None)
            reason = str(getattr(exc, "reason", "")).replace("\n", " ")[:240]
            detail = f", HTTP {status}" if status else ""
            if reason:
                detail += f": {reason}"
            raise RuntimeError(
                f"Google Sheets {label} failed ({type(exc).__name__}{detail})"
            ) from exc


def _column_letter(index: int) -> str:
    number = index + 1
    result = ""
    while number:
        number, remainder = divmod(number - 1, 26)
        result = chr(65 + remainder) + result
    return result


def _header_key(value: Any) -> str:
    return re.sub(r"[^a-z0-9]+", "_", str(value or "").strip().casefold()).strip("_")


def _text(value: Any) -> str:
    if value is None:
        return ""
    if hasattr(value, "isoformat"):
        return value.isoformat()
    return str(value).replace("\xa0", " ").strip()


def _raw_text(value: Any) -> str:
    """String form for the archive, preserving source whitespace exactly."""
    if value is None:
        return ""
    if hasattr(value, "isoformat"):
        return value.isoformat()
    return str(value)


def _normalize_company(name: str) -> str:
    without_finance = _FINANCIAL_SUFFIX.sub("", name)
    without_legal = _COMPANY_SUFFIXES.sub("", without_finance)
    return re.sub(r"\s+", " ", re.sub(r"[^\w\s]", " ", without_legal)).strip().casefold()


def _sha256(value: bytes) -> str:
    return hashlib.sha256(value).hexdigest()


def _read_workbook(path: Path, *, is_master: bool) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    workbook = openpyxl.load_workbook(path, read_only=True, data_only=False)
    records: list[dict[str, Any]] = []
    stats: dict[str, Any] = {"sheets": {}, "input_cells": 0, "header_cells": 0, "nonblank_rows": 0, "blank_rows": 0}

    def add_record(
        *, sheet: str, row_number: int, field: str, row_cells: list[dict[str, Any]],
        headers: list[str], company_name: str = "", postcode: str = "",
        contact_name: str = "", landline: str = "", verification: str = "",
        legacy_text: str = "", linkedin: str = "", matched: bool = True,
    ) -> None:
        # Include every nonblank cell and its original column/header/number
        # format. Header labels are repeated as metadata to retain context.
        raw = json.dumps(
            {"headers": headers, "cells": row_cells},
            ensure_ascii=False, separators=(",", ":"), default=str,
        )
        identity = f"{path.name}\0{sheet}\0{row_number}\0{field}"
        record_id = "src_" + _sha256(identity.encode("utf-8"))[:32]
        payload_hash = _sha256(raw.encode("utf-8"))
        records.append({
            "source_record_id": record_id,
            "record_type": (
                "SOURCE_ROW" if matched else
                ("UNMATCHED_SOURCE_ROW" if not company_name else "UNMATCHED_COMPANY_SOURCE_ROW")
            ),
            "company_name": company_name,
            "source_workbook": path.name,
            "source_sheet": sheet,
            "source_row": str(row_number),
            "source_field": field,
            "postcode_raw": postcode,
            "contact_name": contact_name,
            "landline_raw": landline,
            "verification_source_raw": verification,
            "legacy_source_text": legacy_text,
            "raw_data_json": raw,
            "source_sha256": payload_hash,
            "_linkedin_raw": linkedin,
            "_matched": matched,
        })

    try:
        for worksheet in workbook.worksheets:
            sheet = worksheet.title
            all_rows = list(worksheet.iter_rows())
            # The targets workbook's Sheet4 has no header; every other known
            # source sheet has one, as recorded in the migration audit.
            has_header = not (not is_master and sheet == "Sheet4")
            header_cells = all_rows[0] if has_header and all_rows else []
            headers = [_raw_text(cell.value) for cell in header_cells]
            header_map = {_header_key(value): index for index, value in enumerate(headers) if value}
            row_offset = 2 if has_header else 1
            sheet_stats = {
                "physical_rows": len(all_rows), "blank_rows": 0,
                "nonblank_rows": 0, "source_records": 0, "cells": 0,
                "header_cells": sum(1 for cell in header_cells if cell.value is not None and cell.value != ""),
            }

            for offset, cells in enumerate(all_rows[row_offset - 1 :], start=row_offset):
                row_values = []
                row_cells: list[dict[str, Any]] = []
                for col_index, cell in enumerate(cells):
                    value = cell.value
                    if value is None or value == "":
                        continue
                    header = headers[col_index] if col_index < len(headers) else ""
                    rendered = _raw_text(value)
                    row_values.append(_text(value))
                    row_cells.append({
                        "column": _column_letter(col_index),
                        "header": header,
                        "value": rendered,
                        "number_format": cell.number_format,
                        "formula": isinstance(value, str) and value.startswith("="),
                    })
                if not row_cells:
                    sheet_stats["blank_rows"] += 1
                    continue
                sheet_stats["nonblank_rows"] += 1
                sheet_stats["cells"] += len(row_cells)

                def by_header(*names: str) -> str:
                    for name in names:
                        index = header_map.get(_header_key(name))
                        if index is not None and index < len(cells):
                            value = _text(cells[index].value)
                            if value:
                                return value
                    return ""

                emitted_before = len(records)
                if not is_master and sheet == "Master":
                    # This sheet contains two side-by-side company lists.
                    pairs = [(0, 1, "column_A_company"), (3, 4, "column_D_company")]
                    for name_col, postcode_col, label in pairs:
                        name = _text(cells[name_col].value) if name_col < len(cells) else ""
                        postcode = _text(cells[postcode_col].value) if postcode_col < len(cells) else ""
                        if name:
                            add_record(sheet=sheet, row_number=offset, field=label, row_cells=row_cells,
                                       headers=headers, company_name=name, postcode=postcode)
                    if len(records) == emitted_before:
                        add_record(sheet=sheet, row_number=offset, field="unmatched_row", row_cells=row_cells,
                                   headers=headers, postcode="", matched=False)
                elif not is_master and sheet == "Sheet4":
                    name = _text(cells[0].value) if len(cells) > 0 else ""
                    postcode = _text(cells[1].value) if len(cells) > 1 else ""
                    add_record(sheet=sheet, row_number=offset, field="column_A_company_headerless",
                               row_cells=row_cells, headers=headers, company_name=name,
                               postcode=postcode, matched=bool(name))
                elif not is_master and sheet == "Sheet3":
                    raw_name = _text(cells[0].value) if len(cells) > 0 else ""
                    postcode = _text(cells[1].value) if len(cells) > 1 else ""
                    contact = _text(cells[3].value) if len(cells) > 3 else ""
                    clean_name = _FINANCIAL_SUFFIX.sub("", raw_name).strip(" -–—")
                    add_record(sheet=sheet, row_number=offset, field="SMC List",
                               row_cells=row_cells, headers=headers, company_name=clean_name,
                               postcode=postcode, contact_name=contact,
                               legacy_text=raw_name, matched=bool(clean_name))
                elif not is_master and sheet == "Sheet1":
                    name = by_header("Name of business relation", "Company", "Company Name")
                    postcode = by_header("Postcode", "Postal Code")
                    add_record(sheet=sheet, row_number=offset, field="Name of business relation",
                               row_cells=row_cells, headers=headers, company_name=name,
                               postcode=postcode, matched=bool(name))
                else:
                    name = by_header("Company Name", "Company", "Business Name")
                    address = by_header("Address", "Address / Plant", "Address / Plant Location")
                    postcode = by_header("Postcode", "Postal Code")
                    contact = by_header("Contact Name")
                    landline = by_header("Landline")
                    verification = by_header("Verification / Source", "Verification", "Source")
                    linkedin = by_header("LinkedIn", "LinkedIn URL", "Professional URL")
                    add_record(sheet=sheet, row_number=offset, field="Company Name",
                               row_cells=row_cells, headers=headers, company_name=name,
                               postcode=postcode, contact_name=contact, landline=landline,
                               verification=verification, linkedin=linkedin, matched=bool(name))

                sheet_stats["source_records"] += len(records) - emitted_before

            stats["sheets"][sheet] = sheet_stats
            stats["input_cells"] += sheet_stats["cells"]
            stats["header_cells"] += sheet_stats["header_cells"]
            stats["nonblank_rows"] += sheet_stats["nonblank_rows"]
            stats["blank_rows"] += sheet_stats["blank_rows"]
    finally:
        workbook.close()

    stats["source_records"] = len(records)
    stats["workbook_sha256"] = _sha256(path.read_bytes())
    return records, stats


def _read_tab(service, spreadsheet_id: str, title: str) -> tuple[list[str], list[list[str]]]:
    result = _execute(
        service.spreadsheets().values().get(
            spreadsheetId=spreadsheet_id, range=f"'{title}'!A:ZZ"
        ),
        f"read {title}",
    )
    values = result.get("values", [])
    if not values:
        return [], []
    return [str(value) for value in values[0]], values[1:]


def _header_index(headers: list[str]) -> dict[str, int]:
    result: dict[str, int] = {}
    for index, header in enumerate(headers):
        key = _header_key(header)
        if key and key not in result:
            result[key] = index
    return result


def _value(row: list[str], indexes: dict[str, int], *keys: str) -> str:
    for key in keys:
        index = indexes.get(_header_key(key))
        if index is not None and index < len(row):
            value = str(row[index] or "").strip()
            if value:
                return value
    return ""


def _cell(row: list[str], index: int | None) -> str:
    return str(row[index] or "").strip() if index is not None and index < len(row) else ""


def _canonical_snapshot(headers: list[str], rows: list[list[str]]) -> str:
    payload = [headers, [row[: len(headers)] + [""] * max(0, len(headers) - len(row)) for row in rows]]
    return _sha256(json.dumps(payload, ensure_ascii=False, separators=(",", ":")).encode("utf-8"))


def _prepare_records(records: list[dict[str, Any]], company_rows: list[list[str]], company_headers: list[str]) -> dict[str, Any]:
    indexes = _header_index(company_headers)
    company_names: dict[str, list[str]] = defaultdict(list)
    id_index = indexes.get("company_id")
    for row in company_rows:
        company_id = _cell(row, id_index)
        name = _value(row, indexes, "normalized_name") or _value(row, indexes, "company_name", "trading_name")
        normalized = _normalize_company(name)
        if normalized and company_id:
            company_names[normalized].append(company_id)

    linked = ambiguous = unmatched = 0
    by_company: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for record in records:
        name = str(record.get("company_name", ""))
        matches = company_names.get(_normalize_company(name), []) if name else []
        if len(matches) == 1:
            record["company_id"] = matches[0]
            record["record_type"] = "SOURCE_ROW"
            linked += 1
            by_company[matches[0]].append(record)
        else:
            record["company_id"] = ""
            if len(matches) > 1:
                record["record_type"] = "AMBIGUOUS_COMPANY_MATCH"
                ambiguous += 1
            elif name:
                record["record_type"] = "UNMATCHED_COMPANY_SOURCE_ROW"
                unmatched += 1
            else:
                record["record_type"] = "UNMATCHED_SOURCE_ROW"
                unmatched += 1

        record.pop("_matched", None)

    return {
        "linked": linked,
        "ambiguous": ambiguous,
        "unmatched": unmatched,
        "by_company": by_company,
    }


def _source_enrichments(
    tab_key: str,
    rows: list[list[str]],
    headers: list[str],
    by_company: dict[str, list[dict[str, Any]]],
) -> list[tuple[int, str, str]]:
    indexes = _header_index(headers)
    id_index = indexes.get({"companies": "company_id", "locations": "location_id", "contacts": "contact_id"}[tab_key])
    company_index = indexes.get("company_id")
    output: list[tuple[int, str, str]] = []

    if tab_key == "companies":
        for row_num, row in enumerate(rows, start=2):
            company_id = _cell(row, id_index)
            source = by_company.get(company_id, [])
            if not source:
                continue
            verification = [
                {"value": r["verification_source_raw"], "sheet": r["source_sheet"], "row": r["source_row"]}
                for r in source if r.get("verification_source_raw")
            ]
            landlines = [
                {"value": r["landline_raw"], "sheet": r["source_sheet"], "row": r["source_row"]}
                for r in source if r.get("landline_raw") and not r.get("contact_name")
            ]
            legacy = [
                {"value": r["legacy_source_text"], "sheet": r["source_sheet"], "row": r["source_row"]}
                for r in source if r.get("legacy_source_text")
            ]
            provenance = [
                {"workbook": r["source_workbook"], "sheet": r["source_sheet"],
                 "row": r["source_row"], "field": r["source_field"],
                 "source_record_id": r["source_record_id"]}
                for r in source
            ]
            flags = ["LEGACY_SOURCE_UNVERIFIED"]
            if landlines:
                flags.append("SOURCE_HAS_LANDLINE_WITHOUT_CONTACT_NAME")
            if legacy:
                flags.append("SMC_SOURCE_TEXT_CONTAINS_UNVERIFIED_SUFFIX")
            for field, value in (
                ("source_verification", verification),
                ("business_landlines", landlines),
                ("legacy_source_text", legacy),
                ("source_provenance", provenance),
                ("source_quality_flags", flags),
            ):
                if value:
                    output.append((row_num, field, json.dumps(value, ensure_ascii=False, separators=(",", ":"))))

    elif tab_key == "locations":
        # Link raw postcodes only when they identify one unique source value
        # for this company and agree with the canonical postcode, if present.
        sources_by_company: dict[str, list[dict[str, Any]]] = defaultdict(list)
        for company_id_value, source_rows in by_company.items():
            sources_by_company[company_id_value].extend(r for r in source_rows if r.get("postcode_raw"))
        for row_num, row in enumerate(rows, start=2):
            company_id = _cell(row, company_index)
            source = sources_by_company.get(company_id, [])
            canonical_postcode = _value(row, indexes, "postcode")
            matching = [
                r for r in source
                if not canonical_postcode or re.sub(r"\D", "", canonical_postcode)
                == re.sub(r"\D", "", str(r.get("postcode_raw", "")))
            ]
            raw_values = list(dict.fromkeys(str(r["postcode_raw"]) for r in matching if r.get("postcode_raw")))
            if len(raw_values) == 1:
                output.append((row_num, "raw_postcode", raw_values[0]))
                refs = [{"workbook": r["source_workbook"], "sheet": r["source_sheet"], "row": r["source_row"], "source_record_id": r["source_record_id"]} for r in matching if r["postcode_raw"] == raw_values[0]]
                output.append((row_num, "source_provenance", json.dumps(refs, ensure_ascii=False, separators=(",", ":"))))
                flags = ["LEGACY_POSTCODE_UNVERIFIED"]
                if not canonical_postcode or re.sub(r"\D", "", canonical_postcode) != re.sub(r"\D", "", raw_values[0]):
                    flags.append("RAW_POSTCODE_DIFFERS_FROM_CANONICAL")
                output.append((row_num, "source_quality_flags", json.dumps(flags, separators=(",", ":"))))

    else:  # contacts
        source_index: dict[tuple[str, str], list[dict[str, Any]]] = defaultdict(list)
        for company_id_value, source_rows in by_company.items():
            for record in source_rows:
                raw = record.get("_linkedin_raw")
                # Raw source URL is retained separately from its canonical field.
                if raw:
                    source_index[(company_id_value, str(record.get("contact_name", "")).casefold())].append(record)
        for row_num, row in enumerate(rows, start=2):
            company_id = _cell(row, company_index)
            name = _value(row, indexes, "name").casefold()
            matching = source_index.get((company_id, name), [])
            raw_values = list(dict.fromkeys(str(r.get("_linkedin_raw", "")) for r in matching if r.get("_linkedin_raw")))
            if len(raw_values) == 1:
                output.append((row_num, "professional_url_raw", raw_values[0]))
                refs = [{"workbook": r["source_workbook"], "sheet": r["source_sheet"], "row": r["source_row"], "source_record_id": r["source_record_id"]} for r in matching]
                output.append((row_num, "source_provenance", json.dumps(refs, ensure_ascii=False, separators=(",", ":"))))
                output.append((row_num, "source_quality_flags", '["LEGACY_PROFESSIONAL_URL_UNVERIFIED"]'))
    return output


def _main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source-dir", type=Path, default=DEFAULT_SOURCE_DIR)
    parser.add_argument("--env-file", type=Path, default=DEFAULT_ENV)
    parser.add_argument("--apply", action="store_true", help="Apply the reviewed append-only migration")
    args = parser.parse_args()

    master_path = args.source_dir / "1. Master - QLD Customers.xlsx"
    targets_path = args.source_dir / "Customers - Targets - QLD.xlsx"
    for path in (master_path, targets_path):
        if not path.is_file():
            raise RuntimeError(f"Required source workbook not found: {path.name}")

    master_records, master_stats = _read_workbook(master_path, is_master=True)
    target_records, target_stats = _read_workbook(targets_path, is_master=False)
    records = master_records + target_records

    service, spreadsheet_id = _build_service(args.env_file)
    metadata = _execute(service.spreadsheets().get(spreadsheetId=spreadsheet_id), "read spreadsheet metadata")
    titles = {sheet["properties"]["title"] for sheet in metadata.get("sheets", [])}
    missing_canonical = [SPREADSHEET_TABS[key]["name"] for key in CANONICAL_TABS if SPREADSHEET_TABS[key]["name"] not in titles]
    if missing_canonical:
        raise RuntimeError(f"Expected live canonical tabs are missing: {', '.join(missing_canonical)}")

    before: dict[str, tuple[list[str], list[list[str]], str]] = {}
    for key in CANONICAL_TABS:
        title = SPREADSHEET_TABS[key]["name"]
        headers, rows = _read_tab(service, spreadsheet_id, title)
        if not headers:
            raise RuntimeError(f"Live canonical tab {title} has no header row")
        if any(len(row) > len(headers) and any(str(v).strip() for v in row[len(headers):]) for row in rows):
            raise RuntimeError(f"{title} has nonblank cells past its last header; refusing to append columns")
        before[title] = (headers, rows, _canonical_snapshot(headers, rows))

    company_headers, company_rows, _ = before[SPREADSHEET_TABS["companies"]["name"]]
    match_info = _prepare_records(records, company_rows, company_headers)
    enrichments = {
        key: _source_enrichments(key, before[SPREADSHEET_TABS[key]["name"]][1], before[SPREADSHEET_TABS[key]["name"]][0], match_info["by_company"])
        for key in CANONICAL_TABS
    }

    # Plan missing headers without writing. Existing headings and columns
    # remain in place; additions are always at the far right.
    planned_headers: dict[str, list[str]] = {}
    for key in (*CANONICAL_TABS, "source_records"):
        title = SPREADSHEET_TABS[key]["name"]
        if title in titles:
            headers, rows = _read_tab(service, spreadsheet_id, title)
        else:
            headers, rows = [], []
            if key != "source_records":
                raise RuntimeError(f"Expected live tab {title} is missing")
        if not headers:
            planned_headers[title] = list(SPREADSHEET_TABS[key]["columns"])
        else:
            present = {_header_key(value) for value in headers}
            missing = [value for value in SPREADSHEET_TABS[key]["columns"] if _header_key(value) not in present]
            planned_headers[title] = headers + missing

    # Assign canonical IDs only after the company map has been built. These
    # helper keys are not written to the Sheet.
    canonical_names = defaultdict(list)
    ci = _header_index(company_headers)
    for row in company_rows:
        cid = _value(row, ci, "company_id")
        cname = _value(row, ci, "normalized_name") or _value(row, ci, "company_name")
        if cid and cname:
            canonical_names[_normalize_company(cname)].append(cid)
    for record in records:
        name = str(record.get("company_name", ""))
        matches = canonical_names.get(_normalize_company(name), []) if name else []
        record["company_id"] = matches[0] if len(matches) == 1 else ""
        record.pop("_matched", None)

    # Reconstruct the private LinkedIn raw value from its source cell for the
    # contact enrichment pass and remove it before serialization.
    for record in records:
        raw_object = json.loads(record["raw_data_json"])
        for cell in raw_object.get("cells", []):
            header = _header_key(cell.get("header", ""))
            if header in {"linkedin", "linkedin_url", "professional_url"}:
                record["_linkedin_raw"] = cell.get("value", "")
                break
    # Re-run source matching after raw LinkedIn extraction; IDs/counts are stable.
    match_info = _prepare_records(records, company_rows, company_headers)
    enrichments = {
        key: _source_enrichments(key, before[SPREADSHEET_TABS[key]["name"]][1], before[SPREADSHEET_TABS[key]["name"]][0], match_info["by_company"])
        for key in CANONICAL_TABS
    }

    # Preflight: source IDs must be unique, existing source IDs must have the
    # same hash, and newly added columns may only be blank or already equal.
    id_hashes: dict[str, str] = {}
    for record in records:
        record_id = str(record["source_record_id"])
        if record_id in id_hashes and id_hashes[record_id] != record["source_sha256"]:
            raise RuntimeError("Source workbook generated a duplicate ID with different content")
        id_hashes[record_id] = str(record["source_sha256"])

    existing_source_rows: list[list[str]] = []
    source_title = SPREADSHEET_TABS["source_records"]["name"]
    source_headers: list[str] = []
    if source_title in titles:
        source_headers, existing_source_rows = _read_tab(service, spreadsheet_id, source_title)
        source_indexes = _header_index(source_headers)
        if existing_source_rows and ("source_record_id" not in source_indexes or "source_sha256" not in source_indexes):
            raise RuntimeError("Existing SourceRecords rows lack ID/hash headers; refusing to append")
        present_hashes: dict[str, str] = {}
        for row in existing_source_rows:
            record_id = _value(row, source_indexes, "source_record_id")
            if not record_id:
                if any(str(value).strip() for value in row):
                    raise RuntimeError("SourceRecords contains a nonblank row without a source_record_id")
                continue
            digest = _value(row, source_indexes, "source_sha256")
            if record_id in present_hashes and present_hashes[record_id] != digest:
                raise RuntimeError("SourceRecords already contains conflicting duplicate IDs")
            present_hashes[record_id] = digest
        conflicts = [record_id for record_id, digest in id_hashes.items() if record_id in present_hashes and present_hashes[record_id] != digest]
        if conflicts:
            raise RuntimeError(f"{len(conflicts)} existing source rows differ from workbook content; refusing overwrite")
    else:
        present_hashes = {}

    canonical_conflicts = 0
    for key, pairs in enrichments.items():
        title = SPREADSHEET_TABS[key]["name"]
        headers, rows, _ = before[title]
        indexes = _header_index(headers)
        for row_number, field_name, expected in pairs:
            index = indexes.get(_header_key(field_name))
            existing_value = _cell(rows[row_number - 2], index) if row_number - 2 < len(rows) else ""
            if existing_value and existing_value != expected:
                canonical_conflicts += 1

    preserved_source_cells = sum(stat["cells"] + stat["header_cells"] for stat in master_stats["sheets"].values()) + sum(stat["cells"] + stat["header_cells"] for stat in target_stats["sheets"].values())
    print("GenLead source-sheet migration preflight")
    print(f"  Workbooks: 2; SHA-256: {master_stats['workbook_sha256'][:12]}…, {target_stats['workbook_sha256'][:12]}…")
    print(f"  Nonblank source rows: {master_stats['nonblank_rows'] + target_stats['nonblank_rows']:,}; blank rows skipped: {master_stats['blank_rows'] + target_stats['blank_rows']:,}")
    print(f"  Nonblank source cells preserved in row archive (including headers): {preserved_source_cells:,}")
    print(f"  Logical source records: {len(records):,}; linked: {match_info['linked']:,}; ambiguous matches: {match_info['ambiguous']:,}; unmatched: {match_info['unmatched']:,}")
    print(f"  New-column enrichment cells planned: {sum(map(len, enrichments.values())):,}; conflicts: {canonical_conflicts:,}")
    print(f"  Existing source records: {len(existing_source_rows):,}; already imported: {sum(1 for record in records if record['source_record_id'] in present_hashes):,}; new to append: {sum(1 for record in records if record['source_record_id'] not in present_hashes):,}")
    print("  Target tabs: Companies, Locations, Contacts, SourceRecords")

    if canonical_conflicts:
        raise RuntimeError("Preflight found nonblank enrichment cells that differ; no writes were made")
    if not args.apply:
        print("DRY RUN only. Review the counts above; pass --apply to perform this append-only upgrade.")
        return 0

    # Add SourceRecords if needed, then append only missing schema headers.
    if source_title not in titles:
        _execute(service.spreadsheets().batchUpdate(
            spreadsheetId=spreadsheet_id,
            body={"requests": [{"addSheet": {"properties": {"title": source_title}}}]},
        ), "create SourceRecords tab")
    for title, desired in planned_headers.items():
        current, _ = _read_tab(service, spreadsheet_id, title)
        if not current:
            _execute(service.spreadsheets().values().update(
                spreadsheetId=spreadsheet_id, range=f"'{title}'!A1",
                valueInputOption="RAW", body={"values": [desired]},
            ), f"write {title} headers")
        else:
            missing = [value for value in desired if _header_key(value) not in {_header_key(v) for v in current}]
            if missing:
                start = _column_letter(len(current))
                end = _column_letter(len(current) + len(missing) - 1)
                _execute(service.spreadsheets().values().update(
                    spreadsheetId=spreadsheet_id, range=f"'{title}'!{start}1:{end}1",
                    valueInputOption="RAW", body={"values": [missing]},
                ), f"append {title} headers")

    # Canonical source-only details are filled only where blank; preflight has
    # already proved there are no differing nonblank values.
    for key, pairs in enrichments.items():
        title = SPREADSHEET_TABS[key]["name"]
        headers, rows = _read_tab(service, spreadsheet_id, title)
        indexes = _header_index(headers)
        values_to_write = []
        for row_number, field_name, expected in pairs:
            column_index = indexes.get(_header_key(field_name))
            if column_index is None:
                raise RuntimeError(f"{title} is missing required enrichment column {field_name}")
            current_row = rows[row_number - 2] if row_number - 2 < len(rows) else []
            if _cell(current_row, column_index) == expected:
                continue
            values_to_write.append({
                "range": f"'{title}'!{_column_letter(column_index)}{row_number}",
                "values": [[expected]],
            })
        for start in range(0, len(values_to_write), 500):
            _execute(service.spreadsheets().values().batchUpdate(
                spreadsheetId=spreadsheet_id,
                body={"valueInputOption": "RAW", "data": values_to_write[start : start + 500]},
            ), f"enrich {title} source fields")

    # Append SourceRecords in batches. The existing columns (if any) are
    # honored by header name, and custom columns remain blank/unmodified.
    live_source_headers, live_source_rows = _read_tab(service, spreadsheet_id, source_title)
    source_metadata = _execute(
        service.spreadsheets().get(spreadsheetId=spreadsheet_id),
        "read SourceRecords grid capacity",
    )
    source_sheet = next(
        item for item in source_metadata.get("sheets", [])
        if item["properties"]["title"] == source_title
    )
    source_properties = source_sheet["properties"]
    source_grid = source_properties.get("gridProperties", {})
    required_rows = len(live_source_rows) + len(records) + 1
    required_columns = max(len(live_source_headers), len(REQUIRED_SOURCE_HEADERS))
    if source_grid.get("rowCount", 0) < required_rows or source_grid.get("columnCount", 0) < required_columns:
        _execute(service.spreadsheets().batchUpdate(
            spreadsheetId=spreadsheet_id,
            body={"requests": [{"updateSheetProperties": {
                "properties": {
                    "sheetId": source_properties["sheetId"],
                    "gridProperties": {
                        "rowCount": max(required_rows, source_grid.get("rowCount", 0)),
                        "columnCount": max(required_columns, source_grid.get("columnCount", 0)),
                    },
                },
                "fields": "gridProperties.rowCount,gridProperties.columnCount",
            }}]},
        ), "expand SourceRecords grid")
    live_source_indexes = _header_index(live_source_headers)
    known_ids = {
        _value(row, live_source_indexes, "source_record_id")
        for row in live_source_rows
        if _value(row, live_source_indexes, "source_record_id")
    }
    pending = [record for record in records if record["source_record_id"] not in known_ids]
    for start in range(0, len(pending), 250):
        batch = pending[start : start + 250]
        values = []
        for record in batch:
            values.append([
                str(record.get(_header_key(header), "") or "")
                for header in live_source_headers
            ])
        _execute(service.spreadsheets().values().append(
            spreadsheetId=spreadsheet_id,
            range=f"'{source_title}'!A:A",
            valueInputOption="RAW",
            insertDataOption="INSERT_ROWS",
            body={"values": values},
        ), f"append SourceRecords rows {start + 1}-{start + len(batch)}")

    # Read back hashes and old canonical columns. A failed verification is
    # reported as a failed migration; rerunning safely fills any partial gap.
    verify_headers, verify_rows = _read_tab(service, spreadsheet_id, source_title)
    verify_indexes = _header_index(verify_headers)
    verify_hashes = {
        _value(row, verify_indexes, "source_record_id"): _value(row, verify_indexes, "source_sha256")
        for row in verify_rows
        if _value(row, verify_indexes, "source_record_id")
    }
    missing_after = [record_id for record_id, digest in id_hashes.items() if verify_hashes.get(record_id) != digest]
    if missing_after:
        raise RuntimeError(f"Read-back verification failed for {len(missing_after)} source records")

    for title, (old_headers, _old_rows, old_digest) in before.items():
        new_headers, new_rows = _read_tab(service, spreadsheet_id, title)
        if new_headers[: len(old_headers)] != old_headers:
            raise RuntimeError(f"Read-back verification found an existing header change in {title}")
        if _canonical_snapshot(old_headers, new_rows) != old_digest:
            raise RuntimeError(f"Read-back verification found an existing data change in {title}")

    print(f"APPLIED and verified: {len(id_hashes):,} source rows; {len(verify_rows):,} total SourceRecords rows.")
    print("Existing canonical columns, values, and order passed before/after preservation checks.")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(_main())
    except Exception as exc:  # keep env/token/API error bodies out of console output
        print(f"Migration stopped safely: {exc}", file=sys.stderr)
        raise SystemExit(1)
