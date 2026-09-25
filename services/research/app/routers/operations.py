"""Operations router -- Jev pipeline endpoints."""

from pydantic import BaseModel, Field, field_validator
from fastapi import APIRouter, Depends, HTTPException

from app.services.auth import require_auth
from app.services.jev import Jev
from app.services.sheets_instance import sheets_adapter

router = APIRouter(
    prefix="/internal/ops", tags=["operations"], dependencies=[Depends(require_auth)]
)

jev = Jev(sheets=sheets_adapter)


class StartResearchRequest(BaseModel):
    postcode: str
    industry: str | None = None
    roles: list[str] = Field(default_factory=list)

    @field_validator("postcode")
    @classmethod
    def validate_postcode(cls, v: str) -> str:
        v = v.strip()
        if not v.isdigit() or len(v) != 4:
            raise ValueError("Postcode must be 4 digits")
        code = int(v)
        if code < 4000 or code > 4999:
            raise ValueError("Only QLD postcodes (4000-4999) are supported")
        return v


class JobSummary(BaseModel):
    job_id: str
    postcode: str
    industry: str | None
    status: str
    companies_found: int
    contacts_found: int
    steps: list[dict]
    warnings: list[str]


@router.post("/research")
async def start_research(request: StartResearchRequest) -> dict:
    """Refuse to launch until real company and contact sources are wired."""
    raise HTTPException(
        status_code=503,
        detail=(
            "Automated prospect research is not connected to a live ABR/company source "
            "or contact finder yet. No sample prospects were created."
        ),
    )


@router.get("/research/{job_id}")
async def get_research_status(job_id: str) -> JobSummary:
    """Get the status of a Jev research job."""
    job = await jev.get_job(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")

    return JobSummary(
        job_id=job.job_id,
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

    return {
        "job_id": job.job_id,
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
