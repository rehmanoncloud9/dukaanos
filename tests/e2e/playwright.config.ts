import { defineConfig, devices } from "@playwright/test";

const baseURL = process.env.E2E_BASE_URL || "https://dukaanos-xi.vercel.app";

export default defineConfig({
  testDir: ".",
  testMatch: "**/*.spec.ts",
  timeout: 90_000,
  expect: { timeout: 15_000 },
  retries: process.env.CI ? 1 : 0,
  use: {
    baseURL,
    ...devices["Pixel 7"],
    viewport: { width: 390, height: 844 },
    trace: "on-first-retry",
    screenshot: "only-on-failure",
  },
});
