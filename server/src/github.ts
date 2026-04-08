import type { Context, Hono } from "hono";
import { verifyToken, type VerifiedUser } from "./auth.js";
import {
  checkUserRateLimit,
  tryStartUserOperation,
} from "./request-guard.js";
import { getGitHubAllowedRepos } from "./security-config.js";

const GITHUB_API_BASE = "https://api.github.com";
const GITHUB_DEFAULT_PER_PAGE = 100;
const GITHUB_MAX_PER_PAGE = 100;
const REPO_CACHE_TTL_MS = 60 * 60_000;
const COMMIT_CACHE_TTL_MS = 5 * 60_000;

export type GitHubAuthMode = "server_token" | "unauthenticated";
export type GitHubCacheStatus = "hit" | "miss";

interface GitHubRateLimit {
  limit: number;
  remaining: number;
  reset: number;
  used: number;
}

interface GitHubCommit {
  sha: string;
  commit: {
    message: string;
    author: { name: string; date: string };
  };
  html_url: string;
  author: { login: string; avatar_url: string } | null;
}

interface GitHubRepoResponse {
  default_branch: string;
  html_url: string;
  private: boolean;
}

interface TimelineCommit {
  sha: string;
  shortSha: string;
  message: string;
  firstLine: string;
  authorName: string;
  authorDate: string;
  htmlUrl: string;
  authorLogin: string | null;
  authorAvatar: string | null;
}

interface GitHubRepoSummary {
  defaultBranch: string;
  htmlUrl: string;
  private: boolean;
}

interface GitHubCommitPageData {
  commits: TimelineCommit[];
  nextPage: number | null;
  rateLimit: GitHubRateLimit;
  fetchedAt: string;
}

interface GitHubTimelineResponse {
  commits: TimelineCommit[];
  nextPage: number | null;
  rateLimit: GitHubRateLimit;
  repo: GitHubRepoSummary;
  diagnostics: {
    authMode: GitHubAuthMode;
    repoCache: GitHubCacheStatus;
    commitCache: GitHubCacheStatus;
    upstreamRequests: number;
    requestedBranch: string | null;
    resolvedBranch: string;
    fetchedAt: string;
    warnings: string[];
  };
}

interface CacheEntry<T> {
  expiresAt: number;
  value: T;
}

class GitHubRateLimitError extends Error {
  constructor(public readonly reset: number) {
    super(
      `GitHub API rate limit exceeded. Resets at ${new Date(reset * 1000).toLocaleTimeString()}`
    );
    this.name = "GitHubRateLimitError";
  }
}

class GitHubRepoNotFoundError extends Error {
  constructor(owner: string, repo: string) {
    super(`Repository ${owner}/${repo} not found or is not accessible`);
    this.name = "GitHubRepoNotFoundError";
  }
}

class GitHubBranchNotFoundError extends Error {
  constructor(
    public readonly owner: string,
    public readonly repo: string,
    public readonly branch: string,
    public readonly defaultBranch: string
  ) {
    super(`Branch ${branch} not found in ${owner}/${repo}`);
    this.name = "GitHubBranchNotFoundError";
  }
}

class GitHubTokenInvalidError extends Error {
  constructor() {
    super("Server GitHub token is invalid or lacks access");
    this.name = "GitHubTokenInvalidError";
  }
}

const repoCache = new Map<string, CacheEntry<GitHubRepoSummary>>();
const repoInFlight = new Map<string, Promise<GitHubRepoSummary>>();
const commitCache = new Map<string, CacheEntry<GitHubCommitPageData>>();
const commitInFlight = new Map<string, Promise<GitHubCommitPageData>>();

export function resetGitHubCachesForTests(): void {
  repoCache.clear();
  repoInFlight.clear();
  commitCache.clear();
  commitInFlight.clear();
}

function getGitHubToken(): string | null {
  const raw =
    process.env.GITHUB_TOKEN ??
    process.env.GH_TOKEN ??
    process.env.SONDE_GITHUB_TOKEN ??
    null;
  const token = raw?.trim() ?? "";
  return token.length > 0 ? token : null;
}

function getGitHubAuthMode(): GitHubAuthMode {
  return getGitHubToken() ? "server_token" : "unauthenticated";
}

function isRepoAllowlisted(owner: string, repo: string): boolean {
  return getGitHubAllowedRepos().has(`${owner}/${repo}`.toLowerCase());
}

function parseRateLimit(headers: Headers): GitHubRateLimit {
  return {
    limit: parseInt(headers.get("x-ratelimit-limit") ?? "60", 10),
    remaining: parseInt(headers.get("x-ratelimit-remaining") ?? "60", 10),
    reset: parseInt(headers.get("x-ratelimit-reset") ?? "0", 10),
    used: parseInt(headers.get("x-ratelimit-used") ?? "0", 10),
  };
}

