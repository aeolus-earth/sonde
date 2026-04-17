export type BuildMetadataEnv = Record<string, string | undefined>;

export type BuildMetadata = {
  environment: string;
  branch: string;
  appVersion: string;
  appVersionSource: AppVersionSource;
  commitSha: string;
};

export type RunCommand = (command: string) => string | null | undefined;
export type AppVersionSource = "explicit" | "exact-tag" | "describe" | "fallback";
export type BuildMetadataOptions = {
  strictTagWaitMs?: number;
  strictTagPollIntervalMs?: number;
  sleep?: (ms: number) => void;
};

const STABLE_TAG_RE = /^v(\d+)\.(\d+)\.(\d+)$/;
const DESCRIBE_TAG_RE = /^v\d+\.\d+\.\d+(?:[-+].*)?$/;
const GIT_SHA_RE = /^[0-9a-f]{7,40}$/i;
const REMOTE_TAGS_COMMAND = 'git ls-remote --tags origin "v*"';
const DEFAULT_STRICT_TAG_WAIT_MS = 180_000;
const DEFAULT_STRICT_TAG_POLL_INTERVAL_MS = 5_000;

function clean(value: string | null | undefined): string | null {
  const trimmed = value?.trim() ?? "";
  return trimmed.length > 0 ? trimmed : null;
}

function run(runCommand: RunCommand, command: string): string | null {
  try {
    return clean(runCommand(command));
  } catch {
    return null;
  }
}

