"use client";

import { useState, useMemo } from "react";
import { MapPin, LayoutGrid, List, Search } from "lucide-react";
import { locations, companies } from "@/lib/fixtures";
import { StatusBadge } from "@/components/shared/status-badge";

type ViewMode = "list" | "grid";

const locationTypes = ["ALL", "PLANT", "MINE", "OFFICE", "DEPOT", "PROJECT", "OTHER"];
const verificationStatuses = ["ALL", "VERIFIED", "VERIFYING", "UNVERIFIED", "CLOSED", "DISPUTED"];

export default function LocationsPage() {
  const [viewMode, setViewMode] = useState<ViewMode>("grid");
  const [typeFilter, setTypeFilter] = useState("ALL");
  const [statusFilter, setStatusFilter] = useState("ALL");
  const [searchQuery, setSearchQuery] = useState("");

  const filtered = useMemo(() => {
    return locations.filter((loc) => {
      if (typeFilter !== "ALL" && loc.locationType !== typeFilter) return false;
      if (statusFilter !== "ALL" && loc.verificationStatus !== statusFilter) return false;
      if (searchQuery) {
        const q = searchQuery.toLowerCase();
        const company = companies.find((c) => c.companyId === loc.companyId);
        return (
          loc.siteName.toLowerCase().includes(q) ||
          loc.suburb?.toLowerCase().includes(q) ||
          loc.postcode.includes(q) ||
          company?.companyName.toLowerCase().includes(q)
        );
      }
      return true;
    });
  }, [typeFilter, statusFilter, searchQuery]);

  return (
    <div style={{ padding: "24px" }}>
      <div style={{ marginBottom: "24px" }}>
        <h1 style={{ fontSize: "28px", fontWeight: 600, letterSpacing: "-0.02em" }}>
          Locations
        </h1>
        <p style={{ fontSize: "13px", color: "var(--color-text-secondary)", marginTop: "4px" }}>
          Operational sites across Queensland
        </p>
      </div>

      {/* Map placeholder */}
      <div
        className="surface-card"
        style={{
          padding: "48px 24px",
          textAlign: "center",
          marginBottom: "24px",
          background: "var(--color-bg)",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: "12px",
        }}
      >
        <MapPin size={32} style={{ color: "var(--color-text-muted)" }} />
        <p style={{ fontSize: "13px", color: "var(--color-text-muted)" }}>
          Map view coming soon
        </p>
      </div>

      {/* Toolbar */}
      <div
        style={{
          display: "flex",
          gap: "12px",
          marginBottom: "16px",
          flexWrap: "wrap",
          alignItems: "center",
        }}
      >
        {/* Search */}
        <div style={{ position: "relative", flex: "1 1 200px" }}>
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
            placeholder="Search locations..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="input-field"
            style={{ paddingLeft: "36px", height: "36px" }}
          />
        </div>

        {/* Type filter */}
        <select
          value={typeFilter}
          onChange={(e) => setTypeFilter(e.target.value)}
          className="input-field"
          style={{ width: "auto", height: "36px", minWidth: "130px" }}
        >
          {locationTypes.map((t) => (
            <option key={t} value={t}>
              {t === "ALL" ? "All Types" : t.charAt(0) + t.slice(1).toLowerCase()}
            </option>
          ))}
        </select>

        {/* Status filter */}
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="input-field"
          style={{ width: "auto", height: "36px", minWidth: "140px" }}
        >
          {verificationStatuses.map((s) => (
            <option key={s} value={s}>
              {s === "ALL" ? "All Statuses" : s.charAt(0) + s.slice(1).toLowerCase()}
            </option>
          ))}
        </select>

        {/* View toggle */}
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
              width: 36,
              height: 36,
              minHeight: 36,
              minWidth: 36,
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
              width: 36,
              height: 36,
              minHeight: 36,
              minWidth: 36,
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
            gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))",
            gap: "12px",
          }}
        >
          {filtered.map((loc) => {
            const company = companies.find((c) => c.companyId === loc.companyId);
            return (
              <div
                key={loc.locationId}
                className="surface-card"
                style={{
                  padding: "16px 20px",
                  cursor: "pointer",
                  transition: "all var(--transition-fast)",
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.borderColor = "var(--color-accent)";
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.borderColor = "var(--color-border)";
                }}
              >
                <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: "8px", marginBottom: "8px" }}>
                  <div>
                    <div style={{ fontSize: "13px", fontWeight: 500, color: "var(--color-text)" }}>
                      {loc.siteName}
                    </div>
                    <div style={{ fontSize: "12px", color: "var(--color-text-secondary)", marginTop: "2px" }}>
                      {company?.tradingName ?? company?.companyName ?? "Unknown"}
                    </div>
                  </div>
                  <StatusBadge status={loc.locationType} />
                </div>
                <div style={{ fontSize: "12px", color: "var(--color-text-muted)", marginBottom: "8px" }}>
                  {loc.address && `${loc.address}, `}
                  {loc.suburb}, {loc.state} {loc.postcode}
                </div>
                <StatusBadge status={loc.verificationStatus} showDot />
              </div>
            );
          })}
        </div>
      ) : (
        <div className="surface-card" style={{ overflow: "hidden" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "13px" }}>
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
              {filtered.map((loc) => {
                const company = companies.find((c) => c.companyId === loc.companyId);
                return (
                  <tr
                    key={loc.locationId}
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
                    <td style={{ padding: "12px 16px", fontWeight: 500 }}>{loc.siteName}</td>
                    <td style={{ padding: "12px 16px", color: "var(--color-text-secondary)" }}>
                      {company?.tradingName ?? company?.companyName ?? "--"}
                    </td>
                    <td style={{ padding: "12px 16px" }}>
                      <StatusBadge status={loc.locationType} />
                    </td>
                    <td style={{ padding: "12px 16px", color: "var(--color-text-secondary)" }}>
                      {loc.suburb}, {loc.state}
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
    </div>
  );
}
