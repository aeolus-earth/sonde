export type BuildMetadataEnv = Record<string, string | undefined>;

export type BuildMetadata = {
  environment: string;
  branch: string;
  appVersion: string;
  commitSha: string;
};

export type RunCommand = (command: string) => string | null | undefined;

const STABLE_TAG_RE = /^v(\d+)\.(\d+)\.(\d+)$/;
const DESCRIBE_TAG_RE = /^v\d+\.\d+\.\d+(?:[-+].*)?$/;
const GIT_SHA_RE = /^[0-9a-f]{7,40}$/i;
const REMOTE_TAGS_COMMAND = 'git ls-remote --tags origin "v*"';

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
    clean(env.NODE_ENV) ||
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

export function resolveBranch(env: BuildMetadataEnv, runCommand: RunCommand): string {
  const localBranch = run(runCommand, "git rev-parse --abbrev-ref HEAD");

  return (
    clean(env.VITE_APP_BRANCH) ||
    clean(env.VERCEL_GIT_COMMIT_REF) ||
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

export function resolveAppVersion(
  env: BuildMetadataEnv,
  runCommand: RunCommand,
  commitSha: string,
): string {
  return (
    clean(env.VITE_APP_VERSION) ||
    exactStableTagForCommit(commitSha, runCommand) ||
    describeGitTag(runCommand) ||
    "dev"
  );
}

export function resolveBuildMetadata(
  env: BuildMetadataEnv,
  runCommand: RunCommand,
): BuildMetadata {
  const commitSha = resolveCommitSha(env, runCommand);

  return {
    environment: resolveEnvironment(env),
    branch: resolveBranch(env, runCommand),
    appVersion: resolveAppVersion(env, runCommand, commitSha),
    commitSha,
  };
}
