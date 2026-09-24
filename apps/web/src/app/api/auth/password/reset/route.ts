import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { verifyPendingOtp } from "@/lib/auth/otp-store";
import { setPasswordHash } from "@/lib/auth/credential-store";
import { signSessionToken, SESSION_COOKIE_NAME } from "@/lib/auth/jwt";

// bcryptjs needs the Node runtime, not Edge.
export const runtime = "nodejs";

const SEVEN_DAYS_SECONDS = 60 * 60 * 24 * 7;
const MIN_PASSWORD_LENGTH = 8;
const SALT_ROUNDS = 12;

const FAILURE_MESSAGES: Record<
  "not_found" | "expired" | "too_many_attempts" | "invalid_code",
  string
> = {
  not_found: "This session has expired. Please request a new code.",
  expired: "This code has expired. Please request a new code.",
  too_many_attempts: "Too many incorrect attempts. Please request a new code.",
  invalid_code: "Incorrect code.",
};

/**
 * Verifies the OTP and sets the new password in one request — deliberately
 * not split into a separate "verify code" step, so there's no window where
 * a code is marked used but no password has actually been set yet.
 *
 * On success, also signs the caller straight in (same as a normal login):
 * they've just proven ownership of the account email via OTP, which is at
 * least as strong a proof as a login OTP.
 */
export async function POST(req: NextRequest) {
  let body: { pendingToken?: unknown; code?: unknown; newPassword?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  const pendingToken = typeof body.pendingToken === "string" ? body.pendingToken : "";
  const code = typeof body.code === "string" ? body.code.trim() : "";
  const newPassword = typeof body.newPassword === "string" ? body.newPassword : "";

  if (!pendingToken || !/^\d{6}$/.test(code)) {
    return NextResponse.json({ error: "Enter the 6-digit code." }, { status: 400 });
  }
  if (newPassword.length < MIN_PASSWORD_LENGTH) {
    return NextResponse.json(
      { error: `Password must be at least ${MIN_PASSWORD_LENGTH} characters.` },
      { status: 400 }
    );
  }

  // Never log `code`, `pendingToken`, or `newPassword`.
  const result = verifyPendingOtp(pendingToken, code, "password-reset");

  if (!result.ok) {
    const status = result.reason === "invalid_code" ? 401 : 400;
    return NextResponse.json(
      {
        error: FAILURE_MESSAGES[result.reason],
        ...(result.reason === "invalid_code"
          ? { attemptsRemaining: result.attemptsRemaining }
          : {}),
      },
      { status }
    );
  }

  const hash = await bcrypt.hash(newPassword, SALT_ROUNDS);
  setPasswordHash(result.email, hash);

  const token = await signSessionToken(result.email);
  const res = NextResponse.json({ success: true });
  res.cookies.set(SESSION_COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: SEVEN_DAYS_SECONDS,
  });
  return res;
}
