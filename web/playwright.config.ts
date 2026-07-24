import { defineConfig, devices } from "@playwright/test";

const baseURL = process.env.TASKLINE_E2E_BASE_URL;
if (!baseURL) {
  throw new Error("TASKLINE_E2E_BASE_URL is required; run `make test-browser`");
}
if (!process.env.TASKLINE_E2E_MANIFEST) {
  throw new Error("TASKLINE_E2E_MANIFEST is required; run `make test-browser`");
}

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  forbidOnly: !!process.env.CI,
  reporter: [
    ["list"],
    ["html", { open: "never", outputFolder: "playwright-report" }],
  ],
  outputDir: "test-results",
  use: {
    ...devices["Desktop Chrome"],
    baseURL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
});
