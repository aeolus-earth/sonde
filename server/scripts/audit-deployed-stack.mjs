function requiredEnv(name) {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`Missing required env: ${name}`);
  }
  return value;
}

function parseBooleanFlag(value) {
  return value === "1" || value === "true";
}

function normalizeBaseUrl(value) {
  return value.replace(/\/+$/, "");
}

async function fetchJson(url) {
  const response = await fetch(url);
  const bodyText = await response.text();
  const contentType = response.headers.get("content-type") ?? "";

  if (!response.ok) {
    throw new Error(`Request failed (${response.status}) for ${url}`);
  }

  if (!contentType.includes("application/json")) {
    const normalized = bodyText.trim().toLowerCase();
    if (normalized.startsWith("<!doctype html") || normalized.startsWith("<html")) {
      throw new Error(
        `Expected JSON from ${url}, but received HTML instead. This usually means an SPA rewrite or stale deploy is intercepting the endpoint.`
      );
    }
  }

  let body = null;
  try {
    body = bodyText ? JSON.parse(bodyText) : null;
  } catch {
    throw new Error(
      `Expected JSON from ${url}, but response could not be parsed. Response preview: ${bodyText.slice(0, 160)}`
    );
  }

  return body;
}

async function fetchText(url) {
  const response = await fetch(url);
  const body = await response.text();
  if (!response.ok) {
    throw new Error(`Request failed (${response.status}) for ${url}`);
  }
  return body;
}

function ensure(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function isRailwayHostname(hostname) {
  return hostname.endsWith(".railway.app") || hostname.endsWith(".up.railway.app");
}

async function main() {
  const uiBase = normalizeBaseUrl(requiredEnv("AUDIT_UI_BASE"));
  const agentBase = normalizeBaseUrl(requiredEnv("AUDIT_AGENT_BASE"));
  const expectedEnvironment = process.env.AUDIT_EXPECT_ENVIRONMENT?.trim() || null;
  const expectedCommitSha = process.env.AUDIT_EXPECT_COMMIT_SHA?.trim() || null;
  const expectedSchemaVersion =
    process.env.AUDIT_EXPECT_SCHEMA_VERSION?.trim() || null;
  const expectedSupabaseProjectRef =
    process.env.AUDIT_EXPECT_SUPABASE_PROJECT_REF?.trim() || null;
  const requireDaytona = parseBooleanFlag(
    (process.env.AUDIT_REQUIRE_DAYTONA ?? "1").trim().toLowerCase()
  );
  const requireAnthropic = parseBooleanFlag(
    (process.env.AUDIT_REQUIRE_ANTHROPIC ?? "1").trim().toLowerCase()
  );
  const requireFirstPartyAgent = parseBooleanFlag(
    (process.env.AUDIT_REQUIRE_FIRST_PARTY_AGENT ?? "").trim().toLowerCase()
  );

  const [uiVersion, agentHealth] = await Promise.all([
    fetchJson(`${uiBase}/version.json`),
    fetchJson(`${agentBase}/health`),
  ]);

  ensure(uiVersion?.environment, "UI version metadata is missing environment");
  ensure(
    Object.prototype.hasOwnProperty.call(uiVersion ?? {}, "commitSha"),
    "UI version metadata is missing commitSha"
  );
  ensure(agentHealth?.status === "ok", "Agent health status is not ok");
  ensure(agentHealth?.environment, "Agent health is missing environment");
  ensure(
    Object.prototype.hasOwnProperty.call(agentHealth ?? {}, "commitSha"),
    "Agent health is missing commitSha"
  );
  ensure(
    Object.prototype.hasOwnProperty.call(agentHealth ?? {}, "schemaVersion"),
    "Agent health is missing schemaVersion"
  );
  ensure(
    Object.prototype.hasOwnProperty.call(agentHealth ?? {}, "cliGitRef"),
    "Agent health is missing cliGitRef"
  );
  ensure(
    Object.prototype.hasOwnProperty.call(agentHealth ?? {}, "supabaseProjectRef"),
    "Agent health is missing supabaseProjectRef"
  );

  if (expectedEnvironment) {
    ensure(
      uiVersion.environment === expectedEnvironment,
      `UI environment mismatch: expected ${expectedEnvironment}, got ${uiVersion.environment}`
    );
    ensure(
      agentHealth.environment === expectedEnvironment,
      `Agent environment mismatch: expected ${expectedEnvironment}, got ${agentHealth.environment}`
    );
  }

  if (expectedCommitSha) {
    ensure(
      uiVersion.commitSha === expectedCommitSha,
      `UI commit mismatch: expected ${expectedCommitSha}, got ${uiVersion.commitSha}`
    );
    ensure(
      agentHealth.commitSha === expectedCommitSha,
      `Agent commit mismatch: expected ${expectedCommitSha}, got ${agentHealth.commitSha}`
    );
  } else if (uiVersion.commitSha && agentHealth.commitSha) {
    ensure(
      uiVersion.commitSha === agentHealth.commitSha,
      `UI and agent commit mismatch: ${uiVersion.commitSha} vs ${agentHealth.commitSha}`
    );
  }

  if (expectedSchemaVersion) {
    if (expectedSchemaVersion === "unknown") {
      ensure(
        agentHealth.schemaVersion,
        "Agent health is missing a schemaVersion while audit is running in unknown fallback mode"
      );
    } else {
      ensure(
        agentHealth.schemaVersion === expectedSchemaVersion,
        `Schema version mismatch: expected ${expectedSchemaVersion}, got ${agentHealth.schemaVersion}`
      );
    }
  }

  if (expectedSupabaseProjectRef) {
    ensure(
      agentHealth.supabaseProjectRef === expectedSupabaseProjectRef,
      `Supabase project mismatch: expected ${expectedSupabaseProjectRef}, got ${agentHealth.supabaseProjectRef}`
    );
  }

  if (requireDaytona) {
    ensure(agentHealth.daytonaConfigured, "Agent is missing Daytona configuration");
  }

  if (requireAnthropic) {
    ensure(agentHealth.anthropicConfigured, "Agent is missing Anthropic configuration");
  }

  if (requireFirstPartyAgent) {
    const agentHostname = new URL(agentBase).hostname;
    ensure(
      !isRailwayHostname(agentHostname),
      `Agent host is still provider-branded: ${agentHostname}`
    );

    const loginHtml = await fetchText(`${uiBase}/login`);
    ensure(
      !loginHtml.includes(".railway.app"),
      "UI HTML still exposes a Railway hostname"
    );
  }

  console.log(
    JSON.stringify(
      {
        ui: uiVersion,
        agent: agentHealth,
      },
      null,
      2
    )
  );
}

main().catch((error) => {
  console.error("[audit-deployed-stack] Failed:", error.message);
  process.exit(1);
});
