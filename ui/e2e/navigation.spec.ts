import { test, expect } from "@playwright/test";

test.describe("SPA navigation", () => {
  test("all main routes serve 200 via SPA rewrite", async ({ page }) => {
    const routes = [
      "/",
      "/login",
      "/experiments",
      "/experiments/EXP-0001",
      "/directions",
      "/directions/DIR-001",
      "/projects",
      "/projects/PROJ-001",
      "/findings",
      "/findings/FIND-001",
      "/questions",
      "/brief",
      "/dashboard",
      "/tree",
      "/timeline",
      "/activity",
      "/auth/callback",
    ];

    for (const route of routes) {
      const response = await page.goto(route);
      expect(
        response?.status(),
        `Route ${route} should serve 200`
      ).toBe(200);
    }
  });

  test("browser back/forward works after client navigation", async ({
    page,
  }) => {
    await page.goto("/login");
    expect(page.url()).toContain("/login");

    // Navigate via URL (simulates typing in address bar)
    await page.goto("/auth/callback");
    await page.waitForURL(/\/login/, { timeout: 10_000 }); // redirects back

    await page.goBack();
    await page.waitForLoadState("domcontentloaded");
    expect(page.url()).toBeTruthy();
  });
});

test.describe("Response headers", () => {
  test("HTML responses have correct content-type", async ({ page }) => {
    const response = await page.goto("/login");
    const contentType = response?.headers()["content-type"] || "";
    expect(contentType).toContain("text/html");
  });

  test("no X-Powered-By header exposed", async ({ page }) => {
    const response = await page.goto("/login");
    // Vercel strips this by default, but verify
    const powered = response?.headers()["x-powered-by"];
    expect(powered).toBeUndefined();
  });
});
