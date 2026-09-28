"use client";

import { useCallback, useEffect, useState } from "react";
import { Bot, BookOpenText, CheckCircle2, CircleAlert, CircleHelp, LoaderCircle, Play, RefreshCw, Table2 } from "lucide-react";
import { useDashboardTour, DASHBOARD_TOUR_STEPS } from "@/components/shared/dashboard-tour";
import { getProviderStatus, getSyncStatus } from "@/lib/api";
import type { ProviderServiceStatus } from "@/lib/api";
import type { SyncStatus } from "@/lib/types";
import { useSheetAutoRefresh } from "@/lib/use-sheet-auto-refresh";

export default function SettingsPage() {
  const { startDashboardTour } = useDashboardTour();
  const [sync, setSync] = useState<SyncStatus | null>(null);
  const [syncError, setSyncError] = useState(false);
  const [providerServices, setProviderServices] = useState<ProviderServiceStatus[] | null>(null);
  const [providerError, setProviderError] = useState<string | null>(null);
  const [providerLoading, setProviderLoading] = useState(false);

  const loadSync = useCallback(async () => {
    setSyncError(false);
    try {
      setSync(await getSyncStatus());
    } catch {
      setSyncError(true);
    }
  }, []);

  useEffect(() => { void loadSync(); }, [loadSync]);
  useSheetAutoRefresh(loadSync);

  const loadProviderStatus = useCallback(async (showLoading = false) => {
    if (showLoading) setProviderLoading(true);
    try {
      const result = await getProviderStatus();
      setProviderServices(result.services);
      setProviderError(null);
    } catch (error) {
      const message = error instanceof Error ? error.message : "";
      setProviderError(
        /signed out|log in again/i.test(message)
          ? "Your session has expired. Log in again to view service status."
          : "GenLead could not reach its API to check these services. Your saved data is unchanged; refresh or try again shortly."
      );
    } finally {
      if (showLoading) setProviderLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadProviderStatus(true);
    const refreshWhenVisible = () => {
      if (document.visibilityState === "visible") void loadProviderStatus();
    };
    const timer = window.setInterval(refreshWhenVisible, 30_000);
    window.addEventListener("focus", refreshWhenVisible);
    document.addEventListener("visibilitychange", refreshWhenVisible);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", refreshWhenVisible);
      document.removeEventListener("visibilitychange", refreshWhenVisible);
    };
  }, [loadProviderStatus]);

  const isLive = sync?.mode === "live" && sync.connected;
  const connectionTitle = syncError
    ? "Could not check the connection"
    : !sync
      ? "Checking the connection…"
      : isLive
        ? "Connected to the live Google Sheet"
        : sync.mode === "mock"
          ? "Live Google Sheet is not connected"
          : "Google Sheets connection needs attention";

  return (
    <div style={{ padding: "24px", maxWidth: "920px" }}>

      <section
        data-tour="settings-guide"
        className="surface-card"
        aria-labelledby="dashboard-guide-title"
        style={{ padding: "20px", marginBottom: "16px" }}
      >
        <div style={{ display: "flex", alignItems: "flex-start", gap: "16px" }}>
          <div
            aria-hidden="true"
            style={{
              width: 40,
              height: 40,
              borderRadius: "var(--radius-md)",
              background: "var(--color-accent-light)",
              color: "var(--color-accent)",
              display: "grid",
              placeItems: "center",
              flexShrink: 0,
            }}
          >
            <BookOpenText size={20} />
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: "flex", flexWrap: "wrap", alignItems: "baseline", gap: "8px 12px" }}>
              <h2 id="dashboard-guide-title" style={{ fontSize: "18px", fontWeight: 600 }}>
                Dashboard guide
              </h2>
              <span style={{ color: "var(--color-text-muted)", fontSize: "12px" }}>
                {DASHBOARD_TOUR_STEPS.length} screens · about 3 minutes
              </span>
            </div>
            <p style={{ color: "var(--color-text-secondary)", marginTop: "8px", maxWidth: "680px" }}>
              A short, read-only tour of the main screens.
            </p>
            <button
              type="button"
              onClick={startDashboardTour}
              style={{
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                gap: "8px",
                minHeight: "44px",
                marginTop: "12px",
                padding: "0 16px",
                border: "1px solid var(--color-accent)",
                borderRadius: "var(--radius-sm)",
                background: "var(--color-accent)",
                color: "var(--color-accent-text)",
                font: "inherit",
                fontWeight: 600,
                cursor: "pointer",
              }}
            >
              <Play size={15} fill="currentColor" />
              Start tour
            </button>
          </div>
        </div>
      </section>

      <section
        data-tour="settings-provider-status"
        className="surface-card"
        aria-labelledby="provider-status-title"
        aria-busy={providerLoading}
        style={{ padding: "20px", marginBottom: "16px" }}
      >
        <div style={{ display: "flex", alignItems: "flex-start", gap: "16px" }}>
          <div
            aria-hidden="true"
            style={{
              width: 40,
              height: 40,
              borderRadius: "var(--radius-md)",
              background: "var(--color-accent-light)",
              color: "var(--color-accent)",
              display: "grid",
              placeItems: "center",
              flexShrink: 0,
            }}
          >
            <Bot size={20} />
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "12px" }}>
              <h2 id="provider-status-title" style={{ fontSize: "16px", fontWeight: 600 }}>
                AI & research services
              </h2>
              <button
                type="button"
                onClick={() => void loadProviderStatus(true)}
                disabled={providerLoading}
                aria-label="Refresh AI and research service status"
                title="Refresh status"
                style={{
                  minWidth: 40,
                  minHeight: 40,
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: "8px",
                  border: "1px solid var(--color-border)",
                  borderRadius: "var(--radius-sm)",
                  color: "var(--color-text-secondary)",
                  background: "var(--color-surface)",
                  font: "inherit",
                  cursor: providerLoading ? "wait" : "pointer",
                }}
              >
                {providerLoading ? <LoaderCircle size={16} className="spin" /> : <RefreshCw size={16} />}
                <span style={{ fontSize: "12px" }}>Refresh</span>
              </button>
            </div>
            <p style={{ color: "var(--color-text-secondary)", marginTop: "6px", fontSize: "13px" }}>
              Credential values stay private. Health updates after the features are used; this page does not send test requests.
            </p>

            {providerError ? (
              <div role="alert" style={{ marginTop: "14px", padding: "12px", borderRadius: "var(--radius-sm)", background: "var(--color-accent-light)", color: "var(--color-error)" }}>
                <div style={{ display: "flex", alignItems: "flex-start", gap: "8px" }}>
                  <CircleAlert size={16} style={{ marginTop: 2, flexShrink: 0 }} />
                  <span style={{ fontSize: "13px" }}>{providerError}</span>
                </div>
              </div>
            ) : !providerServices ? (
              <div role="status" aria-live="polite" style={{ display: "flex", alignItems: "center", gap: "8px", marginTop: "16px", color: "var(--color-text-muted)", fontSize: "13px" }}>
                {providerLoading ? <LoaderCircle size={16} className="spin" /> : <CircleHelp size={16} />}
                <span>{providerLoading ? "Checking service status…" : "Service status is not available yet."}</span>
              </div>
            ) : (
              <div role="list" aria-label="AI and research service status" style={{ marginTop: "12px" }}>
                {providerServices.map((service, index) => {
                  const isHealthy = service.state === "healthy";
                  const needsAction = service.state === "attention" || service.state === "not_configured";
                  const StatusIcon = isHealthy ? CheckCircle2 : needsAction ? CircleAlert : CircleHelp;
                  const statusColor = isHealthy
                    ? "var(--color-success)"
                    : needsAction
                      ? "var(--color-warning)"
                      : "var(--color-text-muted)";
                  const statusLabel = isHealthy
                    ? "Working"
                    : service.state === "attention"
                      ? "Action needed"
                      : service.state === "not_configured"
                        ? "Not configured"
                        : "Not checked";
                  const credentialLabel = service.credential_status === "configured"
                    ? "Credential configured · value hidden"
                    : service.credential_status === "not_required"
                      ? "No provider credential required"
                      : "Credential not configured";
                  const checkedLabel = service.checked_at
                    ? `Last used ${new Date(service.checked_at).toLocaleString()}`
                    : "No request recorded this API session";

                  return (
                    <article
                      key={service.id}
                      role="listitem"
                      style={{
                        padding: "14px 0",
                        borderTop: index === 0 ? "1px solid var(--color-border-subtle)" : undefined,
                        borderBottom: "1px solid var(--color-border-subtle)",
                      }}
                    >
                      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: "16px", flexWrap: "wrap" }}>
                        <div style={{ minWidth: 0, flex: 1 }}>
                          <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
                            <h3 style={{ fontSize: "14px", fontWeight: 600 }}>{service.name}</h3>
                            <span style={{ color: "var(--color-text-muted)", fontSize: "12px" }}>{service.provider}</span>
                          </div>
                          <p style={{ marginTop: "5px", color: "var(--color-text-secondary)", fontSize: "12px" }}>
                            {service.model ? `Model: ${service.model}` : service.sources?.join(" · ")}
                          </p>
                          <p style={{ marginTop: "7px", color: "var(--color-text-secondary)", fontSize: "13px" }}>
                            {credentialLabel} · {checkedLabel}
                          </p>
                        </div>
                        <span style={{ display: "inline-flex", alignItems: "center", gap: "6px", color: statusColor, fontSize: "12px", fontWeight: 600, whiteSpace: "nowrap" }}>
                          <StatusIcon size={15} /> {statusLabel}
                        </span>
                      </div>
                      <p style={{ marginTop: "9px", color: needsAction ? "var(--color-text)" : "var(--color-text-secondary)", fontSize: "13px", lineHeight: 1.5 }}>
                        {service.message}
                      </p>
                      {service.next_step && (
                        <p style={{ marginTop: "4px", color: "var(--color-text-muted)", fontSize: "12px", lineHeight: 1.5 }}>
                          {service.next_step}
                        </p>
                      )}
                    </article>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </section>

      <section
        data-tour="settings-sheet-status"
        className="surface-card"
        aria-labelledby="sheet-status-title"
        style={{ padding: "20px" }}
      >
        <div style={{ display: "flex", alignItems: "flex-start", gap: "16px" }}>
          <div
            aria-hidden="true"
            style={{
              width: 40,
              height: 40,
              borderRadius: "var(--radius-md)",
              background: "var(--color-border-subtle)",
              color: "var(--color-text-secondary)",
              display: "grid",
              placeItems: "center",
              flexShrink: 0,
            }}
          >
            <Table2 size={20} />
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <h2 id="sheet-status-title" style={{ fontSize: "16px", fontWeight: 600 }}>
              Google Sheets data
            </h2>
            <div role="status" aria-live="polite" style={{ display: "flex", alignItems: "center", gap: "8px", marginTop: "10px" }}>
              {syncError ? (
                <CircleAlert size={16} style={{ color: "var(--color-error)" }} />
              ) : !sync ? (
                <LoaderCircle size={16} className="spin" style={{ color: "var(--color-text-muted)" }} />
              ) : isLive ? (
                <CheckCircle2 size={16} style={{ color: "var(--color-success)" }} />
              ) : (
                <CircleAlert size={16} style={{ color: "var(--color-warning)" }} />
              )}
              <span style={{ fontWeight: 500 }}>{connectionTitle}</span>
            </div>
            {sync && (
              <div style={{ display: "flex", flexWrap: "wrap", gap: "8px 20px", marginTop: "14px", color: "var(--color-text-secondary)" }}>
                <span><strong style={{ color: "var(--color-text)" }}>{sync.companiesCount.toLocaleString()}</strong> companies</span>
                <span><strong style={{ color: "var(--color-text)" }}>{sync.locationsCount.toLocaleString()}</strong> locations</span>
                <span><strong style={{ color: "var(--color-text)" }}>{sync.contactsCount.toLocaleString()}</strong> contacts</span>
                <span><strong style={{ color: "var(--color-text)" }}>{(sync.activitiesCount ?? 0).toLocaleString()}</strong> call notes</span>
                <span><strong style={{ color: "var(--color-text)" }}>{(sync.searchRunsCount ?? 0).toLocaleString()}</strong> search summaries</span>
                <span><strong style={{ color: "var(--color-text)" }}>{(sync.sourceRecordsCount ?? 0).toLocaleString()}</strong> original source rows</span>
              </div>
            )}
            <p style={{ color: "var(--color-text-muted)", marginTop: "12px", fontSize: "12px" }}>
              Sheet changes refresh automatically. Original rows are under Original data.
            </p>
          </div>
        </div>
      </section>
    </div>
  );
}
