import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const apiSource = readFileSync(new URL("../src/lib/api.ts", import.meta.url), "utf8");

test("authenticated Sheet-backed reads bypass the browser HTTP cache", () => {
  assert.match(apiSource, /credentials: "include",[\s\S]*?cache: "no-store"/);
});
