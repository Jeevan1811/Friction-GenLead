import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { matchAllowedEmail } from "@/lib/auth/env";
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

// A fixed, valid bcrypt hash with no real password behind it. bcrypt.compare
// always runs against SOME hash below (this one when the email isn't on the
// allowlist at all) so that "unknown email" and "known email, wrong
// password" take roughly the same time -- otherwise the response latency
// itself would let someone enumerate which emails are real accounts.
const DUMMY_HASH_FOR_TIMING = "$2b$12$qurOFQv2PjP.ffw.Upa9xOhL5OEa2IOmKXe3RMt.aINjwypIKpq2i";

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

  const matchedEmail = matchAllowedEmail(email);
  const expectedHash = matchedEmail ? getPasswordHash(matchedEmail) : null;

  if (matchedEmail && !expectedHash) {
    // A real allowlisted account, but no password has ever been set for
    // it yet — there is nothing to compare against. Don't count this as a
    // failed attempt (it isn't a guess, it's a state the account is
    // legitimately in); send them to the setup flow instead.
    return NextResponse.json(
      { error: "No password set up yet. Use \"Set up your password\" to continue.", passwordNotSet: true },
      { status: 409 }
    );
  }

  // Run bcrypt.compare unconditionally, against the real hash when the
  // email is a known account with a password set, or a fixed dummy hash
  // otherwise (unknown email) — so an unrecognized email, a recognized
  // email with the wrong password, all take roughly the same time and the
  // response can't be used to enumerate which emails are real accounts.
  const passwordMatches = await bcrypt.compare(password, expectedHash ?? DUMMY_HASH_FOR_TIMING);

  if (!matchedEmail || !passwordMatches) {
    recordFailedAttempt(ip);
    return NextResponse.json(
      { error: "Invalid email or password" },
      { status: 401 }
    );
  }

  resetRateLimit(ip);

  const { token, otp } = createPendingSession(matchedEmail);

  try {
    await sendOtpEmail(matchedEmail, otp);
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
