import { NextRequest, NextResponse } from "next/server";
import { verifyPendingOtp } from "@/lib/auth/otp-store";
import { signSessionToken, SESSION_COOKIE_NAME } from "@/lib/auth/jwt";

export const runtime = "nodejs";

const SEVEN_DAYS_SECONDS = 60 * 60 * 24 * 7;

const FAILURE_MESSAGES: Record<
  "not_found" | "expired" | "too_many_attempts" | "invalid_code",
  string
> = {
  not_found: "This login session has expired. Please log in again.",
  expired: "This code has expired. Please log in again.",
  too_many_attempts: "Too many incorrect attempts. Please log in again.",
  invalid_code: "Incorrect code.",
};

export async function POST(req: NextRequest) {
  let body: { pendingToken?: unknown; code?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  const pendingToken =
    typeof body.pendingToken === "string" ? body.pendingToken : "";
  const code = typeof body.code === "string" ? body.code.trim() : "";

  if (!pendingToken || !/^\d{6}$/.test(code)) {
    return NextResponse.json({ error: "Enter the 6-digit code." }, { status: 400 });
  }

  // Never log `code` or `pendingToken`.
  const result = verifyPendingOtp(pendingToken, code, "login");

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
