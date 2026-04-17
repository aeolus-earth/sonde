import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync, spawn } from "node:child_process";
import { pathToFileURL } from "node:url";

const OPAQUE_AGENT_TOKEN_PREFIX = "sonde_ak_";
const LEGACY_BOT_TOKEN_PREFIX = "sonde_bt_";

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
    throw new Error(`Request failed (${response.status}): ${message}`);
  }

  return body;
}

function parsePositiveInt(value, fallback) {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export function validateAgentAuditToken(token) {
  const value = token?.trim() ?? "";
  if (!value) {
    throw new Error("CLI_AUDIT_AUTH_MODE=token requires CLI_AUDIT_SONDE_TOKEN.");
  }
  if (value.startsWith(LEGACY_BOT_TOKEN_PREFIX)) {
    throw new Error(
      "CLI_AUDIT_SONDE_TOKEN uses legacy password-bundle agent token format (sonde_bt_); create a new opaque token with: sonde admin create-token.",
    );
  }
  if (!value.startsWith(OPAQUE_AGENT_TOKEN_PREFIX)) {
    throw new Error(
      "CLI_AUDIT_SONDE_TOKEN must be an opaque agent token that starts with sonde_ak_.",
    );
  }
}

export async function assertAgentExchangeRejectsInvalidTokens(agentBase) {
  const base = agentBase?.trim().replace(/\/+$/, "") ?? "";
  if (!base) {
    throw new Error("Agent exchange negative probes require CLI_AUDIT_AGENT_BASE.");
  }

  const cases = [
    {
      label: "legacy password-bundle",
      token: "sonde_bt_password-envelope-audit-probe",
    },
    {
      label: "malformed opaque",
      token: "sonde_ak_malformed-audit-probe",
    },
  ];

  for (const testCase of cases) {
    const response = await fetch(`${base}/auth/agent/exchange`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        token: testCase.token,
        cli_version: "hosted-audit",
        host_label: "hosted-audit-negative-probe",
      }),
    });

    if (response.ok) {
      throw new Error(
        `Agent exchange unexpectedly accepted ${testCase.label} token probe.`
      );
    }

    if (response.status < 400 || response.status >= 500) {
      const body = await response.text();
      throw new Error(
        `Agent exchange rejected ${testCase.label} token with unexpected HTTP ${response.status}: ${body}`
      );
    }
  }
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

function waitForChildExit(child) {
  return new Promise((resolve, reject) => {
    child.on("error", reject);
    child.on("close", (code, signal) => {
      resolve({ code, signal });
    });
  });
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

function extractActivationDetails(stderrBuffer) {
  const activationUrlMatch = stderrBuffer.match(/https?:\/\/\S+\/activate\?code=[A-Z0-9-]+/i);
  const userCodeMatch =
    stderrBuffer.match(/enter:\s*([A-Z0-9]{4}-[A-Z0-9]{4})/i) ||
    stderrBuffer.match(/\b([A-Z0-9]{4}-[A-Z0-9]{4})\b/);

  return {
    activationUrl: activationUrlMatch?.[0] ?? "",
    userCode: userCodeMatch?.[1] ?? "",
  };
}

async function completeHostedCliLogin({
  command,
  env,
  agentBase,
  approvalSession,
}) {
  const child = spawn(command, ["login", "--json"], {
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });

  let stdout = "";
  let stderr = "";
  child.stdout.setEncoding("utf-8");
  child.stderr.setEncoding("utf-8");
  child.stdout.on("data", (chunk) => {
    stdout += chunk;
  });
  child.stderr.on("data", (chunk) => {
    stderr += chunk;
  });

  const userCode = await new Promise((resolve, reject) => {
    const deadline = Date.now() + 60_000;

    const poll = () => {
      const details = extractActivationDetails(stderr);
      if (details.userCode) {
        resolve(details.userCode);
        return;
      }
      if (Date.now() >= deadline) {
        reject(
          new Error(
            `Timed out waiting for sonde login activation code.\nCLI stderr:\n${stderr.trim()}`
          )
        );
        return;
      }
      setTimeout(poll, 100);
    };

    poll();
  });

  await requestJson(`${agentBase}/auth/device/approve`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      Authorization: `Bearer ${approvalSession.access_token}`,
    },
    body: JSON.stringify({
      user_code: userCode,
      decision: "approve",
      session: approvalSession,
    }),
  });

  const { code, signal } = await waitForChildExit(child);
  if (code !== 0) {
    const signalSuffix = signal ? ` (signal ${signal})` : "";
    throw new Error(
      `sonde login --json failed with exit code ${code}${signalSuffix}\nstdout:\n${stdout.trim()}\nstderr:\n${stderr.trim()}`
    );
  }

  const loginOutput = parseJsonOutput(stdout, "login");
  if (!loginOutput?.email) {
    throw new Error(`Hosted CLI login did not emit a usable JSON payload: ${stdout.trim()}`);
  }
  return loginOutput;
}

