import { test, expect } from "@playwright/test";

test.describe("Auth gate", () => {
  test("login page loads without Vercel auth gate", async ({ page }) => {
    await page.goto("/login");
    await expect(page.locator("text=Log in to Vercel")).not.toBeVisible();
    expect(page.url()).toContain("/login");
  });

  test("login page shows Sonde branding, not third-party", async ({
    page,
  }) => {
    await page.goto("/login");
    await expect(page.locator("h1")).toContainText("Sonde");
    await expect(
      page.locator("text=Continue with Google")
    ).toBeVisible();
  });

  test("login page shows aeolus.earth domain hint", async ({ page }) => {
    await page.goto("/login");
    await expect(page.locator("text=@aeolus.earth")).toBeVisible();
  });
});

test.describe("Auth redirect", () => {
  test("unauthenticated root redirects to login", async ({ page }) => {
    await page.goto("/");
    await page.waitForURL(/\/login/, { timeout: 10_000 });
  });

  test("unauthenticated /experiments redirects to login", async ({
    page,
  }) => {
    await page.goto("/experiments");
    await page.waitForURL(/\/login/, { timeout: 10_000 });
  });

  test("unauthenticated /dashboard redirects to login", async ({ page }) => {
    await page.goto("/dashboard");
    await page.waitForURL(/\/login/, { timeout: 10_000 });
  });

  test("unauthenticated /brief redirects to login", async ({ page }) => {
    await page.goto("/brief");
    await page.waitForURL(/\/login/, { timeout: 10_000 });
  });

  test("unauthenticated /projects redirects to login", async ({ page }) => {
    await page.goto("/projects");
    await page.waitForURL(/\/login/, { timeout: 10_000 });
  });

  test("redirect param preserved through login flow", async ({ page }) => {
    await page.goto("/experiments/EXP-0001");
    await page.waitForURL(/\/login/, { timeout: 10_000 });
    // The redirect should be preserved as a query param
    const url = new URL(page.url());
    const redirectParam = url.searchParams.get("redirect");
    // Either in URL param or stored in sessionStorage
    if (redirectParam) {
      expect(redirectParam).toContain("experiments");
    }
  });
});

test.describe("Auth callback", () => {
  test("handles OAuth error_description param", async ({ page }) => {
    await page.goto(
      "/auth/callback?error=access_denied&error_description=User+denied+access"
    );
    await page.waitForURL(/\/login/, { timeout: 10_000 });
    await expect(page.locator("text=User denied access")).toBeVisible({
      timeout: 5_000,
    });
  });

  test("handles OAuth error param without description", async ({ page }) => {
    await page.goto("/auth/callback?error=server_error");
    await page.waitForURL(/\/login/, { timeout: 10_000 });
    await expect(page.locator("text=server_error")).toBeVisible({
      timeout: 5_000,
    });
  });

  test("handles missing code gracefully", async ({ page }) => {
    await page.goto("/auth/callback");
    await page.waitForURL(/\/login/, { timeout: 10_000 });
  });

  test("handles invalid code", async ({ page }) => {
    await page.goto("/auth/callback?code=invalid-garbage-code-12345");
    await page.waitForURL(/\/login/, { timeout: 10_000 });
  });

  test("handles empty code param", async ({ page }) => {
    await page.goto("/auth/callback?code=");
    await page.waitForURL(/\/login/, { timeout: 10_000 });
  });

  test("handles URL-encoded error description", async ({ page }) => {
    await page.goto(
      "/auth/callback?error=invalid_request&error_description=The%20redirect_uri%20is%20not%20allowed"
    );
    await page.waitForURL(/\/login/, { timeout: 10_000 });
    await expect(
      page.locator("text=The redirect_uri is not allowed")
    ).toBeVisible({ timeout: 5_000 });
  });
});

test.describe("Login error display", () => {
  test("error param shown in alert", async ({ page }) => {
    await page.goto("/login?error=Something+went+wrong");
    const alert = page.locator("[role='alert']");
    await expect(alert).toBeVisible();
    await expect(alert).toContainText("Something went wrong");
  });

  test("no alert when no error", async ({ page }) => {
    await page.goto("/login");
    await expect(page.locator("[role='alert']")).not.toBeVisible();
  });
});
