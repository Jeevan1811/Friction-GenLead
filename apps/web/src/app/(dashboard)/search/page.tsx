"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import {
  Search,
  ChevronDown,
  Zap,
  Clock,
  Building2,
  Users,
  Check,
  Loader2,
} from "lucide-react";
import type { JobRun } from "@/lib/types";
import { StatusBadge } from "@/components/shared/status-badge";
import { ResearchProgress } from "@/components/shared/research-progress";
import { useToast } from "@/components/ui/toast";
import { startResearch, getJobs, getResearchResults } from "@/lib/api";
import { PageLoading, PageError } from "@/components/shared/page-status";
import { SampleDataNotice } from "@/components/shared/sample-data-notice";
import { InfoPopover } from "@/components/shared/info-popover";
import { useSheetAutoRefresh } from "@/lib/use-sheet-auto-refresh";
import { buildResearchRunCompaniesHref } from "@/lib/research-run-results";
import {
  COMPANY_TARGET_MAX,
  COMPANY_TARGET_MIN,
  COMPANY_TARGET_STEP,
  DEFAULT_COMPANY_TARGET,
  DEFAULT_SEARCH_SECTOR,
  OTHER_INDUSTRY_OPTIONS,
  VALVE_SECTOR_OPTIONS,
} from "@/lib/research-search-controls.mjs";

interface ResearchCompanyResult {
  company_id?: string;
  company_name?: string;
  name?: string;
  abn?: string;
  abn_status?: string;
  website?: string;
  phone?: string;
  email?: string;
  business_phone?: string;
  business_email?: string;
  industry?: string;
  source?: string;
  industry_match?: string;
  country?: string;
  state?: string;
  postcode?: string;
  source_url?: string;
  source_provenance?: string;
  matched_locations?: Array<{
    suburb?: string;
    state?: string;
    postcode?: string;
    address?: string;
  }>;
}

interface ResearchContactResult {
  name?: string;
  role?: string;
  position?: string;
  email?: string;
  business_email?: string;
  phone?: string;
  mobile?: string;
  source_url?: string;
}

function publicSourceLabel(source: string): string {
  const normalized = source.toLowerCase();
  if (normalized.includes("overture")) return "Overture Maps candidate";
  if (normalized.includes("firecrawl")) return "Web-search candidate";
  if (normalized.includes("openstreetmap")) return "OpenStreetMap candidate";
  if (normalized.includes("abn") || normalized.includes("abr")) return "ABR name match";
  return "Public-source candidate";
}

