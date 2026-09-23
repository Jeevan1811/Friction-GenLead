"use client";

import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { Fragment, useState } from "react";

/**
 * Renders an assistant reply. Besides plain text it understands two markers
 * the backend validates (services/research/app/services/assistant.py):
 *   [[shot:<id>]]            -> an inline screenshot from /guides/<id>.png
 *   [[open:/path|Label]]     -> a button that opens that page
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

const KNOWN_PATHS = new Set([
  "/search",
  "/companies",
  "/locations",
  "/contacts",
  "/searches",
  "/rejected",
]);

type Segment =
  | { type: "text"; text: string }
  | { type: "shot"; id: string }
  | { type: "open"; path: string; label: string };

const MARKER = /\[\[(shot|open):([^\]]+)\]\]/g;

function parse(content: string): Segment[] {
  const out: Segment[] = [];
  let last = 0;
  for (const m of content.matchAll(MARKER)) {
    const start = m.index ?? 0;
    if (start > last) out.push({ type: "text", text: content.slice(last, start) });
    if (m[1] === "shot") {
      out.push({ type: "shot", id: m[2].trim() });
    } else {
      const [path, ...rest] = m[2].split("|");
      out.push({ type: "open", path: path.trim(), label: rest.join("|").trim() || "Open" });
    }
    last = start + m[0].length;
  }
  if (last < content.length) out.push({ type: "text", text: content.slice(last) });
  return out.filter((s) => s.type !== "text" || s.text.trim() !== "");
}

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
  if (failed || !/^[a-z0-9-]+$/.test(id)) return null;
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

export function ChatRichText({ content }: { content: string }) {
  const segments = parse(content);
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
        if (!KNOWN_PATHS.has(seg.path)) return null;
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

