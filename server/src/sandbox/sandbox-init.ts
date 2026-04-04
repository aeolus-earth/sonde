/**
 * Sandbox bootstrap — create sandbox, install sonde, populate corpus.
 */

import {
  createSandbox,
  type SandboxHandle,
  type CreateSandboxOptions,
} from "./daytona-client.js";

export interface SandboxInitOptions extends CreateSandboxOptions {
  /** Skip corpus pull (for testing). */
  skipPull?: boolean;
}

/** Prefix all sandbox commands with PATH fix for pip-installed scripts. */
const PATH_PREFIX = 'export PATH="$HOME/.local/bin:$PATH" && ';

/**
 * Create a sandbox ready for agent use: sonde CLI installed, corpus populated.
 */
export async function initSandbox(
  opts: SandboxInitOptions
): Promise<SandboxHandle> {
  const sandbox = await createSandbox(opts);

  // Install sonde CLI from GitHub (public repo)
  const installResult = await sandbox.exec(
    'pip install --quiet "sonde @ git+https://github.com/aeolus-earth/sonde.git#subdirectory=cli" 2>&1',
    { timeout: 120 }
  );
  if (installResult.exitCode !== 0) {
    console.error(
      "[sandbox] Failed to install sonde CLI:",
      installResult.stdout
    );
  }

  // Add ~/.local/bin to PATH permanently so sonde is always available
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
  } else {
    console.log("[sandbox] sonde CLI ready:", verifyResult.stdout.trim());
  }

  // Pull corpus if program specified and not skipped
  if (opts.program && !opts.skipPull) {
    console.log(`[sandbox] Pulling corpus for ${opts.program}...`);
    const pullResult = await sandbox.exec(
      `${PATH_PREFIX}sonde pull -p ${opts.program} --artifacts none`,
      { timeout: 60 }
    );
    if (pullResult.exitCode !== 0) {
      console.error("[sandbox] sonde pull failed:", pullResult.stdout);
    } else {
      console.log("[sandbox] Corpus populated");
    }
  }

  return sandbox;
}
