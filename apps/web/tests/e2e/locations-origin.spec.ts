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

test("the map distinguishes workbook, public-source, mixed, and unknown-origin locations", async ({ page }, testInfo) => {
  const pageErrors: string[] = [];
  let reclassifyUnknownOrigin = false;
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await addLocalSession(page);
  await page.route("https://tile.openstreetmap.org/**", (route) => route.abort());
  await page.route("**/internal/**", async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === "/internal/data/companies") {
      return fulfillJson(route, [
        { companyId: "cmp-saved", companyName: "Workbook Company", source: "LEGACY_EXCEL" },
        { companyId: "cmp-public", companyName: "New Prospect", source: "OVERTURE_MAPS" },
        { companyId: "cmp-public-only", companyName: "Another Prospect", source: "FIRECRAWL_SEARCH" },
        { companyId: "cmp-unknown", companyName: "Unknown Origin", source: reclassifyUnknownOrigin ? "LEGACY_EXCEL" : "" },
      ]);
    }
    if (url.pathname === "/internal/data/locations") {
      return fulfillJson(route, [
        { locationId: "loc-saved", companyId: "cmp-saved", siteName: "Workbook site", locationType: "PLANT", state: "QLD", postcode: "4076", verificationStatus: "UNVERIFIED", lat: -27.59, lng: 152.93 },
        { locationId: "loc-public", companyId: "cmp-public", siteName: "Public-source site", locationType: "PLANT", state: "QLD", postcode: "4076", verificationStatus: "UNVERIFIED", lat: -27.59, lng: 152.93 },
        { locationId: "loc-public-only", companyId: "cmp-public-only", siteName: "Another public site", locationType: "OFFICE", state: "QLD", postcode: "4076", verificationStatus: "UNVERIFIED", lat: -27.58, lng: 152.94 },
        { locationId: "loc-unknown", companyId: "cmp-unknown", siteName: "Unclassified site", locationType: "OTHER", state: "QLD", postcode: "4076", verificationStatus: "UNVERIFIED", lat: -27.57, lng: 152.95 },
      ]);
    }
    return fulfillJson(route, {});
  });

  await page.goto("/locations");
  await expect(page.getByRole("list", { name: "Map marker legend" })).toBeVisible();
  await expect(page.getByText("From MSV’s workbook", { exact: true })).toBeVisible();
  await expect(page.getByText("Public-source prospect", { exact: true })).toBeVisible();
  await expect(page.getByText("Origin not recorded", { exact: true })).toBeVisible();
  await expect(page.locator(".genlead-map-summary")).toBeVisible();
  await expect(page.getByText("Loading map…", { exact: true })).toHaveCount(0);
  await expect(page.locator(".genlead-map-card .genlead-map-marker--mixed")).toHaveCount(1);
  await expect(page.locator(".genlead-map-card .genlead-map-marker--prospect")).toHaveCount(1);
  await expect(page.locator(".genlead-map-card .genlead-map-marker--unknown")).toHaveCount(1);
  await page.screenshot({ path: testInfo.outputPath("locations-origin-map.png"), fullPage: true, animations: "disabled" });

  await page.locator(".genlead-map-card .genlead-map-marker--mixed").click();
  const popup = page.locator(".leaflet-popup-content");
  await expect(popup.getByText("Workbook site", { exact: true })).toBeVisible();
  await expect(popup.getByText("Public-source site", { exact: true })).toBeVisible();

  // Company metadata can refresh while the location rows stay identical.
  // The map marker and legend must reclassify when that source metadata changes.
  reclassifyUnknownOrigin = true;
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(page.locator(".genlead-map-card .genlead-map-marker--unknown")).toHaveCount(0);
  await expect(page.locator(".genlead-map-card .genlead-map-marker--saved")).toHaveCount(1);

  await page.getByRole("combobox").first().selectOption("PLANT");
  await expect(page.locator(".genlead-map-summary")).toContainText("2 of 2 matching locations mapped");
  await expect(page.locator(".genlead-map-card .genlead-map-marker--mixed")).toHaveCount(1);
  await expect(page.locator(".genlead-map-card .genlead-map-marker--prospect")).toHaveCount(0);
  await expect(page.locator(".genlead-map-card .genlead-map-marker--unknown")).toHaveCount(0);
  await expect.poll(() => pageErrors).toEqual([]);
});