function parseNextPage(headers: Headers): number | null {
  const link = headers.get("link");
  if (!link) return null;
  const match = link.match(/<[^>]*[?&]page=(\d+)[^>]*>;\s*rel="next"/);
  return match ? parseInt(match[1], 10) : null;
}

function normalizeCommit(commit: GitHubCommit): TimelineCommit {
  return {
    sha: commit.sha,
    shortSha: commit.sha.slice(0, 8),
    message: commit.commit.message,
    firstLine: commit.commit.message.split("\n")[0].slice(0, 120),
    authorName: commit.commit.author.name,
    authorDate: commit.commit.author.date,
    htmlUrl: commit.html_url,
    authorLogin: commit.author?.login ?? null,
    authorAvatar: commit.author?.avatar_url ?? null,
  };
}

function buildGitHubHeaders(): Record<string, string> {
  const headers: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
  };
  const token = getGitHubToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  return headers;
}

async function getOrLoadCached<T>(
  cache: Map<string, CacheEntry<T>>,
  inFlight: Map<string, Promise<T>>,
  key: string,
  ttlMs: number,
  loader: () => Promise<T>
): Promise<{ status: GitHubCacheStatus; value: T }> {
  const cached = cache.get(key);
  if (cached && cached.expiresAt > Date.now()) {
    return { status: "hit", value: cached.value };
  }

  const pending = inFlight.get(key);
  if (pending) {
    return { status: "hit", value: await pending };
  }

  const promise = loader();
  inFlight.set(key, promise);
  try {
    const value = await promise;
    cache.set(key, {
      value,
      expiresAt: Date.now() + ttlMs,
    });
    return { status: "miss", value };
  } finally {
    inFlight.delete(key);
  }
}

async function loadRepoSummary(owner: string, repo: string): Promise<GitHubRepoSummary> {
  const path = `/repos/${owner}/${repo}`;
  const response = await fetch(`${GITHUB_API_BASE}${path}`, {
    headers: buildGitHubHeaders(),
  });
  const rateLimit = parseRateLimit(response.headers);

  if (response.status === 403 || response.status === 429) {
    throw new GitHubRateLimitError(rateLimit.reset);
  }
  if (response.status === 401) {
    throw new GitHubTokenInvalidError();
  }
  if (response.status === 404) {
    throw new GitHubRepoNotFoundError(owner, repo);
  }
  if (!response.ok) {
    throw new Error(`GitHub repo lookup failed: ${response.status} ${response.statusText}`);
  }

  const data = (await response.json()) as GitHubRepoResponse;
  return {
    defaultBranch: data.default_branch,
    htmlUrl: data.html_url,
    private: data.private,
  };
}

async function loadCommitPage(
  owner: string,
  repo: string,
  branch: string,
  defaultBranch: string,
  perPage: number
): Promise<GitHubCommitPageData> {
  const url = new URL(`${GITHUB_API_BASE}/repos/${owner}/${repo}/commits`);
  url.searchParams.set("sha", branch);
  url.searchParams.set("page", "1");
  url.searchParams.set("per_page", String(perPage));

  const response = await fetch(url.toString(), {
    headers: buildGitHubHeaders(),
  });
  const rateLimit = parseRateLimit(response.headers);

  if (response.status === 403 || response.status === 429) {
    throw new GitHubRateLimitError(rateLimit.reset);
  }
  if (response.status === 401) {
    throw new GitHubTokenInvalidError();
  }
  if (response.status === 404) {
    throw new GitHubBranchNotFoundError(owner, repo, branch, defaultBranch);
  }
  if (!response.ok) {
    throw new Error(`GitHub commits lookup failed: ${response.status} ${response.statusText}`);
  }

  const data = (await response.json()) as GitHubCommit[];
  return {
    commits: data.map(normalizeCommit),
    nextPage: parseNextPage(response.headers),
    rateLimit,
    fetchedAt: new Date().toISOString(),
  };
}

function buildWarnings(
  authMode: GitHubAuthMode,
  requestedBranch: string | null,
  resolvedBranch: string,
  repo: GitHubRepoSummary
): string[] {
  const warnings: string[] = [];
  if (authMode === "unauthenticated") {
    warnings.push("Server is calling GitHub without a token; private repos and the 60/hr limit still apply.");
  }
  if (!requestedBranch) {
    warnings.push(`Using the repo default branch (${resolvedBranch}).`);
  } else if (requestedBranch !== resolvedBranch) {
    warnings.push(`Showing ${resolvedBranch} instead of the requested branch ${requestedBranch}.`);
  }
  if (repo.private && authMode !== "server_token") {
    warnings.push("Private repos require a server-side GitHub token.");
  }
  return warnings;
}

async function requireAuthenticatedUser(c: Context): Promise<VerifiedUser | null> {
  const authHeader = c.req.header("Authorization") ?? "";
  const token = authHeader.startsWith("Bearer ")
    ? authHeader.slice("Bearer ".length).trim()
    : "";
  if (!token) return null;
  return verifyToken(token);
}

