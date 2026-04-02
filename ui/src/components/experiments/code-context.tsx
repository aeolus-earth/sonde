import { memo } from "react";
import { GitCommit, GitBranch, AlertTriangle, ExternalLink } from "lucide-react";
import type { RepoSnapshot } from "@/types/sonde";
import { parseRepoUrl, commitUrl } from "./git-provenance";
import { cn } from "@/lib/utils";

interface CodeContextProps {
  snapshots: RepoSnapshot[];
}

function repoDisplayName(remote: string): string {
  const parsed = parseRepoUrl(remote);
  if (parsed) return `${parsed.owner}/${parsed.repo}`;
  return remote || "local";
}

export const CodeContext = memo(function CodeContext({
  snapshots,
}: CodeContextProps) {
  if (snapshots.length === 0) return null;

  return (
    <div className="space-y-2">
      {snapshots.map((snap) => {
        const repoUrl = snap.remote
          ? `https://${parseRepoUrl(snap.remote)?.host ?? ""}/${parseRepoUrl(snap.remote)?.owner ?? ""}/${parseRepoUrl(snap.remote)?.repo ?? ""}`
          : null;
        const shaUrl = snap.remote
          ? commitUrl(snap.remote, snap.commit)
          : null;

        return (
          <div
            key={snap.commit + snap.name}
            className={cn(
              "rounded-[6px] border px-3 py-2",
              snap.dirty
                ? "border-status-open/30 bg-status-open/5"
                : "border-border-subtle bg-surface"
            )}
          >
            <div className="flex items-center gap-2 text-[12px]">
              {/* Repo name */}
              <span className="font-medium text-text">{snap.name}</span>

              {repoUrl && (
                <a
                  href={repoUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-text-quaternary transition-colors hover:text-accent"
                  title={repoDisplayName(snap.remote)}
                >
                  <ExternalLink className="h-3 w-3" />
                </a>
              )}

              {/* Dirty indicator */}
              {snap.dirty && (
                <span className="flex items-center gap-0.5 text-[10px] text-status-open">
                  <AlertTriangle className="h-3 w-3" />
                  dirty
                </span>
              )}
            </div>

            <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px] text-text-tertiary">
              {/* Commit SHA */}
              <span className="flex items-center gap-1">
                <GitCommit className="h-3 w-3 text-text-quaternary" />
                {shaUrl ? (
                  <a
                    href={shaUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="font-mono transition-colors hover:text-accent"
                  >
                    {snap.commit.slice(0, 8)}
                  </a>
                ) : (
                  <span className="font-mono">{snap.commit.slice(0, 8)}</span>
                )}
              </span>

              {/* Branch */}
              {snap.branch && (
                <span className="flex items-center gap-1">
                  <GitBranch className="h-3 w-3 text-text-quaternary" />
                  {snap.branch}
                </span>
              )}
            </div>

            {/* Modified files (if dirty) */}
            {snap.dirty &&
              snap.modified_files &&
              snap.modified_files.length > 0 && (
                <div className="mt-1 text-[10px] text-text-quaternary">
                  {snap.modified_files.slice(0, 5).map((f) => (
                    <div key={f} className="truncate font-mono">
                      {f}
                    </div>
                  ))}
                  {snap.modified_files.length > 5 && (
                    <div>
                      +{snap.modified_files.length - 5} more
                    </div>
                  )}
                </div>
              )}
          </div>
        );
      })}
    </div>
  );
});
