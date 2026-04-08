/**
 * Production smoke tests — run against the real deployed URL.
 *
 * These verify what actual users experience after a deploy.
 * Only runs when E2E_BASE_URL is set (CI post-deploy or manual dispatch).
 * Skipped entirely during local dev (no webServer needed).
 */
import { test, expect } from "@playwright/test";
import { seedActiveProgram, seedConfiguredSession } from "./helpers";

const BASE_URL = process.env.E2E_BASE_URL;
const AGENT_HTTP_BASE = process.env.E2E_AGENT_HTTP_BASE ?? null;
const AGENT_RUNTIME_AUDIT_TOKEN =
  process.env.E2E_AGENT_RUNTIME_AUDIT_TOKEN?.trim() || null;
const AUTH_SESSION_JSON = process.env.E2E_AUTH_SESSION_JSON?.trim() || null;
const EXPECT_PROGRAM_ID = process.env.E2E_EXPECT_PROGRAM_ID?.trim() || null;
const EXPECT_EXPERIMENT_ID = process.env.E2E_EXPECT_EXPERIMENT_ID?.trim() || null;
const EXPECT_TIMELINE_AUTH_MODE =
  process.env.E2E_EXPECT_TIMELINE_AUTH_MODE?.trim() || "server token";
const CHAT_PROMPT =
  process.env.E2E_CHAT_PROMPT?.trim() ||
  "Use Sonde tools to list one accessible program id, then reply with SONDE_SMOKE_OK.";
const CHAT_EXPECT_SUBSTRING =
  process.env.E2E_CHAT_EXPECT_SUBSTRING?.trim() || "SONDE_SMOKE_OK";

test.describe("Production deployment", () => {
  test.skip(!BASE_URL, "Skipped: E2E_BASE_URL not set (local dev)");

  test("no Vercel auth gate — serves app, not Vercel login", async ({
    page,
  }) => {
    const response = await page.goto("/login");
    expect(response?.status()).toBe(200);
    await page.waitForLoadState("networkidle");

    const body = await page.textContent("body");
    // Must NOT contain Vercel's auth gate
    expect(body).not.toContain("Log in to Vercel");
    expect(body).not.toContain("Social Account is not yet connected");
    // Must contain our app
    expect(body).toContain("Sonde");
  });

  test("login page renders with Google sign-in button", async ({ page }) => {
    await page.goto("/login");
    await page.waitForLoadState("networkidle");
    await expect(page.locator("text=Continue with Google")).toBeVisible({
      timeout: 15_000,
    });
  });

  test("login page shows aeolus.earth domain restriction", async ({
    page,
  }) => {
    await page.goto("/login");
    await page.waitForLoadState("networkidle");
    await expect(page.locator("text=@aeolus.earth")).toBeVisible({
      timeout: 15_000,
    });
  });

  test("SPA deep links work on Vercel (experiments)", async ({ page }) => {
    const response = await page.goto("/experiments/EXP-0001");
    expect(response?.status()).toBe(200);
  });

  test("SPA deep links work on Vercel (directions)", async ({ page }) => {
    const response = await page.goto("/directions/DIR-001");
    expect(response?.status()).toBe(200);
  });

  test("SPA deep links work on Vercel (projects)", async ({ page }) => {
    const response = await page.goto("/projects/PROJ-001");
    expect(response?.status()).toBe(200);
  });

  test("auth callback route is reachable", async ({ page }) => {
    const response = await page.goto("/auth/callback");
    expect(response?.status()).toBe(200);
  });

  test("no 5xx errors on any route", async ({ page }) => {
    const routes = ["/", "/login", "/experiments", "/brief", "/auth/callback"];
    for (const route of routes) {
      const response = await page.goto(route);
      const status = response?.status() ?? 0;
      expect(status, `${route} returned ${status}`).toBeLessThan(500);
    }
  });

  test("response is HTML, not JSON error", async ({ page }) => {
    const response = await page.goto("/login");
    const contentType = response?.headers()["content-type"] ?? "";
    expect(contentType).toContain("text/html");
  });

  test("JS bundle loads (app is functional, not just index.html)", async ({
    page,
  }) => {
    await page.goto("/login");
    await page.waitForLoadState("networkidle");
    // The React app should have rendered something inside #root
    const rootChildren = await page.locator("#root > *").count();
    expect(rootChildren).toBeGreaterThan(0);
  });

  test("agent health responds when an agent host is configured", async ({ request }) => {
    test.skip(!AGENT_HTTP_BASE, "Skipped: no agent host configured");

    const response = await request.get(`${AGENT_HTTP_BASE}/health`);
    expect(response.ok()).toBeTruthy();

    const body = (await response.json()) as { status: string };
    expect(body).toEqual({ status: "ok" });
  });

  test("agent runtime metadata is available with the audit token", async ({ request }) => {
    test.skip(!AGENT_HTTP_BASE, "Skipped: no agent host configured");
    test.skip(
      !AGENT_RUNTIME_AUDIT_TOKEN,
      "Skipped: no runtime audit token configured",
    );

    const response = await request.get(`${AGENT_HTTP_BASE}/health/runtime`, {
      headers: {
        Authorization: `Bearer ${AGENT_RUNTIME_AUDIT_TOKEN}`,
      },
    });
    expect(response.ok()).toBeTruthy();

    const body = (await response.json()) as {
      status: string;
      environment: string;
      commitSha: string | null;
      schemaVersion: string | null;
      agentBackend: string;
      daytonaConfigured: boolean;
      anthropicConfigured: boolean;
      cliGitRef: string | null;
      supabaseProjectRef: string | null;
      sharedRateLimitConfigured: boolean;
      sharedRateLimitRequired: boolean;
    };

    expect(body.status).toBe("ok");
    expect(body.environment).toBeTruthy();
    expect(body.commitSha ?? null).not.toBeUndefined();
    expect(body.agentBackend).toBeTruthy();
    expect(body.daytonaConfigured).toBeTruthy();
    expect(body.anthropicConfigured).toBeTruthy();
    expect(body.cliGitRef ?? null).not.toBeUndefined();
    expect(body.supabaseProjectRef ?? null).not.toBeUndefined();
    expect(body.sharedRateLimitConfigured ?? false).not.toBeUndefined();
    expect(body.sharedRateLimitRequired ?? false).not.toBeUndefined();
  });
});

