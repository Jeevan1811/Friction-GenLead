"""Regression coverage for validating every crawler redirect before use."""

from __future__ import annotations

import asyncio

import httpx
import httpcore
import pytest

from app.services import crawler as crawler_module
from app.services.crawler import (
    CrawlResult,
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

        async def request(self, method, url, **_kwargs):
            assert method == "GET"
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


def test_contact_extraction_uses_visible_explicit_person_role_and_source():
    html = """
    <html><body>
      <h2>Jane Smith — Managing Director</h2>
      <h3>Alex Tan</h3><p>Procurement Manager</p>
      <a href="mailto:team@acme.com">Email our team</a>
      <a href="tel:+61733334444">+61 7 3333 4444</a>
      <script>ceo@invented.example</script>
    </body></html>
    """

    contacts = asyncio.run(
        WebsiteCrawler().extract_contacts(
            html,
            source_url="https://acme.com/about/team",
        )
    )

    named = [contact for contact in contacts if contact.name]
    generic = [contact for contact in contacts if not contact.name]
    assert [(contact.name, contact.role) for contact in named] == [
        ("Jane Smith", "Managing Director"),
        ("Alex Tan", "Procurement Manager"),
    ]
    assert all(contact.source_url == "https://acme.com/about/team" for contact in contacts)
    assert any(contact.email == "team@acme.com" for contact in generic)
    assert any(contact.phone == "+61 7 3333 4444" for contact in generic)
    assert all("invented" not in contact.email for contact in contacts)


def test_crawl_site_honors_robots_and_stays_on_same_origin(monkeypatch):
    crawler = WebsiteCrawler()
    requested: list[str] = []
    pages = {
        "https://acme.example/robots.txt": CrawlResult(
            url="https://acme.example/robots.txt",
            status_code=200,
            content_type="text/plain",
            body=(
                "User-agent: FrictionGenLead\n"
                "Disallow: /team\n"
                "Allow: /contact\n"
            ),
            elapsed_ms=1,
        ),
        "https://acme.example/": CrawlResult(
            url="https://acme.example/",
            status_code=200,
            content_type="text/html",
            body=(
                '<a href="/team">Team</a>'
                '<a href="/contact">Contact</a>'
                '<a href="https://other.example/team">External</a>'
            ),
            elapsed_ms=1,
        ),
        "https://acme.example/contact": CrawlResult(
            url="https://acme.example/contact",
            status_code=200,
            content_type="text/html",
            body="<p>Contact page</p>",
            elapsed_ms=1,
        ),
    }

    async def fake_fetch(url: str, **_kwargs) -> CrawlResult:
        requested.append(url)
        return pages[url]

    monkeypatch.setattr(crawler, "fetch", fake_fetch)
    results = asyncio.run(crawler.crawl_site("https://acme.example/", max_pages=4))

    assert [result.url for result in results] == [
        "https://acme.example/",
        "https://acme.example/contact",
    ]
    assert "https://acme.example/team" not in requested
    assert "https://other.example/team" not in requested