function clampPerPage(raw: string | undefined): number {
  const parsed = parseInt(raw ?? String(GITHUB_DEFAULT_PER_PAGE), 10);
  if (!Number.isFinite(parsed)) return GITHUB_DEFAULT_PER_PAGE;
  return Math.max(1, Math.min(GITHUB_MAX_PER_PAGE, parsed));
}

function normalizeBranch(raw: string | undefined): string | null {
  const branch = raw?.trim() ?? "";
  return branch.length > 0 ? branch : null;
}

export function registerGitHubRoutes(app: Hono): void {
  app.get("/github/repos/:owner/:repo/commits", async (c) => {
    const user = await requireAuthenticatedUser(c);
    if (!user) {
      return c.json(
        {
          error: {
            type: "unauthorized",
            message: "Missing or invalid Sonde session token",
          },
        },
        401
      );
    }

    const owner = c.req.param("owner").trim();
    const repo = c.req.param("repo").trim();
    const perPage = clampPerPage(c.req.query("per_page"));
    const requestedBranch = normalizeBranch(c.req.query("branch"));

    if (!owner || !repo) {
      return c.json(
        {
          error: {
            type: "bad_request",
            message: "owner and repo are required",
          },
        },
        400
      );
    }

    if (getGitHubAuthMode() === "server_token" && !isRepoAllowlisted(owner, repo)) {
      return c.json(
        {
          error: {
            type: "repo_not_allowed",
            message: `GitHub proxy access is not allowed for ${owner}/${repo}.`,
          },
        },
        403
      );
    }

    const rateLimit = await checkUserRateLimit("github", user.id, 60, 60_000);
    if (!rateLimit.allowed) {
      return c.json(
        {
          error: {
            type: "rate_limited",
            message: "Too many GitHub requests for this user. Please wait a moment.",
            retryAfterMs: rateLimit.retryAfterMs,
          },
        },
        429
      );
    }

    const releaseOperation = await tryStartUserOperation("github", user.id, 4);
    if (!releaseOperation) {
      return c.json(
        {
          error: {
            type: "busy",
            message: "Too many concurrent GitHub requests for this user.",
          },
        },
        429
      );
    }

    let upstreamRequests = 0;

    try {
      const repoKey = `${owner}/${repo}`;
      const repoResult = await getOrLoadCached(
        repoCache,
        repoInFlight,
        repoKey,
        REPO_CACHE_TTL_MS,
        async () => {
          upstreamRequests += 1;
          return loadRepoSummary(owner, repo);
        }
      );

      const resolvedBranch = requestedBranch ?? repoResult.value.defaultBranch;
      const commitKey = `${owner}/${repo}@${resolvedBranch}?per_page=${perPage}`;
      const commitResult = await getOrLoadCached(
        commitCache,
        commitInFlight,
        commitKey,
        COMMIT_CACHE_TTL_MS,
        async () => {
          upstreamRequests += 1;
          return loadCommitPage(
            owner,
            repo,
            resolvedBranch,
            repoResult.value.defaultBranch,
            perPage
          );
        }
      );

      const response: GitHubTimelineResponse = {
        commits: commitResult.value.commits,
        nextPage: commitResult.value.nextPage,
        rateLimit: commitResult.value.rateLimit,
        repo: repoResult.value,
        diagnostics: {
          authMode: getGitHubAuthMode(),
          repoCache: repoResult.status,
          commitCache: commitResult.status,
          upstreamRequests,
          requestedBranch,
          resolvedBranch,
          fetchedAt: commitResult.value.fetchedAt,
          warnings: buildWarnings(
            getGitHubAuthMode(),
            requestedBranch,
            resolvedBranch,
            repoResult.value
          ),
        },
      };

      return c.json(response);
    } catch (error) {
      if (error instanceof GitHubRateLimitError) {
        return c.json(
          {
            error: {
              type: "rate_limit",
              message: error.message,
              reset: error.reset,
            },
          },
          429
        );
      }
      if (error instanceof GitHubTokenInvalidError) {
        return c.json(
          {
            error: {
              type: "github_token_invalid",
              message: error.message,
            },
          },
          502
        );
      }
      if (error instanceof GitHubRepoNotFoundError) {
        return c.json(
          {
            error: {
              type: "repo_not_found",
              message: error.message,
            },
          },
          404
        );
      }
      if (error instanceof GitHubBranchNotFoundError) {
        return c.json(
          {
            error: {
              type: "branch_not_found",
              message: error.message,
              branch: error.branch,
              defaultBranch: error.defaultBranch,
            },
          },
          404
        );
      }

      console.error("[sonde-server] github route failed:", error);
      return c.json(
        {
          error: {
            type: "github_error",
            message: "GitHub request failed",
          },
        },
        502
      );
    } finally {
      await releaseOperation();
    }
  });
}
