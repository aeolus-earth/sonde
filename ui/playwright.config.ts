import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  timeout: 30_000,
  retries: process.env.CI ? 2 : 1,
  workers: process.env.CI ? 1 : undefined,
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL: process.env.E2E_BASE_URL || "http://127.0.0.1:4174",
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
          port: 3003,
          reuseExistingServer: false,
          timeout: 60_000,
          env: {
            ...process.env,
            NODE_ENV: "test",
            SONDE_AGENT_BACKEND: "managed",
            SONDE_SERVER_PORT: "3003",
            SONDE_SKIP_CLI_PROBE: "1",
            SONDE_TEST_AGENT_MOCK: "1",
            ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY || "test-key",
            SONDE_MANAGED_ENVIRONMENT_ID:
              process.env.SONDE_MANAGED_ENVIRONMENT_ID || "env_playwright_smoke",
            SONDE_MANAGED_ALLOW_EPHEMERAL_AGENT:
              process.env.SONDE_MANAGED_ALLOW_EPHEMERAL_AGENT || "1",
            SONDE_TEST_AUTH_DELAY_MS: "750",
            SONDE_TEST_AUTH_BYPASS_TOKEN:
              process.env.E2E_AUTH_BYPASS_TOKEN || "playwright-smoke-token",
            SONDE_WS_TOKEN_SECRET: "playwright-ws-secret",
            SONDE_RUNTIME_AUDIT_TOKEN: "playwright-runtime-audit-token",
          },
        },
        {
          command: "npm run dev -- --host 127.0.0.1 --port 4174",
          port: 4174,
          reuseExistingServer: false,
          timeout: 60_000,
          env: {
            ...process.env,
            VITE_AGENT_WS_URL: "ws://127.0.0.1:3003",
            VITE_AGENT_PROXY_TARGET: "http://127.0.0.1:3003",
          },
        },
      ],
});
