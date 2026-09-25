/**
 * Client-side allowlist for assistant-rendered UI markers. Keep in sync with
 * services/research/app/services/assistant_guides.py's known routes and shots.
 */
export const CHAT_KNOWN_PATHS = new Set([
  "/search",
  "/companies",
  "/locations",
  "/contacts",
  "/source-data",
  "/follow-ups",
  "/searches",
  "/rejected",
  "/settings",
]);

export const CHAT_KNOWN_SHOTS = new Set([
  "companies-list",
  "companies-search",
  "companies-detail",
  "approve-reject",
  "locations",
  "contacts",
  "rejected",
  "search",
  "sheet-sync",
  "login",
]);

const MARKER = /\[\[(shot|open):([^\]]+)\]\]|\[\[sheet\]\]/g;

export function parseChatMarkers(content) {
  const out = [];
  let last = 0;
  for (const match of content.matchAll(MARKER)) {
    const start = match.index ?? 0;
    if (start > last) out.push({ type: "text", text: content.slice(last, start) });
    if (match[0] === "[[sheet]]") {
      out.push({ type: "sheet" });
    } else if (match[1] === "shot") {
      const id = match[2].trim();
      if (CHAT_KNOWN_SHOTS.has(id)) out.push({ type: "shot", id });
    } else {
      const [rawPath, ...rest] = match[2].split("|");
      const path = rawPath.trim();
      if (CHAT_KNOWN_PATHS.has(path)) {
        out.push({ type: "open", path, label: rest.join("|").trim() || "Open" });
      }
    }
    last = start + match[0].length;
  }
  if (last < content.length) out.push({ type: "text", text: content.slice(last) });
  return out.filter((segment) => segment.type !== "text" || segment.text.trim() !== "");
}
