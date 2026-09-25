"""Operations router -- Jev pipeline endpoints."""

from pydantic import BaseModel, Field, field_validator
from fastapi import APIRouter, Depends, HTTPException

from app.services.auth import require_auth
from app.services.jev import Jev
from app.services.osm_discovery import OpenStreetMapDiscovery
from app.services.overture_discovery import OverturePlacesDiscovery
from app.services.sheets_instance import sheets_adapter

router = APIRouter(
    prefix="/internal/ops", tags=["operations"], dependencies=[Depends(require_auth)]
)

jev = Jev(
    sheets=sheets_adapter,
    places=OverturePlacesDiscovery(geocoder=OpenStreetMapDiscovery()),
)


class StartResearchRequest(BaseModel):
    location: str = Field(..., min_length=2, max_length=160)
    industry: str | None = Field(default=None, max_length=80)
    roles: list[str] = Field(default_factory=list, max_length=20)

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
    contacts_found: int
    steps: list[dict]
    warnings: list[str]


@router.post("/research")
async def start_research(request: StartResearchRequest) -> dict:
    """Start a bounded global Places search, supplementing QLD postcode queries with ABR."""
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
        )
    except Exception as exc:
        raise HTTPException(status_code=503, detail=f"Research could not start: {exc}") from exc
    return {
        "job_id": job.job_id,
        "location": job.location_query or job.postcode,
        "status": job.status,
        "message": (
            "Search started using the latest global Overture Maps Places release and, for QLD postcodes, "
            "ABR name matches. Coverage is non-exhaustive; review company identity, industry, operation, and contacts."
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
        "contacts": job.contacts_found,
        "warnings": job.warnings,
        "errors": job.errors,
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
            "contacts_found": j.contacts_count,
            "created_at": j.created_at.isoformat(),
            "updated_at": j.updated_at.isoformat(),
            "roles": j.target_roles,
            "error_summary": "; ".join(j.errors),
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
