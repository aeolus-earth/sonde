import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";

function requiredEnv(name) {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`Missing required env: ${name}`);
  }
  return value;
}

async function requestJson(url, init) {
  const response = await fetch(url, init);
  const bodyText = await response.text();
  const body = bodyText ? JSON.parse(bodyText) : null;

  if (!response.ok) {
    const message =
      body?.msg ||
      body?.error_description ||
      body?.error ||
      response.statusText;
    throw new Error(`Supabase request failed (${response.status}): ${message}`);
  }

  return body;
}

function parsePositiveInt(value, fallback) {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function decodeExecOutput(value) {
  if (typeof value === "string") {
    return value;
  }
  if (Buffer.isBuffer(value)) {
    return value.toString("utf-8");
  }
  return "";
}

function buildCliFailureMessage(command, args, error) {
  const stderr = decodeExecOutput(error?.stderr).trim();
  const stdout = decodeExecOutput(error?.stdout).trim();
  const details = [stderr, stdout].filter(Boolean).join("\n");
  const fallback = error instanceof Error ? error.message : String(error);
  const suffix = details || fallback;
  return `${command} ${args.join(" ")} failed: ${suffix}`;
}

function isRetryableCliReadinessError(message) {
  return (
    /Remote schema version .*< required/.test(message) ||
    /needs a migration update/i.test(message)
  );
}

function runCli(command, args, env) {
  try {
    return execFileSync(command, args, {
      encoding: "utf-8",
      env,
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
  } catch (error) {
    throw new Error(buildCliFailureMessage(command, args, error));
  }
}

function parseJsonOutput(raw, label) {
  try {
    return JSON.parse(raw);
  } catch (error) {
    throw new Error(`Failed to parse ${label} JSON output: ${error.message}`);
  }
}

async function waitForCliReadiness({
  command,
  args,
  env,
  timeoutMs,
  intervalMs,
}) {
  if (timeoutMs <= 0) {
    return;
  }

  const deadline = Date.now() + timeoutMs;

  while (true) {
    try {
      runCli(command, args, env);
      return;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (!isRetryableCliReadinessError(message) || Date.now() >= deadline) {
        throw error;
      }
      console.log(`[run-cli-hosted-audit] Waiting for hosted CLI readiness: ${message}`);
      await sleep(intervalMs);
    }
  }
}

async function mintSession(supabaseUrl, supabaseAnonKey, email, password) {
  return requestJson(`${supabaseUrl}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: {
      apikey: supabaseAnonKey,
      Authorization: `Bearer ${supabaseAnonKey}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ email, password }),
  });
}

