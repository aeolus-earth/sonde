import { memo } from "react";

const GITHUB_REPO = "aeolus-earth/sonde";

export const VersionBadge = memo(function VersionBadge() {
  const version = import.meta.env.VITE_APP_VERSION;
  const commitSha = import.meta.env.VITE_APP_COMMIT_SHA;
  const shortSha = commitSha.slice(0, 7);
  const commitHref =
    commitSha === "local"
      ? null
      : `https://github.com/${GITHUB_REPO}/commit/${commitSha}`;

  return (
    <div
      aria-label={`Sonde ${version} · commit ${shortSha}`}
      className="pointer-events-none fixed bottom-1.5 right-2 z-30 select-none text-[10px] leading-none text-text-quaternary"
    >
      <span className="pointer-events-auto inline-flex items-center gap-1 rounded-[4px] bg-surface/70 px-1.5 py-[3px] font-mono backdrop-blur-sm">
        <span>{version}</span>
        <span aria-hidden="true">·</span>
        {commitHref ? (
          <a
            href={commitHref}
            target="_blank"
            rel="noreferrer"
            className="hover:text-text-tertiary"
          >
            {shortSha}
          </a>
        ) : (
          <span>{shortSha}</span>
        )}
      </span>
    </div>
  );
});
