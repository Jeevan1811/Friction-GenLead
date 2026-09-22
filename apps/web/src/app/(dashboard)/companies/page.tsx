"use client";

import { useState, useMemo } from "react";
import { Search, ChevronDown, ChevronUp, ArrowUpDown, Loader2 } from "lucide-react";
import {
  companies as initialCompanies,
  locations,
  contacts,
  getBestContact,
  getLocationForCompany,
  type Company,
  type Contact,
} from "@/lib/fixtures";
import { StatusBadge } from "@/components/shared/status-badge";
import { DetailDrawer } from "@/components/shared/detail-drawer";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { useToast } from "@/components/ui/toast";
import { verifyCompany } from "@/lib/api";

type Tab = "all" | "new" | "review" | "approved" | "stale" | "no-contact" | "rejected";

const tabs: { key: Tab; label: string; filter: (c: Company) => boolean }[] = [
  { key: "all", label: "All", filter: () => true },
  { key: "new", label: "New", filter: (c) => c.status === "NEW" },
  { key: "review", label: "Needs Review", filter: (c) => c.status === "REVIEW" || c.status === "VERIFYING" },
  { key: "approved", label: "Approved", filter: (c) => c.status === "APPROVED" },
  { key: "stale", label: "Stale", filter: (c) => c.status === "STALE" },
  {
    key: "no-contact",
    label: "No Contact",
    filter: (c) => contacts.filter((ct) => ct.companyId === c.companyId).length === 0,
  },
  { key: "rejected", label: "Rejected", filter: (c) => c.status === "REJECTED" },
];

type SortKey = "companyName" | "status" | "postcode";

export default function CompaniesPage() {
  const [activeTab, setActiveTab] = useState<Tab>("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("companyName");
  const [sortAsc, setSortAsc] = useState(true);
  const [selectedCompanyId, setSelectedCompanyId] = useState<string | null>(null);
  const [companies, setCompanies] = useState<Company[]>(initialCompanies);
  const [actionLoading, setActionLoading] = useState(false);
  const [rejectDialogOpen, setRejectDialogOpen] = useState(false);
  const [rejectReason, setRejectReason] = useState("");
  const { toast } = useToast();

  const tabDef = tabs.find((t) => t.key === activeTab)!;

  const filtered = useMemo(() => {
    let result = companies.filter(tabDef.filter);
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      result = result.filter(
        (c) =>
          c.companyName.toLowerCase().includes(q) ||
          c.normalizedName.includes(q) ||
          (c.tradingName && c.tradingName.toLowerCase().includes(q))
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
  }, [activeTab, searchQuery, sortKey, sortAsc, tabDef, companies]);

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
    ? locations.filter((l) => l.companyId === selectedCompanyId)
    : [];
  const selectedContacts = selectedCompanyId
    ? contacts.filter((c) => c.companyId === selectedCompanyId)
    : [];

  return (
    <div style={{ padding: "24px" }}>
      <div style={{ marginBottom: "24px" }}>
        <h1 style={{ fontSize: "28px", fontWeight: 600, letterSpacing: "-0.02em" }}>
          Companies
        </h1>
        <p style={{ fontSize: "13px", color: "var(--color-text-secondary)", marginTop: "4px" }}>
          Manage and review discovered companies
        </p>
      </div>

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
              {filtered.map((company) => {
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
                        {company.tradingName ?? company.companyName}
                      </div>
                      <div style={{ fontSize: "11px", color: "var(--color-text-muted)", marginTop: "1px" }}>
                        ABN {company.abn}
                      </div>
                    </td>
                    <td style={{ padding: "12px 16px" }}>
                      {loc ? (
                        <div>
                          <div style={{ color: "var(--color-text-secondary)" }}>
                            {loc.siteName}
                          </div>
                          <div style={{ fontSize: "11px", color: "var(--color-text-muted)" }}>
                            {loc.suburb}, {loc.postcode}
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
        </div>
      )}

      {/* Detail drawer */}
      <DetailDrawer
        open={!!selectedCompany}
        onClose={() => setSelectedCompanyId(null)}
        title={selectedCompany?.tradingName ?? selectedCompany?.companyName ?? ""}
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
            </div>

            {/* Locations */}
            <div>
              <div className="text-label" style={{ marginBottom: "8px" }}>
                Locations ({selectedLocs.length})
              </div>
              {selectedLocs.map((loc) => (
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
                  <div style={{ marginTop: "4px" }}>
                    <StatusBadge status={loc.verificationStatus} showDot />
                  </div>
                </div>
              ))}
            </div>

            {/* Contacts */}
            <div>
              <div className="text-label" style={{ marginBottom: "8px" }}>
                Contacts ({selectedContacts.length})
              </div>
              {selectedContacts.map((ct) => (
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
                  <div style={{ marginTop: "4px" }}>
                    <StatusBadge status={ct.contactStatus} showDot />
                  </div>
                </div>
              ))}
            </div>

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
                      await verifyCompany(
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
                            ? { ...c, status: "APPROVED", lastVerified: new Date().toISOString() }
                            : c
                        )
                      );
                      toast("Company approved", "success");
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
                    setRejectDialogOpen(true);
                  }}
                >
                  Reject
                </button>
              )}
            </div>
          </div>
        )}
      </DetailDrawer>

      {/* Reject confirmation dialog */}
      <ConfirmDialog
        open={rejectDialogOpen}
        title="Reject Company"
        description="Are you sure you want to reject this company? Please provide a reason."
        confirmLabel="Reject"
        cancelLabel="Cancel"
        destructive
        onCancel={() => setRejectDialogOpen(false)}
        onConfirm={async () => {
          if (!selectedCompany) return;
          setRejectDialogOpen(false);
          setActionLoading(true);
          try {
            await verifyCompany(
              {
                companyId: selectedCompany.companyId,
                abn: selectedCompany.abn,
                companyName: selectedCompany.companyName,
              },
              "reject",
              rejectReason || "Rejected by user"
            );
            setCompanies((prev) =>
              prev.map((c) =>
                c.companyId === selectedCompany.companyId
                  ? { ...c, status: "REJECTED" }
                  : c
              )
            );
            toast("Company rejected", "success");
          } catch (err) {
            const msg =
              err instanceof Error
                ? err.message
                : "Failed to reject company";
            toast(msg, "error");
          } finally {
            setActionLoading(false);
          }
        }}
      />
    </div>
  );
}
