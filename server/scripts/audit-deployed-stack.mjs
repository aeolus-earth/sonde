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

function parseCsv(value) {
  return (value ?? "")
    .split(",")
    .map((part) => part.trim().toLowerCase())
    .filter(Boolean);
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

function matchesDisallowedHostSuffix(hostname, disallowedSuffixes) {
  const normalizedHostname = hostname.toLowerCase();
  return disallowedSuffixes.some((suffix) => normalizedHostname.endsWith(suffix));
}

function htmlContainsDisallowedSuffix(html, disallowedSuffixes) {
  const normalizedHtml = html.toLowerCase();
  return disallowedSuffixes.some((suffix) => normalizedHtml.includes(suffix));
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
  const requireAgentCommitMatch = parseBooleanFlag(
    (process.env.AUDIT_REQUIRE_AGENT_COMMIT_MATCH ?? "1").trim().toLowerCase()
  );
  const requireFirstPartyAgent = parseBooleanFlag(
    (process.env.AUDIT_REQUIRE_FIRST_PARTY_AGENT || "1").trim().toLowerCase()
  );
  const disallowedHostSuffixes = parseCsv(process.env.AUDIT_DISALLOWED_HOST_SUFFIXES);
  const requireSharedRateLimit = parseBooleanFlag(
    (process.env.AUDIT_REQUIRE_SHARED_RATE_LIMIT ?? "").trim().toLowerCase()
  );
  const waitTimeoutMs = parseNumber(process.env.AUDIT_WAIT_TIMEOUT_MS, 0);
  const waitIntervalMs = parseNumber(process.env.AUDIT_WAIT_INTERVAL_MS, 5000);

  let state;
  let lastError = null;
  const deadline = Date.now() + waitTimeoutMs;
  const warnings = [];

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
  const agentHostname = new URL(agentBase).hostname;
  const agentHostMatchesDisallowedSuffix = matchesDisallowedHostSuffix(
    agentHostname,
    disallowedHostSuffixes,
  );

  while (true) {
    try {
      ensure(uiVersion?.environment, "UI version metadata is missing environment");
      ensure(
        Object.prototype.hasOwnProperty.call(uiVersion ?? {}, "commitSha"),
        "UI version metadata is missing commitSha"
      );
      ensure(
        Object.prototype.hasOwnProperty.call(uiVersion ?? {}, "agentWsConfigured"),
        "UI version metadata is missing agentWsConfigured"
      );
      ensure(
        Object.prototype.hasOwnProperty.call(uiVersion ?? {}, "agentWsOrigin"),
        "UI version metadata is missing agentWsOrigin"
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
        Object.prototype.hasOwnProperty.call(agentRuntime ?? {}, "managedConfigError"),
        "Agent runtime metadata is missing managedConfigError"
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
        Object.prototype.hasOwnProperty.call(agentRuntime ?? {}, "anthropicConfigured"),
        "Agent runtime metadata is missing anthropicConfigured"
      );
      ensure(
        Object.prototype.hasOwnProperty.call(agentRuntime ?? {}, "anthropicConfigError"),
        "Agent runtime metadata is missing anthropicConfigError"
      );
      ensure(
        Object.prototype.hasOwnProperty.call(agentRuntime ?? {}, "anthropicAdminConfigured"),
        "Agent runtime metadata is missing anthropicAdminConfigured"
      );
      ensure(
        Object.prototype.hasOwnProperty.call(agentRuntime ?? {}, "anthropicAdminConfigError"),
        "Agent runtime metadata is missing anthropicAdminConfigError"
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
        if (requireAgentCommitMatch) {
          ensure(
            agentRuntime.commitSha === expectedCommitSha,
            `Agent commit mismatch: expected ${expectedCommitSha}, got ${agentRuntime.commitSha}`
          );
        } else if (agentRuntime.commitSha !== expectedCommitSha) {
          warnings.push(
            `Agent commit mismatch (non-blocking): expected ${expectedCommitSha}, got ${agentRuntime.commitSha}`
          );
        }
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

      const expectedAgentOrigin = new URL(agentBase).origin;
      ensure(
        uiVersion.agentWsConfigured === true,
        `UI build is missing VITE_AGENT_WS_URL for ${expectedEnvironment ?? "this environment"}.`
      );
      ensure(
        uiVersion.agentWsOrigin === expectedAgentOrigin,
        `UI agent origin mismatch: expected ${expectedAgentOrigin}, got ${uiVersion.agentWsOrigin}`
      );

      ensure(
        agentRuntime.agentBackend === "managed",
        `Agent backend must be managed, got ${agentRuntime.agentBackend}`,
      );

      if (requireAnthropic) {
        ensure(agentRuntime.anthropicConfigured, "Agent is missing Anthropic configuration");
        ensure(
          !agentRuntime.anthropicConfigError,
          `Agent Anthropic config is invalid: ${agentRuntime.anthropicConfigError}`,
        );
        ensure(
          agentRuntime.managedConfigured,
          "Agent managed runtime configuration is invalid",
        );
        ensure(
          !agentRuntime.managedConfigError,
          `Agent managed runtime config is invalid: ${agentRuntime.managedConfigError}`,
        );
      }

      if (requireSharedRateLimit) {
        ensure(
          agentRuntime.sharedRateLimitConfigured,
          "Agent is missing shared rate limiting configuration",
        );
      }

      if (requireFirstPartyAgent) {
        ensure(
          disallowedHostSuffixes.length > 0,
          "AUDIT_REQUIRE_FIRST_PARTY_AGENT requires AUDIT_DISALLOWED_HOST_SUFFIXES to be configured",
        );
        ensure(
          !agentHostMatchesDisallowedSuffix,
          `Agent host matches a disallowed suffix: ${agentHostname}`
        );

        const loginHtml = await fetchText(`${uiBase}/login`);
        ensure(
          !htmlContainsDisallowedSuffix(loginHtml, disallowedHostSuffixes),
          "UI HTML still exposes a disallowed hosted-domain suffix"
        );
      } else if (agentHostMatchesDisallowedSuffix) {
        warnings.push(`Agent host matches a disallowed suffix (non-blocking): ${agentHostname}`);
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
        audit: {
          requireAgentCommitMatch,
          requireFirstPartyAgent,
          expectedCommitSha,
          agentCommitMatchesExpectation: expectedCommitSha
            ? agentRuntime.commitSha === expectedCommitSha
            : null,
          disallowedHostSuffixes,
          agentHostname,
          agentHostMatchesDisallowedSuffix: disallowedHostSuffixes.length
            ? agentHostMatchesDisallowedSuffix
            : null,
          warnings,
        },
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
