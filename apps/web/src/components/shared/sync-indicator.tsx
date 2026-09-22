"use client";

import clsx from "clsx";

interface SyncIndicatorProps {
  state: string;
  lastSync?: string;
  className?: string;
  collapsed?: boolean;
}

export function SyncIndicator({
  state,
  lastSync,
  className,
  collapsed = false,
}: SyncIndicatorProps) {
  const config: Record<string, { color: string; label: string; animate: boolean }> = {
    SYNCED: { color: "var(--color-success)", label: "Synced", animate: false },
    PENDING: { color: "var(--color-warning)", label: "Syncing...", animate: true },
    ERROR: { color: "var(--color-error)", label: "Sync error", animate: false },
    NEVER: { color: "var(--color-text-muted)", label: "Not connected", animate: false },
  };

  const { color, label, animate } = config[state] ?? config.NEVER;

  const timeSince = lastSync ? formatTimeSince(lastSync) : null;

  return (
    <div
      className={clsx("sync-indicator", className)}
      style={{
        display: "flex",
        alignItems: "center",
        gap: collapsed ? 0 : "8px",
        padding: collapsed ? "8px 0" : "8px 12px",
        justifyContent: collapsed ? "center" : "flex-start",
        fontSize: "11px",
        color: "var(--color-text-secondary)",
      }}
    >
      <span
        style={{
          width: 8,
          height: 8,
          borderRadius: "50%",
          background: color,
          flexShrink: 0,
          animation: animate ? "pulse-sync 1.5s ease-in-out infinite" : "none",
        }}
      />
      {!collapsed && (
        <span style={{ display: "flex", flexDirection: "column", gap: "1px" }}>
          <span style={{ fontWeight: 500, fontSize: "11px" }}>{label}</span>
          {timeSince && (
            <span style={{ fontSize: "10px", color: "var(--color-text-muted)" }}>
              {timeSince}
            </span>
          )}
        </span>
      )}
      <style>{`
        @keyframes pulse-sync {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.4; }
        }
      `}</style>
    </div>
  );
}

function formatTimeSince(iso: string): string {
  const now = Date.now();
  const then = new Date(iso).getTime();
  const diffMs = now - then;
  const diffMin = Math.floor(diffMs / 60000);

  if (diffMin < 1) return "Just now";
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const diffDay = Math.floor(diffHr / 24);
  return `${diffDay}d ago`;
}
