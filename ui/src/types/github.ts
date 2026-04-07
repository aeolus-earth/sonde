import type { ExperimentStatus } from "./sonde";

/** Raw commit from GitHub REST API */
export interface GitHubCommit {
  sha: string;
  commit: {
    message: string;
    author: { name: string; email: string; date: string };
    committer: { name: string; email: string; date: string };
  };
  html_url: string;
  author: { login: string; avatar_url: string } | null;
}

/** Normalized commit for timeline rendering */
export interface TimelineCommit {
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

/** Parsed repo identity */
export interface RepoIdentity {
  host: string;
  owner: string;
  repo: string;
}

/** Rate limit state from GitHub response headers */
export interface GitHubRateLimit {
  limit: number;
  remaining: number;
  reset: number;
  used: number;
}

export type GitHubAuthMode = "server_token" | "unauthenticated";

export interface GitHubRepoSummary {
  defaultBranch: string;
  htmlUrl: string;
  private: boolean;
}

export interface GitHubCommitDiagnostics {
  authMode: GitHubAuthMode;
  repoCache: "hit" | "miss";
  commitCache: "hit" | "miss";
  upstreamRequests: number;
  requestedBranch: string | null;
  resolvedBranch: string;
  fetchedAt: string;
  warnings: string[];
}

/** A page of commits for infinite query */
export interface CommitPage {
  commits: TimelineCommit[];
  nextPage: number | null;
  rateLimit: GitHubRateLimit;
  repo: GitHubRepoSummary;
  diagnostics: GitHubCommitDiagnostics;
}

/** Experiment marker on the timeline */
export interface ExperimentMarker {
  experimentId: string;
  type: "open" | "close";
  sha: string;
  branch: string | null;
  dirty: boolean;
  status: ExperimentStatus;
  finding: string | null;
  hypothesis: string | null;
}

/** Repo with its experiments and branches */
export interface TimelineRepo {
  identity: RepoIdentity;
  key: string;
  branches: string[];
  defaultBranch: string | null;
  experiments: ExperimentMarker[];
}
