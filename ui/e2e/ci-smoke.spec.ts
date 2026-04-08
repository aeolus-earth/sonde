import type { Page } from "@playwright/test";
import { expect, test } from "@playwright/test";
import {
  seedActiveProgram,
  seedBypassSession,
  seedStaleChatSession,
} from "./helpers";

async function mockProgramsRoute(page: Page) {
  await page.route("**/rest/v1/programs*", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify([
        {
          id: "shared",
          name: "Shared",
          description: "CI smoke program",
        },
      ]),
    });
  });
}

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

    const body = (await response.json()) as { status: string };
    expect(body).toEqual({ status: "ok" });
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

  test("chat recovers from a stale agent session on the first message", async ({
    page,
  }) => {
    await seedBypassSession(page);
    await seedStaleChatSession(page);
    await seedActiveProgram(page, "shared");
    await mockProgramsRoute(page);

    await page.goto("/");

    const input = page.locator('textarea[aria-label="Chat message"]:visible').first();
    await expect(input).toBeVisible({ timeout: 15_000 });
    await expect(input).toBeEnabled({ timeout: 15_000 });

    await input.fill("Say hello briefly.");
    await page.locator('button[aria-label="Send"]:visible').first().click();

    await expect(page.getByText("Say hello briefly.", { exact: true })).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.getByText(/Mock response:/)).toBeVisible({
      timeout: 30_000,
    });
    await expect(
      page.getByText("Claude Code process exited with code 1")
    ).not.toBeVisible();
  });

  test("chat waits for auth readiness before sending the first message", async ({
    page,
  }) => {
    await seedBypassSession(page);
    await seedActiveProgram(page, "shared");
    await mockProgramsRoute(page);

    await page.goto("/");

    const input = page.locator('textarea[aria-label="Chat message"]:visible').first();
    await input.fill("Say hello briefly while the agent is still connecting.");
    await page.locator('button[aria-label="Send"]:visible').first().click();

    await expect(
      page.getByText(
        "Say hello briefly while the agent is still connecting.",
        { exact: true }
      )
    ).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText(/Mock response:/)).toBeVisible({
      timeout: 30_000,
    });
    await expect(
      page.getByText("Chat is still connecting to the agent. Please try again in a moment.")
    ).not.toBeVisible();
  });

  test("chat renders a final-only assistant response", async ({ page }) => {
    await seedBypassSession(page);
    await seedActiveProgram(page, "shared");
    await mockProgramsRoute(page);

    await page.goto("/");

    const input = page.locator('textarea[aria-label="Chat message"]:visible').first();
    await expect(input).toBeVisible({ timeout: 15_000 });
    await expect(input).toBeEnabled({ timeout: 15_000 });

    await input.fill("[[FINAL_ONLY_RESPONSE]] Say hello briefly.");
    await page.locator('button[aria-label="Send"]:visible').first().click();

    await expect(page.getByText(/Mock response:/)).toBeVisible({
      timeout: 15_000,
    });
  });
});