function CompanyResultCard({
  company,
  href,
  savedMatch = false,
}: {
  company: ResearchCompanyResult;
  href: string | null;
  savedMatch?: boolean;
}) {
  const companyName = company.company_name || company.name || "Unnamed company";
  let sourceUrl = company.source_url || "";
  let sourceProvider = company.source || "Public source";
  if (!sourceUrl && company.source_provenance) {
    try {
      const provenance = JSON.parse(company.source_provenance);
      sourceUrl = provenance.record_url || "";
      sourceProvider = provenance.provider || sourceProvider;
    } catch {
      sourceUrl = "";
    }
  }
  const siteLabels = [...new Set((company.matched_locations ?? []).map((location) =>
    [location.suburb, location.state, location.postcode].filter(Boolean).join(", ") || location.address || "",
  ).filter(Boolean))];
  const locationLabel = siteLabels.length
    ? siteLabels.slice(0, 2).join(" · ")
    : [company.country, company.state, company.postcode].filter(Boolean).join(" · ");
  const sourceName = savedMatch
    ? (String(company.source || "").toUpperCase() === "LEGACY_EXCEL" ? "MSV workbook" : "Saved in Google Sheets")
    : `${publicSourceLabel(sourceProvider)} · needs review`;

  return (
    <div style={{ padding: "12px", border: "1px solid var(--color-border-subtle)", borderRadius: "var(--radius-sm)" }}>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: "12px", flexWrap: "wrap" }}>
        {href ? (
          <Link href={href} style={{ fontSize: "14px", fontWeight: 600, color: "var(--color-accent)", textDecoration: "underline", textUnderlineOffset: "3px" }}>
            {companyName}
          </Link>
        ) : (
          <strong style={{ fontSize: "14px" }}>{companyName}</strong>
        )}
        <span style={{ fontSize: "11px", color: "var(--color-text-muted)" }}>{sourceName}</span>
      </div>
      <div style={{ marginTop: "4px", fontSize: "12px", color: "var(--color-text-secondary)" }}>
        {locationLabel || (savedMatch ? "Saved match for this area" : "Location not listed")}
        {company.abn ? ` · ABN ${company.abn}` : ""}
        {company.industry ? ` · ${company.industry}` : ""}
      </div>
      {company.industry_match && (
        <div style={{ marginTop: "4px", fontSize: "11px", color: "var(--color-text-muted)" }}>
          Search match evidence: {company.industry_match === "TAG_MATCH" ? "mapped industry tag" : company.industry_match === "INDUSTRY_FEATURE_MATCH" ? "mapped industry feature" : "company name only"}
        </div>
      )}
      {company.website && (
        <a href={company.website} target="_blank" rel="noreferrer" style={{ display: "inline-block", marginTop: "5px", marginRight: "12px", fontSize: "12px" }}>
          Visit listed website
        </a>
      )}
      {!savedMatch && (company.business_email || company.email) && (
        <a href={`mailto:${company.business_email || company.email}`} style={{ display: "inline-block", marginTop: "5px", marginRight: "12px", fontSize: "12px" }}>
          {company.business_email || company.email}
        </a>
      )}
      {!savedMatch && (company.business_phone || company.phone) && (
        <a href={`tel:${company.business_phone || company.phone}`} style={{ display: "inline-block", marginTop: "5px", marginRight: "12px", fontSize: "12px" }}>
          {company.business_phone || company.phone}
        </a>
      )}
      {!savedMatch && sourceUrl && (
        <a href={sourceUrl} target="_blank" rel="noreferrer" style={{ display: "inline-block", marginTop: "5px", fontSize: "12px" }}>
          View {sourceProvider} source
        </a>
      )}
    </div>
  );
}

const PRIORITY_ROLES = [
  "Owner",
  "Managing Director",
  "General Manager",
  "Plant Manager",
  "Operations Manager",
  "Maintenance Manager",
  "Engineering Manager",
  "Procurement Manager",
  "Purchasing Manager",
  "Commercial Director",
  "Site Manager",
  "Mine Manager",
];

const SECONDARY_ROLES = [
  "Safety Manager",
  "Environmental Manager",
  "Project Manager",
  "Workshop Manager",
  "Fleet Manager",
  "Supply Chain Manager",
  "Logistics Manager",
  "Technical Manager",
  "Quality Manager",
  "HR Manager",
];

const ACTIVE_RESEARCH_JOB_KEY = "genlead.activeResearchJobId";

