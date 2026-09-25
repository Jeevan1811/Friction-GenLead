from __future__ import annotations

import asyncio
import sys

from app.services.overture_discovery import (
    MAX_RESULTS,
    OverturePlacesDiscovery,
    PublicSourceError,
    _query_overture,
)


class FakeGeocoder:
    async def resolve_place(self, location: str) -> dict:
        assert location == "Gladstone, Queensland, Australia"
        return {
            "latitude": -23.842,
            "longitude": 151.255,
            "country": "Australia",
            "country_code": "au",
            "region": "Queensland",
        }


def test_search_maps_latest_global_place_records_with_source_provenance():
    calls: list[tuple] = []

    async def release_fetcher() -> str:
        return "2026-09-23.0"

    def query_runner(release, bounds, categories, limit):
        calls.append((release, bounds, categories, limit))
        return [{
            "id": "gers:example-123",
            "names": {"primary": "Example Industrial Services"},
            "taxonomy": {"primary": "engineering_service", "basic_category": "engineering"},
            "confidence": 0.83,
            "operating_status": "open",
            "bbox": {"xmin": 151.24, "ymin": -23.85, "xmax": 151.25, "ymax": -23.84},
            "addresses": [{
                "freeform": "12 Industry Road",
                "locality": "Gladstone",
                "region": "Queensland",
                "postcode": "4680",
                "country": "Australia",
                "country_code": "au",
            }],
            "websites": ["https://example.invalid/"],
            "phones": ["+61 7 5555 0101"],
            "emails": ["info@example.invalid"],
            "sources": [{
                "dataset": "meta",
                "record_id": "way/123",
                "license": "CDLA-Permissive-2.0",
            }],
        }]

    discovery = OverturePlacesDiscovery(
        geocoder=FakeGeocoder(),
        release_fetcher=release_fetcher,
        query_runner=query_runner,
    )
    rows = asyncio.run(discovery.search("Gladstone, Queensland, Australia", "Heavy Industry"))

    assert len(rows) == 1
    row = rows[0]
    assert row["provider_id"] == "gers:example-123"
    assert row["name"] == "Example Industrial Services"
    assert row["industry"] == "engineering_service"
    assert row["lat"] == -23.845
    assert row["lng"] == 151.245
    assert row["website"] == "https://example.invalid/"
    assert row["phone"] == "+61 7 5555 0101"
    assert row["email"] == "info@example.invalid"
    assert row["source"] == "OVERTURE_MAPS"
    assert row["source_provenance"]["release"] == "2026-09-23.0"
    assert row["source_provenance"]["sources"][0]["license"] == "CDLA-Permissive-2.0"
    assert row["source_provenance"]["source_licenses"] == ["CDLA-Permissive-2.0"]
    assert "CANDIDATE" in row["source_quality_flags"]
    assert "industry" in row["source_quality_flags"].casefold()
    assert calls[0][0] == "2026-09-23.0"
    assert calls[0][3] == MAX_RESULTS
    assert "engineering_service" in calls[0][2]


def test_search_bounds_global_query_and_filters_selected_industry():
    captured: dict = {}

    async def release_fetcher() -> str:
        return "2026-09-23.0"

    def query_runner(release, bounds, categories, limit):
        captured.update(release=release, bounds=bounds, categories=categories, limit=limit)
        return []

    discovery = OverturePlacesDiscovery(
        geocoder=FakeGeocoder(),
        release_fetcher=release_fetcher,
        query_runner=query_runner,
    )
    rows = asyncio.run(discovery.search("Gladstone, Queensland, Australia", "Mining"))

    assert rows == []
    west, south, east, north = captured["bounds"]
    assert 0 < east - west < 0.2
    assert 0 < north - south < 0.2
    assert "b2b_mining" in captured["categories"]
    assert "b2b_quarry" in captured["categories"]
    assert "gas_station" not in captured["categories"]


def test_latest_release_rejects_untrusted_catalog_value():
    async def release_fetcher() -> str:
        return "../../latest"

    discovery = OverturePlacesDiscovery(
        geocoder=FakeGeocoder(),
        release_fetcher=release_fetcher,
        query_runner=lambda *_: [],
    )

    try:
        asyncio.run(discovery.search("Gladstone, Queensland, Australia", "Mining"))
    except PublicSourceError as exc:
        assert "release" in str(exc).casefold()
    else:
        raise AssertionError("untrusted release string must be rejected")


def test_unrecognized_industry_fails_closed_without_broadening_to_all_places():
    calls: list[tuple] = []

    async def release_fetcher() -> str:
        return "2026-09-23.0"

    def query_runner(*args):
        calls.append(args)
        return []

    discovery = OverturePlacesDiscovery(
        geocoder=FakeGeocoder(),
        release_fetcher=release_fetcher,
        query_runner=query_runner,
    )

    rows = asyncio.run(discovery.search("Gladstone, Queensland, Australia", "Unmapped industry"))

    assert rows == []
    assert not calls
    assert discovery.last_warnings


def test_duckdb_connection_uses_supported_resource_options(monkeypatch):
    observed: dict = {}

    class FakeConnection:
        description: list = []

        def execute(self, _query, _parameters=None):
            return self

        def fetchall(self):
            return []

        def close(self):
            pass

    def fake_connect(*, database, config):
        observed["database"] = database
        observed["config"] = config
        return FakeConnection()

    monkeypatch.setitem(sys.modules, "duckdb", type("DuckDB", (), {"connect": staticmethod(fake_connect)})())

    rows = _query_overture(
        "2026-09-23.0",
        (151.2, -23.9, 151.3, -23.8),
        ("b2b_mining",),
        10,
    )

    assert rows == []
    assert observed["database"] == ":memory:"
    assert observed["config"] == {"threads": "2", "memory_limit": "768MB"}
