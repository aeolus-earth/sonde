import { getAgentHttpBase } from "@/lib/agent-http";
import { supabase } from "@/lib/supabase";
import { useGitHubRateLimitStore } from "@/stores/github-rate-limit";
import type { CommitPage } from "@/types/github";

type GitHubErrorPayload =
  | {
      type: "rate_limit";
      message: string;
      reset: number;
    }
  | {
      type: "repo_not_found";
      message: string;
    }
  | {
      type: "branch_not_found";
      message: string;
      branch: string;
      defaultBranch: string;
    }
  | {
      type: "github_token_invalid" | "github_error" | "unauthorized" | "bad_request";
      message: string;
    };

export class RateLimitError extends Error {
  constructor(public readonly reset: number) {
    super(
      `GitHub API rate limit exceeded. Resets at ${new Date(reset * 1000).toLocaleTimeString()}`
    );
    this.name = "RateLimitError";
  }
}

export class RepoNotFoundError extends Error {
  constructor(owner: string, repo: string) {
    super(`Repository ${owner}/${repo} not found or is private`);
    this.name = "RepoNotFoundError";
  }
}

export class BranchNotFoundError extends Error {
  constructor(
    public readonly owner: string,
    public readonly repo: string,
    public readonly branch: string,
    public readonly defaultBranch: string
  ) {
    super(`Branch ${branch} not found in ${owner}/${repo}`);
    this.name = "BranchNotFoundError";
  }
}

export class GitHubProxyAuthError extends Error {
  constructor(message = "Timeline request is unauthorized") {
    super(message);
    this.name = "GitHubProxyAuthError";
  }
}

export class GitHubProxyConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GitHubProxyConfigError";
  }
}

async function getAccessToken(): Promise<string> {
  const current = supabase.auth.getSession();
  const {
    data: { session },
    error,
  } = await current;
  if (error || !session?.access_token) {
    throw new GitHubProxyAuthError("Sign in again to load timeline commit history.");
  }
  return session.access_token;
}

async function parseError(response: Response): Promise<GitHubErrorPayload | null> {
  try {
    const body = (await response.json()) as { error?: GitHubErrorPayload };
    return body.error ?? null;
  } catch {
    return null;
  }
}

export async function fetchCommits(
  owner: string,
  repo: string,
  options: { branch?: string | null; perPage?: number } = {}
): Promise<CommitPage> {
  const { branch = null, perPage = 100 } = options;
  const accessToken = await getAccessToken();

  const url = new URL(`${getAgentHttpBase()}/github/repos/${owner}/${repo}/commits`);
  url.searchParams.set("per_page", String(perPage));
  if (branch) url.searchParams.set("branch", branch);

  const response = await fetch(url.toString(), {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });

  const payload = response.ok ? ((await response.json()) as CommitPage) : null;
  if (payload) {
    useGitHubRateLimitStore
      .getState()
      .update(payload.rateLimit, payload.diagnostics.authMode);
    return payload;
  }

  const error = await parseError(response);
  if (error?.type === "rate_limit") {
    throw new RateLimitError(error.reset);
  }
  if (error?.type === "repo_not_found") {
    throw new RepoNotFoundError(owner, repo);
  }
  if (error?.type === "branch_not_found") {
    throw new BranchNotFoundError(owner, repo, error.branch, error.defaultBranch);
  }
  if (response.status === 401 || error?.type === "unauthorized") {
    throw new GitHubProxyAuthError(error?.message);
  }
  if (error?.type === "github_token_invalid") {
    throw new GitHubProxyConfigError(
      "Server GitHub token is invalid. Update GITHUB_TOKEN on the Sonde server."
    );
  }
  if (error?.type === "github_error") {
    throw new GitHubProxyConfigError("Sonde server could not load GitHub commit history.");
  }

  throw new Error(`GitHub timeline request failed: ${response.status} ${response.statusText}`);
}
