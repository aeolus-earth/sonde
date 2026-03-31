/**
 * Classifies Sonde MCP tool names (as exposed to the agent, e.g. `sonde_show`
 * or `mcp__sonde__sonde_show`) into read vs mutate vs destructive.
 */

const READ = new Set<string>([
  "sonde_brief",
  "sonde_recent",
  "sonde_tree",
  "sonde_status",
  "sonde_show",
  "sonde_health",
  "sonde_handoff",
  "sonde_project_list",
  "sonde_project_show",
  "sonde_question_list",
  "sonde_question_show",
  "sonde_finding_list",
  "sonde_finding_show",
  "sonde_direction_list",
  "sonde_direction_show",
  "sonde_tag_list",
  "sonde_experiment_list",
  "sonde_experiment_show",
  "sonde_experiment_search",
  "sonde_search_all",
  "sonde_artifacts_list",
  "sonde_propose_tasks",
]);

const DESTRUCTIVE = new Set<string>([
  "sonde_project_delete",
  "sonde_question_delete",
  "sonde_finding_delete",
  "sonde_direction_delete",
  "sonde_experiment_delete",
]);

const SONDE_PREFIX = "mcp__sonde__";

/** Normalize SDK tool name to the underlying Sonde tool id (e.g. `sonde_show`). */
export function normalizeSondeMcpToolName(toolName: string): string {
  if (toolName.startsWith(SONDE_PREFIX)) {
    return toolName.slice(SONDE_PREFIX.length);
  }
  return toolName;
}

export function isSondeMcpTool(toolName: string): boolean {
  return toolName.startsWith(SONDE_PREFIX) || toolName.startsWith("sonde_");
}

export function isReadTool(sondeToolName: string): boolean {
  return READ.has(sondeToolName);
}

export function isDestructiveTool(sondeToolName: string): boolean {
  return DESTRUCTIVE.has(sondeToolName);
}

/** Mutating Sonde tools require human approval (when not classified as read). */
export function requiresApproval(sondeToolName: string): boolean {
  return !isReadTool(sondeToolName);
}
