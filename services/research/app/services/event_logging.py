"""Safe, machine-readable events for API and search failure diagnosis."""

from __future__ import annotations

import json
import logging
import re
from datetime import datetime, timezone


_SAFE_IDENTIFIER = re.compile(r"^[A-Za-z0-9_.:-]{1,96}$")
_SAFE_ROUTE = re.compile(r"^/[A-Za-z0-9_./{}:-]{0,200}$")


def exception_category(exc: BaseException, *, fallback: str = "runtime_error") -> str:
    """Classify common failures without returning or logging provider messages."""
    try:
        text = str(exc).casefold()
    except Exception:
        text = ""

    response = getattr(exc, "response", None)
    status = getattr(response, "status_code", None)
    if not isinstance(status, int):
        status = getattr(getattr(exc, "resp", None), "status", None)
    if not isinstance(status, int):
        match = re.search(r"\b(?:HTTP\s*)?(401|402|403|408|429|5\d\d)\b", text, re.IGNORECASE)
        status = int(match.group(1)) if match else None

    if status == 429:
        return "rate_limit"
    if status == 402:
        return "billing_limit"
    if status in {401, 403}:
        return "access_denied"
    if status == 408:
        return "timeout"
    if isinstance(status, int) and 500 <= status <= 599:
        return "upstream_server_error"

    exception_name = type(exc).__name__.casefold()
    if "timeout" in exception_name or "timed out" in text or "timeout" in text:
        return "timeout"
    if any(
        token in exception_name
        for token in ("connecterror", "connectionerror", "networkerror")
    ):
        return "connection_error"
    if any(
        token in text
        for token in ("connection refused", "could not connect", "name or service not known")
    ):
        return "connection_error"
    if any(token in exception_name for token in ("jsondecode", "decodeerror")):
        return "invalid_response"
    if "sheet" in text or "spreadsheet" in text:
        return "sheets_error"
    return fallback


def emit_event(
    logger: logging.Logger,
    *,
    event: str,
    category: str,
    level: int,
    provider: str | None = None,
    exception: BaseException | None = None,
    correlation_id: str | None = None,
    route: str | None = None,
    method: str | None = None,
    http_status: int | None = None,
    outcome: str | None = None,
    sources_succeeded: int | None = None,
    sources_failed: int | None = None,
    candidates_found: int | None = None,
    saved_area_matches: int | None = None,
    companies_saved: int | None = None,
    contacts_saved: int | None = None,
    sheets_sync: str | None = None,
) -> None:
    """Emit one JSON event with an explicit UTC timestamp and no raw exception data."""
    severity = logging.getLevelName(level).lower()
    payload: dict[str, str | int] = {
        "timestamp_utc": datetime.now(timezone.utc)
        .isoformat(timespec="milliseconds")
        .replace("+00:00", "Z"),
        "service": "frictiongenlead-api",
        "event": event,
        "severity": severity,
        "category": category,
    }
    for key, value in (
        ("provider", provider),
        ("correlation_id", correlation_id),
        ("route", route),
        ("method", method),
        ("outcome", outcome),
        ("sheets_sync", sheets_sync),
    ):
        is_safe = (
            bool(_SAFE_ROUTE.fullmatch(value))
            if key == "route" and value is not None
            else bool(_SAFE_IDENTIFIER.fullmatch(value))
            if value is not None
            else False
        )
        if value is not None and is_safe:
            payload[key] = value
    if exception is not None:
        exception_name = type(exception).__name__
        payload["exception_class"] = (
            exception_name if _SAFE_IDENTIFIER.fullmatch(exception_name) else "Exception"
        )
    if sources_succeeded is not None:
        payload["sources_succeeded"] = max(0, int(sources_succeeded))
    if sources_failed is not None:
        payload["sources_failed"] = max(0, int(sources_failed))
    if candidates_found is not None:
        payload["candidates_found"] = max(0, int(candidates_found))
    if saved_area_matches is not None:
        payload["saved_area_matches"] = max(0, int(saved_area_matches))
    if companies_saved is not None:
        payload["companies_saved"] = max(0, int(companies_saved))
    if contacts_saved is not None:
        payload["contacts_saved"] = max(0, int(contacts_saved))
    if http_status is not None:
        payload["http_status"] = int(http_status)

    logger.log(level, json.dumps(payload, separators=(",", ":"), sort_keys=True))
