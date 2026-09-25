import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const tourSource = readFileSync(new URL("../src/components/shared/dashboard-tour.tsx", import.meta.url), "utf8");
const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");
const steps = [...tourSource.matchAll(/path:\s*"([^"]+)",\s*target:\s*'([^']+)'/g)].map((match) => ({
  path: match[1],
  target: match[2],
}));

const pageSources = new Map([
  ["/search", [read("../src/app/(dashboard)/search/page.tsx"), read("../src/components/layout/header.tsx"), read("../src/components/layout/sidebar.tsx"), read("../src/components/layout/notifications-popover.tsx")].join("\n")],
  ["/companies", read("../src/app/(dashboard)/companies/page.tsx")],
  ["/locations", read("../src/app/(dashboard)/locations/page.tsx")],
  ["/contacts", read("../src/app/(dashboard)/contacts/page.tsx")],
  ["/source-data", read("../src/app/(dashboard)/source-data/page.tsx")],
  ["/follow-ups", read("../src/app/(dashboard)/follow-ups/page.tsx")],
  ["/searches", read("../src/app/(dashboard)/searches/page.tsx")],
  ["/rejected", read("../src/app/(dashboard)/rejected/page.tsx")],
  ["/settings", read("../src/app/(dashboard)/settings/page.tsx")],
]);

test("the guide starts on the real Search route, covers the workflow, and finishes in Settings", () => {
  assert.equal(steps[0]?.path, "/search");
  assert.equal(steps[0]?.target, '[data-tour="search-overview"]');
  assert.equal(steps.at(-1)?.path, "/settings");
  assert.deepEqual(new Set(steps.map((step) => step.path)), new Set(pageSources.keys()));
  assert.equal(steps.filter((step) => step.target === '[data-tour="search-overview"]').length, 1);
});

test("every walkthrough target exists on its actual route", () => {
  for (const step of steps) {
    const name = step.target.match(/data-tour="([^"]+)"/)?.[1];
    assert.ok(name, `tour target is a data-tour selector: ${step.target}`);
    assert.ok(pageSources.get(step.path)?.includes(`data-tour="${name}"`), `${step.path} contains ${name}`);
  }
});

test("the bell and live Google Sheet shortcut are both explained by the guide", () => {
  assert.ok(steps.some((step) => step.target.includes('data-tour="notifications-button"')));
  assert.ok(steps.some((step) => step.target.includes('data-tour="google-sheet-link"')));
});
