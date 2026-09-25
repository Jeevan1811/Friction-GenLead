"""Pydantic v2 models for all domain entities and API request/response pairs."""

from __future__ import annotations

from datetime import datetime
from typing import Literal
from uuid import UUID, uuid4

from pydantic import BaseModel, Field

from .enums import (
    CompanyStatus,
    ContactStatus,
    EvidenceSource,
    IndustryFit,
    LocationStatus,
    LocationType,
    ReliabilityTier,
    RolePriority,
    SiteEvidence,
    SyncState,
)


# ---------------------------------------------------------------------------
# Base
# ---------------------------------------------------------------------------

class TimestampedModel(BaseModel):
    """Base with auto-generated id and timestamps."""

    id: UUID = Field(default_factory=uuid4)
    created_at: datetime = Field(default_factory=datetime.utcnow)
    updated_at: datetime = Field(default_factory=datetime.utcnow)


# ---------------------------------------------------------------------------
# Domain entities
# ---------------------------------------------------------------------------

class Contact(TimestampedModel):
    company_id: UUID
    location_id: UUID | None = None
    first_name: str
    last_name: str
    role: str
    email: str | None = None
    phone: str | None = None
    linkedin_url: str | None = None
    status: ContactStatus = ContactStatus.NEW
    role_priority: RolePriority = RolePriority.OTHER
    source: EvidenceSource = EvidenceSource.PUBLIC_SEARCH
    reliability: ReliabilityTier = ReliabilityTier.C
    sync_state: SyncState = SyncState.NEVER
    notes: str | None = None  # user-owned


class Location(TimestampedModel):
    company_id: UUID
    name: str
    address: str
    postcode: str
    location_type: LocationType = LocationType.OTHER
    status: LocationStatus = LocationStatus.UNVERIFIED
    site_evidence: SiteEvidence = SiteEvidence.UNCERTAIN
    source: EvidenceSource = EvidenceSource.PUBLIC_SEARCH
    latitude: float | None = None
    longitude: float | None = None
    sync_state: SyncState = SyncState.NEVER
    contacts: list[Contact] = Field(default_factory=list)


class Company(TimestampedModel):
    name: str
    abn: str | None = None
    acn: str | None = None
    website: str | None = None
    phone: str | None = None
    industry: str | None = None
    status: CompanyStatus = CompanyStatus.NEW
    industry_fit: IndustryFit = IndustryFit.UNLIKELY
    reliability: ReliabilityTier = ReliabilityTier.C
    source: EvidenceSource = EvidenceSource.PUBLIC_SEARCH
    sync_state: SyncState = SyncState.NEVER
    locations: list[Location] = Field(default_factory=list)
    contacts: list[Contact] = Field(default_factory=list)
    notes: str | None = None       # user-owned
    priority: str | None = None    # user-owned
    tags: list[str] = Field(default_factory=list)  # user-owned


# ---------------------------------------------------------------------------
# Search (discovery) request / response
# ---------------------------------------------------------------------------

class SearchRequest(BaseModel):
    postcode: str = Field(..., min_length=4, max_length=4, pattern=r"^\d{4}$")
    industry: str | None = None
    roles: list[str] = Field(default_factory=list)


class SearchResponse(BaseModel):
    search_id: UUID = Field(default_factory=uuid4)
    status: str = "completed"
    postcode: str
    companies_found: int
    companies: list[Company]


# ---------------------------------------------------------------------------
# Discovery result (enriched)
# ---------------------------------------------------------------------------

class DiscoveryResult(BaseModel):
    search_id: UUID
    postcode: str
    industry: str | None = None
    companies: list[Company]
    total_locations: int = 0
    total_contacts: int = 0


# ---------------------------------------------------------------------------
# Verify company
# ---------------------------------------------------------------------------

class VerifyCompanyRequest(BaseModel):
    model_config = {"populate_by_name": True}

    company_id: str = Field(alias="companyId")
    abn: str | None = None
    company_name: str | None = Field(default=None, alias="companyName")
    action: Literal["approve", "reject"] | None = None
    reason: str | None = None


