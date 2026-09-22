import type { NextRequest } from "next/server";

/**
 * Best-effort client IP for rate limiting. In production this app sits
 * behind nginx, which sets X-Forwarded-For; NextRequest has no built-in
 * `.ip` in the Next 15 App Router, so we read the proxy headers directly.
 */
export function getClientIp(req: NextRequest): string {
  const xff = req.headers.get("x-forwarded-for");
  if (xff) return xff.split(",")[0].trim();

  const real = req.headers.get("x-real-ip");
  if (real) return real.trim();

  return "unknown";
}
