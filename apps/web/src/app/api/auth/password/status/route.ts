import { NextResponse } from "next/server";
import { isPasswordSet } from "@/lib/auth/credential-store";

export const runtime = "nodejs";

/**
 * Unauthenticated by necessity — the login page needs to know, before
 * anyone has signed in, whether to show the normal login form or the
 * first-time "set up your password" flow. It reveals nothing beyond a
 * boolean (not the email, not whether an attempt would succeed), so
 * there's no meaningful information leak here.
 */
export async function GET() {
  return NextResponse.json({ passwordSet: isPasswordSet() });
}
