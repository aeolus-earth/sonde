import type { Session, User } from "@supabase/supabase-js";

function decodeJwtPayload(
  token: string | null | undefined,
): Record<string, unknown> | null {
  const raw = token?.trim() ?? "";
  if (!raw) {
    return null;
  }

  const segments = raw.split(".");
  if (segments.length < 2) {
    return null;
  }

  try {
    const normalized = segments[1]!
      .replace(/-/g, "+")
      .replace(/_/g, "/")
      .padEnd(Math.ceil(segments[1]!.length / 4) * 4, "=");
    const payload = window.atob(normalized);
    const parsed = JSON.parse(payload);
    return parsed && typeof parsed === "object"
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

function hasAdminFlag(
  appMetadata: Record<string, unknown> | null | undefined,
): boolean {
  return appMetadata?.is_admin === true || appMetadata?.isAdmin === true;
}

export function isAdminUser(user: User | null | undefined): boolean {
  if (!user) {
    return false;
  }

  return hasAdminFlag(user.app_metadata as Record<string, unknown> | undefined);
}

export function isAdminSession(session: Session | null | undefined): boolean {
  if (!session) {
    return false;
  }

  const claims = decodeJwtPayload(session.access_token);
  const appMetadata =
    claims?.app_metadata && typeof claims.app_metadata === "object"
      ? (claims.app_metadata as Record<string, unknown>)
      : null;

  return hasAdminFlag(appMetadata) || isAdminUser(session.user);
}
