import { memo, useCallback, useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import {
  AlertTriangle,
  ChevronDown,
  Diamond,
  Download,
  ExternalLink,
  GitCommitHorizontal,
} from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import {
  BranchNotFoundError,
  GitHubProxyAuthError,
  GitHubProxyConfigError,
  RateLimitError,
  RepoNotFoundError,
  useGitHubCommits,
} from "@/hooks/use-github-commits";
import { useTimelineRepos } from "@/hooks/use-timeline-data";
import { queryKeys } from "@/lib/query-keys";
import { formatRelativeTime } from "@/lib/utils";
import { commitUrl } from "@/components/experiments/git-provenance";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  useGitHubAuthMode,
  useGitHubRateLimitValue,
  useGitHubRateRemaining,
  useGitHubRateReset,
} from "@/stores/github-rate-limit";
import type {
  ExperimentMarker,
  GitHubCommitDiagnostics,
  GitHubRepoSummary,
  TimelineCommit,
  TimelineRepo,
} from "@/types/github";

const DEFAULT_BRANCH_VALUE = "__default__";

type BranchOption = {
  label: string;
  value: string;
};

function RateLimitIndicator() {
  const remaining = useGitHubRateRemaining();
  const reset = useGitHubRateReset();
  const limit = useGitHubRateLimitValue();
  const authMode = useGitHubAuthMode();
  if (remaining >= limit) return null;

  const resetTime = reset > 0 ? new Date(reset * 1000).toLocaleTimeString() : "";
  const isExhausted = remaining === 0 && reset > 0;
  const authLabel =
    authMode === "server_token" ? "server GitHub token" : "unauthenticated GitHub";

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
        <>{remaining}/{limit} GitHub requests remaining via {authLabel}</>
      )}
    </div>
  );
}

