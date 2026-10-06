"use client";

import { useState, useMemo, useEffect, useCallback } from "react";
import { Search, Mail, Phone } from "lucide-react";
import { getContacts, getCompanies } from "@/lib/api";
import type { Contact, Company } from "@/lib/types";
import { StatusBadge } from "@/components/shared/status-badge";
import { PageLoading, PageError } from "@/components/shared/page-status";
import { Pager, PAGE_SIZE } from "@/components/shared/pager";
import { useSheetAutoRefresh } from "@/lib/use-sheet-auto-refresh";
import { InfoPopover } from "@/components/shared/info-popover";
import {
  CONTACT_STATUS_FILTERS,
  filterContacts,
  type ContactStatusFilter,
} from "@/lib/contact-filters";

const priorityFilters = ["ALL", "PRIORITY", "SECONDARY", "OTHER"];

export default function ContactsPage() {
  const [priorityFilter, setPriorityFilter] = useState("ALL");
  const [statusFilter, setStatusFilter] = useState<ContactStatusFilter>("ALL");
  const [searchQuery, setSearchQuery] = useState("");
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [companies, setCompanies] = useState<Company[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (initial = false) => {
      if (initial) setLoading(true);
      setError(null);
      try {
        const [contactsData, companiesData] = await Promise.all([
          getContacts(),
          getCompanies(),
        ]);
        setContacts(contactsData);
        setCompanies(companiesData);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load contacts");
      } finally {
        if (initial) setLoading(false);
      }
  }, []);

  useEffect(() => { void load(true); }, [load]);
  useSheetAutoRefresh(() => load());

  const companyById = useMemo(
    () => new Map(companies.map((c) => [c.companyId, c])),
    [companies]
  );

  const filtered = useMemo(
    () => filterContacts(contacts, companyById, { priorityFilter, statusFilter, searchQuery }),
    [contacts, companyById, priorityFilter, statusFilter, searchQuery]
  );

  const [page, setPage] = useState(0);
  useEffect(() => {
    setPage(0);
  }, [priorityFilter, statusFilter, searchQuery]);
  const pageRows = useMemo(
    () => filtered.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE),
    [filtered, page]
  );

  return (
    <div style={{ padding: "24px" }}>
      <div className="genlead-page-heading">
        <h1 data-tour="contacts-overview" style={{ fontSize: "28px", fontWeight: 600, letterSpacing: "-0.02em" }}>
          Contacts
        </h1>
        <InfoPopover label="Contacts" text="People and contact details linked to saved companies. Verify public-source details before using them." />
      </div>

      {error && (
        <div style={{ marginBottom: "16px" }}>
          <PageError message={error} />
        </div>
      )}

      {loading && <PageLoading label="Loading contacts..." />}

      {!loading && (
      <>
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
            placeholder="Search contacts..."
            aria-label="Search contacts"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="input-field"
            style={{ paddingLeft: "36px", height: "36px" }}
          />
        </div>

        {/* Priority filter */}
        <div role="group" aria-label="Filter contacts by priority" style={{ display: "flex", gap: "4px" }}>
          {priorityFilters.map((f) => {
            const isActive = priorityFilter === f;
            return (
              <button
                key={f}
                type="button"
                aria-pressed={isActive}
                onClick={() => setPriorityFilter(f)}
                style={{
                  padding: "6px 14px",
                  fontSize: "12px",
                  fontWeight: isActive ? 500 : 400,
                  fontFamily: "var(--font-sans)",
                  color: isActive ? "var(--color-accent)" : "var(--color-text-secondary)",
                  background: isActive ? "var(--color-accent-light)" : "transparent",
                  border: "none",
                  borderRadius: "var(--radius-sm)",
                  cursor: "pointer",
                  transition: "all var(--transition-fast)",
                  minHeight: "36px",
                  minWidth: "auto",
                }}
              >
                {f === "ALL" ? "All" : f.charAt(0) + f.slice(1).toLowerCase()}
              </button>
            );
          })}
        </div>

        <label
          htmlFor="contact-status-filter"
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: "8px",
            color: "var(--color-text-secondary)",
            fontSize: "12px",
            whiteSpace: "nowrap",
          }}
        >
          Status
          <select
            id="contact-status-filter"
            value={statusFilter}
            onChange={(event) => setStatusFilter(event.target.value as ContactStatusFilter)}
            className="input-field"
            style={{ height: "36px", minWidth: "150px", padding: "0 28px 0 10px", fontSize: "12px" }}
          >
            {CONTACT_STATUS_FILTERS.map((option) => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </select>
        </label>
      </div>

      {/* Desktop table */}
      <div
        className="surface-card"
        style={{ overflow: "hidden" }}
      >
        {filtered.length === 0 ? (
          <div style={{ padding: "48px 24px", textAlign: "center" }}>
            <p style={{ fontSize: "13px", color: "var(--color-text-muted)" }}>
              {statusFilter === "APPROVED" ? "No accepted contacts match these filters" : "No contacts match these filters"}
            </p>
          </div>
        ) : (
          <table
            style={{
              width: "100%",
              borderCollapse: "collapse",
              fontSize: "13px",
            }}
          >
            <thead>
              <tr style={{ borderBottom: "1px solid var(--color-border)" }}>
                {["Name", "Company", "Position", "Priority", "Email", "Phone", "Status"].map(
                  (h) => (
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
                        whiteSpace: "nowrap",
                      }}
                    >
                      {h}
                    </th>
                  )
                )}
              </tr>
            </thead>
            <tbody>
              {pageRows.map((ct) => {
                const company = companyById.get(ct.companyId);
                return (
                  <tr
                    key={ct.contactId}
                    style={{
                      borderBottom: "1px solid var(--color-border-subtle)",
                      transition: "background var(--transition-fast)",
                    }}
                    onMouseEnter={(e) =>
                      (e.currentTarget.style.background = "var(--color-accent-light)")
                    }
                    onMouseLeave={(e) =>
                      (e.currentTarget.style.background = "transparent")
                    }
                  >
                    <td style={{ padding: "12px 16px", fontWeight: 500, color: "var(--color-text)" }}>
                      {ct.name}
                    </td>
                    <td style={{ padding: "12px 16px", color: "var(--color-text-secondary)" }}>
                      {company?.tradingName || company?.companyName || "--"}
                    </td>
                    <td style={{ padding: "12px 16px", color: "var(--color-text-secondary)" }}>
                      {ct.position ?? "--"}
                    </td>
                    <td style={{ padding: "12px 16px" }}>
                      <StatusBadge status={ct.rolePriority} />
                    </td>
                    <td style={{ padding: "12px 16px" }}>
                      {ct.businessEmail ? (
                        <a
                          href={`mailto:${ct.businessEmail}`}
                          style={{
                            display: "inline-flex",
                            alignItems: "center",
                            gap: "6px",
                            fontSize: "12px",
                            color: "var(--color-accent)",
                            textDecoration: "none",
                            minHeight: "auto",
                            minWidth: "auto",
                          }}
                        >
                          <Mail size={12} />
                          {ct.businessEmail}
                        </a>
                      ) : (
                        <span style={{ color: "var(--color-text-muted)" }}>--</span>
                      )}
                    </td>
                    <td style={{ padding: "12px 16px" }}>
                      {ct.mobile ? (
                        <a
                          href={`tel:${ct.mobile.replace(/\s/g, "")}`}
                          style={{
                            display: "inline-flex",
                            alignItems: "center",
                            gap: "6px",
                            fontSize: "12px",
                            color: "var(--color-text-secondary)",
                            textDecoration: "none",
                            minHeight: "auto",
                            minWidth: "auto",
                          }}
                        >
                          <Phone size={12} />
                          {ct.mobile}
                        </a>
                      ) : (
                        <span style={{ color: "var(--color-text-muted)" }}>--</span>
                      )}
                    </td>
                    <td style={{ padding: "12px 16px" }}>
                      <StatusBadge status={ct.contactStatus} showDot />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
        {filtered.length > 0 && (
          <Pager
            page={page}
            pageSize={PAGE_SIZE}
            total={filtered.length}
            onChange={setPage}
          />
        )}
      </div>
      </>
      )}
    </div>
  );
}
