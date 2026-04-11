function errorStack(error: Error): string {
  return typeof error.stack === "string" ? error.stack : "";
}

export function isIgnorableAnthropicAbortError(reason: unknown): boolean {
  if (!(reason instanceof Error)) return false;
  const message = reason.message.trim();
  const name = reason.name.trim();
  const stack = errorStack(reason);
  const fromAnthropicSdk =
    stack.includes("@anthropic-ai/claude-agent-sdk") || stack.includes("sdk.mjs");

  if (!fromAnthropicSdk) return false;
  if (name === "AbortError") return true;
  return (
    message === "Operation aborted" ||
    message === "Claude Code process aborted by user"
  );
}

let installed = false;

export function installAnthropicAbortGuard(): void {
  if (installed) return;
  installed = true;

  process.on("uncaughtException", (error) => {
    if (isIgnorableAnthropicAbortError(error)) {
      console.warn("[agent] Ignoring Claude SDK abort during teardown:", error.message);
      return;
    }
    console.error(error);
    process.exit(1);
  });

  process.on("unhandledRejection", (reason) => {
    if (isIgnorableAnthropicAbortError(reason)) {
      const message = reason instanceof Error ? reason.message : String(reason);
      console.warn("[agent] Ignoring Claude SDK abort during teardown:", message);
      return;
    }
    console.error(reason);
    process.exit(1);
  });
}
