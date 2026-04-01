import type { ExperimentSummary } from "@/types/sonde";

/** Normalize query into non-empty tokens (whitespace-split, trimmed). */
export function parseExperimentSearchTokens(raw: string): string[] {
  return raw
    .trim()
    .split(/\s+/)
    .filter((t) => t.length > 0);
}

function digitsOnly(s: string): string {
  return s.replace(/\D/g, "");
}

/**
 * Flexible experiment ID match: substring, hyphen/underscore/space-insensitive
 * compact match, and digit-only tokens against the numeric part (e.g. 156 / 0156 vs EXP-0156).
 */
export function experimentIdMatchesToken(id: string, token: string): boolean {
  const lid = id.toLowerCase();
  const lt = token.toLowerCase();
  if (lid.includes(lt)) return true;

  const idCompact = lid.replace(/[-_\s]/g, "");
  const tCompact = lt.replace(/[-_\s]/g, "");
  if (tCompact.length > 0 && idCompact.includes(tCompact)) return true;

  if (/^\d+$/.test(lt)) {
    const idDigits = digitsOnly(lid);
    if (idDigits.includes(lt)) return true;
    const idStripped = idDigits.replace(/^0+/, "") || "0";
    const tStripped = lt.replace(/^0+/, "") || "0";
    if (idStripped.includes(tStripped)) return true;
  }

  return false;
}

function textFieldMatches(token: string, value: string | null | undefined): boolean {
  if (value == null || value === "") return false;
  return value.toLowerCase().includes(token.toLowerCase());
}

/**
 * True if `token` matches any searchable slice of the experiment (AND-row uses one token).
 */
export function experimentMatchesSearchToken(
  e: ExperimentSummary,
  token: string
): boolean {
  const t = token;
  if (experimentIdMatchesToken(e.id, t)) return true;
  if (textFieldMatches(t, e.program)) return true;
  if (textFieldMatches(t, e.content)) return true;
  if (textFieldMatches(t, e.hypothesis)) return true;
  if (textFieldMatches(t, e.finding)) return true;
  if (textFieldMatches(t, e.source)) return true;
  if (e.direction_id && experimentIdMatchesToken(e.direction_id, t)) return true;
  if (e.project_id && experimentIdMatchesToken(e.project_id, t)) return true;
  if (e.linear_id && textFieldMatches(t, e.linear_id)) return true;
  if (e.git_branch && textFieldMatches(t, e.git_branch)) return true;
  if (e.git_commit && textFieldMatches(t, e.git_commit)) return true;
  if ((e.tags ?? []).some((tag) => tag.toLowerCase().includes(t.toLowerCase()))) return true;
  if (
    (e.data_sources ?? []).some((ds) => ds.toLowerCase().includes(t.toLowerCase()))
  )
    return true;
  if (
    e.artifact_filenames?.some((f) => f.toLowerCase().includes(t.toLowerCase()))
  )
    return true;
  if ((e.related ?? []).some((rid) => experimentIdMatchesToken(rid, t))) return true;
  return false;
}

/**
 * Every token must match at least one field (AND over tokens, OR within fields).
 */
export function experimentMatchesSearchQuery(
  e: ExperimentSummary,
  rawQuery: string
): boolean {
  const tokens = parseExperimentSearchTokens(rawQuery);
  if (tokens.length === 0) return true;
  return tokens.every((tok) => experimentMatchesSearchToken(e, tok));
}
