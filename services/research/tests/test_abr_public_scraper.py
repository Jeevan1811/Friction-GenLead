from __future__ import annotations

import asyncio

from app.services.abr import ABRAdapter
from app.services.crawler import CrawlResult


ABN_FIXTURE = "19415776361"


class _FakeCrawler:
    def __init__(self, body: str, *, allowed: bool = True, status_code: int = 200):
        self.body = body
        self.allowed = allowed
        self.status_code = status_code
        self.calls: list[tuple[str, str, dict | None]] = []

    async def can_fetch(self, url: str) -> bool:
        return self.allowed

    async def fetch(
        self,
        url: str,
        *,
        method: str = "GET",
        form_data: dict[str, str] | None = None,
        **_kwargs,
    ) -> CrawlResult:
        self.calls.append((url, method, form_data))
        return CrawlResult(
            url=url,
            status_code=self.status_code,
            content_type="text/html; charset=utf-8",
            body=self.body,
            elapsed_ms=1,
        )


def test_public_postcode_search_parses_records_and_dedupes_by_abn():
    html = f"""
    <html><title>Search results - active ABNs and names</title>
    <table>
      <tr><th>ABN</th><th>Name</th><th>Type</th><th>Location</th></tr>
      <tr>
        <td><a href="/ABN/View?abn={ABN_FIXTURE}">19 415 776 361</a> Active</td>
        <td>Sample Mining Company Pty Ltd</td>
        <td>Entity Name</td><td>4740</td>
      </tr>
    </table></html>
    """
    crawler = _FakeCrawler(html)
    adapter = ABRAdapter(crawler=crawler)

    results = asyncio.run(adapter.search_by_postcode("4740", "Mining"))
    cached = asyncio.run(adapter.lookup_abn(ABN_FIXTURE))

    assert len(results) == 1
    assert results[0]["abn"] == ABN_FIXTURE
    assert results[0]["name"] == "Sample Mining Company Pty Ltd"
    assert results[0]["name_type"] == "Entity Name"
    assert results[0]["status"] == "Active"
    assert results[0]["matched_terms"] == ["mining", "quarry", "mineral", "drilling"]
    assert cached is not None and cached.abn == ABN_FIXTURE
    assert len(crawler.calls) == 4
    assert all(call[1] == "POST" for call in crawler.calls)


def test_postcode_match_allows_abrs_suburb_and_state_text():
    html = f"""
    <table><tr><td>19 415 776 361 Active</td>
    <td>Sample Mining Company Pty Ltd</td><td>Entity Name</td>
    <td>Brisbane QLD 4000</td></tr></table>
    """
    adapter = ABRAdapter(crawler=_FakeCrawler(html))

    results = asyncio.run(adapter.search_by_postcode("4000", "Mining"))

    assert len(results) == 1
    assert results[0]["postcode"] == "4000"


def test_public_search_reports_abrs_truncated_result_notice():
    html = f"""
    <p>Your search was stopped before all matching names could be retrieved.</p>
    <table><tr><td>19 415 776 361 Active</td>
    <td>Sample Mining Company Pty Ltd</td><td>Entity Name</td><td>4740</td></tr></table>
    """
    adapter = ABRAdapter(crawler=_FakeCrawler(html))

    asyncio.run(adapter.search_by_postcode("4740", "Mining"))

    assert any("stopped before all matches" in warning for warning in adapter.last_warnings)


def test_public_search_rejects_unrecognized_empty_html_instead_of_reporting_zero_matches():
    adapter = ABRAdapter(crawler=_FakeCrawler("<html><body>Temporary maintenance</body></html>"))

    try:
        asyncio.run(adapter.search_by_postcode("4740", "Mining"))
    except RuntimeError as exc:
        assert "all abr public search queries failed" in str(exc).lower()
    else:
        raise AssertionError("An unrecognized empty page must not look like zero matches.")

    assert len(adapter.last_warnings) == 4
    assert all("neither parseable ABN rows" in warning for warning in adapter.last_warnings)


def test_public_search_accepts_an_explicit_no_results_page():
    adapter = ABRAdapter(crawler=_FakeCrawler("<html><body>No results found.</body></html>"))

    results = asyncio.run(adapter.search_by_postcode("4740", "Mining"))

    assert results == []
    assert not any("neither parseable ABN rows" in warning for warning in adapter.last_warnings)


def test_public_detail_lookup_extracts_status_entity_type_and_main_postcode():
    html = """
    <table>
      <tr><th>Entity name</th><td>Sample Mining Company Pty Ltd</td></tr>
      <tr><th>ABN status</th><td>Active from 01 Nov 1999</td></tr>
      <tr><th>Entity type</th><td>Australian Private Company</td></tr>
      <tr><th>Main business location</th><td>QLD 4740</td></tr>
      <tr><th>Trading name</th><td>Sample Mining Company</td></tr>
    </table>
    """
    adapter = ABRAdapter(crawler=_FakeCrawler(html))

    entity = asyncio.run(adapter.lookup_abn(ABN_FIXTURE))

    assert entity is not None
    assert entity.name == "Sample Mining Company Pty Ltd"
    assert entity.status == "Active"
    assert entity.entity_type == "Australian Private Company"
    assert entity.state == "QLD"
    assert entity.postcode == "4740"
    assert entity.business_names == ["Sample Mining Company"]
    assert entity.registered_date.isoformat() == "1999-11-01"


def test_public_search_does_not_bypass_robots_or_retry_rate_limits():
    crawler = _FakeCrawler("", allowed=False)
    adapter = ABRAdapter(crawler=crawler)

    try:
        asyncio.run(adapter.search_by_postcode("4740", "Mining"))
    except RuntimeError as exc:
        assert "all abr public search queries failed" in str(exc).lower()
    else:
        raise AssertionError("A robots-denied query must not run.")

    assert crawler.calls == []


def test_invalid_postcode_is_rejected_before_network_access():
    crawler = _FakeCrawler("")
    adapter = ABRAdapter(crawler=crawler)

    try:
        asyncio.run(adapter.search_by_postcode("3000", "Mining"))
    except ValueError as exc:
        assert "qld postcodes" in str(exc).lower()
    else:
        raise AssertionError("A non-QLD postcode should be rejected.")

    assert crawler.calls == []
