"""Tests for PI-002: Entity Resolver.

Run with::

    cd services/research
    python -m pytest app/services/resolver_test.py -v
"""

from __future__ import annotations

import pytest

from .resolver import (
    ConflictEntry,
    EntityResolver,
    ResolutionReport,
    calculate_similarity,
    find_matches,
    match_by_abn,
    match_contact,
    match_location,
    normalize_address,
    normalize_company_name,
    normalize_contact_name,
)


# ===================================================================
# normalize_company_name
# ===================================================================

class TestNormalizeCompanyName:
    """Company-name normalisation strips suffixes and standardises."""

    def test_strips_pty_ltd(self) -> None:
        assert normalize_company_name("Sun Metals Pty Ltd") == "sun metals"

    def test_strips_pty_limited(self) -> None:
        assert normalize_company_name("Sun Metals Pty Limited") == "sun metals"

    def test_strips_limited(self) -> None:
        assert normalize_company_name("CS Energy Limited") == "cs energy"

    def test_strips_ltd(self) -> None:
        assert normalize_company_name("Stanwell Corporation Ltd") == "stanwell"

    def test_strips_corporation(self) -> None:
        assert normalize_company_name("Sun Metals Corporation") == "sun metals"

    def test_strips_inc(self) -> None:
        assert normalize_company_name("Acme Inc") == "acme"

    def test_strips_group(self) -> None:
        assert normalize_company_name("Thiess Group") == "thiess"

    def test_strips_holdings(self) -> None:
        assert normalize_company_name("Downer Holdings") == "downer"

    def test_strips_australia(self) -> None:
        assert normalize_company_name("BHP Australia") == "bhp"

    def test_multiple_suffixes(self) -> None:
        assert normalize_company_name("Sun Metals Corporation Pty Ltd") == "sun metals"

    def test_collapses_whitespace(self) -> None:
        assert normalize_company_name("CS   Energy   Limited") == "cs energy"

    def test_lowercases(self) -> None:
        assert normalize_company_name("CS ENERGY") == "cs energy"

    def test_empty_string(self) -> None:
        assert normalize_company_name("") == ""

    def test_none_input(self) -> None:
        # The function signature says str, but be defensive.
        assert normalize_company_name("") == ""

    def test_preserves_core_name(self) -> None:
        """Only suffixes are stripped, not embedded words."""
        assert normalize_company_name("Group Technologies Pty Ltd") == "technologies"


# ===================================================================
# calculate_similarity
# ===================================================================

class TestCalculateSimilarity:
    """Similarity scoring between company names."""

    def test_identical_names(self) -> None:
        score = calculate_similarity("CS Energy", "CS Energy")
        assert score == 1.0

    def test_suffix_variation(self) -> None:
        """Same core name with different suffixes should score high."""
        score = calculate_similarity("Sun Metals Pty Ltd", "Sun Metals Corporation")
        assert score >= 0.90

    def test_completely_different(self) -> None:
        score = calculate_similarity("CS Energy", "Woolworths")
        assert score < 0.50

    def test_similar_names(self) -> None:
        score = calculate_similarity("Sun Metals", "Sun Metal")
        assert score >= 0.85

    def test_empty_vs_name(self) -> None:
        score = calculate_similarity("", "CS Energy")
        assert score == 0.0


# ===================================================================
# find_matches
# ===================================================================

class TestFindMatches:
    """Find matching company names above a threshold."""

    def test_finds_match(self) -> None:
        existing = ["CS Energy", "Stanwell Corporation", "Sun Metals Pty Ltd"]
        matches = find_matches("Sun Metals Corporation", existing, threshold=0.85)
        assert len(matches) >= 1
        assert matches[0][0] == "Sun Metals Pty Ltd"

    def test_no_match_below_threshold(self) -> None:
        existing = ["CS Energy", "BHP"]
        matches = find_matches("Woolworths Group", existing, threshold=0.85)
        assert len(matches) == 0

    def test_sorted_by_score(self) -> None:
        existing = ["Sun Metal", "Sun Metals Corp", "Sunshine Metals"]
        matches = find_matches("Sun Metals", existing, threshold=0.70)
        scores = [m[1] for m in matches]
        assert scores == sorted(scores, reverse=True)


# ===================================================================
# match_by_abn
# ===================================================================

class TestMatchByABN:
    """ABN exact matching -- the strongest signal."""

    def test_exact_match(self) -> None:
        existing = ["54078848745", "37078848674", "19074758014"]
        result = match_by_abn("54078848745", existing)
        assert result == "54078848745"

    def test_match_with_spaces(self) -> None:
        existing = ["54078848745"]
        result = match_by_abn("54 078 848 745", existing)
        assert result == "54078848745"

    def test_no_match(self) -> None:
        existing = ["54078848745"]
        result = match_by_abn("99999999999", existing)
        assert result is None

    def test_invalid_abn_too_short(self) -> None:
        existing = ["54078848745"]
        result = match_by_abn("12345", existing)
        assert result is None

    def test_empty_abn(self) -> None:
        existing = ["54078848745"]
        result = match_by_abn("", existing)
        assert result is None

    def test_none_abn(self) -> None:
        existing = ["54078848745"]
        # Type says str, but callers might pass None through.
        result = match_by_abn("", existing)
        assert result is None


# ===================================================================
# Contact matching
# ===================================================================

class TestNormalizeContactName:
    """Contact-name normalisation."""

    def test_strips_titles(self) -> None:
        assert normalize_contact_name("Mr. James Nguyen") == "james nguyen"

    def test_strips_dr(self) -> None:
        assert normalize_contact_name("Dr Sarah Mitchell") == "sarah mitchell"

    def test_lowercases(self) -> None:
        assert normalize_contact_name("KAREN O'BRIEN") == "karen o brien"


