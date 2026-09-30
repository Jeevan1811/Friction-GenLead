"use client";

import { useState, useEffect, useRef } from "react";
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
import { ApiRequestError, getResearchStatus } from "@/lib/api";
import {
  advanceResearchPollState,
  createResearchPollState,
  RESEARCH_POLL_INTERVAL_MS,
  stopResearchPollState,
} from "@/lib/research-polling.mjs";

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
  known_companies_found?: number;
  known_matches_available?: boolean;
  contacts_found: number;
  steps: ResearchStep[];
  warnings: string[];
  errors?: string[];
}

interface ResearchProgressProps {
  jobId: string;
  onComplete: (data: ResearchStatusData) => void;
  onTerminal?: (data: ResearchStatusData) => void;
  onMonitoringStopped?: () => void;
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

export function ResearchProgress({
  jobId,
  onComplete,
  onTerminal,
  onMonitoringStopped,
}: ResearchProgressProps) {
  const [data, setData] = useState<ResearchStatusData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const [monitoringStopped, setMonitoringStopped] = useState(false);
  const retryNowRef = useRef<(() => void) | null>(null);
  const onCompleteRef = useRef(onComplete);
  const onTerminalRef = useRef(onTerminal);
  const onMonitoringStoppedRef = useRef(onMonitoringStopped);
  onCompleteRef.current = onComplete;
  onTerminalRef.current = onTerminal;
  onMonitoringStoppedRef.current = onMonitoringStopped;

  useEffect(() => {
    let active = true;
    let inFlight = false;
    let completionNotified = false;
    let pollState = createResearchPollState();
    let timer: ReturnType<typeof setTimeout> | null = null;
    let requestController: AbortController | null = null;
    setData(null);
    setError(null);
    setMonitoringStopped(false);

    const schedule = (delayMs: number) => {
      if (!active || pollState.terminal) return;
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => void poll(), delayMs);
    };

    const poll = async () => {
      if (!active || inFlight || pollState.terminal) return;
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
      inFlight = true;
      requestController = new AbortController();
      setChecking(true);
      try {
        const res = await getResearchStatus(jobId, requestController.signal);
        if (!active) return;
        setData(res);
        setError(null);
        pollState = advanceResearchPollState(pollState, {
          type: "status",
          status: res.status,
        });

        if (pollState.terminal) {
          onTerminalRef.current?.(res);
          if (res.status === "completed" && !completionNotified) {
            completionNotified = true;
            onCompleteRef.current(res);
          }
        } else {
          schedule(RESEARCH_POLL_INTERVAL_MS);
        }
      } catch (err) {
        if (!active) return;
        if (err instanceof ApiRequestError && err.status === 404) {
          pollState = stopResearchPollState(pollState);
          setMonitoringStopped(true);
          setError(
            `${err.message} This search is no longer available. Check Recent Searches and Companies before starting a replacement.`
          );
          onMonitoringStoppedRef.current?.();
          return;
        }
        pollState = advanceResearchPollState(pollState, { type: "error" });
        const message = err instanceof Error ? err.message : "Could not refresh search progress.";
        setError(
          `${message} Keeping the last progress and retrying in ${Math.ceil(pollState.delayMs / 1000)} seconds.`
        );
        schedule(pollState.delayMs);
      } finally {
        inFlight = false;
        requestController = null;
        if (active) setChecking(false);
      }
    };

    retryNowRef.current = () => {
      if (inFlight || pollState.terminal) return;
      if (timer) clearTimeout(timer);
      timer = null;
      void poll();
    };
    void poll();

    return () => {
      active = false;
      if (timer) clearTimeout(timer);
      requestController?.abort();
      retryNowRef.current = null;
    };
  }, [jobId]);

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
        {(data?.status || monitoringStopped) && (
          <span
            style={{
              fontSize: "11px",
              fontWeight: 500,
              padding: "3px 10px",
              borderRadius: "var(--radius-pill)",
              background:
                data?.status === "completed"
                  ? "#F0FDF4"
                  : data?.status === "failed"
                    ? "#FFFBEB"
                    : "var(--color-accent-light)",
              color:
                data?.status === "completed"
                  ? "#166534"
                  : data?.status === "failed"
                    ? "#92400E"
                    : "var(--color-accent)",
              textTransform: "uppercase",
              letterSpacing: "0.04em",
            }}
          >
            {monitoringStopped ? "monitoring paused" : data?.status}
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
      {data && (data.companies_found > 0 || (data.known_companies_found ?? 0) > 0 || data.contacts_found > 0) && (
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
            new {data.companies_found === 1 ? "company" : "companies"} found
          </div>
          {(data.known_companies_found ?? 0) > 0 && (
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: "6px",
                fontSize: "13px",
                color: "var(--color-text-secondary)",
              }}
            >
              <Building2 size={16} style={{ color: "#147c77" }} />
              <span style={{ fontWeight: 600 }}>{data.known_companies_found}</span>
              already on your list
            </div>
          )}
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
      {data?.errors?.map((message, index) => (
        <div
          key={`${data.job_id}-error-${index}`}
          role="status"
          style={{
            marginTop: "16px",
            padding: "10px 12px",
            borderRadius: "var(--radius-sm)",
            background: "#FFFBEB",
            border: "1px solid #FDE68A",
            fontSize: "12px",
            color: "#92400E",
          }}
        >
          {message}
        </div>
      ))}

      {error && (
        <div
          role="status"
          style={{
            marginTop: "16px",
            padding: "10px 12px",
            borderRadius: "var(--radius-sm)",
            background: "#FFFBEB",
            border: "1px solid #FDE68A",
            fontSize: "12px",
            color: "#92400E",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: "12px",
          }}
        >
          <span>{error}</span>
          {!monitoringStopped && (
            <button
              type="button"
              onClick={() => retryNowRef.current?.()}
              disabled={checking}
              className="btn-secondary"
              style={{ minHeight: 32, flexShrink: 0 }}
            >
              {checking ? "Checking…" : "Retry now"}
            </button>
          )}
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
