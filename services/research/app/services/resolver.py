"""PI-002: Entity Resolver -- deduplication and matching for Friction GenLead.

This module provides real fuzzy-matching algorithms for companies, contacts,
and locations.  It is used by the import pipeline to merge duplicate records
and by the discovery flow to link newly-discovered entities against existing
data in Google Sheets.

Matching hierarchy (strongest to weakest)
-----------------------------------------
1. ABN exact match  (definitive -- same legal entity)
2. Company-name fuzzy match  (SequenceMatcher, threshold 0.85)
3. Contact email domain match  (secondary)
4. Location postcode + address match  (postcode primary, address secondary)

Design principles
-----------------
- ABN is the ultimate authority.  If two records share the same valid ABN
  they are the same company, regardless of name differences.
- Company-name matching strips legal suffixes (Pty Ltd, Holdings, etc.)
  before comparison so that "Sun Metals Pty Ltd" matches "Sun Metals".
- The resolver never auto-merges silently when confidence is below
  threshold -- it logs a conflict for human review.
"""

from __future__ import annotations

import logging
import re
from dataclasses import dataclass, field
from difflib import SequenceMatcher
from typing import Any

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Company-name normalisation
# ---------------------------------------------------------------------------

_COMPANY_SUFFIXES = re.compile(
    r"\b("
    r"pty\s*ltd|pty\s*limited|ltd|limited|inc|incorporated"
    r"|corp|corporation|group|holdings|australia"
    r")\b",
    re.IGNORECASE,
)


def normalize_company_name(name: str) -> str:
    """Normalise a company name for comparison.

    Strips common corporate suffixes (Pty Ltd, Ltd, Limited, Inc, Corp,
    Group, Holdings, Australia), removes punctuation, collapses whitespace,
    and lowercases.

    Examples
    --------
    >>> normalize_company_name("Sun Metals Corporation Pty Ltd")
    'sun metals'
    >>> normalize_company_name("CS Energy  Limited  ")
    'cs energy'
    """
    if not name:
        return ""
    cleaned = _COMPANY_SUFFIXES.sub("", name)
    cleaned = re.sub(r"[^\w\s]", " ", cleaned)
    cleaned = re.sub(r"\s+", " ", cleaned).strip().lower()
    return cleaned


# ---------------------------------------------------------------------------
# Similarity
# ---------------------------------------------------------------------------

def calculate_similarity(name1: str, name2: str) -> float:
    """Calculate similarity ratio between two strings.

    Uses ``difflib.SequenceMatcher`` which produces a value in [0.0, 1.0]
    where 1.0 is an exact match.  Both inputs are normalised before
    comparison so that casing and suffixes don't affect the score.

    Parameters
    ----------
    name1, name2:
        Raw (un-normalised) company names.

    Returns
    -------
    float
        Similarity score in [0.0, 1.0].
    """
    norm1 = normalize_company_name(name1)
    norm2 = normalize_company_name(name2)
    if not norm1 or not norm2:
        return 0.0
    return SequenceMatcher(None, norm1, norm2).ratio()


def find_matches(
    candidate: str,
    existing: list[str],
    threshold: float = 0.85,
) -> list[tuple[str, float]]:
    """Find all existing names that match *candidate* above *threshold*.

    Parameters
    ----------
    candidate:
        The new company name to match.
    existing:
        List of known company names to compare against.
    threshold:
        Minimum similarity score to consider a match (default 0.85).

    Returns
    -------
    list[tuple[str, float]]
        ``(existing_name, score)`` pairs, sorted best-first.
    """
    results: list[tuple[str, float]] = []
    for name in existing:
        score = calculate_similarity(candidate, name)
        if score >= threshold:
            results.append((name, score))
    results.sort(key=lambda x: x[1], reverse=True)
    return results


# ---------------------------------------------------------------------------
# ABN matching
# ---------------------------------------------------------------------------

