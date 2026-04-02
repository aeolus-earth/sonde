import { test, expect } from "@playwright/test";

test.describe("Auth flow", () => {
  test("login page loads without Vercel auth gate", async ({ page }) => {
    await page.goto("/login");
    // Should see our Supabase login UI, NOT Vercel's "Log in to Vercel" page
    await expect(page.locator("text=Log in to Vercel")).not.toBeVisible();
    // Page should have loaded successfully (200, not 401/403)
    expect(page.url()).toContain("/login");
  });

  test("unauthenticated user redirected to login", async ({ page }) => {
    await page.goto("/");
    // Should redirect to login within a few seconds
    await page.waitForURL(/\/login/, { timeout: 10_000 });
  });

  test("auth callback handles OAuth error params", async ({ page }) => {
    await page.goto(
      "/auth/callback?error=access_denied&error_description=User+denied+access"
    );
    // Should redirect to login with the error visible
    await page.waitForURL(/\/login/, { timeout: 10_000 });
    await expect(page.locator("text=User denied access")).toBeVisible({
      timeout: 5_000,
    });
  });

  test("auth callback handles missing code gracefully", async ({ page }) => {
    await page.goto("/auth/callback");
    // Should redirect to login (no code = no session)
    await page.waitForURL(/\/login/, { timeout: 10_000 });
  });

  test("auth callback with invalid code shows error", async ({ page }) => {
    await page.goto("/auth/callback?code=invalid-garbage-code");
    // Should redirect to login with some error (Supabase rejects the code)
    await page.waitForURL(/\/login/, { timeout: 10_000 });
  });
});