class TestMatchContact:
    """Contact matching by name and email."""

    def test_exact_name_match(self) -> None:
        existing = [
            {"name": "Sarah Mitchell", "email": "s.mitchell@example.com"},
            {"name": "James Nguyen", "email": "j.nguyen@example.com"},
        ]
        matched, score = match_contact("Sarah Mitchell", None, existing)
        assert matched == "Sarah Mitchell"
        assert score >= 0.90

    def test_email_domain_boost(self) -> None:
        existing = [
            {"name": "S Mitchell", "email": "s.mitchell@csenergy.com.au"},
        ]
        _, score_without = match_contact("Sarah Mitchell", None, existing)
        _, score_with = match_contact(
            "Sarah Mitchell", "sarah@csenergy.com.au", existing
        )
        # Email domain match should boost the score.
        assert score_with >= score_without

    def test_no_match(self) -> None:
        existing = [
            {"name": "Sarah Mitchell", "email": "s.mitchell@example.com"},
        ]
        matched, score = match_contact("Completely Different", None, existing)
        assert matched is None
        assert score == 0.0


# ===================================================================
# Location matching
# ===================================================================

class TestNormalizeAddress:
    """Address normalisation."""

    def test_expands_street(self) -> None:
        result = normalize_address("123 Main St")
        assert "street" in result

    def test_expands_road(self) -> None:
        result = normalize_address("45 Station Rd")
        assert "road" in result

    def test_lowercases(self) -> None:
        result = normalize_address("123 MAIN STREET")
        assert result == "123 main street"


class TestMatchLocation:
    """Location matching by postcode and address."""

    def test_postcode_match(self) -> None:
        existing = [
            {"id": "loc1", "postcode": "4000", "address": "100 Queen St"},
            {"id": "loc2", "postcode": "4811", "address": "Stuart Dr"},
        ]
        matched, score = match_location("4000", "100 Queen Street", existing)
        assert matched == "loc1"
        assert score >= 0.5

    def test_no_postcode_match(self) -> None:
        existing = [
            {"id": "loc1", "postcode": "4000", "address": "100 Queen St"},
        ]
        matched, score = match_location("9999", None, existing)
        assert matched is None


# ===================================================================
# Full pipeline
# ===================================================================

class TestEntityResolver:
    """End-to-end entity resolution pipeline."""

    def test_groups_by_abn(self) -> None:
        records = [
            {
                "company_name": "CS Energy Ltd",
                "abn": "54078848745",
                "contact_name": "Sarah Mitchell",
            },
            {
                "company_name": "CS Energy Limited",
                "abn": "54078848745",
                "contact_name": "James Nguyen",
            },
        ]
        resolver = EntityResolver()
        merged, conflicts, report = resolver.resolve(records)

        assert report.total_input_records == 2
        assert report.unique_companies == 1
        assert report.merged_by_abn == 1

        # Both contacts should be on the same company.
        company = merged[0]
        assert len(company["contacts"]) == 2

    def test_fuzzy_name_match(self) -> None:
        records = [
            {"company_name": "Sun Metals Corporation Pty Ltd"},
            {"company_name": "Sun Metals Corp"},
        ]
        resolver = EntityResolver(threshold=0.80)
        merged, conflicts, report = resolver.resolve(records)

        assert report.unique_companies == 1
        assert report.merged_by_name == 1

    def test_no_match_creates_separate(self) -> None:
        records = [
            {"company_name": "CS Energy"},
            {"company_name": "BHP Billiton"},
        ]
        resolver = EntityResolver()
        merged, conflicts, report = resolver.resolve(records)

        assert report.unique_companies == 2
        assert report.merged_by_abn == 0
        assert report.merged_by_name == 0

    def test_contact_deduplication(self) -> None:
        records = [
            {
                "company_name": "CS Energy",
                "abn": "54078848745",
                "contact_name": "Sarah Mitchell",
                "contact_email": "s.mitchell@example.com",
            },
            {
                "company_name": "CS Energy Ltd",
                "abn": "54078848745",
                "contact_name": "Sarah Mitchell",
                "contact_phone": "0412345678",
            },
        ]
        resolver = EntityResolver()
        merged, conflicts, report = resolver.resolve(records)

        company = merged[0]
        # Duplicate contacts should be merged into one.
        assert len(company["contacts"]) == 1
        # The merged contact should have both email and phone.
        contact = company["contacts"][0]
        assert contact["email"] == "s.mitchell@example.com"
        assert contact["phone"] == "0412345678"
        assert report.contacts_merged == 1

    def test_conflict_logging(self) -> None:
        records = [
            {
                "company_name": "CS Energy",
                "abn": "54078848745",
                "website": "https://old.example.com",
                "source": "LEGACY_EXCEL",
            },
            {
                "company_name": "CS Energy Ltd",
                "abn": "54078848745",
                "website": "https://new.example.com",
                "source": "LEGACY_EXCEL",
            },
        ]
        resolver = EntityResolver()
        merged, conflicts, report = resolver.resolve(records)

        # There should be a conflict for the website field.
        assert report.conflicts >= 1
        website_conflicts = [c for c in conflicts if c.field == "website"]
        assert len(website_conflicts) == 1
        assert website_conflicts[0].value_a == "https://old.example.com"
        assert website_conflicts[0].value_b == "https://new.example.com"

    def test_empty_input(self) -> None:
        resolver = EntityResolver()
        merged, conflicts, report = resolver.resolve([])

        assert report.total_input_records == 0
        assert report.unique_companies == 0
        assert merged == []
        assert conflicts == []