def match_by_abn(abn: str, existing: list[str]) -> str | None:
    """Find a matching ABN in the existing list.

    ABN is the strongest match signal -- an exact match is definitive.
    Both values are stripped of whitespace and non-digit characters
    before comparison.

    Parameters
    ----------
    abn:
        The ABN to look up.
    existing:
        List of known ABNs.

    Returns
    -------
    str | None
        The matching ABN from the existing list, or None.
    """
    if not abn:
        return None
    clean = "".join(c for c in abn if c.isdigit())
    if len(clean) != 11:
        return None
    for ex in existing:
        ex_clean = "".join(c for c in ex if c.isdigit())
        if clean == ex_clean:
            return ex
    return None


# ---------------------------------------------------------------------------
# Contact matching
# ---------------------------------------------------------------------------

def normalize_contact_name(name: str) -> str:
    """Normalise a contact name for comparison.

    Strips titles (Mr, Mrs, Dr, etc.), collapses whitespace, lowercases.

    Examples
    --------
    >>> normalize_contact_name("Mr. James T. Nguyen")
    'james t nguyen'
    """
    if not name:
        return ""
    # Remove common titles.
    cleaned = re.sub(
        r"\b(mr|mrs|ms|miss|dr|prof|sir|dame)\.?\b",
        "",
        name,
        flags=re.IGNORECASE,
    )
    cleaned = re.sub(r"[^\w\s]", " ", cleaned)
    cleaned = re.sub(r"\s+", " ", cleaned).strip().lower()
    return cleaned


def match_contact(
    name: str,
    email: str | None,
    existing_contacts: list[dict[str, Any]],
) -> tuple[str | None, float]:
    """Match a contact against existing contacts.

    Matching uses name similarity as the primary signal and email-domain
    match as a secondary boost.

    Parameters
    ----------
    name:
        Contact's full name.
    email:
        Contact's email address (optional).
    existing_contacts:
        List of dicts with at least ``"name"`` and optionally ``"email"``.

    Returns
    -------
    (matched_name, score)
        The best match and its confidence, or ``(None, 0.0)`` if no
        match exceeds the threshold.
    """
    if not name:
        return None, 0.0

    norm_name = normalize_contact_name(name)
    candidate_domain = _extract_email_domain(email)

    best_match: str | None = None
    best_score: float = 0.0

    for existing in existing_contacts:
        ex_name = existing.get("name", "")
        ex_norm = normalize_contact_name(ex_name)

        if not ex_norm:
            continue

        # Name similarity.
        score = SequenceMatcher(None, norm_name, ex_norm).ratio()

        # Email domain boost: if domains match, add 0.1 (capped at 1.0).
        ex_email = existing.get("email")
        if candidate_domain and ex_email:
            ex_domain = _extract_email_domain(ex_email)
            if candidate_domain == ex_domain and candidate_domain:
                score = min(score + 0.1, 1.0)

        if score > best_score:
            best_score = score
            best_match = ex_name

    # Only return if above threshold.
    if best_score >= 0.80:
        return best_match, best_score
    return None, 0.0


def _extract_email_domain(email: str | None) -> str | None:
    """Extract the domain part from an email address."""
    if not email or "@" not in email:
        return None
    return email.split("@", 1)[1].strip().lower()


# ---------------------------------------------------------------------------
# Location matching
# ---------------------------------------------------------------------------

def normalize_address(address: str) -> str:
    """Normalise a street address for comparison.

    Expands common abbreviations (St -> Street, Rd -> Road, etc.),
    collapses whitespace, and lowercases.

    Examples
    --------
    >>> normalize_address("123 Main St, Suite 4")
    '123 main street suite 4'
    """
    if not address:
        return ""
    cleaned = address.lower().strip()

    # Expand common abbreviations.
    abbreviations = {
        r"\bst\b": "street",
        r"\brd\b": "road",
        r"\bdr\b": "drive",
        r"\bave?\b": "avenue",
        r"\bblvd\b": "boulevard",
        r"\bcrt?\b": "court",
        r"\bpl\b": "place",
        r"\bhwy\b": "highway",
        r"\btce\b": "terrace",
        r"\bpde\b": "parade",
        r"\bcres\b": "crescent",
        r"\bln\b": "lane",
    }
    for abbr, full in abbreviations.items():
        cleaned = re.sub(abbr, full, cleaned)

    cleaned = re.sub(r"[^\w\s]", " ", cleaned)
    cleaned = re.sub(r"\s+", " ", cleaned).strip()
    return cleaned


