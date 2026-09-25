"""Regression coverage for provider failures during streamed chat replies."""

from __future__ import annotations

import httpx
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.routers import chat as chat_router
from app.services import assistant
from app.services.auth import require_auth


def test_stream_provider_failure_returns_fallback_and_done_event(monkeypatch):
    async def build_context(_question, _page):
        return object()

    async def failing_stream(_messages):
        yield "partial provider answer"
        request = httpx.Request("POST", "https://provider.example/chat")
        response = httpx.Response(402, request=request)
        raise httpx.HTTPStatusError(
            "controlled provider failure",
            request=request,
            response=response,
        )

    monkeypatch.setattr(chat_router.llm, "api_key", "test-key")
    monkeypatch.setattr(chat_router.llm, "chat_stream", failing_stream)
    monkeypatch.setattr(assistant, "build_context", build_context)
    monkeypatch.setattr(assistant, "system_prompt", lambda _context: "test system prompt")
    monkeypatch.setattr(
        assistant,
        "fallback_answer",
        lambda _question, _context, ai_down: "Built-in fallback answer." if ai_down else "",
    )

    app = FastAPI()
    app.include_router(chat_router.router)
    app.dependency_overrides[require_auth] = lambda: None

    with TestClient(app, raise_server_exceptions=False) as client:
        response = client.post(
            "/internal/chat",
            json={
                "messages": [{"role": "user", "content": "hello"}],
                "stream": True,
            },
        )

    assert response.status_code == 200
    assert response.headers["content-type"].startswith("text/event-stream")
    assert "Built-in fallback answer." in response.text
    assert "partial provider answer" not in response.text
    assert "data: [DONE]" in response.text


def test_successful_stream_adds_button_link_on_its_own_sse_data_line(monkeypatch):
    async def build_context(_question, _page):
        return object()

    async def successful_stream(_messages):
        yield "The search found saved companies."

    monkeypatch.setattr(chat_router.llm, "api_key", "test-key")
    monkeypatch.setattr(chat_router.llm, "chat_stream", successful_stream)
    monkeypatch.setattr(assistant, "build_context", build_context)
    monkeypatch.setattr(assistant, "system_prompt", lambda _context: "test system prompt")

    app = FastAPI()
    app.include_router(chat_router.router)
    app.dependency_overrides[require_auth] = lambda: None
    with TestClient(app, raise_server_exceptions=False) as client:
        response = client.post(
            "/internal/chat",
            json={
                "messages": [{"role": "user", "content": "What did my latest search find?"}],
                "stream": True,
            },
        )

    assert response.status_code == 200
    assert "data: [[open:/searches|Open Searches]]" in response.text
    assert "data: [DONE]" in response.text
