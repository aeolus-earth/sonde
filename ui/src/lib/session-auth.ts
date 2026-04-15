import type { Session } from "@supabase/supabase-js";

const ACCESS_TOKEN_REFRESH_WINDOW_MS = 60_000;

type SessionResponse = {
  data: { session: Session | null };
  error: { message: string } | null;
};

type AuthClient = {
  getSession: () => Promise<SessionResponse>;
  refreshSession: () => Promise<SessionResponse>;
};

export class SessionReauthRequiredError extends Error {
  constructor(message = "Session expired. Sign in again to continue.") {
    super(message);
    this.name = "SessionReauthRequiredError";
  }
}

function trimAccessToken(session: Session | null): string {
  return session?.access_token?.trim() ?? "";
}

function hasExpiryTimestamp(session: Session | null): session is Session & { expires_at: number } {
  return typeof session?.expires_at === "number" && Number.isFinite(session.expires_at);
}

function isExpiringSoon(
  session: Session | null,
  now: number,
  refreshWindowMs: number,
): boolean {
  if (!hasExpiryTimestamp(session)) {
    return false;
  }
  const expiresAtMs = (session?.expires_at ?? 0) * 1000;
  return expiresAtMs <= now + refreshWindowMs;
}

async function getSessionOrThrow(
  authClient: AuthClient,
  reauthMessage: string,
): Promise<Session | null> {
  const {
    data: { session },
    error,
  } = (await authClient.getSession()) as SessionResponse;
  if (error) {
    throw new SessionReauthRequiredError(reauthMessage);
  }
  return session;
}

async function getDefaultAuthClient(): Promise<AuthClient> {
  const { supabase } = await import("@/lib/supabase");
  return supabase.auth;
}

export async function getFreshAccessToken(options?: {
  authClient?: AuthClient;
  reauthMessage?: string;
  refreshWindowMs?: number;
  now?: number;
}): Promise<string> {
  const authClient = options?.authClient ?? (await getDefaultAuthClient());
  const reauthMessage =
    options?.reauthMessage ?? "Session expired. Sign in again to continue.";
  const refreshWindowMs =
    options?.refreshWindowMs ?? ACCESS_TOKEN_REFRESH_WINDOW_MS;
  const now = options?.now ?? Date.now();

  let session = await getSessionOrThrow(authClient, reauthMessage);
  let token = trimAccessToken(session);

  if (!session || !token || isExpiringSoon(session, now, refreshWindowMs)) {
    const {
      data: refreshed,
      error: refreshError,
    } = (await authClient.refreshSession()) as SessionResponse;

    if (refreshError || !refreshed.session) {
      throw new SessionReauthRequiredError(reauthMessage);
    }

    session = refreshed.session;
    token = trimAccessToken(session);
  }

  if (!token) {
    throw new SessionReauthRequiredError(reauthMessage);
  }

  return token;
}
