"""Friction GenLead Research API -- FastAPI entrypoint."""

import logging
import os
from contextlib import asynccontextmanager

from dotenv import load_dotenv
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

# Load .env before anything reads os.getenv() -- must happen before the
# routers/services below are imported, since some read env vars at
# import time.
load_dotenv()

from .routers import chat, discovery, health, import_router, operations
from .services.sheets_instance import sheets_adapter

logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Connect the Google Sheets adapter once at startup.

    ``GoogleSheetsAdapter.connect()`` degrades to mock mode on any
    failure (missing/empty spreadsheet id, broken credentials, etc.) by
    design -- it never raises. We additionally wrap the call in a
    try/except here as defense in depth: a startup hook must never
    prevent the app from booting, no matter what.
    """
    try:
        await sheets_adapter.connect(
            spreadsheet_id=os.getenv("GOOGLE_SHEETS_SPREADSHEET_ID") or None,
            credentials_path=os.getenv("GOOGLE_SHEETS_CREDENTIALS_PATH") or None,
            oauth_client_secret_path=os.getenv("GOOGLE_OAUTH_CLIENT_SECRET_PATH") or None,
            oauth_token_path=os.getenv("GOOGLE_OAUTH_TOKEN_PATH") or None,
        )
    except Exception:
        logger.exception(
            "GoogleSheetsAdapter.connect() raised unexpectedly at startup; "
            "continuing without it. Sheet writes will fail gracefully to "
            "PENDING wherever they are attempted."
        )

    # Also expose it on app.state for anything that prefers request-scoped
    # access (request.app.state.sheets) over importing the singleton.
    app.state.sheets = sheets_adapter

    yield

    # No teardown needed -- the adapter holds no connections that require
    # explicit closing (the googleapiclient service is stateless HTTP).


app = FastAPI(
    title="Friction GenLead Research API",
    description="Queensland business prospecting research service",
    version="0.1.0",
    lifespan=lifespan,
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
app.include_router(chat.router)
app.include_router(operations.router)
