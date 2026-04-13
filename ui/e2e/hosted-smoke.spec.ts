/**
 * Hosted smoke tests — run against a real deployed URL.
 *
 * These verify what actual users experience after a deploy.
 * Only runs when E2E_BASE_URL is set (CI post-deploy or manual dispatch).
 * Skipped entirely during local dev (no webServer needed).
 */
import { test, expect, type Locator, type Page } from "@playwright/test";
import { seedActiveProgram, seedConfiguredSession } from "./helpers";

const BASE_URL = process.env.E2E_BASE_URL;
const DEPLOY_ENVIRONMENT = process.env.E2E_DEPLOY_ENVIRONMENT?.trim() || "hosted";
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
const ENVIRONMENT_LABEL =
  DEPLOY_ENVIRONMENT.charAt(0).toUpperCase() + DEPLOY_ENVIRONMENT.slice(1);
const SUITE_LABEL =
  DEPLOY_ENVIRONMENT === "hosted"
    ? "Hosted smoke"
    : `${ENVIRONMENT_LABEL} hosted smoke`;

const CHAT_AUTH_FAILURE_MARKER =
  /PGRST301|No suitable key was found to decode the JWT|JWT authentication error/i;

function agentOrigin(value: string | null): string | null {
  if (!value) return null;
  return new URL(value).origin;
}

async function readVisibleText(page: Page, selector: string): Promise<string | null> {
  const locator = page.locator(selector).first();
  if (!(await locator.isVisible().catch(() => false))) {
    return null;
  }
  const text = await locator.textContent().catch(() => "");
  return text?.trim() || null;
}

async function waitForHostedChatResponse(
  page: Page,
  assistantMessage: Locator,
  approveButtons: Locator
): Promise<void> {
  const deadline = Date.now() + 90_000;

  while (Date.now() < deadline) {
    const approveCount = await approveButtons.count().catch(() => 0);
    for (let index = 0; index < approveCount; index += 1) {
      const button = approveButtons.nth(index);
      const isVisible = await button.isVisible().catch(() => false);
      const isEnabled = await button.isEnabled().catch(() => false);
      if (isVisible && isEnabled) {
        await button.click().catch(() => {});
      }
    }

    const smokeMarkerVisible = await page
      .getByText("SONDE_SMOKE_OK", { exact: false })
      .isVisible()
      .catch(() => false);
    if (smokeMarkerVisible) {
      return;
    }

    const content = await assistantMessage
      .locator("[data-chat-assistant-content]")
      .last()
      .textContent()
      .catch(() => "");
    if (content && CHAT_AUTH_FAILURE_MARKER.test(content)) {
      throw new Error(`Hosted chat surfaced an auth failure instead of tool output: ${content}`);
    }
    if (content?.includes("SONDE_SMOKE_OK")) {
      return;
    }

    await page.waitForTimeout(1_000);
  }

  throw new Error(
    "Expected hosted chat to render SONDE_SMOKE_OK on the first turn."
  );
}

test.describe(SUITE_LABEL, () => {
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
      managedConfigured: boolean;
      anthropicConfigured: boolean;
      cliGitRef: string | null;
      supabaseProjectRef: string | null;
      sharedRateLimitConfigured: boolean;
      sharedRateLimitRequired: boolean;
    };

    expect(body.status).toBe("ok");
    expect(body.environment).toBeTruthy();
    expect(body.commitSha ?? null).not.toBeUndefined();
    expect(body.agentBackend).toBe("managed");
    expect(body.managedConfigured).toBeTruthy();
    expect(body.anthropicConfigured).toBeTruthy();
    expect(body.cliGitRef ?? null).not.toBeUndefined();
    expect(body.supabaseProjectRef ?? null).not.toBeUndefined();
    expect(body.sharedRateLimitConfigured ?? false).not.toBeUndefined();
    expect(body.sharedRateLimitRequired ?? false).not.toBeUndefined();
  });

  test("hosted build publishes the configured agent origin", async ({ request }) => {
    test.skip(!AGENT_HTTP_BASE, "Skipped: no agent host configured");

    const response = await request.get("/version.json");
    expect(response.ok()).toBeTruthy();

    const body = (await response.json()) as {
      environment: string;
      commitSha: string | null;
      agentWsConfigured?: boolean;
      agentWsOrigin?: string | null;
    };

    expect(body.environment).toBeTruthy();
    expect(body.agentWsConfigured).toBeTruthy();
    expect(body.agentWsOrigin ?? null).toBe(agentOrigin(AGENT_HTTP_BASE));
  });
});

test.describe(`${SUITE_LABEL} authenticated flows`, () => {
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

    const timelineError = page.getByText(/Failed to load commit history|Sign in again|Repository not accessible|Server GitHub token is invalid|Hosted Sonde UI is missing VITE_AGENT_WS_URL/i);
    await expect(
      page.getByText(new RegExp(EXPECT_TIMELINE_AUTH_MODE, "i"))
    ).toBeVisible({ timeout: 60_000 }).catch(async () => {
      const errorText = await timelineError.first().textContent().catch(() => "");
      throw new Error(
        `Timeline diagnostics never loaded expected auth mode (${EXPECT_TIMELINE_AUTH_MODE}). Visible error: ${errorText || "(none)"}`
      );
    });
    await expect(page.getByText(/upstream GitHub request/i)).toBeVisible({
      timeout: 60_000,
    });
  });

  test("chat connects and renders a hosted agent response on the first turn", async ({
    page,
    browserName,
  }) => {
    test.skip(!AGENT_HTTP_BASE, "Skipped: no agent host configured");
    test.skip(browserName !== "chromium", "Run hosted chat once to keep smoke lean.");
    test.setTimeout(120_000);

    await page.goto("/");

    const input = page.locator('textarea[aria-label="Chat message"]:visible').first();
    await expect(input).toBeVisible({ timeout: 20_000 });
    await expect(input).toBeEditable({ timeout: 60_000 }).catch(async () => {
      const bannerText =
        (await readVisibleText(page, "[role='alert']")) ??
        (await readVisibleText(page, "[role='status']"));
      throw new Error(
        `Hosted chat never became editable. Visible connection state: ${bannerText || "(none)"}`
      );
    });
    await expect(page.getByText(/agent is not connected/i)).not.toBeVisible({
      timeout: 60_000,
    });

    await input.fill(CHAT_PROMPT);
    await page.locator('button[aria-label="Send"]:visible').first().click();

    await expect(page.getByText(CHAT_PROMPT, { exact: true })).toBeVisible({
      timeout: 15_000,
    });
    await waitForHostedChatResponse(
      page,
      page.locator('[data-chat-role="assistant"]').last(),
      page.getByRole("button", { name: "Approve" })
    );
    await expect(page.getByText(/agent is not connected/i)).not.toBeVisible();
  });
});
