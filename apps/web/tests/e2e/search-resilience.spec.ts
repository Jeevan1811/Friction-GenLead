import { expect, test, type Page, type Route } from "@playwright/test";
import { SignJWT } from "jose";

const appUrl = "http://127.0.0.1:3127";
const testSecret = "local-playwright-only-secret-not-for-any-environment";
const testJobId = "e2e-search-job-001";

async function addLocalSession(page: Page) {
  const token = await new SignJWT({ authenticated: true, email: "qa@example.invalid" })
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setIssuedAt()
    .setExpirationTime("1h")
    .sign(new TextEncoder().encode(testSecret));
  await page.context().addCookies([
    {
      name: "pi_session",
      value: token,
      url: appUrl,
      httpOnly: true,
      sameSite: "Lax",
    },
  ]);
}

function runningStatus() {
  return {
    job_id: testJobId,
    location: "Mackay, Queensland",
    postcode: "",
    industry: "Valve-focused",
    status: "running",
    companies_found: 0,
    contacts_found: 0,
    steps: [
      { name: "discover", status: "running", result: null, error: null },
      { name: "verify", status: "pending", result: null, error: null },
      { name: "research_contacts", status: "pending", result: null, error: null },
      { name: "evaluate", status: "pending", result: null, error: null },
    ],
    warnings: [],
    errors: [],
  };
}

function completedStatus() {
  return {
    ...runningStatus(),
    status: "completed",
    steps: runningStatus().steps.map((step) => ({ ...step, status: "completed" })),
  };
}

async function fulfillJson(route: Route, body: unknown, status = 200) {
  await route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
}

async function fillLocationAndStart(page: Page) {
  await page.getByLabel(/city, region or postcode/i).fill("Mackay, Queensland");
  await page.getByRole("button", { name: "Search public sources" }).click();
}

test.beforeEach(async ({ page }) => {
  await addLocalSession(page);
});

test("remembered chat restores after hydration without replacing stored history", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.addInitScript(() => {
    sessionStorage.setItem("genlead-chat-messages", JSON.stringify([
      { role: "assistant", content: "Remembered synthetic QA answer" },
    ]));
  });
  await page.route("**/internal/**", route => fulfillJson(route, {}));
  await page.goto("/settings");
  await page.getByRole("button", { name: "Open chat", exact: true }).click();
  await expect(page.getByText("Remembered synthetic QA answer")).toBeVisible();
  await page.reload();
  await page.getByRole("button", { name: "Open chat", exact: true }).click();
  await expect(page.getByText("Remembered synthetic QA answer")).toBeVisible();
  expect(errors).toEqual([]);
});

test("failed Sheet reads do not show synced or negative record counts", async ({ page }) => {
  await page.route("**/internal/**", async route => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/internal/data/sync-status") return fulfillJson(route, {
      connected: true, mode: "live", state: "ERROR", companiesCount: -1,
      locationsCount: -1, contactsCount: -1, readErrors: ["companies", "locations", "contacts"],
    });
    return fulfillJson(route, {});
  });
  await page.goto("/settings");
  await expect(page.getByText("Could not check the connection")).toBeVisible();
  await expect(page.getByText("Connected to the live Google Sheet", { exact: true })).toHaveCount(0);
  await expect(page.getByText("-1", { exact: true })).toHaveCount(0);
});

test("Settings keeps service warnings visible and optional guidance on demand", async ({ page }) => {
  await page.route("**/internal/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/internal/data/sync-status") return fulfillJson(route, {
      connected: true, mode: "live", state: "SYNCED", companiesCount: 2,
      locationsCount: 2, contactsCount: 0, activitiesCount: 0, searchRunsCount: 1,
      sourceRecordsCount: 0,
    });
    if (path === "/internal/ops/provider-status") return fulfillJson(route, { services: [{
      id: "chatbot", name: "Chatbot", provider: "Example provider", model: "Example model",
      credential_status: "configured", state: "attention", message: "Service needs attention",
      next_step: "Check provider billing", checked_at: null,
    }] });
    return fulfillJson(route, {});
  });

  await page.goto("/settings");
  await expect(page.getByText("Service needs attention")).toBeVisible();
  await expect(page.getByText("Check provider billing")).toBeVisible();
  await expect(page.getByText("Credential values stay private.")).toHaveCount(0);
  await page.getByRole("button", { name: "About AI and research services" }).click();
  await expect(page.getByRole("dialog", { name: "About AI and research services" })).toContainText("Credential values stay private");
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "About Dashboard guide" }).click();
  await expect(page.getByRole("dialog", { name: "About Dashboard guide" })).toContainText("read-only tour");
});

