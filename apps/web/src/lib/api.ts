const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8001";

export async function apiGet<T>(path: string): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`);
  if (!res.ok) throw new Error(`API error: ${res.status}`);
  return res.json();
}

export async function apiPost<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`API error: ${res.status}`);
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
