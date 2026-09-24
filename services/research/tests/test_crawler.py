"""Regression coverage for validating every crawler redirect before use."""

from __future__ import annotations

import asyncio

import httpx
import httpcore
import pytest

from app.services import crawler as crawler_module
from app.services.crawler import (
    SSRFError,
    WebsiteCrawler,
    _PinnedAddressBackend,
    _ResolvedTarget,
)


class _RecordingBackend(httpcore.AsyncNetworkBackend):
    def __init__(self):
        self.connected_hosts: list[str] = []

    async def connect_tcp(self, host, port, timeout=None, local_address=None, socket_options=None):
        self.connected_hosts.append(host)
        return object()

    async def connect_unix_socket(self, path, timeout=None, socket_options=None):
        return object()

    async def sleep(self, seconds):
        return None


def test_network_backend_connects_to_pinned_address_not_hostname():
    delegate = _RecordingBackend()
    backend = _PinnedAddressBackend(
        {("public.example", 443): ("93.184.216.34",)},
        delegate=delegate,
    )

    async def exercise():
        await backend.connect_tcp("public.example", 443)
        with pytest.raises(httpcore.ConnectError, match="validated DNS"):
            await backend.connect_tcp("unvalidated.example", 443)

    asyncio.run(exercise())
    assert delegate.connected_hosts == ["93.184.216.34"]


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
    pinned_after_validation: dict[tuple[str, int], tuple[str, ...]] = {}

    class FakeClient:
        def __init__(self, **kwargs):
            self.follow_redirects = kwargs.get("follow_redirects", False)
            self.transport = kwargs["transport"]
            pinned_after_validation.update(
                self.transport._pool._network_backend._addresses
            )

        async def __aenter__(self):
            return self

        async def __aexit__(self, *_args):
            await self.transport.aclose()
            return None

        async def get(self, url, **_kwargs):
            requests.append(str(url))
            if self.follow_redirects:
                requests.append(private_url)
                return final_response
            return redirect_response

    crawler = WebsiteCrawler()

    def validate_url(url: str) -> _ResolvedTarget:
        if url == private_url:
            raise SSRFError("private destination blocked")
        return _ResolvedTarget("public.example", 443, ("93.184.216.34",))

    monkeypatch.setattr(crawler, "_resolve_and_validate", validate_url)
    monkeypatch.setattr(crawler_module.httpx, "AsyncClient", FakeClient)

    with pytest.raises(SSRFError, match="private destination blocked"):
        asyncio.run(crawler.fetch(start_url))

    assert requests == [start_url]
    assert pinned_after_validation == {
        ("public.example", 443): ("93.184.216.34",),
    }
