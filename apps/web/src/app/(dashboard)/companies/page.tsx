"use client";

import { useState, useMemo, useEffect, useCallback, type CSSProperties } from "react";
import Link from "next/link";
import { Search, ChevronDown, ChevronUp, ArrowUpDown, Loader2, Users } from "lucide-react";
import type { Company, Contact, Location } from "@/lib/types";
import { StatusBadge } from "@/components/shared/status-badge";
import { DetailDrawer } from "@/components/shared/detail-drawer";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { useToast } from "@/components/ui/toast";
import {
  verifyCompany,
  verifyLocation,
  verifyContact,
  researchCompanyContacts,
  getCompanies,
  getResearchResults,
  getLocations,
  getContacts,
} from "@/lib/api";
import { PageLoading, PageError } from "@/components/shared/page-status";
import { Pager, PAGE_SIZE } from "@/components/shared/pager";
import { CompanyActivityPanel } from "@/components/shared/company-activity";
import { useSheetAutoRefresh } from "@/lib/use-sheet-auto-refresh";
import {
  extractResearchRunCompanyIds,
  filterCompaniesToResearchRun,
} from "@/lib/research-run-results";

type Tab = "all" | "new" | "review" | "approved" | "stale" | "no-contact" | "rejected";

/** What's currently targeted by the (shared) reject-with-reason dialog. */
type RejectTarget = {
  kind: "company" | "location" | "contact";
  id: string;
  label: string;
};

function sourceValues(raw?: string): string[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return parsed.map((item) => {
        if (typeof item === "string") return item;
        if (item && typeof item === "object" && "value" in item) {
          const value = (item as { value?: unknown }).value;
          return value == null ? JSON.stringify(item) : String(value);
        }
        return JSON.stringify(item);
      });
    }
  } catch {
    return [raw];
  }
  return [raw];
}

/** Compact pill-style button for Approve/Reject actions inside drawer cards. */
function compactBtnStyle(variant: "primary" | "secondary"): CSSProperties {
  return {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    gap: "4px",
    height: "26px",
    padding: "0 10px",
    fontSize: "11px",
    fontWeight: 500,
    fontFamily: "var(--font-sans)",
    color: variant === "primary" ? "var(--color-accent-text)" : "var(--color-text)",
    background: variant === "primary" ? "var(--color-accent)" : "var(--color-surface)",
    border: variant === "primary" ? "none" : "1px solid var(--color-border)",
    borderRadius: "var(--radius-sm)",
    cursor: "pointer",
    whiteSpace: "nowrap",
  };
}

type SortKey = "companyName" | "status" | "postcode";

