const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8001";

/**
 * Friendly, human-readable messages for common HTTP statuses, used as a
 * fallback when the backend didn't send a usable error message of its own.
 * Never surface a bare status code or raw JSON to the user.
 */
const STATUS_FALLBACK: Record<number, string> = {
  401: "You've been signed out. Please log in again.",
  403: "You don't have permission to do that.",
  404: "That couldn't be found — it may have been removed.",
  429: "Too many requests right now. Please wait a moment and try again.",
  500: "Something went wrong on the server. Please try again in a moment.",
  502: "The server is temporarily unavailable. Please try again shortly.",
  503: "The service is temporarily unavailable. Please try again shortly.",
};

/**
 * Extracts a human-readable message from a failed response body.
 *
 * FastAPI sends errors as either `{"detail": "some string"}` (most routes)
 * or `{"detail": [{"msg": "...", "loc": [...]}]}` (Pydantic validation
 * errors, a list of objects) -- handle both, and never let a raw JSON blob
 * or bare status code reach the user.
 */
async function extractErrorMessage(res: Response): Promise<string> {
  try {
    const data = await res.json();
    const detail = data?.detail ?? data?.error ?? data?.message;
    if (typeof detail === "string" && detail.trim()) {
      return detail;
    }
    if (Array.isArray(detail) && detail.length > 0) {
      const first = detail[0];
      if (typeof first?.msg === "string") return first.msg;
    }
  } catch {
    // Response wasn't JSON, or was empty -- fall through to the generic message.
  }
  return (
    STATUS_FALLBACK[res.status] ??
    "Something unexpected happened. Please try again."
  );
}

export async function apiGet<T>(path: string): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`);
  if (!res.ok) throw new Error(await extractErrorMessage(res));
  return res.json();
}

export async function apiPost<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(await extractErrorMessage(res));
  return res.json();
}

/* ---------- Typed API functions ---------- */

export async function startResearch(
  postcode: string,
  industry?: string,
  roles?: string[]
) {
  return apiPost<{ job_id: string; status: string; message: string }>(
    "/internal/ops/research",
    { postcode, industry: industry || null, roles: roles || [] }
  );
}

export async function getResearchStatus(jobId: string) {
  return apiGet<{
    job_id: string;
    status: string;
    companies_found: number;
    contacts_found: number;
    steps: Array<{
      name: string;
      status: string;
      result: unknown;
      error: string | null;
    }>;
    warnings: string[];
  }>(`/internal/ops/research/${jobId}`);
}

export async function getResearchResults(jobId: string) {
  return apiGet<{
    job_id: string;
    status: string;
    companies: unknown[];
    contacts: unknown[];
    warnings: string[];
  }>(`/internal/ops/research/${jobId}/results`);
}

export async function verifyCompany(
  companyData: Record<string, unknown>,
  action: "approve" | "reject",
  reason?: string
) {
  return apiPost<{
    company_id: string;
    status: string;
    abn_valid?: boolean | null;
    website_reachable?: boolean | null;
    evidence_sources: string[];
    reliability: string;
    notes?: string | null;
    // Honest reflection of whether this decision actually persisted to
    // the Google Sheet: "SYNCED" | "PENDING" | "NEVER" (never faked).
    sync_status: string;
  }>("/internal/verify/company", { ...companyData, action, reason: reason || null });
}

export async function verifyLocation(
  locationData: Record<string, unknown>,
  action: "approve" | "reject",
  reason?: string
) {
  return apiPost<{
    location_id: string;
    company_id?: string | null;
    status: string;
    site_evidence?: string | null;
    address_confirmed?: boolean | null;
    evidence_sources: string[];
    notes?: string | null;
    // Honest reflection of whether this decision actually persisted to
    // the Google Sheet: "SYNCED" | "PENDING" | "NEVER" (never faked).
    sync_status: string;
  }>("/internal/verify/location", { ...locationData, action, reason: reason || null });
}

export async function verifyContact(
  contactData: Record<string, unknown>,
  action: "approve" | "reject",
  reason?: string
) {
  return apiPost<{
    contact_id: string;
    company_id?: string | null;
    status: string;
    notes?: string | null;
    // Honest reflection of whether this decision actually persisted to
    // the Google Sheet: "SYNCED" | "PENDING" | "NEVER" (never faked).
    sync_status: string;
  }>("/internal/verify/contact", { ...contactData, action, reason: reason || null });
}

export async function sendChatMessage(
  messages: Array<{ role: string; content: string }>
) {
  return apiPost<{ response: string; model: string }>(
    "/internal/chat",
    { messages, stream: false }
  );
}
