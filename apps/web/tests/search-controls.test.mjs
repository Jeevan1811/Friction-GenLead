import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_COMPANY_TARGET,
  DEFAULT_SEARCH_SECTOR,
  COMPANY_TARGET_MAX,
  COMPANY_TARGET_MIN,
  COMPANY_TARGET_STEP,
  buildResearchRequestBody,
} from "../src/lib/research-search-controls.mjs";

test("company target slider supports every value from 10 through 100", () => {
  assert.equal(COMPANY_TARGET_MIN, 10);
  assert.equal(COMPANY_TARGET_MAX, 100);
  assert.equal(COMPANY_TARGET_STEP, 1);
});

test("search request carries the selected target sector and company count", () => {
  assert.deepEqual(
    buildResearchRequestBody(
      "Mackay, Queensland",
      "Water Utilities & Authorities",
      ["Plant Manager"],
      100,
    ),
    {
      location: "Mackay, Queensland",
      industry: "Water Utilities & Authorities",
      roles: ["Plant Manager"],
      max_companies: 100,
    },
  );
});

test("default search settings target valve buyers while preserving the 30-company default", () => {
  assert.deepEqual(
    buildResearchRequestBody(
      "Gladstone, Queensland",
      DEFAULT_SEARCH_SECTOR,
      [],
      DEFAULT_COMPANY_TARGET,
    ),
    {
      location: "Gladstone, Queensland",
      industry: "Valve-focused",
      roles: [],
      max_companies: 30,
    },
  );
});

test("all-industries remains an explicit wider search", () => {
  assert.deepEqual(
    buildResearchRequestBody("Brisbane, Australia", "", [], 50),
    {
      location: "Brisbane, Australia",
      industry: null,
      roles: [],
      max_companies: 50,
    },
  );
});
