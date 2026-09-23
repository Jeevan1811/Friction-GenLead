/**
 * Next.js instrumentation hook — runs once when the server process starts
 * (both `next dev` and `next start`), before any request is served.
 *
 * We use it to fail loudly and immediately if the auth env vars are
 * missing, rather than letting the app boot into a broken or insecure
 * state (e.g. an empty AUTH_JWT_SECRET silently accepting any signature).
 * See apps/web/src/lib/auth/env.ts.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { assertAuthEnv } = await import("@/lib/auth/env");
    assertAuthEnv();
  }
}
