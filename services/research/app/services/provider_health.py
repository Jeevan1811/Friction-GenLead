"""Safe, process-local health summaries for external AI and research providers."""

from __future__ import annotations

from datetime import datetime, timezone
import re
from threading import Lock
from typing import Any


def describe_provider_failure(
    service_id: str,
    status_code: int | None = None,
    *,
    partial: bool = False,
) -> dict[str, str]:
    """Return a user-facing cause and next step without exposing provider codes or bodies."""
    if service_id == "chatbot":
        if status_code == 402:
            message = (
                "AI-written replies are unavailable because the AI provider account has a billing or usage limit. "
                "The built-in guide and live-data answers still work."
            )
            next_step = "Ask the account administrator to check the OpenRouter billing and usage settings."
        elif status_code in {401, 403}:
            message = (
                "AI-written replies are unavailable because the AI provider rejected its saved access credentials. "
                "The built-in guide and live-data answers still work."
            )
            next_step = "Ask the account administrator to check the OpenRouter connection."
        elif status_code == 429:
            message = (
                "AI-written replies are temporarily limited by the provider. "
                "The built-in guide and live-data answers still work."
            )
            next_step = "Wait a moment, then try again."
        else:
            message = (
                "The AI provider could not complete a reply. "
                "The built-in guide and live-data answers still work."
            )
            next_step = "Try again shortly. If this continues, ask the account administrator to check the AI service."
        return {"state": "attention", "message": message, "next_step": next_step}

    if status_code == 402:
        message = (
            "A prospect-research source has a billing or usage limit. "
            "Jev may still return candidates from other sources, so results could be incomplete."
        )
        next_step = "Ask the account administrator to check the affected source before retrying."
    elif status_code in {401, 403}:
        message = (
            "A prospect-research source denied access. "
            "Jev may still return candidates from other sources, so results could be incomplete."
        )
        next_step = "Ask the account administrator to check the source connection and access settings."
    elif status_code == 429:
        message = (
            "A prospect-research source is temporarily limiting requests. "
            "Other available sources may still return candidates."
        )
        next_step = "Wait briefly before running the search again."
    elif partial:
        message = "Some prospect-research sources did not respond; results may be incomplete."
        next_step = "Review the latest search summary and retry later if needed."
    else:
        message = "Prospect research could not reach one or more public data sources."
        next_step = "Check the search location and try again shortly."
    return {"state": "attention", "message": message, "next_step": next_step}


def provider_http_error_message(service_id: str, status_code: int) -> str:
    """Safe detail for research-job errors; never forwards the upstream status number."""
    issue = describe_provider_failure(service_id, status_code)
    return f"{issue['message']} {issue['next_step']}"


