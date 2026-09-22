"""Discovery, verification, contact research, and evaluation endpoints.

All endpoints return realistic QLD mock data while the real integrations
(ABR, web crawling, etc.) are wired up.
"""

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
    VerifyLocationRequest,
    VerifyLocationResponse,
)

router = APIRouter(tags=["discovery"])


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
    """Run verification checks against a company (ABN, website, evidence).

    Returns verification result. Does NOT auto-approve -- human review
    is always required.
    """
    return VerifyCompanyResponse(
        company_id=request.company_id,
        status=CompanyStatus.REVIEW,
        abn_valid=True,
        website_reachable=True,
        evidence_sources=[EvidenceSource.ABR, EvidenceSource.OFFICIAL_WEBSITE],
        reliability=ReliabilityTier.B,
        notes="ABN matches ASIC records. Website confirmed active.",
    )


# ---------------------------------------------------------------------------
# POST /internal/verify/location
# ---------------------------------------------------------------------------

@router.post("/internal/verify/location", response_model=VerifyLocationResponse)
async def verify_location(request: VerifyLocationRequest) -> VerifyLocationResponse:
    """Verify that a location is a genuine operating site.

    ABN registration address != operating site. This endpoint confirms
    the physical presence using multiple evidence sources.
    """
    return VerifyLocationResponse(
        location_id=request.location_id,
        company_id=_CS_ENERGY_ID,
        status=LocationStatus.VERIFIED,
        site_evidence=SiteEvidence.CONFIRMED,
        address_confirmed=True,
        evidence_sources=[
            EvidenceSource.QLD_PLS,
            EvidenceSource.OFFICIAL_WEBSITE,
        ],
        notes="Site confirmed via QLD Planning & Land Services and company website.",
    )


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
