export type CommandClass = "read" | "session" | "mutate" | "destructive";

const READ_SHELL_COMMANDS = new Set([
  "cat",
  "rg",
  "grep",
  "find",
  "ls",
  "head",
  "tail",
  "wc",
  "file",
  "stat",
  "diff",
  "tree",
  "echo",
  "pwd",
  "which",
  "less",
  "sort",
  "uniq",
  "awk",
  "sed",
  "cut",
  "tr",
  "xargs",
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

const READ_GIT_SUBCOMMANDS = new Set([
  "branch",
  "diff",
  "grep",
  "log",
  "show",
  "status",
]);

const MUTATE_GIT_SUBCOMMANDS = new Set([
  "add",
  "am",
  "apply",
  "bisect",
  "checkout",
  "cherry-pick",
  "clean",
  "clone",
  "commit",
  "fetch",
  "merge",
  "mv",
  "pull",
  "push",
  "rebase",
  "reset",
  "restore",
  "revert",
  "rm",
  "stash",
  "switch",
  "tag",
  "worktree",
]);

const READ_SONDE_ACTIONS = new Set([
  "show",
  "list",
  "search",
  "brief",
  "tree",
  "status",
  "health",
  "findings",
  "questions",
  "recent",
  "history",
  "handoff",
  "tags",
  "search-all",
  "doctor",
  "whoami",
  "pull",
]);

const SESSION_SONDE_ACTIONS = new Set(["report-template"]);

const DESTRUCTIVE_PATTERNS = [
  /\bsonde\s+\w+\s+delete\b/,
  /\bsonde\s+\w+\s+remove\b/,
  /\brm\s+-rf\b/,
  /\brm\s+-r\b/,
  /(?:^|\s)(?:sudo|su)\b/,
  /\b(?:env|printenv)\b/,
  /(?:^|\s)curl\b.*\|\s*(?:sh|bash)\b/,
  /(?:^|\s)wget\b.*\|\s*(?:sh|bash)\b/,
  /(?:^|[/"'\s])(?:\.ssh|\.sonde_env|\.env)(?:$|[/"'\s])/,
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
  const firstCmd = command.split(/[|;&]/).map((segment) => segment.trim())[0] ?? "";
  return firstCmd.split(/\s+/)[0] ?? "";
}

function gitSubcommand(command: string): string | null {
  const words = commandWords(command);
  if (words[0] !== "git") return null;
  for (const word of words.slice(1)) {
    if (word.startsWith("-")) continue;
    return word;
  }
  return null;
}

function commandReferencesSensitivePath(command: string): boolean {
  return (
    command.includes(".sonde_env") ||
    command.includes("/.ssh") ||
    command.includes("/etc/") ||
    command.includes("/proc/") ||
    /(?:^|\s)\.env(?:\s|$|\/)/.test(command)
  );
}

export function classifyCommand(command: string): CommandClass {
  const trimmed = command.trim();

  for (const pattern of DESTRUCTIVE_PATTERNS) {
    if (pattern.test(trimmed)) return "destructive";
  }
  if (commandReferencesSensitivePath(trimmed)) return "destructive";

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

  const binary = firstShellBinary(trimmed);
  if (binary === "git") {
    const subcommand = gitSubcommand(trimmed);
    if (!subcommand) return "read";
    if (READ_GIT_SUBCOMMANDS.has(subcommand)) return "read";
    if (MUTATE_GIT_SUBCOMMANDS.has(subcommand)) return "mutate";
    return "mutate";
  }
  if (READ_SHELL_COMMANDS.has(binary)) return "read";
  if (SESSION_SHELL_COMMANDS.has(binary)) return "session";

  return "mutate";
}
