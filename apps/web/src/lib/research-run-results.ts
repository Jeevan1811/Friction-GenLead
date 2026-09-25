/** Return the unique canonical company IDs saved for one research run. */
export function extractResearchRunCompanyIds(rows: unknown): string[] {
  if (!Array.isArray(rows)) return [];

  const companyIds = new Set<string>();
  for (const row of rows) {
    if (!row || typeof row !== "object") continue;
    const record = row as Record<string, unknown>;
    const value = record.company_id ?? record.companyId;
    if (typeof value === "string" && value.trim()) {
      companyIds.add(value.trim());
    }
  }
  return [...companyIds];
}

/** Build a deep link to one saved run, optionally opening a company drawer. */
export function buildResearchRunCompaniesHref(jobId: string, companyId?: string): string {
  const params = new URLSearchParams({ researchRun: jobId });
  if (companyId) params.set("companyId", companyId);
  return `/companies?${params.toString()}`;
}

/** Keep only canonical company rows that belong to a saved research run. */
export function filterCompaniesToResearchRun<T extends { companyId: string }>(
  companies: readonly T[],
  companyIds: readonly string[]
): T[] {
  const runIds = new Set(companyIds);
  return companies.filter((company) => runIds.has(company.companyId));
}
