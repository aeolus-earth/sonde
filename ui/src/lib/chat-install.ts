export const SONDE_CLI_GIT_REF = "main";

export function sondeGitInstallCommand(ref = SONDE_CLI_GIT_REF): string {
  return `uv tool install --force "git+https://github.com/aeolus-earth/sonde.git@${ref}#subdirectory=cli"`;
}

export const CHAT_INSTALL_STEPS = [
  {
    label: "Install uv",
    command: "curl -LsSf https://astral.sh/uv/install.sh | sh",
    hint: "Installs Astral's Python tool runner.",
  },
  {
    label: "Install Sonde from GitHub",
    command: sondeGitInstallCommand(),
    hint: "Tracks the current Sonde main branch from the private repo.",
  },
  {
    label: "Authenticate",
    command: "sonde login",
    hint: "SSH, VM, and headless shells automatically switch to a browser activation code instead of localhost callbacks.",
  },
  {
    label: "Set up runtimes",
    command: "sonde setup",
    hint: "Configures IDE integration, skills, and MCP wiring.",
  },
] as const;

export const CHAT_INSTALL_VERIFY_COMMANDS = [
  "which -a sonde",
  "sonde --version",
  "sonde doctor",
] as const;
