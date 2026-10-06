import { expect, test, type Page, type Route } from "@playwright/test";
import { SignJWT } from "jose";

const appUrl = "http://127.0.0.1:3127";
const testSecret = "local-playwright-only-secret-not-for-any-environment";

async function addLocalSession(page: Page) {
  const token = await new SignJWT({ authenticated: true, email: "qa@example.invalid" })
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setIssuedAt()
    .setExpirationTime("1h")
    .sign(new TextEncoder().encode(testSecret));
  await page.context().addCookies([
    { name: "pi_session", value: token, url: appUrl, httpOnly: true, sameSite: "Lax" },
  ]);
}

async function fulfillJson(route: Route, body: unknown) {
  await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) });
}

test("the Contacts tour stop explains Accepted and the Sheet approval flow", async ({ page }, testInfo) => {
  const writes: string[] = [];
  await addLocalSession(page);
  await page.route("**/api/auth/me", (route) => fulfillJson(route, { email: "qa@example.invalid" }));
  await page.route("**/internal/**", async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (request.method() !== "GET") writes.push(`${request.method()} ${path}`);
    if (path === "/internal/data/sync-status") {
      return fulfillJson(route, {
        connected: false,
        mode: "mock",
        spreadsheetId: null,
        companiesCount: 0,
        locationsCount: 0,
        contactsCount: 0,
        rejectionsCount: 0,
        syncLogEntries: 0,
        lastSync: null,
        state: "NEVER",
      });
    }
    if (path === "/internal/ops/provider-status") return fulfillJson(route, { services: [] });
    return fulfillJson(route, []);
  });

  await page.goto("/settings");
  await page.getByRole("button", { name: "Start tour", exact: true }).click();
  const popover = page.locator(".driver-popover");
  await expect(popover.locator(".driver-popover-title")).toHaveText("Find prospects");

  for (const title of ["Follow-up reminders", "Review companies", "Check business sites", "Find the right person"]) {
    await popover.locator(".driver-popover-next-btn").click();
    await expect(popover.locator(".driver-popover-title")).toHaveText(title);
  }

  const description = popover.locator(".driver-popover-description");
  await expect(description).toContainText("Accepted");
  await expect(description).toContainText("company details");
  await expect(description).toContainText("Sheet sync status");
  await page.screenshot({ path: testInfo.outputPath("tour-contacts-accepted-guidance.png"), fullPage: true, animations: "disabled" });
  expect(writes).toEqual([]);
});

test("accepted filter shows only approved contacts and composes with priority and search", async ({ page }, testInfo) => {
  const contacts = Array.from({ length: 51 }, (_, index) => {
    const number = index + 1;
    const accepted = number === 2 || number === 51;
    return {
      contactId: `contact-${number}`,
      companyId: `company-${number}`,
      locationId: `location-${number}`,
      name: number === 51 ? "Zoe Accepted" : number === 2 ? "Alex Accepted" : `Contact ${String(number).padStart(3, "0")}`,
      position: number === 51 ? "Maintenance Manager" : "Engineer",
      roleBucket: "operations",
      rolePriority: number === 51 ? "SECONDARY" : "PRIORITY",
      businessEmail: `contact${number}@example.invalid`,
      mobile: "",
      landline: "",
      professionalUrl: "",
      contactStatus: accepted ? "APPROVED" : number === 3 ? "VERIFIED" : number === 4 ? "REJECTED" : number === 5 ? "STALE" : number === 6 ? "LEFT_COMPANY" : "NEW",
      lastVerified: null,
      lastModified: "2026-10-06T00:00:00Z",
      professionalUrlRaw: "",
      sourceProvenance: "synthetic Playwright fixture",
      sourceQualityFlags: "",
    };
  });
  const companies = contacts.map((contact, index) => ({
    companyId: contact.companyId,
    abn: "",
    companyName: `Synthetic Company ${index + 1}`,
    normalizedName: `synthetic company ${index + 1}`,
    tradingName: "",
    website: "",
    industry: "Engineering",
    abnStatus: "",
    status: "NEW",
    industryFit: "TARGET",
    priority: 1,
    source: "PLAYWRIGHT_FIXTURE",
    lastVerified: "",
    lastModified: "2026-10-06T00:00:00Z",
    notes: "",
    sourceVerification: "",
    businessLandlines: "",
    businessPhone: "",
    businessEmail: "",
    legacySourceText: "",
    sourceProvenance: "synthetic Playwright fixture",
    sourceQualityFlags: "",
    country: "Australia",
    countryCode: "AU",
  }));
  const writes: string[] = [];

  await addLocalSession(page);
  await page.route("**/api/auth/me", (route) => fulfillJson(route, { email: "qa@example.invalid" }));
  await page.route("**/internal/**", async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (request.method() !== "GET") writes.push(`${request.method()} ${path}`);
    if (path === "/internal/data/contacts") return fulfillJson(route, contacts);
    if (path === "/internal/data/companies") return fulfillJson(route, companies);
    if (path === "/internal/data/sync-status") {
      return fulfillJson(route, {
        connected: false,
        mode: "mock",
        spreadsheetId: null,
        companiesCount: companies.length,
        locationsCount: 0,
        contactsCount: contacts.length,
        rejectionsCount: 0,
        syncLogEntries: 0,
        lastSync: null,
        state: "NEVER",
      });
    }
    return fulfillJson(route, []);
  });

  await page.goto("/contacts");
  await expect(page.getByRole("heading", { name: "Contacts", exact: true, level: 1 })).toBeVisible();
  await expect(page.locator("tbody tr")).toHaveCount(50);
  await page.getByRole("button", { name: "Next", exact: true }).click();
  await expect(page.getByText("Zoe Accepted", { exact: true })).toBeVisible();

  await page.getByLabel("Status").selectOption("APPROVED");
  await expect(page.locator("tbody tr")).toHaveCount(2);
  await expect(page.getByText("Alex Accepted", { exact: true })).toBeVisible();
  await expect(page.getByText("Zoe Accepted", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Next", exact: true })).toHaveCount(0);
  await page.screenshot({ path: testInfo.outputPath("contacts-accepted-filter.png"), fullPage: true, animations: "disabled" });

  const priorityGroup = page.getByRole("group", { name: "Filter contacts by priority" });
  await priorityGroup.getByRole("button", { name: "Secondary", exact: true }).click();
  await expect(page.locator("tbody tr")).toHaveCount(1);
  await expect(page.getByText("Zoe Accepted", { exact: true })).toBeVisible();

  await page.getByRole("textbox", { name: "Search contacts" }).fill("alex@example.invalid");
  await expect(page.getByText("No accepted contacts match these filters", { exact: true })).toBeVisible();

  await priorityGroup.getByRole("button", { name: "All", exact: true }).click();
  await page.getByRole("textbox", { name: "Search contacts" }).fill("");
  await expect(page.getByText("Alex Accepted", { exact: true })).toBeVisible();
  expect(writes).toEqual([]);
});