test.describe("Production deployment authenticated flows", () => {
  test.skip(
    !BASE_URL || !AUTH_SESSION_JSON,
    "Skipped: authenticated smoke requires E2E_BASE_URL and E2E_AUTH_SESSION_JSON"
  );

  test.beforeEach(async ({ page }) => {
    await seedConfiguredSession(page);
    if (EXPECT_PROGRAM_ID) {
      await seedActiveProgram(page, EXPECT_PROGRAM_ID);
    }
  });

  test("authenticated home renders the chat shell", async ({ page }) => {
    await page.goto("/");

    await expect(
      page.locator('textarea[aria-label="Chat message"]:visible').first()
    ).toBeVisible({ timeout: 20_000 });
  });

  test("brief loads for an authenticated user", async ({ page }) => {
    await page.goto("/brief");

    await expect(page.getByRole("heading", { name: "Brief" })).toBeVisible({
      timeout: 20_000,
    });

    if (EXPECT_EXPERIMENT_ID) {
      await expect(page.getByText(EXPECT_EXPERIMENT_ID).first()).toBeVisible({
        timeout: 20_000,
      });
    }
  });

  test("known experiment detail loads when a seed record is configured", async ({
    page,
  }) => {
    test.skip(!EXPECT_EXPERIMENT_ID, "Skipped: no seeded experiment id configured");

    await page.goto(`/experiments/${EXPECT_EXPERIMENT_ID}`);

    await expect(page.getByText(EXPECT_EXPERIMENT_ID).first()).toBeVisible({
      timeout: 20_000,
    });
  });

  test("timeline loads commit history through the server proxy", async ({ page }) => {
    await page.goto("/timeline");

    const loadButton = page.getByRole("button", { name: "Load commit history" }).first();
    await expect(loadButton).toBeVisible({ timeout: 20_000 });
    await loadButton.click();

    await expect(
      page.getByText(new RegExp(EXPECT_TIMELINE_AUTH_MODE, "i"))
    ).toBeVisible({ timeout: 60_000 });
    await expect(page.getByText(/upstream GitHub request/i)).toBeVisible({
      timeout: 60_000,
    });
  });

  test("chat returns a hosted agent response on the first turn", async ({
    page,
    browserName,
  }) => {
    test.skip(!AGENT_HTTP_BASE, "Skipped: no agent host configured");
    test.skip(browserName !== "chromium", "Run hosted chat once to keep smoke lean.");

    await page.goto("/");

    const input = page.locator('textarea[aria-label="Chat message"]:visible').first();
    await expect(input).toBeVisible({ timeout: 20_000 });

    await input.fill(CHAT_PROMPT);
    await page.locator('button[aria-label="Send"]:visible').first().click();

    await expect(page.getByText(CHAT_PROMPT, { exact: true })).toBeVisible({
      timeout: 15_000,
    });
    await expect(
      page
        .locator('[data-chat-role="assistant"]')
        .last()
        .getByText(new RegExp(CHAT_EXPECT_SUBSTRING, "i"))
    ).toBeVisible({ timeout: 90_000 });
    await expect(page.getByText(/agent is not connected/i)).not.toBeVisible();
  });
});
