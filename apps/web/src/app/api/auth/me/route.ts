import { NextRequest, NextResponse } from "next/server";
import { getSessionEmail, verifySessionToken, SESSION_COOKIE_NAME } from "@/lib/auth/jwt";

export const runtime = "nodejs";

/** Who is signed in -- used by the header. Never reveals anything without a valid session. */
export async function GET(req: NextRequest) {
  const token = req.cookies.get(SESSION_COOKIE_NAME)?.value;
  if (!token || !(await verifySessionToken(token))) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }
  return NextResponse.json({ email: await getSessionEmail(token) });
}
