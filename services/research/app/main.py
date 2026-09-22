"""Friction GenLead Research API -- FastAPI entrypoint."""

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .routers import discovery, health, import_router

app = FastAPI(
    title="Friction GenLead Research API",
    description="Queensland business prospecting research service",
    version="0.1.0",
)

# ---------------------------------------------------------------------------
# CORS -- allow the Next.js frontend on localhost:3000
# ---------------------------------------------------------------------------
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:3000",
        "http://127.0.0.1:3000",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ---------------------------------------------------------------------------
# Routers
# ---------------------------------------------------------------------------
app.include_router(health.router)
app.include_router(discovery.router)
app.include_router(import_router.router)