export default function CompaniesPage() {
  const [activeTab, setActiveTab] = useState<Tab>("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("companyName");
  const [sortAsc, setSortAsc] = useState(true);
  const [selectedCompanyId, setSelectedCompanyId] = useState<string | null>(null);
  const [researchRunId, setResearchRunId] = useState<string | null>(null);
  const [researchRunLocation, setResearchRunLocation] = useState("");
  const [researchRunCompanyIds, setResearchRunCompanyIds] = useState<string[] | null>(null);
  const [researchRunLoading, setResearchRunLoading] = useState(false);
  const [researchRunError, setResearchRunError] = useState<string | null>(null);
  const [companies, setCompanies] = useState<Company[]>([]);
  const [locationsState, setLocationsState] = useState<Location[]>([]);
  const [contactsState, setContactsState] = useState<Contact[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState(false);
  const [contactResearchLoading, setContactResearchLoading] = useState(false);
  const [websiteResearchUrl, setWebsiteResearchUrl] = useState("");
  const [contactResearchStatus, setContactResearchStatus] = useState("");
  const [contactResearchWarnings, setContactResearchWarnings] = useState<string[]>([]);
  // Per-card loading, keyed "loc:<id>" / "ct:<id>", for the direct-approve
  // buttons on individual location/contact cards (no dialog involved, so
  // each card's own in-flight action shouldn't disable its siblings).
  const [entityLoading, setEntityLoading] = useState<Record<string, boolean>>({});
  // Generalized reject-with-reason dialog target: which entity kind + id
  // is being rejected. Replaces the old company-only boolean so the same
  // dialog can serve companies, locations, and contacts.
  const [rejectTarget, setRejectTarget] = useState<RejectTarget | null>(null);
  const [rejectReason, setRejectReason] = useState("");
  const { toast } = useToast();

  const load = useCallback(async (initial = false) => {
      if (initial) setLoading(true);
      setLoadError(null);
      try {
        const [companiesData, locationsData, contactsData] = await Promise.all([
          getCompanies(),
          getLocations(),
          getContacts(),
        ]);
        setCompanies(companiesData);
        setLocationsState(locationsData);
        setContactsState(contactsData);
      } catch (err) {
        setLoadError(err instanceof Error ? err.message : "Failed to load companies");
      } finally {
        if (initial) setLoading(false);
      }
  }, []);

  useEffect(() => { void load(true); }, [load]);
  useSheetAutoRefresh(() => load());

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const companyId = params.get("companyId");
    const runId = params.get("researchRun");
    if (companyId) setSelectedCompanyId(companyId);
    if (!runId) return;

    let cancelled = false;
    setResearchRunId(runId);
    setResearchRunLoading(true);
    setResearchRunError(null);
    void getResearchResults(runId)
      .then((results) => {
        if (cancelled) return;
        setResearchRunLocation(results.location);
        setResearchRunCompanyIds(extractResearchRunCompanyIds(results.companies));
      })
      .catch((err) => {
        if (cancelled) return;
        setResearchRunCompanyIds([]);
        setResearchRunError(
          err instanceof Error ? err.message : "Could not load this search's saved companies."
        );
      })
      .finally(() => {
        if (!cancelled) setResearchRunLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  // Local replacements for the old fixture-module helpers `getBestContact`
  // / `getLocationForCompany`, which operated on the (now-removed) static
  // fixture arrays -- these operate on live fetched state instead.
  // Indexed once per data change. The Sheet holds thousands of rows and these
  // lookups run per table row and inside the sort comparator, so linear
  // scans (O(companies x locations)) froze the page.
  const locationByCompany = useMemo(() => {
    const m = new Map<string, Location>();
    for (const l of locationsState) if (!m.has(l.companyId)) m.set(l.companyId, l);
    return m;
  }, [locationsState]);

  const contactsByCompany = useMemo(() => {
    const m = new Map<string, Contact[]>();
    for (const c of contactsState) {
      const list = m.get(c.companyId);
      if (list) list.push(c);
      else m.set(c.companyId, [c]);
    }
    return m;
  }, [contactsState]);

  const getBestContact = (companyId: string): Contact | undefined => {
    const companyContacts = contactsByCompany.get(companyId) ?? [];
    return companyContacts.find((c) => c.rolePriority === "PRIORITY") ?? companyContacts[0];
  };

  const getLocationForCompany = (companyId: string): Location | undefined =>
    locationByCompany.get(companyId);

  const tabs: { key: Tab; label: string; filter: (c: Company) => boolean }[] = [
    { key: "all", label: "All", filter: () => true },
    { key: "new", label: "New", filter: (c) => c.status === "NEW" },
    { key: "review", label: "Needs Review", filter: (c) => c.status === "REVIEW" || c.status === "VERIFYING" },
    { key: "approved", label: "Approved", filter: (c) => c.status === "APPROVED" },
    { key: "stale", label: "Stale", filter: (c) => c.status === "STALE" },
    {
      key: "no-contact",
      label: "No Contact",
      filter: (c) => (contactsByCompany.get(c.companyId)?.length ?? 0) === 0,
    },
    { key: "rejected", label: "Rejected", filter: (c) => c.status === "REJECTED" },
  ];

  const tabDef = tabs.find((t) => t.key === activeTab)!;

  const filtered = useMemo(() => {
    let result = companies.filter(tabDef.filter);
    if (researchRunCompanyIds !== null) {
      result = filterCompaniesToResearchRun(result, researchRunCompanyIds);
    }
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      result = result.filter(
        (c) =>
          c.companyName.toLowerCase().includes(q) ||
          c.normalizedName.includes(q) ||
          (c.tradingName && c.tradingName.toLowerCase().includes(q)) ||
          (c.businessEmail && c.businessEmail.toLowerCase().includes(q)) ||
          (c.businessPhone && c.businessPhone.toLowerCase().includes(q)) ||
          (c.businessLandlines && c.businessLandlines.toLowerCase().includes(q)) ||
          (c.sourceVerification && c.sourceVerification.toLowerCase().includes(q)) ||
          (c.legacySourceText && c.legacySourceText.toLowerCase().includes(q))
      );
    }
    result.sort((a, b) => {
      let cmp = 0;
      if (sortKey === "companyName") cmp = a.companyName.localeCompare(b.companyName);
      else if (sortKey === "status") cmp = a.status.localeCompare(b.status);
      else if (sortKey === "postcode") {
        const aLoc = getLocationForCompany(a.companyId);
        const bLoc = getLocationForCompany(b.companyId);
        cmp = (aLoc?.postcode ?? "").localeCompare(bLoc?.postcode ?? "");
      }
      return sortAsc ? cmp : -cmp;
    });
    return result;
  }, [activeTab, searchQuery, sortKey, sortAsc, tabDef, companies, locationByCompany, contactsByCompany, researchRunCompanyIds]);

  const [page, setPage] = useState(0);
  useEffect(() => {
    setPage(0);
  }, [activeTab, searchQuery, sortKey, sortAsc, researchRunId]);
  const pageRows = useMemo(
    () => filtered.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE),
    [filtered, page]
  );

  const handleSort = (key: SortKey) => {
    if (sortKey === key) setSortAsc(!sortAsc);
    else {
      setSortKey(key);
      setSortAsc(true);
    }
  };

  const SortIcon = ({ col }: { col: SortKey }) => {
    if (sortKey !== col) return <ArrowUpDown size={12} style={{ color: "var(--color-text-muted)" }} />;
    return sortAsc ? (
      <ChevronUp size={12} style={{ color: "var(--color-accent)" }} />
    ) : (
      <ChevronDown size={12} style={{ color: "var(--color-accent)" }} />
    );
  };

  const selectedCompany = selectedCompanyId
    ? companies.find((c) => c.companyId === selectedCompanyId)
    : null;
  const selectedLocs = selectedCompanyId
    ? locationsState.filter((l) => l.companyId === selectedCompanyId)
    : [];
  const selectedContacts = selectedCompanyId
    ? contactsState.filter((c) => c.companyId === selectedCompanyId)
    : [];

  useEffect(() => {
    setWebsiteResearchUrl(selectedCompany?.website ?? "");
    setContactResearchStatus("");
    setContactResearchWarnings([]);
  }, [selectedCompanyId, selectedCompany?.website]);

  const runContactResearch = async () => {
    if (!selectedCompany || !websiteResearchUrl.trim() || contactResearchLoading) return;
    setContactResearchLoading(true);
    setContactResearchStatus("");
    setContactResearchWarnings([]);
    try {
      const result = await researchCompanyContacts(
        selectedCompany.companyId,
        websiteResearchUrl.trim()
      );
      await load();
      setContactResearchStatus(
        result.contacts_found > 0
          ? result.records_synced
            ? `${result.contacts_found} named contact${result.contacts_found === 1 ? "" : "s"} found and saved as new, unverified records.`
            : `${result.contacts_found} named contact${result.contacts_found === 1 ? "" : "s"} found, but one or more records could not be confirmed in Sheets.`
          : "The public site was checked; no named decision-makers with an explicit role were found."
      );
      setContactResearchWarnings(result.warnings);
      toast(
        result.contacts_found > 0
          ? `Found ${result.contacts_found} public contact${result.contacts_found === 1 ? "" : "s"}`
          : "Website research finished; no named contacts found",
        result.contacts_found > 0
          ? result.records_synced ? "success" : "warning"
          : "info"
      );
    } catch (err) {
      toast(err instanceof Error ? err.message : "Website research failed", "error");
    } finally {
      setContactResearchLoading(false);
    }
  };

  return (
    <div style={{ padding: "24px" }}>
      <div style={{ marginBottom: "24px" }}>
        <h1 data-tour="companies-overview" style={{ fontSize: "28px", fontWeight: 600, letterSpacing: "-0.02em" }}>
          Companies
        </h1>
        <p style={{ fontSize: "13px", color: "var(--color-text-secondary)", marginTop: "4px" }}>
          Manage and review discovered companies
        </p>
      </div>

      {researchRunId && (
        <section
          aria-label="Saved search results"
          className="surface-card"
          style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "12px", flexWrap: "wrap", padding: "12px 16px", marginBottom: "16px" }}
        >
          <div aria-live="polite">
            <strong>{researchRunLocation || "Saved search"}</strong>
            <span style={{ marginLeft: "8px", color: "var(--color-text-secondary)", fontSize: "12px" }}>
              {researchRunLoading ? "Loading results…" : `${researchRunCompanyIds?.length ?? 0} saved companies`}
            </span>
          </div>
          <Link href="/companies" style={{ color: "var(--color-accent)", fontSize: "12px", textDecoration: "underline", textUnderlineOffset: "3px" }}>
            Show all companies
          </Link>
        </section>
      )}

      {researchRunError && (
        <div style={{ marginBottom: "16px" }}>
          <PageError message={researchRunError} />
        </div>
      )}

      {loadError && (
        <div style={{ marginBottom: "16px" }}>
          <PageError message={loadError} />
        </div>
      )}

      {loading || researchRunLoading ? (
        <PageLoading label={researchRunLoading ? "Loading saved search results…" : "Loading companies…"} />
      ) : (
      <>
      {/* Tabs */}
      <div
        style={{
          display: "flex",
          gap: "4px",
          marginBottom: "16px",
          overflowX: "auto",
          paddingBottom: "4px",
        }}
      >
        {tabs.map((tab) => {
          const count = companies.filter(tab.filter).length;
          const isActive = activeTab === tab.key;
          return (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: "6px",
                padding: "8px 14px",
                fontSize: "12px",
                fontWeight: isActive ? 500 : 400,
                fontFamily: "var(--font-sans)",
                color: isActive ? "var(--color-accent)" : "var(--color-text-secondary)",
                background: isActive ? "var(--color-accent-light)" : "transparent",
                border: "none",
                borderRadius: "var(--radius-sm)",
                cursor: "pointer",
                transition: "all var(--transition-fast)",
                whiteSpace: "nowrap",
                minHeight: "36px",
                minWidth: "auto",
              }}
              onMouseEnter={(e) => {
                if (!isActive) e.currentTarget.style.background = "var(--color-border-subtle)";
              }}
              onMouseLeave={(e) => {
                if (!isActive) e.currentTarget.style.background = "transparent";
              }}
            >
              {tab.label}
              <span
                style={{
                  fontSize: "10px",
                  fontWeight: 500,
                  padding: "1px 6px",
                  borderRadius: "var(--radius-pill)",
                  background: isActive ? "var(--color-accent)" : "var(--color-border)",
                  color: isActive ? "#fff" : "var(--color-text-muted)",
                  lineHeight: "16px",
                }}
              >
                {count}
              </span>
            </button>
          );
        })}
      </div>

      {/* Search bar */}
      <div style={{ marginBottom: "16px", position: "relative" }}>
        <Search
          size={16}
          style={{
            position: "absolute",
            left: "12px",
            top: "50%",
            transform: "translateY(-50%)",
            color: "var(--color-text-muted)",
          }}
        />
        <input
          type="text"
          placeholder="Search companies..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="input-field"
          style={{ paddingLeft: "36px" }}
        />
      </div>

      {/* Table */}
      {filtered.length === 0 ? (
        <div
          className="surface-card"
          style={{
            padding: "48px 24px",
            textAlign: "center",
          }}
        >
          <p style={{ fontSize: "13px", color: "var(--color-text-muted)" }}>
            No companies match this filter
          </p>
        </div>
      ) : (
        <div
          className="surface-card"
          style={{ overflowX: "auto" }}
        >
          <table
            style={{
              width: "100%",
              minWidth: "720px",
              borderCollapse: "collapse",
              fontSize: "13px",
            }}
          >
            <thead>
              <tr
                style={{
                  borderBottom: "1px solid var(--color-border)",
                }}
              >
                {[
                  { key: "companyName" as SortKey, label: "Company" },
                  { key: "postcode" as SortKey, label: "Site / Postcode" },
                  { key: null, label: "Best Contact" },
                  { key: null, label: "Role" },
                  { key: "status" as SortKey, label: "Status" },
                  { key: null, label: "Verified" },
                ].map((col, i) => (
                  <th
                    key={i}
                    onClick={col.key ? () => handleSort(col.key!) : undefined}
                    style={{
                      padding: "10px 16px",
                      textAlign: "left",
                      fontSize: "11px",
                      fontWeight: 500,
                      textTransform: "uppercase",
                      letterSpacing: "0.04em",
                      color: "var(--color-text-muted)",
                      cursor: col.key ? "pointer" : "default",
                      userSelect: "none",
                      whiteSpace: "nowrap",
                    }}
                  >
                    <span
                      style={{
                        display: "inline-flex",
                        alignItems: "center",
                        gap: "4px",
                      }}
                    >
                      {col.label}
                      {col.key && <SortIcon col={col.key} />}
                    </span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {pageRows.map((company) => {
                const loc = getLocationForCompany(company.companyId);
                const contact = getBestContact(company.companyId);
                return (
                  <tr
                    key={company.companyId}
                    onClick={() => setSelectedCompanyId(company.companyId)}
                    style={{
                      borderBottom: "1px solid var(--color-border-subtle)",
                      cursor: "pointer",
                      transition: "background var(--transition-fast)",
                    }}
                    onMouseEnter={(e) =>
                      (e.currentTarget.style.background = "var(--color-accent-light)")
                    }
                    onMouseLeave={(e) =>
                      (e.currentTarget.style.background = "transparent")
                    }
                  >
                    <td style={{ padding: "12px 16px" }}>
                      <div style={{ fontWeight: 500, color: "var(--color-text)" }}>
                        {company.tradingName || company.companyName}
                      </div>
                      <div style={{ fontSize: "11px", color: "var(--color-text-muted)", marginTop: "1px" }}>
                        {company.abn ? `ABN ${company.abn}` : "No ABN on file"}
                      </div>
                    </td>
                    <td style={{ padding: "12px 16px" }}>
                      {loc ? (
                        <div>
                          <div style={{ color: "var(--color-text-secondary)" }}>
                            {loc.siteName}
                          </div>
                          <div style={{ fontSize: "11px", color: "var(--color-text-muted)" }}>
                            {[loc.suburb, loc.postcode].filter(Boolean).join(", ")}
                          </div>
                        </div>
                      ) : (
                        <span style={{ color: "var(--color-text-muted)" }}>--</span>
                      )}
                    </td>
                    <td style={{ padding: "12px 16px", color: "var(--color-text-secondary)" }}>
                      {contact?.name ?? (
                        <span style={{ color: "var(--color-text-muted)" }}>None</span>
                      )}
                    </td>
                    <td style={{ padding: "12px 16px" }}>
                      {contact?.position ? (
                        <span style={{ fontSize: "12px", color: "var(--color-text-secondary)" }}>
                          {contact.position}
                        </span>
                      ) : (
                        <span style={{ color: "var(--color-text-muted)" }}>--</span>
                      )}
                    </td>
                    <td style={{ padding: "12px 16px" }}>
                      <StatusBadge status={company.status} showDot />
                    </td>
                    <td style={{ padding: "12px 16px", fontSize: "12px", color: "var(--color-text-muted)" }}>
                      {company.lastVerified
                        ? new Date(company.lastVerified).toLocaleDateString("en-AU", {
                            day: "numeric",
                            month: "short",
                          })
                        : "--"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <Pager
            page={page}
            pageSize={PAGE_SIZE}
            total={filtered.length}
            onChange={setPage}
          />
        </div>
      )}

      {/* Detail drawer */}
      <DetailDrawer
        open={!!selectedCompany}
        onClose={() => setSelectedCompanyId(null)}
        title={selectedCompany?.tradingName || selectedCompany?.companyName || ""}
      >
        {selectedCompany && (
          <div style={{ display: "flex", flexDirection: "column", gap: "24px" }}>
            {/* Company info */}
            <div>
              <div className="text-label" style={{ marginBottom: "8px" }}>
                Company Info
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px" }}>
                <div>
                  <div style={{ fontSize: "11px", color: "var(--color-text-muted)" }}>ABN</div>
                  <div style={{ fontSize: "13px", fontWeight: 500 }}>{selectedCompany.abn}</div>
                </div>
                <div>
                  <div style={{ fontSize: "11px", color: "var(--color-text-muted)" }}>Status</div>
                  <StatusBadge status={selectedCompany.status} showDot />
                </div>
                <div>
                  <div style={{ fontSize: "11px", color: "var(--color-text-muted)" }}>Industry</div>
                  <div style={{ fontSize: "13px" }}>{selectedCompany.industry ?? "--"}</div>
                </div>
                <div>
                  <div style={{ fontSize: "11px", color: "var(--color-text-muted)" }}>Fit</div>
                  <StatusBadge status={selectedCompany.industryFit} />
                </div>
                {selectedCompany.businessEmail && (
                  <div>
                    <div style={{ fontSize: "11px", color: "var(--color-text-muted)" }}>Public business email</div>
                    <a href={`mailto:${selectedCompany.businessEmail}`} style={{ fontSize: "13px" }}>{selectedCompany.businessEmail}</a>
                  </div>
                )}
                {selectedCompany.businessPhone && (
                  <div>
                    <div style={{ fontSize: "11px", color: "var(--color-text-muted)" }}>Public business phone</div>
                    <a href={`tel:${selectedCompany.businessPhone}`} style={{ fontSize: "13px" }}>{selectedCompany.businessPhone}</a>
                  </div>
                )}
              </div>
              {selectedCompany.website && (
                <div style={{ marginTop: "12px" }}>
                  <div style={{ fontSize: "11px", color: "var(--color-text-muted)" }}>Website</div>
                  <a
                    href={selectedCompany.website}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{
                      fontSize: "13px",
                      color: "var(--color-accent)",
                      textDecoration: "none",
                      minHeight: "auto",
                      minWidth: "auto",
                    }}
                  >
                    {selectedCompany.website.replace(/^https?:\/\//, "")}
                  </a>
                </div>
              )}
              <div
                style={{
                  marginTop: "16px",
                  padding: "14px",
                  border: "1px solid var(--color-border-subtle)",
                  borderRadius: "var(--radius-sm)",
                  background: "var(--color-bg)",
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "6px" }}>
                  <Users size={15} style={{ color: "var(--color-accent)" }} />
                  <strong style={{ fontSize: "13px", fontWeight: 600 }}>Find public contacts</strong>
                </div>
                <p style={{ fontSize: "11px", lineHeight: 1.5, color: "var(--color-text-secondary)", margin: "0 0 10px" }}>
                  ABR does not provide company websites. Overture may list one; review it before crawling. We respect robots.txt, and any URL you add is marked operator-supplied and unverified.
                </p>
                <label htmlFor="company-research-website" style={{ display: "block", fontSize: "11px", color: "var(--color-text-muted)", marginBottom: "5px" }}>
                  Public company website
                </label>
                <input
                  id="company-research-website"
                  type="url"
                  inputMode="url"
                  autoComplete="url"
                  placeholder="https://company.com.au"
                  value={websiteResearchUrl}
                  onChange={(event) => setWebsiteResearchUrl(event.target.value)}
                  className="input-field"
                  style={{ width: "100%", minHeight: "44px", marginBottom: "8px" }}
                />
                <button
                  type="button"
                  className="btn-primary"
                  disabled={!websiteResearchUrl.trim() || contactResearchLoading}
                  onClick={() => void runContactResearch()}
                  style={{ width: "100%", minHeight: "44px" }}
                >
                  {contactResearchLoading ? (
                    <Loader2 size={15} style={{ animation: "spin 1s linear infinite" }} />
                  ) : (
                    <Users size={15} />
                  )}
                  {contactResearchLoading ? "Checking public pages…" : "Crawl site for published contacts"}
                </button>
                {contactResearchStatus && (
                  <div role="status" style={{ marginTop: "10px", fontSize: "11px", lineHeight: 1.5, color: "var(--color-text-secondary)" }}>
                    {contactResearchStatus}
                    {contactResearchWarnings.length > 0 && (
                      <ul style={{ paddingLeft: "18px", margin: "6px 0 0" }}>
                        {contactResearchWarnings.map((warning, index) => <li key={`${index}-${warning}`}>{warning}</li>)}
                      </ul>
                    )}
                  </div>
                )}
              </div>
              {selectedCompany.notes && (
                <div
                  style={{
                    marginTop: "12px",
                    padding: "10px 12px",
                    borderRadius: "var(--radius-sm)",
                    background: "var(--color-bg)",
                    fontSize: "12px",
                    color: "var(--color-text-secondary)",
                    lineHeight: 1.5,
                  }}
                >
                  {selectedCompany.notes}
                </div>
              )}
              {([
                ["Source verification / source notes", selectedCompany.sourceVerification],
                ["Business landlines without a named contact", selectedCompany.businessLandlines],
                ["Original SMC source text (unverified)", selectedCompany.legacySourceText],
              ] as Array<[string, string | undefined]>).map(([label, value]) => {
                const items = sourceValues(value);
                if (!items.length) return null;
                return (
                  <div key={label} style={{ marginTop: 12, padding: "10px 12px", border: "1px solid var(--color-border-subtle)", borderRadius: "var(--radius-sm)", background: "var(--color-bg)" }}>
                    <div style={{ color: "var(--color-text-muted)", fontSize: 10, fontWeight: 600, marginBottom: 5 }}>{label}</div>
                    <div style={{ display: "grid", gap: 4, color: "var(--color-text-secondary)", fontSize: 11, lineHeight: 1.45 }}>
                      {items.map((item, index) => <div key={`${label}-${index}`}>{item}</div>)}
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Locations */}
            <div>
              <div className="text-label" style={{ marginBottom: "8px" }}>
                Locations ({selectedLocs.length})
              </div>
              {selectedLocs.map((loc) => {
                const locKey = `loc:${loc.locationId}`;
                const locLoading = !!entityLoading[locKey];
                const disabled = locLoading || actionLoading;
                return (
                  <div
                    key={loc.locationId}
                    style={{
                      padding: "12px",
                      borderRadius: "var(--radius-sm)",
                      border: "1px solid var(--color-border-subtle)",
                      marginBottom: "8px",
                    }}
                  >
                    <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "4px" }}>
                      <span style={{ fontSize: "13px", fontWeight: 500 }}>
                        {loc.siteName}
                      </span>
                      <StatusBadge status={loc.locationType} />
                    </div>
                    <div style={{ fontSize: "12px", color: "var(--color-text-secondary)" }}>
                      {loc.address && `${loc.address}, `}
                      {loc.suburb}, {loc.state} {loc.postcode}
                    </div>
                    {loc.rawPostcode && loc.rawPostcode !== loc.postcode && (
                      <div style={{ fontSize: 11, color: "var(--color-text-muted)", marginTop: 3 }}>
                        Original postcode: {loc.rawPostcode} · not independently verified
                      </div>
                    )}
                    <div style={{ marginTop: "4px" }}>
                      <StatusBadge status={loc.verificationStatus} showDot />
                    </div>
                    <div style={{ display: "flex", gap: "6px", marginTop: "8px" }}>
                      {loc.verificationStatus !== "APPROVED" && (
                        <button
                          disabled={disabled}
                          style={{ ...compactBtnStyle("primary"), opacity: disabled ? 0.5 : 1 }}
                          onClick={async () => {
                            setEntityLoading((s) => ({ ...s, [locKey]: true }));
                            try {
                              const result = await verifyLocation(
                                {
                                  locationId: loc.locationId,
                                  companyId: loc.companyId,
                                  siteName: loc.siteName,
                                  locationType: loc.locationType,
                                  address: loc.address,
                                  suburb: loc.suburb,
                                  state: loc.state,
                                  postcode: loc.postcode,
                                },
                                "approve"
                              );
                              setLocationsState((prev) =>
                                prev.map((l) =>
                                  l.locationId === loc.locationId
                                    ? {
                                        ...l,
                                        verificationStatus: "APPROVED",
                                      }
                                    : l
                                )
                              );
                              toast(
                                result.sync_status === "SYNCED"
                                  ? "Location approved and synced to sheet"
                                  : "Location approved (sheet sync pending)",
                                "success"
                              );
                            } catch (err) {
                              const msg =
                                err instanceof Error
                                  ? err.message
                                  : "Failed to approve location";
                              toast(msg, "error");
                            } finally {
                              setEntityLoading((s) => ({ ...s, [locKey]: false }));
                            }
                          }}
                        >
                          {locLoading ? (
                            <Loader2 size={11} style={{ animation: "spin 1s linear infinite" }} />
                          ) : null}
                          Approve
                        </button>
                      )}
                      {loc.verificationStatus !== "DISPUTED" && (
                        <button
                          disabled={disabled}
                          style={{ ...compactBtnStyle("secondary"), opacity: disabled ? 0.5 : 1 }}
                          onClick={() => {
                            setRejectReason("");
                            setRejectTarget({
                              kind: "location",
                              id: loc.locationId,
                              label: loc.siteName,
                            });
                          }}
                        >
                          Reject
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Contacts */}
            <div>
              <div className="text-label" style={{ marginBottom: "8px" }}>
                Contacts ({selectedContacts.length})
              </div>
              {selectedContacts.map((ct) => {
                const ctKey = `ct:${ct.contactId}`;
                const ctLoading = !!entityLoading[ctKey];
                const disabled = ctLoading || actionLoading;
                return (
                  <div
                    key={ct.contactId}
                    style={{
                      padding: "12px",
                      borderRadius: "var(--radius-sm)",
                      border: "1px solid var(--color-border-subtle)",
                      marginBottom: "8px",
                    }}
                  >
                    <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "4px" }}>
                      <span style={{ fontSize: "13px", fontWeight: 500 }}>
                        {ct.name}
                      </span>
                      <StatusBadge status={ct.rolePriority} />
                    </div>
                    <div style={{ fontSize: "12px", color: "var(--color-text-secondary)" }}>
                      {ct.position}
                    </div>
                    {ct.businessEmail && (
                      <div style={{ fontSize: "12px", color: "var(--color-accent)", marginTop: "4px" }}>
                        {ct.businessEmail}
                      </div>
                    )}
                    {ct.mobile && (
                      <div style={{ fontSize: "12px", color: "var(--color-text-secondary)", marginTop: "2px" }}>
                        {ct.mobile}
                      </div>
                    )}
                    {ct.professionalUrlRaw && (
                      <div style={{ fontSize: "11px", color: "var(--color-text-muted)", marginTop: "4px", overflowWrap: "anywhere" }}>
                        Original professional URL (unverified): {ct.professionalUrlRaw}
                      </div>
                    )}
                    <div style={{ marginTop: "4px" }}>
                      <StatusBadge status={ct.contactStatus} showDot />
                    </div>
                    <div style={{ display: "flex", gap: "6px", marginTop: "8px" }}>
                      {ct.contactStatus !== "APPROVED" && (
                        <button
                          disabled={disabled}
                          style={{ ...compactBtnStyle("primary"), opacity: disabled ? 0.5 : 1 }}
                          onClick={async () => {
                            setEntityLoading((s) => ({ ...s, [ctKey]: true }));
                            try {
                              const result = await verifyContact(
                                {
                                  contactId: ct.contactId,
                                  companyId: ct.companyId,
                                  locationId: ct.locationId,
                                  name: ct.name,
                                  position: ct.position,
                                  businessEmail: ct.businessEmail,
                                  mobile: ct.mobile,
                                },
                                "approve"
                              );
                              setContactsState((prev) =>
                                prev.map((c) =>
                                  c.contactId === ct.contactId
                                    ? {
                                        ...c,
                                        contactStatus: "APPROVED",
                                      }
                                    : c
                                )
                              );
                              toast(
                                result.sync_status === "SYNCED"
                                  ? "Contact approved and synced to sheet"
                                  : "Contact approved (sheet sync pending)",
                                "success"
                              );
                            } catch (err) {
                              const msg =
                                err instanceof Error
                                  ? err.message
                                  : "Failed to approve contact";
                              toast(msg, "error");
                            } finally {
                              setEntityLoading((s) => ({ ...s, [ctKey]: false }));
                            }
                          }}
                        >
                          {ctLoading ? (
                            <Loader2 size={11} style={{ animation: "spin 1s linear infinite" }} />
                          ) : null}
                          Approve
                        </button>
                      )}
                      {ct.contactStatus !== "REJECTED" && (
                        <button
                          disabled={disabled}
                          style={{ ...compactBtnStyle("secondary"), opacity: disabled ? 0.5 : 1 }}
                          onClick={() => {
                            setRejectReason("");
                            setRejectTarget({
                              kind: "contact",
                              id: ct.contactId,
                              label: ct.name,
                            });
                          }}
                        >
                          Reject
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>

            <CompanyActivityPanel
              companyId={selectedCompany.companyId}
              contacts={selectedContacts}
            />

            {/* Actions */}
            <div style={{ display: "flex", gap: "8px" }}>
              {selectedCompany.status !== "APPROVED" && (
                <button
                  className="btn-primary"
                  style={{ flex: 1 }}
                  disabled={actionLoading}
                  onClick={async () => {
                    setActionLoading(true);
                    try {
                      const result = await verifyCompany(
                        {
                          companyId: selectedCompany.companyId,
                          abn: selectedCompany.abn,
                          companyName: selectedCompany.companyName,
                        },
                        "approve"
                      );
                      setCompanies((prev) =>
                        prev.map((c) =>
                          c.companyId === selectedCompany.companyId
                            ? { ...c, status: "APPROVED" }
                            : c
                        )
                      );
                      toast(
                        result.sync_status === "SYNCED"
                          ? "Company approved and synced to sheet"
                          : "Company approved (sheet sync pending)",
                        "success"
                      );
                    } catch (err) {
                      const msg =
                        err instanceof Error
                          ? err.message
                          : "Failed to approve company";
                      toast(msg, "error");
                    } finally {
                      setActionLoading(false);
                    }
                  }}
                >
                  {actionLoading ? (
                    <Loader2
                      size={14}
                      style={{ animation: "spin 1s linear infinite" }}
                    />
                  ) : null}
                  Approve
                </button>
              )}
              {selectedCompany.status !== "REJECTED" && (
                <button
                  className="btn-secondary"
                  style={{ flex: 1 }}
                  disabled={actionLoading}
                  onClick={() => {
                    setRejectReason("");
                    setRejectTarget({
                      kind: "company",
                      id: selectedCompany.companyId,
                      label: selectedCompany.tradingName ?? selectedCompany.companyName,
                    });
                  }}
                >
                  Reject
                </button>
              )}
            </div>
          </div>
        )}
      </DetailDrawer>

      {/* Reject confirmation dialog -- shared by companies, locations, and
          contacts; `rejectTarget` says which entity + kind is being
          rejected. */}
      <ConfirmDialog
        open={!!rejectTarget}
        title={
          rejectTarget?.kind === "location"
            ? "Reject Location"
            : rejectTarget?.kind === "contact"
              ? "Reject Contact"
              : "Reject Company"
        }
        description={`Are you sure you want to reject "${rejectTarget?.label ?? ""}"? Please provide a reason.`}
        confirmLabel="Reject"
        cancelLabel="Cancel"
        destructive
        onCancel={() => setRejectTarget(null)}
        onConfirm={async () => {
          const target = rejectTarget;
          if (!target) return;
          setRejectTarget(null);
          setActionLoading(true);
          try {
            if (target.kind === "company") {
              const company = companies.find((c) => c.companyId === target.id);
              if (!company) return;
              const result = await verifyCompany(
                {
                  companyId: company.companyId,
                  abn: company.abn,
                  companyName: company.companyName,
                },
                "reject",
                rejectReason || "Rejected by user"
              );
              setCompanies((prev) =>
                prev.map((c) =>
                  c.companyId === target.id ? { ...c, status: "REJECTED" } : c
                )
              );
              toast(
                result.sync_status === "SYNCED"
                  ? "Company rejected and synced to sheet"
                  : "Company rejected (sheet sync pending)",
                "success"
              );
            } else if (target.kind === "location") {
              const loc = locationsState.find((l) => l.locationId === target.id);
              if (!loc) return;
              const result = await verifyLocation(
                {
                  locationId: loc.locationId,
                  companyId: loc.companyId,
                  siteName: loc.siteName,
                  locationType: loc.locationType,
                  address: loc.address,
                  suburb: loc.suburb,
                  state: loc.state,
                  postcode: loc.postcode,
                },
                "reject",
                rejectReason || "Rejected by user"
              );
              setLocationsState((prev) =>
                prev.map((l) =>
                  l.locationId === target.id
                    ? { ...l, verificationStatus: "DISPUTED" }
                    : l
                )
              );
              toast(
                result.sync_status === "SYNCED"
                  ? "Location rejected and synced to sheet"
                  : "Location rejected (sheet sync pending)",
                "success"
              );
            } else {
              const ct = contactsState.find((c) => c.contactId === target.id);
              if (!ct) return;
              const result = await verifyContact(
                {
                  contactId: ct.contactId,
                  companyId: ct.companyId,
                  locationId: ct.locationId,
                  name: ct.name,
                  position: ct.position,
                  businessEmail: ct.businessEmail,
                  mobile: ct.mobile,
                },
                "reject",
                rejectReason || "Rejected by user"
              );
              setContactsState((prev) =>
                prev.map((c) =>
                  c.contactId === target.id
                    ? { ...c, contactStatus: "REJECTED" }
                    : c
                )
              );
              toast(
                result.sync_status === "SYNCED"
                  ? "Contact rejected and synced to sheet"
                  : "Contact rejected (sheet sync pending)",
                "success"
              );
            }
          } catch (err) {
            const msg =
              err instanceof Error
                ? err.message
                : `Failed to reject ${target.kind}`;
            toast(msg, "error");
          } finally {
            setActionLoading(false);
          }
        }}
      />
      </>
      )}
    </div>
  );
}
