import assert from "node:assert/strict";
import test from "node:test";
import { buildGoogleSheetUrl } from "../src/lib/google-sheets-link.mjs";

test("builds a fixed-host Google Sheets URL from the configured spreadsheet id", () => {
  assert.equal(
    buildGoogleSheetUrl("1LWY2AlvBGv9QRAb6gkFivw6rKVIg5Z0DsFLnF9glIkY"),
    "https://docs.google.com/spreadsheets/d/1LWY2AlvBGv9QRAb6gkFivw6rKVIg5Z0DsFLnF9glIkY/edit",
  );
});

test("hides the shortcut when the id is absent or malformed", () => {
  assert.equal(buildGoogleSheetUrl(null), null);
  assert.equal(buildGoogleSheetUrl("   "), null);
  assert.equal(buildGoogleSheetUrl("abc/../../example.com"), null);
  assert.equal(buildGoogleSheetUrl("javascript:alert(1)"), null);
});
