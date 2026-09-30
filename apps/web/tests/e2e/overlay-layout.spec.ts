import { expect, test, type Page } from "@playwright/test";
import { SignJWT } from "jose";

const longName = "Example Engineering, Steam and Industrial Water Systems — Wacol Operations";
const longAddress = "Industrial estate, Wacol, QLD, 4076, Australia";

async function prepare(page: Page, count = 1) {
  const token = await new SignJWT({ authenticated: true, email: "qa@example.invalid" })
    .setProtectedHeader({ alg: "HS256" }).setIssuedAt().setExpirationTime("1h")
    .sign(new TextEncoder().encode("local-playwright-only-secret-not-for-any-environment"));
  await page.context().addCookies([{ name: "pi_session", value: token, url: "http://127.0.0.1:3127", httpOnly: true, sameSite: "Lax" }]);
  await page.route("https://tile.openstreetmap.org/**", route => route.abort());
  await page.route("**/api/auth/me", route => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ email: `${"example".repeat(12)}@example.invalid` }) }));
  await page.route("**/internal/**", async route => {
    const path = new URL(route.request().url()).pathname;
    let body: unknown = [];
    if (path === "/internal/data/sync-status") body = { connected: false, mode: "mock", companiesCount: 1, locationsCount: count, contactsCount: 0, state: "NEVER" };
    if (path === "/internal/ops/provider-status") body = { services: [] };
    if (path === "/internal/ops/jobs") body = [{ job_id: "example", location: "Synthetic area", status: "completed", created_at: "2026-09-30T00:00:00Z" }];
    if (path === "/internal/data/follow-ups") body = [{ activityId: "example", companyId: "saved", companyName: longName, followUpAt: "2026-01-01T00:00:00Z", followUpStatus: "PENDING" }];
    if (path === "/internal/data/companies") body = [{
      companyId: "saved", companyName: longName, source: "LEGACY_EXCEL", status: "NEW",
      industry: "Engineering", industryFit: "TARGET", businessEmail: `${"engineering".repeat(12)}@example.invalid`,
      website: `https://example.invalid/${"long-public-path-".repeat(15)}`,
    }];
    if (path === "/internal/data/locations") body = Array.from({ length: count }, (_, i) => ({
      locationId: `site-${i}`, companyId: "saved", siteName: i === 0 ? longName : `Example plant ${i + 1}`,
      suburb: "Industrial estate, Wacol", state: "QLD", postcode: "4076", country: "Australia",
      coordinateSource: "POSTCODE_CENTROID", locationType: "PLANT", verificationStatus: "UNVERIFIED",
      lat: -27.59, lng: 152.93,
    }));
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) });
  });
}

