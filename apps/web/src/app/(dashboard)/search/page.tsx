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
import { useSheetAutoRefresh } from "@/lib/use-sheet-auto-refresh";
import { buildResearchRunCompaniesHref } from "@/lib/research-run-results";

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

const INDUSTRIES = [
  "Mining",
  "Energy",
  "Heavy Industry",
  "Construction",
  "Transport",
  "Manufacturing",
];

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

export default function SearchPage() {
  const [location, setLocation] = useState("");
  const [industry, setIndustry] = useState("");
  const [selectedRoles, setSelectedRoles] = useState<string[]>([]);
  const [locationError, setLocationError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [activeJobId, setActiveJobId] = useState<string | null>(null);
  const [researchResults, setResearchResults] = useState<{
    jobId: string;
    companies: ResearchCompanyResult[];
    contacts: ResearchContactResult[];
  } | null>(null);
  const [searchRuns, setSearchRuns] = useState<JobRun[]>([]);
  const [searchRunsLoading, setSearchRunsLoading] = useState(true);
  const [searchRunsError, setSearchRunsError] = useState<string | null>(null);
  const { toast } = useToast();

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
      <div style={{ marginBottom: "24px" }}>
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
        <p
          style={{
            fontSize: "13px",
            color: "var(--color-text-secondary)",
            marginTop: "4px",
          }}
        >
          Find nearby company candidates.
        </p>
      </div>

      <SampleDataNotice />

      {/* Search form */}
      <div
        className="surface-card"
        style={{ padding: "24px", marginBottom: "32px" }}
      >
        <div
          style={{
            display: "grid",
          gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1fr)",
            gap: "16px",
            marginBottom: "20px",
          }}
        >
          {/* Search location */}
          <div>
            <label
              htmlFor="location"
              style={{
                display: "block",
                fontSize: "11px",
                fontWeight: 500,
                textTransform: "uppercase",
                letterSpacing: "0.04em",
                color: "var(--color-text-muted)",
                marginBottom: "6px",
              }}
            >
              City, region, country or postcode
            </label>
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
                borderColor: locationError
                  ? "var(--color-error)"
                  : undefined,
              }}
            />
            <p style={{ fontSize: "11px", color: "var(--color-text-muted)", marginTop: "4px" }}>
              Searches mapped places within about 5 km of the place centre.
            </p>
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
            <label
              htmlFor="industry"
              style={{
                display: "block",
                fontSize: "11px",
                fontWeight: 500,
                textTransform: "uppercase",
                letterSpacing: "0.04em",
                color: "var(--color-text-muted)",
                marginBottom: "6px",
              }}
            >
              Industry
            </label>
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
                }}
              >
                <option value="">All industries</option>
                {INDUSTRIES.map((ind) => (
                  <option key={ind} value={ind}>
                    {ind}
                  </option>
                ))}
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

        {/* Role selection */}
        <div style={{ marginBottom: "20px" }}>
          <label
            style={{
              display: "block",
              fontSize: "11px",
              fontWeight: 500,
              textTransform: "uppercase",
              letterSpacing: "0.04em",
              color: "var(--color-text-muted)",
              marginBottom: "10px",
            }}
          >
            Target Roles (optional)
          </label>

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
        </div>

        {/* Submit */}
        <button
          disabled={!canSubmit || submitting}
          className="btn-primary"
          style={{ width: "100%" }}
          onClick={async () => {
            if (!canSubmit || submitting) return;
            setSubmitting(true);
            setResearchResults(null);
            try {
              const res = await startResearch(
                location.trim(),
                industry || undefined,
                selectedRoles
              );
              toast(`Research started for ${location.trim()}`, "success");
              setActiveJobId(res.job_id);
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
          {submitting ? "Starting..." : "Search public sources"}
        </button>
      </div>

      {/* Active research progress */}
      {activeJobId && (
        <ResearchProgress
          jobId={activeJobId}
          onComplete={(data) => {
            toast(
              `Research complete: ${data.companies_found} companies, ${data.contacts_found} contacts found`,
              "success"
            );
            void getResearchResults(data.job_id)
              .then((results) => {
                setResearchResults({
                  jobId: results.job_id,
                  companies: results.companies as ResearchCompanyResult[],
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
        />
      )}

      {researchResults && (
        <div className="surface-card" style={{ padding: "20px", marginBottom: "32px" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "12px", marginBottom: "12px" }}>
            <h2 style={{ fontSize: "16px", fontWeight: 600, margin: 0 }}>New public-source matches</h2>
            {researchResults.companies.length > 0 && (
              <Link
                href={buildResearchRunCompaniesHref(researchResults.jobId)}
                className="btn-secondary"
                style={{ textDecoration: "none" }}
              >
                View {researchResults.companies.length} companies
              </Link>
            )}
          </div>
          {researchResults.companies.length === 0 ? (
            <p style={{ fontSize: "13px", color: "var(--color-text-secondary)" }}>No new matches were added. Existing and rejected businesses are suppressed to avoid duplicates.</p>
          ) : (
            <div style={{ display: "grid", gap: "10px" }}>
              {researchResults.companies.map((company, index) => {
                const companyName = company.company_name || company.name || "Unnamed public-source candidate";
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
                const sourceName = sourceProvider.toLowerCase().includes("overture") || sourceProvider.toLowerCase() === "overture_maps"
                  ? "Overture Maps candidate"
                  : sourceProvider.toLowerCase().includes("openstreetmap")
                    ? "OpenStreetMap candidate"
                  : sourceProvider.toLowerCase().includes("abn") || sourceProvider.toLowerCase().includes("abr")
                    ? "ABR name match"
                    : "Public-source candidate";
                const companyHref = company.company_id
                  ? buildResearchRunCompaniesHref(researchResults.jobId, company.company_id)
                  : null;
                const locationLabel = [company.country, company.state, company.postcode].filter(Boolean).join(" · ");
                return (
                  <div key={company.company_id || `${company.abn || companyName}-${index}`} style={{ padding: "12px", border: "1px solid var(--color-border-subtle)", borderRadius: "var(--radius-sm)" }}>
                    <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: "12px" }}>
                      {companyHref ? (
                        <Link href={companyHref} style={{ fontSize: "14px", fontWeight: 600, color: "var(--color-accent)", textDecoration: "underline", textUnderlineOffset: "3px" }}>
                          {companyName}
                        </Link>
                      ) : (
                        <strong style={{ fontSize: "14px" }}>{companyName}</strong>
                      )}
                      <span style={{ fontSize: "11px", color: "var(--color-text-muted)" }}>{sourceName} · needs review</span>
                    </div>
                    <div style={{ marginTop: "4px", fontSize: "12px", color: "var(--color-text-secondary)" }}>
                      {locationLabel || "Location not listed"}
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
                    {(company.business_email || company.email) && (
                      <a href={`mailto:${company.business_email || company.email}`} style={{ display: "inline-block", marginTop: "5px", marginRight: "12px", fontSize: "12px" }}>
                        {company.business_email || company.email}
                      </a>
                    )}
                    {(company.business_phone || company.phone) && (
                      <a href={`tel:${company.business_phone || company.phone}`} style={{ display: "inline-block", marginTop: "5px", marginRight: "12px", fontSize: "12px" }}>
                        {company.business_phone || company.phone}
                      </a>
                    )}
                    {sourceUrl && (
                      <a href={sourceUrl} target="_blank" rel="noreferrer" style={{ display: "inline-block", marginTop: "5px", fontSize: "12px" }}>
                        View {sourceProvider} source
                      </a>
                    )}
                  </div>
                );
              })}
            </div>
          )}
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
                  {run.status !== "running" && run.companiesFound > 0 ? (
                    <Link
                      href={buildResearchRunCompaniesHref(run.jobId)}
                      aria-label={`View ${run.companiesFound} companies from ${run.location || run.postcode}`}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: "4px",
                        minHeight: "40px",
                        color: "var(--color-accent)",
                        textDecoration: "underline",
                        textUnderlineOffset: "3px",
                        fontSize: "12px",
                      }}
                    >
                      <Building2 size={14} />
                      {run.companiesFound} companies
                    </Link>
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
