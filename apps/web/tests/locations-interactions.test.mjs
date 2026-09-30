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
  assert.ok(locations.includes("<GlobeView locations={filtered} companiesById={companyById} focusKey="));
  assert.ok(locations.includes('aria-label="Clear location filters"'));
  assert.ok(map.includes("No matching locations"));
  assert.ok(map.includes("without coordinates"));
  assert.ok(map.includes("mapped"));
});

test("map rendering avoids permanent label nodes for every coordinate group", () => {
  assert.ok(map.includes("preferCanvas: true"));
  assert.ok(map.includes("marker.bindTooltip(markerTitle(rows, originByCompanyId)"));
  assert.ok(map.includes("map.project([Number(row.lat), Number(row.lng)], map.getZoom())"));
  assert.ok(map.includes('map.on("zoomend", renderMarkers)'));
  assert.ok(!map.includes("permanent: true"));
  assert.ok(map.includes('aria-label="Map marker legend"'));
  assert.ok(map.includes("From MSV’s workbook"));
  assert.ok(map.includes("Public-source prospect"));
  assert.ok(map.includes("Source not recorded"));
  assert.ok(map.includes(".filter((origin) => originCounts[origin] > 0)"));
  assert.match(styles, /\.genlead-map-marker--saved\s*\{/);
  assert.match(styles, /\.genlead-map-marker--prospect\s*\{/);
  assert.match(styles, /\.genlead-map-marker--mixed\s*\{/);
  assert.match(styles, /\.genlead-map-summary\s*\{[^}]*bottom:\s*12px/s);
});

test("the notification bell displays real follow-up reminders instead of a decorative dot", () => {
  assert.ok(header.includes("getFollowUps()"));
  assert.ok(header.includes("REMINDER_WINDOW_MS"));
  assert.ok(header.includes('href="/follow-ups"') || header.includes('href={`/follow-ups`}'));
  assert.ok(header.includes("Follow-up reminders"));
});
