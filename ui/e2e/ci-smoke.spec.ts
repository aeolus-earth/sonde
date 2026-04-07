import { expect, test } from "@playwright/test";
import { seedBypassSession } from "./helpers";

test.describe("CI smoke", () => {
  test("login renders without third-party auth gate", async ({ page }) => {
    await page.goto("/login");
    await expect(page.locator("text=Log in to Vercel")).not.toBeVisible();
    await expect(page.getByRole("heading", { name: "Sonde" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Continue with Google" })).toBeVisible();
  });

  test("unauthenticated root redirects to login", async ({ page }) => {
    await page.goto("/");
    await page.waitForURL(/\/login/, { timeout: 10_000 });
    await expect(page.getByRole("button", { name: "Continue with Google" })).toBeVisible();
  });

  test("agent health is reachable through the UI proxy", async ({ request, baseURL }) => {
    const response = await request.get(new URL("/agent/health", baseURL).toString());
    expect(response.ok()).toBeTruthy();

    const body = (await response.json()) as {
      status: string;
      environment: string;
      commitSha: string | null;
    };
    expect(body.status).toBe("ok");
    expect(body.environment).toBeTruthy();
    expect(body.commitSha ?? null).not.toBeUndefined();
  });

  test("authenticated routes render behind the auth gate", async ({ page }) => {
    await seedBypassSession(page);
    await page.goto("/does-not-exist");
    await expect(page).toHaveURL(/\/does-not-exist$/);
    await expect(
      page.getByRole("heading", { name: "Page not found" })
    ).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText("ci-smoke@aeolus.earth")).toBeVisible();
  });
});
