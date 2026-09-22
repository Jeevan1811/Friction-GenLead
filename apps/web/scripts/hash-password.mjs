#!/usr/bin/env node
// Prints a bcrypt hash for a plaintext password, for pasting into
// AUTH_PASSWORD_HASH in .env. Usage:
//
//   node scripts/hash-password.mjs "the-actual-password"
//
// Run from apps/web/ (or anywhere — it resolves bcryptjs relative to this
// file, same as the workspace hoisting the rest of the app uses).
import bcrypt from "bcryptjs";

const password = process.argv[2];

if (!password) {
  console.error("Usage: node scripts/hash-password.mjs <password>");
  process.exit(1);
}

const SALT_ROUNDS = 12;
const hash = bcrypt.hashSync(password, SALT_ROUNDS);
console.log(hash);
