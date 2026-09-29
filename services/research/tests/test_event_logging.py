from __future__ import annotations

import asyncio
import json
import logging
from datetime import datetime
from types import SimpleNamespace

from fastapi import FastAPI, Request

from app.main import unhandled_exception_handler
from app.services.event_logging import emit_event, exception_category
from app.services.jev import Jev, PipelineStep, ResearchJob, StepStatus


def _event_from_caplog(caplog) -> dict:
    record = next(record for record in caplog.records if record.name == "test.events")
    return json.loads(record.message)


def test_event_is_timestamped_utc_structured_and_excludes_exception_message(caplog):
    caplog.set_level(logging.WARNING, logger="test.events")
    secret_detail = "private@example.com token=do-not-log"

    emit_event(
        logging.getLogger("test.events"),
        event="search.source_failed",
        category="rate_limit",
        level=logging.WARNING,
        provider="firecrawl",
        exception=RuntimeError(secret_detail),
        correlation_id="3a0ca9f1-10fe-4a33-a747-673abf00f3d2",
    )

    event = _event_from_caplog(caplog)
    timestamp = datetime.fromisoformat(event["timestamp_utc"].replace("Z", "+00:00"))
    assert timestamp.utcoffset().total_seconds() == 0
    assert event == {
        "category": "rate_limit",
        "correlation_id": "3a0ca9f1-10fe-4a33-a747-673abf00f3d2",
        "event": "search.source_failed",
        "exception_class": "RuntimeError",
        "provider": "firecrawl",
        "service": "frictiongenlead-api",
        "severity": "warning",
        "timestamp_utc": event["timestamp_utc"],
    }
    assert secret_detail not in caplog.text


def test_exception_categories_distinguish_rate_limit_timeout_and_runtime():
    rate_limited = SimpleNamespace(resp=SimpleNamespace(status=429))

    assert exception_category(rate_limited) == "rate_limit"
    assert exception_category(TimeoutError("private host timed out")) == "timeout"
    assert exception_category(RuntimeError("unexpected internal condition")) == "runtime_error"


def test_unhandled_request_event_uses_route_template_not_raw_path_or_exception_text(caplog):
    caplog.set_level(logging.ERROR, logger="app.main")
    app = FastAPI()
    scope = {
        "type": "http",
        "http_version": "1.1",
        "method": "GET",
        "scheme": "https",
        "path": "/companies/private@example.com",
        "raw_path": b"/companies/private@example.com",
        "query_string": b"",
        "headers": [],
        "client": ("127.0.0.1", 12345),
        "server": ("test", 443),
        "root_path": "",
        "app": app,
    }
    request = Request(scope)
    request.scope["route"] = SimpleNamespace(path="/companies/{company_id}")
    private_detail = "failed for private@example.com api_key=secret"

    response = asyncio.run(unhandled_exception_handler(request, RuntimeError(private_detail)))

    assert response.status_code == 500
    event_record = next(record for record in caplog.records if record.name == "app.main")
    event = json.loads(event_record.message)
    assert event["event"] == "http.request_failed"
    assert event["route"] == "/companies/{company_id}"
    assert event["method"] == "GET"
    assert event["http_status"] == 500
    assert event["exception_class"] == "RuntimeError"
    assert private_detail not in caplog.text
    assert "private@example.com" not in caplog.text


def test_partial_provider_failure_is_marked_warning_and_counts_successful_sources(caplog):
    class RateLimitedPlaces:
        async def search(self, _location, _industry):
            raise RuntimeError("HTTP 429 for private@example.com secret=never-log")

    class EmptyWebSearch:
        async def search(self, _location, _industry):
            return []

    job = ResearchJob(
        job_id="aa9b3ea5-b394-424c-b97a-96a65bfd5482",
        postcode="",
        industry="Heavy Industry",
        target_roles=[],
        location_query="Gladstone Queensland",
        steps=[
            PipelineStep(name=name)
            for name in ("discover", "verify", "research_contacts", "evaluate")
        ],
    )
    service = Jev(places=RateLimitedPlaces(), web_search=EmptyWebSearch())
    caplog.set_level(logging.WARNING, logger="app.services.jev")

    asyncio.run(service._step_discover_public_sources(job))

    event = next(
        json.loads(record.message)
        for record in caplog.records
        if record.name == "app.services.jev"
        and json.loads(record.message).get("event") == "search.source_failed"
    )
    assert event["category"] == "rate_limit"
    assert event["provider"] == "overture"
    assert event["severity"] == "warning"
    assert event["outcome"] == "partial_source_failure"
    assert event["sources_succeeded"] == 1
    assert event["sources_failed"] == 1
    assert "private@example.com" not in caplog.text
    assert "never-log" not in caplog.text


