"""Tests for the GenLead assistant's grounding, guide matching and fallback."""

from __future__ import annotations

import asyncio

import pytest

from app.services import assistant
from app.services.assistant_guides import GUIDES, KNOWN_PATHS, KNOWN_SHOTS
from app.services.sheets import GoogleSheetsAdapter


@pytest.fixture()
def seeded(monkeypatch):
    """A mock-mode adapter with a few FICTIONAL rows, swapped in for the singleton."""
    adapter = GoogleSheetsAdapter()
    asyncio.run(adapter.connect())
    adapter._companies.update({
        "c1": {"company_id": "c1", "company_name": "Northern Ridge Mining Pty Ltd",
               "normalized_name": "northern ridge mining", "abn": "", "status": "NEW"},
        "c2": {"company_id": "c2", "company_name": "Coastal Pumps QLD",
               "normalized_name": "coastal pumps qld", "abn": "11111111111", "status": "APPROVED"},
    })
    adapter._locations.update({
        "l1": {"location_id": "l1", "company_id": "c1", "site_name": "Ridge Mine", "location_type": "MINE",
               "address": "1 Ridge Rd", "suburb": "Moranbah", "postcode": "4744"},
    })
    adapter._contacts.update({
        "k1": {"contact_id": "k1", "company_id": "c1", "name": "Jane Citizen", "position": "Plant Manager",
               "role_priority": "PRIORITY", "business_email": "jane@example.com", "mobile": "0400 000 000"},
    })
    monkeypatch.setattr(assistant, "sheets_adapter", adapter)
    return adapter


def _ctx(q: str):
    return asyncio.run(assistant.build_context(q, "/companies"))


def test_named_company_brings_its_site_and_contacts(seeded):
    text = _ctx("Who is the contact at Northern Ridge Mining?").render()
    assert "Northern Ridge Mining Pty Ltd" in text
    assert "Jane Citizen" in text and "jane@example.com" in text
    assert "Ridge Mine" in text


def test_generic_words_do_not_trigger_company_matches(seeded):
    seeded._companies["c3"] = {"company_id": "c3", "company_name": "Mining", "normalized_name": "mining",
                               "abn": "", "status": "NEW"}
    ctx = _ctx("how do I find a mining company")
    assert not any("Company: Mining" in m for m in ctx.matches)


def test_postcode_and_role_questions(seeded):
    assert "Postcode 4744: 1 location across 1 company" in _ctx("who is in 4744?").render()
    assert "1 contact with 'plant manager'" in _ctx("how many plant manager contacts are there").render()


def test_overview_has_live_totals(seeded):
    overview = _ctx("hi").overview
    assert "2 companies, 1 locations, 1 contacts" in overview


def test_data_answer_is_not_padded_with_unrelated_guides(seeded):
    q = "Who is the contact at Northern Ridge Mining?"
    out = assistant.fallback_answer(q, _ctx(q))
    assert "Jane Citizen" in out
    assert "Browse and use contacts" not in out


@pytest.mark.parametrize("question,guide_id", [
    ("how do I approve a company?", "approve-reject"),
    ("how do I reject a contact", "approve-reject"),
    ("where are rejected companies", "rejected"),
    ("how do I add a new company", "sheet-sync"),
    ("what does STALE mean", "statuses"),
    ("I forgot my password", "account"),
    ("how do I start a research for a postcode", "research"),
    ("can I export to excel", "sheet-sync"),
    ("how do I edit a company's website", "sheet-sync"),
    ("where do I restart the dashboard guide", "dashboard-tour"),
    ("show me the dashboard tour", "dashboard-tour"),
])
def test_guide_matching(question, guide_id):
    assert assistant._best_guide(question).id == guide_id


def test_sanitize_drops_invented_markers_and_caps_screenshots():
    out = assistant.sanitize(
        "x [[open:/nope|Bad]] [[open:/companies|Open Companies]] [[shot:bogus]] "
        "[[shot:approve-reject]] [[shot:companies-detail]] [[shot:companies-list]]"
    )
    assert "/nope" not in out and "bogus" not in out
    assert "[[open:/companies|Open Companies]]" in out
    assert out.count("[[shot:") == assistant.MAX_SHOTS_PER_ANSWER


def test_every_guide_marker_is_real():
    for g in GUIDES:
        if g.open:
            assert g.open[0] in KNOWN_PATHS
        assert set(g.shots) <= KNOWN_SHOTS


def test_dashboard_tour_guide_points_to_settings_and_is_non_mutating():
    guide = next(g for g in GUIDES if g.id == "dashboard-tour")
    assert guide.open == ("/settings", "Open Settings")
    assert guide.open[0] in KNOWN_PATHS
    assert any("does not submit forms" in note for note in guide.notes)


def test_research_guide_is_honest_about_public_search_limits():
    research = next(g for g in GUIDES if g.id == "research")
    assert any("not exhaustive" in step.lower() for step in research.steps)
    assert any("robots.txt" in note.lower() for note in research.notes)
