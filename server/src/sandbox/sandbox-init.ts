/**
 * Sandbox bootstrap — create sandbox, install sonde, populate corpus.
 */

import { createSandbox, type SandboxHandle, type CreateSandboxOptions } from "./daytona-client.js";

export interface SandboxInitOptions extends CreateSandboxOptions {
  /** Skip corpus pull (for testing). */
  skipPull?: boolean;
}

/**
 * Create a sandbox ready for agent use: sonde CLI installed, corpus populated.
 */
export async function initSandbox(
  opts: SandboxInitOptions
): Promise<SandboxHandle> {
  const sandbox = await createSandbox(opts);

  // Install sonde CLI
  const installResult = await sandbox.exec(
    "pip install --quiet sonde 2>&1 || pip install --quiet sonde",
    { timeout: 120 }
  );
  if (installResult.exitCode !== 0) {
    console.error("[sandbox] Failed to install sonde CLI:", installResult.stdout);
  }

  // Pull corpus if program specified and not skipped
  if (opts.program && !opts.skipPull) {
    const pullResult = await sandbox.exec(
      `sonde pull -p ${opts.program} --artifacts none`,
      { timeout: 60 }
    );
    if (pullResult.exitCode !== 0) {
      console.error("[sandbox] sonde pull failed:", pullResult.stdout);
    }
  }

  return sandbox;
}
