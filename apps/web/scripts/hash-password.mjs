#!/usr/bin/env node
// Emergency password set/reset, run directly on the server via SSH.
//
// The normal path is the in-app "set up your password" / "forgot password"
// flow (OTP to the account's email, then choose a new password) -- this
// script is the fallback for when that path is unusable (e.g. SMTP is down)
// and whoever has SSH access to the box needs to unblock an account owner
// directly. SSH access is itself the authentication factor here, same as
// it would be for editing .env by hand. This does NOT add a new allowed
// account -- the email must already be listed in AUTH_ALLOWED_EMAILS.
//
// Usage (run from apps/web/):
//
//   node scripts/hash-password.mjs "email@example.com" "the-new-password"
//
// Writes the bcrypt hash straight into the credential store
// (apps/web/data/auth-credentials.json by default, or
// $AUTH_CREDENTIAL_STORE_PATH if set) so it takes effect immediately --
// no restart needed, no env var to edit.
import bcrypt from "bcryptjs";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const email = process.argv[2];
const password = process.argv[3];

if (!email || !password) {
  console.error('Usage: node scripts/hash-password.mjs "email@example.com" "<new-password>"');
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

let store = { accounts: {} };
if (existsSync(storeFile)) {
  try {
    const parsed = JSON.parse(readFileSync(storeFile, "utf-8"));
    if (parsed && typeof parsed.accounts === "object" && parsed.accounts !== null) {
      store = parsed;
    }
  } catch {
    // Corrupt file -- start fresh rather than crash or silently keep bad data.
  }
}

const key = email.trim().toLowerCase();
store.accounts[key] = { passwordHash: hash, updatedAt: new Date().toISOString() };

mkdirSync(path.dirname(storeFile), { recursive: true });
writeFileSync(storeFile, JSON.stringify(store, null, 2), { mode: 0o600 });

console.log(`Password set for ${email}. Written to ${storeFile}`);
console.log("Never paste the plaintext password anywhere else -- this file now holds only its bcrypt hash.");
