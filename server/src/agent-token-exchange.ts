import { createHash } from "node:crypto";
import {
  getServiceRoleSupabaseClient,
  getSupabaseAnonKey,
  getSupabaseServiceRoleKey,
  getSupabaseUrl,
} from "./supabase.js";

export const OPAQUE_AGENT_TOKEN_PREFIX = "sonde_ak_";
const AGENT_AUTH_EMAIL_DOMAIN = "aeolus.earth";
const MAX_AUTH_USER_SCAN_PAGES = 20;
const AUTH_USER_SCAN_PAGE_SIZE = 1000;

export interface AgentTokenExchangeInput {
  token: string;
  cliVersion?: string | null;
  hostLabel?: string | null;
}

export interface AgentTokenExchangeResult {
  access_token: string;
  token_type: "bearer";
  expires_in: number;
  expires_at: string;
  token_id: string;
  programs: string[];
}

export class AgentTokenExchangeConfigError extends Error {}

export class AgentTokenExchangeDeniedError extends Error {}

interface AgentTokenMetadata {
  token_id: string;
  name: string;
  programs: string[];
  expires_at: string;
}

interface SupabaseAuthConfig {
  url: string;
  anonKey: string;
  serviceRoleKey: string;
}

interface SupabaseAuthUser {
  id: string;
  email?: string;
}

interface SupabaseAuthUserList {
  users?: SupabaseAuthUser[];
}

interface SupabaseGenerateLinkResponse {
  hashed_token?: string;
  properties?: {
    hashed_token?: string;
  };
}

interface SupabaseVerifyResponse {
  access_token?: string;
  token_type?: string;
  expires_in?: number;
}

function tokenHash(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

function cleanMetadataValue(value: string | null | undefined): string | null {
  const trimmed = value?.trim() ?? "";
  return trimmed ? trimmed.slice(0, 200) : null;
}

function parseTokenMetadata(value: unknown): AgentTokenMetadata {
  if (!value || typeof value !== "object") {
    throw new Error("Agent token exchange returned an empty response.");
  }
  const data = value as Record<string, unknown>;
  const tokenId = typeof data.token_id === "string" ? data.token_id : "";
  const name = typeof data.name === "string" ? data.name : "";
  const expiresAt = typeof data.expires_at === "string" ? data.expires_at : "";
  const programs = Array.isArray(data.programs)
    ? data.programs.filter((program): program is string => typeof program === "string")
    : [];

  if (!tokenId || !name || !expiresAt) {
    throw new Error("Agent token exchange returned an incomplete response.");
  }

  return {
    token_id: tokenId,
    name,
    programs,
    expires_at: expiresAt,
  };
}

function getAuthConfig(env: NodeJS.ProcessEnv): SupabaseAuthConfig {
  const serviceRoleKey = getSupabaseServiceRoleKey(env);
  if (!serviceRoleKey) {
    throw new AgentTokenExchangeConfigError(
      "SUPABASE_SERVICE_ROLE_KEY is required for agent token exchange.",
    );
  }

  try {
    return {
      url: getSupabaseUrl(env).replace(/\/+$/, ""),
      anonKey: getSupabaseAnonKey(env),
      serviceRoleKey,
    };
  } catch (error) {
    throw new AgentTokenExchangeConfigError(
      error instanceof Error ? error.message : "Supabase configuration is incomplete.",
    );
  }
}

function agentEmail(tokenId: string): string {
  return `agent-${tokenId}@${AGENT_AUTH_EMAIL_DOMAIN}`;
}

function authHeaders(key: string): Record<string, string> {
  return {
    apikey: key,
    authorization: `Bearer ${key}`,
    "content-type": "application/json",
  };
}

function extractSupabaseMessage(value: unknown): string | null {
  if (!value || typeof value !== "object") return null;
  const data = value as Record<string, unknown>;
  for (const key of ["msg", "message", "error_description", "error"]) {
    const candidate = data[key];
    if (typeof candidate === "string" && candidate.trim()) {
      return candidate.trim();
    }
  }
  return null;
}

async function readJson(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return { message: text };
  }
}