function persistSession(configDir, session) {
  fs.writeFileSync(path.join(configDir, "session.json"), JSON.stringify(session), {
    mode: 0o600,
  });
}

async function main() {
  const supabaseUrl = requiredEnv("SUPABASE_URL");
  const supabaseAnonKey = requiredEnv("SUPABASE_ANON_KEY");
  const sondeToken = process.env.CLI_AUDIT_SONDE_TOKEN?.trim() || "";
  const email = process.env.SMOKE_USER_EMAIL?.trim() || "";
  const password = process.env.SMOKE_USER_PASSWORD?.trim() || "";
  const requestedAuthMode = (process.env.CLI_AUDIT_AUTH_MODE?.trim() || "auto").toLowerCase();
  const agentBase = process.env.CLI_AUDIT_AGENT_BASE?.trim() || "";
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
  const authMode =
    requestedAuthMode === "auto" ? (sondeToken ? "token" : "session") : requestedAuthMode;

  if (!["token", "session"].includes(authMode)) {
    throw new Error("CLI_AUDIT_AUTH_MODE must be one of: auto, token, session.");
  }

  if (agentBase) {
    await assertAgentExchangeRejectsInvalidTokens(agentBase);
  }

  if (authMode === "token") {
    validateAgentAuditToken(sondeToken);
    cliEnv.SONDE_TOKEN = sondeToken;
    if (agentBase) {
      cliEnv.SONDE_AGENT_HTTP_BASE = agentBase;
    }
  } else {
    delete cliEnv.SONDE_TOKEN;
    if (!email || !password) {
      throw new Error(
        "CLI_AUDIT_AUTH_MODE=session requires SMOKE_USER_EMAIL and SMOKE_USER_PASSWORD."
      );
    }
    if (!agentBase) {
      throw new Error("CLI_AUDIT_AGENT_BASE is required for hosted CLI login audits.");
    }
    cliEnv.SONDE_AGENT_HTTP_BASE = agentBase;
    const session = await mintSession(supabaseUrl, supabaseAnonKey, email, password);
    await completeHostedCliLogin({
      command: sondeExecutable,
      env: cliEnv,
      agentBase,
      approvalSession: session,
    });
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

  if (authMode === "token" && !whoami.is_agent) {
    throw new Error("CLI audit expected agent-token auth, but whoami reported a human session");
  }

  if (authMode === "session" && email && whoami.email !== email) {
    throw new Error(`CLI authenticated as ${whoami.email}, expected ${email}`);
  }

  if (!programs.some((program) => program.id === auditProgram)) {
    throw new Error(`CLI could not see expected program: ${auditProgram}`);
  }

  const summary = {
    environment: auditEnvironment,
    email: whoami.email,
    isAgent: whoami.is_agent === true,
    programCount: programs.length,
    allowWrite,
    briefKeys: Object.keys(brief),
    authMode,
    agentExchangeNegativeProbes: Boolean(agentBase),
  };

  if (expectedExperimentId) {
    summary.expectedExperimentId = expectedExperimentId;
  }

  if (allowWrite) {
    const stamp = new Date().toISOString();
    const directionTitle = `CLI hosted audit ${stamp.slice(11, 19)}`;
    const questionText = `CLI hosted audit ${stamp}`;
    const createdDirection = parseJsonOutput(
      runCli(
        sondeExecutable,
        [
          "direction",
          "create",
          "--program",
          auditProgram,
          "--title",
          directionTitle,
          questionText,
          "--json",
        ],
        cliEnv
      ),
      "direction create"
    );
    const created = parseJsonOutput(
      runCli(
        sondeExecutable,
        [
          "question",
          "create",
          "--direction",
          createdDirection.id,
          questionText,
          "--json",
        ],
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
    summary.createdDirectionId = createdDirection.id;
  } else {
    const recent = parseJsonOutput(
      runCli(sondeExecutable, ["recent", "--json"], cliEnv),
      "recent"
    );
    summary.recentCount = Array.isArray(recent) ? recent.length : 0;
  }

  console.log(JSON.stringify(summary));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error("[run-cli-hosted-audit] Failed:", error.message);
    process.exit(1);
  });
}