def describe_provider_exception(
    service_id: str,
    exc: Exception,
    *,
    partial: bool = False,
) -> dict[str, str]:
    """Classify a provider exception without forwarding its message or payload."""
    status_code = getattr(getattr(exc, "response", None), "status_code", None)
    if not isinstance(status_code, int):
        match = re.search(r"\b(?:HTTP\s*)?(401|402|403|429|5\d\d)\b", str(exc), re.IGNORECASE)
        status_code = int(match.group(1)) if match else None
    if status_code is not None:
        return describe_provider_failure(service_id, status_code, partial=partial)

    text = str(exc).casefold()
    if "fastcrw local search could not complete" in text:
        return {
            "state": "attention",
            "message": "Self-hosted web search is unavailable; mapped-place and saved-workbook results remain available.",
            "next_step": "The account administrator should check the local fastCRW and SearXNG services and JSON search configuration.",
        }
    if "website discovery is not configured" in text:
        return {
            "state": "attention",
            "message": "Website discovery is not configured; mapped-place and saved-workbook results remain available.",
            "next_step": "The account administrator must configure Firecrawl access for additional website discovery.",
        }
    if "parseable abn rows" in text or "recognized no-results message" in text:
        return {
            "state": "attention",
            "message": "The ABR response contained neither parseable ABN rows nor a recognized no-results message, so Jev could not confirm company matches.",
            "next_step": "The ABR search format may have changed; check its availability and retry later.",
        }
    if "billing" in text or "usage limit" in text or "credit limit" in text:
        return describe_provider_failure(service_id, 402, partial=partial)
    if "denied access" in text or "rejected its saved access" in text:
        return describe_provider_failure(service_id, 403, partial=partial)
    if "rate limit" in text or "cooling down" in text or "too many requests" in text:
        return describe_provider_failure(service_id, 429, partial=partial)
    if "resolve" in text and ("place" in text or "location" in text):
        return {
            "state": "attention",
            "message": "The search location could not be matched to a place.",
            "next_step": "Check the spelling or try a nearby city or postcode.",
        }
    if "sheet" in text or "spreadsheet" in text:
        return {
            "state": "attention",
            "message": "Could not safely deduplicate prospects because the live Google Sheet could not be read; the search stopped before saving prospects.",
            "next_step": "Check the Google Sheets connection in Settings, then retry.",
        }
    if any(token in text for token in ("timeout", "timed out", "could not reach", "unavailable", "connection")):
        return {
            "state": "attention",
            "message": "A prospect-research source could not be reached right now.",
            "next_step": "Other sources may still return candidates; try again shortly.",
        }
    if any(token in text for token in ("invalid json", "invalid response", "unusable data")):
        return {
            "state": "attention",
            "message": "A prospect-research source returned data the app could not use.",
            "next_step": "Other sources may still return candidates; retry later if results are incomplete.",
        }
    return describe_provider_failure(service_id, partial=partial)


class ProviderHealthRegistry:
    """Keep only sanitized status summaries; never store keys, bodies, or exception text."""

    def __init__(self) -> None:
        self._lock = Lock()
        self._states: dict[str, dict[str, Any]] = {}

    def record_success(self, service_id: str) -> None:
        message = (
            "AI replies are working."
            if service_id == "chatbot"
            else "Prospect-research sources responded on the latest search."
        )
        self._store(service_id, {
            "state": "healthy",
            "message": message,
            "next_step": "",
            "checked_at": _now(),
        })

    def record_failure(
        self,
        service_id: str,
        status_code: int | None = None,
        *,
        partial: bool = False,
    ) -> dict[str, str]:
        issue = describe_provider_failure(service_id, status_code, partial=partial)
        self._store(service_id, {**issue, "checked_at": _now()})
        return issue

    def record_issue(self, service_id: str, issue: dict[str, str]) -> None:
        """Store a description generated by this module's safe classifiers only."""
        self._store(service_id, {
            "state": issue.get("state", "attention"),
            "message": issue.get("message", "The service could not complete its latest request."),
            "next_step": issue.get("next_step", "Try again shortly."),
            "checked_at": _now(),
        })

    def record_not_configured(self, service_id: str) -> None:
        self._store(service_id, {
            "state": "not_configured",
            "message": "AI-written replies are not configured. The built-in guide and live-data answers still work.",
            "next_step": "Ask the account administrator to configure the AI service.",
            "checked_at": None,
        })

    def get(self, service_id: str) -> dict[str, Any]:
        with self._lock:
            state = self._states.get(service_id)
            if state:
                return dict(state)
        if service_id == "chatbot":
            message = "No AI request has checked the provider during this API session."
            next_step = "Use the chatbot to check its current availability."
        else:
            message = "No prospect search has checked the research sources during this API session."
            next_step = "Run a search to check their current availability."
        return {
            "state": "not_checked",
            "message": message,
            "next_step": next_step,
            "checked_at": None,
        }

    def _store(self, service_id: str, state: dict[str, Any]) -> None:
        with self._lock:
            self._states[service_id] = dict(state)


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


provider_health = ProviderHealthRegistry()
