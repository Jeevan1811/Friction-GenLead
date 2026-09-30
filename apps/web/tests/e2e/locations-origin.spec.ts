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
  const requestedZooms = new Set<number>();
  let reclassifyUnknownOrigin = false;
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await addLocalSession(page);
  await page.route("https://tile.openstreetmap.org/**", async (route) => {
    const [, zoom] = new URL(route.request().url()).pathname.split("/");
    const zoomLevel = Number(zoom);
    if (Number.isFinite(zoomLevel)) requestedZooms.add(zoomLevel);
    await route.abort();
  });
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
  await expect(page.getByText("Source not recorded", { exact: true })).toBeVisible();
  await expect(page.locator(".genlead-map-summary")).toBeVisible();
  await expect(page.getByText("Loading map…", { exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Zoom to results" })).toBeVisible();
  await expect.poll(() => requestedZooms.has(2)).toBe(true);
  expect([...requestedZooms].every((zoom) => zoom === 2)).toBe(true);
  await expect(page.locator(".genlead-map-card .genlead-map-marker--mixed")).toHaveCount(1);

  const zoomToResults = page.getByRole("button", { name: "Zoom to results" });
  await zoomToResults.focus();
  await expect(zoomToResults).toBeFocused();
  await page.keyboard.press("Enter");
  await expect.poll(() => [...requestedZooms].some((zoom) => zoom > 2)).toBe(true);
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
  await expect(page.getByText("Source not recorded", { exact: true })).toHaveCount(0);
  await expect(page.locator(".genlead-map-card .genlead-map-marker--saved")).toHaveCount(1);

  await page.getByRole("combobox").first().selectOption("PLANT");
  await expect(page.locator(".genlead-map-summary")).toContainText("2 / 2 mapped");
  await expect(page.locator(".genlead-map-card .genlead-map-marker--mixed")).toHaveCount(1);
  await expect(page.locator(".genlead-map-card .genlead-map-marker--prospect")).toHaveCount(0);
  await expect(page.locator(".genlead-map-card .genlead-map-marker--unknown")).toHaveCount(0);
  await expect.poll(() => pageErrors).toEqual([]);
});

test("compact map controls, filters and help work on desktop and phone", async ({ page }) => {
  await addLocalSession(page);
  await page.route("https://tile.openstreetmap.org/**", (route) => route.abort());
  await page.route("**/internal/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/internal/data/companies") return fulfillJson(route, [
      { companyId: "saved", companyName: "Example saved company", source: "LEGACY_EXCEL" },
      { companyId: "new", companyName: "Example new company", source: "OVERTURE_MAPS" },
    ]);
    if (path === "/internal/data/locations") return fulfillJson(route, [
      { locationId: "saved-site", companyId: "saved", siteName: "Example saved site", locationType: "PLANT", verificationStatus: "UNVERIFIED", suburb: "Wacol", lat: -27.59, lng: 152.93 },
      { locationId: "new-site", companyId: "new", siteName: "Example new site", locationType: "OFFICE", verificationStatus: "VERIFIED", suburb: "Pinkenba", lat: -27.43, lng: 153.13 },
    ]);
    return fulfillJson(route, {});
  });

  await page.goto("/locations");
  const map = page.locator(".genlead-map-card");
  const rail = page.getByRole("complementary", { name: "Map filters" });
  await expect(map).toBeVisible();
  await expect(rail).toBeVisible();
  const desktopMap = await map.boundingBox();
  const desktopRail = await rail.boundingBox();
  expect(desktopMap!.x).toBeGreaterThan(desktopRail!.x);
  expect(desktopMap!.height).toBeGreaterThan(490);
  const initialMarker = await page.locator(".genlead-map-card .genlead-map-marker--mixed").boundingBox();
  expect(initialMarker!.x).toBeGreaterThan(desktopMap!.x);
  expect(initialMarker!.x).toBeLessThan(desktopMap!.x + desktopMap!.width);

  await page.getByRole("button", { name: "About Locations" }).click();
  await expect(page.getByRole("dialog", { name: "About Locations" })).toContainText("Red circles");
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog", { name: "About Locations" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "About Locations" })).toBeFocused();

  await page.getByRole("combobox", { name: "Site type" }).selectOption("PLANT");
  await expect(page.locator(".genlead-map-summary")).toContainText("1 / 1 mapped");
  const filteredMarker = await page.locator(".genlead-map-card .genlead-map-marker--saved").boundingBox();
  expect(filteredMarker!.x).toBeGreaterThan(desktopMap!.x);
  expect(filteredMarker!.x).toBeLessThan(desktopMap!.x + desktopMap!.width);
  await page.getByRole("button", { name: "Clear location filters" }).click();
  await expect(page.locator(".genlead-map-summary")).toContainText("2 / 2 mapped");

  await page.setViewportSize({ width: 390, height: 844 });
  const phoneMap = await map.boundingBox();
  const phoneRail = await rail.boundingBox();
  expect(phoneMap!.y).toBeLessThan(phoneRail!.y);
  expect(phoneMap!.width).toBeLessThanOrEqual(390);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await page.getByRole("button", { name: "About Locations" }).click();
  const dialog = await page.getByRole("dialog", { name: "About Locations" }).boundingBox();
  expect(dialog!.x).toBeGreaterThanOrEqual(0);
  expect(dialog!.x + dialog!.width).toBeLessThanOrEqual(390);
  await page.keyboard.press("Escape");

  for (const width of [320, 375, 768, 1024, 1440]) {
    await page.setViewportSize({ width, height: 844 });
    const dimensions = await page.evaluate(() => ({
      viewport: document.documentElement.clientWidth,
      content: document.documentElement.scrollWidth,
    }));
    expect(dimensions.content, `locations overflow at ${width}px`).toBeLessThanOrEqual(dimensions.viewport);
  }
});
