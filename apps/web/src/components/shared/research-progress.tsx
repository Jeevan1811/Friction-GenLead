"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import {
  Search,
  ShieldCheck,
  Users,
  BarChart3,
  Check,
  AlertTriangle,
  Loader2,
  Circle,
  Building2,
} from "lucide-react";
import { getResearchStatus } from "@/lib/api";

interface ResearchStep {
  name: string;
  status: string;
  result: unknown;
  error: string | null;
}

interface ResearchStatusData {
  job_id: string;
  status: string;
  companies_found: number;
  contacts_found: number;
  steps: ResearchStep[];
  warnings: string[];
}

interface ResearchProgressProps {
  jobId: string;
  onComplete: (data: ResearchStatusData) => void;
}

const STEP_META: Record<
  string,
  { icon: typeof Search; label: string }
> = {
  discover: { icon: Search, label: "Discover" },
  verify: { icon: ShieldCheck, label: "Verify" },
  research_contacts: { icon: Users, label: "Research Contacts" },
  evaluate: { icon: BarChart3, label: "Evaluate" },
};

const DEFAULT_STEPS = ["discover", "verify", "research_contacts", "evaluate"];

function StepIcon({ status }: { status: string }) {
  if (status === "completed") {
    return (
      <div
        style={{
          width: 28,
          height: 28,
          borderRadius: "50%",
          background: "#16A34A",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          flexShrink: 0,
        }}
      >
        <Check size={14} color="#FFFFFF" />
      </div>
    );
  }
  if (status === "running") {
    return (
      <div
        style={{
          width: 28,
          height: 28,
          borderRadius: "50%",
          background: "var(--color-accent)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          flexShrink: 0,
          animation: "pulse-ring 1.5s ease-in-out infinite",
        }}
      >
        <Loader2
          size={14}
          color="#FFFFFF"
          style={{ animation: "spin 1s linear infinite" }}
        />
      </div>
    );
  }
  if (status === "failed") {
    return (
      <div
        style={{
          width: 28,
          height: 28,
          borderRadius: "50%",
          background: "#D97706",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          flexShrink: 0,
        }}
      >
        <AlertTriangle size={14} color="#FFFFFF" />
      </div>
    );
  }
  /* pending */
  return (
    <div
      style={{
        width: 28,
        height: 28,
        borderRadius: "50%",
        border: "2px solid var(--color-border)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        flexShrink: 0,
      }}
    >
      <Circle size={8} style={{ color: "var(--color-border)" }} />
    </div>
  );
}

