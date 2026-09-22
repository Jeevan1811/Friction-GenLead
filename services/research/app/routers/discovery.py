"""Discovery, verification, contact research, and evaluation endpoints.

All endpoints return realistic QLD mock data while the real integrations
(ABR, web crawling, etc.) are wired up.
"""

import logging
from datetime import datetime, timezone
from uuid import UUID, uuid4

from fastapi import APIRouter

from ..models.enums import (
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
from ..models.schemas import (
    Company,
    Contact,
    ContactResearchRequest,
    ContactResearchResponse,
    EvaluateRequest,
    EvaluateResponse,
    Location,
    SearchRequest,
    SearchResponse,
    VerifyCompanyRequest,
    VerifyCompanyResponse,
    VerifyContactRequest,
    VerifyContactResponse,
    VerifyLocationRequest,
    VerifyLocationResponse,
)
from ..services.sheets_instance import sheets_adapter

router = APIRouter(tags=["discovery"])

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Stable mock IDs so tests can reference them
# ---------------------------------------------------------------------------
_CS_ENERGY_ID = UUID("a1b2c3d4-0001-4000-8000-000000000001")
_STANWELL_ID = UUID("a1b2c3d4-0002-4000-8000-000000000002")
_SUN_METALS_ID = UUID("a1b2c3d4-0003-4000-8000-000000000003")
_INCITEC_ID = UUID("a1b2c3d4-0004-4000-8000-000000000004")

_CS_LOCATION_ID = UUID("b1b2c3d4-0001-4000-8000-000000000001")
_STANWELL_LOCATION_ID = UUID("b1b2c3d4-0002-4000-8000-000000000002")
_SUN_METALS_LOCATION_ID = UUID("b1b2c3d4-0003-4000-8000-000000000003")
_INCITEC_LOCATION_ID = UUID("b1b2c3d4-0004-4000-8000-000000000004")


def _mock_companies(postcode: str) -> list[Company]:
    """Return realistic QLD industrial companies for any postcode."""
    return [
        Company(
            id=_CS_ENERGY_ID,
            name="CS Energy",
            abn="54078848745",
            website="https://www.csenergy.com.au",
            phone="07 3854 7777",
            industry="Electricity Generation",
            status=CompanyStatus.NEW,
            industry_fit=IndustryFit.TARGET,
            reliability=ReliabilityTier.A,
            source=EvidenceSource.ABR,
            locations=[
                Location(
                    id=_CS_LOCATION_ID,
                    company_id=_CS_ENERGY_ID,
                    name="Callide Power Station",
                    address="Callide Power Station Rd, Biloela QLD 4715",
                    postcode=postcode,
                    location_type=LocationType.PLANT,
                    status=LocationStatus.UNVERIFIED,
                    site_evidence=SiteEvidence.LIKELY,
                    source=EvidenceSource.ABR,
                ),
            ],
        ),
        Company(
            id=_STANWELL_ID,
            name="Stanwell Corporation",
            abn="37078848674",
            website="https://www.stanwell.com",
            phone="07 3228 4444",
            industry="Electricity Generation",
            status=CompanyStatus.NEW,
            industry_fit=IndustryFit.TARGET,
            reliability=ReliabilityTier.A,
            source=EvidenceSource.ABR,
            locations=[
                Location(
                    id=_STANWELL_LOCATION_ID,
                    company_id=_STANWELL_ID,
                    name="Stanwell Power Station",
                    address="Stanwell Power Station Rd, Stanwell QLD 4702",
                    postcode=postcode,
                    location_type=LocationType.PLANT,
                    status=LocationStatus.UNVERIFIED,
                    site_evidence=SiteEvidence.LIKELY,
                    source=EvidenceSource.ABR,
                ),
            ],
        ),
        Company(
            id=_SUN_METALS_ID,
            name="Sun Metals Corporation",
            abn="19074758014",
            website="https://www.sunmetals.com.au",
            phone="07 4758 8888",
            industry="Zinc Refining",
            status=CompanyStatus.NEW,
            industry_fit=IndustryFit.TARGET,
            reliability=ReliabilityTier.B,
            source=EvidenceSource.PUBLIC_SEARCH,
            locations=[
                Location(
                    id=_SUN_METALS_LOCATION_ID,
                    company_id=_SUN_METALS_ID,
                    name="Sun Metals Zinc Refinery",
                    address="Stuart Dr, Stuart QLD 4811",
                    postcode=postcode,
                    location_type=LocationType.PLANT,
                    status=LocationStatus.UNVERIFIED,
                    site_evidence=SiteEvidence.CONFIRMED,
                    source=EvidenceSource.OFFICIAL_WEBSITE,
                ),
            ],
        ),
        Company(
            id=_INCITEC_ID,
            name="Incitec Pivot",
            abn="42004080264",
            website="https://www.incitecpivot.com.au",
            phone="03 8695 4400",
            industry="Chemical Manufacturing",
            status=CompanyStatus.NEW,
            industry_fit=IndustryFit.ADJACENT,
            reliability=ReliabilityTier.A,
            source=EvidenceSource.ABR,
            locations=[
                Location(
                    id=_INCITEC_LOCATION_ID,
                    company_id=_INCITEC_ID,
                    name="Phosphate Hill Facility",
                    address="Phosphate Hill QLD 4825",
                    postcode=postcode,
                    location_type=LocationType.MINE,
                    status=LocationStatus.UNVERIFIED,
                    site_evidence=SiteEvidence.LIKELY,
                    source=EvidenceSource.ABR,
                ),
            ],
        ),
    ]


def _mock_contacts(company_id: UUID) -> list[Contact]:
    """Return realistic mock contacts for a given company."""
    return [
        Contact(
            company_id=company_id,
            first_name="Sarah",
            last_name="Mitchell",
            role="Plant Manager",
            email="s.mitchell@example.com.au",
            phone="07 4900 1234",
            status=ContactStatus.NEW,
            role_priority=RolePriority.PRIORITY,
            source=EvidenceSource.OFFICIAL_WEBSITE,
            reliability=ReliabilityTier.B,
        ),
        Contact(
            company_id=company_id,
            first_name="James",
            last_name="Nguyen",
            role="Maintenance Superintendent",
            email="j.nguyen@example.com.au",
            phone="07 4900 1235",
            status=ContactStatus.NEW,
            role_priority=RolePriority.PRIORITY,
            source=EvidenceSource.PUBLIC_SEARCH,
            reliability=ReliabilityTier.C,
        ),
        Contact(
            company_id=company_id,
            first_name="Karen",
            last_name="O'Brien",
            role="Procurement Officer",
            email="k.obrien@example.com.au",
            status=ContactStatus.NEW,
            role_priority=RolePriority.SECONDARY,
            source=EvidenceSource.PUBLIC_SEARCH,
            reliability=ReliabilityTier.C,
        ),
    ]


# ---------------------------------------------------------------------------
# POST /internal/discover
# ---------------------------------------------------------------------------

@router.post("/internal/discover", response_model=SearchResponse)
async def discover(request: SearchRequest) -> SearchResponse:
    """Discover companies in a QLD postcode area.

    Accepts a 4-digit Australian postcode and optional industry filter.
    Returns matching companies with their known locations.
    """
    companies = _mock_companies(request.postcode)

    if request.industry:
        industry_lower = request.industry.lower()
        companies = [
            c for c in companies
            if c.industry and industry_lower in c.industry.lower()
        ]

    return SearchResponse(
        postcode=request.postcode,
        companies_found=len(companies),
        companies=companies,
    )


# ---------------------------------------------------------------------------
# POST /internal/verify/company
# ---------------------------------------------------------------------------

@router.post("/internal/verify/company", response_model=VerifyCompanyResponse)
async def verify_company(request: VerifyCompanyRequest) -> VerifyCompanyResponse:
    """Record a human approve/reject decision, or run verification checks.

    This is the human-in-the-loop endpoint: the frontend calls it with
    action="approve" or action="reject" after a user reviews a company in
    the dashboard. Jev/automation never calls this with an action set --
    doing so would be an auto-approve, which is not allowed. With no
    action, it just runs verification checks and returns them for review.
    """
    if request.action in ("approve", "reject"):
        new_status = (
            CompanyStatus.APPROVED
            if request.action == "approve"
            else CompanyStatus.REJECTED
        )
        sync_status = await _persist_company_decision(request, new_status)

        if request.action == "approve":
            return VerifyCompanyResponse(
                company_id=request.company_id,
                status=new_status,
                abn_valid=True,
                evidence_sources=[EvidenceSource.ABR],
                reliability=ReliabilityTier.B,
                notes="Approved by user.",
                sync_status=sync_status,
            )

        return VerifyCompanyResponse(
            company_id=request.company_id,
            status=new_status,
            evidence_sources=[],
            reliability=ReliabilityTier.C,
            notes=request.reason or "Rejected by user.",
            sync_status=sync_status,
        )

    return VerifyCompanyResponse(
        company_id=request.company_id,
        status=CompanyStatus.REVIEW,
        abn_valid=True,
        website_reachable=True,
        evidence_sources=[EvidenceSource.ABR, EvidenceSource.OFFICIAL_WEBSITE],
        reliability=ReliabilityTier.B,
        notes="ABN matches ASIC records. Website confirmed active.",
        # No sheet write is attempted for a plain verification check (no
        # action) -- nothing to be "pending" or "synced" about.
        sync_status=SyncState.NEVER.value,
    )


async def _persist_company_decision(
    request: VerifyCompanyRequest,
    new_status: CompanyStatus,
) -> str:
    """Persist a human approve/reject decision to the Companies tab.

    This is the ONLY place discovery.py writes to the sheet -- it fires
    solely from an explicit human action (action="approve"/"reject" on
    this endpoint), never from /internal/discover or the Jev pipeline.

    Never raises: a sheet-write failure (mock mode, empty/garbage
    spreadsheet id, transient API error, or anything else) must degrade
    to an honest "PENDING" sync_status rather than crash the request or
    falsely report "SYNCED" -- per the project's write-failure policy.

    Note on mock mode: ``upsert_company`` itself returns SyncState.SYNCED
    for a successful mock-mode write (that's its documented, correct
    behavior -- the in-memory store did receive the write). But nothing
    was actually persisted to a real, durable Google Sheet in that case,
    so reporting "SYNCED" to the user would violate the "never fake
    Synced" rule from a product perspective. We therefore also check
    ``get_sync_status()["mode"]`` and only ever report "SYNCED" when the
    adapter is connected to a real ("live") spreadsheet.
    """
    try:
        now = datetime.now(timezone.utc).isoformat()
        row = {
            "company_id": request.company_id,
            "abn": request.abn or "",
            "company_name": request.company_name or "",
            "status": new_status.value,
            "last_modified": now,
            "last_verified": now,
            "notes": request.reason or "",
        }
        result = await sheets_adapter.upsert_company(row)
        status_info = await sheets_adapter.get_sync_status()
        if status_info.get("mode") != "live":
            # Not actually connected to a real spreadsheet (mock mode).
            # The mock write "succeeded" in-memory, but nothing durable
            # happened -- honestly report PENDING, never SYNCED.
            return SyncState.PENDING.value
        return result.value
    except Exception:
        logger.exception(
            "Sheet write failed for company %s decision %s; "
            "reporting sync_status=PENDING.",
            request.company_id,
            new_status,
        )
        return SyncState.PENDING.value


# ---------------------------------------------------------------------------
# POST /internal/verify/location
# ---------------------------------------------------------------------------

@router.post("/internal/verify/location", response_model=VerifyLocationResponse)
async def verify_location(request: VerifyLocationRequest) -> VerifyLocationResponse:
    """Verify a location, or record a human approve/reject decision.

    ABN registration address != operating site. With no action, this
    confirms physical presence using multiple evidence sources (mock).

    This is also the human-in-the-loop endpoint for locations, mirroring
    ``verify_company``: the frontend calls it with action="approve" or
    action="reject" after a user reviews a location card in the
    dashboard. Jev/automation never calls this with an action set --
    doing so would be an auto-approve, which is not allowed.
    """
    if request.action in ("approve", "reject"):
        new_status = (
            LocationStatus.VERIFIED
            if request.action == "approve"
            else LocationStatus.DISPUTED
        )
        sync_status = await _persist_location_decision(request, new_status)

        if request.action == "approve":
            return VerifyLocationResponse(
                location_id=request.location_id,
                company_id=request.company_id,
                status=new_status,
                site_evidence=SiteEvidence.CONFIRMED,
                address_confirmed=True,
                evidence_sources=[EvidenceSource.USER],
                notes="Approved by user.",
                sync_status=sync_status,
            )

        return VerifyLocationResponse(
            location_id=request.location_id,
            company_id=request.company_id,
            status=new_status,
            site_evidence=SiteEvidence.DISPROVEN,
            address_confirmed=False,
            evidence_sources=[EvidenceSource.USER],
            notes=request.reason or "Rejected by user.",
            sync_status=sync_status,
        )

    return VerifyLocationResponse(
        location_id=request.location_id,
        company_id=request.company_id,
        status=LocationStatus.VERIFIED,
        site_evidence=SiteEvidence.CONFIRMED,
        address_confirmed=True,
        evidence_sources=[
            EvidenceSource.QLD_PLS,
            EvidenceSource.OFFICIAL_WEBSITE,
        ],
        notes="Site confirmed via QLD Planning & Land Services and company website.",
        # No sheet write is attempted for a plain verification check (no
        # action) -- nothing to be "pending" or "synced" about.
        sync_status=SyncState.NEVER.value,
    )


async def _persist_location_decision(
    request: VerifyLocationRequest,
    new_status: LocationStatus,
) -> str:
    """Persist a human approve/reject decision to the Locations tab.

    This is the ONLY place discovery.py writes a location decision to the
    sheet -- it fires solely from an explicit human action (action=
    "approve"/"reject" on this endpoint), never from /internal/discover,
    /internal/verify/company (auto), or the Jev pipeline.

    Never raises: a sheet-write failure (mock mode, empty/garbage
    spreadsheet id, transient API error, or anything else) must degrade
    to an honest "PENDING" sync_status rather than crash the request or
    falsely report "SYNCED" -- per the project's write-failure policy.

    Note on mock mode: ``upsert_location`` itself returns SyncState.SYNCED
    for a successful mock-mode write (that's its documented, correct
    behavior -- the in-memory store did receive the write). But nothing
    was actually persisted to a real, durable Google Sheet in that case,
    so reporting "SYNCED" to the user would violate the "never fake
    Synced" rule from a product perspective. We therefore also check
    ``get_sync_status()["mode"]`` and only ever report "SYNCED" when the
    adapter is connected to a real ("live") spreadsheet. This mirrors
    ``_persist_company_decision`` exactly -- see its docstring.
    """
    try:
        now = datetime.now(timezone.utc).isoformat()
        row = {
            "location_id": request.location_id,
            "company_id": request.company_id or "",
            "site_name": request.site_name or "",
            "location_type": request.location_type or "",
            "address": request.address or "",
            "suburb": request.suburb or "",
            "state": request.state or "",
            "postcode": request.postcode or "",
            "verification_status": new_status.value,
            "last_modified": now,
            "last_verified": now,
        }
        result = await sheets_adapter.upsert_location(row)
        status_info = await sheets_adapter.get_sync_status()
        if status_info.get("mode") != "live":
            # Not actually connected to a real spreadsheet (mock mode).
            # The mock write "succeeded" in-memory, but nothing durable
            # happened -- honestly report PENDING, never SYNCED.
            return SyncState.PENDING.value
        return result.value
    except Exception:
        logger.exception(
            "Sheet write failed for location %s decision %s; "
            "reporting sync_status=PENDING.",
            request.location_id,
            new_status,
        )
        return SyncState.PENDING.value


# ---------------------------------------------------------------------------
# POST /internal/verify/contact
# ---------------------------------------------------------------------------

@router.post("/internal/verify/contact", response_model=VerifyContactResponse)
async def verify_contact(request: VerifyContactRequest) -> VerifyContactResponse:
    """Record a human approve/reject decision on a contact.

    This is the human-in-the-loop endpoint for contacts, mirroring
    ``verify_company``/``verify_location``: the frontend calls it with
    action="approve" or action="reject" after a user reviews a contact
    card in the dashboard. Jev/automation never calls this with an action
    set -- doing so would be an auto-approve, which is not allowed. With
    no action, it just runs a verification check and returns it.
    """
    if request.action in ("approve", "reject"):
        new_status = (
            ContactStatus.APPROVED
            if request.action == "approve"
            else ContactStatus.REJECTED
        )
        sync_status = await _persist_contact_decision(request, new_status)

        return VerifyContactResponse(
            contact_id=request.contact_id,
            company_id=request.company_id,
            status=new_status,
            notes=request.reason
            or (
                "Approved by user."
                if request.action == "approve"
                else "Rejected by user."
            ),
            sync_status=sync_status,
        )

    return VerifyContactResponse(
        contact_id=request.contact_id,
        company_id=request.company_id,
        status=ContactStatus.VERIFIED,
        notes="Contact details verified.",
        # No sheet write is attempted for a plain verification check (no
        # action) -- nothing to be "pending" or "synced" about.
        sync_status=SyncState.NEVER.value,
    )


async def _persist_contact_decision(
    request: VerifyContactRequest,
    new_status: ContactStatus,
) -> str:
    """Persist a human approve/reject decision to the Contacts tab.

    This is the ONLY place discovery.py writes a contact decision to the
    sheet -- it fires solely from an explicit human action (action=
    "approve"/"reject" on this endpoint), never from
    /internal/research/contacts or the Jev pipeline.

    Never raises: a sheet-write failure (mock mode, empty/garbage
    spreadsheet id, transient API error, or anything else) must degrade
    to an honest "PENDING" sync_status rather than crash the request or
    falsely report "SYNCED" -- per the project's write-failure policy.

    Note on mock mode: ``upsert_contact`` itself returns SyncState.SYNCED
    for a successful mock-mode write (that's its documented, correct
    behavior -- the in-memory store did receive the write). But nothing
    was actually persisted to a real, durable Google Sheet in that case,
    so reporting "SYNCED" to the user would violate the "never fake
    Synced" rule from a product perspective. We therefore also check
    ``get_sync_status()["mode"]`` and only ever report "SYNCED" when the
    adapter is connected to a real ("live") spreadsheet. This mirrors
    ``_persist_company_decision`` exactly -- see its docstring.
    """
    try:
        now = datetime.now(timezone.utc).isoformat()
        row = {
            "contact_id": request.contact_id,
            "company_id": request.company_id or "",
            "location_id": request.location_id or "",
            "name": request.name or "",
            "position": request.position or "",
            "business_email": request.business_email or "",
            "mobile": request.mobile or "",
            "contact_status": new_status.value,
            "last_modified": now,
            "last_verified": now,
        }
        result = await sheets_adapter.upsert_contact(row)
        status_info = await sheets_adapter.get_sync_status()
        if status_info.get("mode") != "live":
            # Not actually connected to a real spreadsheet (mock mode).
            # The mock write "succeeded" in-memory, but nothing durable
            # happened -- honestly report PENDING, never SYNCED.
            return SyncState.PENDING.value
        return result.value
    except Exception:
        logger.exception(
            "Sheet write failed for contact %s decision %s; "
            "reporting sync_status=PENDING.",
            request.contact_id,
            new_status,
        )
        return SyncState.PENDING.value


# ---------------------------------------------------------------------------
# POST /internal/research/contacts
# ---------------------------------------------------------------------------

@router.post("/internal/research/contacts", response_model=ContactResearchResponse)
async def research_contacts(
    request: ContactResearchRequest,
) -> ContactResearchResponse:
    """Research contacts for a company at its known locations.

    No mass LinkedIn scraping -- uses public directory, company website,
    and industry publication sources only.
    """
    contacts = _mock_contacts(request.company_id)

    if request.roles:
        roles_lower = [r.lower() for r in request.roles]
        contacts = [
            c for c in contacts
            if any(rl in c.role.lower() for rl in roles_lower)
        ]

    return ContactResearchResponse(
        company_id=request.company_id,
        contacts_found=len(contacts),
        contacts=contacts,
    )


# ---------------------------------------------------------------------------
# POST /internal/evaluate
# ---------------------------------------------------------------------------

@router.post("/internal/evaluate", response_model=EvaluateResponse)
async def evaluate(request: EvaluateRequest) -> EvaluateResponse:
    """Evaluate industry fit for a company.

    Scores the company on how well it matches the target prospect profile
    (heavy industry, mining, power generation, manufacturing in QLD).
    """
    return EvaluateResponse(
        company_id=request.company_id,
        industry_fit=IndustryFit.TARGET,
        confidence=0.85,
        reasoning=(
            "Company operates power generation facilities in Queensland. "
            "Primary industry (Electricity Generation) is a target vertical. "
            "Multiple confirmed operating sites with maintenance-intensive "
            "plant equipment."
        ),
        evidence_sources=[
            EvidenceSource.ABR,
            EvidenceSource.OFFICIAL_WEBSITE,
            EvidenceSource.QLD_PLS,
        ],
    )