def match_location(
    postcode: str,
    address: str | None,
    existing_locations: list[dict[str, Any]],
) -> tuple[str | None, float]:
    """Match a location against existing locations.

    Postcode is the primary signal (must match exactly).  Address
    similarity is the secondary signal within the same postcode.

    Parameters
    ----------
    postcode:
        4-digit Australian postcode.
    address:
        Street address (optional).
    existing_locations:
        List of dicts with ``"postcode"`` and optionally ``"address"``.

    Returns
    -------
    (matched_id, score)
        The best match's ``"id"`` (or ``"address"``) and confidence,
        or ``(None, 0.0)`` if no match exceeds the threshold.
    """
    if not postcode:
        return None, 0.0

    clean_postcode = "".join(c for c in postcode if c.isdigit())
    norm_addr = normalize_address(address or "")

    best_match: str | None = None
    best_score: float = 0.0

    for loc in existing_locations:
        ex_postcode = "".join(c for c in str(loc.get("postcode", "")) if c.isdigit())

        if clean_postcode != ex_postcode:
            continue

        # Postcode matches -- base score of 0.5.
        score = 0.5

        # Address similarity boosts the score.
        ex_addr = normalize_address(loc.get("address", ""))
        if norm_addr and ex_addr:
            addr_sim = SequenceMatcher(None, norm_addr, ex_addr).ratio()
            score = 0.5 + (addr_sim * 0.5)  # Scale address sim into [0.5, 1.0]

        loc_id = loc.get("id") or loc.get("address") or ex_postcode

        if score > best_score:
            best_score = score
            best_match = str(loc_id)

    if best_score >= 0.5:
        return best_match, best_score
    return None, 0.0


# ---------------------------------------------------------------------------
# Conflict log entry
# ---------------------------------------------------------------------------

@dataclass
class ConflictEntry:
    """A field-level conflict detected during entity resolution."""

    entity_type: str
    entity_name: str
    field: str
    value_a: str
    value_b: str
    resolution: str  # "kept_a", "kept_b", "manual_review"
    source_a: str
    source_b: str


# ---------------------------------------------------------------------------
# Resolution report
# ---------------------------------------------------------------------------

@dataclass
class ResolutionReport:
    """Summary of an entity-resolution run."""

    total_input_records: int = 0
    unique_companies: int = 0
    merged_by_abn: int = 0
    merged_by_name: int = 0
    contacts_merged: int = 0
    conflicts: int = 0


# ---------------------------------------------------------------------------
# Entity Resolver
# ---------------------------------------------------------------------------

