"use client";

import Link from "next/link";
import { ArrowRight, ExternalLink } from "lucide-react";
import { Fragment, useState } from "react";
import { CHAT_KNOWN_SHOTS, parseChatMarkers } from "@/lib/chat-markers.mjs";

/**
 * Renders an assistant reply. Besides plain text it understands two markers
 * the backend validates (services/research/app/services/assistant.py):
 *   [[shot:<id>]]            -> an inline screenshot from /guides/<id>.png
 *   [[open:/path|Label]]     -> a button that opens that page
 *   [[sheet]]                -> a button to the authenticated user's live workbook
 * Anything else stays text, so a model that misbehaves can't inject links.
 */

const SHOT_CAPTIONS: Record<string, string> = {
  "companies-list": "The Companies page",
  "companies-search": "Searching for a company",
  "companies-detail": "A company's details panel",
  "approve-reject": "The Approve and Reject buttons",
  locations: "The Locations page",
  contacts: "The Contacts page",
  rejected: "The Rejected page",
  search: "The Search page",
  "sheet-sync": "The Synced indicator in the sidebar",
  login: "The sign-in page",
};

function Bold({ text }: { text: string }) {
  return (
    <>
      {text.split(/(\*\*[^*]+\*\*)/g).map((part, i) =>
        part.startsWith("**") && part.endsWith("**") && part.length > 4 ? (
          <strong key={i}>{part.slice(2, -2)}</strong>
        ) : (
          <Fragment key={i}>{part}</Fragment>
        )
      )}
    </>
  );
}

function Shot({ id }: { id: string }) {
  const [failed, setFailed] = useState(false);
  if (failed || !CHAT_KNOWN_SHOTS.has(id)) return null;
  const src = `/guides/${id}.png`;
  return (
    <figure style={{ margin: "8px 0 0" }}>
      <a href={src} target="_blank" rel="noreferrer" style={{ display: "block", minHeight: 0, minWidth: 0 }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={src}
          alt={SHOT_CAPTIONS[id] ?? "Screenshot"}
          onError={() => setFailed(true)}
          style={{
            width: "100%",
            display: "block",
            borderRadius: "var(--radius-sm)",
            border: "1px solid var(--color-border)",
          }}
        />
      </a>
      <figcaption style={{ fontSize: "11px", color: "var(--color-text-muted)", marginTop: "4px" }}>
        {SHOT_CAPTIONS[id] ?? "Screenshot"} (click to enlarge)
      </figcaption>
    </figure>
  );
}

export function ChatRichText({ content, sheetUrl }: { content: string; sheetUrl?: string | null }) {
  const segments = parseChatMarkers(content);
  return (
    <>
      {segments.map((seg, i) => {
        if (seg.type === "text") {
          return (
            <div key={i} style={{ whiteSpace: "pre-wrap" }}>
              <Bold text={seg.text.trim()} />
            </div>
          );
        }
        if (seg.type === "shot") return <Shot key={i} id={seg.id} />;
        if (seg.type === "sheet") {
          if (!sheetUrl) return null;
          return (
            <a
              key={i}
              href={sheetUrl}
              target="_blank"
              rel="noopener noreferrer"
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: "6px",
                marginTop: "8px",
                padding: "6px 12px",
                fontSize: "12px",
                fontWeight: 500,
                textDecoration: "none",
                borderRadius: "var(--radius-pill)",
                background: "var(--color-accent-light)",
                color: "var(--color-accent)",
                minHeight: 0,
                minWidth: 0,
              }}
            >
              Open Google Sheet <ExternalLink size={12} />
            </a>
          );
        }
        return (
          <Link
            key={i}
            href={seg.path}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: "6px",
              marginTop: "8px",
              padding: "6px 12px",
              fontSize: "12px",
              fontWeight: 500,
              textDecoration: "none",
              borderRadius: "var(--radius-pill)",
              background: "var(--color-accent-light)",
              color: "var(--color-accent)",
              minHeight: 0,
              minWidth: 0,
            }}
          >
            {seg.label} <ArrowRight size={12} />
          </Link>
        );
      })}
    </>
  );
}

