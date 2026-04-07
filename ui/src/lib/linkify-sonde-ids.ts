/**
 * Turn bare Sonde record IDs into markdown links for the assistant bubble.
 * Protects existing [text](url), fenced ``` code ```, and inline `code`.
 */

/** Matches EXP-0123, find-0001, proj-001, q-42, etc. */
export const SONDE_RECORD_ID_REGEX =
  /\b(EXP|FIND|DIR|Q|PROJ|ART)-[A-Za-z0-9]+\b/g;

export type SondeRecordLinkTarget =
  | { to: "/experiments/$id"; params: { id: string } }
  | { to: "/findings/$id"; params: { id: string } }
  | { to: "/directions/$id"; params: { id: string } }
  | { to: "/projects/$id"; params: { id: string } }
  | { to: "/questions"; hash: string }
  | null;

export function recordIdToLinkTarget(id: string): SondeRecordLinkTarget {
  const u = id.toUpperCase();
  const prefix = u.split("-")[0];
  switch (prefix) {
    case "EXP":
      return { to: "/experiments/$id", params: { id: u } };
    case "FIND":
      return { to: "/findings/$id", params: { id: u } };
    case "DIR":
      return { to: "/directions/$id", params: { id: u } };
    case "Q":
      return { to: "/questions", hash: u };
    case "PROJ":
      return { to: "/projects/$id", params: { id: u } };
    case "ART":
      return null;
    default:
      return null;
  }
}

export function recordIdToHref(id: string): string | null {
  const t = recordIdToLinkTarget(id);
  if (!t) return null;
  if (t.to === "/questions") {
    return `/questions#${t.hash}`;
  }
  switch (t.to) {
    case "/experiments/$id":
      return `/experiments/${t.params.id}`;
    case "/findings/$id":
      return `/findings/${t.params.id}`;
    case "/directions/$id":
      return `/directions/${t.params.id}`;
    case "/projects/$id":
      return `/projects/${t.params.id}`;
    default:
      return null;
  }
}

function replacePlaceholders(text: string, chunks: string[]): string {
  return text.replace(/\uE000(\d+)\uE001/g, (_, i) => chunks[Number(i)] ?? "");
}

/** Mask segments with placeholders so we do not linkify inside them. */
function mask(text: string, pattern: RegExp, chunks: string[]): string {
  return text.replace(pattern, (full) => {
    chunks.push(full);
    return `\uE000${chunks.length - 1}\uE001`;
  });
}

export function linkifySondeRecordIds(text: string): string {
  const chunks: string[] = [];

  let masked = text;
  masked = mask(masked, /```[\s\S]*?```/g, chunks);
  masked = mask(masked, /`[^`]+`/g, chunks);
  masked = mask(masked, /\[([^\]]*)\]\(([^)]*)\)/g, chunks);

  const idRe = new RegExp(SONDE_RECORD_ID_REGEX.source, "gi");
  masked = masked.replace(idRe, (id) => {
    const href = recordIdToHref(id);
    return href ? `[${id}](${href})` : id;
  });

  return replacePlaceholders(masked, chunks);
}
