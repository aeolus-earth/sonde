/**
 * Hosted smoke tests — run against a real deployed URL.
 *
 * These verify what actual users experience after a deploy.
 * Only runs when E2E_BASE_URL is set (CI post-deploy or manual dispatch).
 * Skipped entirely during local dev (no webServer needed).
 */
import {
  test,
  expect,
  type APIRequestContext,
  type Locator,
  type Page,
} from "@playwright/test";
import {
  seedActivationSession,
  seedActiveProgram,
  seedConfiguredSession,
} from "./helpers";
import {
  readTimelineRepoIdentity,
  type TimelineProxyResponse,
} from "../src/lib/timeline-proxy-response";

const BASE_URL = process.env.E2E_BASE_URL;
const DEPLOY_ENVIRONMENT = process.env.E2E_DEPLOY_ENVIRONMENT?.trim() || "hosted";
const AGENT_HTTP_BASE = process.env.E2E_AGENT_HTTP_BASE ?? null;
const AGENT_RUNTIME_AUDIT_TOKEN =
  process.env.E2E_AGENT_RUNTIME_AUDIT_TOKEN?.trim() || null;
const AUTH_SESSION_JSON = process.env.E2E_AUTH_SESSION_JSON?.trim() || null;
// Activation cleanup signs its Supabase session out after approval, so use a
// separate seeded browser session when the workflow provides one.
const ACTIVATION_SESSION_JSON =
  process.env.E2E_ACTIVATION_SESSION_JSON?.trim() || AUTH_SESSION_JSON;
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

interface DeviceActivationStartResponse {
  device_code: string;
  user_code: string;
  verification_uri: string;
  verification_uri_complete: string;
  expires_in: number;
  interval: number;
}

const TIMELINE_PROXY_REPO = {
  owner: "aeolus-earth",
  repo: "sonde",
};

function agentOrigin(value: string | null): string | null {
  if (!value) return null;
  return new URL(value).origin;
}

function expectedBranchForEnvironment(environment: string): string | null {
  if (environment === "production") return "main";
  if (environment === "staging") return "staging";
  return null;
}

function normalizeAuthMode(value: string): string {
  return value.toLowerCase().replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim();
}

function readAccessToken(sessionJson: string | null): string | null {
  if (!sessionJson) return null;
  const parsed = JSON.parse(sessionJson) as { access_token?: string | null };
  const token = parsed.access_token?.trim() || "";
  return token || null;
}

const AUTH_ACCESS_TOKEN = readAccessToken(AUTH_SESSION_JSON);

async function readVisibleText(page: Page, selector: string): Promise<string | null> {
  const locator = page.locator(selector).first();
  if (!(await locator.isVisible().catch(() => false))) {
    return null;
  }
  const text = await locator.textContent().catch(() => "");
  return text?.trim() || null;
}

async function waitForTimelineLandingState(
  page: Page,
  diagnosticsAuthMode: Locator,
  loadButton: Locator,
): Promise<"diagnostics" | "load" | "empty"> {
  const emptyState = page.getByText("No git-linked experiments found");
  await expect
    .poll(
      async () => {
        if (await diagnosticsAuthMode.isVisible().catch(() => false)) {
          return "diagnostics";
        }
        if (await loadButton.isVisible().catch(() => false)) {
          return "load";
        }
        if (await emptyState.isVisible().catch(() => false)) {
          return "empty";
        }
        return "pending";
      },
      {
        timeout: 20_000,
        message: "Expected timeline to resolve to diagnostics, a repo swimlane, or the empty state.",
      },
    )
    .not.toBe("pending");

  if (await diagnosticsAuthMode.isVisible().catch(() => false)) {
    return "diagnostics";
  }
  if (await loadButton.isVisible().catch(() => false)) {
    return "load";
  }
  return "empty";
}

