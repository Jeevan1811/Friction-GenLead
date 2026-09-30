"use client";

import { useState, useMemo, useEffect, useCallback, useDeferredValue, useRef } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { LayoutGrid, List, Search } from "lucide-react";
import { getLocations, getCompanies } from "@/lib/api";
import type { Location, Company } from "@/lib/types";
import { StatusBadge } from "@/components/shared/status-badge";
import { GlobeView } from "@/components/shared/globe-view";
import { InfoPopover } from "@/components/shared/info-popover";
import { PageLoading, PageError } from "@/components/shared/page-status";
import { Pager, PAGE_SIZE } from "@/components/shared/pager";
import { useSheetAutoRefresh } from "@/lib/use-sheet-auto-refresh";

type ViewMode = "list" | "grid";

function rowsAreUnchanged<T extends object>(previous: T[], next: T[]): boolean {
  if (previous === next) return true;
  if (previous.length !== next.length) return false;

  for (let index = 0; index < previous.length; index += 1) {
    const left = previous[index] as Record<string, unknown>;
    const right = next[index] as Record<string, unknown>;
    const leftKeys = Object.keys(left);
    const rightKeys = Object.keys(right);
    if (leftKeys.length !== rightKeys.length) return false;
    for (const key of leftKeys) if (left[key] !== right[key]) return false;
  }
  return true;
}

const locationTypes = ["ALL", "PLANT", "MINE", "OFFICE", "DEPOT", "PROJECT", "OTHER"];
const verificationStatuses = ["ALL", "APPROVED", "VERIFIED", "VERIFYING", "UNVERIFIED", "CLOSED", "DISPUTED"];

