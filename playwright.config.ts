import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: "list",
  use: { baseURL: "http://localhost:4173/talentcalc/", trace: "off" },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"] }, testIgnore: /mobile\.spec\.ts/ },
    { name: "mobile", use: { ...devices["Pixel 5"] }, testMatch: /mobile\.spec\.ts/ },
  ],
  webServer: {
    command: "npm run build && npm run preview",
    url: "http://localhost:4173/talentcalc/",
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
