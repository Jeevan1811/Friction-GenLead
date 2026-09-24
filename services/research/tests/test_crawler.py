"""Regression coverage for validating every crawler redirect before use."""

from __future__ import annotations

import asyncio

import httpx
import pytest

from app.services import crawler as crawler_module
from app.services.crawler import SSRFError, WebsiteCrawler


def test_private_redirect_is_rejected_before_requesting_its_destination(monkeypatch):
    start_url = "https://public.example/start"
    private_url = "http://127.0.0.1/admin"
    redirect_response = httpx.Response(
        302,
        headers={"location": private_url},
        request=httpx.Request("GET", start_url),
    )
    final_response = httpx.Response(
        200,
        text="private response",
        request=httpx.Request("GET", private_url),
    )
    final_response.history = [redirect_response]
    requests: list[str] = []

    class FakeClient:
        def __init__(self, **kwargs):
            self.follow_redirects = kwargs.get("follow_redirects", False)

        async def __aenter__(self):
            return self

        async def __aexit__(self, *_args):
            return None

        async def get(self, url, **_kwargs):
            requests.append(str(url))
            if self.follow_redirects:
                requests.append(private_url)
                return final_response
            return redirect_response

    crawler = WebsiteCrawler()

    def validate_url(url: str) -> str:
        if url == private_url:
            raise SSRFError("private destination blocked")
        return "public.example"

    monkeypatch.setattr(crawler, "_resolve_and_validate", validate_url)
    monkeypatch.setattr(crawler_module.httpx, "AsyncClient", FakeClient)

    with pytest.raises(SSRFError, match="private destination blocked"):
        asyncio.run(crawler.fetch(start_url))

    assert requests == [start_url]
