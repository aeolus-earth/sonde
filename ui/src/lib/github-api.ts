import { useGitHubRateLimitStore } from "@/stores/github-rate-limit";
import type { GitHubCommit, TimelineCommit, CommitPage, GitHubRateLimit } from "@/types/github";

export class RateLimitError extends Error {
  reset: number;
  constructor(reset: number) {
    super(`GitHub API rate limit exceeded. Resets at ${new Date(reset * 1000).toLocaleTimeString()}`);
    this.name = "RateLimitError";
    this.reset = reset;
  }
}

export class RepoNotFoundError extends Error {
  constructor(owner: string, repo: string) {
    super(`Repository ${owner}/${repo} not found or is private`);
    this.name = "RepoNotFoundError";
  }
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

function normalizeCommit(c: GitHubCommit): TimelineCommit {
  return {
    sha: c.sha,
    shortSha: c.sha.slice(0, 8),
    message: c.commit.message,
    firstLine: c.commit.message.split("\n")[0].slice(0, 120),
    authorName: c.commit.author.name,
    authorDate: c.commit.author.date,
    htmlUrl: c.html_url,
    authorLogin: c.author?.login ?? null,
    authorAvatar: c.author?.avatar_url ?? null,
  };
}

export async function fetchCommits(
  owner: string,
  repo: string,
  options: { branch?: string; page?: number; perPage?: number } = {}
): Promise<CommitPage> {
  const { branch = "main", page = 1, perPage = 100 } = options;

  // Pre-flight rate limit check
  const store = useGitHubRateLimitStore.getState();
  if (store.remaining === 0 && store.reset > 0 && Date.now() < store.reset * 1000) {
    throw new RateLimitError(store.reset);
  }

  const url = new URL(`https://api.github.com/repos/${owner}/${repo}/commits`);
  url.searchParams.set("sha", branch);
  url.searchParams.set("page", String(page));
  url.searchParams.set("per_page", String(perPage));

  const headers: Record<string, string> = {
    Accept: "application/vnd.github+json",
  };

  const token = import.meta.env.VITE_GITHUB_TOKEN;
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  const res = await fetch(url.toString(), { headers });

  // Update rate limit from response
  const rateLimit = parseRateLimit(res.headers);
  useGitHubRateLimitStore.getState().update(rateLimit);

  if (res.status === 403 || res.status === 429) {
    throw new RateLimitError(rateLimit.reset);
  }
  if (res.status === 404) {
    throw new RepoNotFoundError(owner, repo);
  }
  if (!res.ok) {
    throw new Error(`GitHub API error: ${res.status} ${res.statusText}`);
  }

  const data: GitHubCommit[] = await res.json();
  const nextPage = parseNextPage(res.headers);

  return {
    commits: data.map(normalizeCommit),
    nextPage,
    rateLimit,
  };
}
