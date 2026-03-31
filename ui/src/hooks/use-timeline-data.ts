import { useMemo } from "react";
import { useExperiments } from "./use-experiments";
import { parseRepoUrl } from "@/components/experiments/git-provenance";
import type { ExperimentMarker, TimelineRepo } from "@/types/github";

export function useTimelineRepos() {
  const { data: experiments, isLoading } = useExperiments();

  const result = useMemo(() => {
    if (!experiments) return { repos: [], isLoading: true };

    const repoMap = new Map<
      string,
      {
        identity: { host: string; owner: string; repo: string };
        branches: Set<string>;
        experiments: ExperimentMarker[];
      }
    >();

    for (const exp of experiments) {
      if (!exp.git_repo) continue;
      const parsed = parseRepoUrl(exp.git_repo);
      if (!parsed) continue;

      const key = `${parsed.owner}/${parsed.repo}`;
      if (!repoMap.has(key)) {
        repoMap.set(key, {
          identity: parsed,
          branches: new Set(),
          experiments: [],
        });
      }
      const entry = repoMap.get(key)!;

      if (exp.git_branch) entry.branches.add(exp.git_branch);
      if (exp.git_close_branch) entry.branches.add(exp.git_close_branch);

      if (exp.git_commit) {
        entry.experiments.push({
          experimentId: exp.id,
          type: "open",
          sha: exp.git_commit,
          branch: exp.git_branch,
          dirty: false,
          status: exp.status,
          finding: exp.finding,
          hypothesis: exp.hypothesis,
        });
      }
      if (exp.git_close_commit) {
        entry.experiments.push({
          experimentId: exp.id,
          type: "close",
          sha: exp.git_close_commit,
          branch: exp.git_close_branch,
          dirty: exp.git_dirty ?? false,
          status: exp.status,
          finding: exp.finding,
          hypothesis: exp.hypothesis,
        });
      }
    }

    const repos: TimelineRepo[] = Array.from(repoMap.entries()).map(
      ([key, entry]) => {
        const branchList = [...entry.branches];
        return {
          identity: entry.identity,
          key,
          branches: branchList,
          defaultBranch: "main",
          experiments: entry.experiments,
        };
      }
    );

    return { repos, isLoading: false };
  }, [experiments]);

  return { ...result, isLoading: isLoading || result.isLoading };
}
