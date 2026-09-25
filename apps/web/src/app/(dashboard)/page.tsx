"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
  Building2,
  MapPin,
  Users,
  AlertCircle,
  Search,
  ArrowRight,
  BookOpenText,
} from "lucide-react";
import { getCompanies, getLocations, getContacts } from "@/lib/api";
import type { Company, Location, Contact } from "@/lib/types";
import { PageLoading, PageError } from "@/components/shared/page-status";
import { useSheetAutoRefresh } from "@/lib/use-sheet-auto-refresh";

export default function DashboardPage() {
  const [companies, setCompanies] = useState<Company[]>([]);
  const [locations, setLocations] = useState<Location[]>([]);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (initial = false) => {
      if (initial) setLoading(true);
      setError(null);
      try {
        const [companiesData, locationsData, contactsData] = await Promise.all([
          getCompanies(),
          getLocations(),
          getContacts(),
        ]);
        setCompanies(companiesData);
        setLocations(locationsData);
        setContacts(contactsData);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load dashboard data");
      } finally {
        if (initial) setLoading(false);
      }
  }, []);

  useEffect(() => { void load(true); }, [load]);
  useSheetAutoRefresh(() => load());

  const reviewQueueCount = companies.filter(
    (c) => c.status === "REVIEW" || c.status === "NEW"
  ).length;

  const stats = [
    {
      label: "Total Companies",
      value: companies.filter((c) => c.status !== "REJECTED").length,
      icon: Building2,
      color: "var(--color-accent)",
      bg: "var(--color-accent-light)",
    },
    {
      label: "Verified Locations",
      value: locations.filter((l) => l.verificationStatus === "VERIFIED").length,
      icon: MapPin,
      color: "var(--color-success)",
      bg: "#F0FDF4",
    },
    {
      label: "Active Contacts",
      value: contacts.filter(
        (c) => c.contactStatus !== "STALE" && c.contactStatus !== "LEFT_COMPANY"
      ).length,
      icon: Users,
      color: "var(--color-info)",
      bg: "#EFF6FF",
    },
    {
      label: "Pending Reviews",
      value: reviewQueueCount,
      icon: AlertCircle,
      color: "var(--color-warning)",
      bg: "#FFFBEB",
    },
  ];

  return (
    <div style={{ padding: "24px", maxWidth: "1200px" }}>
      <div style={{ marginBottom: "24px" }}>
        <h1 data-tour="dashboard-overview" style={{ fontSize: "28px", fontWeight: 600, letterSpacing: "-0.02em" }}>
          Dashboard
        </h1>
        <p
          style={{
            fontSize: "13px",
            color: "var(--color-text-secondary)",
            marginTop: "4px",
          }}
        >
          Overview of your Queensland prospect pipeline
        </p>
      </div>

      {error && (
        <div style={{ marginBottom: "24px" }}>
          <PageError message={error} />
        </div>
      )}

      {loading ? (
        <PageLoading label="Loading dashboard..." />
      ) : (
        <>
      {/* Stat cards */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
          gap: "16px",
          marginBottom: "32px",
        }}
      >
        {stats.map((stat) => {
          const Icon = stat.icon;
          return (
            <div
              key={stat.label}
              className="surface-card"
              style={{
                padding: "20px",
                display: "flex",
                alignItems: "flex-start",
                gap: "16px",
              }}
            >
              <div
                style={{
                  width: 40,
                  height: 40,
                  borderRadius: "var(--radius-md)",
                  background: stat.bg,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  flexShrink: 0,
                }}
              >
                <Icon size={20} style={{ color: stat.color }} />
              </div>
              <div>
                <div
                  style={{
                    fontSize: "11px",
                    fontWeight: 500,
                    color: "var(--color-text-muted)",
                    textTransform: "uppercase",
                    letterSpacing: "0.04em",
                    marginBottom: "4px",
                  }}
                >
                  {stat.label}
                </div>
                <div
                  style={{
                    fontSize: "28px",
                    fontWeight: 600,
                    color: "var(--color-text)",
                    lineHeight: 1,
                  }}
                >
                  {stat.value}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Two-column layout */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 1fr",
          gap: "24px",
        }}
      >
        {/* Quick Actions */}
        <div className="surface-card" style={{ padding: "20px" }}>
          <h3
            style={{
              fontSize: "13px",
              fontWeight: 600,
              marginBottom: "16px",
              color: "var(--color-text)",
            }}
          >
            Quick Actions
          </h3>
          <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
            <Link
              href="/search"
              style={{
                display: "flex",
                alignItems: "center",
                gap: "12px",
                padding: "12px",
                borderRadius: "var(--radius-sm)",
                border: "1px solid var(--color-border)",
                textDecoration: "none",
                color: "var(--color-text)",
                transition: "all var(--transition-fast)",
                minHeight: "44px",
                minWidth: "auto",
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.borderColor = "var(--color-accent)";
                e.currentTarget.style.background = "var(--color-accent-light)";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.borderColor = "var(--color-border)";
                e.currentTarget.style.background = "transparent";
              }}
            >
              <div
                style={{
                  width: 36,
                  height: 36,
                  borderRadius: "var(--radius-sm)",
                  background: "var(--color-accent-light)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  flexShrink: 0,
                }}
              >
                <Search size={16} style={{ color: "var(--color-accent)" }} />
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: "13px", fontWeight: 500 }}>
                  New Search
                </div>
                <div
                  style={{
                    fontSize: "11px",
                    color: "var(--color-text-muted)",
                  }}
                >
                  Start prospecting a new postcode
                </div>
              </div>
              <ArrowRight
                size={16}
                style={{ color: "var(--color-text-muted)" }}
              />
            </Link>

            <Link
              href="/companies?tab=review"
              style={{
                display: "flex",
                alignItems: "center",
                gap: "12px",
                padding: "12px",
                borderRadius: "var(--radius-sm)",
                border: "1px solid var(--color-border)",
                textDecoration: "none",
                color: "var(--color-text)",
                transition: "all var(--transition-fast)",
                minHeight: "44px",
                minWidth: "auto",
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.borderColor = "var(--color-accent)";
                e.currentTarget.style.background = "var(--color-accent-light)";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.borderColor = "var(--color-border)";
                e.currentTarget.style.background = "transparent";
              }}
            >
              <div
                style={{
                  width: 36,
                  height: 36,
                  borderRadius: "var(--radius-sm)",
                  background: "#FFFBEB",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  flexShrink: 0,
                }}
              >
                <AlertCircle
                  size={16}
                  style={{ color: "var(--color-warning)" }}
                />
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: "13px", fontWeight: 500 }}>
                  Review Queue
                </div>
                <div
                  style={{
                    fontSize: "11px",
                    color: "var(--color-text-muted)",
                  }}
                >
                  {reviewQueueCount}{" "}
                  companies need attention
                </div>
              </div>
              <ArrowRight
                size={16}
                style={{ color: "var(--color-text-muted)" }}
              />
            </Link>
          </div>
        </div>

        {/* Honest next step; the old activity list was hard-coded demo content. */}
        <div className="surface-card" style={{ padding: "20px" }}>
          <h3
            style={{
              fontSize: "13px",
              fontWeight: 600,
              marginBottom: "16px",
              color: "var(--color-text)",
            }}
          >
            A useful next step
          </h3>
          <div style={{ display: "flex", alignItems: "flex-start", gap: "12px" }}>
            <BookOpenText size={18} style={{ color: "var(--color-accent)", flexShrink: 0, marginTop: 2 }} />
            <div>
              <p style={{ fontSize: "13px", color: "var(--color-text-secondary)", marginBottom: "12px" }}>
                Review the imported company records first. Postcode research and new-contact discovery are still in sample mode, so their examples are not real prospects.
              </p>
              <Link
                href="/settings"
                style={{ color: "var(--color-accent)", fontSize: "13px", fontWeight: 600, textDecoration: "none" }}
              >
                Open the dashboard guide <ArrowRight size={14} style={{ verticalAlign: "-2px", marginLeft: 4 }} />
              </Link>
            </div>
          </div>
        </div>
      </div>
        </>
      )}
    </div>
  );
}
