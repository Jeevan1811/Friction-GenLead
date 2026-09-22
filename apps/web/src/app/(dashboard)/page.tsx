"use client";

import Link from "next/link";
import {
  Building2,
  MapPin,
  Users,
  AlertCircle,
  Search,
  ArrowRight,
  Clock,
  CheckCircle2,
} from "lucide-react";
import { companies, locations, contacts, searchRuns } from "@/lib/fixtures";
import { StatusBadge } from "@/components/shared/status-badge";

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
    value: companies.filter((c) => c.status === "REVIEW" || c.status === "NEW")
      .length,
    icon: AlertCircle,
    color: "var(--color-warning)",
    bg: "#FFFBEB",
  },
];

const recentActivity = [
  {
    id: "1",
    text: "CS Energy Ltd approved",
    time: "2h ago",
    icon: CheckCircle2,
    color: "var(--color-success)",
  },
  {
    id: "2",
    text: "Search completed for postcode 4680",
    time: "5h ago",
    icon: Search,
    color: "var(--color-info)",
  },
  {
    id: "3",
    text: "Stanwell Corporation moved to review",
    time: "1d ago",
    icon: AlertCircle,
    color: "var(--color-warning)",
  },
  {
    id: "4",
    text: "New search started for postcode 4715",
    time: "1d ago",
    icon: Clock,
    color: "var(--color-text-muted)",
  },
  {
    id: "5",
    text: "Aurizon Holdings rejected",
    time: "2d ago",
    icon: AlertCircle,
    color: "var(--color-error)",
  },
];

export default function DashboardPage() {
  return (
    <div style={{ padding: "24px", maxWidth: "1200px" }}>
      <div style={{ marginBottom: "24px" }}>
        <h1 style={{ fontSize: "28px", fontWeight: 600, letterSpacing: "-0.02em" }}>
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
                  {
                    companies.filter(
                      (c) => c.status === "REVIEW" || c.status === "NEW"
                    ).length
                  }{" "}
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

        {/* Recent Activity */}
        <div className="surface-card" style={{ padding: "20px" }}>
          <h3
            style={{
              fontSize: "13px",
              fontWeight: 600,
              marginBottom: "16px",
              color: "var(--color-text)",
            }}
          >
            Recent Activity
          </h3>
          <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
            {recentActivity.map((item) => {
              const Icon = item.icon;
              return (
                <div
                  key={item.id}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "12px",
                    padding: "10px 8px",
                    borderRadius: "var(--radius-sm)",
                    transition: "background var(--transition-fast)",
                  }}
                >
                  <Icon
                    size={16}
                    style={{ color: item.color, flexShrink: 0 }}
                  />
                  <span
                    style={{
                      flex: 1,
                      fontSize: "13px",
                      color: "var(--color-text)",
                    }}
                  >
                    {item.text}
                  </span>
                  <span
                    style={{
                      fontSize: "11px",
                      color: "var(--color-text-muted)",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {item.time}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