export function ResearchProgress({ jobId, onComplete }: ResearchProgressProps) {
  const [data, setData] = useState<ResearchStatusData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const onCompleteRef = useRef(onComplete);
  onCompleteRef.current = onComplete;

  const stopPolling = useCallback(() => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
  }, []);

  useEffect(() => {
    let active = true;

    const poll = async () => {
      try {
        const res = await getResearchStatus(jobId);
        if (!active) return;
        setData(res);
        setError(null);

        if (
          res.status === "completed" ||
          res.status === "failed" ||
          res.status === "cancelled"
        ) {
          stopPolling();
          if (res.status === "completed") {
            onCompleteRef.current(res);
          }
        }
      } catch (err) {
        if (!active) return;
        setError(
          err instanceof Error ? err.message : "Failed to fetch status"
        );
      }
    };

    /* Initial fetch */
    poll();

    /* Poll every 3 seconds */
    intervalRef.current = setInterval(poll, 3000);

    return () => {
      active = false;
      stopPolling();
    };
  }, [jobId, stopPolling]);

  const steps = data?.steps ?? DEFAULT_STEPS.map((name) => ({
    name,
    status: "pending",
    result: null,
    error: null,
  }));

  const completedCount = steps.filter((s) => s.status === "completed").length;
  const progress = (completedCount / steps.length) * 100;

  return (
    <div
      className="surface-card"
      style={{ padding: "24px", marginBottom: "32px" }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: "20px",
        }}
      >
        <div>
          <div
            style={{
              fontSize: "14px",
              fontWeight: 600,
              color: "var(--color-text)",
            }}
          >
            Research Progress
          </div>
          <div
            style={{
              fontSize: "12px",
              color: "var(--color-text-muted)",
              marginTop: "2px",
            }}
          >
            Job {jobId.slice(0, 8)}...
          </div>
        </div>
        {data?.status && (
          <span
            style={{
              fontSize: "11px",
              fontWeight: 500,
              padding: "3px 10px",
              borderRadius: "var(--radius-pill)",
              background:
                data.status === "completed"
                  ? "#F0FDF4"
                  : data.status === "failed"
                    ? "#FFFBEB"
                    : "var(--color-accent-light)",
              color:
                data.status === "completed"
                  ? "#166534"
                  : data.status === "failed"
                    ? "#92400E"
                    : "var(--color-accent)",
              textTransform: "uppercase",
              letterSpacing: "0.04em",
            }}
          >
            {data.status}
          </span>
        )}
      </div>

      {/* Progress bar */}
      <div
        style={{
          height: 4,
          borderRadius: 2,
          background: "var(--color-border-subtle)",
          marginBottom: "24px",
          overflow: "hidden",
        }}
      >
        <div
          style={{
            height: "100%",
            width: `${progress}%`,
            borderRadius: 2,
            background: "var(--color-accent)",
            transition: "width 300ms ease-out",
          }}
        />
      </div>

      {/* Steps timeline */}
      <div style={{ display: "flex", flexDirection: "column", gap: "0" }}>
        {steps.map((step, i) => {
          const meta = STEP_META[step.name] ?? {
            icon: Circle,
            label: step.name,
          };
          const Icon = meta.icon;
          const isLast = i === steps.length - 1;

          return (
            <div
              key={step.name}
              style={{
                display: "flex",
                gap: "14px",
              }}
            >
              {/* Vertical line + icon */}
              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                }}
              >
                <StepIcon status={step.status} />
                {!isLast && (
                  <div
                    style={{
                      width: 2,
                      flex: 1,
                      minHeight: 24,
                      background:
                        step.status === "completed"
                          ? "#16A34A"
                          : "var(--color-border-subtle)",
                      transition: "background 300ms ease-out",
                    }}
                  />
                )}
              </div>

              {/* Content */}
              <div
                style={{
                  flex: 1,
                  paddingBottom: isLast ? 0 : "16px",
                }}
              >
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "8px",
                    marginBottom: "2px",
                  }}
                >
                  <Icon
                    size={14}
                    style={{
                      color:
                        step.status === "running"
                          ? "var(--color-accent)"
                          : step.status === "completed"
                            ? "#16A34A"
                            : "var(--color-text-muted)",
                    }}
                  />
                  <span
                    style={{
                      fontSize: "13px",
                      fontWeight:
                        step.status === "running" ? 600 : 500,
                      color:
                        step.status === "pending"
                          ? "var(--color-text-muted)"
                          : "var(--color-text)",
                    }}
                  >
                    {meta.label}
                  </span>
                </div>
                {step.status === "completed" &&
                  step.result != null && (
                    <div
                      style={{
                        fontSize: "12px",
                        color: "var(--color-text-secondary)",
                        marginTop: "2px",
                      }}
                    >
                      {typeof step.result === "object"
                        ? JSON.stringify(step.result)
                        : String(step.result)}
                    </div>
                  )}
                {step.status === "failed" && step.error && (
                  <div
                    style={{
                      fontSize: "12px",
                      color: "#D97706",
                      marginTop: "2px",
                    }}
                  >
                    {step.error}
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Summary counts */}
      {data && (data.companies_found > 0 || data.contacts_found > 0) && (
        <div
          style={{
            display: "flex",
            gap: "24px",
            marginTop: "20px",
            paddingTop: "16px",
            borderTop: "1px solid var(--color-border-subtle)",
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: "6px",
              fontSize: "13px",
              color: "var(--color-text-secondary)",
            }}
          >
            <Building2 size={16} style={{ color: "var(--color-accent)" }} />
            <span style={{ fontWeight: 600 }}>{data.companies_found}</span>
            companies
          </div>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: "6px",
              fontSize: "13px",
              color: "var(--color-text-secondary)",
            }}
          >
            <Users size={16} style={{ color: "var(--color-accent)" }} />
            <span style={{ fontWeight: 600 }}>{data.contacts_found}</span>
            contacts
          </div>
        </div>
      )}

      {/* Warnings */}
      {data?.warnings && data.warnings.length > 0 && (
        <div
          style={{
            marginTop: "16px",
            padding: "10px 12px",
            borderRadius: "var(--radius-sm)",
            background: "#FFFBEB",
            border: "1px solid #FDE68A",
          }}
        >
          {data.warnings.map((w, i) => (
            <div
              key={i}
              style={{
                display: "flex",
                alignItems: "flex-start",
                gap: "6px",
                fontSize: "12px",
                color: "#92400E",
                lineHeight: 1.4,
                marginBottom: i < data.warnings.length - 1 ? "4px" : 0,
              }}
            >
              <AlertTriangle
                size={12}
                style={{ flexShrink: 0, marginTop: "2px" }}
              />
              {w}
            </div>
          ))}
        </div>
      )}

      {/* Error */}
      {error && (
        <div
          style={{
            marginTop: "16px",
            padding: "10px 12px",
            borderRadius: "var(--radius-sm)",
            background: "#FEF2F2",
            border: "1px solid #FECACA",
            fontSize: "12px",
            color: "#991B1B",
          }}
        >
          {error}
        </div>
      )}
    </div>
  );
}

/* Inject keyframes */
if (typeof document !== "undefined") {
  const STYLE_ID = "research-progress-style";
  if (!document.getElementById(STYLE_ID)) {
    const style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = `
      @keyframes pulse-ring {
        0%   { box-shadow: 0 0 0 0 rgba(200, 55, 45, 0.4); }
        70%  { box-shadow: 0 0 0 8px rgba(200, 55, 45, 0); }
        100% { box-shadow: 0 0 0 0 rgba(200, 55, 45, 0); }
      }
      @keyframes spin {
        from { transform: rotate(0deg); }
        to   { transform: rotate(360deg); }
      }
    `;
    document.head.appendChild(style);
  }
}