function BranchSelector({
  options,
  selected,
  onChange,
}: {
  options: BranchOption[];
  selected: string;
  onChange: (branch: string) => void;
}) {
  const selectedLabel =
    options.find((option) => option.value === selected)?.label ?? selected;

  if (options.length <= 1) {
    return (
      <span className="rounded-[3px] bg-surface-raised px-1.5 py-0.5 text-[10px] text-text-quaternary">
        {selectedLabel}
      </span>
    );
  }

  return (
    <div className="relative">
      <select
        value={selected}
        onChange={(event) => onChange(event.target.value)}
        className="appearance-none rounded-[5.5px] bg-surface-hover py-1 pl-2 pr-6 text-[11px] font-medium text-text-secondary transition-colors hover:text-text focus:outline-none"
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      <ChevronDown className="pointer-events-none absolute right-1.5 top-1/2 h-3 w-3 -translate-y-1/2 text-text-quaternary" />
    </div>
  );
}

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
      {marker.dirty && <span className="text-[9px] text-status-open">dirty</span>}
    </Link>
  );
});

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
              <span className="truncate text-[12px] text-text">{commit.firstLine}</span>
            </div>
            <div className="mt-0.5 flex items-center gap-2 text-[10px] text-text-quaternary">
              <span>{commit.authorName}</span>
              <span>{formatRelativeTime(commit.authorDate)}</span>
            </div>
          </div>
        </div>
        {markers.length > 0 && (
          <div className="mt-1.5 space-y-1">
            {markers.map((marker) => (
              <ExperimentMarkerChip
                key={`${marker.experimentId}-${marker.type}`}
                marker={marker}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
});

function DiagnosticsStrip({
  diagnostics,
  repo,
}: {
  diagnostics: GitHubCommitDiagnostics;
  repo: GitHubRepoSummary;
}) {
  const authLabel =
    diagnostics.authMode === "server_token" ? "server token" : "unauthenticated";
  const cacheSummary = `repo cache ${diagnostics.repoCache}, commit cache ${diagnostics.commitCache}`;
  const requestSummary =
    diagnostics.upstreamRequests === 0
      ? "0 upstream GitHub requests"
      : `${diagnostics.upstreamRequests} upstream GitHub request${diagnostics.upstreamRequests === 1 ? "" : "s"}`;

  return (
    <div className="mb-3 rounded-[6px] border border-border-subtle bg-surface-hover/60 px-2.5 py-2">
      <div className="flex flex-wrap gap-x-3 gap-y-1 text-[10px] text-text-quaternary">
        <span>
          showing <span className="font-mono text-text-secondary">{diagnostics.resolvedBranch}</span>
        </span>
        <span>
          default <span className="font-mono text-text-secondary">{repo.defaultBranch}</span>
        </span>
        <span>{cacheSummary}</span>
        <span>{requestSummary}</span>
        <span>{authLabel}</span>
        <span>fetched {formatRelativeTime(diagnostics.fetchedAt)}</span>
      </div>
      {diagnostics.warnings.length > 0 && (
        <div className="mt-2 space-y-1">
          {diagnostics.warnings.map((warning) => (
            <p key={warning} className="text-[10px] text-text-quaternary">
              {warning}
            </p>
          ))}
        </div>
      )}
    </div>
  );
}

function renderTimelineError(error: Error | null): string {
  if (!error) return "";
  if (error instanceof BranchNotFoundError) {
    return `Branch ${error.branch} was not found. Repo default branch is ${error.defaultBranch}.`;
  }
  if (error instanceof RepoNotFoundError) {
    return "Repository not accessible from the Sonde server. Private repos need a server-side GITHUB_TOKEN.";
  }
  if (error instanceof RateLimitError) {
    return error.message;
  }
  if (error instanceof GitHubProxyAuthError) {
    return error.message;
  }
  if (error instanceof GitHubProxyConfigError) {
    return error.message;
  }
  return "Failed to load commit history";
}

function RepoSwimlane({ repo }: { repo: TimelineRepo }) {
  const [branchSelection, setBranchSelection] = useState(DEFAULT_BRANCH_VALUE);
  const [fetchEnabled, setFetchEnabled] = useState(false);
  const queryClient = useQueryClient();
  const selectedBranch =
    branchSelection === DEFAULT_BRANCH_VALUE ? null : branchSelection;
  const branchKey = selectedBranch ?? DEFAULT_BRANCH_VALUE;

  const cachedData = queryClient.getQueryData(
    queryKeys.github.allCommits(repo.identity.owner, repo.identity.repo, branchKey)
  );
  const shouldFetch = fetchEnabled || cachedData != null;

  const { data: commitPage, isLoading, error } = useGitHubCommits(
    repo.identity.owner,
    repo.identity.repo,
    selectedBranch,
    { enabled: shouldFetch }
  );

  const effectiveDefaultBranch =
    commitPage?.repo.defaultBranch ??
    repo.defaultBranch ??
    (error instanceof BranchNotFoundError ? error.defaultBranch : null);

  const branchOptions = useMemo(() => {
    const options: BranchOption[] = [
      {
        value: DEFAULT_BRANCH_VALUE,
        label: effectiveDefaultBranch
          ? `default (${effectiveDefaultBranch})`
          : "default branch",
      },
    ];
    const seen = new Set<string>(effectiveDefaultBranch ? [effectiveDefaultBranch] : []);
    for (const branch of repo.branches) {
      if (!branch || seen.has(branch)) continue;
      options.push({ value: branch, label: branch });
      seen.add(branch);
    }
    return options;
  }, [effectiveDefaultBranch, repo.branches]);

  const commits = commitPage?.commits ?? null;

  const markersBySha = useMemo(() => {
    const map = new Map<string, ExperimentMarker[]>();
    for (const marker of repo.experiments) {
      const existing = map.get(marker.sha) ?? [];
      existing.push(marker);
      map.set(marker.sha, existing);
    }
    return map;
  }, [repo.experiments]);

  const unmatchedMarkers = useMemo(() => {
    if (!commits) return repo.experiments;
    const commitShas = new Set(commits.map((commit) => commit.sha));
    return repo.experiments.filter((marker) => !commitShas.has(marker.sha));
  }, [commits, repo.experiments]);

  const repoUrl =
    commitPage?.repo.htmlUrl ??
    `https://${repo.identity.host}/${repo.identity.owner}/${repo.identity.repo}`;

  const handleBranchChange = useCallback((branch: string) => {
    setBranchSelection(branch);
    setFetchEnabled(true);
  }, []);

  return (
    <div className="min-w-[340px] flex-1">
      <div className="mb-3 flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <a
            href={repoUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="flex min-w-0 items-center gap-1 text-[13px] font-medium text-text hover:underline"
          >
            <span className="truncate">{repo.key}</span>
            <ExternalLink className="h-3 w-3 shrink-0 text-text-quaternary" />
          </a>
          <span className="shrink-0 text-[10px] text-text-quaternary">
            {repo.experiments.length} marker{repo.experiments.length !== 1 ? "s" : ""}
          </span>
        </div>
        <BranchSelector
          options={branchOptions}
          selected={branchSelection}
          onChange={handleBranchChange}
        />
      </div>

      <div className="rounded-[8px] border border-border bg-surface p-3">
        {!shouldFetch && (
          <div className="flex flex-col items-center gap-3 py-8 text-center">
            <GitCommitHorizontal className="h-6 w-6 text-text-quaternary" />
            <button
              onClick={() => setFetchEnabled(true)}
              className="inline-flex items-center gap-1.5 rounded-[5.5px] bg-accent px-3 py-1.5 text-[12px] font-medium text-on-accent transition-colors hover:bg-accent-hover"
            >
              <Download className="h-3 w-3" />
              Load commit history
            </button>
            <p className="max-w-[240px] text-[10px] text-text-quaternary">
              Loads up to 100 commits through the Sonde server. GitHub responses are server-cached.
            </p>
          </div>
        )}

        {shouldFetch && isLoading && (
          <div className="space-y-3 py-2">
            {Array.from({ length: 6 }).map((_, index) => (
              <div key={index} className="flex items-start gap-2 pl-5">
                <Skeleton className="mt-1 h-2.5 w-2.5 shrink-0 rounded-full" />
                <div className="flex-1 space-y-1">
                  <Skeleton className="h-3 w-3/4" />
                  <Skeleton className="h-2.5 w-1/3" />
                </div>
              </div>
            ))}
          </div>
        )}

        {error && (
          <div className="flex flex-col items-center gap-2 py-8 text-center">
            <AlertTriangle className="h-5 w-5 text-status-failed" />
            <p className="max-w-[280px] text-[12px] text-text-tertiary">
              {renderTimelineError(error)}
            </p>
          </div>
        )}

        {commitPage && <DiagnosticsStrip diagnostics={commitPage.diagnostics} repo={commitPage.repo} />}

        {unmatchedMarkers.length > 0 && commits && (
          <div className="mb-3 space-y-1 border-b border-border-subtle pb-3">
            <p className="text-[10px] text-text-quaternary">
              Experiments on commits not in this branch:
            </p>
            {unmatchedMarkers.map((marker) => (
              <ExperimentMarkerChip
                key={`${marker.experimentId}-${marker.type}`}
                marker={marker}
              />
            ))}
          </div>
        )}

        {commits &&
          commits.map((commit, index) => (
            <CommitNode
              key={commit.sha}
              commit={commit}
              repoUrl={repoUrl}
              markers={markersBySha.get(commit.sha) ?? []}
              isLast={index === commits.length - 1}
            />
          ))}

        {commits && commits.length === 0 && !error && (
          <p className="py-8 text-center text-[12px] text-text-quaternary">
            No commits found on branch{" "}
            <span className="font-mono">
              {commitPage?.diagnostics.resolvedBranch ?? effectiveDefaultBranch ?? "unknown"}
            </span>
          </p>
        )}
      </div>
    </div>
  );
}

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
          <p className="text-[12px] text-text-tertiary">
            Git commit history with experiment markers
          </p>
        </div>
        <div className="flex flex-col items-center gap-3 rounded-[8px] border border-border-subtle py-16">
          <GitCommitHorizontal className="h-8 w-8 text-text-quaternary" />
          <p className="text-[13px] text-text-tertiary">No git-linked experiments found</p>
          <p className="max-w-[340px] text-center text-[12px] text-text-quaternary">
            Experiments logged with <span className="font-mono">sonde log</span> from inside a
            git repo will appear here.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-4">
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
