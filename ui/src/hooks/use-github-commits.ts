import { useQuery } from "@tanstack/react-query";
import { queryKeys } from "@/lib/query-keys";
import { fetchCommits, RateLimitError, RepoNotFoundError } from "@/lib/github-api";
import type { TimelineCommit } from "@/types/github";

/**
 * Fetch up to 100 commits for a repo/branch. One request, cached forever.
 * Set enabled=false to defer until user clicks "Load".
 */
export function useGitHubCommits(
  owner: string,
  repo: string,
  branch: string,
  options?: { enabled?: boolean }
) {
  return useQuery({
    queryKey: queryKeys.github.allCommits(owner, repo, branch),
    queryFn: async (): Promise<TimelineCommit[]> => {
      const page = await fetchCommits(owner, repo, { branch, perPage: 100 });
      return page.commits;
    },
    staleTime: Infinity,
    gcTime: Infinity,
    enabled: options?.enabled ?? true,
    retry: (failureCount, error) => {
      if (error instanceof RateLimitError || error instanceof RepoNotFoundError)
        return false;
      return failureCount < 2;
    },
  });
}

export { RateLimitError, RepoNotFoundError };
