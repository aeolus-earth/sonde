import { test, expect } from "@playwright/test";

test.describe("App smoke tests", () => {
  test("app serves index.html (SPA routing works)", async ({ page }) => {
    const response = await page.goto("/");
    expect(response?.status()).toBe(200);
  });

  test("deep link returns 200 (SPA rewrite)", async ({ page }) => {
    const response = await page.goto("/experiments/EXP-0001");
    expect(response?.status()).toBe(200);
  });

  test("static assets load (CSS/JS bundles)", async ({ page }) => {
    const response = await page.goto("/");
    expect(response?.status()).toBe(200);
    // Vite injects at least one script tag
    const scripts = await page.locator("script[type='module']").count();
    expect(scripts).toBeGreaterThan(0);
  });
});
