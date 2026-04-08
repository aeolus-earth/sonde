const SHELL_CONTROL_PATTERN = /(?:\|\||&&|[|;<>`])/;
const SONDE_COMMAND_PATTERN = /^\s*(?:uv\s+run\s+)?sonde\b/;

export function isSondeCommand(command: string): boolean {
  return SONDE_COMMAND_PATTERN.test(command);
}

export function sondeCommandError(command: string): string | null {
  if (!isSondeCommand(command)) return null;
  if (SHELL_CONTROL_PATTERN.test(command)) {
    return "Sonde CLI commands inside sandbox_exec must be a single command without shell chaining, pipes, or redirection.";
  }
  return null;
}
