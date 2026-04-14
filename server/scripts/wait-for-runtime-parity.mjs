function requiredEnv(name) {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`Missing required env: ${name}`);
  }
  return value;
}

function normalizeBaseUrl(value) {
  return value.replace(/\/+$/, "");
}

function parseNumber(value, fallback) {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function parseCsv(value, fallback) {
  const normalized = (value ?? fallback)
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
  return normalized.length > 0 ? normalized : fallback.split(",");
}

function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function fetchRuntimeMetadata(agentBase, runtimeAuditToken) {
  const response = await fetch(`${agentBase}/health/runtime`, {
    headers: {
      Authorization: `Bearer ${runtimeAuditToken}`,
    },
  });
  const bodyText = await response.text();

  if (!response.ok) {
    throw new Error(
      `Runtime metadata request failed (${response.status}): ${bodyText.slice(0, 160)}`,
    );
  }

  try {
    return bodyText ? JSON.parse(bodyText) : {};
  } catch {
    throw new Error(
      `Runtime metadata response was not valid JSON: ${bodyText.slice(0, 160)}`,
    );
  }
}

function missingKeys(metadata, requiredKeys) {
  return requiredKeys.filter(
    (key) => !Object.prototype.hasOwnProperty.call(metadata ?? {}, key),
  );
}

async function main() {
  const agentBase = normalizeBaseUrl(requiredEnv("PARITY_AGENT_BASE"));
  const runtimeAuditToken = requiredEnv("PARITY_RUNTIME_TOKEN");
  const expectedCommitSha = requiredEnv("PARITY_EXPECT_COMMIT_SHA");
  const expectedEnvironment = process.env.PARITY_EXPECT_ENVIRONMENT?.trim() || null;
  const expectedSchemaVersion = process.env.PARITY_EXPECT_SCHEMA_VERSION?.trim() || null;
  const requiredKeys = parseCsv(
    process.env.PARITY_REQUIRED_KEYS,
    "managedConfigError,anthropicConfigError,anthropicAdminConfigError",
  );
  const waitTimeoutMs = parseNumber(process.env.PARITY_WAIT_TIMEOUT_MS, 300000);
  const waitIntervalMs = parseNumber(process.env.PARITY_WAIT_INTERVAL_MS, 10000);
  const deadline = Date.now() + waitTimeoutMs;

  let lastSnapshot = null;
  let lastError = null;

  while (Date.now() <= deadline) {
    try {
      const metadata = await fetchRuntimeMetadata(agentBase, runtimeAuditToken);
      const missing = missingKeys(metadata, requiredKeys);
      const commitMatches = metadata?.commitSha === expectedCommitSha;
      const environmentMatches =
        !expectedEnvironment || metadata?.environment === expectedEnvironment;
      const schemaMatches =
        !expectedSchemaVersion || metadata?.schemaVersion === expectedSchemaVersion;

      lastSnapshot = {
        commitSha: metadata?.commitSha ?? null,
        environment: metadata?.environment ?? null,
        schemaVersion: metadata?.schemaVersion ?? null,
        missingKeys: missing,
      };

      if (commitMatches && environmentMatches && schemaMatches && missing.length === 0) {
        console.log(
          JSON.stringify(
            {
              status: "ok",
              agentBase,
              commitSha: metadata.commitSha,
              environment: metadata.environment,
              schemaVersion: metadata.schemaVersion,
            },
            null,
            2,
          ),
        );
        return;
      }
    } catch (error) {
      lastError = error;
    }

    await sleep(waitIntervalMs);
  }

  if (lastSnapshot) {
    throw new Error(
      `Timed out waiting for agent runtime parity. Expected commit=${expectedCommitSha}, environment=${expectedEnvironment ?? "<any>"}, schema=${expectedSchemaVersion ?? "<any>"}; got ${JSON.stringify(lastSnapshot)}`,
    );
  }

  throw lastError ?? new Error("Timed out waiting for agent runtime parity.");
}

main().catch((error) => {
  console.error(
    `[wait-for-runtime-parity] ${error instanceof Error ? error.message : String(error)}`,
  );
  process.exit(1);
});
