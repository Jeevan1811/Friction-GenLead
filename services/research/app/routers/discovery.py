"""Discovery and decision endpoints.

Human approve/reject actions remain available; research and verification
routes fail closed until live data providers replace the former demo data.
"""

import logging
from datetime import datetime, timezone
from urllib.parse import urlparse

from fastapi import APIRouter, Depends, HTTPException

from ..models.enums import (
    CompanyStatus,
    ContactStatus,
    EvidenceSource,
    LocationStatus,
    ReliabilityTier,
    RolePriority,
    SiteEvidence,
    SyncState,
)
from ..models.schemas import (
    Contact,
    ContactResearchRequest,
    ContactResearchResponse,
    EvaluateRequest,
    EvaluateResponse,
    SearchRequest,
    SearchResponse,
    VerifyCompanyRequest,
    VerifyCompanyResponse,
    VerifyContactRequest,
    VerifyContactResponse,
    VerifyLocationRequest,
    VerifyLocationResponse,
)
from ..services.auth import require_auth
from ..services.abr import ABRAdapter, validate_abn
from ..services.jev import Jev, PipelineStep, ResearchJob
from ..services.resolver import normalize_company_name
from ..services.sheets_instance import sheets_adapter

router = APIRouter(tags=["discovery"], dependencies=[Depends(require_auth)])

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# POST /internal/discover
# ---------------------------------------------------------------------------

@router.post("/internal/discover", response_model=SearchResponse)
async def discover(request: SearchRequest) -> SearchResponse:
    """Discover companies in a QLD postcode area.

    Accepts a 4-digit Australian postcode and optional industry filter.
    Returns matching companies with their known locations.
    """
    raise HTTPException(
        status_code=503,
        detail="Live postcode company search is not configured. No sample records were returned as prospects.",
    )


# ---------------------------------------------------------------------------
# POST /internal/verify/company
# ---------------------------------------------------------------------------