def test_total_discovery_failure_marks_each_source_as_error_and_records_exhaustion(caplog):
    class RateLimitedPlaces:
        async def search(self, _location, _industry):
            raise RuntimeError("HTTP 429 for private@example.com secret=never-log")

    class UnavailableWebSearch:
        async def search(self, _location, _industry):
            raise RuntimeError("HTTP 503 for private@example.com secret=never-log")

    job = ResearchJob(
        job_id="1775d3a5-d6f9-461f-a5cd-ea2e18a91007",
        postcode="",
        industry="Heavy Industry",
        target_roles=[],
        location_query="Private customer site",
        steps=[
            PipelineStep(name=name)
            for name in ("discover", "verify", "research_contacts", "evaluate")
        ],
    )
    service = Jev(places=RateLimitedPlaces(), web_search=UnavailableWebSearch())
    caplog.set_level(logging.WARNING, logger="app.services.jev")

    asyncio.run(service._step_discover_public_sources(job))

    events = [
        json.loads(record.message)
        for record in caplog.records
        if record.name == "app.services.jev"
    ]
    source_events = [event for event in events if event.get("event") == "search.source_failed"]
    assert {event["provider"] for event in source_events} == {"overture", "firecrawl"}
    assert {event["severity"] for event in source_events} == {"warning"}
    assert {event["outcome"] for event in source_events} == {"all_sources_failed"}
    assert all(event["sources_succeeded"] == 0 for event in source_events)
    assert all(event["sources_failed"] == 2 for event in source_events)
    exhaustion = next(
        event
        for event in events
        if event.get("event") == "search.discovery_sources_exhausted"
    )
    assert exhaustion["category"] == "all_sources_failed"
    assert exhaustion["severity"] == "error"
    assert exhaustion["sources_failed"] == 2
    assert "private@example.com" not in caplog.text
    assert "never-log" not in caplog.text
    assert "Private customer site" not in caplog.text


def test_pipeline_failure_emits_terminal_event_without_raw_exception_text(caplog):
    job = ResearchJob(
        job_id="d0bd1242-7d07-421f-a860-3af97e12c077",
        postcode="",
        industry=None,
        target_roles=[],
        steps=[
            PipelineStep(name=name)
            for name in ("discover", "verify", "research_contacts", "evaluate")
        ],
    )
    service = Jev()

    async def fail_discovery(_job):
        raise RuntimeError("HTTP 503 private@example.com token=never-log")

    service._step_discover = fail_discovery
    caplog.set_level(logging.ERROR, logger="app.services.jev")

    asyncio.run(service._run_pipeline(job))

    event = next(
        json.loads(record.message)
        for record in caplog.records
        if record.name == "app.services.jev"
        and json.loads(record.message).get("event") == "search.pipeline_failed"
    )
    assert event["category"] == "upstream_server_error"
    assert event["exception_class"] == "RuntimeError"
    assert event["severity"] == "error"
    assert job.status == "failed"
    assert "private@example.com" not in caplog.text
    assert "never-log" not in caplog.text


def test_successful_pipeline_emits_terminal_saved_counts(caplog):
    job = ResearchJob(
        job_id="1c9aa468-2410-4c22-8f5b-8cb5a72f8030",
        postcode="",
        industry=None,
        target_roles=[],
        steps=[
            PipelineStep(name=name)
            for name in ("discover", "verify", "research_contacts", "evaluate")
        ],
        companies_found=[{"company_name": "Fictional company"}],
        contacts_found=[{"name": "Fictional contact"}, {"name": "Another fictional contact"}],
    )
    service = Jev()

    async def complete_discovery(current_job):
        current_job.steps[0].status = StepStatus.COMPLETED

    async def noop(_job):
        return None

    service._step_discover = complete_discovery
    service._step_verify = noop
    service._step_research_contacts = noop
    service._step_evaluate = noop
    caplog.set_level(logging.INFO, logger="app.services.jev")

    asyncio.run(service._run_pipeline(job))

    event = next(
        json.loads(record.message)
        for record in caplog.records
        if record.name == "app.services.jev"
        and json.loads(record.message).get("event") == "search.pipeline_completed"
    )
    assert event["outcome"] == "completed"
    assert event["companies_saved"] == 1
    assert event["contacts_saved"] == 2
    assert event["sheets_sync"] == "not_configured"
    assert job.status == "completed"
