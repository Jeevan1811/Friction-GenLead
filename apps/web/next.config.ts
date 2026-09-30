import type { NextConfig } from "next";
import path from "node:path";

const nextConfig: NextConfig = {
  // Build beside the serving bundle during a scoped production release.
  // Swap the completed directory to .next; never persist this flag in PM2.
  distDir: process.env.GENLEAD_STAGED_BUILD === "1" ? ".next-staged" : ".next",
  transpilePackages: ["@pi/contracts"],
  // Without this, Next infers the workspace root from the nearest lockfile
  // it finds walking up from here -- on this machine that resolves to a
  // stray C:\Users\<user>\package-lock.json well above the repo, which in
  // local dev caused route discovery under src/app to silently miss pages
  // (e.g. /login 404ing despite the file existing). Pinning it to the
  // actual monorepo root removes the ambiguity.
  outputFileTracingRoot: path.join(__dirname, "..", ".."),
};
export default nextConfig;
