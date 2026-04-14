/* eslint-disable react-refresh/only-export-components */
import { memo } from "react";
import { GitCommit, GitBranch, AlertTriangle, ExternalLink } from "lucide-react";
import type { ExperimentSummary } from "@/types/sonde";

/**
 * Parse a git_repo value into { host, owner, repo } for building commit URLs.
 * Handles:
 *   - github.com:user/repo.git  (sanitized SSH)
 *   - github.com/user/repo.git  (sanitized SSH alt)
 *   - https://github.com/user/repo.git
 *   - git@github.com:user/repo.git
 */
export function parseRepoUrl(
  gitRepo: string
): { host: string; owner: string; repo: string } | null {
  // HTTPS: https://github.com/user/repo.git
  const httpsMatch = gitRepo.match(
    /https?:\/\/([^/]+)\/([^/]+)\/([^/]+?)(?:\.git)?$/
  );
  if (httpsMatch) {
    return { host: httpsMatch[1], owner: httpsMatch[2], repo: httpsMatch[3] };
  }

  // SSH: git@github.com:user/repo.git or github.com:user/repo.git
  const sshMatch = gitRepo.match(
    /(?:git@)?([^:/]+)[:/]([^/]+)\/([^/]+?)(?:\.git)?$/
  );
  if (sshMatch) {
    return { host: sshMatch[1], owner: sshMatch[2], repo: sshMatch[3] };
  }

  // Sanitized: github.com/user/repo.git (no protocol, no git@)
  const plainMatch = gitRepo.match(
    /^([^/]+)\/([^/]+)\/([^/]+?)(?:\.git)?$/
  );
  if (plainMatch) {
    return { host: plainMatch[1], owner: plainMatch[2], repo: plainMatch[3] };
  }

  return null;
}

export function commitUrl(gitRepo: string, sha: string): string | null {
  const parsed = parseRepoUrl(gitRepo);
  if (!parsed) return null;

  // GitHub / GitLab / Bitbucket all use /commit/<sha>
  return `https://${parsed.host}/${parsed.owner}/${parsed.repo}/commit/${sha}`;
}

export function branchUrl(gitRepo: string, branch: string): string | null {
  const parsed = parseRepoUrl(gitRepo);
  if (!parsed) return null;

  return `https://${parsed.host}/${parsed.owner}/${parsed.repo}/tree/${branch}`;
}

export function repoDisplayName(gitRepo: string): string {
  const parsed = parseRepoUrl(gitRepo);
  if (!parsed) return gitRepo;
  return `${parsed.owner}/${parsed.repo}`;
}

interface CommitLinkProps {
  sha: string;
  gitRepo: string | null;
}

function CommitLink({ sha, gitRepo }: CommitLinkProps) {
  const short = sha.slice(0, 8);
  const url = gitRepo ? commitUrl(gitRepo, sha) : null;

  if (url) {
    return (
      <a
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex items-center gap-1 font-mono text-[11px] text-accent hover:underline"
      >
        {short}
        <ExternalLink className="h-2.5 w-2.5" />
      </a>
    );
  }

  return <span className="font-mono text-[11px] text-text">{short}</span>;
}

function BranchLink({
  branch,
  gitRepo,
}: {
  branch: string;
  gitRepo: string | null;
}) {
  const url = gitRepo ? branchUrl(gitRepo, branch) : null;

  if (url) {
    return (
      <a
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex items-center gap-1 text-[11px] text-accent hover:underline"
      >
        {branch}
        <ExternalLink className="h-2.5 w-2.5" />
      </a>
    );
  }

  return <span className="text-[11px] text-text">{branch}</span>;
}

interface GitProvenanceProps {
  experiment: ExperimentSummary;
}

export const GitProvenance = memo(function GitProvenance({
  experiment: exp,
}: GitProvenanceProps) {
  const hasOpen = !!exp.git_commit;
  const hasClose = !!exp.git_close_commit;

  if (!hasOpen && !hasClose) return null;

  return (
    <div className="space-y-2.5">
      {/* Repository */}
      {exp.git_repo && (
        <div className="flex items-center gap-2">
          <span className="text-[11px] text-text-quaternary">Repo</span>
          <a
            href={(() => {
              const parsed = parseRepoUrl(exp.git_repo);
              return parsed
                ? `https://${parsed.host}/${parsed.owner}/${parsed.repo}`
                : undefined;
            })()}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 font-mono text-[11px] text-accent hover:underline"
          >
            {repoDisplayName(exp.git_repo)}
            <ExternalLink className="h-2.5 w-2.5" />
          </a>
        </div>
      )}

      {/* Creation commit */}
      {hasOpen && (
        <div className="rounded-[5.5px] border border-border-subtle bg-bg px-2.5 py-2">
          <div className="mb-1 text-[10px] font-medium uppercase tracking-wider text-text-quaternary">
            Opened
          </div>
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <GitCommit className="h-3 w-3 text-text-tertiary" />
              <CommitLink sha={exp.git_commit!} gitRepo={exp.git_repo} />
            </div>
            {exp.git_branch && (
              <div className="flex items-center gap-2">
                <GitBranch className="h-3 w-3 text-text-tertiary" />
                <BranchLink branch={exp.git_branch} gitRepo={exp.git_repo} />
              </div>
            )}
          </div>
        </div>
      )}

      {/* Close commit */}
      {hasClose && (
        <div className="rounded-[5.5px] border border-border-subtle bg-bg px-2.5 py-2">
          <div className="mb-1 flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-wider text-text-quaternary">
            Closed
            {exp.git_dirty && (
              <span className="inline-flex items-center gap-0.5 normal-case text-status-open">
                <AlertTriangle className="h-2.5 w-2.5" />
                dirty
              </span>
            )}
          </div>
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <GitCommit className="h-3 w-3 text-text-tertiary" />
              <CommitLink
                sha={exp.git_close_commit!}
                gitRepo={exp.git_repo}
              />
            </div>
            {exp.git_close_branch && (
              <div className="flex items-center gap-2">
                <GitBranch className="h-3 w-3 text-text-tertiary" />
                <BranchLink
                  branch={exp.git_close_branch}
                  gitRepo={exp.git_repo}
                />
              </div>
            )}
          </div>
        </div>
      )}

      {/* Diff link if both commits exist */}
      {hasOpen && hasClose && exp.git_commit !== exp.git_close_commit && (
        <div>
          {exp.git_repo &&
            (() => {
              const parsed = parseRepoUrl(exp.git_repo);
              if (!parsed) return null;
              const url = `https://${parsed.host}/${parsed.owner}/${parsed.repo}/compare/${exp.git_commit!.slice(0, 12)}...${exp.git_close_commit!.slice(0, 12)}`;
              return (
                <a
                  href={url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 rounded-[5.5px] border border-border px-2 py-1 text-[11px] text-text-secondary transition-colors hover:bg-surface-hover hover:text-text"
                >
                  View diff: {exp.git_commit!.slice(0, 7)}..{exp.git_close_commit!.slice(0, 7)}
                  <ExternalLink className="h-2.5 w-2.5" />
                </a>
              );
            })()}
        </div>
      )}
    </div>
  );
});