@dataclass
class EntityResolver:
    """Resolve and deduplicate a list of raw prospect records.

    The resolver takes a list of flat dicts (as produced by the legacy
    Excel importer) and groups them into canonical companies, merging
    duplicates and accumulating contacts.

    Resolution pipeline
    -------------------
    1. Group by ABN (exact match -- strongest signal).
    2. Fuzzy-match remaining company names against known canonicals.
    3. Merge duplicate contacts within the same company.
    4. Produce: merged entities + conflict log + resolution report.
    """

    threshold: float = 0.85
    _canonical: dict[str, dict] = field(default_factory=dict)
    _abn_index: dict[str, str] = field(default_factory=dict)
    _conflicts: list[ConflictEntry] = field(default_factory=list)
    _report: ResolutionReport = field(default_factory=ResolutionReport)

    def resolve_companies(
        self,
        companies: list[dict[str, Any]],
    ) -> dict[str, Any]:
        """Deduplicate a list of {name, abn} dicts using ABN and name matching.

        This is a lightweight wrapper around :meth:`resolve` designed for the
        Jev pipeline's discovery step.  It converts the simplified input format
        into the full record format that ``resolve()`` expects, runs
        deduplication, and returns the merged list plus a duplicate count.

        Parameters
        ----------
        companies:
            List of dicts, each with at least ``"name"`` and optionally ``"abn"``.

        Returns
        -------
        dict with keys:
            ``"merged"`` -- the deduplicated list of company dicts.
            ``"duplicates_merged"`` -- number of duplicates that were merged.
        """
        records = [
            {
                "company_name": c.get("name", ""),
                "abn": c.get("abn", ""),
            }
            for c in companies
        ]

        merged, _conflicts, report = self.resolve(records)

        return {
            "merged": merged,
            "duplicates_merged": report.merged_by_abn + report.merged_by_name,
        }

    def resolve(
        self,
        records: list[dict[str, Any]],
    ) -> tuple[list[dict[str, Any]], list[ConflictEntry], ResolutionReport]:
        """Run the full resolution pipeline.

        Parameters
        ----------
        records:
            List of raw record dicts.  Each must have at least
            ``"company_name"``.  Optional fields: ``"abn"``,
            ``"contact_name"``, ``"contact_email"``, ``"postcode"``,
            ``"address"``.

        Returns
        -------
        (merged_entities, conflicts, report)
        """
        self._canonical = {}
        self._abn_index = {}
        self._conflicts = []
        self._report = ResolutionReport(total_input_records=len(records))

        # Phase 1: group by ABN.
        ungrouped: list[dict[str, Any]] = []
        for record in records:
            abn = record.get("abn")
            if abn and self._try_abn_match(record, abn):
                continue
            ungrouped.append(record)

        # Phase 2: fuzzy name matching for remaining records.
        for record in ungrouped:
            self._try_name_match(record)

        # Phase 3: deduplicate contacts within each company.
        for norm_name, company in self._canonical.items():
            contacts = company.get("contacts", [])
            company["contacts"] = self._deduplicate_contacts(contacts)

        self._report.unique_companies = len(self._canonical)

        merged = list(self._canonical.values())
        return merged, list(self._conflicts), self._report

    # ------------------------------------------------------------------
    # Internal: ABN matching
    # ------------------------------------------------------------------

    def _try_abn_match(self, record: dict[str, Any], abn: str) -> bool:
        """Try to match by ABN.  Returns True if matched/created."""
        clean_abn = "".join(c for c in abn if c.isdigit())
        if len(clean_abn) != 11:
            return False

        if clean_abn in self._abn_index:
            # Merge into existing canonical record.
            canonical_key = self._abn_index[clean_abn]
            self._merge_into(canonical_key, record)
            self._report.merged_by_abn += 1
            return True

        # Create new canonical entry keyed by normalised name.
        norm = normalize_company_name(record.get("company_name", ""))
        if not norm:
            return False

        self._canonical[norm] = self._make_canonical(record)
        self._abn_index[clean_abn] = norm
        return True

    # ------------------------------------------------------------------
    # Internal: name matching
    # ------------------------------------------------------------------

    def _try_name_match(self, record: dict[str, Any]) -> None:
        """Try to match by company name.  Creates a new entry if no match."""
        company_name = record.get("company_name", "")
        norm = normalize_company_name(company_name)
        if not norm:
            return

        # Exact normalised-name match.
        if norm in self._canonical:
            self._merge_into(norm, record)
            self._report.merged_by_name += 1
            return

        # Fuzzy match against existing canonical names.
        existing_names = list(self._canonical.keys())
        for ex_norm in existing_names:
            score = SequenceMatcher(None, norm, ex_norm).ratio()
            if score >= self.threshold:
                self._merge_into(ex_norm, record)
                self._report.merged_by_name += 1
                logger.debug(
                    "Fuzzy-matched '%s' -> '%s' (score=%.3f)",
                    company_name,
                    self._canonical[ex_norm].get("company_name"),
                    score,
                )
                return

        # No match -- create new canonical.
        self._canonical[norm] = self._make_canonical(record)
        abn = record.get("abn")
        if abn:
            clean = "".join(c for c in abn if c.isdigit())
            if len(clean) == 11:
                self._abn_index[clean] = norm

    # ------------------------------------------------------------------
    # Internal: merge logic
    # ------------------------------------------------------------------

    def _make_canonical(self, record: dict[str, Any]) -> dict[str, Any]:
        """Create a canonical company dict from a raw record."""
        contacts: list[dict[str, Any]] = []
        if record.get("contact_name"):
            contacts.append({
                "name": record["contact_name"],
                "position": record.get("contact_position"),
                "email": record.get("contact_email"),
                "phone": record.get("contact_phone"),
                "source": record.get("source", "UNKNOWN"),
            })

        return {
            "company_name": record.get("company_name", ""),
            "normalized_name": normalize_company_name(record.get("company_name", "")),
            "abn": record.get("abn"),
            "website": record.get("website"),
            "industry": record.get("industry"),
            "address": record.get("address"),
            "suburb": record.get("suburb"),
            "state": record.get("state"),
            "postcode": record.get("postcode"),
            "phone": record.get("phone"),
            "status": record.get("status", "NEW"),
            "source": record.get("source", "UNKNOWN"),
            "contacts": contacts,
            "provenances": [record.get("provenance")] if record.get("provenance") else [],
        }

    def _merge_into(
        self,
        canonical_key: str,
        record: dict[str, Any],
    ) -> None:
        """Merge a record into an existing canonical company."""
        canonical = self._canonical[canonical_key]

        # Fill empty fields; log conflicts for non-empty disagreements.
        merge_fields = [
            "abn", "website", "industry", "address", "suburb",
            "state", "postcode", "phone",
        ]
        for fld in merge_fields:
            existing_val = canonical.get(fld)
            new_val = record.get(fld)
            if not existing_val and new_val:
                canonical[fld] = new_val
            elif existing_val and new_val and str(existing_val) != str(new_val):
                self._conflicts.append(ConflictEntry(
                    entity_type="company",
                    entity_name=canonical.get("company_name", ""),
                    field=fld,
                    value_a=str(existing_val),
                    value_b=str(new_val),
                    resolution="kept_a",
                    source_a=canonical.get("source", ""),
                    source_b=record.get("source", ""),
                ))
                self._report.conflicts += 1

        # Upgrade status if incoming record is more current.
        if record.get("status") == "NEW" and canonical.get("status") == "STALE_LEGACY":
            canonical["status"] = "NEW"

        # Accumulate contacts.
        if record.get("contact_name"):
            canonical.setdefault("contacts", []).append({
                "name": record["contact_name"],
                "position": record.get("contact_position"),
                "email": record.get("contact_email"),
                "phone": record.get("contact_phone"),
                "source": record.get("source", "UNKNOWN"),
            })

        # Accumulate provenance.
        if record.get("provenance"):
            canonical.setdefault("provenances", []).append(record["provenance"])

    # ------------------------------------------------------------------
    # Internal: contact deduplication
    # ------------------------------------------------------------------

    def _deduplicate_contacts(
        self,
        contacts: list[dict[str, Any]],
    ) -> list[dict[str, Any]]:
        """Deduplicate contacts within a single company by name similarity."""
        if not contacts:
            return []

        deduped: list[dict[str, Any]] = []
        seen_norms: dict[str, dict[str, Any]] = {}

        for contact in contacts:
            name = contact.get("name", "")
            norm = normalize_contact_name(name)
            if not norm:
                deduped.append(contact)
                continue

            if norm in seen_norms:
                # Enrich existing contact with missing fields.
                existing = seen_norms[norm]
                for fld in ("position", "email", "phone"):
                    if not existing.get(fld) and contact.get(fld):
                        existing[fld] = contact[fld]
                self._report.contacts_merged += 1
            else:
                # Check for fuzzy duplicates.
                matched = False
                for seen_norm, existing in seen_norms.items():
                    score = SequenceMatcher(None, norm, seen_norm).ratio()
                    if score >= 0.85:
                        for fld in ("position", "email", "phone"):
                            if not existing.get(fld) and contact.get(fld):
                                existing[fld] = contact[fld]
                        self._report.contacts_merged += 1
                        matched = True
                        break

                if not matched:
                    seen_norms[norm] = contact
                    deduped.append(contact)

        return deduped