export default function SearchPage() {
  const [location, setLocation] = useState("");
  const [industry, setIndustry] = useState(DEFAULT_SEARCH_SECTOR);
  const [companyLimit, setCompanyLimit] = useState(DEFAULT_COMPANY_TARGET);
  const [selectedRoles, setSelectedRoles] = useState<string[]>([]);
  const [locationError, setLocationError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [restoringJob, setRestoringJob] = useState(true);
  const [activeJobId, setActiveJobId] = useState<string | null>(null);
  const [activeJobBusy, setActiveJobBusy] = useState(false);
  const [researchResults, setResearchResults] = useState<{
    jobId: string;
    companies: ResearchCompanyResult[];
    knownCompanies: ResearchCompanyResult[];
    knownMatchesAvailable: boolean;
    contacts: ResearchContactResult[];
  } | null>(null);
  const [searchRuns, setSearchRuns] = useState<JobRun[]>([]);
  const [searchRunsLoading, setSearchRunsLoading] = useState(true);
  const [searchRunsError, setSearchRunsError] = useState<string | null>(null);
  const { toast } = useToast();

  useEffect(() => {
    try {
      const savedJobId = window.sessionStorage.getItem(ACTIVE_RESEARCH_JOB_KEY);
      if (savedJobId) {
        setActiveJobId(savedJobId);
        setActiveJobBusy(true);
      }
    } catch {
      // Storage may be disabled; the current page can still track this run.
    } finally {
      setRestoringJob(false);
    }
  }, []);

  const loadSearchRuns = useCallback(async (initial = false) => {
      if (initial) setSearchRunsLoading(true);
      setSearchRunsError(null);
      try {
        const data = await getJobs();
        setSearchRuns(data);
      } catch (err) {
        setSearchRunsError(
          err instanceof Error ? err.message : "Failed to load recent searches"
        );
      } finally {
        if (initial) setSearchRunsLoading(false);
      }
  }, []);

  useEffect(() => { void loadSearchRuns(true); }, [loadSearchRuns]);
  useSheetAutoRefresh(() => loadSearchRuns());

  const toggleRole = (role: string) => {
    setSelectedRoles((prev) =>
      prev.includes(role) ? prev.filter((r) => r !== role) : [...prev, role]
    );
  };

  const canSubmit =
    location.trim().length >= 2 &&
    location.length <= 160 &&
    !locationError;

  const formatDate = (iso: string) => {
    const d = new Date(iso);
    return d.toLocaleDateString("en-AU", {
      day: "numeric",
      month: "short",
      year: "numeric",
    });
  };

  return (
    <div style={{ padding: "24px", maxWidth: "800px" }}>
      <div className="genlead-page-heading">
        <h1
          data-tour="search-overview"
          style={{
            fontSize: "28px",
            fontWeight: 600,
            letterSpacing: "-0.02em",
          }}
        >
          Search Prospects
        </h1>
        <InfoPopover label="Search prospects" text="Choose an area and sector, then select how many new candidates to find. Saved companies in the area appear separately from new prospects." />
      </div>

      <SampleDataNotice />

      {/* Search form */}
      <div
        className="surface-card"
        style={{ marginBottom: "32px" }}
      >
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1fr)",
            gap: "16px",
            marginBottom: "20px",
            padding: "24px 24px 0",
          }}
          className="genlead-search-fields"
        >
          {/* Search location */}
          <div>
            <div className="genlead-field-label">
              <label htmlFor="location">City, region or postcode</label>
              <InfoPopover label="Search area" text="Mapped places are searched within roughly 5 km of the area centre. Use a specific suburb or postcode for a tighter result." />
            </div>
            <input
              id="location"
              type="text"
              maxLength={160}
              placeholder="e.g. Mackay, Queensland, Australia"
              value={location}
              onChange={(e) => {
                const value = e.target.value;
                setLocation(value);
                setLocationError(value.length > 160 ? "Location must be 160 characters or less" : "");
              }}
              className="input-field"
              style={{
                minHeight: "44px",
                borderColor: locationError
                  ? "var(--color-error)"
                  : undefined,
              }}
            />
            {locationError && (
              <p
                style={{
                  fontSize: "11px",
                  color: "var(--color-error)",
                  marginTop: "4px",
                }}
              >
                {locationError}
              </p>
            )}
          </div>

          {/* Industry */}
          <div>
            <div className="genlead-field-label">
              <label htmlFor="industry">Target sector</label>
              <InfoPopover label="Target sector" text="Sector terms narrow mapped categories and public-web matches. Choose a valve-relevant sector to avoid unrelated shops." />
            </div>
            <div style={{ position: "relative" }}>
              <select
                id="industry"
                value={industry}
                onChange={(e) => setIndustry(e.target.value)}
                className="input-field"
                style={{
                  appearance: "none",
                  paddingRight: "36px",
                  cursor: "pointer",
                  minHeight: "44px",
                }}
              >
                <option value="">All industries</option>
                <optgroup label="Valve prospecting">
                  {VALVE_SECTOR_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </optgroup>
                <optgroup label="Other sectors">
                  {OTHER_INDUSTRY_OPTIONS.map((option) => (
                    <option key={option} value={option}>
                      {option}
                    </option>
                  ))}
                </optgroup>
              </select>
              <ChevronDown
                size={16}
                style={{
                  position: "absolute",
                  right: "12px",
                  top: "50%",
                  transform: "translateY(-50%)",
                  color: "var(--color-text-muted)",
                  pointerEvents: "none",
                }}
              />
            </div>
          </div>
        </div>

        <section className="genlead-search-target" aria-labelledby="company-target-label">
          <div className="genlead-search-target-heading">
            <div className="genlead-field-label">
              <label id="company-target-label" htmlFor="company-target">New company target</label>
              <InfoPopover label="Company target" text="This is the maximum number of new candidates to find. Duplicates are skipped, so the result may be smaller. Saved companies in the area appear separately." />
            </div>
            <output htmlFor="company-target" aria-live="polite">
              {companyLimit}
            </output>
          </div>
          <input
            id="company-target"
            className="genlead-company-target-slider"
            type="range"
            min={COMPANY_TARGET_MIN}
            max={COMPANY_TARGET_MAX}
            step={COMPANY_TARGET_STEP}
            value={companyLimit}
            onChange={(event) => setCompanyLimit(Number(event.target.value))}
          />
          <div className="genlead-search-target-ends" aria-hidden="true">
            <span>{COMPANY_TARGET_MIN}</span>
            <span>{COMPANY_TARGET_MAX}</span>
          </div>
        </section>

        {/* Role selection */}
        <details className="genlead-search-roles">
          <summary>Target roles {selectedRoles.length > 0 ? `· ${selectedRoles.length} selected` : "· optional"}</summary>

          {/* Priority Roles */}
          <div style={{ marginBottom: "12px" }}>
            <div
              style={{
                fontSize: "12px",
                fontWeight: 500,
                color: "var(--color-text-secondary)",
                marginBottom: "8px",
              }}
            >
              Priority
            </div>
            <div
              style={{
                display: "flex",
                flexWrap: "wrap",
                gap: "6px",
              }}
            >
              {PRIORITY_ROLES.map((role) => {
                const selected = selectedRoles.includes(role);
                return (
                  <button
                    key={role}
                    onClick={() => toggleRole(role)}
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: "6px",
                      padding: "6px 12px",
                      fontSize: "12px",
                      fontWeight: 400,
                      fontFamily: "var(--font-sans)",
                      borderRadius: "var(--radius-pill)",
                      border: `1px solid ${
                        selected
                          ? "var(--color-accent)"
                          : "var(--color-border)"
                      }`,
                      background: selected
                        ? "var(--color-accent-light)"
                        : "transparent",
                      color: selected
                        ? "var(--color-accent)"
                        : "var(--color-text-secondary)",
                      cursor: "pointer",
                      transition: "all var(--transition-fast)",
                      minHeight: "32px",
                      minWidth: "auto",
                    }}
                  >
                    {selected && <Check size={12} />}
                    {role}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Secondary Roles */}
          <div>
            <div
              style={{
                fontSize: "12px",
                fontWeight: 500,
                color: "var(--color-text-secondary)",
                marginBottom: "8px",
              }}
            >
              Secondary
            </div>
            <div
              style={{
                display: "flex",
                flexWrap: "wrap",
                gap: "6px",
              }}
            >
              {SECONDARY_ROLES.map((role) => {
                const selected = selectedRoles.includes(role);
                return (
                  <button
                    key={role}
                    onClick={() => toggleRole(role)}
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: "6px",
                      padding: "6px 12px",
                      fontSize: "12px",
                      fontWeight: 400,
                      fontFamily: "var(--font-sans)",
                      borderRadius: "var(--radius-pill)",
                      border: `1px solid ${
                        selected
                          ? "var(--color-accent)"
                          : "var(--color-border)"
                      }`,
                      background: selected
                        ? "var(--color-accent-light)"
                        : "transparent",
                      color: selected
                        ? "var(--color-accent)"
                        : "var(--color-text-secondary)",
                      cursor: "pointer",
                      transition: "all var(--transition-fast)",
                      minHeight: "32px",
                      minWidth: "auto",
                    }}
                  >
                    {selected && <Check size={12} />}
                    {role}
                  </button>
                );
              })}
            </div>
          </div>
        </details>

        {/* Submit */}
        <button
          disabled={!canSubmit || submitting || activeJobBusy || restoringJob}
          className="btn-primary"
          style={{ width: "calc(100% - 48px)", margin: "0 24px 24px" }}
          onClick={async () => {
            if (!canSubmit || submitting || activeJobBusy || restoringJob) return;
            setSubmitting(true);
            setResearchResults(null);
            try {
              const res = await startResearch(
                location.trim(),
                industry || undefined,
                selectedRoles,
                companyLimit,
              );
              toast(`Research started for ${location.trim()}`, "success");
              try {
                window.sessionStorage.setItem(ACTIVE_RESEARCH_JOB_KEY, res.job_id);
              } catch {
                // Tracking continues in this page even when session storage is unavailable.
              }
              setActiveJobId(res.job_id);
              setActiveJobBusy(true);
            } catch (err) {
              const msg =
                err instanceof Error ? err.message : "Failed to start research";
              toast(msg, "error");
            } finally {
              setSubmitting(false);
            }
          }}
        >
          {submitting ? (
            <Loader2
              size={16}
              style={{ animation: "spin 1s linear infinite" }}
            />
          ) : (
            <Zap size={16} />
          )}
          {restoringJob
            ? "Checking active search..."
            : submitting
              ? "Starting..."
            : activeJobBusy
              ? "Search in progress..."
              : "Search public sources"}
        </button>
      </div>

      {/* Active research progress */}
      {activeJobId && (
        <ResearchProgress
          jobId={activeJobId}
          onComplete={(data) => {
            toast(
              `Search complete: ${data.companies_found} new ${data.companies_found === 1 ? "company" : "companies"} found · ${data.known_companies_found ?? 0} already on your list · ${data.contacts_found} contacts`,
              "success"
            );
            void getResearchResults(data.job_id)
              .then((results) => {
                setResearchResults({
                  jobId: results.job_id,
                  companies: results.companies as ResearchCompanyResult[],
                  knownCompanies: (results.known_companies ?? []) as ResearchCompanyResult[],
                  knownMatchesAvailable: results.known_matches_available !== false,
                  contacts: results.contacts as ResearchContactResult[],
                });
                void loadSearchRuns();
              })
              .catch((err) => {
                toast(
                  err instanceof Error
                    ? err.message
                    : "Research finished, but its detailed results could not be loaded.",
                  "error"
                );
              });
          }}
          onTerminal={(data) => {
            setActiveJobBusy(false);
            try {
              window.sessionStorage.removeItem(ACTIVE_RESEARCH_JOB_KEY);
            } catch {
              // The run is terminal even if browser storage is unavailable.
            }
            void loadSearchRuns();
            if (data.status !== "completed" && data.errors?.[0]) {
              toast(data.errors[0], "error");
            }
          }}
          onMonitoringStopped={() => {
            setActiveJobBusy(false);
            try {
              window.sessionStorage.removeItem(ACTIVE_RESEARCH_JOB_KEY);
            } catch {
              // Monitoring state is local even if storage is unavailable.
            }
            void loadSearchRuns();
          }}
        />
      )}

      {researchResults && (
        <div className="surface-card" style={{ padding: "20px", marginBottom: "32px" }}>
          {!researchResults.knownMatchesAvailable && (
            <div role="status" style={{ marginBottom: "14px", padding: "10px 12px", borderRadius: "var(--radius-sm)", background: "#FFFBEB", border: "1px solid #FDE68A", color: "#92400E", fontSize: "12px" }}>
              Saved matches could not be checked because the Locations tab was unavailable. New public-source results below are unaffected.
            </div>
          )}

          <section aria-label="Already on your list" style={{ marginBottom: "18px" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "12px", flexWrap: "wrap", marginBottom: "6px" }}>
              <div className="genlead-result-heading"><h2 style={{ fontSize: "16px", fontWeight: 600, margin: 0 }}>Already on your list <span style={{ color: "var(--color-text-muted)", fontWeight: 500 }}>({researchResults.knownCompanies.length})</span></h2><InfoPopover label="Saved companies" text="These are existing Google Sheet records located in the area. Search shows them separately and does not rewrite them." /></div>
              {researchResults.knownCompanies.length > 0 && (
                <Link href={buildResearchRunCompaniesHref(researchResults.jobId, undefined, "known")} className="btn-secondary" style={{ textDecoration: "none" }}>
                  View saved matches
                </Link>
              )}
            </div>
            {researchResults.knownCompanies.length === 0 ? (
              <p style={{ fontSize: "12px", color: "var(--color-text-muted)", margin: 0 }}>No saved company locations matched this area.</p>
            ) : (
              <div style={{ display: "grid", gap: "8px" }}>
                {researchResults.knownCompanies.map((company, index) => {
                  const companyName = company.company_name || company.name || "Saved company";
                  const href = company.company_id ? `/companies?companyId=${encodeURIComponent(company.company_id)}` : null;
                  return <CompanyResultCard key={company.company_id || `${companyName}-${index}`} company={company} href={href} savedMatch />;
                })}
              </div>
            )}
          </section>

          <section aria-label="New companies found">
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "12px", flexWrap: "wrap", marginBottom: "6px" }}>
              <div className="genlead-result-heading"><h2 style={{ fontSize: "16px", fontWeight: 600, margin: 0 }}>New companies found <span style={{ color: "var(--color-text-muted)", fontWeight: 500 }}>({researchResults.companies.length})</span></h2><InfoPopover label="New companies" text="These are public-source candidates discovered by this search. Review their website and evidence before contacting." /></div>
              {researchResults.companies.length > 0 && (
                <Link href={buildResearchRunCompaniesHref(researchResults.jobId)} className="btn-secondary" style={{ textDecoration: "none" }}>
                  View new companies
                </Link>
              )}
            </div>
            {researchResults.companies.length === 0 ? (
              <p style={{ fontSize: "12px", color: "var(--color-text-muted)", margin: 0 }}>No new companies were found in this search.</p>
            ) : (
              <div style={{ display: "grid", gap: "8px" }}>
                {researchResults.companies.map((company, index) => {
                  const companyName = company.company_name || company.name || "New public-source candidate";
                  const href = company.company_id
                    ? buildResearchRunCompaniesHref(researchResults.jobId, company.company_id)
                    : null;
                  return <CompanyResultCard key={company.company_id || `${company.abn || companyName}-${index}`} company={company} href={href} />;
                })}
              </div>
            )}
          </section>
          {researchResults.contacts.length > 0 && (
            <div style={{ marginTop: "16px" }}>
              <h3 style={{ fontSize: "14px", fontWeight: 600, marginBottom: "8px" }}>Publicly listed people</h3>
              {researchResults.contacts.map((contact, index) => (
                <div key={`${contact.name || "contact"}-${index}`} style={{ fontSize: "12px", color: "var(--color-text-secondary)", marginBottom: "6px" }}>
                  {contact.name || "Unnamed contact"} — {contact.role || contact.position || "role not stated"}
                  {(contact.email || contact.business_email) && ` · ${contact.email || contact.business_email}`}
                  {(contact.phone || contact.mobile) && ` · ${contact.phone || contact.mobile}`}
                  {contact.source_url && <> · <a href={contact.source_url} target="_blank" rel="noreferrer">source</a></>}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Recent searches */}
      <div>
        <h3
          style={{
            fontSize: "13px",
            fontWeight: 600,
            marginBottom: "12px",
            color: "var(--color-text)",
          }}
        >
          Recent Searches
        </h3>

        {searchRunsError && (
          <div style={{ marginBottom: "12px" }}>
            <PageError message={searchRunsError} />
          </div>
        )}

        {searchRunsLoading ? (
          <PageLoading label="Loading recent searches..." />
        ) : searchRuns.length === 0 ? (
          <div
            className="surface-card"
            style={{
              padding: "48px 24px",
              textAlign: "center",
            }}
          >
            <Clock
              size={32}
              style={{
                color: "var(--color-text-muted)",
                marginBottom: "12px",
              }}
            />
            <p
              style={{
                fontSize: "13px",
                color: "var(--color-text-muted)",
              }}
            >
              No saved research runs yet. Search a city, region, country or postcode for mapped public business candidates.
            </p>
          </div>
        ) : (
          <div
            style={{
              display: "grid",
              gap: "8px",
            }}
          >
            {searchRuns.map((run) => (
              <div
                key={run.jobId}
                className="surface-card"
                style={{
                  padding: "16px 20px",
                  display: "flex",
                  alignItems: "center",
                  gap: "16px",
                }}
              >
                <div
                  style={{
                    width: 40,
                    height: 40,
                    borderRadius: "var(--radius-md)",
                    background: "var(--color-bg)",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    flexShrink: 0,
                    fontWeight: 600,
                    fontSize: "13px",
                    color: "var(--color-text-secondary)",
                  }}
                >
                  {(run.location || run.postcode || "?").slice(0, 2)}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: "8px",
                      marginBottom: "2px",
                    }}
                  >
                    <span
                      style={{
                        fontSize: "13px",
                        fontWeight: 500,
                        color: "var(--color-text)",
                      }}
                    >
                      {run.location || run.postcode || "Location not recorded"}
                    </span>
                    {run.industry && (
                      <span
                        style={{
                          fontSize: "11px",
                          color: "var(--color-text-muted)",
                        }}
                      >
                        {run.industry}
                      </span>
                    )}
                  </div>
                  <div
                    style={{
                      fontSize: "11px",
                      color: "var(--color-text-muted)",
                    }}
                  >
                    {formatDate(run.createdAt)}
                  </div>
                </div>
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "16px",
                    flexShrink: 0,
                  }}
                >
                  {run.status !== "running" && (run.companiesFound > 0 || (run.knownCompaniesFound ?? 0) > 0) ? (
                    <div style={{ display: "flex", flexWrap: "wrap", gap: "10px" }}>
                      {run.companiesFound > 0 && (
                        <Link
                          href={buildResearchRunCompaniesHref(run.jobId)}
                          aria-label={`View ${run.companiesFound} new ${run.companiesFound === 1 ? "company" : "companies"} from ${run.location || run.postcode}`}
                          style={{ display: "flex", alignItems: "center", gap: "4px", minHeight: "40px", color: "var(--color-accent)", textDecoration: "underline", textUnderlineOffset: "3px", fontSize: "12px" }}
                        >
                          <Building2 size={14} />
                          {run.companiesFound} new
                        </Link>
                      )}
                      {(run.knownCompaniesFound ?? 0) > 0 && (
                        <Link
                          href={buildResearchRunCompaniesHref(run.jobId, undefined, "known")}
                          aria-label={`View ${run.knownCompaniesFound} saved matches from ${run.location || run.postcode}`}
                          style={{ display: "flex", alignItems: "center", gap: "4px", minHeight: "40px", color: "#147c77", textDecoration: "underline", textUnderlineOffset: "3px", fontSize: "12px" }}
                        >
                          <Building2 size={14} />
                          {run.knownCompaniesFound} saved
                        </Link>
                      )}
                    </div>
                  ) : (
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: "4px",
                        fontSize: "12px",
                        color: "var(--color-text-secondary)",
                      }}
                    >
                      <Building2 size={14} />
                      {run.companiesFound} companies
                    </div>
                  )}
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: "4px",
                      fontSize: "12px",
                      color: "var(--color-text-secondary)",
                    }}
                  >
                    <Users size={14} />
                    {run.contactsFound}
                  </div>
                  <StatusBadge
                    status={run.status === "running" ? "VERIFYING" : run.status === "completed" ? "COMPLETED" : run.status === "failed" ? "ERROR" : "STALE"}
                    showDot
                  />
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
