import { test, expect } from "@playwright/test";

test.describe("App smoke tests", () => {
  test("root serves 200", async ({ page }) => {
    const response = await page.goto("/");
    expect(response?.status()).toBe(200);
  });

  test("login page serves 200", async ({ page }) => {
    const response = await page.goto("/login");
    expect(response?.status()).toBe(200);
  });

  test("deep link to experiment returns 200 (SPA rewrite)", async ({
    page,
  }) => {
    const response = await page.goto("/experiments/EXP-0001");
    expect(response?.status()).toBe(200);
  });

  test("deep link to direction returns 200", async ({ page }) => {
    const response = await page.goto("/directions/DIR-001");
    expect(response?.status()).toBe(200);
  });

  test("deep link to project returns 200", async ({ page }) => {
    const response = await page.goto("/projects/PROJ-001");
    expect(response?.status()).toBe(200);
  });

  test("deep link to finding returns 200", async ({ page }) => {
    const response = await page.goto("/findings/FIND-001");
    expect(response?.status()).toBe(200);
  });

  test("unknown route returns 200 (SPA handles 404 client-side)", async ({
    page,
  }) => {
    const response = await page.goto("/this-route-does-not-exist");
    // SPA serves index.html for all routes — 200, not 404
    expect(response?.status()).toBe(200);
  });

  test("static assets load (JS bundle present)", async ({ page }) => {
    await page.goto("/");
    const scripts = await page.locator("script[type='module']").count();
    expect(scripts).toBeGreaterThan(0);
  });

  test("no console errors on login page", async ({ page }) => {
    const errors: string[] = [];
    page.on("console", (msg) => {
      if (msg.type() === "error") errors.push(msg.text());
    });
    await page.goto("/login");
    await page.waitForTimeout(1_000);
    // Filter out expected errors (Supabase auth check with no session)
    const unexpected = errors.filter(
      (e) => !e.includes("AuthSessionMissing") && !e.includes("Auth session")
    );
    expect(unexpected).toEqual([]);
  });
});