async function fetchAuthJson<T>(
  config: SupabaseAuthConfig,
  path: string,
  key: string,
  init: Omit<RequestInit, "headers"> = {},
): Promise<T> {
  const response = await fetch(`${config.url}${path}`, {
    ...init,
    headers: authHeaders(key),
  });
  const body = await readJson(response);
  if (!response.ok) {
    const message =
      extractSupabaseMessage(body) ||
      `Supabase Auth request failed with HTTP ${response.status}.`;
    throw new Error(message);
  }
  return body as T;
}

function agentAppMetadata(metadata: AgentTokenMetadata): Record<string, unknown> {
  return {
    agent: true,
    programs: metadata.programs,
    token_id: metadata.token_id,
    token_name: metadata.name,
    agent_name: metadata.name,
  };
}

function agentUserMetadata(metadata: AgentTokenMetadata): Record<string, unknown> {
  return {
    agent_name: metadata.name,
  };
}

async function findAgentAuthUser(
  config: SupabaseAuthConfig,
  email: string,
): Promise<SupabaseAuthUser | null> {
  for (let page = 1; page <= MAX_AUTH_USER_SCAN_PAGES; page += 1) {
    const params = new URLSearchParams({
      page: String(page),
      per_page: String(AUTH_USER_SCAN_PAGE_SIZE),
    });
    const result = await fetchAuthJson<SupabaseAuthUserList>(
      config,
      `/auth/v1/admin/users?${params.toString()}`,
      config.serviceRoleKey,
      { method: "GET" },
    );
    const users = Array.isArray(result.users) ? result.users : [];
    const found = users.find((user) => user.email?.toLowerCase() === email.toLowerCase());
    if (found) {
      return found;
    }
    if (users.length < AUTH_USER_SCAN_PAGE_SIZE) {
      return null;
    }
  }

  throw new Error("Unable to scan Supabase Auth users for the agent token account.");
}

async function createAgentAuthUser(
  config: SupabaseAuthConfig,
  email: string,
  metadata: AgentTokenMetadata,
): Promise<SupabaseAuthUser> {
  return fetchAuthJson<SupabaseAuthUser>(
    config,
    "/auth/v1/admin/users",
    config.serviceRoleKey,
    {
      method: "POST",
      body: JSON.stringify({
        email,
        email_confirm: true,
        app_metadata: agentAppMetadata(metadata),
        user_metadata: agentUserMetadata(metadata),
      }),
    },
  );
}

async function updateAgentAuthUser(
  config: SupabaseAuthConfig,
  user: SupabaseAuthUser,
  metadata: AgentTokenMetadata,
): Promise<void> {
  await fetchAuthJson<SupabaseAuthUser>(
    config,
    `/auth/v1/admin/users/${encodeURIComponent(user.id)}`,
    config.serviceRoleKey,
    {
      method: "PUT",
      body: JSON.stringify({
        email_confirm: true,
        app_metadata: agentAppMetadata(metadata),
        user_metadata: agentUserMetadata(metadata),
      }),
    },
  );
}

async function ensureAgentAuthUser(
  config: SupabaseAuthConfig,
  metadata: AgentTokenMetadata,
): Promise<string> {
  const email = agentEmail(metadata.token_id);
  const existing = await findAgentAuthUser(config, email);
  if (existing) {
    await updateAgentAuthUser(config, existing, metadata);
  } else {
    try {
      await createAgentAuthUser(config, email, metadata);
    } catch (error) {
      const message = error instanceof Error ? error.message : "";
      if (!/already|registered|exists/i.test(message)) {
        throw error;
      }
      const racedUser = await findAgentAuthUser(config, email);
      if (!racedUser) {
        throw error;
      }
      await updateAgentAuthUser(config, racedUser, metadata);
    }
  }
  return email;
}

