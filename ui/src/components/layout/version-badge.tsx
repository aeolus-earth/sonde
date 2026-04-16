import { memo } from "react";

const GITHUB_REPO = "aeolus-earth/sonde";

// Vite's `define` substitutes these as literal strings at build time, so they
// should always be defined. The `??` defaults are belt-and-suspenders — if
// the define ever silently fails (misconfigured build, test harness bypass),
// render a harmless placeholder instead of crashing the shell.
const version = import.meta.env.VITE_APP_VERSION ?? "dev";
const commitSha = import.meta.env.VITE_APP_COMMIT_SHA ?? "local";
const shortSha = commitSha.slice(0, 7);
const commitHref =
  commitSha === "local"
    ? null
    : `https://github.com/${GITHUB_REPO}/commit/${commitSha}`;

type Props = {
  iconOnly?: boolean;
};

export const VersionBadge = memo(function VersionBadge({ iconOnly = false }: Props) {
  const ariaLabel = `Sonde ${version} · commit ${shortSha}`;

  if (iconOnly) {
    // Collapsed rail: show just the short SHA so the badge fits in the 56px column.
    return (
      <div
        aria-label={ariaLabel}
        title={`${version} · ${shortSha}`}
        className="flex justify-center px-1 py-1.5 font-mono text-[10px] leading-none text-text-quaternary"
      >
        {commitHref ? (
          <a href={commitHref} target="_blank" rel="noreferrer" className="hover:text-text-tertiary">
            {shortSha}
          </a>
        ) : (
          <span>{shortSha}</span>
        )}
      </div>
    );
  }

  return (
    <div
      aria-label={ariaLabel}
      title={ariaLabel}
      className="flex items-center gap-1 overflow-hidden px-2 py-1.5 font-mono text-[10px] leading-none text-text-quaternary"
    >
      <span className="truncate">{version}</span>
      <span aria-hidden="true" className="shrink-0">·</span>
      {commitHref ? (
        <a
          href={commitHref}
          target="_blank"
          rel="noreferrer"
          className="shrink-0 hover:text-text-tertiary"
        >
          {shortSha}
        </a>
      ) : (
        <span className="shrink-0">{shortSha}</span>
      )}
    </div>
  );
});
