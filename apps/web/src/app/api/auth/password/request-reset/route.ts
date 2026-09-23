import { NextRequest, NextResponse } from "next/server";
import { matchAllowedEmail } from "@/lib/auth/env";
import {
  checkRateLimit,
  recordFailedAttempt,
  resetRateLimit,
} from "@/lib/auth/rate-limit";
import { createPendingSession } from "@/lib/auth/otp-store";
import { sendPasswordResetEmail } from "@/lib/auth/mailer";
import { getClientIp } from "@/lib/auth/client-ip";
import { isPasswordSet } from "@/lib/auth/credential-store";

// bcryptjs and nodemailer both need the Node runtime, not Edge.
export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  // Rate-limited under its own key prefix so this can't be used to burn
  // through (or be burned through by) the separate login attempt counter.
  const ip = `pwreset:${getClientIp(req)}`;

  const rateLimit = checkRateLimit(ip);
  if (!rateLimit.allowed) {
    const minutes = Math.ceil((rateLimit.retryAfterSeconds ?? 0) / 60);
    return NextResponse.json(
      {
        error: `Too many attempts. Try again in ${minutes} minute${minutes === 1 ? "" : "s"}.`,
        retryAfterSeconds: rateLimit.retryAfterSeconds,
      },
      { status: 429 }
    );
  }

  let body: { email?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  const email = typeof body.email === "string" ? body.email.trim() : "";
  if (!email) {
    recordFailedAttempt(ip);
    return NextResponse.json({ error: "Enter your email." }, { status: 400 });
  }

  const matchedEmail = matchAllowedEmail(email);
  if (!matchedEmail) {
    recordFailedAttempt(ip);
    return NextResponse.json({ error: "Invalid email." }, { status: 400 });
  }

  resetRateLimit(ip);

  const isFirstSetup = !isPasswordSet(matchedEmail);
  const { token, otp } = createPendingSession(matchedEmail, "password-reset");

  try {
    await sendPasswordResetEmail(matchedEmail, otp, isFirstSetup);
  } catch (err) {
    console.error(
      "[auth] Failed to send password reset email:",
      err instanceof Error ? err.message : "unknown error"
    );
    return NextResponse.json(
      { error: "Could not send the verification email. Please try again shortly." },
      { status: 502 }
    );
  }

  return NextResponse.json({ pendingToken: token, isFirstSetup });
}
