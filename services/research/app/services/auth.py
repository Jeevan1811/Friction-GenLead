"""Shared session-JWT verification for the FastAPI side.

The Next.js app signs a stateless HS256 JWT (via the `jose` library) on
successful login + OTP verification, and sets it as an httpOnly cookie on
the shared public domain. This module verifies that same token independently
-- no shared server state, no database, no call back to Next.js -- using
PyJWT with the identical `AUTH_JWT_SECRET`.

Usage: attach `require_auth` at the router level so every endpoint on that
router is gated without repeating `Depends()` on each function individually::

    router = APIRouter(prefix="/internal/ops", dependencies=[Depends(require_auth)])

The health check stays open (no dependency) so load balancers / uptime
checks don't need a session cookie.
"""

from __future__ import annotations

import os

import jwt
from fastapi import HTTPException, Request, status

SESSION_COOKIE_NAME = "pi_session"
_JWT_ALGORITHM = "HS256"


def _get_jwt_secret() -> str:
    """Reads AUTH_JWT_SECRET from the environment on every call (not at
    import time) so a missing/empty value fails loudly the first time a
    protected request comes in, rather than silently caching an empty
    string at import and never re-checking.
    """
    secret = os.getenv("AUTH_JWT_SECRET")
    if not secret or not secret.strip():
        # This is a server misconfiguration, not a client error -- but we
        # still must not let requests through, so fail closed with a 500
        # rather than silently treating everyone as authenticated.
        raise RuntimeError(
            "AUTH_JWT_SECRET is not set. Refusing to verify sessions -- "
            "the FastAPI service must not start in this state in production."
        )
    return secret


async def require_auth(request: Request) -> None:
    """FastAPI dependency: raises 401 unless a valid session cookie is present."""
    token = request.cookies.get(SESSION_COOKIE_NAME)
    if not token:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Not authenticated",
        )

    try:
        secret = _get_jwt_secret()
        payload = jwt.decode(token, secret, algorithms=[_JWT_ALGORITHM])
    except RuntimeError:
        # Misconfigured server (missing secret) -- surface as 500, not 401,
        # so it's visibly a deploy problem rather than "wrong password".
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Auth is misconfigured on the server.",
        )
    except jwt.PyJWTError:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Not authenticated",
        )

    if payload.get("authenticated") is not True:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Not authenticated",
        )
