"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Building2, Users, Clock, CheckCircle2, XCircle, Loader2 } from "lucide-react";
import { getJobs } from "@/lib/api";
import type { JobRun } from "@/lib/types";
import { StatusBadge } from "@/components/shared/status-badge";
import { PageLoading, PageError } from "@/components/shared/page-status";
import { SampleDataNotice } from "@/components/shared/sample-data-notice";
import { useSheetAutoRefresh } from "@/lib/use-sheet-auto-refresh";
import { buildResearchRunCompaniesHref } from "@/lib/research-run-results";

const statusConfig: Record<
  string,
  { icon: typeof Clock; color: string; badgeStatus: string }
> = {
  running: { icon: Loader2, color: "var(--color-warning)", badgeStatus: "VERIFYING" },
  completed: { icon: CheckCircle2, color: "var(--color-success)", badgeStatus: "COMPLETED" },
  failed: { icon: XCircle, color: "var(--color-error)", badgeStatus: "ERROR" },
  cancelled: { icon: Clock, color: "var(--color-text-muted)", badgeStatus: "STALE" },
  interrupted: { icon: Clock, color: "var(--color-text-muted)", badgeStatus: "STALE" },
};

export default function SearchesPage() {
  const [searchRuns, setSearchRuns] = useState<JobRun[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (initial = false) => {
      if (initial) setLoading(true);
      setError(null);
      try {
        const data = await getJobs();
        setSearchRuns(data);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load search history");
      } finally {
        if (initial) setLoading(false);
      }
  }, []);

  useEffect(() => { void load(true); }, [load]);
  useSheetAutoRefresh(() => load());

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

  return (
    <div style={{ padding: "24px", maxWidth: "900px" }}>
      <div style={{ marginBottom: "24px" }}>
        <h1 data-tour="searches-overview" style={{ fontSize: "28px", fontWeight: 600, letterSpacing: "-0.02em" }}>
          Search History
        </h1>
        <p style={{ fontSize: "13px", color: "var(--color-text-secondary)", marginTop: "4px" }}>
          Saved searches
        </p>
      </div>

      <SampleDataNotice />

      {error && (
        <div style={{ marginBottom: "16px" }}>
          <PageError message={error} />
        </div>
      )}

      {loading ? (
        <PageLoading label="Loading search history..." />
      ) : searchRuns.length === 0 ? (
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
                key={run.jobId}
                className="surface-card"
                style={{
                  padding: "20px",
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
                        Location: {run.location || run.postcode || "Location not recorded"}
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
                      Started {formatDate(run.createdAt)}
                    </div>

                    {run.errorSummary && (
                      <p style={{ margin: "0 0 8px", color: "var(--color-error)", fontSize: "12px" }}>{run.errorSummary}</p>
                    )}

                    {/* Counts link to the saved cohort when detail rows are available. */}
                    <div style={{ display: "flex", gap: "16px" }}>
                      {run.status !== "running" && run.companiesFound > 0 ? (
                        <Link
                          href={buildResearchRunCompaniesHref(run.jobId)}
                          aria-label={`View ${run.companiesFound} companies from ${run.location || run.postcode}`}
                          style={{
                            display: "flex",
                            alignItems: "center",
                            gap: "6px",
                            minHeight: "40px",
                            fontSize: "12px",
                            color: "var(--color-accent)",
                            textDecoration: "underline",
                            textUnderlineOffset: "3px",
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
                            gap: "6px",
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

                {/* No estimated percentage: the backend does not report real progress. */}
                {isRunning && (
                  <p style={{ margin: "14px 0 0", fontSize: "11px", color: "var(--color-text-muted)" }}>
                    Research is still running. Status updates when the service records a step.
                  </p>
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
      `}</style>
    </div>
  );
}
