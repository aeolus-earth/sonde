import type { Session } from "@supabase/supabase-js";

const USER_CODE_PATTERN = /^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{4}-[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{4}$/;

export interface DeviceActivationDetails {
  status: string;
  host_label: string | null;
  cli_version: string | null;
  remote_hint: boolean;
  login_method: string | null;
  requested_at: string;
  expires_at: string;
}

export function normalizeActivationCode(rawValue: string): string {
  const cleaned = rawValue
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
    .replace(/[01ILO]/g, "");
  if (cleaned.length !== 8) {
    return "";
  }
  const formatted = `${cleaned.slice(0, 4)}-${cleaned.slice(4)}`;
  return USER_CODE_PATTERN.test(formatted) ? formatted : "";
}

function errorMessageFromPayload(payload: unknown, fallback: string): string {
  if (!payload || typeof payload !== "object") {
    return fallback;
  }
  const nested = (payload as { error?: { message?: unknown } }).error?.message;
  if (typeof nested === "string" && nested.trim()) {
    return nested.trim();
  }
  const direct = (payload as { message?: unknown }).message;
  return typeof direct === "string" && direct.trim() ? direct.trim() : fallback;
}

async function postDeviceActivation<T>(
  path: string,
  payload: Record<string, unknown>,
  accessToken?: string
): Promise<T> {
  const response = await fetch(path, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
    },
    body: JSON.stringify(payload),
  });

  const json = (await response.json().catch(() => null)) as unknown;
  if (!response.ok) {
    throw new Error(
      errorMessageFromPayload(json, `Request failed with status ${response.status}`)
    );
  }
  return json as T;
}

export async function fetchActivationDetails(
  userCode: string,
  accessToken: string
): Promise<DeviceActivationDetails> {
  return postDeviceActivation<DeviceActivationDetails>(
    "/auth/device/introspect",
    { user_code: userCode },
    accessToken
  );
}

export async function completeActivation(
  userCode: string,
  decision: "approve" | "deny",
  session: Session | null
): Promise<DeviceActivationDetails> {
  return postDeviceActivation<DeviceActivationDetails>(
    "/auth/device/approve",
    {
      user_code: userCode,
      decision,
      session:
        decision === "approve" && session
          ? {
              access_token: session.access_token,
              refresh_token: session.refresh_token,
              user: {
                id: session.user.id,
                email: session.user.email,
                app_metadata: session.user.app_metadata,
                user_metadata: session.user.user_metadata,
              },
            }
          : undefined,
    },
    session?.access_token
  );
}
