import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";

const STABLE_VERSION_RE = /^v\d+\.\d+\.\d+$/;

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

function ensure(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
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
        `Expected JSON from ${url}, but received HTML instead. This usually means an SPA rewrite or stale deploy is intercepting the endpoint.`,
      );
    }
  }

  try {
    return bodyText ? JSON.parse(bodyText) : null;
  } catch {
    throw new Error(
      `Expected JSON from ${url}, but response could not be parsed. Response preview: ${bodyText.slice(0, 160)}`,
    );
  }
}

export function remoteTagCommitFromLsRemote(output, tag) {
  const directRef = `refs/tags/${tag}`;
  const peeledRef = `${directRef}^{}`;
  let directSha = null;
  let peeledSha = null;

  for (const line of output.split(/\r?\n/)) {
    const [sha, ref] = line.trim().split(/\s+/, 2);
    if (!sha || !ref) continue;
    if (ref === peeledRef) peeledSha = sha;
    if (ref === directRef) directSha = sha;
  }

  return peeledSha ?? directSha;
}

function remoteTagCommit(tag) {
  if (!STABLE_VERSION_RE.test(tag)) return null;

  try {
    const output = execFileSync(
      "git",
      [
        "ls-remote",
        "--tags",
        "origin",
        `refs/tags/${tag}`,
        `refs/tags/${tag}^{}`,
      ],
      {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
        timeout: 15_000,
      },
    );
    return remoteTagCommitFromLsRemote(output, tag);
  } catch {
    return null;
  }
}

export function validateUiReleaseMetadata(
  uiVersion,
  {
    expectedEnvironment = "production",
    expectedBranch = "main",
    expectedCommitSha,
    tagCommitResolver = remoteTagCommit,
  },
) {
  ensure(uiVersion?.environment, "UI version metadata is missing environment");
  ensure(
    Object.prototype.hasOwnProperty.call(uiVersion ?? {}, "commitSha"),
    "UI version metadata is missing commitSha",
  );
  ensure(
    Object.prototype.hasOwnProperty.call(uiVersion ?? {}, "branch"),
    "UI version metadata is missing branch",
  );
  ensure(
    Object.prototype.hasOwnProperty.call(uiVersion ?? {}, "appVersion"),
    "UI version metadata is missing appVersion",
  );
  ensure(
    Object.prototype.hasOwnProperty.call(uiVersion ?? {}, "appVersionSource"),
    "UI version metadata is missing appVersionSource",
  );

  ensure(
    uiVersion.environment === expectedEnvironment,
    `UI environment mismatch: expected ${expectedEnvironment}, got ${uiVersion.environment}`,
  );
  ensure(
    uiVersion.branch === expectedBranch,
    `UI branch mismatch: expected ${expectedBranch}, got ${uiVersion.branch}`,
  );

  if (expectedCommitSha) {
    ensure(
      uiVersion.commitSha === expectedCommitSha,
      `UI commit mismatch: expected ${expectedCommitSha}, got ${uiVersion.commitSha}`,
    );
  }

  if (expectedEnvironment === "production") {
    ensure(
      STABLE_VERSION_RE.test(uiVersion.appVersion ?? ""),
      `Production UI appVersion must be a stable release tag, got ${uiVersion.appVersion}`,
    );
    ensure(
      uiVersion.appVersionSource === "exact-tag",
      `Production UI appVersionSource must be exact-tag, got ${uiVersion.appVersionSource}`,
    );

    const tagCommit = tagCommitResolver(uiVersion.appVersion);
    ensure(
      tagCommit,
      `Production UI appVersion ${uiVersion.appVersion} was not found on origin`,
    );
    ensure(
      tagCommit === uiVersion.commitSha,
      `Production UI appVersion ${uiVersion.appVersion} points to ${tagCommit}, but UI commit is ${uiVersion.commitSha}`,
    );
  }
}

async function main() {
  const uiBase = normalizeBaseUrl(requiredEnv("UI_RELEASE_AUDIT_BASE"));
  const expectedEnvironment =
    process.env.UI_RELEASE_AUDIT_EXPECT_ENVIRONMENT?.trim() || "production";
  const expectedBranch = process.env.UI_RELEASE_AUDIT_EXPECT_BRANCH?.trim() || "main";
  const expectedCommitSha = requiredEnv("UI_RELEASE_AUDIT_EXPECT_COMMIT_SHA");
  const waitTimeoutMs = parseNumber(process.env.UI_RELEASE_AUDIT_WAIT_TIMEOUT_MS, 600_000);
  const waitIntervalMs = parseNumber(process.env.UI_RELEASE_AUDIT_WAIT_INTERVAL_MS, 10_000);
  const deadline = Date.now() + waitTimeoutMs;
  let uiVersion = null;
  let lastError = null;

  while (true) {
    try {
      uiVersion = await fetchJson(`${uiBase}/version.json`);
      validateUiReleaseMetadata(uiVersion, {
        expectedEnvironment,
        expectedBranch,
        expectedCommitSha,
      });
      break;
    } catch (error) {
      lastError = error;
      if (Date.now() >= deadline || waitTimeoutMs <= 0) {
        throw error;
      }
      await sleep(waitIntervalMs);
    }
  }

  console.log(
    JSON.stringify(
      {
        audit: {
          expectedEnvironment,
          expectedBranch,
          expectedCommitSha,
        },
        ui: uiVersion,
      },
      null,
      2,
    ),
  );

  if (lastError) {
    console.error(`[audit-ui-release-metadata] Passed after retry: ${lastError.message}`);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error("[audit-ui-release-metadata] Failed:", error.message);
    process.exit(1);
  });
}
