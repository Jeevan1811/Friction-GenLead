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


# ---------------------------------------------------------------------------
# Verify location
# ---------------------------------------------------------------------------

class VerifyLocationRequest(BaseModel):
    location_id: UUID


class VerifyLocationResponse(BaseModel):
    location_id: UUID
    company_id: UUID
    status: LocationStatus
    site_evidence: SiteEvidence
    address_confirmed: bool = False
    evidence_sources: list[EvidenceSource] = Field(default_factory=list)
    notes: str | None = None


# ---------------------------------------------------------------------------
# Contact research
# ---------------------------------------------------------------------------

class ContactResearchRequest(BaseModel):
    company_id: UUID
    roles: list[str] = Field(default_factory=list)


class ContactResearchResponse(BaseModel):
    company_id: UUID
    contacts_found: int
    contacts: list[Contact]


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
