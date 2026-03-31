import { useState, useMemo, useCallback, memo } from "react";
import { Link } from "@tanstack/react-router";
import {
  ExternalLink,
  AlertTriangle,
  ChevronDown,
  Diamond,
  GitCommitHorizontal,
  Download,
} from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { useTimelineRepos } from "@/hooks/use-timeline-data";
import { useGitHubCommits, RateLimitError, RepoNotFoundError } from "@/hooks/use-github-commits";
import {
  useGitHubRateRemaining,
  useGitHubRateReset,
  useGitHubRateLimitValue,
} from "@/stores/github-rate-limit";
import { queryKeys } from "@/lib/query-keys";
import { commitUrl } from "@/components/experiments/git-provenance";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { formatRelativeTime } from "@/lib/utils";
import type { TimelineCommit, ExperimentMarker, TimelineRepo } from "@/types/github";

// ── Rate limit indicator ─────────────────────────────────────────

function RateLimitIndicator() {
  const remaining = useGitHubRateRemaining();
  const reset = useGitHubRateReset();
  const limit = useGitHubRateLimitValue();
  if (remaining >= limit) return null; // Never fetched yet

  const resetTime = reset > 0 ? new Date(reset * 1000).toLocaleTimeString() : "";
  const isExhausted = remaining === 0 && reset > 0;

  return (
    <div
      className={`flex items-center gap-1.5 rounded-[5.5px] px-2 py-1 text-[11px] ${
        isExhausted
          ? "border border-status-failed/20 bg-status-failed/5 text-status-failed"
          : "text-text-quaternary"
      }`}
    >
      {isExhausted ? (
        <>
          <AlertTriangle className="h-3 w-3" />
          Rate limit reached. Resets at {resetTime}
        </>
      ) : (
        <>{remaining}/{limit} GitHub API requests remaining</>
      )}
    </div>
  );
}

// ── Branch selector ──────────────────────────────────────────────

function BranchSelector({
  branches,
  selected,
  onChange,
}: {
  branches: string[];
  selected: string;
  onChange: (b: string) => void;
}) {
  if (branches.length <= 1) {
    return (
      <span className="rounded-[3px] bg-surface-raised px-1.5 py-0.5 font-mono text-[10px] text-text-quaternary">
        {selected}
      </span>
    );
  }
  return (
    <div className="relative">
      <select
        value={selected}
        onChange={(e) => onChange(e.target.value)}
        className="appearance-none rounded-[5.5px] bg-surface-hover py-1 pl-2 pr-6 text-[11px] font-medium text-text-secondary transition-colors hover:text-text focus:outline-none"
      >
        {branches.map((b) => (
          <option key={b} value={b}>{b}</option>
        ))}
      </select>
      <ChevronDown className="pointer-events-none absolute right-1.5 top-1/2 h-3 w-3 -translate-y-1/2 text-text-quaternary" />
    </div>
  );
}

// ── Experiment marker chip ───────────────────────────────────────

const ExperimentMarkerChip = memo(function ExperimentMarkerChip({
  marker,
}: {
  marker: ExperimentMarker;
}) {
  return (
    <Link
      to="/experiments/$id"
      params={{ id: marker.experimentId }}
      className="group ml-5 flex items-center gap-1.5 rounded-[5.5px] border border-accent/20 bg-accent/5 px-2 py-1 transition-colors hover:border-accent/40"
    >
      <Diamond className="h-3 w-3 text-accent" />
      <span className="font-mono text-[11px] font-medium text-accent">
        {marker.experimentId}
      </span>
      <span className="text-[10px] text-text-tertiary">
        {marker.type === "open" ? "opened" : "closed"}
      </span>
      <Badge variant={marker.status}>{marker.status}</Badge>
      {marker.dirty && (
        <span className="text-[9px] text-status-open">dirty</span>
      )}
    </Link>
  );
});

// ── Commit node ──────────────────────────────────────────────────