export default function LocationsPage() {
  const router = useRouter();
  const loadInFlightRef = useRef<Promise<void> | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>("grid");
  const [typeFilter, setTypeFilter] = useState("ALL");
  const [statusFilter, setStatusFilter] = useState("ALL");
  const [searchQuery, setSearchQuery] = useState("");
  const deferredSearchQuery = useDeferredValue(searchQuery);
  const [locations, setLocations] = useState<Location[]>([]);
  const [companies, setCompanies] = useState<Company[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback((initial = false) => {
    if (loadInFlightRef.current) return loadInFlightRef.current;
    if (initial) setLoading(true);
    setError(null);

    const request = (async () => {
      try {
        const [locationsData, companiesData] = await Promise.all([
          getLocations(),
          getCompanies(),
        ]);
        setLocations((current) => rowsAreUnchanged(current, locationsData) ? current : locationsData);
        setCompanies((current) => rowsAreUnchanged(current, companiesData) ? current : companiesData);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load locations");
      } finally {
        if (initial) setLoading(false);
      }
    })();

    loadInFlightRef.current = request;
    void request.finally(() => {
      if (loadInFlightRef.current === request) loadInFlightRef.current = null;
    });
    return request;
  }, []);

  useEffect(() => { void load(true); }, [load]);
  useSheetAutoRefresh(() => load());

  const companyById = useMemo(
    () => new Map(companies.map((c) => [c.companyId, c])),
    [companies]
  );

  const filtered = useMemo(() => {
    return locations.filter((loc) => {
      if (typeFilter !== "ALL" && String(loc.locationType ?? "").trim().toUpperCase() !== typeFilter) return false;
      if (statusFilter !== "ALL" && String(loc.verificationStatus ?? "").trim().toUpperCase() !== statusFilter) return false;
      if (deferredSearchQuery) {
        const q = deferredSearchQuery.trim().toLowerCase();
        const company = companyById.get(loc.companyId);
        return [
          loc.siteName,
          loc.address,
          loc.suburb,
          loc.state,
          loc.postcode,
          loc.country,
          loc.rawPostcode,
          company?.companyName,
          company?.tradingName,
        ].some((value) => String(value ?? "").toLowerCase().includes(q));
      }
      return true;
    });
  }, [locations, companyById, typeFilter, statusFilter, deferredSearchQuery]);

  const mappedCount = useMemo(
    () => filtered.reduce((count, location) => count + (Number.isFinite(location.lat) && Number.isFinite(location.lng) ? 1 : 0), 0),
    [filtered],
  );

  const [page, setPage] = useState(0);
  useEffect(() => {
    setPage(0);
  }, [typeFilter, statusFilter, searchQuery]);
  const pageRows = useMemo(
    () => filtered.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE),
    [filtered, page]
  );

  return (
    <div className="genlead-locations-page">
      <div className="genlead-page-heading">
        <h1 data-tour="locations-overview" style={{ fontSize: "28px", fontWeight: 600, letterSpacing: "-0.02em" }}>
          Locations
        </h1>
        <InfoPopover label="Locations" text="Explore saved sites and new prospects together. Red circles are from MSV’s workbook, teal diamonds are public-source prospects, and slate means source not recorded. Filters update the map and list." />
      </div>

      {error && (
        <div style={{ marginBottom: "16px" }}>
          <PageError message={error} />
        </div>
      )}

      {loading ? (
        <PageLoading label="Loading locations..." />
      ) : (
        <>
      <div className="genlead-location-workspace">
        <aside className="genlead-location-rail" aria-label="Map filters">
          <div className="genlead-location-rail-kicker">AREA VIEW</div>
          <div className="genlead-location-rail-counts" role="status" aria-live="polite">
            <div><strong>{filtered.length.toLocaleString()}</strong><span>locations</span></div>
            <div><strong>{mappedCount.toLocaleString()}</strong><span>mapped</span></div>
          </div>
          <label htmlFor="location-search-filter">Find a location</label>
          <div className="genlead-location-search-wrap">
            <Search size={16} aria-hidden="true" />
            <input
              id="location-search-filter"
              type="search"
              placeholder="Company, suburb, postcode"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="input-field"
            />
          </div>
          <div className="genlead-location-filter-row">
            <div>
              <label htmlFor="location-type-filter">Site type</label>
              <select id="location-type-filter" value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)} className="input-field">
                {locationTypes.map((type) => (
                  <option key={type} value={type}>{type === "ALL" ? "All types" : type.charAt(0) + type.slice(1).toLowerCase()}</option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="location-status-filter">Status</label>
              <select id="location-status-filter" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="input-field">
                {verificationStatuses.map((status) => (
                  <option key={status} value={status}>{status === "ALL" ? "All statuses" : status.charAt(0) + status.slice(1).toLowerCase()}</option>
                ))}
              </select>
            </div>
          </div>
          {(searchQuery || typeFilter !== "ALL" || statusFilter !== "ALL") && (
            <button type="button" className="genlead-location-clear" onClick={() => { setSearchQuery(""); setTypeFilter("ALL"); setStatusFilter("ALL"); }} aria-label="Clear location filters">
              Clear filters
            </button>
          )}
        </aside>
        <div className="genlead-location-map-pane">
          <GlobeView locations={filtered} companiesById={companyById} focusKey={JSON.stringify([deferredSearchQuery, typeFilter, statusFilter])} focusResults={Boolean(deferredSearchQuery || typeFilter !== "ALL" || statusFilter !== "ALL")} />
        </div>
      </div>

      <div className="genlead-location-results-bar">
        <div className="genlead-location-results-title">
          <h2>Sites</h2>
          <span>{filtered.length.toLocaleString()}</span>
        </div>
        <div
          style={{
            display: "flex",
            border: "1px solid var(--color-border)",
            borderRadius: "var(--radius-sm)",
            overflow: "hidden",
          }}
        >
          <button
            onClick={() => setViewMode("grid")}
            aria-label="Grid view"
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              width: 44,
              height: 44,
              minHeight: 44,
              minWidth: 44,
              border: "none",
              background: viewMode === "grid" ? "var(--color-accent-light)" : "transparent",
              color: viewMode === "grid" ? "var(--color-accent)" : "var(--color-text-muted)",
              cursor: "pointer",
            }}
          >
            <LayoutGrid size={16} />
          </button>
          <button
            onClick={() => setViewMode("list")}
            aria-label="List view"
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              width: 44,
              height: 44,
              minHeight: 44,
              minWidth: 44,
              border: "none",
              borderLeft: "1px solid var(--color-border)",
              background: viewMode === "list" ? "var(--color-accent-light)" : "transparent",
              color: viewMode === "list" ? "var(--color-accent)" : "var(--color-text-muted)",
              cursor: "pointer",
            }}
          >
            <List size={16} />
          </button>
        </div>

      </div>

      {/* Content */}
      {filtered.length === 0 ? (
        <div
          className="surface-card"
          style={{ padding: "48px 24px", textAlign: "center" }}
        >
          <p style={{ fontSize: "13px", color: "var(--color-text-muted)" }}>
            No locations match this filter
          </p>
        </div>
      ) : viewMode === "grid" ? (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(min(100%, 300px), 1fr))",
            gap: "12px",
          }}
        >
          {pageRows.map((loc) => {
            const company = companyById.get(loc.companyId);
            return (
              <button
                key={loc.locationId}
                type="button"
                className="surface-card location-card-button"
                disabled={!company}
                aria-label={company ? `Open ${company.tradingName || company.companyName} details` : undefined}
                title={company ? "Open company details" : "No company record is linked to this location"}
                onClick={() => company && router.push(`/companies?companyId=${encodeURIComponent(company.companyId)}`)}
                style={{
                  padding: "16px 20px",
                  textAlign: "left",
                  width: "100%",
                }}
              >
                <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: "8px", marginBottom: "8px" }}>
                  <div>
                    <div style={{ fontSize: "13px", fontWeight: 500, color: "var(--color-text)" }}>
                      {loc.siteName}
                    </div>
                    <div style={{ fontSize: "12px", color: "var(--color-text-secondary)", marginTop: "2px" }}>
                      {company?.tradingName || company?.companyName || "Unknown"}
                    </div>
                  </div>
                  <StatusBadge status={loc.locationType} />
                </div>
                <div style={{ fontSize: "12px", color: "var(--color-text-muted)", marginBottom: "8px" }}>
                  {[loc.address, loc.suburb, [loc.state, loc.postcode].filter(Boolean).join(" "), loc.country]
                    .filter(Boolean)
                    .join(", ")}
                </div>
                <StatusBadge status={loc.verificationStatus} showDot />
              </button>
            );
          })}
        </div>
      ) : (
        <div className="surface-card" style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", minWidth: "720px", borderCollapse: "collapse", fontSize: "13px" }}>
            <thead>
              <tr style={{ borderBottom: "1px solid var(--color-border)" }}>
                {["Site Name", "Company", "Type", "Address", "Postcode", "Status"].map((h) => (
                  <th
                    key={h}
                    style={{
                      padding: "10px 16px",
                      textAlign: "left",
                      fontSize: "11px",
                      fontWeight: 500,
                      textTransform: "uppercase",
                      letterSpacing: "0.04em",
                      color: "var(--color-text-muted)",
                    }}
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {pageRows.map((loc) => {
                const company = companyById.get(loc.companyId);
                return (
                  <tr
                    key={loc.locationId}
                    className={company ? "genlead-location-row" : undefined}
                    onClick={(event) => {
                      if (company && !(event.target as HTMLElement).closest("a")) {
                        router.push(`/companies?companyId=${encodeURIComponent(company.companyId)}`);
                      }
                    }}
                    style={{
                      borderBottom: "1px solid var(--color-border-subtle)",
                      cursor: company ? "pointer" : "default",
                      transition: "background var(--transition-fast)",
                    }}
                    onMouseEnter={(e) =>
                      (e.currentTarget.style.background = "var(--color-accent-light)")
                    }
                    onMouseLeave={(e) =>
                      (e.currentTarget.style.background = "transparent")
                    }
                  >
                    <td style={{ padding: "12px 16px", fontWeight: 500 }}>
                      {company ? (
                        <Link href={`/companies?companyId=${encodeURIComponent(company.companyId)}`} aria-label={`Open ${company.tradingName || company.companyName} details`} style={{ color: "inherit", textDecoration: "none" }}>
                          {loc.siteName}
                        </Link>
                      ) : loc.siteName}
                    </td>
                    <td style={{ padding: "12px 16px", color: "var(--color-text-secondary)" }}>
                      {company?.tradingName || company?.companyName || "--"}
                    </td>
                    <td style={{ padding: "12px 16px" }}>
                      <StatusBadge status={loc.locationType} />
                    </td>
                    <td style={{ padding: "12px 16px", color: "var(--color-text-secondary)" }}>
                      {[loc.suburb, loc.state].filter(Boolean).join(", ")}
                    </td>
                    <td style={{ padding: "12px 16px", color: "var(--color-text-muted)" }}>
                      {loc.postcode}
                    </td>
                    <td style={{ padding: "12px 16px" }}>
                      <StatusBadge status={loc.verificationStatus} showDot />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {filtered.length > 0 && (
        <div className="surface-card" style={{ marginTop: "12px" }}>
          <Pager
            page={page}
            pageSize={PAGE_SIZE}
            total={filtered.length}
            onChange={setPage}
          />
        </div>
      )}
        </>
      )}
    </div>
  );
}
