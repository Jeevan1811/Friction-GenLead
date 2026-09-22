"""Friction GenLead Research API -- FastAPI entrypoint."""

import logging
import os
import uuid
from contextlib import asynccontextmanager

from dotenv import load_dotenv
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

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


# ---------------------------------------------------------------------------
# Global exception handler -- an unhandled exception must NEVER leak its raw
# message (stack trace, DB error, file path, connection string, etc.) to the
# client. FastAPI/Starlette's own default already avoids this in production,
# but we make it an explicit, guaranteed contract rather than relying on that
# implicit default: every unhandled exception is logged in full server-side
# with a correlation id, and the client only ever sees a generic message plus
# that id (for support/debugging), never the exception's actual text.
#
# Deliberately-raised HTTPException calls elsewhere in the app (e.g.
# `raise HTTPException(401, "Not authenticated")`) are unaffected by this --
# FastAPI handles those separately, before they'd ever reach here, and their
# `detail` strings are hand-written to already be safe to show a user.
# ---------------------------------------------------------------------------

@app.exception_handler(Exception)
async def unhandled_exception_handler(request: Request, exc: Exception) -> JSONResponse:
    request_id = str(uuid.uuid4())
    logger.exception(
        "Unhandled exception on %s %s [request_id=%s]",
        request.method,
        request.url.path,
        request_id,
    )
    return JSONResponse(
        status_code=500,
        content={
            "detail": "Something went wrong on our end. Please try again.",
            "request_id": request_id,
        },
    )
