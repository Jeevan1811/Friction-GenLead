/**
 * Signing/verification for the session JWT.
 *
 * Uses `jose` (not `jsonwebtoken`) specifically because it runs on the Web
 * Crypto API and works in both the Node runtime (API routes) and the Edge
 * runtime (middleware) without needing Node's `crypto` module. Both sides
 * of the app share one HS256 secret (`AUTH_JWT_SECRET`); FastAPI verifies
 * the same token with PyJWT using the identical secret.
 *
 * The payload intentionally carries nothing but `authenticated: true` plus
 * the standard `iat`/`exp` claims — no PII, no role data, nothing worth
 * stealing beyond "this cookie proves a valid login happened".
 */
import { SignJWT, jwtVerify } from "jose";
import { requireEnv } from "./env";

const SESSION_COOKIE_NAME = "pi_session";
const SESSION_TTL = "7d";

function getSecretKey(): Uint8Array {
  return new TextEncoder().encode(requireEnv("AUTH_JWT_SECRET"));
}

export async function signSessionToken(email?: string): Promise<string> {
  // `email` is informational only (shown in the header). Authorization is
  // still just `authenticated: true`; FastAPI ignores extra claims.
  return new SignJWT({ authenticated: true, ...(email ? { email } : {}) })
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setIssuedAt()
    .setExpirationTime(SESSION_TTL)
    .sign(getSecretKey());
}

export async function verifySessionToken(token: string): Promise<boolean> {
  try {
    const { payload } = await jwtVerify(token, getSecretKey(), {
      algorithms: ["HS256"],
    });
    return payload.authenticated === true;
  } catch {
    // Expired, malformed, wrong signature, etc. — all treated the same:
    // not authenticated. Never leak the reason to the client.
    return false;
  }
}

/** The signed-in account's email, or null (invalid token, or a session issued before email was recorded). */
export async function getSessionEmail(token: string): Promise<string | null> {
  try {
    const { payload } = await jwtVerify(token, getSecretKey(), { algorithms: ["HS256"] });
    if (payload.authenticated !== true) return null;
    return typeof payload.email === "string" ? payload.email : null;
  } catch {
    return null;
  }
}

export { SESSION_COOKIE_NAME };
