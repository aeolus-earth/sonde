export const SONDE_CLI_GIT_URL = "https://github.com/aeolus-earth/sonde.git";

export function sondeGitInstallCommand(ref?: string): string {
  const trimmedRef = ref?.trim();
  const refSegment = trimmedRef ? `@${trimmedRef}` : "";
  return `uv tool install --force git+${SONDE_CLI_GIT_URL}${refSegment}#subdirectory=cli`;
}

export const CHAT_INSTALL_STEPS = [
  {
    label: "Install Sonde from GitHub",
    command: sondeGitInstallCommand(),
    hint: "Reinstalls the CLI from the Sonde repository so your shell has the latest command surface.",
  },
  {
    label: "Authenticate",
    command: "sonde login",
    hint: "SSH, VM, and headless shells automatically switch to a browser activation code instead of localhost callbacks.",
  },
  {
    label: "Set up runtimes",
    command: "sonde setup",
    hint: "Configures runtime integrations, bundled skills, and MCP wiring.",
  },
] as const;

export const CHAT_INSTALL_VERIFY_COMMANDS = [
  "which -a sonde",
  "sonde --version",
  "sonde doctor",
] as const;
