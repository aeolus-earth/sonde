/**
 * Classify sandbox commands for tool approval.
 *
 * Read-only commands auto-approve. Mutating commands require user approval.
 */

import { isAllowedSandboxReadPath, isSensitiveSandboxPath } from "./sandbox-path-policy.js";

export type CommandClass = "read" | "mutate" | "destructive";

const READ_SHELL_COMMANDS = new Set([
  "grep", "find", "ls", "head", "tail", "wc", "file",
  "stat", "diff", "tree", "echo", "pwd", "which", "less",
  "sort", "uniq", "awk", "sed", "cut", "tr", "xargs",
]);

const READ_SONDE_ACTIONS = new Set([
  "show", "list", "search", "brief", "tree", "status", "health",
  "findings", "questions", "recent", "history", "handoff", "tags",
  "search-all", "doctor", "whoami",
]);

const DESTRUCTIVE_PATTERNS = [
  /\bsonde\s+\w+\s+delete\b/,
  /\brm\s+-rf\b/,
  /\brm\s+-r\b/,
];

/**
 * Classify a shell command for approval purposes.
 *
 * Returns "read" for safe commands (auto-approve),
 * "mutate" for state-changing commands (require approval),
 * "destructive" for dangerous commands (require approval + warning).
 */
export function classifyCommand(command: string): CommandClass {
  const trimmed = command.trim();

  // Check destructive patterns first
  for (const pattern of DESTRUCTIVE_PATTERNS) {
    if (pattern.test(trimmed)) return "destructive";
  }

  // Check for sonde CLI commands
  const sondeMatch = trimmed.match(
    /(?:^|\|)\s*(?:uv\s+run\s+)?sonde\s+(?:(\w+)\s+)?(\w+)/
  );
  if (sondeMatch) {
    const action = sondeMatch[2] ?? sondeMatch[1] ?? "";
    if (READ_SONDE_ACTIONS.has(action.toLowerCase())) return "read";
    return "mutate";
  }

  // Check for known read-only shell commands (first word in pipeline)
  const firstCmd = trimmed.split(/[|;&]/).map(s => s.trim())[0] ?? "";
  const binary = firstCmd.split(/\s+/)[0] ?? "";
  if (READ_SHELL_COMMANDS.has(binary)) return "read";

  // Default: require approval for unknown commands
  return "mutate";
}

/**
 * Classify a sandbox tool for approval.
 */
export function classifySandboxTool(
  toolName: string,
  input: Record<string, unknown>
): CommandClass {
  if (toolName === "sandbox_read") {
    const targetPath = (input.path as string | undefined) ?? "";
    if (isSensitiveSandboxPath(targetPath)) return "destructive";
    return isAllowedSandboxReadPath(targetPath) ? "read" : "mutate";
  }
  if (toolName === "sandbox_glob") {
    const cwd = (input.cwd as string | undefined) ?? "/home/daytona/.sonde";
    if (isSensitiveSandboxPath(cwd)) return "destructive";
    return isAllowedSandboxReadPath(cwd) ? "read" : "mutate";
  }
  if (toolName === "sandbox_write") {
    return "mutate";
  }
  if (toolName === "sandbox_exec") {
    const command = (input.command as string | undefined) ?? "";
    const classified = classifyCommand(command);
    return classified === "destructive" ? "destructive" : "mutate";
  }
  return "mutate";
}
