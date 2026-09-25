import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const tourSource = readFileSync(new URL("../src/components/shared/dashboard-tour.tsx", import.meta.url), "utf8");
const searchPage = readFileSync(new URL("../src/app/(dashboard)/search/page.tsx", import.meta.url), "utf8");
const steps = [...tourSource.matchAll(/path:\s*"([^"]+)",\s*target:\s*'([^']+)'/g)].map((match) => ({
  path: match[1],
  target: match[2],
}));

test("the guide starts on the real Search route and does not duplicate that step", () => {
  assert.equal(steps[0]?.path, "/search");
  assert.equal(steps[0]?.target, '[data-tour="search-overview"]');
  assert.equal(steps.filter((step) => step.path === "/search").length, 1);
  assert.ok(searchPage.includes('data-tour="search-overview"'));
});
