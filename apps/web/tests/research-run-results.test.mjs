import assert from "node:assert/strict";
import test from "node:test";

import {
  buildResearchRunCompaniesHref,
  extractResearchRunCompanyIds,
  filterCompaniesToResearchRun,
} from "../src/lib/research-run-results.ts";

test("extracts unique saved company IDs from research result rows", () => {
  const rows = [
    { company_id: "company-1", company_name: "North Plant" },
    { companyId: "company-2", companyName: "West Depot" },
    { company_id: "company-1", company_name: "North Plant" },
    { company_id: "   " },
    null,
    { company_id: 7 },
  ];

  assert.deepEqual(extractResearchRunCompanyIds(rows), ["company-1", "company-2"]);
});

test("returns no company IDs when a saved run has no detail rows", () => {
  assert.deepEqual(extractResearchRunCompanyIds([]), []);
  assert.deepEqual(extractResearchRunCompanyIds(null), []);
});

test("builds a run-scoped company link and preserves the selected company", () => {
  assert.equal(
    buildResearchRunCompaniesHref("run-123", "company/456"),
    "/companies?researchRun=run-123&companyId=company%2F456"
  );
});

test("shows only companies saved for the selected research run", () => {
  const companies = [
    { companyId: "company-1", companyName: "North Plant" },
    { companyId: "company-2", companyName: "West Depot" },
    { companyId: "company-3", companyName: "South Yard" },
  ];

  assert.deepEqual(
    filterCompaniesToResearchRun(companies, ["company-2", "company-3"]),
    [companies[1], companies[2]]
  );
});
