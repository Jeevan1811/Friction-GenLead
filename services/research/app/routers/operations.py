"""Operations router -- Jev pipeline endpoints."""

from pydantic import BaseModel, Field, field_validator
from fastapi import APIRouter, Depends, HTTPException

from app.services.auth import require_auth
from app.services.firecrawl_search import FirecrawlSearchDiscovery
from app.services.jev import Jev
from app.services.osm_discovery import OpenStreetMapDiscovery
from app.services.overture_discovery import OverturePlacesDiscovery
from app.services.provider_health import describe_provider_exception, provider_health
from app.services.sheets_instance import sheets_adapter

router = APIRouter(
    prefix="/internal/ops", tags=["operations"], dependencies=[Depends(require_auth)]
)

geocoder = OpenStreetMapDiscovery()
jev = Jev(
    sheets=sheets_adapter,
    places=OverturePlacesDiscovery(geocoder=geocoder),
    web_search=FirecrawlSearchDiscovery(geocoder=geocoder),
)


class StartResearchRequest(BaseModel):
    location: str = Field(..., min_length=2, max_length=160)
    industry: str | None = Field(default=None, max_length=80)
    roles: list[str] = Field(default_factory=list, max_length=20)
    max_companies: int = Field(default=30, ge=10, le=100)

    @field_validator("location")
    @classmethod
    def validate_location(cls, value: str) -> str:
        value = " ".join(value.split())
        if len(value) < 2:
            raise ValueError("Enter a city, region, country, or postcode.")
        return value


class JobSummary(BaseModel):
    job_id: str
    location: str
    postcode: str = ""
    industry: str | None
    status: str
    companies_found: int
    known_companies_found: int
    known_matches_available: bool
    contacts_found: int
    steps: list[dict]
    warnings: list[str]
    errors: list[str]


def _public_job_errors(errors: list[str]) -> list[str]:
    """Keep useful run guidance while withholding raw provider/exception text."""
    public: list[str] = []
    for error in errors:
        normalized = str(error).strip()
        lowered = normalized.casefold()
        if "server restarted while this search was running" in lowered:
            public.append(normalized)
        elif "could not start because its initial status was not saved" in lowered:
            public.append(
                "Search could not start because its status was not saved to Google Sheets. "
                "No research was run; check Sheet sync and retry."
            )
        elif lowered.startswith("pipeline error:"):
            issue = describe_provider_exception("jev", RuntimeError(normalized.partition(":")[2].strip()))
            public.append(f"{issue['message']} {issue['next_step']}")
        else:
            public.append(normalized)
    return public


@router.get("/provider-status")
async def get_provider_status() -> dict:
    """Return safe model/provider status without exposing configured credentials."""
    from app.routers.chat import llm

    if not llm.api_key:
        provider_health.record_not_configured("chatbot")

    chatbot = provider_health.get("chatbot")
    jev_status = provider_health.get("jev")
    return {
        "services": [
            {
                "id": "chatbot",
                "name": "AI assistant",
                "provider": "OpenRouter",
                "model": str(llm.model)[:120],
                "credential_status": "configured" if llm.api_key else "not_configured",
                **chatbot,
            },
            {
                "id": "jev",
                "name": "Jev prospect research",
                "provider": "Public research sources",
                "model": "Not AI-powered",
                "sources": [
                    "Overture Maps",
                    "OpenStreetMap",
                    "Firecrawl web search",
                    "ABR for eligible Queensland postcode searches",
                ],
                "credential_status": "configured" if getattr(jev.web_search, "api_key", "") else "not_required",
                "credential_note": "Firecrawl website search uses configured access when available, otherwise limited keyless access. Mapped places need no key. Access mode is not a health check.",
                **jev_status,
            },
        ]
    }


@router.post("/research")
async def start_research(request: StartResearchRequest) -> dict:
    """Start a bounded global Places and public-web search, supplementing QLD postcodes with ABR."""
    if not jev.sheets or not jev.sheets.is_live:
        raise HTTPException(
            status_code=503,
            detail="Live Google Sheets is unavailable; research was not started or saved.",
        )
    try:
        job = await jev.start_research(
            location=request.location,
            industry=request.industry,
            target_roles=request.roles,
            max_companies=request.max_companies,
        )
    except Exception as exc:
        issue = describe_provider_exception("jev", exc)
        provider_health.record_issue("jev", issue)
        detail = f"{issue['message']} {issue['next_step']}"
        raise HTTPException(status_code=503, detail=detail) from exc
    return {
        "job_id": job.job_id,
        "location": job.location_query or job.postcode,
        "status": job.status,
        "message": (
            "Search started using Overture Places and public web search, with ABR name matches for QLD postcodes. "
            "Coverage is non-exhaustive; review company identity, industry, operation, website, and contacts."
        ),
    }


@router.get("/research/{job_id}")
async def get_research_status(job_id: str) -> JobSummary:
    """Get the status of a Jev research job."""
    job = await jev.get_job(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")

    return JobSummary(
        job_id=job.job_id,
        location=job.location_query or job.postcode,
        postcode=job.postcode,
        industry=job.industry,
        status=job.status,
        companies_found=job.companies_count,
        known_companies_found=job.known_companies_count,
        known_matches_available=job.known_matches_available,
        contacts_found=job.contacts_count,
        steps=[
            {
                "name": s.name,
                "status": s.status,
                "result": s.result,
                "error": s.error,
            }
            for s in job.steps
        ],
        warnings=job.warnings,
        errors=_public_job_errors(job.errors),
    )


@router.get("/research/{job_id}/results")
async def get_research_results(job_id: str) -> dict:
    """Get the full results of a completed research job."""
    job = await jev.get_job(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    if not job.details_available:
        raise HTTPException(
            status_code=410,
            detail="This saved history entry contains a summary only; detailed prospect results were not stored.",
        )

    if job.status == "running":
        raise HTTPException(status_code=409, detail="Research is still running.")

    try:
        job = await jev.get_job_results(job)
    except Exception as exc:
        raise HTTPException(
            status_code=503,
            detail="Saved research results could not be read from the canonical Google Sheet.",
        ) from exc

    return {
        "job_id": job.job_id,
        "location": job.location_query or job.postcode,
        "status": job.status,
        "companies": job.companies_found,
        "known_companies": job.known_companies_found,
        "known_matches_available": job.known_matches_available,
        "contacts": job.contacts_found,
        "warnings": job.warnings,
        "errors": _public_job_errors(job.errors),
    }


@router.get("/jobs")
async def list_jobs() -> list[dict]:
    """List all research jobs."""
    jobs = await jev.list_jobs()
    return [
        {
            "job_id": j.job_id,
            "location": j.location_query or j.postcode,
            "postcode": j.postcode,
            "industry": j.industry,
            "status": j.status,
            "companies_found": j.companies_count,
            "known_companies_found": j.known_companies_count,
            "known_matches_available": j.known_matches_available,
            "contacts_found": j.contacts_count,
            "created_at": j.created_at.isoformat(),
            "updated_at": j.updated_at.isoformat(),
            "roles": j.target_roles,
            "error_summary": "; ".join(_public_job_errors(j.errors)),
        }
        for j in jobs
    ]


@router.post("/research/{job_id}/cancel")
async def cancel_research(job_id: str) -> dict:
    """Cancel a running research job."""
    success = await jev.cancel_job(job_id)
    if not success:
        raise HTTPException(status_code=400, detail="Job not found or not running")
    return {"message": "Job cancelled", "job_id": job_id}
