/**
 * Classify sandbox commands for tool approval.
 *
 * Read-only and session-local commands auto-approve.
 * Remote graph writes and unknown mutations require user approval.
 */

import {
  isAllowedSandboxReadPath,
  isAllowedSandboxWritePath,
  isSensitiveSandboxPath,
} from "./sandbox-path-policy.js";

export type CommandClass = "read" | "session" | "mutate" | "destructive";

const READ_SHELL_COMMANDS = new Set([
  "cat", "rg", "grep", "find", "ls", "head", "tail", "wc", "file",
  "stat", "diff", "tree", "echo", "pwd", "which", "less",
  "sort", "uniq", "awk", "sed", "cut", "tr", "xargs",
]);

const SESSION_SHELL_COMMANDS = new Set([
  "python",
  "python3",
  "pip",
  "pip3",
  "uv",
  "node",
  "npm",
  "npx",
  "pnpm",
  "pytest",
]);

const READ_SONDE_ACTIONS = new Set([
  "show", "list", "search", "brief", "tree", "status", "health",
  "findings", "questions", "recent", "history", "handoff", "tags",
  "search-all", "doctor", "whoami", "pull",
]);

const SESSION_SONDE_ACTIONS = new Set([
  "report-template",
]);

const DESTRUCTIVE_PATTERNS = [
  /\bsonde\s+\w+\s+delete\b/,
  /\bsonde\s+\w+\s+remove\b/,
  /\brm\s+-rf\b/,
  /\brm\s+-r\b/,
  /(?:^|\s)(?:sudo|su)\b/,
  /\b(?:env|printenv)\b/,
  /(?:^|\s)curl\b.*\|\s*(?:sh|bash)\b/,
  /(?:^|\s)wget\b.*\|\s*(?:sh|bash)\b/,
  /\/home\/daytona\/(?:\.ssh|\.sonde_env|\.env\b)/,
  /(?:^|\s)\/(?:etc|proc)\//,
];

const SONDE_NOUNS = new Set([
  "admin",
  "access",
  "artifact",
  "direction",
  "experiment",
  "finding",
  "note",
  "program",
  "project",
  "question",
  "sync",
  "tag",
  "takeaway",
]);

function commandWords(command: string): string[] {
  return command
    .trim()
    .split(/\s+/)
    .filter(Boolean);
}

function sondeAction(command: string): string | null {
  const words = commandWords(command);
  let index = 0;
  if (words[index] === "uv" && words[index + 1] === "run") {
    index += 2;
  }
  if (words[index] !== "sonde") return null;
  const first = words[index + 1] ?? "";
  const second = words[index + 2] ?? "";
  if (SONDE_NOUNS.has(first) && second) return second;
  return first;
}

function sondeNoun(command: string): string | null {
  const words = commandWords(command);
  let index = 0;
  if (words[index] === "uv" && words[index + 1] === "run") {
    index += 2;
  }
  const first = words[index + 1] ?? "";
  return SONDE_NOUNS.has(first) ? first : null;
}

function firstShellBinary(command: string): string {
  const firstCmd = command.split(/[|;&]/).map((s) => s.trim())[0] ?? "";
  return firstCmd.split(/\s+/)[0] ?? "";
}

function commandReferencesSensitivePath(command: string): boolean {
  return (
    command.includes("/home/daytona/.sonde_env") ||
    command.includes("/home/daytona/.ssh") ||
    command.includes("/etc/") ||
    command.includes("/proc/") ||
    /(?:^|\s)\.env(?:\s|$|\/)/.test(command)
  );
}

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
  if (commandReferencesSensitivePath(trimmed)) return "destructive";

  // Check for sonde CLI commands
  const action = sondeAction(trimmed);
  if (action) {
    const normalizedAction = action.toLowerCase();
    const noun = sondeNoun(trimmed);
    if (noun === "program" && normalizedAction === "list") return "read";
    if (normalizedAction === "pull") return "read";
    if (READ_SONDE_ACTIONS.has(normalizedAction)) return "read";
    if (SESSION_SONDE_ACTIONS.has(normalizedAction)) return "session";
    return "mutate";
  }

  // Check for known read-only shell commands (first word in pipeline)
  const binary = firstShellBinary(trimmed);
  if (READ_SHELL_COMMANDS.has(binary)) return "read";
  if (SESSION_SHELL_COMMANDS.has(binary)) return "session";

  // Default: require approval for unknown commands
  return "mutate";
}

/**
 * Classify a sandbox tool for approval.
 */
export function classifySandboxTool(
  toolName: string,
  input: Record<string, unknown>,
  sessionDir?: string
): CommandClass {
  if (toolName === "sandbox_read") {
    const targetPath = (input.path as string | undefined) ?? "";
    if (isSensitiveSandboxPath(targetPath)) return "destructive";
    return isAllowedSandboxReadPath(targetPath, sessionDir) ? "read" : "mutate";
  }
  if (toolName === "sandbox_glob") {
    const cwd = (input.cwd as string | undefined) ?? "/home/daytona/.sonde";
    if (isSensitiveSandboxPath(cwd)) return "destructive";
    return isAllowedSandboxReadPath(cwd, sessionDir) ? "read" : "mutate";
  }
  if (toolName === "sandbox_write") {
    const targetPath = (input.path as string | undefined) ?? "";
    if (isAllowedSandboxWritePath(targetPath, sessionDir)) return "session";
    return "mutate";
  }
  if (toolName === "sandbox_exec") {
    const command = (input.command as string | undefined) ?? "";
    return classifyCommand(command);
  }
  return "mutate";
}
