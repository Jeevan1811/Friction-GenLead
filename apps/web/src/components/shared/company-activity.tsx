"use client";

import { useCallback, useEffect, useState } from "react";
import { CalendarClock, CircleCheck, Loader2, MessageSquareText } from "lucide-react";
import type { CompanyActivity, Contact } from "@/lib/types";
import {
  createCompanyActivity,
  getCompanyActivities,
  type CompanyActivityDraft,
} from "@/lib/api";

type ActivityType = CompanyActivityDraft["activityType"];

function toLocalDateTimeValue(value: Date) {
  const local = new Date(value.getTime() - value.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

function formatDate(value: string) {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime())
    ? "Date unavailable"
    : parsed.toLocaleString("en-AU", {
        day: "numeric",
        month: "short",
        year: "numeric",
        hour: "numeric",
        minute: "2-digit",
      });
}

const fieldStyle = { width: "100%", marginTop: "6px" } as const;

export function CompanyActivityPanel({
  companyId,
  contacts,
}: {
  companyId: string;
  contacts: Contact[];
}) {
  const [items, setItems] = useState<CompanyActivity[]>([]);
  const [activityType, setActivityType] = useState<ActivityType>("call");
  const [contactId, setContactId] = useState("");
  const [outcome, setOutcome] = useState("");
  const [notes, setNotes] = useState("");
  const [happenedAt, setHappenedAt] = useState(() => toLocalDateTimeValue(new Date()));
  const [followUpAt, setFollowUpAt] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedMessage, setSavedMessage] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setError(null);
    try {
      setItems(await getCompanyActivities(companyId));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load this company's activity.");
    } finally {
      setLoading(false);
    }
  }, [companyId]);

  useEffect(() => {
    setLoading(true);
    void refresh();
  }, [refresh]);

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!notes.trim() || !happenedAt) return;
    const happened = new Date(happenedAt);
    const followUp = followUpAt ? new Date(followUpAt) : null;
    if (followUp && followUp <= happened) {
      setError("Choose a follow-up time after the activity.");
      return;
    }

    const draft: CompanyActivityDraft = {
      activityId: crypto.randomUUID(),
      activityType,
      notes: notes.trim(),
      happenedAt: happened.toISOString(),
      ...(contactId ? { contactId } : {}),
      ...(outcome.trim() ? { outcome: outcome.trim() } : {}),
      ...(followUp ? { followUpAt: followUp.toISOString() } : {}),
    };

    setSaving(true);
    setError(null);
    setSavedMessage(null);
    try {
      await createCompanyActivity(companyId, draft);
      setNotes("");
      setOutcome("");
      setFollowUpAt("");
      setHappenedAt(toLocalDateTimeValue(new Date()));
      setSavedMessage("Saved to the live Google Sheet.");
      await refresh();
    } catch (err) {
      // Keep all entered values on failure so the user can retry without losing notes.
      setError(err instanceof Error ? err.message : "Could not save this activity.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <section aria-label="Call notes and follow-ups">
      <div className="text-label" style={{ marginBottom: "10px" }}>
        Call notes &amp; follow-ups
      </div>

      <form
        onSubmit={submit}
        style={{
          padding: "14px",
          borderRadius: "var(--radius-md)",
          border: "1px solid var(--color-border)",
          background: "var(--color-bg)",
          display: "grid",
          gap: "12px",
        }}
      >
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px" }}>
          <label style={{ fontSize: "11px", color: "var(--color-text-secondary)" }}>
            Activity
            <select
              className="input-field"
              style={fieldStyle}
              value={activityType}
              onChange={(event) => setActivityType(event.target.value as ActivityType)}
            >
              <option value="call">Call</option>
              <option value="email">Email</option>
              <option value="meeting">Meeting</option>
              <option value="note">Note</option>
            </select>
          </label>
          <label style={{ fontSize: "11px", color: "var(--color-text-secondary)" }}>
            Contact (optional)
            <select
              className="input-field"
              style={fieldStyle}
              value={contactId}
              onChange={(event) => setContactId(event.target.value)}
            >
              <option value="">Company only</option>
              {contacts.map((contact) => (
                <option key={contact.contactId} value={contact.contactId}>
                  {contact.name || contact.position || "Unnamed contact"}
                </option>
              ))}
            </select>
          </label>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px" }}>
          <label style={{ fontSize: "11px", color: "var(--color-text-secondary)" }}>
            Outcome (optional)
            <input
              className="input-field"
              style={fieldStyle}
              value={outcome}
              maxLength={160}
              onChange={(event) => setOutcome(event.target.value)}
              placeholder="Spoke, voicemail, quote requested…"
            />
          </label>
          <label style={{ fontSize: "11px", color: "var(--color-text-secondary)" }}>
            When
            <input
              className="input-field"
              style={fieldStyle}
              type="datetime-local"
              required
              value={happenedAt}
              onChange={(event) => setHappenedAt(event.target.value)}
            />
          </label>
        </div>

        <label style={{ fontSize: "11px", color: "var(--color-text-secondary)" }}>
          Notes
          <textarea
            className="input-field"
            style={{ ...fieldStyle, minHeight: "84px", resize: "vertical" }}
            value={notes}
            onChange={(event) => setNotes(event.target.value)}
            maxLength={4000}
            required
            placeholder="What did you discuss? What should happen next?"
          />
        </label>

        <label style={{ fontSize: "11px", color: "var(--color-text-secondary)" }}>
          Follow-up (optional)
          <input
            className="input-field"
            style={fieldStyle}
            type="datetime-local"
            value={followUpAt}
            min={happenedAt}
            onChange={(event) => setFollowUpAt(event.target.value)}
          />
        </label>

        {error && <p role="alert" style={{ margin: 0, color: "var(--color-error)", fontSize: "12px" }}>{error}</p>}
        {savedMessage && <p role="status" style={{ margin: 0, color: "var(--color-success)", fontSize: "12px" }}>{savedMessage}</p>}

        <button
          type="submit"
          className="btn-primary"
          disabled={saving || !notes.trim()}
          style={{ justifyContent: "center" }}
        >
          {saving ? <Loader2 size={14} className="spin" /> : <MessageSquareText size={14} />}
          {saving ? "Saving…" : "Save activity"}
        </button>
      </form>

      <div style={{ marginTop: "18px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "7px", marginBottom: "10px" }}>
          <CalendarClock size={14} color="var(--color-text-muted)" />
          <span className="text-label">Activity history</span>
        </div>
        {loading ? (
          <p style={{ color: "var(--color-text-muted)", fontSize: "12px" }}>Loading saved notes…</p>
        ) : items.length === 0 ? (
          <p style={{ color: "var(--color-text-muted)", fontSize: "12px" }}>No call notes or follow-ups saved for this company yet.</p>
        ) : (
          <div style={{ display: "grid", gap: "8px" }}>
            {items.map((item) => (
              <article
                key={item.activityId}
                style={{ padding: "12px", border: "1px solid var(--color-border-subtle)", borderRadius: "var(--radius-sm)" }}
              >
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "8px", marginBottom: "6px" }}>
                  <strong style={{ fontSize: "12px", textTransform: "capitalize" }}>{item.activityType}{item.outcome ? ` · ${item.outcome}` : ""}</strong>
                  {item.followUpAt && item.followUpStatus !== "COMPLETED" && (
                    <span style={{ display: "inline-flex", alignItems: "center", gap: "4px", color: "var(--color-accent)", fontSize: "10px" }}>
                      <CalendarClock size={12} /> Follow up {formatDate(item.followUpAt)}
                    </span>
                  )}
                  {item.followUpStatus === "COMPLETED" && (
                    <span style={{ display: "inline-flex", alignItems: "center", gap: "4px", color: "var(--color-success)", fontSize: "10px" }}>
                      <CircleCheck size={12} /> Follow-up done
                    </span>
                  )}
                </div>
                <p style={{ margin: "0 0 6px", color: "var(--color-text-secondary)", fontSize: "12px", lineHeight: 1.5, whiteSpace: "pre-wrap" }}>{item.notes}</p>
                <time style={{ color: "var(--color-text-muted)", fontSize: "10px" }} dateTime={item.happenedAt}>{formatDate(item.happenedAt)}</time>
              </article>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
