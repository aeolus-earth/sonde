/**
 * Shared singleton sandbox — one per server instance, reused across all
 * WebSocket connections. Avoids creating/destroying sandboxes per chat session.
 *
 * The sandbox is initialized lazily on first use and kept alive for the
 * duration of the server process.
 */

import type { SandboxHandle } from "./daytona-client.js";

let sharedSandbox: SandboxHandle | null = null;
let initPromise: Promise<SandboxHandle | null> | null = null;

/**
 * Get or create the shared sandbox. First call triggers init (~15s),
 * subsequent calls return the cached instance immediately.
 */
export function getSharedSandbox(
  sondeToken: string,
  supabaseUrl?: string,
  supabaseKey?: string
): Promise<SandboxHandle | null> {
  if (sharedSandbox?.ready) return Promise.resolve(sharedSandbox);

  if (!initPromise) {
    initPromise = (async () => {
      try {
        const { initSandbox } = await import("./sandbox-init.js");
        sharedSandbox = await initSandbox({
          sondeToken,
          supabaseUrl,
          supabaseKey,
        });
        console.log("[sandbox] Shared sandbox ready");
        return sharedSandbox;
      } catch (err) {
        const msg = err instanceof Error ? err.message : "init failed";
        console.error("[sandbox] Shared sandbox init failed:", msg);
        initPromise = null; // Allow retry on next request
        return null;
      }
    })();
  }

  return initPromise;
}

/** Dispose the shared sandbox (called on server shutdown). */
export async function disposeSharedSandbox(): Promise<void> {
  if (sharedSandbox) {
    console.log("[sandbox] Disposing shared sandbox");
    await sharedSandbox.dispose().catch(() => {});
    sharedSandbox = null;
    initPromise = null;
  }
}
