/**
 * Turn bare Sonde record IDs into markdown links for the assistant bubble.
 * Protects existing [text](url), fenced ``` code ```, and inline `code`.
 */

const ID_RE = /\b(EXP|FIND|DIR|Q)-[A-Za-z0-9]+\b/g;

function recordIdToHref(id: string): string | null {
  const prefix = id.split("-")[0];
  switch (prefix) {
    case "EXP":
      return `/experiments/${id}`;
    case "FIND":
      return `/findings/${id}`;
    case "DIR":
      return `/directions/${id}`;
    case "Q":
      return "/questions";
    default:
      return null;
  }
}

function replacePlaceholders(text: string, chunks: string[]): string {
  return text.replace(/\uE000(\d+)\uE001/g, (_, i) => chunks[Number(i)] ?? "");
}

/** Mask segments with placeholders so we do not linkify inside them. */
function mask(
  text: string,
  pattern: RegExp,
  chunks: string[]
): string {
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

  masked = masked.replace(ID_RE, (id) => {
    const href = recordIdToHref(id);
    return href ? `[${id}](${href})` : id;
  });

  return replacePlaceholders(masked, chunks);
}