test("search help is on demand and optional roles stay usable", async ({ page }) => {
  await page.route("**/internal/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/internal/ops/jobs") return fulfillJson(route, []);
    if (path === "/internal/data/sync-status") return fulfillJson(route, { connected: true, mode: "live", state: "SYNCED" });
    return fulfillJson(route, {});
  });
  await page.goto("/search");
  await expect(page.getByText("Unverified leads · review before contacting")).toBeVisible();
  await page.getByRole("button", { name: "About Search sources" }).click();
  await expect(page.getByRole("dialog", { name: "About Search sources" })).toContainText("Coverage varies");
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog", { name: "About Search sources" })).toHaveCount(0);

  const roles = page.locator("details.genlead-search-roles");
  await expect(roles).not.toHaveAttribute("open");
  await roles.locator("summary").click();
  await roles.getByRole("button", { name: "Plant Manager" }).click();
  await expect(roles.locator("summary")).toContainText("1 selected");
  await roles.locator("summary").click();
  await expect(roles).not.toHaveAttribute("open");
});

test("a slow status timeout stays understandable, retries once at a time, and completes", async ({ page }) => {
  let statusReads = 0;
  let activeStatusReads = 0;
  let maxConcurrentStatusReads = 0;
  const uncaughtPageErrors: string[] = [];
  page.on("pageerror", (error) => uncaughtPageErrors.push(error.message));

  await page.route("**/internal/**", async (route) => {
    const url = new URL(route.request().url());
    const method = route.request().method();

    if (url.pathname === "/internal/ops/jobs") return fulfillJson(route, []);
    if (url.pathname === "/internal/data/sync-status") {
      return fulfillJson(route, {
        connected: true,
        mode: "live",
        spreadsheetId: "synthetic-read-only-fixture",
        companiesCount: 0,
        locationsCount: 0,
        contactsCount: 0,
        rejectionsCount: 0,
        syncLogEntries: 0,
        lastSync: null,
        state: "SYNCED",
      });
    }
    if (url.pathname === "/internal/ops/research" && method === "POST") {
      return fulfillJson(route, { job_id: testJobId, status: "running", message: "Started" });
    }
    if (url.pathname === `/internal/ops/research/${testJobId}/results`) {
      return fulfillJson(route, {
        job_id: testJobId,
        location: "Mackay, Queensland",
        status: "completed",
        companies: [],
        contacts: [],
        warnings: [],
        errors: [],
      });
    }
    if (url.pathname === `/internal/ops/research/${testJobId}` && method === "GET") {
      statusReads += 1;
      activeStatusReads += 1;
      maxConcurrentStatusReads = Math.max(maxConcurrentStatusReads, activeStatusReads);
      try {
        if (statusReads === 1) {
          return route.fulfill({ status: 504, body: "" });
        }
        return fulfillJson(route, statusReads >= 3 ? completedStatus() : runningStatus());
      } finally {
        activeStatusReads -= 1;
      }
    }
    return fulfillJson(route, {});
  });

  await page.goto("/search");
  await fillLocationAndStart(page);
  await expect(page.getByRole("button", { name: "Search in progress..." })).toBeDisabled();
  await expect(page.getByText(/search service took too long to respond/i)).toBeVisible({ timeout: 10_000 });
  await page.getByRole("button", { name: "Retry now" }).click();
  await expect(page.getByText(/search service took too long to respond/i)).toHaveCount(0);
  await expect.poll(() => statusReads, { timeout: 10_000 }).toBeGreaterThanOrEqual(3);
  await expect(page.getByText("No new companies were found in this search.", { exact: true })).toBeVisible({ timeout: 10_000 });

  expect(maxConcurrentStatusReads).toBe(1);
  expect(uncaughtPageErrors).toEqual([]);
});

