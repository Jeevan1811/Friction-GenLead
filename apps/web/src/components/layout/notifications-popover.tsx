"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Bell, CalendarClock, CircleAlert } from "lucide-react";
import { getFollowUps } from "@/lib/api";
import type { CompanyActivity } from "@/lib/types";

const REMINDER_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

function formatDue(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Date unavailable";
  const dateLabel = date.toLocaleDateString("en-AU", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
  return date.getTime() < Date.now() ? `Overdue · ${dateLabel}` : `Due · ${dateLabel}`;
}

export function NotificationsPopover() {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const [open, setOpen] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const [items, setItems] = useState<CompanyActivity[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    setError(false);

    void getFollowUps()
      .then((rows) => {
        if (cancelled) return;
        const cutoff = Date.now() + REMINDER_WINDOW_MS;
        const dueSoon = rows
          .filter((row) => row.followUpStatus !== "COMPLETED" && row.followUpAt)
          .filter((row) => {
            const dueAt = new Date(row.followUpAt!).getTime();
            return Number.isFinite(dueAt) && dueAt <= cutoff;
          })
          .sort((left, right) => new Date(left.followUpAt!).getTime() - new Date(right.followUpAt!).getTime());
        setItems(dueSoon);
      })
      .catch(() => {
        if (!cancelled) setError(true);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => { cancelled = true; };
  }, [open, reloadKey]);

  useEffect(() => {
    if (!open) return;
    const closeOnOutside = (event: PointerEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setOpen(false);
      triggerRef.current?.focus();
    };
    document.addEventListener("pointerdown", closeOnOutside);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOnOutside);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [open]);

  const dueCount = items.length;

  return (
    <div ref={containerRef} style={{ position: "relative", display: "inline-flex" }}>
      <button
        ref={triggerRef}
        type="button"
        data-tour="notifications-button"
        aria-label={dueCount ? `Follow-up reminders: ${dueCount} due or overdue` : "Follow-up reminders"}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls="genlead-notifications-panel"
        title="Follow-up reminders"
        onClick={() => setOpen((value) => !value)}
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          width: 36,
          height: 36,
          minHeight: 36,
          minWidth: 36,
          borderRadius: "var(--radius-sm)",
          border: "none",
          background: open ? "var(--color-accent-light)" : "transparent",
          color: "var(--color-text-secondary)",
          cursor: "pointer",
          position: "relative",
        }}
      >
        <Bell size={18} />
        {dueCount > 0 && (
          <span
            aria-hidden="true"
            style={{
              position: "absolute",
              top: 2,
              right: 1,
              minWidth: 16,
              height: 16,
              padding: "0 3px",
              borderRadius: 999,
              background: "var(--color-accent)",
              color: "#fff",
              fontSize: 10,
              lineHeight: "16px",
              textAlign: "center",
            }}
          >
            {dueCount > 99 ? "99+" : dueCount}
          </span>
        )}
      </button>

      {open && (
        <section
          id="genlead-notifications-panel"
          role="dialog"
          aria-labelledby="genlead-notifications-title"
          className="surface-card"
          style={{
            position: "absolute",
            zIndex: 80,
            top: "calc(100% + 10px)",
            right: 0,
            width: 340,
            maxWidth: "calc(100vw - 24px)",
            maxHeight: "min(440px, calc(100dvh - var(--header-height) - 24px))",
            overflow: "auto",
            padding: 16,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
            <h2 id="genlead-notifications-title" style={{ margin: 0, fontSize: 15, fontWeight: 600 }}>
              Follow-up reminders
            </h2>
            <span style={{ fontSize: 11, color: "var(--color-text-muted)" }}>Next 7 days</span>
          </div>

          {loading ? (
            <p role="status" style={{ margin: "18px 0", fontSize: 13, color: "var(--color-text-secondary)" }}>Loading reminders…</p>
          ) : error ? (
            <div role="alert" style={{ display: "grid", gap: 8, margin: "18px 0" }}>
              <span style={{ fontSize: 13, color: "var(--color-error)" }}>Reminders could not be loaded.</span>
              <button type="button" className="btn-secondary" onClick={() => setReloadKey((key) => key + 1)} style={{ justifySelf: "start", minHeight: 32 }}>
                Try again
              </button>
            </div>
          ) : items.length === 0 ? (
            <p style={{ margin: "18px 0", fontSize: 13, color: "var(--color-text-secondary)" }}>
              No follow-ups due soon. Set a date when saving a company call note.
            </p>
          ) : (
            <ul style={{ listStyle: "none", margin: "12px 0", padding: 0, display: "grid", gap: 4 }}>
              {items.slice(0, 6).map((item) => {
                const overdue = new Date(item.followUpAt!).getTime() < Date.now();
                return (
                  <li key={item.activityId}>
                    <Link
                      href={`/companies?companyId=${encodeURIComponent(item.companyId)}`}
                      onClick={() => setOpen(false)}
                      style={{ display: "grid", gap: 4, padding: "10px 8px", borderRadius: "var(--radius-sm)", color: "var(--color-text)", textDecoration: "none" }}
                    >
                      <span style={{ display: "flex", alignItems: "center", gap: 7, fontSize: 13, fontWeight: 500 }}>
                        {overdue ? <CircleAlert size={14} style={{ color: "var(--color-error)" }} /> : <CalendarClock size={14} style={{ color: "var(--color-accent)" }} />}
                        {item.companyName || "Company"}
                      </span>
                      <span style={{ paddingLeft: 21, fontSize: 11, color: overdue ? "var(--color-error)" : "var(--color-text-muted)" }}>
                        {formatDue(item.followUpAt!)}
                      </span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}

          <Link href="/follow-ups" onClick={() => setOpen(false)} style={{ display: "block", marginTop: 10, color: "var(--color-accent)", fontSize: 12, fontWeight: 500, textDecoration: "none" }}>
            View all follow-ups →
          </Link>
        </section>
      )}
    </div>
  );
}