async function main() {
  const supabaseUrl = requiredEnv("SUPABASE_URL");
  const supabaseAnonKey = requiredEnv("SUPABASE_ANON_KEY");
  const sondeToken = process.env.CLI_AUDIT_SONDE_TOKEN?.trim() || "";
  const email = process.env.SMOKE_USER_EMAIL?.trim() || "";
  const password = process.env.SMOKE_USER_PASSWORD?.trim() || "";
  const auditEnvironment = process.env.CLI_AUDIT_ENV?.trim() || "staging";
  const auditProgram = process.env.CLI_AUDIT_PROGRAM?.trim() || "shared";
  const expectedExperimentId = process.env.CLI_AUDIT_EXPECT_EXPERIMENT_ID?.trim() || "";
  const allowWrite = (process.env.CLI_AUDIT_ALLOW_WRITE ?? "") === "1";
  const sondeExecutable = process.env.CLI_AUDIT_SONDE_BIN?.trim() || "sonde";
  const waitTimeoutMs = parsePositiveInt(process.env.CLI_AUDIT_WAIT_TIMEOUT_MS, 0);
  const waitIntervalMs = parsePositiveInt(process.env.CLI_AUDIT_WAIT_INTERVAL_MS, 10_000);

  const configDir = fs.mkdtempSync(path.join(os.tmpdir(), "sonde-cli-audit-"));
  fs.chmodSync(configDir, 0o700);

  const cliEnv = {
    ...process.env,
    SONDE_CONFIG_DIR: configDir,
    AEOLUS_SUPABASE_URL: supabaseUrl,
    AEOLUS_SUPABASE_ANON_KEY: supabaseAnonKey,
  };

  if (sondeToken) {
    cliEnv.SONDE_TOKEN = sondeToken;
  } else {
    if (!email || !password) {
      throw new Error(
        "Set CLI_AUDIT_SONDE_TOKEN or provide SMOKE_USER_EMAIL and SMOKE_USER_PASSWORD."
      );
    }

    const session = await mintSession(supabaseUrl, supabaseAnonKey, email, password);
    fs.writeFileSync(
      path.join(configDir, "session.json"),
      JSON.stringify(session),
      { mode: 0o600 }
    );
  }

  await waitForCliReadiness({
    command: sondeExecutable,
    args: ["program", "list", "--json"],
    env: cliEnv,
    timeoutMs: waitTimeoutMs,
    intervalMs: waitIntervalMs,
  });

  const whoami = parseJsonOutput(
    runCli(sondeExecutable, ["whoami", "--json"], cliEnv),
    "whoami"
  );
  const programs = parseJsonOutput(
    runCli(sondeExecutable, ["program", "list", "--json"], cliEnv),
    "program list"
  );
  const brief = parseJsonOutput(
    runCli(sondeExecutable, ["brief", "--json"], cliEnv),
    "brief"
  );

  let expectedExperiment = null;
  if (expectedExperimentId) {
    expectedExperiment = parseJsonOutput(
      runCli(sondeExecutable, ["experiment", "show", expectedExperimentId, "--json"], cliEnv),
      "experiment show"
    );

    if (expectedExperiment.program !== auditProgram) {
      throw new Error(
        `Expected experiment ${expectedExperimentId} to belong to ${auditProgram}, got ${expectedExperiment.program}`
      );
    }
  }

  if (sondeToken && !whoami.is_agent) {
    throw new Error("CLI audit expected agent-token auth, but whoami reported a human session");
  }

  if (!sondeToken && email && whoami.email !== email) {
    throw new Error(`CLI authenticated as ${whoami.email}, expected ${email}`);
  }

  if (!programs.some((program) => program.id === auditProgram)) {
    throw new Error(`CLI could not see expected program: ${auditProgram}`);
  }

  const summary = {
    environment: auditEnvironment,
    email: whoami.email,
    programCount: programs.length,
    allowWrite,
    briefKeys: Object.keys(brief),
    authMode: sondeToken ? "token" : "session",
  };

  if (expectedExperimentId) {
    summary.expectedExperimentId = expectedExperimentId;
  }

  if (allowWrite) {
    const questionText = `CLI hosted audit ${new Date().toISOString()}`;
    const created = parseJsonOutput(
      runCli(
        sondeExecutable,
        ["question", "create", "-p", auditProgram, questionText, "--json"],
        cliEnv
      ),
      "question create"
    );
    const shown = parseJsonOutput(
      runCli(
        sondeExecutable,
        ["question", "show", created.id, "--json"],
        cliEnv
      ),
      "question show"
    );

    if (shown.program !== auditProgram || !shown.question.includes("CLI hosted audit")) {
      throw new Error("Staging write/read verification did not round-trip correctly");
    }

    summary.createdQuestionId = created.id;
  } else {
    const recent = parseJsonOutput(
      runCli(sondeExecutable, ["recent", "--json"], cliEnv),
      "recent"
    );
    summary.recentCount = Array.isArray(recent) ? recent.length : 0;
  }

  console.log(JSON.stringify(summary));
}

main().catch((error) => {
  console.error("[run-cli-hosted-audit] Failed:", error.message);
  process.exit(1);
});