test("map popups give names and addresses their own readable rows at every breakpoint", async ({ page }, testInfo) => {
  await prepare(page);
  for (const width of [320, 375, 390, 768, 1024, 1440]) {
    await page.setViewportSize({ width, height: 844 });
    await page.goto("/locations");
    await page.getByRole("button", { name: "Zoom to results", exact: true }).click();
    await page.getByRole("button", { name: "1 from MSV’s workbook", exact: true }).click();
    const item = page.locator(".genlead-map-popup-item");
    await expect(item.getByText(longName, { exact: true })).toBeVisible();
    await expect(item.getByText(longAddress, { exact: true })).toBeVisible();
    await expect(item.getByText("Approximate postcode centre", { exact: true })).toBeVisible();
    const title = (await item.locator("strong").boundingBox())!;
    const badge = (await item.locator(".genlead-map-origin-badge").boundingBox())!;
    const address = (await item.getByText(longAddress, { exact: true }).boundingBox())!;
    expect(title.width, `title readability at ${width}px`).toBeGreaterThanOrEqual(180);
    expect(address.width, `address readability at ${width}px`).toBeGreaterThanOrEqual(180);
    expect(badge.y).toBeGreaterThanOrEqual(title.y + title.height);
    const popup = page.locator(".leaflet-popup-content-wrapper");
    await expect.poll(async () => {
      const p = (await popup.boundingBox())!;
      const map = (await page.locator(".genlead-map-card").boundingBox())!;
      return p.x >= map.x && p.y >= map.y && p.x + p.width <= map.x + map.width + 1 && p.y + p.height <= map.y + map.height + 1;
    }, { message: `popup fits map at ${width}px` }).toBe(true);
    const close = page.getByRole("button", { name: "Close popup", exact: true });
    const closeBox = (await close.boundingBox())!;
    await expect(close).toHaveCSS("width", "44px");
    await expect(close).toHaveCSS("height", "44px");
    // Leaflet translates its pane; DOM rectangles can differ by ~0.00002px.
    expect(closeBox.width).toBeGreaterThanOrEqual(43.99);
    expect(closeBox.height).toBeGreaterThanOrEqual(43.99);
    expect(closeBox.x).toBeGreaterThanOrEqual(title.x + title.width);
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
    await page.screenshot({ path: testInfo.outputPath(`map-popup-${width}.png`), fullPage: true, animations: "disabled" });
    await close.click();
    await expect(page.locator(".leaflet-popup")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Zoom to results", exact: true })).toBeVisible();
  }
});

test("cancelling a nested confirmation leaves its company drawer open and performs no write", async ({ page }) => {
  await prepare(page);
  const writes: string[] = [];
  page.on("request", request => {
    if (request.url().includes("/internal/") && request.method() !== "GET") writes.push(request.method());
  });
  await page.goto("/companies?companyId=saved");
  const drawer = page.getByRole("dialog", { name: longName, exact: true });
  // The final action rejects the company; earlier Reject actions belong to sites.
  await drawer.getByRole("button", { name: "Reject", exact: true }).last().click();
  const confirmation = page.getByRole("alertdialog", { name: "Reject Company", exact: true });
  await expect(confirmation.getByRole("button", { name: "Cancel", exact: true })).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(confirmation.getByRole("button", { name: "Reject", exact: true })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(confirmation).toHaveCount(0);
  await expect(drawer).toBeVisible();
  await expect(drawer.getByRole("button", { name: "Reject", exact: true }).last()).toBeFocused();
  expect(writes).toEqual([]);
});

test("an open popup adapts to map resizing and its company link opens the right record", async ({ page }, testInfo) => {
  await prepare(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/locations");
  await page.getByRole("button", { name: "1 from MSV’s workbook", exact: true }).click();
  const popup = page.locator(".leaflet-popup-content-wrapper");
  await expect(popup).toBeVisible();
  await page.setViewportSize({ width: 320, height: 600 });
  try {
    await expect.poll(async () => {
      const p = await popup.boundingBox();
      const map = (await page.locator(".genlead-map-card").boundingBox())!;
      return Boolean(p && p.x >= map.x && p.x + p.width <= map.x + map.width + 1);
    }).toBe(true);
  } catch (error) {
    await page.screenshot({ path: testInfo.outputPath("popup-resize.png"), fullPage: true });
    await testInfo.attach("resize-geometry", { body: JSON.stringify({ popup: await popup.boundingBox(), map: await page.locator(".genlead-map-card").boundingBox() }), contentType: "application/json" });
    throw error;
  }
  const link = popup.getByRole("link", { name: "View company", exact: true });
  await expect(link).toHaveAttribute("href", "/companies?companyId=saved");
  await link.click();
  await expect(page.getByRole("dialog", { name: longName, exact: true })).toBeVisible();
});

test("cluster popups keep all displayed sites accessible without spilling outside a short map", async ({ page }) => {
  await prepare(page, 10);
  await page.setViewportSize({ width: 375, height: 600 });
  await page.goto("/locations");
  await page.getByRole("button", { name: "10 from MSV’s workbook", exact: true }).click();
  const content = page.locator(".leaflet-popup-content");
  await expect(content.getByText("and 2 more locations at this point", { exact: true })).toHaveCount(1);
  expect(await content.evaluate(el => el.scrollHeight > el.clientHeight)).toBe(true);
  const box = (await content.boundingBox())!;
  expect(box.height).toBeLessThan(300);
  await content.getByText("Example plant 8", { exact: true }).scrollIntoViewIfNeeded();
  await expect(content.getByText("Example plant 8", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Close popup", exact: true }).click();
});

test("a tile outage remains visible while a location popup is open", async ({ page }) => {
  await prepare(page);
  await page.goto("/locations");
  await page.getByRole("button", { name: "1 from MSV’s workbook", exact: true }).click();
  const notice = page.getByText("Map tiles unavailable · points still shown", { exact: true });
  await expect(notice).toBeVisible({ timeout: 10_000 });
  await expect(page.locator(".genlead-map-popup-item").getByText(longName, { exact: true })).toBeVisible();
  expect(await notice.evaluate(el => Boolean(el.closest(".genlead-map-card")))).toBe(false);
});

test("profile menu contains long account labels and returns keyboard focus on Escape", async ({ page }) => {
  await prepare(page);
  await page.setViewportSize({ width: 320, height: 600 });
  await page.goto("/companies");
  const trigger = page.getByRole("button", { name: "Open user menu", exact: true });
  await expect(trigger).toHaveText("EX");
  await trigger.focus();
  await page.keyboard.press("ArrowDown");
  const menu = page.getByRole("menu");
  await expect(menu).toBeVisible();
  const menuBox = (await menu.boundingBox())!;
  expect(menuBox.x).toBeGreaterThanOrEqual(12);
  expect(menuBox.x + menuBox.width).toBeLessThanOrEqual(308);
  await page.keyboard.press("Escape");
  await expect(menu).toHaveCount(0);
  await expect(trigger).toBeFocused();
});

test("long explanations stay inside a short viewport instead of relying on a guessed height", async ({ page }) => {
  await prepare(page);
  await page.setViewportSize({ width: 320, height: 480 });
  await page.goto("/locations");
  const trigger = page.getByRole("button", { name: "About Locations", exact: true });
  await trigger.scrollIntoViewIfNeeded();
  // Place an already-visible control near the lower edge, like a user scrolling
  // a long Settings page. The panel must use its real height to flip above it.
  await trigger.evaluate(el => window.scrollBy(0, el.getBoundingClientRect().bottom - (window.innerHeight - 90)));
  await trigger.click();
  const dialog = page.getByRole("dialog", { name: "About Locations", exact: true });
  await expect(dialog).toBeVisible();
  await expect.poll(async () => {
    const box = (await dialog.boundingBox())!;
    return box.x >= 12 && box.y >= 12 && box.x + box.width <= 308 && box.y + box.height <= 468;
  }).toBe(true);
  await page.keyboard.press("Escape");
  await expect(trigger).toBeFocused();
});

test("company drawer wraps long values and contains keyboard focus on phones", async ({ page }, testInfo) => {
  await prepare(page);
  await page.setViewportSize({ width: 320, height: 600 });
  await page.goto("/companies?companyId=saved");
  const drawer = page.getByRole("dialog", { name: longName, exact: true });
  await expect(drawer).toBeVisible();
  const close = drawer.getByRole("button", { name: "Close", exact: true });
  await expect(close).toBeFocused();
  expect(await drawer.evaluate(el => el.scrollWidth - el.clientWidth)).toBeLessThanOrEqual(0);
  const closeBox = (await close.boundingBox())!;
  const titleBox = (await drawer.locator("h2").boundingBox())!;
  expect(closeBox.width).toBeGreaterThanOrEqual(44);
  expect(closeBox.x).toBeGreaterThanOrEqual(titleBox.x + titleBox.width);
  for (let i = 0; i < 25; i++) {
    await page.keyboard.press("Tab");
    expect(await drawer.evaluate(el => el.contains(document.activeElement))).toBe(true);
  }
  const action = drawer.getByRole("button", { name: "Reject", exact: true }).last();
  await action.scrollIntoViewIfNeeded();
  expect(await action.evaluate(el => {
    const box = el.getBoundingClientRect();
    return el.contains(document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2));
  }), "mobile navigation and chat must not cover drawer actions").toBe(true);
  await page.screenshot({ path: testInfo.outputPath("company-drawer-phone.png"), fullPage: true, animations: "disabled" });
  await page.keyboard.press("Escape");
  await expect(drawer).toHaveCount(0);
});

test("reminders fit beside the account control on a narrow phone", async ({ page }) => {
  await prepare(page);
  await page.setViewportSize({ width: 320, height: 480 });
  await page.goto("/companies");
  const trigger = page.getByRole("button", { name: "Follow-up reminders", exact: true });
  await trigger.click();
  const panel = page.getByRole("dialog", { name: "Follow-up reminders", exact: true });
  await expect(panel).toBeVisible();
  await expect.poll(async () => {
    const b = (await panel.boundingBox())!;
    return b.x >= 12 && b.y >= 12 && b.x + b.width <= 308 && b.y + b.height <= 468;
  }).toBe(true);
  await page.keyboard.press("Escape");
  await expect(page.getByRole("button", { name: /^Follow-up reminders/ })).toBeFocused();
});
