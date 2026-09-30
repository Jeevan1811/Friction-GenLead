import { expect, test, type Page, type Route } from "@playwright/test";
import { SignJWT } from "jose";

const appUrl = "http://127.0.0.1:3127";
const testSecret = "local-playwright-only-secret-not-for-any-environment";
const spreadsheetId = "synthetic-read-only-fixture";

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

function syncStatus(withSpreadsheet = true) {
  return {
    connected: withSpreadsheet,
    mode: withSpreadsheet ? "live" : "mock",
    spreadsheetId: withSpreadsheet ? spreadsheetId : null,
    companiesCount: 0,
    locationsCount: 0,
    contactsCount: 0,
    rejectionsCount: 0,
    syncLogEntries: 0,
    lastSync: null,
    state: withSpreadsheet ? "SYNCED" : "ERROR",
  };
}

async function mockDashboardReads(page: Page, withSpreadsheet = true) {
  await page.route("**/internal/**", async (route) => {
    const pathname = new URL(route.request().url()).pathname;
    if (pathname === "/internal/data/sync-status") return fulfillJson(route, syncStatus(withSpreadsheet));
    if (
      pathname === "/internal/data/locations" ||
      pathname === "/internal/data/companies" ||
      pathname === "/internal/data/follow-ups"
    ) {
      return fulfillJson(route, []);
    }
    if (pathname === "/internal/ops/jobs") return fulfillJson(route, []);
    return fulfillJson(route, {});
  });
}

test("mobile More navigation is accessible, routes correctly, and stays within a narrow viewport", async ({ page }, testInfo) => {
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await page.setViewportSize({ width: 375, height: 812 });
  await addLocalSession(page);
  await mockDashboardReads(page);
  await page.goto("/locations");

  const mainNav = page.getByRole("navigation", { name: "Main navigation" });
  const moreButton = page.getByRole("button", { name: "More navigation" });
  const moreMenu = page.locator("#mobile-more-menu");
  await expect(mainNav).toBeVisible();
  await expect(page.getByRole("complementary", { name: "Desktop navigation" })).toHaveCount(0);
  await expect(moreButton).toHaveAttribute("aria-expanded", "false");

  await moreButton.click();
  await expect(moreButton).toHaveAttribute("aria-expanded", "true");
  await expect(moreMenu.getByRole("link", { name: "Locations", exact: true })).toBeVisible();
  await expect(moreMenu.getByRole("link", { name: "Follow-ups", exact: true })).toBeVisible();
  await expect(moreMenu.getByRole("link", { name: "Rejected", exact: true })).toBeVisible();
  const sheetLink = moreMenu.getByRole("link", { name: "Open the live Google Sheet" });
  await expect(sheetLink).toHaveAttribute(
    "href",
    `https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit`,
  );
  await page.screenshot({
    path: testInfo.outputPath("mobile-more-menu.png"),
    fullPage: true,
    animations: "disabled",
  });

  await page.keyboard.press("Escape");
  await expect(moreMenu).toBeHidden();
  await expect(moreButton).toBeFocused();

  await moreButton.click();
  await moreMenu.getByRole("link", { name: "Follow-ups", exact: true }).click();
  await expect(page).toHaveURL(/\/follow-ups$/);
  await expect(moreMenu).toBeHidden();

  for (const width of [375, 320]) {
    await page.setViewportSize({ width, height: 812 });
    await expect(mainNav).toBeVisible();
    const dimensions = await page.evaluate(() => ({
      viewport: document.documentElement.clientWidth,
      content: document.documentElement.scrollWidth,
    }));
    expect(dimensions.content, `horizontal overflow at ${width}px`).toBeLessThanOrEqual(dimensions.viewport);
  }
  expect(pageErrors).toEqual([]);
});

test("mobile More menu omits the Sheet shortcut when sync has no spreadsheet ID", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await addLocalSession(page);
  await mockDashboardReads(page, false);
  await page.goto("/locations");

  const moreButton = page.getByRole("button", { name: "More navigation" });
  await expect(moreButton).toBeVisible();
  await moreButton.click();
  const moreMenu = page.locator("#mobile-more-menu");
  await expect(moreMenu.getByRole("link", { name: "Open the live Google Sheet" })).toHaveCount(0);
  await expect(moreMenu.getByRole("link", { name: "Locations", exact: true })).toBeVisible();
});