async function generateMagicLinkHash(
  config: SupabaseAuthConfig,
  email: string,
): Promise<string> {
  const result = await fetchAuthJson<SupabaseGenerateLinkResponse>(
    config,
    "/auth/v1/admin/generate_link",
    config.serviceRoleKey,
    {
      method: "POST",
      body: JSON.stringify({
        type: "magiclink",
        email,
      }),
    },
  );

  const hash = result.hashed_token || result.properties?.hashed_token || "";
  if (!hash) {
    throw new Error("Supabase Auth did not return a magic-link token hash.");
  }
  return hash;
}

function jwtExpiry(accessToken: string, fallbackExpiresIn: number): {
  expiresIn: number;
  expiresAt: string;
} {
  const fallbackExpiresAt = new Date(Date.now() + fallbackExpiresIn * 1000).toISOString();
  const [, payload] = accessToken.split(".");
  if (!payload) {
    return { expiresIn: fallbackExpiresIn, expiresAt: fallbackExpiresAt };
  }

  try {
    const claims = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as {
      exp?: unknown;
    };
    if (typeof claims.exp === "number" && Number.isFinite(claims.exp)) {
      return {
        expiresIn: Math.max(1, Math.floor(claims.exp - Date.now() / 1000)),
        expiresAt: new Date(claims.exp * 1000).toISOString(),
      };
    }
  } catch {
    return { expiresIn: fallbackExpiresIn, expiresAt: fallbackExpiresAt };
  }

  return { expiresIn: fallbackExpiresIn, expiresAt: fallbackExpiresAt };
}

async function createAgentSession(
  config: SupabaseAuthConfig,
  email: string,
  metadata: AgentTokenMetadata,
): Promise<AgentTokenExchangeResult> {
  const tokenHashValue = await generateMagicLinkHash(config, email);
  const session = await fetchAuthJson<SupabaseVerifyResponse>(
    config,
    "/auth/v1/verify",
    config.anonKey,
    {
      method: "POST",
      body: JSON.stringify({
        type: "magiclink",
        token_hash: tokenHashValue,
      }),
    },
  );

  const accessToken = session.access_token || "";
  const tokenType = session.token_type || "";
  const fallbackExpiresIn = typeof session.expires_in === "number" ? session.expires_in : 3600;
  if (!accessToken || tokenType.toLowerCase() !== "bearer" || fallbackExpiresIn <= 0) {
    throw new Error("Supabase Auth returned an incomplete agent session.");
  }

  const expiry = jwtExpiry(accessToken, fallbackExpiresIn);
  return {
    access_token: accessToken,
    token_type: "bearer",
    expires_in: expiry.expiresIn,
    expires_at: expiry.expiresAt,
    token_id: metadata.token_id,
    programs: metadata.programs,
  };
}

export async function exchangeAgentToken(
  input: AgentTokenExchangeInput,
  env: NodeJS.ProcessEnv = process.env,
): Promise<AgentTokenExchangeResult> {
  if (!input.token.startsWith(OPAQUE_AGENT_TOKEN_PREFIX)) {
    throw new AgentTokenExchangeDeniedError("Invalid or expired agent token.");
  }

  const authConfig = getAuthConfig(env);
  const supabase = getServiceRoleSupabaseClient(env);
  if (!supabase) {
    throw new AgentTokenExchangeConfigError(
      "SUPABASE_SERVICE_ROLE_KEY is required for agent token exchange.",
    );
  }

  const { data, error } = await supabase.rpc("exchange_agent_token", {
    p_token_hash: tokenHash(input.token),
    p_cli_version: cleanMetadataValue(input.cliVersion),
    p_host_label: cleanMetadataValue(input.hostLabel),
  });

  if (error) {
    const message = error.message || "Invalid or expired agent token.";
    if (/invalid or expired agent token/i.test(message)) {
      throw new AgentTokenExchangeDeniedError("Invalid or expired agent token.");
    }
    throw new Error(message);
  }

  const metadata = parseTokenMetadata(data);
  const email = await ensureAgentAuthUser(authConfig, metadata);
  return createAgentSession(authConfig, email, metadata);
}
