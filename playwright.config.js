import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "./tests/browser",
  workers: 1,
  use: {
    baseURL: "http://127.0.0.1:5173",
    headless: true,
    launchOptions: {
      ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH
        ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH }
        : {}),
    },
  },
  webServer: [
    {
      command: `DATA_DIR=.local/e2e-${Date.now()} npm run dev`,
      port: 3001,
      reuseExistingServer: !process.env.CI,
    },
    {
      command: "npm run dev:web",
      port: 5173,
      reuseExistingServer: !process.env.CI,
    },
  ],
});
