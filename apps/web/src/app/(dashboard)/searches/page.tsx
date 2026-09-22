"use client";

import { Building2, Users, Clock, CheckCircle2, XCircle, Loader2 } from "lucide-react";
import { searchRuns } from "@/lib/fixtures";
import { StatusBadge } from "@/components/shared/status-badge";

const statusConfig: Record<
  string,
  { icon: typeof Clock; color: string; badgeStatus: string }
> = {
  running: { icon: Loader2, color: "var(--color-warning)", badgeStatus: "VERIFYING" },
  completed: { icon: CheckCircle2, color: "var(--color-success)", badgeStatus: "APPROVED" },
  failed: { icon: XCircle, color: "var(--color-error)", badgeStatus: "ERROR" },
  cancelled: { icon: Clock, color: "var(--color-text-muted)", badgeStatus: "STALE" },
};

export default function SearchesPage() {
  const formatDate = (iso: string) => {
    const d = new Date(iso);
    return d.toLocaleDateString("en-AU", {
      day: "numeric",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  const formatDuration = (start: string, end?: string) => {
    if (!end) return "In progress...";
    const ms = new Date(end).getTime() - new Date(start).getTime();
    const mins = Math.floor(ms / 60000);
    const secs = Math.floor((ms % 60000) / 1000);
    if (mins === 0) return `${secs}s`;
    return `${mins}m ${secs}s`;
  };

  return (
    <div style={{ padding: "24px", maxWidth: "900px" }}>
      <div style={{ marginBottom: "24px" }}>
        <h1 style={{ fontSize: "28px", fontWeight: 600, letterSpacing: "-0.02em" }}>
          Search History
        </h1>
        <p style={{ fontSize: "13px", color: "var(--color-text-secondary)", marginTop: "4px" }}>
          Past and active prospect research runs
        </p>
      </div>

      {searchRuns.length === 0 ? (
        <div
          className="surface-card"
          style={{ padding: "48px 24px", textAlign: "center" }}
        >
          <Clock size={32} style={{ color: "var(--color-text-muted)", marginBottom: "12px" }} />
          <p style={{ fontSize: "13px", color: "var(--color-text-muted)" }}>
            No searches yet
          </p>
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
          {searchRuns.map((run) => {
            const config = statusConfig[run.status] ?? statusConfig.cancelled;
            const StatusIcon = config.icon;
            const isRunning = run.status === "running";

            return (
              <div
                key={run.searchId}
                className="surface-card"
                style={{
                  padding: "20px",
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
                <div
                  style={{
                    display: "flex",
                    alignItems: "flex-start",
                    gap: "16px",
                  }}
                >
                  {/* Status icon */}
                  <div
                    style={{
                      width: 40,
                      height: 40,
                      borderRadius: "var(--radius-md)",
                      background: isRunning ? "#FFFBEB" : config.color === "var(--color-success)" ? "#F0FDF4" : config.color === "var(--color-error)" ? "#FEF2F2" : "var(--color-bg)",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      flexShrink: 0,
                    }}
                  >
                    <StatusIcon
                      size={20}
                      style={{
                        color: config.color,
                        animation: isRunning ? "spin 1.5s linear infinite" : "none",
                      }}
                    />
                  </div>

                  {/* Details */}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: "8px",
                        marginBottom: "4px",
                        flexWrap: "wrap",
                      }}
                    >
                      <span style={{ fontSize: "14px", fontWeight: 500, color: "var(--color-text)" }}>
                        Postcode {run.postcode}
                      </span>
                      {run.industry && (
                        <span
                          style={{
                            fontSize: "11px",
                            padding: "2px 8px",
                            borderRadius: "var(--radius-pill)",
                            background: "var(--color-bg)",
                            color: "var(--color-text-secondary)",
                          }}
                        >
                          {run.industry}
                        </span>
                      )}
                      <StatusBadge status={config.badgeStatus} showDot />
                    </div>

                    <div style={{ fontSize: "12px", color: "var(--color-text-muted)", marginBottom: "8px" }}>
                      Started {formatDate(run.startedAt)}
                      {" · "}
                      {formatDuration(run.startedAt, run.completedAt)}
                    </div>

                    {/* Roles */}
                    <div style={{ display: "flex", flexWrap: "wrap", gap: "4px", marginBottom: "8px" }}>
                      {run.roles.map((role) => (
                        <span
                          key={role}
                          style={{
                            fontSize: "11px",
                            padding: "2px 8px",
                            borderRadius: "var(--radius-pill)",
                            border: "1px solid var(--color-border)",
                            color: "var(--color-text-secondary)",
                          }}
                        >
                          {role}
                        </span>
                      ))}
                    </div>

                    {/* Results */}
                    <div style={{ display: "flex", gap: "16px" }}>
                      <div
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: "6px",
                          fontSize: "12px",
                          color: "var(--color-text-secondary)",
                        }}
                      >
                        <Building2 size={14} />
                        {run.companiesFound} companies
                      </div>
                      <div
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: "6px",
                          fontSize: "12px",
                          color: "var(--color-text-secondary)",
                        }}
                      >
                        <Users size={14} />
                        {run.contactsFound} contacts
                      </div>
                    </div>
                  </div>
                </div>

                {/* Progress bar for running searches */}
                {isRunning && (
                  <div
                    style={{
                      marginTop: "16px",
                      height: 3,
                      borderRadius: 2,
                      background: "var(--color-border)",
                      overflow: "hidden",
                    }}
                  >
                    <div
                      style={{
                        width: "60%",
                        height: "100%",
                        borderRadius: 2,
                        background: "var(--color-warning)",
                        animation: "progress 2s ease-in-out infinite",
                      }}
                    />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      <style>{`
        @keyframes spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
        @keyframes progress {
          0% { width: 20%; margin-left: 0; }
          50% { width: 60%; margin-left: 20%; }
          100% { width: 20%; margin-left: 80%; }
        }
      `}</style>
    </div>
  );
}
