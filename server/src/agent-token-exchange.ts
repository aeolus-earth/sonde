import { createHash } from "node:crypto";
import { getServiceRoleSupabaseClient } from "./supabase.js";

export const OPAQUE_AGENT_TOKEN_PREFIX = "sonde_ak_";

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

function tokenHash(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

function cleanMetadataValue(value: string | null | undefined): string | null {
  const trimmed = value?.trim() ?? "";
  return trimmed ? trimmed.slice(0, 200) : null;
}

function parseExchangeResult(value: unknown): AgentTokenExchangeResult {
  if (!value || typeof value !== "object") {
    throw new Error("Agent token exchange returned an empty response.");
  }
  const data = value as Record<string, unknown>;
  const accessToken = typeof data.access_token === "string" ? data.access_token : "";
  const tokenType = typeof data.token_type === "string" ? data.token_type : "";
  const expiresIn = typeof data.expires_in === "number" ? data.expires_in : 0;
  const expiresAt = typeof data.expires_at === "string" ? data.expires_at : "";
  const tokenId = typeof data.token_id === "string" ? data.token_id : "";
  const programs = Array.isArray(data.programs)
    ? data.programs.filter((program): program is string => typeof program === "string")
    : [];

  if (!accessToken || tokenType !== "bearer" || expiresIn <= 0 || !expiresAt || !tokenId) {
    throw new Error("Agent token exchange returned an incomplete response.");
  }

  return {
    access_token: accessToken,
    token_type: "bearer",
    expires_in: expiresIn,
    expires_at: expiresAt,
    token_id: tokenId,
    programs,
  };
}

export async function exchangeAgentToken(
  input: AgentTokenExchangeInput,
  env: NodeJS.ProcessEnv = process.env,
): Promise<AgentTokenExchangeResult> {
  if (!input.token.startsWith(OPAQUE_AGENT_TOKEN_PREFIX)) {
    throw new AgentTokenExchangeDeniedError("Invalid or expired agent token.");
  }

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

  return parseExchangeResult(data);
}
