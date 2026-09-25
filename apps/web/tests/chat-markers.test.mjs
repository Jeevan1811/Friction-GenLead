import assert from "node:assert/strict";
import test from "node:test";
import { CHAT_KNOWN_PATHS, CHAT_KNOWN_SHOTS, parseChatMarkers } from "../src/lib/chat-markers.mjs";

test("parses safe page, screenshot, and live Sheet markers", () => {
  assert.deepEqual(
    parseChatMarkers("See this example [[shot:companies-list]] [[open:/companies|Open Companies]] [[sheet]]"),
    [
      { type: "text", text: "See this example " },
      { type: "shot", id: "companies-list" },
      { type: "open", path: "/companies", label: "Open Companies" },
      { type: "sheet" },
    ],
  );
});

test("drops unapproved routes and screenshot ids", () => {
  assert.deepEqual(
    parseChatMarkers("A [[open:javascript:alert(1)|Bad]] B [[open:/source-data|Original data]] [[shot:admin-secrets]]"),
    [
      { type: "text", text: "A " },
      { type: "text", text: " B " },
      { type: "open", path: "/source-data", label: "Original data" },
    ],
  );
});

test("allows only app routes and screenshots served by this release", () => {
  for (const path of CHAT_KNOWN_PATHS) assert.ok(path.startsWith("/"));
  assert.deepEqual([...CHAT_KNOWN_SHOTS].sort(), [
    "approve-reject", "companies-detail", "companies-list", "companies-search", "contacts",
    "locations", "login", "rejected", "search", "sheet-sync",
  ]);
});
