// Copies Cesium's static runtime assets (Workers, ThirdParty, Assets, Widgets)
// from node_modules into public/cesium so they can be served at runtime.
// Cesium loads these via window.CESIUM_BASE_URL at runtime, not through webpack,
// so a plain filesystem copy is simpler and more reliable than a bundler plugin.
import { existsSync, cpSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const webRoot = join(__dirname, "..");
const destRoot = join(webRoot, "public", "cesium");

// In an npm workspace, "cesium" may be hoisted to the repo root's
// node_modules instead of apps/web/node_modules, depending on the
// dependency tree at install time. Check both locations.
const candidates = [
  join(webRoot, "node_modules", "cesium", "Build", "Cesium"),
  join(webRoot, "..", "..", "node_modules", "cesium", "Build", "Cesium"),
];
const cesiumSrc = candidates.find((p) => existsSync(p));

const dirsToCopy = ["Workers", "ThirdParty", "Assets", "Widgets"];

if (!cesiumSrc) {
  console.warn(
    `[copy-cesium-assets] Skipping: cesium package not found in any of:\n` +
      candidates.map((p) => `  - ${p}`).join("\n") +
      `\nDid "cesium" install correctly?`
  );
  process.exit(0);
}

mkdirSync(destRoot, { recursive: true });

for (const dir of dirsToCopy) {
  const src = join(cesiumSrc, dir);
  const dest = join(destRoot, dir);
  if (!existsSync(src)) {
    console.warn(`[copy-cesium-assets] Skipping missing directory: ${src}`);
    continue;
  }
  cpSync(src, dest, { recursive: true });
  console.log(`[copy-cesium-assets] Copied ${dir} -> public/cesium/${dir}`);
}

console.log("[copy-cesium-assets] Done.");