async function assertTimelineProxyAvailable(request: APIRequestContext): Promise<void> {
  if (!AGENT_HTTP_BASE) {
    throw new Error("Timeline proxy smoke requires E2E_AGENT_HTTP_BASE.");
  }
  if (!AUTH_ACCESS_TOKEN) {
    throw new Error("Timeline proxy smoke requires E2E_AUTH_SESSION_JSON with an access token.");
  }

  const response = await request.get(
    `${AGENT_HTTP_BASE}/github/repos/${TIMELINE_PROXY_REPO.owner}/${TIMELINE_PROXY_REPO.repo}/commits?per_page=25`,
    {
      headers: {
        Authorization: `Bearer ${AUTH_ACCESS_TOKEN}`,
      },
    }
  );
  const bodyText = await response.text();
  expect(
    response.ok(),
    `Timeline proxy request failed: ${response.status()} ${bodyText.slice(0, 240)}`
  ).toBeTruthy();

  const body = JSON.parse(bodyText) as TimelineProxyResponse;
  const repoIdentity = readTimelineRepoIdentity(body);

  expect(repoIdentity).toEqual(TIMELINE_PROXY_REPO);
  expect(body.commits.length).toBeGreaterThan(0);
  expect(normalizeAuthMode(body.diagnostics.authMode)).toBe(
    normalizeAuthMode(EXPECT_TIMELINE_AUTH_MODE)
  );
  expect(body.diagnostics.upstreamRequests).toBeGreaterThanOrEqual(0);
}

async function waitForHostedChatResponse(
  page: Page,
  assistantMessage: Locator,
  approveButtons: Locator
): Promise<void> {
  await expect
    .poll(
      async () => {
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
          return "complete";
        }

        const content = await assistantMessage
          .locator("[data-chat-assistant-content]")
          .last()
          .textContent()
          .catch(() => "");
        if (content && CHAT_AUTH_FAILURE_MARKER.test(content)) {
          throw new Error(
            `Hosted chat surfaced an auth failure instead of tool output: ${content}`
          );
        }
        if (content?.includes("SONDE_SMOKE_OK")) {
          return "complete";
        }

        return "pending";
      },
      {
        timeout: 90_000,
        message: "Expected hosted chat to render SONDE_SMOKE_OK on the first turn.",
      }
    )
    .toBe("complete");
}

async function startHostedDeviceActivation(
  request: APIRequestContext,
): Promise<DeviceActivationStartResponse> {
  if (!AGENT_HTTP_BASE) {
    throw new Error("Hosted device activation requires E2E_AGENT_HTTP_BASE.");
  }

  const response = await request.post(`${AGENT_HTTP_BASE}/auth/device/start`, {
    data: {
      cli_version: "hosted-smoke",
      host_label: "ssh://hosted-smoke",
      remote_hint: true,
      login_method: "device",
      request_metadata: {
        suite: "hosted-smoke",
      },
    },
  });
  expect(response.ok()).toBeTruthy();

  return (await response.json()) as DeviceActivationStartResponse;
}

