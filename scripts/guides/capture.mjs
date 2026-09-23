// Captures the assistant's guide screenshots into apps/web/public/guides/.
//
// Runs against the DEMO backend (fictional data) -- see demo_backend.py --
// and a locally running frontend. Never run this against the live site.
//
// Usage (see scripts/guides/README.md):
//   PW_DIR=<dir with playwright installed> AUTH_JWT_SECRET=<secret> node scripts/guides/capture.mjs
import { createRequire } from "node:module";
import { createHmac } from "node:crypto";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(path.join(process.env.PW_DIR, "/"));
const { chromium } = require("playwright");

const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const OUT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../apps/web/public/guides");
const SECRET = process.env.AUTH_JWT_SECRET;
if (!SECRET) throw new Error("AUTH_JWT_SECRET is required");
if (!/^https?:\/\/(localhost|127\.0\.0\.1)/.test(BASE)) throw new Error("Refusing to capture from a non-local site");
mkdirSync(OUT, { recursive: true });

const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
const head = b64({ alg: "HS256", typ: "JWT" });
const body = b64({ authenticated: true, iat: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + 3600 });
const sig = createHmac("sha256", SECRET).update(`${head}.${body}`).digest("base64url");
const TOKEN = `${head}.${body}.${sig}`;

const browser = await chromium.launch({ channel: "chrome" });
const ctx = await browser.newContext({ viewport: { width: 1100, height: 680 }, deviceScaleFactor: 1 });
const page = await ctx.newPage();

const shot = async (id) => {
  await page.screenshot({ path: path.join(OUT, `${id}.png`) });
  console.log("captured", id);
};
const highlight = (selectorFnSource) =>
  page.evaluate((src) => {
    const els = new Function(`return (${src})()`)();
    for (const el of [].concat(els).filter(Boolean)) {
      el.style.outline = "3px solid #E11D48";
      el.style.outlineOffset = "3px";
      el.style.borderRadius = "8px";
    }
  }, selectorFnSource);
const clearHighlights = () =>
  page.evaluate(() => {
    document.querySelectorAll("*").forEach((e) => {
      if (e.style && e.style.outline && e.style.outline.includes("rgb(225, 29, 72)")) {
        e.style.outline = "";
        e.style.outlineOffset = "";
      }
    });
  });
const byText = (sel, text) =>
  `() => [...document.querySelectorAll('${sel}')].filter(e => e.innerText.trim() === '${text}')`;

// --- public: login -------------------------------------------------------
await page.goto(`${BASE}/login`, { waitUntil: "networkidle" });
await shot("login");

// --- authenticated ---------------------------------------------------------
await ctx.addCookies([{ name: "pi_session", value: TOKEN, domain: "localhost", path: "/" }]);

// Seed two (sample) research runs so the Search page has history.
for (const postcode of ["4680", "4715"]) {
  await page.request.post("http://localhost:8001/internal/ops/research", {
    data: { postcode, industry: null, roles: [] },
    headers: { cookie: `pi_session=${TOKEN}` },
  });
}

await page.goto(`${BASE}/companies`, { waitUntil: "networkidle" });
await page.waitForSelector("tbody tr");
await shot("companies-list");

await highlight(`() => document.querySelector('input[placeholder="Search companies..."]')`);
await page.fill('input[placeholder="Search companies..."]', "northern");
await page.waitForTimeout(400);
await shot("companies-search");

await clearHighlights();
await page.click("tbody tr");
await page.waitForTimeout(700);
await shot("companies-detail");

// Point at the Approve / Reject buttons (not clicked).
await highlight(`() => [...document.querySelectorAll('button')].filter(b => ['Approve','Reject'].includes(b.innerText.trim())).slice(0, 2)`);
await page.evaluate(() => {
  const b = [...document.querySelectorAll("button")].find((x) => x.innerText.trim() === "Approve");
  b?.scrollIntoView({ block: "center" });
});
await page.waitForTimeout(300);
await shot("approve-reject");

await page.goto(`${BASE}/locations`, { waitUntil: "networkidle" });
await page.waitForTimeout(800);
await shot("locations");

await page.goto(`${BASE}/contacts`, { waitUntil: "networkidle" });
await page.waitForSelector("tbody tr");
await highlight(byText("button", "All") + " ");
await shot("contacts");

await page.goto(`${BASE}/rejected`, { waitUntil: "networkidle" });
await page.waitForTimeout(800);
await shot("rejected");

await page.goto(`${BASE}/search`, { waitUntil: "networkidle" });
await page.waitForTimeout(800);
await highlight(byText("button", "Start Research"));
await shot("search");

await page.goto(`${BASE}/companies`, { waitUntil: "networkidle" });
await page.waitForTimeout(800);
await highlight(`() => [...document.querySelectorAll('aside *')].find(e => e.children.length === 0 && e.innerText?.trim() === 'Synced')?.parentElement`);
await shot("sheet-sync");

await browser.close();
console.log("done ->", OUT);