test("a status request slower than the old poll interval never overlaps", async ({ page }) => {
  let statusReads = 0;
  let activeStatusReads = 0;
  let maxConcurrentStatusReads = 0;

  await page.route("**/internal/**", async (route) => {
    const url = new URL(route.request().url());
    const method = route.request().method();
    if (url.pathname === "/internal/ops/jobs") return fulfillJson(route, []);
    if (url.pathname === "/internal/data/sync-status") return fulfillJson(route, {});
    if (url.pathname === "/internal/ops/research" && method === "POST") {
      return fulfillJson(route, { job_id: testJobId, status: "running", message: "Started" });
    }
    if (url.pathname === `/internal/ops/research/${testJobId}`) {
      statusReads += 1;
      activeStatusReads += 1;
      maxConcurrentStatusReads = Math.max(maxConcurrentStatusReads, activeStatusReads);
      try {
        if (statusReads === 1) await new Promise((resolve) => setTimeout(resolve, 3200));
        return fulfillJson(route, runningStatus());
      } finally {
        activeStatusReads -= 1;
      }
    }
    return fulfillJson(route, {});
  });

  await page.goto("/search");
  await fillLocationAndStart(page);
  await expect.poll(() => statusReads, { timeout: 10_000 }).toBeGreaterThanOrEqual(2);
  expect(maxConcurrentStatusReads).toBe(1);
});

test("an active search resumes after reload and blocks duplicate searches", async ({ page }) => {
  let startRequests = 0;
  let statusReads = 0;

  await page.route("**/internal/**", async (route) => {
    const url = new URL(route.request().url());
    const method = route.request().method();
    if (url.pathname === "/internal/ops/jobs") return fulfillJson(route, []);
    if (url.pathname === "/internal/data/sync-status") return fulfillJson(route, {});
    if (url.pathname === "/internal/ops/research" && method === "POST") {
      startRequests += 1;
      return fulfillJson(route, { job_id: testJobId, status: "running", message: "Started" });
    }
    if (url.pathname === `/internal/ops/research/${testJobId}`) {
      statusReads += 1;
      return fulfillJson(route, runningStatus());
    }
    return fulfillJson(route, {});
  });

  await page.goto("/search");
  await fillLocationAndStart(page);
  await expect.poll(() => statusReads).toBeGreaterThan(0);
  await expect(page.getByRole("button", { name: "Search in progress..." })).toBeDisabled();

  await page.reload();
  await expect.poll(() => statusReads).toBeGreaterThan(1);
  await page.getByLabel(/city, region or postcode/i).fill("Rockhampton, Queensland");
  await expect(page.getByRole("button", { name: "Search in progress..." })).toBeDisabled();
  expect(startRequests).toBe(1);
});

test("a recovered interrupted job explains what happened and releases the search form", async ({ page }) => {
  await page.route("**/internal/**", async (route) => {
    const url = new URL(route.request().url());
    const method = route.request().method();
    if (url.pathname === "/internal/ops/jobs") return fulfillJson(route, []);
    if (url.pathname === "/internal/data/sync-status") return fulfillJson(route, {});
    if (url.pathname === "/internal/ops/research" && method === "POST") {
      return fulfillJson(route, { job_id: testJobId, status: "running", message: "Started" });
    }
    if (url.pathname === `/internal/ops/research/${testJobId}`) {
      return fulfillJson(route, {
        ...runningStatus(),
        status: "interrupted",
        errors: [
          "The server restarted while this search was running. Companies already saved remain available; review Companies before starting a replacement search.",
        ],
      });
    }
    return fulfillJson(route, {});
  });

  await page.goto("/search");
  await fillLocationAndStart(page);
  const recoveryNotice = page
    .getByRole("main")
    .locator("div[role='status']")
    .filter({ hasText: /server restarted while this search was running/i });
  await expect(recoveryNotice).toBeVisible();
  await expect(page.getByRole("button", { name: "Search public sources" })).toBeEnabled();
});

