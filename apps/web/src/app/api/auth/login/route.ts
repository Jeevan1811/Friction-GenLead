import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { requireEnv } from "@/lib/auth/env";
import {
  checkRateLimit,
  recordFailedAttempt,
  resetRateLimit,
} from "@/lib/auth/rate-limit";
import { createPendingSession } from "@/lib/auth/otp-store";
import { sendOtpEmail } from "@/lib/auth/mailer";
import { getClientIp } from "@/lib/auth/client-ip";
import { getPasswordHash } from "@/lib/auth/credential-store";

// bcryptjs and nodemailer both need the Node runtime, not Edge.
export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const ip = getClientIp(req);

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

  let body: { email?: unknown; password?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  const email = typeof body.email === "string" ? body.email.trim() : "";
  const password = typeof body.password === "string" ? body.password : "";

  // Never log `password` or the request body — see project auth rules.
  if (!email || !password) {
    recordFailedAttempt(ip);
    return NextResponse.json(
      { error: "Invalid email or password" },
      { status: 401 }
    );
  }

  const expectedEmail = requireEnv("AUTH_EMAIL");
  const expectedHash = getPasswordHash();

  if (!expectedHash) {
    // No password has ever been set for this account yet — there is
    // nothing to compare against. Don't count this as a failed attempt
    // (it isn't a guess, it's a state the account is legitimately in);
    // send them to the setup flow instead.
    return NextResponse.json(
      { error: "No password set up yet. Use \"Set up your password\" to continue.", passwordNotSet: true },
      { status: 409 }
    );
  }

  const emailMatches = email.toLowerCase() === expectedEmail.toLowerCase();
  // Run bcrypt.compare unconditionally (not short-circuited by emailMatches)
  // so a wrong email vs. a wrong password take roughly the same time and
  // the response can't be used to probe which field was wrong.
  const passwordMatches = await bcrypt.compare(password, expectedHash);

  if (!emailMatches || !passwordMatches) {
    recordFailedAttempt(ip);
    return NextResponse.json(
      { error: "Invalid email or password" },
      { status: 401 }
    );
  }

  resetRateLimit(ip);

  const { token, otp } = createPendingSession(expectedEmail);

  try {
    await sendOtpEmail(expectedEmail, otp);
  } catch (err) {
    console.error(
      "[auth] Failed to send OTP email:",
      err instanceof Error ? err.message : "unknown error"
    );
    return NextResponse.json(
      { error: "Could not send the verification email. Please try again shortly." },
      { status: 502 }
    );
  }

  return NextResponse.json({ pendingToken: token });
}
