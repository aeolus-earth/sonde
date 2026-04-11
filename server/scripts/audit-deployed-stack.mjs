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

function parseNumber(value, fallback) {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

async function fetchJson(url, init) {
  const response = await fetch(url, init);
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

function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function collectRuntimeState({ uiBase, agentBase, runtimeAuditToken }) {
  const [uiVersion, agentHealth, agentRuntime] = await Promise.all([
    fetchJson(`${uiBase}/version.json`),
    fetchJson(`${agentBase}/health`),
    fetchJson(`${agentBase}/health/runtime`, {
      headers: runtimeAuditToken
        ? {
            Authorization: `Bearer ${runtimeAuditToken}`,
          }
        : {},
    }),
  ]);

  return { uiVersion, agentHealth, agentRuntime };
}

async function main() {
  const uiBase = normalizeBaseUrl(requiredEnv("AUDIT_UI_BASE"));
  const agentBase = normalizeBaseUrl(requiredEnv("AUDIT_AGENT_BASE"));
  const runtimeAuditToken = process.env.AUDIT_RUNTIME_TOKEN?.trim() || null;
  if (!runtimeAuditToken) {
    throw new Error("Missing required env: AUDIT_RUNTIME_TOKEN");
  }
  const expectedEnvironment = process.env.AUDIT_EXPECT_ENVIRONMENT?.trim() || null;
  const expectedCommitSha = process.env.AUDIT_EXPECT_COMMIT_SHA?.trim() || null;
  const expectedSchemaVersion =
    process.env.AUDIT_EXPECT_SCHEMA_VERSION?.trim() || null;
  const expectedSupabaseProjectRef =
    process.env.AUDIT_EXPECT_SUPABASE_PROJECT_REF?.trim() || null;
  const requireAnthropic = parseBooleanFlag(
    (process.env.AUDIT_REQUIRE_ANTHROPIC ?? "1").trim().toLowerCase()
  );
  const requireFirstPartyAgent = parseBooleanFlag(
    (process.env.AUDIT_REQUIRE_FIRST_PARTY_AGENT ?? "").trim().toLowerCase()
  );
  const requireSharedRateLimit = parseBooleanFlag(
    (process.env.AUDIT_REQUIRE_SHARED_RATE_LIMIT ?? "").trim().toLowerCase()
  );
  const waitTimeoutMs = parseNumber(process.env.AUDIT_WAIT_TIMEOUT_MS, 0);
  const waitIntervalMs = parseNumber(process.env.AUDIT_WAIT_INTERVAL_MS, 5000);

  let state;
  let lastError = null;
  const deadline = Date.now() + waitTimeoutMs;

  while (true) {
    try {
      state = await collectRuntimeState({ uiBase, agentBase, runtimeAuditToken });
      break;
    } catch (error) {
      lastError = error;
      if (Date.now() >= deadline || waitTimeoutMs <= 0) {
        throw error;
      }
      await sleep(waitIntervalMs);
    }
  }

  let { uiVersion, agentHealth, agentRuntime } = state;

  while (true) {
    try {
      ensure(uiVersion?.environment, "UI version metadata is missing environment");
      ensure(
        Object.prototype.hasOwnProperty.call(uiVersion ?? {}, "commitSha"),
        "UI version metadata is missing commitSha"
      );
      ensure(agentHealth?.status === "ok", "Agent health status is not ok");
      ensure(
        Object.keys(agentHealth ?? {}).length === 1 && agentHealth?.status === "ok",
        "Public agent health should expose only liveness status"
      );
      ensure(agentRuntime?.environment, "Agent runtime metadata is missing environment");
      ensure(
        Object.prototype.hasOwnProperty.call(agentRuntime ?? {}, "commitSha"),
        "Agent runtime metadata is missing commitSha"
      );
      ensure(
        Object.prototype.hasOwnProperty.call(agentRuntime ?? {}, "schemaVersion"),
        "Agent runtime metadata is missing schemaVersion"
      );
      ensure(
        Object.prototype.hasOwnProperty.call(agentRuntime ?? {}, "managedConfigured"),
        "Agent runtime metadata is missing managedConfigured"
      );
      ensure(
        Object.prototype.hasOwnProperty.call(agentRuntime ?? {}, "sondeMcpConfigured"),
        "Agent runtime metadata is missing sondeMcpConfigured"
      );
      ensure(
        Object.prototype.hasOwnProperty.call(agentRuntime ?? {}, "githubConfigured"),
        "Agent runtime metadata is missing githubConfigured"
      );
      ensure(
        Object.prototype.hasOwnProperty.call(agentRuntime ?? {}, "cliGitRef"),
        "Agent runtime metadata is missing cliGitRef"
      );
      ensure(
        Object.prototype.hasOwnProperty.call(agentRuntime ?? {}, "supabaseProjectRef"),
        "Agent runtime metadata is missing supabaseProjectRef"
      );
      ensure(
        Object.prototype.hasOwnProperty.call(agentRuntime ?? {}, "sharedRateLimitConfigured"),
        "Agent runtime metadata is missing sharedRateLimitConfigured"
      );
      ensure(
        Object.prototype.hasOwnProperty.call(agentRuntime ?? {}, "sharedRateLimitRequired"),
        "Agent runtime metadata is missing sharedRateLimitRequired"
      );

      if (expectedEnvironment) {
        ensure(
          uiVersion.environment === expectedEnvironment,
          `UI environment mismatch: expected ${expectedEnvironment}, got ${uiVersion.environment}`
        );
        ensure(
          agentRuntime.environment === expectedEnvironment,
          `Agent environment mismatch: expected ${expectedEnvironment}, got ${agentRuntime.environment}`
        );
      }

      if (expectedCommitSha) {
        ensure(
          uiVersion.commitSha === expectedCommitSha,
          `UI commit mismatch: expected ${expectedCommitSha}, got ${uiVersion.commitSha}`
        );
        ensure(
          agentRuntime.commitSha === expectedCommitSha,
          `Agent commit mismatch: expected ${expectedCommitSha}, got ${agentRuntime.commitSha}`
        );
      } else if (uiVersion.commitSha && agentRuntime.commitSha) {
        ensure(
          uiVersion.commitSha === agentRuntime.commitSha,
          `UI and agent commit mismatch: ${uiVersion.commitSha} vs ${agentRuntime.commitSha}`
        );
      }

      if (expectedSchemaVersion) {
        if (expectedSchemaVersion === "unknown") {
          ensure(
            agentRuntime.schemaVersion,
            "Agent runtime metadata is missing a schemaVersion while audit is running in unknown fallback mode"
          );
        } else {
          ensure(
            agentRuntime.schemaVersion === expectedSchemaVersion,
            `Schema version mismatch: expected ${expectedSchemaVersion}, got ${agentRuntime.schemaVersion}`
          );
        }
      }

      if (expectedSupabaseProjectRef) {
        ensure(
          agentRuntime.supabaseProjectRef === expectedSupabaseProjectRef,
          `Supabase project mismatch: expected ${expectedSupabaseProjectRef}, got ${agentRuntime.supabaseProjectRef}`
        );
      }

      ensure(
        agentRuntime.agentBackend === "managed",
        `Agent backend must be managed, got ${agentRuntime.agentBackend}`,
      );

      if (requireAnthropic) {
        ensure(agentRuntime.anthropicConfigured, "Agent is missing Anthropic configuration");
      }

      if (requireSharedRateLimit) {
        ensure(
          agentRuntime.sharedRateLimitConfigured,
          "Agent is missing shared rate limiting configuration",
        );
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

      break;
    } catch (error) {
      lastError = error;
      if (Date.now() >= deadline || waitTimeoutMs <= 0) {
        throw error;
      }
      await sleep(waitIntervalMs);
      try {
        state = await collectRuntimeState({ uiBase, agentBase, runtimeAuditToken });
        ({ uiVersion, agentHealth, agentRuntime } = state);
      } catch (refreshError) {
        lastError = refreshError;
        if (Date.now() >= deadline) {
          throw refreshError;
        }
      }
    }
  }

  console.log(
    JSON.stringify(
      {
        ui: uiVersion,
        agent: {
          health: agentHealth,
          runtime: agentRuntime,
        },
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
