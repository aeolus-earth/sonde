import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const DEFAULT_COMPAT_PATH = "cli/src/sonde/db/compat.py";

function requiredValue(name, value) {
  const normalized = value?.trim();
  if (!normalized) {
    throw new Error(`Missing required env: ${name}`);
  }
  return normalized;
}

export function parseMinimumSchemaVersion(text, source = DEFAULT_COMPAT_PATH) {
  const match = text.match(/^\s*MINIMUM_SCHEMA_VERSION\s*=\s*(\d+)\s*$/m);
  if (!match) {
    throw new Error(`Could not determine MINIMUM_SCHEMA_VERSION from ${source}.`);
  }
  return Number.parseInt(match[1], 10);
}

export function normalizeSchemaVersion(value, source = "get_schema_version") {
  let normalized = value;
  if (Array.isArray(normalized)) {
    if (normalized.length === 0) {
      throw new Error(`${source} returned an empty array.`);
    }
    normalized = normalized[0];
  }
  if (normalized && typeof normalized === "object") {
    normalized = normalized.get_schema_version ?? normalized.version;
  }
  if (typeof normalized === "string") {
    normalized = normalized.trim();
    if (!/^\d+$/.test(normalized)) {
      throw new Error(`${source} returned a non-numeric schema version: ${normalized}`);
    }
    return Number.parseInt(normalized, 10);
  }
  if (typeof normalized === "number" && Number.isInteger(normalized) && normalized >= 0) {
    return normalized;
  }
  throw new Error(`${source} returned an invalid schema version.`);
}

export function parseSchemaVersionResponse(bodyText, source = "get_schema_version") {
  const trimmed = bodyText.trim();
  if (!trimmed) {
    throw new Error(`${source} returned an empty response.`);
  }
  let parsed;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    throw new Error(`${source} returned invalid JSON: ${trimmed.slice(0, 160)}`);
  }
  return normalizeSchemaVersion(parsed, source);
}

export function assertHostedSchemaCompatible(remoteVersion, minimumVersion) {
  if (remoteVersion < minimumVersion) {
    throw new Error(
      `Hosted schema version ${remoteVersion} is below CLI minimum ${minimumVersion}. Run the hosted Supabase migrations before deploying this commit.`,
    );
  }
}

export async function resolveHostedSchemaVersion({
  projectRef,
  anonKey,
  compatPath = DEFAULT_COMPAT_PATH,
  fetchImpl = globalThis.fetch,
  readFile = readFileSync,
} = {}) {
  const resolvedProjectRef = requiredValue("SUPABASE_PROJECT_REF", projectRef);
  const resolvedAnonKey = requiredValue("SUPABASE_ANON_KEY", anonKey);
  if (typeof fetchImpl !== "function") {
    throw new Error("No fetch implementation is available.");
  }

  const minimumVersion = parseMinimumSchemaVersion(readFile(compatPath, "utf8"), compatPath);
  const url = `https://${resolvedProjectRef}.supabase.co/rest/v1/rpc/get_schema_version`;
  const response = await fetchImpl(url, {
    headers: {
      apikey: resolvedAnonKey,
      Authorization: `Bearer ${resolvedAnonKey}`,
    },
  });
  const bodyText = await response.text();
  if (!response.ok) {
    throw new Error(
      `get_schema_version failed (${response.status}) for ${url}: ${bodyText.slice(0, 160)}`,
    );
  }

  const remoteVersion = parseSchemaVersionResponse(bodyText, "get_schema_version");
  assertHostedSchemaCompatible(remoteVersion, minimumVersion);
  return { minimumVersion, remoteVersion };
}

export function renderGithubOutputs({ minimumVersion, remoteVersion }) {
  return [
    `minimum_version=${minimumVersion}`,
    `remote_version=${remoteVersion}`,
    `version=${remoteVersion}`,
  ].join("\n");
}

function envValue(name, fallbackName = null) {
  return process.env[name] ?? (fallbackName ? process.env[fallbackName] : undefined);
}

async function main() {
  const result = await resolveHostedSchemaVersion({
    projectRef: envValue("HOSTED_SCHEMA_SUPABASE_PROJECT_REF", "SUPABASE_PROJECT_REF"),
    anonKey: envValue("HOSTED_SCHEMA_SUPABASE_ANON_KEY", "SUPABASE_ANON_KEY"),
    compatPath: process.env.SCHEMA_COMPAT_PATH ?? DEFAULT_COMPAT_PATH,
  });
  console.error(
    `Hosted schema version ${result.remoteVersion} satisfies CLI minimum ${result.minimumVersion}.`,
  );
  console.log(renderGithubOutputs(result));
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  main().catch((error) => {
    console.error(
      `[resolve-hosted-schema-version] ${error instanceof Error ? error.message : String(error)}`,
    );
    process.exit(1);
  });
}
