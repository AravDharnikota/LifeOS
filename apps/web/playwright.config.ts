import { defineConfig, devices } from "@playwright/test";

const port = Number(process.env.E2E_PORT ?? 8790);
export default defineConfig({
  testDir: "e2e",
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [["list"]],
  outputDir: "test-results",
  use: {
    baseURL: `http://localhost:${port}`,
    timezoneId: process.env.E2E_TZ ?? "America/Los_Angeles",
    trace: "retain-on-failure",
    launchOptions: { executablePath: process.env.PW_CHROMIUM ?? "/opt/pw-browsers/chromium-1243/chrome-linux64/chrome" },
  },
  projects: [
    { name: "iphone", use: { ...devices["iPhone 14 Pro"], defaultBrowserType: "chromium", isMobile: true, hasTouch: true, viewport: { width: 393, height: 852 } } },
    { name: "desktop", use: { ...devices["Desktop Chrome"], viewport: { width: 1280, height: 800 } } },
  ],
  webServer: {
    command: `node ../../scripts/e2e-server.mjs`,
    port,
    reuseExistingServer: false,
    timeout: 60_000,
    env: { E2E_PORT: String(port) },
  },
});
