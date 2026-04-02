/**
 * Production smoke tests — run against the real deployed URL.
 *
 * These verify what actual users experience after a deploy.
 * Only runs when E2E_BASE_URL is set (CI post-deploy or manual dispatch).
 * Skipped entirely during local dev (no webServer needed).
 */
import { test, expect } from "@playwright/test";

const BASE_URL = process.env.E2E_BASE_URL;

test.describe("Production deployment", () => {
  test.skip(!BASE_URL, "Skipped: E2E_BASE_URL not set (local dev)");

  test("no Vercel auth gate — serves app, not Vercel login", async ({
    page,
  }) => {
    const response = await page.goto("/login");
    expect(response?.status()).toBe(200);

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
});