const CommitNode = memo(function CommitNode({
  commit,
  repoUrl,
  markers,
  isLast,
}: {
  commit: TimelineCommit;
  repoUrl: string;
  markers: ExperimentMarker[];
  isLast: boolean;
}) {
  const url = commitUrl(repoUrl, commit.sha);

  return (
    <div className="relative pl-5">
      {!isLast && (
        <div className="absolute bottom-0 left-[7px] top-3 w-px bg-border-subtle" />
      )}
      <div
        className={`absolute left-1 top-[7px] h-[10px] w-[10px] rounded-full border-2 ${
          markers.length > 0
            ? "border-accent bg-accent"
            : "border-border bg-surface"
        }`}
      />
      <div className="pb-4">
        <div className="flex items-start gap-2">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5">
              {url ? (
                <a
                  href={url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="shrink-0 font-mono text-[11px] font-medium text-accent hover:underline"
                >
                  {commit.shortSha}
                </a>
              ) : (
                <span className="shrink-0 font-mono text-[11px] font-medium text-text">
                  {commit.shortSha}
                </span>
              )}
              <span className="truncate text-[12px] text-text">
                {commit.firstLine}
              </span>
            </div>
            <div className="mt-0.5 flex items-center gap-2 text-[10px] text-text-quaternary">
              <span>{commit.authorName}</span>
              <span>{formatRelativeTime(commit.authorDate)}</span>
            </div>
          </div>
        </div>
        {markers.length > 0 && (
          <div className="mt-1.5 space-y-1">
            {markers.map((m) => (
              <ExperimentMarkerChip
                key={`${m.experimentId}-${m.type}`}
                marker={m}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
});

// ── Repo swimlane ────────────────────────────────────────────────

function RepoSwimlane({ repo }: { repo: TimelineRepo }) {
  const [branch, setBranch] = useState(repo.defaultBranch);
  const [fetchEnabled, setFetchEnabled] = useState(false);
  const queryClient = useQueryClient();

  // Check if we already have cached data for this key
  const cachedData = queryClient.getQueryData(
    queryKeys.github.allCommits(repo.identity.owner, repo.identity.repo, branch)
  );
  const shouldFetch = fetchEnabled || cachedData != null;

  const { data: commits, isLoading, error } = useGitHubCommits(
    repo.identity.owner,
    repo.identity.repo,
    branch,
    { enabled: shouldFetch }
  );

  const markersBySha = useMemo(() => {
    const map = new Map<string, ExperimentMarker[]>();
    for (const m of repo.experiments) {
      const existing = map.get(m.sha) ?? [];
      existing.push(m);
      map.set(m.sha, existing);
    }
    return map;
  }, [repo.experiments]);

  const unmatchedMarkers = useMemo(() => {
    if (!commits) return repo.experiments;
    const commitShas = new Set(commits.map((c) => c.sha));
    return repo.experiments.filter((m) => !commitShas.has(m.sha));
  }, [repo.experiments, commits]);

  const repoUrl = `https://${repo.identity.host}/${repo.identity.owner}/${repo.identity.repo}`;

  const handleBranchChange = useCallback((b: string) => {
    setBranch(b);
    setFetchEnabled(true); // auto-fetch on branch switch
  }, []);

  return (
    <div className="min-w-[320px] flex-1">
      {/* Header */}
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <a
            href={repoUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1 text-[13px] font-medium text-text hover:underline"
          >
            {repo.key}
            <ExternalLink className="h-3 w-3 text-text-quaternary" />
          </a>
          <span className="text-[10px] text-text-quaternary">
            {repo.experiments.length} marker{repo.experiments.length !== 1 ? "s" : ""}
          </span>
        </div>
        <BranchSelector
          branches={[repo.defaultBranch, ...repo.branches.filter((b) => b !== repo.defaultBranch)]}
          selected={branch}
          onChange={handleBranchChange}
        />
      </div>

      {/* Content */}
      <div className="rounded-[8px] border border-border bg-surface p-3">
        {/* Not yet fetched — show load button */}
        {!shouldFetch && (
          <div className="flex flex-col items-center gap-3 py-8">
            <GitCommitHorizontal className="h-6 w-6 text-text-quaternary" />
            <button
              onClick={() => setFetchEnabled(true)}
              className="inline-flex items-center gap-1.5 rounded-[5.5px] bg-accent px-3 py-1.5 text-[12px] font-medium text-on-accent transition-colors hover:bg-accent-hover"
            >
              <Download className="h-3 w-3" />
              Load commit history
            </button>
            <p className="text-[10px] text-text-quaternary">
              Fetches up to 100 commits from GitHub (1 API request)
            </p>
          </div>
        )}

        {/* Loading */}
        {shouldFetch && isLoading && (
          <div className="space-y-3 py-2">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="flex items-start gap-2 pl-5">
                <Skeleton className="mt-1 h-2.5 w-2.5 shrink-0 rounded-full" />
                <div className="flex-1 space-y-1">
                  <Skeleton className="h-3 w-3/4" />
                  <Skeleton className="h-2.5 w-1/3" />
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Error */}
        {error && (
          <div className="flex flex-col items-center gap-2 py-8 text-center">
            <AlertTriangle className="h-5 w-5 text-status-failed" />
            <p className="text-[12px] text-text-tertiary">
              {error instanceof RepoNotFoundError
                ? "Repository not accessible. It may be private — check your VITE_GITHUB_TOKEN."
                : error instanceof RateLimitError
                  ? error.message
                  : "Failed to load commit history"}
            </p>
          </div>
        )}

        {/* Unmatched experiment markers */}
        {unmatchedMarkers.length > 0 && commits && (
          <div className="mb-3 space-y-1 border-b border-border-subtle pb-3">
            <p className="text-[10px] text-text-quaternary">
              Experiments on commits not in this branch:
            </p>
            {unmatchedMarkers.map((m) => (
              <ExperimentMarkerChip key={`${m.experimentId}-${m.type}`} marker={m} />
            ))}
          </div>
        )}

        {/* Commit list */}
        {commits && commits.map((commit, i) => (
          <CommitNode
            key={commit.sha}
            commit={commit}
            repoUrl={repoUrl}
            markers={markersBySha.get(commit.sha) ?? []}
            isLast={i === commits.length - 1}
          />
        ))}

        {commits && commits.length === 0 && !error && (
          <p className="py-8 text-center text-[12px] text-text-quaternary">
            No commits found on branch <span className="font-mono">{branch}</span>
          </p>
        )}
      </div>
    </div>
  );
}

// ── Page ─────────────────────────────────────────────────────────

export default function TimelinePage() {
  const { repos, isLoading } = useTimelineRepos();

  if (isLoading) {
    return (
      <div className="space-y-5">
        <Skeleton className="h-5 w-36" />
        <Skeleton className="h-[300px] w-full rounded-[8px]" />
      </div>
    );
  }

  if (repos.length === 0) {
    return (
      <div className="space-y-5">
        <div>
          <h1 className="text-[15px] font-semibold tracking-[-0.015em] text-text">Timeline</h1>
          <p className="text-[12px] text-text-tertiary">Git commit history with experiment markers</p>
        </div>
        <div className="flex flex-col items-center gap-3 rounded-[8px] border border-border-subtle py-16">
          <GitCommitHorizontal className="h-8 w-8 text-text-quaternary" />
          <p className="text-[13px] text-text-tertiary">No git-linked experiments found</p>
          <p className="max-w-[340px] text-center text-[12px] text-text-quaternary">
            Experiments logged with <span className="font-mono">sonde log</span> from
            inside a git repo will appear here.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-[15px] font-semibold tracking-[-0.015em] text-text">Timeline</h1>
          <p className="text-[12px] text-text-tertiary">
            {repos.length} repo{repos.length !== 1 ? "s" : ""} with experiment markers
          </p>
        </div>
        <RateLimitIndicator />
      </div>

      <div className="flex gap-4 overflow-x-auto pb-2">
        {repos.map((repo) => (
          <RepoSwimlane key={repo.key} repo={repo} />
        ))}
      </div>
    </div>
  );
}
