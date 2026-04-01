import type { MentionRef, ToolUseData } from "@/types/chat";

const PARENT_RECORD_RE = /\b(EXP|FIND|DIR)-[A-Z0-9]+\b/gi;

const PARENT_INPUT_KEYS = [
  "experiment_id",
  "finding_id",
  "direction_id",
  "parent_id",
] as const;

/**
 * Detect Sonde artifact ids in assistant or user text (e.g. ART-0010).
 * Returns stable, deduplicated order of first occurrence.
 */
export function extractArtifactIdsFromText(text: string): string[] {
  const re = /\b(ART-[A-Z0-9]+)\b/gi;
  const seen = new Set<string>();
  const out: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const id = m[1]!.toUpperCase();
    if (!seen.has(id)) {
      seen.add(id);
      out.push(id);
    }
  }
  return out;
}

function dedupePreserveOrder(ids: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of ids) {
    const u = raw.toUpperCase();
    if (!seen.has(u)) {
      seen.add(u);
      out.push(u);
    }
  }
  return out;
}

function normalizeMcpToolName(tool: string): string {
  return tool.replace(/^mcp__sonde__/, "");
}

function collectIdsFromArtifactRows(rows: unknown): string[] {
  if (!Array.isArray(rows)) return [];
  const out: string[] = [];
  for (const row of rows) {
    if (row && typeof row === "object" && "id" in row) {
      const id = (row as { id: unknown }).id;
      if (typeof id === "string" && /^ART-[A-Z0-9]+$/i.test(id)) {
        out.push(id.toUpperCase());
      }
    }
  }
  return out;
}

function parseExperimentShowArtifactsJson(output: string): string[] {
  try {
    const parsed = JSON.parse(output.trim()) as Record<string, unknown>;
    const raw = parsed._artifacts ?? parsed.artifacts;
    return collectIdsFromArtifactRows(raw);
  } catch {
    return [];
  }
}

function parseArtifactsListJson(output: string): string[] {
  try {
    const parsed = JSON.parse(output.trim()) as unknown;
    if (Array.isArray(parsed)) return collectIdsFromArtifactRows(parsed);
    if (parsed && typeof parsed === "object") {
      const o = parsed as Record<string, unknown>;
      return collectIdsFromArtifactRows(o._artifacts ?? o.artifacts);
    }
    return [];
  } catch {
    return [];
  }
}

function parseAttachJson(output: string): string[] {
  try {
    const parsed = JSON.parse(output.trim()) as { files?: unknown };
    return collectIdsFromArtifactRows(parsed.files);
  } catch {
    return [];
  }
}

/** Root-level `_artifacts` / `artifacts` arrays (e.g. experiment show JSON). */
function parseLooseArtifactsFromJsonOutput(output: string): string[] {
  try {
    const parsed = JSON.parse(output.trim()) as unknown;
    if (!parsed || typeof parsed !== "object") return [];
    const o = parsed as Record<string, unknown>;
    const raw = o._artifacts ?? o.artifacts;
    return collectIdsFromArtifactRows(raw);
  } catch {
    return [];
  }
}

/**
 * EXP/FIND/DIR ids in prose (e.g. "see EXP-0001") for parent-based artifact fetch.
 */
export function extractParentRecordIdsFromText(text: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = PARENT_RECORD_RE.exec(text)) !== null) {
    const id = m[0]!.toUpperCase();
    if (!seen.has(id)) {
      seen.add(id);
      out.push(id);
    }
  }
  return out;
}

export function extractParentIdsFromMentions(mentions: MentionRef[] | undefined): string[] {
  if (!mentions?.length) return [];
  const out: string[] = [];
  for (const m of mentions) {
    if (m.type === "experiment" || m.type === "finding" || m.type === "direction") {
      out.push(m.id.toUpperCase());
    }
  }
  return dedupePreserveOrder(out);
}

export function extractParentIdsFromToolInputs(toolUses: ToolUseData[] | undefined): string[] {
  if (!toolUses?.length) return [];
  const out: string[] = [];
  for (const tu of toolUses) {
    if (tu.status !== "done") continue;
    for (const key of PARENT_INPUT_KEYS) {
      const v = tu.input[key];
      if (typeof v === "string" && /^(EXP|FIND|DIR)-/i.test(v)) {
        out.push(v.toUpperCase());
      }
    }
  }
  return dedupePreserveOrder(out);
}

/** Merge parent ids from text, mentions, and tool inputs for `useArtifactsByParent` queries. */
export function mergeParentIdsForArtifactFetch(
  content: string,
  mentions: MentionRef[] | undefined,
  toolUses: ToolUseData[] | undefined,
): string[] {
  return dedupePreserveOrder([
    ...extractParentRecordIdsFromText(content),
    ...extractParentIdsFromMentions(mentions),
    ...extractParentIdsFromToolInputs(toolUses),
  ]);
}

/**
 * Extract ART-* ids from completed Sonde MCP tool stdout (JSON + bare ids in text).
 * Enables inline previews without requiring the assistant to repeat ids in prose.
 */
export function extractArtifactIdsFromToolOutputs(
  toolUses: ToolUseData[] | undefined,
): string[] {
  if (!toolUses?.length) return [];
  const all: string[] = [];
  for (const tu of toolUses) {
    if (tu.status !== "done" || !tu.output?.trim()) continue;
    const tool = normalizeMcpToolName(tu.tool);
    if (tool === "sonde_experiment_show") {
      all.push(...parseExperimentShowArtifactsJson(tu.output));
    } else if (tool === "sonde_artifacts_list") {
      all.push(...parseArtifactsListJson(tu.output));
    } else if (tool === "sonde_experiment_attach") {
      all.push(...parseAttachJson(tu.output));
    }
    all.push(...parseLooseArtifactsFromJsonOutput(tu.output));
    all.push(...extractArtifactIdsFromText(tu.output));
  }
  return dedupePreserveOrder(all);
}

/** Merge text + tool-derived ids; text order wins, then tools, deduped. */
export function mergeArtifactSources(
  content: string,
  toolUses: ToolUseData[] | undefined,
): string[] {
  return dedupePreserveOrder([
    ...extractArtifactIdsFromText(content),
    ...extractArtifactIdsFromToolOutputs(toolUses),
  ]);
}
