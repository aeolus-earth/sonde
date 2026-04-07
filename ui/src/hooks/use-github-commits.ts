import { useQuery } from "@tanstack/react-query";
import { queryKeys } from "@/lib/query-keys";
import {
  fetchCommits,
  RateLimitError,
  RepoNotFoundError,
  BranchNotFoundError,
  GitHubProxyAuthError,
  GitHubProxyConfigError,
} from "@/lib/github-api";
import type { CommitPage } from "@/types/github";

/**
 * Fetch up to 100 commits for a repo/branch through the Sonde server.
 * Set enabled=false to defer until user clicks "Load".
 */
export function useGitHubCommits(
  owner: string,
  repo: string,
  branch: string | null,
  options?: { enabled?: boolean }
) {
  const branchKey = branch ?? "__default__";

  return useQuery({
    queryKey: queryKeys.github.allCommits(owner, repo, branchKey),
    queryFn: async (): Promise<CommitPage> => {
      return fetchCommits(owner, repo, { branch, perPage: 100 });
    },
    staleTime: Infinity,
    gcTime: Infinity,
    enabled: options?.enabled ?? true,
    retry: (failureCount, error) => {
      if (
        error instanceof RateLimitError ||
        error instanceof RepoNotFoundError ||
        error instanceof BranchNotFoundError ||
        error instanceof GitHubProxyAuthError ||
        error instanceof GitHubProxyConfigError
      ) {
        return false;
      }
      return failureCount < 2;
    },
  });
}

export {
  BranchNotFoundError,
  GitHubProxyAuthError,
  GitHubProxyConfigError,
  RateLimitError,
  RepoNotFoundError,
};