@router.post("/internal/verify/company", response_model=VerifyCompanyResponse)
async def verify_company(request: VerifyCompanyRequest) -> VerifyCompanyResponse:
    """Record a human approve/reject decision, or run verification checks.

    This is the human-in-the-loop endpoint: the frontend calls it with
    action="approve" or action="reject" after a user reviews a company in
    the dashboard. Jev/automation never calls this with an action set.
    External checks are currently unavailable and return 503.
    """
    if request.action is None:
        abn = "".join(char for char in (request.abn or "") if char.isdigit())
        if not validate_abn(abn):
            raise HTTPException(status_code=422, detail="A checksum-valid ABN is required for public ABR verification.")
        try:
            entity = await ABRAdapter().lookup_abn(abn)
        except Exception as exc:
            raise HTTPException(status_code=502, detail=f"Public ABR verification failed: {exc}") from exc
        if entity is None:
            return VerifyCompanyResponse(
                company_id=request.company_id,
                status=CompanyStatus.REVIEW,
                abn_valid=False,
                evidence_sources=[EvidenceSource.ABR],
                reliability=ReliabilityTier.C,
                notes="No matching entity was returned from the public ABR record lookup; manual review is required.",
            )
        requested_name = normalize_company_name(request.company_name or "")
        public_names = {
            normalize_company_name(name)
            for name in [entity.name, *entity.business_names]
            if name
        }
        name_matches = not requested_name or requested_name in public_names
        status_note = f"ABR reports {entity.status} status for {entity.name}."
        if not name_matches:
            status_note += " The supplied company name does not match the ABR record."
        return VerifyCompanyResponse(
            company_id=request.company_id,
            status=CompanyStatus.REVIEW,
            abn_valid=name_matches,
            evidence_sources=[EvidenceSource.ABR],
            reliability=ReliabilityTier.B if name_matches else ReliabilityTier.C,
            notes=(
                f"{status_note} "
                "This does not verify industry, website, or an operating site."
            ),
        )

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
                evidence_sources=[EvidenceSource.USER],
                reliability=ReliabilityTier.C,
                notes="Marked approved by the user; this is not an external ABR verification.",
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
            "notes": request.reason or "",
        }
        result = await sheets_adapter.upsert_company(row)
        if request.action == "reject":
            # Log to the Rejected tab too, so it appears on the Rejected
            # page (a status change alone never shows up there).
            rejection = await sheets_adapter.add_rejection(
                entity_type="company",
                entity_id=request.company_id,
                entity_name=request.company_name or "",
                reason=request.reason or "Rejected by user.",
                original_data=row,
            )
            if rejection != SyncState.SYNCED:
                result = rejection
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

    ABN registration address != operating site. External site checks are
    currently unavailable and return 503.

    This is also the human-in-the-loop endpoint for locations, mirroring
    ``verify_company``: the frontend calls it with action="approve" or
    action="reject" after a user reviews a location card in the
    dashboard. Jev/automation never calls this with an action set --
    doing so would be an auto-approve, which is not allowed.
    """
    if request.action is None:
        raise HTTPException(
            status_code=503,
            detail="External operating-site verification is not connected yet; no verification claim was made.",
        )

    if request.action in ("approve", "reject"):
        new_status = (
            LocationStatus.APPROVED
            if request.action == "approve"
            else LocationStatus.DISPUTED
        )
        sync_status = await _persist_location_decision(request, new_status)

        if request.action == "approve":
            return VerifyLocationResponse(
                location_id=request.location_id,
                company_id=request.company_id,
                status=new_status,
                site_evidence=SiteEvidence.UNCERTAIN,
                address_confirmed=False,
                evidence_sources=[EvidenceSource.USER],
                notes="Approved by the user; no external site-verification source ran.",
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
        }
        result = await sheets_adapter.upsert_location(row)
        if request.action == "reject":
            # Log to the Rejected tab too, so it appears on the Rejected
            # page (a status change alone never shows up there).
            rejection = await sheets_adapter.add_rejection(
                entity_type="location",
                entity_id=request.location_id,
                entity_name=request.site_name or "",
                reason=request.reason or "Rejected by user.",
                original_data=row,
            )
            if rejection != SyncState.SYNCED:
                result = rejection
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
    set -- doing so would be an auto-approve, which is not allowed.
    External contact checks are currently unavailable and return 503.
    """
    if request.action is None:
        raise HTTPException(
            status_code=503,
            detail="External contact verification is not connected yet; no verification claim was made.",
        )

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
        }
        result = await sheets_adapter.upsert_contact(row)
        if request.action == "reject":
            # Log to the Rejected tab too, so it appears on the Rejected
            # page (a status change alone never shows up there).
            rejection = await sheets_adapter.add_rejection(
                entity_type="contact",
                entity_id=request.contact_id,
                entity_name=request.name or "",
                reason=request.reason or "Rejected by user.",
                original_data=row,
            )
            if rejection != SyncState.SYNCED:
                result = rejection
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
    """Crawl a known or operator-supplied public company website."""
    if not sheets_adapter.is_live:
        raise HTTPException(status_code=503, detail="Live Google Sheets is unavailable; contact research was not started.")
    try:
        companies = await sheets_adapter.read_companies()
    except Exception as exc:
        raise HTTPException(status_code=503, detail="Companies could not be read from the live Google Sheet.") from exc
    read_error = getattr(sheets_adapter, "tab_read_error", None)
    if callable(read_error) and read_error("companies"):
        raise HTTPException(status_code=503, detail="Companies could not be read from the live Google Sheet.")
    company_id = str(request.company_id)
    company = next((row for row in companies if str(row.get("company_id", "")) == company_id), None)
    if not company:
        raise HTTPException(status_code=404, detail="Company was not found in the live Companies tab.")

    research_service = Jev(sheets=sheets_adapter)
    supplied_website = (request.website_url or "").strip()
    if supplied_website:
        parsed = urlparse(supplied_website)
        if (
            parsed.scheme.casefold() not in {"http", "https"}
            or not parsed.hostname
            or parsed.username is not None
            or parsed.password is not None
        ):
            raise HTTPException(
                status_code=422,
                detail="Enter a public http(s) company website URL without embedded credentials.",
            )

        current_website = str(company.get("website") or "").strip()

        def site_origin(value: str) -> tuple[str, str, int | None] | None:
            current = urlparse(value)
            if current.scheme.casefold() not in {"http", "https"} or not current.hostname:
                return None
            default_port = 443 if current.scheme.casefold() == "https" else 80
            try:
                port = current.port or default_port
            except ValueError:
                return None
            return current.scheme.casefold(), current.hostname.casefold().rstrip("."), port

        if current_website and site_origin(current_website) != site_origin(supplied_website):
            raise HTTPException(
                status_code=409,
                detail="This company already has a different website saved. Review that record before replacing it.",
            )

        try:
            allowed = await research_service.crawler.can_fetch(supplied_website)
        except Exception as exc:
            logger.info("Public website URL could not be safely checked for %s", company_id)
            raise HTTPException(
                status_code=422,
                detail="That website could not be safely checked; no URL was saved and no crawl was run.",
            ) from exc
        if not allowed:
            raise HTTPException(
                status_code=422,
                detail="The website's robots.txt disallows this crawl; no URL was saved.",
            )

        if not current_website:
            company["website"] = supplied_website
            supplied_at = datetime.now(timezone.utc).isoformat()
            source_note = (
                f"Website URL supplied by the signed-in operator at {supplied_at}; "
                "not independently verified."
            )
            company["source_verification"] = "; ".join(
                item for item in [str(company.get("source_verification") or "").strip(), source_note] if item
            )
            quality_flags = str(company.get("source_quality_flags") or "").strip()
            flag = "OPERATOR_SUPPLIED_WEBSITE; WEBSITE_UNVERIFIED"
            company["source_quality_flags"] = "; ".join(
                item for item in [quality_flags, flag] if item
            )
            company["last_modified"] = supplied_at
            sync = await sheets_adapter.upsert_company(company)
            if sync != SyncState.SYNCED:
                raise HTTPException(
                    status_code=503,
                    detail="The company website could not be confirmed as saved to Google Sheets; the crawl was not started.",
                )

    job = ResearchJob(
        job_id="contact-research-" + company_id,
        postcode="",
        industry=None,
        target_roles=request.roles,
        companies_found=[company],
        result_company_ids=[company_id],
        steps=[
            PipelineStep(name="discover"),
            PipelineStep(name="verify"),
            PipelineStep(name="research_contacts"),
            PipelineStep(name="evaluate"),
        ],
    )
    try:
        await research_service._step_research_contacts(job)
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Company-site contact research failed: {exc}") from exc

    contacts: list[Contact] = []
    for result in job.contacts_found:
        name_parts = str(result.get("name", "")).split()
        contacts.append(Contact(
            id=result["contact_id"],
            company_id=request.company_id,
            first_name=name_parts[0] if name_parts else "",
            last_name=" ".join(name_parts[1:]),
            role=str(result.get("role", "")),
            email=result.get("email") or None,
            phone=result.get("phone") or None,
            status=ContactStatus.NEW,
            role_priority=RolePriority.OTHER,
            source=EvidenceSource.OFFICIAL_WEBSITE,
            reliability=ReliabilityTier.C,
        ))
    return ContactResearchResponse(
        company_id=request.company_id,
        contacts_found=len(contacts),
        contacts=contacts,
        warnings=job.warnings,
        records_synced=job.result_rows_synced,
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
    raise HTTPException(
        status_code=503,
        detail="Company-fit scoring is unavailable until it can use verified company-source data.",
    )
