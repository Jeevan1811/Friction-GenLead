import assert from "node:assert/strict";
import test from "node:test";
import { getSourceRecordPresentation } from "../src/lib/source-data-record.mjs";

function sourceRecord(overrides = {}) {
  return {
    sourceRecordId: "source-row-1",
    recordType: "SOURCE_ROW",
    companyId: "company 1/2",
    companyName: "Example Engineering Pty Ltd",
    sourceWorkbook: "Master - QLD Customers.xlsx",
    sourceSheet: "New Oceania Contacts",
    sourceRow: "2",
    sourceField: "Company Name",
    postcodeRaw: "4694",
    contactName: "Attilio Pigneri",
    landlineRaw: "+61 409 029 591",
    verificationSourceRaw: "Oceania Projects (9), p.28",
    legacySourceText: "",
    rawDataJson: JSON.stringify({
      headers: ["Company Name", "Contact Name", "Email", "Notes"],
      cells: [
        { column: "A", header: "Company Name", value: "Example Engineering Pty Ltd" },
        { column: "B", header: "Contact Name", value: "Attilio Pigneri" },
        { column: "C", header: "Email", value: "" },
        { column: "D", header: "Notes", value: "Keep exact  # and $ characters" },
      ],
    }),
    sourceSha256: "source-hash",
    ...overrides,
  };
}

test("linked source rows open their exact company and preserve every original field value", () => {
  const view = getSourceRecordPresentation(sourceRecord());

  assert.equal(view.companyHref, "/companies?companyId=company%201%2F2");
  assert.equal(view.hasOriginalSnapshot, true);
  assert.deepEqual(
    view.originalFields.map(({ label, value }) => [label, value]),
    [
      ["Company Name", "Example Engineering Pty Ltd"],
      ["Contact Name", "Attilio Pigneri"],
      ["Email", ""],
      ["Notes", "Keep exact  # and $ characters"],
    ],
  );
});

test("unmatched original rows do not claim a company link", () => {
  const view = getSourceRecordPresentation(
    sourceRecord({ companyId: null, recordType: "SOURCE_ROW" }),
  );

  assert.equal(view.companyHref, null);
});

test("malformed source snapshots are reported as unavailable rather than silently empty", () => {
  const view = getSourceRecordPresentation(sourceRecord({ rawDataJson: "{" }));

  assert.equal(view.hasOriginalSnapshot, false);
  assert.deepEqual(view.originalFields, []);
  assert.equal(view.rawSnapshotText, "{");
});
