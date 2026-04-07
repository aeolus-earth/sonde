import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  timeout: 30_000,
  retries: process.env.CI ? 2 : 1,
  workers: process.env.CI ? 1 : undefined,
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL: process.env.E2E_BASE_URL || "http://localhost:5173",
    screenshot: "only-on-failure",
    trace: "on-first-retry",
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    { name: "firefox", use: { ...devices["Desktop Firefox"] } },
  ],
  webServer: process.env.E2E_BASE_URL
    ? undefined
    : [
        {
          command: "npm run dev",
          cwd: "../server",
          port: 3001,
          reuseExistingServer: true,
          timeout: 60_000,
          env: {
            ...process.env,
            NODE_ENV: "test",
            SONDE_SKIP_CLI_PROBE: "1",
            SONDE_TEST_AUTH_BYPASS_TOKEN:
              process.env.E2E_AUTH_BYPASS_TOKEN || "playwright-smoke-token",
          },
        },
        {
          command: "npm run dev -- --host 127.0.0.1 --port 5173",
          port: 5173,
          reuseExistingServer: true,
          timeout: 60_000,
        },
      ],
});