test("a missing job stops futile retries and explains the safe next step", async ({ page }) => {
  let statusReads = 0;
  await page.route("**/internal/**", async (route) => {
    const url = new URL(route.request().url());
    const method = route.request().method();
    if (url.pathname === "/internal/ops/jobs") return fulfillJson(route, []);
    if (url.pathname === "/internal/data/sync-status") return fulfillJson(route, {});
    if (url.pathname === "/internal/ops/research" && method === "POST") {
      return fulfillJson(route, { job_id: testJobId, status: "running", message: "Started" });
    }
    if (url.pathname === `/internal/ops/research/${testJobId}`) {
      statusReads += 1;
      return fulfillJson(route, { detail: "Job not found" }, 404);
    }
    return fulfillJson(route, {});
  });

  await page.goto("/search");
  await fillLocationAndStart(page);
  await expect(page.getByText(/this search is no longer available/i)).toBeVisible();
  await expect(page.getByRole("button", { name: "Search public sources" })).toBeEnabled();
  await page.waitForTimeout(3200);
  expect(statusReads).toBe(1);
});

test("a completed area search keeps saved workbook matches separate from new prospects", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.route("**/internal/**", async (route) => {
    const url = new URL(route.request().url());
    const method = route.request().method();

    if (url.pathname === "/internal/ops/jobs") return fulfillJson(route, []);
    if (url.pathname === "/internal/data/sync-status") return fulfillJson(route, {});
    if (url.pathname === "/internal/ops/research" && method === "POST") {
      return fulfillJson(route, { job_id: testJobId, status: "running", message: "Started" });
    }
    if (url.pathname === `/internal/ops/research/${testJobId}/results`) {
      return fulfillJson(route, {
        job_id: testJobId,
        location: "Wacol, Queensland",
        status: "completed",
        companies: [
          { company_id: "cmp-new", company_name: "New Wacol Engineering", source: "OVERTURE_MAPS", postcode: "4076" },
        ],
        known_companies: [
          {
            company_id: "cmp-saved",
            company_name: "Allnex",
            source: "LEGACY_EXCEL",
            matched_locations: [{ suburb: "Wacol", state: "QLD", postcode: "4076" }],
          },
        ],
        known_matches_available: true,
        contacts: [],
        warnings: [],
        errors: [],
      });
    }
    if (url.pathname === `/internal/ops/research/${testJobId}`) {
      return fulfillJson(route, {
        ...completedStatus(),
        known_companies_found: 1,
        known_matches_available: true,
      });
    }
    return fulfillJson(route, {});
  });

  await page.goto("/search");
  await fillLocationAndStart(page);

  const savedSection = page.getByRole("region", { name: "Already on your list" });
  const newSection = page.getByRole("region", { name: "New companies found" });
  await expect(savedSection.getByText("Allnex")).toBeVisible({ timeout: 10_000 });
  await expect(savedSection.getByText(/Wacol, QLD, 4076/)).toBeVisible();
  await expect(newSection.getByText("New Wacol Engineering")).toBeVisible();
  await expect(savedSection.getByRole("link", { name: "View saved matches" })).toHaveAttribute("href", /cohort=known/);
  await expect(newSection.getByRole("heading", { name: /New companies found/ })).toBeVisible();
  await expect(newSection.getByRole("link", { name: "View new companies" })).toHaveAttribute("href", /researchRun=/);
  const dimensions = await page.evaluate(() => ({
    viewport: document.documentElement.clientWidth,
    content: document.documentElement.scrollWidth,
  }));
  expect(dimensions.content, "area search results should not overflow a phone viewport").toBeLessThanOrEqual(dimensions.viewport);
  await page.locator("div.surface-card").filter({ has: savedSection }).last().screenshot({
    path: testInfo.outputPath("saved-and-new-area-results.png"),
    animations: "disabled",
  });
});
