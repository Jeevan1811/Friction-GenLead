"""Tests for the GenLead assistant's grounding, guide matching and fallback."""

from __future__ import annotations

import asyncio
import json
import re
from pathlib import Path

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
    adapter._activities.update({
        "a1": {"activity_id": "a1", "company_id": "c1", "contact_id": "k1", "activity_type": "CALL",
               "outcome": "Asked for a site visit", "notes": "Discussed pump maintenance contract", "happened_at": "2026-09-20T10:00:00Z",
               "follow_up_at": "2099-09-30T10:00:00Z", "follow_up_status": "OPEN"},
        "a2": {"activity_id": "a2", "company_id": "c2", "contact_id": "", "activity_type": "EMAIL",
               "outcome": "Sent catalogue", "notes": "Awaiting response", "happened_at": "2026-09-18T10:00:00Z",
               "follow_up_at": "2026-09-22T10:00:00Z", "follow_up_status": "COMPLETED"},
    })
    adapter._search_runs.update({
        "run1": {"job_id": "run1", "location_query": "Gladstone, Queensland", "country": "Australia",
                 "industry": "Heavy Industry", "status": "COMPLETED", "companies_found": 30,
                 "contacts_found": 1, "created_at": "2026-09-25T10:00:00Z", "updated_at": "2026-09-25T10:05:00Z",
                 "details_saved": "true", "company_ids": "[\"c1\"]"},
    })
    adapter._source_records.update({
        "src1": {"source_record_id": "src1", "record_type": "company", "company_id": "c1",
                 "company_name": "Northern Ridge Mining Pty Ltd", "source_workbook": "Master QLD Customers",
                 "source_sheet": "Sheet 2", "source_row": "17", "source_field": "verification source",
                 "landline_raw": "07 4777 8888", "verification_source_raw": "Spoke with Jane",
                 "legacy_source_text": "Call in September", "source_sha256": "never-send-this-hash",
                 "raw_data_json": json.dumps({"cells": [{"header": "Legacy Note", "value": "Original pump maintenance client"}]})},
    })
    adapter._rejections.append({
        "entity_id": "c1", "entity_type": "company", "entity_name": "Northern Ridge Mining Pty Ltd",
        "reason": "Outside selected service area", "rejected_by": "MSV", "rejected_at": "2026-09-21T10:00:00Z",
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


def test_contact_can_be_found_by_live_email_or_phone(seeded):
    by_email = _ctx("Who is jane@example.com?").render()
    by_phone = _ctx("Who has 0400 000 000?").render()
    assert "Jane Citizen" in by_email
    assert "Jane Citizen" in by_phone


def test_company_can_be_found_by_live_abn(seeded):
    text = _ctx("Which company has ABN 11111111111?").render()
    assert "Coastal Pumps QLD" in text


def test_rejection_reason_is_available_from_live_rejection_log(seeded):
    question = "Why was Northern Ridge Mining rejected?"
    text = _ctx(question).render()
    assert "Outside selected service area" in text
    assert "Open Rejected" in assistant.add_navigation(question, text)


def test_generic_words_do_not_trigger_company_matches(seeded):
    seeded._companies["c3"] = {"company_id": "c3", "company_name": "Mining", "normalized_name": "mining",
                               "abn": "", "status": "NEW"}
    ctx = _ctx("how do I find a mining company")
    assert not any("Company: Mining" in m for m in ctx.matches)


def test_postcode_and_role_questions(seeded):
    assert "Postcode 4744: 1 location across 1 company" in _ctx("who is in 4744?").render()
    assert "1 contact with 'plant manager'" in _ctx("how many plant manager contacts are there").render()
    assert "Contacts at postcode 4744: Jane Citizen" in _ctx("Which contacts are at postcode 4744?").render()


def test_location_can_be_found_by_live_suburb(seeded):
    question = "Which sites are in Moranbah?"
    text = _ctx(question).render()
    assert "Location search: 1 location across 1 company" in text
    assert "Northern Ridge Mining Pty Ltd" in text
    assert "Open Locations" in assistant.add_navigation(question, text)


def test_place_count_uses_matching_locations_not_global_company_total(seeded):
    question = "How many companies are in Moranbah?"
    out = assistant.fallback_answer(question, _ctx(question), ai_down=False)
    assert "Location search: 1 location across 1 company" in out
    assert "Live Google Sheet totals: 2 companies" not in out
    assert "Open Locations" in out


def test_overview_has_live_totals(seeded):
    overview = _ctx("hi").overview
    assert "2 companies; 1 location; 1 contact" in overview


def test_assistant_context_covers_every_live_sheet_tab(seeded):
    ctx = _ctx("hi")
    assert ctx.counts == {
        "companies": 2, "locations": 1, "contacts": 1, "rejected": 1,
        "activities": 2, "search_runs": 1, "source_records": 1,
        "open_followups": 1, "overdue_followups": 0,
    }
    assert "2 activities" in ctx.overview
    assert "1 saved search run" in ctx.overview
    assert "1 preserved original source row" in ctx.overview


def test_live_activity_and_followup_questions_return_relevant_sheet_rows(seeded):
    text = _ctx("What did I discuss with Northern Ridge Mining and what follow-up is due?").render()
    assert "pump maintenance contract" in text
    assert "2099-09-30T10:00:00Z" in text
    assert "Awaiting response" not in text


def test_broad_followup_question_shows_open_followups_only(seeded):
    text = _ctx("Which follow-ups are due?").render()
    assert "1 open follow-up" in text
    assert "Northern Ridge Mining Pty Ltd" in text
    assert "Awaiting response" not in text


def test_followup_count_fallback_answers_from_live_activity_rows(seeded):
    question = "How many follow-ups are due?"
    out = assistant.fallback_answer(question, _ctx(question), ai_down=False)
    assert "1 open follow-up" in out
    assert "Open Follow-ups" in out


def test_overdue_question_only_shows_past_due_open_items(seeded):
    seeded._activities["a3"] = {
        "activity_id": "a3", "company_id": "c2", "activity_type": "CALL", "outcome": "No reply yet",
        "notes": "Try again", "happened_at": "2026-09-19T10:00:00Z",
        "follow_up_at": "2000-09-20T10:00:00Z", "follow_up_status": "OPEN",
    }
    text = _ctx("How many overdue follow-ups?").render()
    assert "Coastal Pumps QLD" in text
    assert "Activity: Northern Ridge Mining Pty Ltd" not in text
    out = assistant.fallback_answer("How many overdue follow-ups?", _ctx("How many overdue follow-ups?"), ai_down=False)
    assert "1 overdue follow-up" in out


def test_unrelated_company_question_does_not_send_contact_pii(seeded):
    text = _ctx("What is the status of Northern Ridge Mining?").render()
    assert "status NEW" in text
    assert "Jane Citizen" not in text and "jane@example.com" not in text


def test_live_search_history_is_summarized_without_internal_ids(seeded):
    text = _ctx("What did my latest search find?").render()
    assert "Gladstone, Queensland" in text
    assert "30 companies" in text
    assert "candidate details saved" in text
    assert "Saved company names: Northern Ridge Mining Pty Ltd" in text
    assert "c1" not in text and "run1" not in text
    assert "Open Searches" in assistant.add_navigation("What did my latest search find?", text)


def test_original_workbook_values_are_searchable_without_hashes(seeded):
    text = _ctx("Find the original Excel landline and verification source for Northern Ridge").render()
    assert "07 4777 8888" in text
    assert "Spoke with Jane" in text
    assert "Master QLD Customers" in text and "Sheet 2" in text
    assert "never-send-this-hash" not in text and '"raw_data_json"' not in text
    assert "Open Original data" in assistant.add_navigation("Find the original Excel landline", text)


def test_count_fallback_uses_live_tab_totals_without_irrelevant_tour(seeded):
    question = "How many companies are in my data?"
    out = assistant.fallback_answer(question, _ctx(question), ai_down=False)
    assert "2 companies" in out
    assert "Start or replay the dashboard guide" not in out


def test_assistant_does_not_send_user_to_ask_a_person():
    prompt = assistant.system_prompt(assistant.DataContext())
    assert "do not send them to ask a person" in prompt
    assert "asking the Friction team" not in prompt


def test_overdue_followup_uses_parsed_due_date():
    from datetime import datetime, timezone

    now = datetime(2026, 9, 26, tzinfo=timezone.utc)
    assert assistant._is_overdue({"follow_up_at": "2026-09-25T10:00:00Z", "follow_up_status": "OPEN"}, now)
    assert not assistant._is_overdue({"follow_up_at": "2026-09-30T10:00:00Z", "follow_up_status": "OPEN"}, now)
    assert not assistant._is_overdue({"follow_up_at": "2026-09-20T10:00:00Z", "follow_up_status": "COMPLETED"}, now)


def test_every_screenshot_marker_has_an_instructional_asset():
    repo = Path(__file__).resolve().parents[3]
    for shot in KNOWN_SHOTS:
        assert (repo / "apps" / "web" / "public" / "guides" / f"{shot}.png").is_file()

    renderer = (repo / "apps" / "web" / "src" / "lib" / "chat-markers.mjs").read_text(encoding="utf-8")
    paths_block = renderer.split("CHAT_KNOWN_PATHS = new Set([", 1)[1].split("]);", 1)[0]
    shots_block = renderer.split("CHAT_KNOWN_SHOTS = new Set([", 1)[1].split("]);", 1)[0]
    frontend_paths = set(re.findall(r'"(/[^\"]+)"', paths_block))
    frontend_shots = set(re.findall(r'"([a-z0-9-]+)"', shots_block))
    assert frontend_paths == set(KNOWN_PATHS)
    assert frontend_shots == set(KNOWN_SHOTS)


def test_failed_sheet_tab_is_reported_as_unavailable_not_zero(seeded, monkeypatch):
    async def fail_read():
        raise RuntimeError("synthetic Sheet outage")

    monkeypatch.setattr(seeded, "read_source_records", fail_read)
    ctx = _ctx("How many original source rows are there?")
    assert ctx.counts["source_records"] is None
    assert "unavailable preserved original source rows" in ctx.overview
    assert "source_records" in ctx.overview


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


def test_sanitize_preserves_the_fixed_google_sheet_marker():
    assert assistant.sanitize("Open the live workbook: [[sheet]]") == "Open the live workbook: [[sheet]]"


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
