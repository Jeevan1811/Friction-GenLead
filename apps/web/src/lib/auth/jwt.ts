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

export async function signSessionToken(): Promise<string> {
  return new SignJWT({ authenticated: true })
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

export { SESSION_COOKIE_NAME };