function defaultSleep(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function stableTagName(ref: string): string | null {
  const name = ref.replace(/^refs\/tags\//, "").replace(/\^\{\}$/, "");
  return STABLE_TAG_RE.test(name) ? name : null;
}

function tagParts(tag: string): [number, number, number] {
  const match = tag.match(STABLE_TAG_RE);
  if (!match) return [0, 0, 0];
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

function compareStableTags(a: string, b: string): number {
  const aParts = tagParts(a);
  const bParts = tagParts(b);
  for (let index = 0; index < aParts.length; index += 1) {
    const diff = aParts[index] - bParts[index];
    if (diff !== 0) return diff;
  }
  return a.localeCompare(b);
}

function highestStableTag(tags: Iterable<string | null>): string | null {
  const stableTags = [...tags].filter((tag): tag is string => Boolean(tag));
  stableTags.sort(compareStableTags);
  return stableTags.length > 0 ? stableTags[stableTags.length - 1] : null;
}

export function exactStableTagFromTagList(output: string | null | undefined): string | null {
  if (!output) return null;
  return highestStableTag(
    output
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => (STABLE_TAG_RE.test(line) ? line : null)),
  );
}

export function exactStableTagFromLsRemote(
  output: string | null | undefined,
  commitSha: string,
): string | null {
  const targetSha = commitSha.toLowerCase();
  if (!output || !GIT_SHA_RE.test(targetSha)) return null;

  return highestStableTag(
    output.split(/\r?\n/).map((line) => {
      const [sha, ref] = line.trim().split(/\s+/, 2);
      if (!sha || !ref || sha.toLowerCase() !== targetSha) return null;
      return stableTagName(ref);
    }),
  );
}

export function describeGitTag(runCommand: RunCommand): string | null {
  const described = run(runCommand, "git describe --tags --always --dirty");
  return described && DESCRIBE_TAG_RE.test(described) ? described : null;
}

export function resolveEnvironment(env: BuildMetadataEnv): string {
  const inferredUrl =
    clean(env.VITE_PUBLIC_APP_ORIGIN) ||
    clean(env.VERCEL_PROJECT_PRODUCTION_URL) ||
    clean(env.VERCEL_URL) ||
    "";
  const inferredEnvironment = inferredUrl.includes("staging")
    ? "staging"
    : clean(env.VERCEL_ENV) === "production"
      ? "production"
      : null;

  return (
    clean(env.SONDE_ENVIRONMENT) ||
    inferredEnvironment ||
    "development"
  );
}

export function resolveCommitSha(env: BuildMetadataEnv, runCommand: RunCommand): string {
  return (
    clean(env.VITE_APP_COMMIT_SHA) ||
    clean(env.SONDE_COMMIT_SHA) ||
    clean(env.VERCEL_GIT_COMMIT_SHA) ||
    run(runCommand, "git rev-parse HEAD") ||
    "local"
  );
}

export function resolveBranch(
  env: BuildMetadataEnv,
  runCommand: RunCommand,
  environment = resolveEnvironment(env),
): string {
  const localBranch = run(runCommand, "git rev-parse --abbrev-ref HEAD");
  const vercelBranch = clean(env.VERCEL_GIT_COMMIT_REF);
  const explicitBranch = clean(env.VITE_APP_BRANCH);

  if (environment === "production") {
    return (
      vercelBranch ||
      explicitBranch ||
      (localBranch && localBranch !== "HEAD" ? localBranch : null) ||
      "local"
    );
  }

  return (
    explicitBranch ||
    vercelBranch ||
    (localBranch && localBranch !== "HEAD" ? localBranch : null) ||
    "local"
  );
}

function exactStableTagForCommit(commitSha: string, runCommand: RunCommand): string | null {
  const localTarget = GIT_SHA_RE.test(commitSha) ? commitSha : "HEAD";
  const localTag = exactStableTagFromTagList(
    run(runCommand, `git tag --points-at ${localTarget}`),
  );
  if (localTag) return localTag;

  if (!GIT_SHA_RE.test(commitSha)) return null;
  return exactStableTagFromLsRemote(run(runCommand, REMOTE_TAGS_COMMAND), commitSha);
}

function trustedProductionBranch(env: BuildMetadataEnv): string | null {
  return clean(env.VERCEL_GIT_COMMIT_REF);
}

function waitForExactStableTagForCommit(
  commitSha: string,
  runCommand: RunCommand,
  options: BuildMetadataOptions,
): string | null {
  const waitMs = options.strictTagWaitMs ?? DEFAULT_STRICT_TAG_WAIT_MS;
  const pollIntervalMs =
    options.strictTagPollIntervalMs ?? DEFAULT_STRICT_TAG_POLL_INTERVAL_MS;
  const sleep = options.sleep ?? defaultSleep;

  let elapsedMs = 0;
  while (true) {
    const tag = exactStableTagForCommit(commitSha, runCommand);
    if (tag) return tag;
    if (elapsedMs >= waitMs) return null;

    const nextSleepMs = Math.min(pollIntervalMs, waitMs - elapsedMs);
    if (nextSleepMs <= 0) return null;
    sleep(nextSleepMs);
    elapsedMs += nextSleepMs;
  }
}

function strictTagCommands(commitSha: string): string {
  const localTarget = GIT_SHA_RE.test(commitSha) ? commitSha : "HEAD";
  return [`git tag --points-at ${localTarget}`, REMOTE_TAGS_COMMAND].join("; ");
}

function productionTargetError(
  environment: string,
  branch: string,
  trustedBranch: string | null,
): Error {
  return new Error(
    [
      "Production UI builds require a trusted Vercel main branch before release metadata can be published.",
      `Resolved environment: ${environment}.`,
      `Trusted Vercel branch: ${trustedBranch ?? "<missing>"}.`,
      `Display branch: ${branch}.`,
      "Refusing to use explicit, describe, or dev version fallbacks for production.",
    ].join(" "),
  );
}

function productionReleaseError(
  commitSha: string,
  environment: string,
  branch: string,
  trustedBranch: string | null,
  waitMs: number,
): Error {
  return new Error(
    [
      "Production UI builds on main require an exact stable release tag.",
      `No vN.N.N tag was found whose peeled ref points to commit ${commitSha}.`,
      `Resolved environment: ${environment}.`,
      `Trusted Vercel branch: ${trustedBranch ?? "<missing>"}.`,
      `Display branch: ${branch}.`,
      `Waited ${waitMs}ms.`,
      `Commands attempted: ${strictTagCommands(commitSha)}.`,
      "Refusing to use explicit, describe, or dev version fallbacks for production.",
    ].join(" "),
  );
}

type ResolvedAppVersion = {
  appVersion: string;
  appVersionSource: AppVersionSource;
};

export function resolveAppVersion(
  env: BuildMetadataEnv,
  runCommand: RunCommand,
  commitSha: string,
  environment: string,
  branch: string,
  options: BuildMetadataOptions = {},
): ResolvedAppVersion {
  if (environment === "production") {
    const trustedBranch = trustedProductionBranch(env);
    if (trustedBranch !== "main") {
      throw productionTargetError(environment, branch, trustedBranch);
    }

    const waitMs = options.strictTagWaitMs ?? DEFAULT_STRICT_TAG_WAIT_MS;
    const exactTag = waitForExactStableTagForCommit(commitSha, runCommand, options);
    if (!exactTag) {
      throw productionReleaseError(commitSha, environment, branch, trustedBranch, waitMs);
    }
    return { appVersion: exactTag, appVersionSource: "exact-tag" };
  }

  const explicitVersion = clean(env.VITE_APP_VERSION);
  if (explicitVersion) {
    return { appVersion: explicitVersion, appVersionSource: "explicit" };
  }

  const exactTag = exactStableTagForCommit(commitSha, runCommand);
  if (exactTag) return { appVersion: exactTag, appVersionSource: "exact-tag" };

  const described = describeGitTag(runCommand);
  if (described) return { appVersion: described, appVersionSource: "describe" };

  return { appVersion: "dev", appVersionSource: "fallback" };
}

export function resolveBuildMetadata(
  env: BuildMetadataEnv,
  runCommand: RunCommand,
  options: BuildMetadataOptions = {},
): BuildMetadata {
  const commitSha = resolveCommitSha(env, runCommand);
  const environment = resolveEnvironment(env);
  const branch = resolveBranch(env, runCommand, environment);
  const { appVersion, appVersionSource } = resolveAppVersion(
    env,
    runCommand,
    commitSha,
    environment,
    branch,
    options,
  );

  return {
    environment,
    branch,
    appVersion,
    appVersionSource,
    commitSha,
  };
}