class VerifyCompanyResponse(BaseModel):
    company_id: str
    status: CompanyStatus
    abn_valid: bool | None = None
    website_reachable: bool | None = None
    evidence_sources: list[EvidenceSource] = Field(default_factory=list)
    reliability: ReliabilityTier = ReliabilityTier.C
    notes: str | None = None
    # Honest reflection of whether this decision actually persisted to the
    # Google Sheet. Only set meaningfully on action="approve"/"reject" --
    # a plain verification-check call (no action) never attempts a sheet
    # write, so it stays "NEVER". A write attempt sets "SYNCED" only on
    # confirmed success; every failure/mock-mode/misconfiguration path
    # sets "PENDING", never "SYNCED" (see CLAUDE.md write-failure policy).
    sync_status: str = "PENDING"


# ---------------------------------------------------------------------------
# Verify location
# ---------------------------------------------------------------------------

class VerifyLocationRequest(BaseModel):
    model_config = {"populate_by_name": True}

    # String, not UUID -- mirrors VerifyCompanyRequest.company_id. Real
    # frontend location ids (e.g. fixture ids like "loc-001") are not
    # UUIDs, so typing this as UUID would reject every real request.
    location_id: str = Field(alias="locationId")
    company_id: str | None = Field(default=None, alias="companyId")
    site_name: str | None = Field(default=None, alias="siteName")
    location_type: str | None = Field(default=None, alias="locationType")
    address: str | None = None
    suburb: str | None = None
    state: str | None = None
    postcode: str | None = None
    action: Literal["approve", "reject"] | None = None
    reason: str | None = None


class VerifyLocationResponse(BaseModel):
    location_id: str
    company_id: str | None = None
    status: LocationStatus
    site_evidence: SiteEvidence = SiteEvidence.UNCERTAIN
    address_confirmed: bool = False
    evidence_sources: list[EvidenceSource] = Field(default_factory=list)
    notes: str | None = None
    # Honest reflection of whether this decision actually persisted to the
    # Google Sheet. Only set meaningfully on action="approve"/"reject" --
    # a plain verification-check call (no action) never attempts a sheet
    # write, so it stays "NEVER". A write attempt sets "SYNCED" only on
    # confirmed success; every failure/mock-mode/misconfiguration path
    # sets "PENDING", never "SYNCED" (see CLAUDE.md write-failure policy).
    sync_status: str = "PENDING"


# ---------------------------------------------------------------------------
# Verify contact
# ---------------------------------------------------------------------------

class VerifyContactRequest(BaseModel):
    model_config = {"populate_by_name": True}

    contact_id: str = Field(alias="contactId")
    company_id: str | None = Field(default=None, alias="companyId")
    location_id: str | None = Field(default=None, alias="locationId")
    name: str | None = None
    position: str | None = None
    business_email: str | None = Field(default=None, alias="businessEmail")
    mobile: str | None = None
    action: Literal["approve", "reject"] | None = None
    reason: str | None = None


class VerifyContactResponse(BaseModel):
    contact_id: str
    company_id: str | None = None
    status: ContactStatus
    notes: str | None = None
    # Honest reflection of whether this decision actually persisted to the
    # Google Sheet. Only set meaningfully on action="approve"/"reject" --
    # a plain verification-check call (no action) never attempts a sheet
    # write, so it stays "NEVER". A write attempt sets "SYNCED" only on
    # confirmed success; every failure/mock-mode/misconfiguration path
    # sets "PENDING", never "SYNCED" (see CLAUDE.md write-failure policy).
    sync_status: str = "PENDING"


# ---------------------------------------------------------------------------
# Contact research
# ---------------------------------------------------------------------------

class ContactResearchRequest(BaseModel):
    company_id: UUID
    roles: list[str] = Field(default_factory=list)
    website_url: str | None = Field(default=None, max_length=2048)


class ContactResearchResponse(BaseModel):
    company_id: UUID
    contacts_found: int
    contacts: list[Contact]
    warnings: list[str] = Field(default_factory=list)
    records_synced: bool = False


# ---------------------------------------------------------------------------
# Evaluate (industry fit)
# ---------------------------------------------------------------------------

class EvaluateRequest(BaseModel):
    company_id: UUID


class EvaluateResponse(BaseModel):
    company_id: UUID
    industry_fit: IndustryFit
    confidence: float = Field(ge=0.0, le=1.0)
    reasoning: str
    evidence_sources: list[EvidenceSource] = Field(default_factory=list)
