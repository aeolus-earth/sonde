/**
 * Sandbox bootstrap — create sandbox, install sonde CLI.
 *
 * Corpus pull happens lazily on first message (when we know the program).
 */

import {
  createSandbox,
  type SandboxHandle,
  type CreateSandboxOptions,
} from "./daytona-client.js";

export type SandboxInitOptions = CreateSandboxOptions;

/** Prefix for commands that need pip-installed scripts on PATH. */
const PATH_PREFIX = 'export PATH="$HOME/.local/bin:$PATH" && ';

export function resolveSondeCliGitRef(
  env: NodeJS.ProcessEnv = process.env
): string | null {
  const explicit = env.SONDE_CLI_GIT_REF?.trim();
  if (explicit) return explicit;

  const commitSha = env.SONDE_COMMIT_SHA?.trim();
  return commitSha || null;
}

export function buildSondeCliInstallSpec(ref: string | null): string {
  const base = "git+https://github.com/aeolus-earth/sonde.git";
  const refSuffix = ref ? `@${ref}` : "";
  return `sonde @ ${base}${refSuffix}#subdirectory=cli`;
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\"'\"'`)}'`;
}

/**
 * Create a sandbox with sonde CLI installed and ready.
 * Does NOT pull the corpus — call `sandboxHandle.pullCorpus(program)` later.
 */
export async function initSandbox(
  opts: SandboxInitOptions
): Promise<SandboxHandle> {
  console.log("[sandbox] Creating Daytona sandbox...");
  const sandbox = await createSandbox(opts);
  console.log("[sandbox] Sandbox created");

  const gitRef = resolveSondeCliGitRef();
  const installSpec = buildSondeCliInstallSpec(gitRef);

  console.log(
    gitRef
      ? `[sandbox] Installing sonde CLI from ${gitRef}...`
      : "[sandbox] Installing sonde CLI from default branch..."
  );
  const installResult = await sandbox.exec(
    `pip install --quiet ${shellQuote(installSpec)} 2>&1`,
    { timeout: 120 }
  );
  if (installResult.exitCode !== 0) {
    console.error(
      "[sandbox] Failed to install sonde CLI:",
      installResult.stdout
    );
    throw new Error("Sonde CLI installation failed in sandbox");
  }

  // Add ~/.local/bin to PATH permanently
  await sandbox.exec(
    'echo \'export PATH="$HOME/.local/bin:$PATH"\' >> ~/.bashrc && ' +
      'echo \'export PATH="$HOME/.local/bin:$PATH"\' >> ~/.zshrc',
    { timeout: 5 }
  );

  // Verify sonde is working
  const verifyResult = await sandbox.exec(
    `${PATH_PREFIX}sonde --version 2>&1`
  );
  if (verifyResult.exitCode !== 0) {
    console.error("[sandbox] sonde CLI not available:", verifyResult.stdout);
    throw new Error("Sonde CLI not available after installation");
  }
  console.log("[sandbox] sonde CLI ready:", verifyResult.stdout.trim());

  return sandbox;
}
