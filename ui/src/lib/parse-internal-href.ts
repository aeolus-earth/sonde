/**
 * Map in-app markdown hrefs to TanStack Router Link targets.
 * Only same-origin paths starting with `/` are handled (no protocol-relative URLs).
 */

export type ParsedInternalHref =
  | {
      kind: "route";
      to: "/experiments/$id";
      params: { id: string };
      hash?: string;
    }
  | {
      kind: "route";
      to: "/findings/$id";
      params: { id: string };
      hash?: string;
    }
  | {
      kind: "route";
      to: "/directions/$id";
      params: { id: string };
      hash?: string;
    }
  | {
      kind: "route";
      to: "/questions";
      hash?: string;
    }
  | null;

export function parseInternalHref(href: string | undefined): ParsedInternalHref {
  if (!href || href.startsWith("//")) {
    return null;
  }

  let path = href;
  let hash: string | undefined;
  const hashIdx = path.indexOf("#");
  if (hashIdx >= 0) {
    hash = path.slice(hashIdx + 1) || undefined;
    path = path.slice(0, hashIdx);
  }

  if (!path.startsWith("/")) {
    return null;
  }

  const exp = /^\/experiments\/([^/]+)$/.exec(path);
  if (exp) {
    return {
      kind: "route",
      to: "/experiments/$id",
      params: { id: exp[1] },
      hash,
    };
  }

  const find = /^\/findings\/([^/]+)$/.exec(path);
  if (find) {
    return {
      kind: "route",
      to: "/findings/$id",
      params: { id: find[1] },
      hash,
    };
  }

  const dir = /^\/directions\/([^/]+)$/.exec(path);
  if (dir) {
    return {
      kind: "route",
      to: "/directions/$id",
      params: { id: dir[1] },
      hash,
    };
  }

  if (path === "/questions" || path === "/questions/") {
    return { kind: "route", to: "/questions", hash };
  }

  return null;
}
