export interface TimelineProxyRepo {
  owner?: string | null;
  repo?: string | null;
  defaultBranch?: string | null;
  htmlUrl?: string | null;
  private?: boolean;
}

export interface TimelineProxyDiagnostics {
  authMode: string;
  upstreamRequests: number;
}

export interface TimelineProxyResponse {
  commits: Array<{ sha: string }>;
  repo?: TimelineProxyRepo | null;
  diagnostics: TimelineProxyDiagnostics;
}

export interface TimelineRepoIdentity {
  owner: string;
  repo: string;
}

function trimSegment(value: string | null | undefined): string | null {
  const trimmed = value?.trim() ?? "";
  return trimmed.length > 0 ? trimmed : null;
}

function parseRepoIdentityFromUrl(
  htmlUrl: string | null | undefined,
): TimelineRepoIdentity | null {
  const trimmed = trimSegment(htmlUrl);
  if (!trimmed) {
    return null;
  }

  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return null;
  }

  const [owner, repo] = url.pathname
    .split("/")
    .map((segment) => segment.trim())
    .filter(Boolean);
  if (!owner || !repo) {
    return null;
  }

  return { owner, repo };
}

export function readTimelineRepoIdentity(
  response: TimelineProxyResponse,
): TimelineRepoIdentity | null {
  const directOwner = trimSegment(response.repo?.owner);
  const directRepo = trimSegment(response.repo?.repo);
  if (directOwner && directRepo) {
    return {
      owner: directOwner,
      repo: directRepo,
    };
  }

  return parseRepoIdentityFromUrl(response.repo?.htmlUrl);
}
