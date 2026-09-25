"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { CalendarClock, Check, RotateCcw } from "lucide-react";
import { getFollowUps, updateFollowUpStatus } from "@/lib/api";
import type { CompanyActivity } from "@/lib/types";
import { PageError, PageLoading } from "@/components/shared/page-status";
import { useSheetAutoRefresh } from "@/lib/use-sheet-auto-refresh";

function formatDate(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "Date unavailable"
    : date.toLocaleString("en-AU", {
        day: "numeric",
        month: "short",
        year: "numeric",
        hour: "numeric",
        minute: "2-digit",
      });
}

function FollowUpCard({
  item,
  onStatusChange,
}: {
  item: CompanyActivity;
  onStatusChange: (activityId: string, completed: boolean) => Promise<void>;
}) {
  const completed = item.followUpStatus === "COMPLETED";
  const overdue = !completed && !!item.followUpAt && new Date(item.followUpAt).getTime() < Date.now();

  return (
    <article
      className="surface-card"
      style={{
        padding: "18px 20px",
        display: "grid",
        gap: "10px",
        opacity: completed ? 0.76 : 1,
      }}
    >
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: "16px", flexWrap: "wrap" }}>
        <div>
          <Link href="/companies" style={{ color: "var(--color-text)", fontWeight: 600, textDecoration: "none" }}>
            {item.companyName || "Company"}
          </Link>
          <div style={{ display: "flex", alignItems: "center", gap: "7px", marginTop: "6px", color: overdue ? "var(--color-error)" : completed ? "var(--color-success)" : "var(--color-accent)", fontSize: "12px", fontWeight: 500 }}>
            {completed ? <Check size={14} /> : <CalendarClock size={14} />}
            {completed ? "Completed" : overdue ? "Overdue" : "Due"} · {item.followUpAt ? formatDate(item.followUpAt) : "No date"}
          </div>
        </div>
        <button
          type="button"
          className={completed ? "btn-secondary" : "btn-primary"}
          style={{ minHeight: "34px" }}
          onClick={() => void onStatusChange(item.activityId, !completed)}
        >
          {completed ? <RotateCcw size={14} /> : <Check size={14} />}
          {completed ? "Reopen" : "Mark done"}
        </button>
      </div>
      <p style={{ margin: 0, fontSize: "12px", color: "var(--color-text-secondary)", lineHeight: 1.55, whiteSpace: "pre-wrap" }}>
        {item.notes}
      </p>
      <div style={{ fontSize: "11px", color: "var(--color-text-muted)" }}>
        Follow-up from {item.activityType}{item.outcome ? ` · ${item.outcome}` : ""} · Original activity {formatDate(item.happenedAt)}
      </div>
    </article>
  );
}

export default function FollowUpsPage() {
  const [items, setItems] = useState<CompanyActivity[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [savingId, setSavingId] = useState<string | null>(null);

  const load = useCallback(async (initial = false) => {
    if (initial) setLoading(true);
    setError(null);
    try {
      setItems(await getFollowUps());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load follow-ups.");
    } finally {
      if (initial) setLoading(false);
    }
  }, []);

  useEffect(() => { void load(true); }, [load]);
  useSheetAutoRefresh(() => load());

  const { openItems, completedItems } = useMemo(() => {
    const open = items.filter((item) => item.followUpStatus !== "COMPLETED");
    const completed = items.filter((item) => item.followUpStatus === "COMPLETED");
    return { openItems: open, completedItems: completed };
  }, [items]);

  const changeStatus = async (activityId: string, completed: boolean) => {
    setSavingId(activityId);
    setError(null);
    try {
      await updateFollowUpStatus(activityId, completed);
      setItems((current) => current.map((item) => item.activityId === activityId
        ? { ...item, followUpStatus: completed ? "COMPLETED" : "OPEN" }
        : item));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not update this follow-up.");
    } finally {
      setSavingId(null);
    }
  };

  return (
    <main style={{ padding: "24px", maxWidth: "960px" }}>
      <div style={{ marginBottom: "22px" }}>
        <h1 data-tour="follow-ups-overview" style={{ fontSize: "28px", fontWeight: 600, letterSpacing: "-0.02em" }}>Follow-ups</h1>
        <p style={{ marginTop: "5px", fontSize: "13px", color: "var(--color-text-secondary)" }}>
          Scheduled next steps from your company call notes. Mark a task done or reopen it if plans change.
        </p>
      </div>

      {error && <div style={{ marginBottom: "14px" }}><PageError message={error} /></div>}
      {loading ? <PageLoading label="Loading follow-ups…" /> : (
        <>
          <div style={{ display: "grid", gap: "9px" }}>
            {openItems.length ? openItems.map((item) => (
              <FollowUpCard key={item.activityId} item={item} onStatusChange={changeStatus} />
            )) : (
              <div className="surface-card" style={{ padding: "34px 22px", textAlign: "center", color: "var(--color-text-muted)", fontSize: "13px" }}>
                No open follow-ups. Add a date when logging an activity on a company.
              </div>
            )}
          </div>
          {completedItems.length > 0 && (
            <details style={{ marginTop: "26px" }}>
              <summary style={{ cursor: "pointer", color: "var(--color-text-secondary)", fontSize: "13px", marginBottom: "10px" }}>
                Completed ({completedItems.length})
              </summary>
              <div style={{ display: "grid", gap: "9px" }}>
                {completedItems.map((item) => <FollowUpCard key={item.activityId} item={item} onStatusChange={changeStatus} />)}
              </div>
            </details>
          )}
        </>
      )}
      {savingId && <span role="status" style={{ position: "fixed", bottom: 16, right: 20, fontSize: "12px", color: "var(--color-text-muted)" }}>Saving follow-up…</span>}
    </main>
  );
}
