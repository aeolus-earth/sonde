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

function parseCsvList(value) {
  return (value ?? "")
    .split(",")
    .map((part) => part.trim())
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

async function fetchHtmlDocument(url) {
  const response = await fetch(url);
  const body = await response.text();
  const contentType = (response.headers.get("content-type") ?? "").toLowerCase();
  if (!response.ok) {
    throw new Error(`Request failed (${response.status}) for ${url}`);
  }
  if (!contentType.includes("text/html")) {
    throw new Error(`Expected HTML from ${url}, but received ${contentType || "unknown content-type"}.`);
  }

  const normalized = body.trim().toLowerCase();
  if (!(normalized.startsWith("<!doctype html") || normalized.startsWith("<html"))) {
    throw new Error(`Expected an HTML document from ${url}, but received a non-document response.`);
  }
  if (
    normalized.includes("404: not_found") ||
    normalized.includes("the page could not be found") ||
    normalized.includes("this page could not be found")
  ) {
    throw new Error(`Hosted route ${url} rendered a 404 page instead of the Sonde app.`);
  }
  if (normalized.includes("\"error\":{") || normalized.includes("\"error\": {")) {
    throw new Error(`Hosted route ${url} rendered an application error payload instead of the Sonde app.`);
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
  const [uiVersion, agentHealth, agentRuntime, directDeviceHealth, proxiedDeviceHealth] =
    await Promise.all([
      fetchJson(`${uiBase}/version.json`),
      fetchJson(`${agentBase}/health`),
      fetchJson(`${agentBase}/health/runtime`, {
        headers: runtimeAuditToken
          ? {
              Authorization: `Bearer ${runtimeAuditToken}`,
            }
          : {},
      }),
      fetchJson(`${agentBase}/auth/device/health`),
      fetchJson(`${uiBase}/auth/device/health`),
    ]);

  return {
    uiVersion,
    agentHealth,
    agentRuntime,
    directDeviceHealth,
    proxiedDeviceHealth,
  };
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
  const requiredRuntimeKeys = parseCsvList(
    process.env.AUDIT_REQUIRED_RUNTIME_KEYS ??
      "managedConfigured,managedConfigError,sondeMcpConfigured,githubConfigured,anthropicConfigured,anthropicConfigError,anthropicAdminConfigured,anthropicAdminConfigError,cliGitRef,supabaseProjectRef,sharedRateLimitConfigured,sharedRateLimitRequired,deviceAuthEnabled,deviceAuthConfigError",
  );
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

  let { uiVersion, agentHealth, agentRuntime, directDeviceHealth, proxiedDeviceHealth } = state;
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
      for (const key of requiredRuntimeKeys) {
        ensure(
          Object.prototype.hasOwnProperty.call(agentRuntime ?? {}, key),
          `Agent runtime metadata is missing ${key}`
        );
      }

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

      ensure(agentRuntime.deviceAuthEnabled, "Agent hosted device login is not configured");
      ensure(
        !agentRuntime.deviceAuthConfigError,
        `Agent device login config is invalid: ${agentRuntime.deviceAuthConfigError}`,
      );
      ensure(
        directDeviceHealth?.status === "ok",
        "Agent device-auth health did not return status=ok",
      );
      ensure(
        proxiedDeviceHealth?.status === "ok",
        "UI-proxied device-auth health did not return status=ok",
      );
      ensure(
        directDeviceHealth?.enabled === true,
        `Agent device-auth health reports disabled: ${agentRuntime.deviceAuthConfigError ?? "unknown"}`,
      );
      ensure(
        proxiedDeviceHealth?.enabled === true,
        `UI-proxied device-auth health reports disabled: ${agentRuntime.deviceAuthConfigError ?? "unknown"}`,
      );
      ensure(
        Object.keys(directDeviceHealth ?? {}).length === 2,
        "Public agent device-auth health should expose only status and enabled",
      );
      ensure(
        Object.keys(proxiedDeviceHealth ?? {}).length === 2,
        "Public proxied device-auth health should expose only status and enabled",
      );
      const deviceStart = await fetchJson(`${agentBase}/auth/device/start`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          cli_version: "audit",
          host_label: "runtime-audit",
          remote_hint: true,
          login_method: "device",
        }),
      });
      ensure(
        typeof deviceStart?.device_code === "string" && deviceStart.device_code.length > 0,
        "Device auth start is missing device_code",
      );
      ensure(
        typeof deviceStart?.user_code === "string" && deviceStart.user_code.length > 0,
        "Device auth start is missing user_code",
      );
      ensure(
        deviceStart?.verification_uri === `${uiBase}/activate`,
        `Device auth verification URI mismatch: expected ${uiBase}/activate, got ${deviceStart?.verification_uri}`,
      );
      ensure(
        typeof deviceStart?.verification_uri_complete === "string" &&
          deviceStart.verification_uri_complete.startsWith(`${uiBase}/activate?code=`),
        "Device auth verification_uri_complete is missing the hosted activation link",
      );
      ensure(
        Number.isFinite(deviceStart?.expires_in) && deviceStart.expires_in > 0,
        "Device auth start returned an invalid expires_in",
      );
      ensure(
        Number.isFinite(deviceStart?.interval) && deviceStart.interval > 0,
        "Device auth start returned an invalid interval",
      );
      await fetchHtmlDocument(deviceStart.verification_uri);
      await fetchHtmlDocument(
        `${uiBase}/activate/callback?user_code=${encodeURIComponent(deviceStart.user_code)}`,
      );

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

        const loginHtml = await fetchHtmlDocument(`${uiBase}/login`);
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
      ({ uiVersion, agentHealth, agentRuntime, directDeviceHealth, proxiedDeviceHealth } = state);
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