async function waitForApprovedDeviceSession(
  request: APIRequestContext,
  deviceCode: string,
  pollIntervalSeconds: number,
): Promise<{
  status: "approved";
  interval: number;
  session: {
    access_token: string;
    refresh_token: string;
  };
}> {
  if (!AGENT_HTTP_BASE) {
    throw new Error("Hosted device activation requires E2E_AGENT_HTTP_BASE.");
  }

  const deadline = Date.now() + 30_000;
  let lastStatus = "authorization_pending";

  while (Date.now() < deadline) {
    const response = await request.post(`${AGENT_HTTP_BASE}/auth/device/poll`, {
      data: {
        device_code: deviceCode,
      },
    });
    expect(response.ok()).toBeTruthy();

    const body = (await response.json()) as {
      status: string;
      interval: number;
      session?: {
        access_token: string;
        refresh_token: string;
      };
    };
    lastStatus = body.status;
    if (body.status === "approved" && body.session) {
      return body as {
        status: "approved";
        interval: number;
        session: {
          access_token: string;
          refresh_token: string;
        };
      };
    }
    if (body.status !== "authorization_pending" && body.status !== "slow_down") {
      throw new Error(`Hosted device activation ended in unexpected state: ${body.status}`);
    }
    await new Promise((resolve) => {
      setTimeout(resolve, Math.max(body.interval || pollIntervalSeconds, 1) * 1000);
    });
  }

  throw new Error(
    `Timed out waiting for hosted device activation approval. Last status: ${lastStatus}`,
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
      branch?: string | null;
      appVersion?: string | null;
      appVersionSource?: string | null;
      commitSha: string | null;
      agentWsConfigured?: boolean;
      agentWsOrigin?: string | null;
    };

    expect(body.environment).toBeTruthy();
    expect(body.branch).toBeTruthy();
    expect(body.appVersion).toBeTruthy();
    expect(body.appVersionSource).toBeTruthy();
    const expectedBranch = expectedBranchForEnvironment(DEPLOY_ENVIRONMENT);
    if (expectedBranch) {
      expect(body.branch).toBe(expectedBranch);
    }
    if (DEPLOY_ENVIRONMENT === "production") {
      expect(body.appVersion).toMatch(/^v\d+\.\d+\.\d+$/);
      expect(body.appVersionSource).toBe("exact-tag");
    }
    expect(body.agentWsConfigured).toBeTruthy();
    expect(body.agentWsOrigin ?? null).toBe(agentOrigin(AGENT_HTTP_BASE));
  });

  test("hosted activation callback route resolves back to the activation page @activation", async ({
    page,
    request,
    browserName,
  }) => {
    test.skip(!AGENT_HTTP_BASE, "Skipped: no agent host configured");
    test.skip(!ACTIVATION_SESSION_JSON, "Skipped: no smoke activation session configured");
    test.skip(browserName !== "chromium", "Run hosted activation smoke once to keep it lean.");

    const activation = await startHostedDeviceActivation(request);
    await seedActivationSession(page, ACTIVATION_SESSION_JSON);

    await page.goto(`/activate/callback?user_code=${encodeURIComponent(activation.user_code)}`);
    await page.waitForURL(/\/activate(\?|$)/, { timeout: 20_000 });

    const currentUrl = new URL(page.url());
    expect(currentUrl.pathname).toBe("/activate");
    expect(currentUrl.searchParams.get("code")).toBe(activation.user_code);
    await expect(
      page.getByRole("heading", { name: "Complete CLI sign-in from any browser" }),
    ).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText("ssh://hosted-smoke")).toBeVisible({ timeout: 20_000 });
  });

  test("hosted activation link can approve a headless CLI login from a browser session @activation", async ({
    page,
    request,
    browserName,
  }) => {
    test.skip(!AGENT_HTTP_BASE, "Skipped: no agent host configured");
    test.skip(!ACTIVATION_SESSION_JSON, "Skipped: no smoke activation session configured");
    test.skip(browserName !== "chromium", "Run hosted activation smoke once to keep it lean.");

    const activation = await startHostedDeviceActivation(request);
    await seedActivationSession(page, ACTIVATION_SESSION_JSON);

    await page.goto(activation.verification_uri_complete);
    await expect(
      page.getByRole("heading", { name: "Complete CLI sign-in from any browser" }),
    ).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText("ssh://hosted-smoke")).toBeVisible({ timeout: 20_000 });

    const approveButton = page.getByRole("button", { name: "Approve sign-in" });
    await expect(approveButton).toBeVisible({ timeout: 20_000 });
    await approveButton.click();

    await expect(page.getByText("CLI sign-in approved")).toBeVisible({ timeout: 20_000 });
    const approved = await waitForApprovedDeviceSession(
      request,
      activation.device_code,
      activation.interval,
    );
    expect(approved.session.access_token).toBeTruthy();
    expect(approved.session.refresh_token).toBeTruthy();
  });
});

test.describe(`${SUITE_LABEL} authenticated flows @authenticated`, () => {
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

  test("timeline loads commit history through the server proxy", async ({
    page,
    request,
  }) => {
    await page.goto("/timeline");

    const diagnosticsAuthMode = page.getByText(new RegExp(EXPECT_TIMELINE_AUTH_MODE, "i")).first();
    const loadButton = page.getByRole("button", { name: "Load commit history" }).first();
    const landingState = await waitForTimelineLandingState(
      page,
      diagnosticsAuthMode,
      loadButton,
    );

    if (landingState === "diagnostics") {
      await expect(page.getByText(/upstream GitHub request/i)).toBeVisible({
        timeout: 60_000,
      });
      return;
    }

    if (landingState === "load") {
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
      return;
    }

    await expect(page.getByText("No git-linked experiments found")).toBeVisible({
      timeout: 20_000,
    });
    await expect(
      page.getByText(
        "Experiments logged with sonde log from inside a git repo will appear here."
      )
    ).toBeVisible();
    await assertTimelineProxyAvailable(request);
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
