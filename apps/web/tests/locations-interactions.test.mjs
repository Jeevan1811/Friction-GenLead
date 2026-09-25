import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const locations = readFileSync(new URL("../src/app/(dashboard)/locations/page.tsx", import.meta.url), "utf8");
const map = readFileSync(new URL("../src/components/shared/globe-view.tsx", import.meta.url), "utf8");
const styles = readFileSync(new URL("../src/app/globals.css", import.meta.url), "utf8");
const header = readFileSync(new URL("../src/components/layout/notifications-popover.tsx", import.meta.url), "utf8");

test("location cards and table rows open the related company with keyboard-accessible links", () => {
  assert.ok(locations.includes("location-card-button"));
  assert.ok(locations.includes("router.push(`/companies?companyId=${encodeURIComponent(company.companyId)}`)"));
  assert.ok(locations.includes("<Link href={`/companies?companyId=${encodeURIComponent(company.companyId)}`}"));
  assert.ok(locations.includes('aria-label={`Open ${company.tradingName || company.companyName} details`}'));
});

test("location filters share truthful map counts and a clear-filters action", () => {
  assert.ok(locations.includes("<GlobeView locations={filtered} />"));
  assert.ok(locations.includes('aria-label="Clear location filters"'));
  assert.ok(map.includes("No locations match these filters."));
  assert.ok(map.includes("matching locations have no coordinates."));
  assert.ok(map.includes("matching locations mapped"));
});

test("map rendering avoids permanent label nodes for every coordinate group", () => {
  assert.ok(map.includes("preferCanvas: true"));
  assert.ok(map.includes("marker.bindTooltip(`${rows.length} locations`, { direction: \"center\""));
  assert.ok(!map.includes("permanent: true"));
  assert.match(styles, /\.genlead-map-summary\s*\{[^}]*bottom:\s*12px/s);
});

test("the notification bell displays real follow-up reminders instead of a decorative dot", () => {
  assert.ok(header.includes("getFollowUps()"));
  assert.ok(header.includes("REMINDER_WINDOW_MS"));
  assert.ok(header.includes('href="/follow-ups"') || header.includes('href={`/follow-ups`}'));
  assert.ok(header.includes("Follow-up reminders"));
});
