#!/usr/bin/env node
// Emergency password set/reset, run directly on the server via SSH.
//
// The normal path is the in-app "set up your password" / "forgot password"
// flow (OTP to AUTH_EMAIL, then choose a new password) -- this script is
// the fallback for when that path is unusable (e.g. SMTP is down) and
// whoever has SSH access to the box needs to unblock the account owner
// directly. SSH access is itself the authentication factor here, same as
// it would be for editing .env by hand.
//
// Usage (run from apps/web/):
//
//   node scripts/hash-password.mjs "the-new-password"
//
// Writes the bcrypt hash straight into the credential store
// (apps/web/data/auth-credentials.json by default, or
// $AUTH_CREDENTIAL_STORE_PATH if set) so it takes effect immediately --
// no restart needed, no env var to edit.
import bcrypt from "bcryptjs";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

const password = process.argv[2];

if (!password) {
  console.error("Usage: node scripts/hash-password.mjs <new-password>");
  process.exit(1);
}
if (password.length < 8) {
  console.error("Password must be at least 8 characters.");
  process.exit(1);
}

const SALT_ROUNDS = 12;
const hash = bcrypt.hashSync(password, SALT_ROUNDS);

const storeFile =
  process.env.AUTH_CREDENTIAL_STORE_PATH ||
  path.join(process.cwd(), "data", "auth-credentials.json");

mkdirSync(path.dirname(storeFile), { recursive: true });
writeFileSync(
  storeFile,
  JSON.stringify({ passwordHash: hash, updatedAt: new Date().toISOString() }, null, 2),
  { mode: 0o600 }
);

console.log(`Password set. Written to ${storeFile}${existsSync(storeFile) ? "" : " (new file)"}`);
console.log("Never paste the plaintext password anywhere else -- this file now holds only its bcrypt hash.");
