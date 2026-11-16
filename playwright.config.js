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
      command: `node --input-type=module -e "process.env.DATA_DIR='.local/e2e-${Date.now()}'; await import('./server/dev.mjs')"`,
      env: { DEMO_AI: "true", TABLE_NAME: "" },
      port: 3001,
      reuseExistingServer: false,
    },
    {
      command:
        "node node_modules/vite/bin/vite.js preview --host 127.0.0.1 --port 5173 --strictPort",
      port: 5173,
      reuseExistingServer: false,
    },
  ],
});
