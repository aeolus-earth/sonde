import type { Page } from "@playwright/test";

const defaultSupabaseUrl = "https://utvmqjssbkzpumsdpgdy.supabase.co";
const defaultBypassToken = "playwright-smoke-token";
const activationStorageKey = "sonde-activation-auth";

function getSupabaseProjectRef(): string {
  const raw =
    process.env.E2E_SUPABASE_URL ||
    process.env.VITE_SUPABASE_URL ||
    defaultSupabaseUrl;
  return new URL(raw).hostname.split(".")[0] ?? "local";
}

function createBypassSession() {
  const nowSeconds = Math.floor(Date.now() / 1000);
  return {
    access_token: process.env.E2E_AUTH_BYPASS_TOKEN || defaultBypassToken,
    refresh_token: "playwright-refresh-token",
    token_type: "bearer",
    expires_in: 60 * 60,
    expires_at: nowSeconds + 60 * 60,
    user: {
      id: "00000000-0000-0000-0000-000000000001",
      aud: "authenticated",
      role: "authenticated",
      email: "ci-smoke@aeolus.earth",
      email_confirmed_at: "2026-04-07T00:00:00Z",
      phone: "",
      confirmed_at: "2026-04-07T00:00:00Z",
      last_sign_in_at: "2026-04-07T00:00:00Z",
      app_metadata: {
        provider: "email",
        providers: ["email"],
      },
      user_metadata: {
        full_name: "CI Smoke",
      },
      identities: [],
      created_at: "2026-04-07T00:00:00Z",
      updated_at: "2026-04-07T00:00:00Z",
      is_anonymous: false,
    },
  };
}

export async function seedBypassSession(page: Page): Promise<void> {
  const storageKey = `sb-${getSupabaseProjectRef()}-auth-token`;
  const session = createBypassSession();

  await page.addInitScript(
    ({ key, value }) => {
      window.localStorage.setItem(key, JSON.stringify(value));
      window.localStorage.setItem(`${key}-user`, JSON.stringify({ user: value.user }));
    },
    {
      key: storageKey,
      value: session,
    }
  );
}

function parseSessionJson(sessionJson: string) {
  const parsed = JSON.parse(sessionJson) as {
    access_token: string;
    refresh_token: string;
    user: Record<string, unknown>;
  };

  if (!parsed.access_token || !parsed.refresh_token || !parsed.user) {
    throw new Error("E2E auth session JSON is missing required session fields.");
  }

  return parsed;
}

export async function seedSupabaseSession(
  page: Page,
  sessionJson: string
): Promise<void> {
  const storageKey = `sb-${getSupabaseProjectRef()}-auth-token`;
  const session = parseSessionJson(sessionJson);

  await page.addInitScript(
    ({ key, value }) => {
      window.localStorage.setItem(key, JSON.stringify(value));
      window.localStorage.setItem(`${key}-user`, JSON.stringify({ user: value.user }));
    },
    {
      key: storageKey,
      value: session,
    }
  );
}

export async function seedActivationSession(
  page: Page,
  sessionJson: string
): Promise<void> {
  const session = parseSessionJson(sessionJson);

  await page.addInitScript(
    ({ key, value }) => {
      window.localStorage.setItem(key, JSON.stringify(value));
    },
    {
      key: activationStorageKey,
      value: session,
    }
  );
}

export async function seedConfiguredSession(page: Page): Promise<void> {
  const realSession = process.env.E2E_AUTH_SESSION_JSON?.trim();
  if (realSession) {
    await seedSupabaseSession(page, realSession);
    return;
  }

  await seedBypassSession(page);
}

export async function seedStaleChatSession(page: Page): Promise<void> {
  const staleState = {
    state: {
      tabs: [
        {
          id: "tab-stale-session",
          title: "Chat 1",
          messages: [],
          tasks: [],
          agentSessionId: "deadbeef-dead-beef-dead-beefdeadbeef",
          pendingToolApprovals: [],
        },
      ],
      activeTabId: "tab-stale-session",
    },
    version: 3,
  };

  await page.addInitScript((value) => {
    window.localStorage.setItem("sonde-chat", JSON.stringify(value));
  }, staleState);
}

export async function seedActiveProgram(
  page: Page,
  programId = "shared"
): Promise<void> {
  const persisted = {
    state: {
      activeProgram: programId,
    },
    version: 0,
  };

  await page.addInitScript((value) => {
    window.localStorage.setItem("sonde-active-program", JSON.stringify(value));
  }, persisted);
}
