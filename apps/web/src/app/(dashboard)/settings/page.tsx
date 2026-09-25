"use client";

import { useCallback, useEffect, useState } from "react";
import { BookOpenText, CheckCircle2, CircleAlert, LoaderCircle, Play, Table2 } from "lucide-react";
import { useDashboardTour, DASHBOARD_TOUR_STEPS } from "@/components/shared/dashboard-tour";
import { getSyncStatus } from "@/lib/api";
import type { SyncStatus } from "@/lib/types";
import { useSheetAutoRefresh } from "@/lib/use-sheet-auto-refresh";

export default function SettingsPage() {
  const { startDashboardTour } = useDashboardTour();
  const [sync, setSync] = useState<SyncStatus | null>(null);
  const [syncError, setSyncError] = useState(false);

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
