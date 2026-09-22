"""Operations router -- Jev pipeline endpoints."""

from pydantic import BaseModel, field_validator
from fastapi import APIRouter, HTTPException

from app.services.jev import Jev

router = APIRouter(prefix="/internal/ops", tags=["operations"])

jev = Jev()


class StartResearchRequest(BaseModel):
    postcode: str
    industry: str | None = None
    roles: list[str] = []

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
    """Start a new Jev research pipeline for a postcode."""
    job = await jev.start_research(
        postcode=request.postcode,
        industry=request.industry,
        target_roles=request.roles,
    )
    return {
        "job_id": job.job_id,
        "status": job.status,
        "message": f"Research started for postcode {request.postcode}",
    }


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
        companies_found=len(job.companies_found),
        contacts_found=len(job.contacts_found),
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
            "companies_found": len(j.companies_found),
            "contacts_found": len(j.contacts_found),
            "created_at": j.created_at.isoformat(),
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
