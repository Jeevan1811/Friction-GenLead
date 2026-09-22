"""Health-check endpoint with uptime tracking."""

import time

from fastapi import APIRouter
from pydantic import BaseModel

router = APIRouter(tags=["health"])

_START_TIME = time.monotonic()


class HealthResponse(BaseModel):
    status: str = "ok"
    service: str = "friction-genlead-research"
    version: str = "0.1.0"
    uptime_seconds: float


@router.get("/internal/health", response_model=HealthResponse)
async def health_check() -> HealthResponse:
    return HealthResponse(
        uptime_seconds=round(time.monotonic() - _START_TIME, 2),
    )
