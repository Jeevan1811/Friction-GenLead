import { defineConfig, devices } from "@playwright/test";

const port = 3127;

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  workers: 1,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: "list",
  timeout: 45_000,
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    trace: "retain-on-failure",
    ...devices["Desktop Chrome"],
  },
  webServer: {
    command: `npm run start --workspace=apps/web -- --hostname 127.0.0.1 --port ${port}`,
    cwd: "../..",
    url: `http://127.0.0.1:${port}/login`,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    env: {
      AUTH_ALLOWED_EMAILS: "qa@example.invalid",
      AUTH_JWT_SECRET: "local-playwright-only-secret-not-for-any-environment",
      NEXT_PUBLIC_API_URL: "http://127.0.0.1:8011",
      PORT: String(port),
    },
  },
});
