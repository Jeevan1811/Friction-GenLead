"use client";

import { useState, useMemo, useEffect } from "react";
import { Search, Mail, Phone } from "lucide-react";
import { getContacts, getCompanies } from "@/lib/api";
import type { Contact, Company } from "@/lib/types";
import { StatusBadge } from "@/components/shared/status-badge";
import { PageLoading, PageError } from "@/components/shared/page-status";

const priorityFilters = ["ALL", "PRIORITY", "SECONDARY", "OTHER"];

export default function ContactsPage() {
  const [priorityFilter, setPriorityFilter] = useState("ALL");
  const [searchQuery, setSearchQuery] = useState("");
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [companies, setCompanies] = useState<Company[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const [contactsData, companiesData] = await Promise.all([
          getContacts(),
          getCompanies(),
        ]);
        if (cancelled) return;
        setContacts(contactsData);
        setCompanies(companiesData);
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : "Failed to load contacts");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, []);

  const filtered = useMemo(() => {
    return contacts.filter((ct) => {
      if (priorityFilter !== "ALL" && ct.rolePriority !== priorityFilter) return false;
      if (searchQuery) {
        const q = searchQuery.toLowerCase();
        const company = companies.find((c) => c.companyId === ct.companyId);
        return (
          ct.name.toLowerCase().includes(q) ||
          ct.position?.toLowerCase().includes(q) ||
          company?.companyName.toLowerCase().includes(q) ||
          ct.businessEmail?.toLowerCase().includes(q)
        );
      }
      return true;
    });
  }, [contacts, companies, priorityFilter, searchQuery]);

  return (
    <div style={{ padding: "24px" }}>
      <div style={{ marginBottom: "24px" }}>
        <h1 style={{ fontSize: "28px", fontWeight: 600, letterSpacing: "-0.02em" }}>
          Contacts
        </h1>
        <p style={{ fontSize: "13px", color: "var(--color-text-secondary)", marginTop: "4px" }}>
          Discovered contacts across prospect companies
        </p>
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
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="input-field"
            style={{ paddingLeft: "36px", height: "36px" }}
          />
        </div>

        {/* Priority filter */}
        <div style={{ display: "flex", gap: "4px" }}>
          {priorityFilters.map((f) => {
            const isActive = priorityFilter === f;
            return (
              <button
                key={f}
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
      </div>

      {/* Desktop table */}
      <div
        className="surface-card"
        style={{ overflow: "hidden" }}
      >
        {filtered.length === 0 ? (
          <div style={{ padding: "48px 24px", textAlign: "center" }}>
            <p style={{ fontSize: "13px", color: "var(--color-text-muted)" }}>
              No contacts match this filter
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
              {filtered.map((ct) => {
                const company = companies.find(
                  (c) => c.companyId === ct.companyId
                );
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
                      {company?.tradingName ?? company?.companyName ?? "--"}
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
      </div>
      </>
      )}
    </div>
  );
}
