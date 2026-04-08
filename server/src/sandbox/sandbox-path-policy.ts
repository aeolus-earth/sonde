import path from "node:path";

export const SANDBOX_HOME = "/home/daytona";
export const SANDBOX_CORPUS_ROOT = `${SANDBOX_HOME}/.sonde`;
export const SANDBOX_SESSION_ROOT = `${SANDBOX_HOME}/sessions`;

const SENSITIVE_EXACT_PATHS = new Set([
  `${SANDBOX_HOME}/.sonde_env`,
  `${SANDBOX_HOME}/.bashrc`,
  `${SANDBOX_HOME}/.bash_profile`,
  `${SANDBOX_HOME}/.profile`,
  `${SANDBOX_HOME}/.zshrc`,
]);

const SENSITIVE_SEGMENTS = new Set([".ssh"]);

function normalizeSandboxPath(value: string): string {
  const trimmed = value.trim();
  if (!trimmed.startsWith("/")) {
    return "";
  }
  return path.posix.normalize(trimmed);
}

function isWithinRoot(target: string, root: string): boolean {
  return target === root || target.startsWith(`${root}/`);
}

export function isSensitiveSandboxPath(rawPath: string): boolean {
  const normalized = normalizeSandboxPath(rawPath);
  if (!normalized) return true;
  if (SENSITIVE_EXACT_PATHS.has(normalized)) return true;
  if (isWithinRoot(normalized, "/proc") || isWithinRoot(normalized, "/etc")) {
    return true;
  }

  const parts = normalized.split("/").filter(Boolean);
  if (parts.some((segment) => SENSITIVE_SEGMENTS.has(segment))) {
    return true;
  }
  if (parts.some((segment) => segment.startsWith(".env"))) {
    return true;
  }
  return false;
}

export function isAllowedSandboxReadPath(
  rawPath: string,
  sessionDir?: string,
): boolean {
  const normalized = normalizeSandboxPath(rawPath);
  if (!normalized || isSensitiveSandboxPath(normalized)) return false;
  if (isWithinRoot(normalized, SANDBOX_CORPUS_ROOT)) return true;
  if (sessionDir) {
    const normalizedSessionDir = normalizeSandboxPath(sessionDir);
    return Boolean(
      normalizedSessionDir && isWithinRoot(normalized, normalizedSessionDir),
    );
  }
  return false;
}

export function isAllowedSandboxWritePath(
  rawPath: string,
  sessionDir?: string,
): boolean {
  const normalized = normalizeSandboxPath(rawPath);
  if (!normalized || isSensitiveSandboxPath(normalized) || !sessionDir) {
    return false;
  }
  const normalizedSessionDir = normalizeSandboxPath(sessionDir);
  return Boolean(
    normalizedSessionDir && isWithinRoot(normalized, normalizedSessionDir),
  );
}

export function readPathError(
  rawPath: string,
  sessionDir?: string,
): string | null {
  const normalized = normalizeSandboxPath(rawPath);
  if (!normalized) {
    return "Only absolute sandbox paths are allowed.";
  }
  if (isSensitiveSandboxPath(normalized)) {
    return `Reading ${normalized} is not allowed inside the sandbox.`;
  }
  if (isAllowedSandboxReadPath(normalized, sessionDir)) {
    return null;
  }
  return `Read access is limited to ${SANDBOX_CORPUS_ROOT} and the current session workspace.`;
}

export function writePathError(
  rawPath: string,
  sessionDir?: string,
): string | null {
  const normalized = normalizeSandboxPath(rawPath);
  if (!normalized) {
    return "Only absolute sandbox paths are allowed.";
  }
  if (isSensitiveSandboxPath(normalized)) {
    return `Writing ${normalized} is not allowed inside the sandbox.`;
  }
  if (isAllowedSandboxWritePath(normalized, sessionDir)) {
    return null;
  }
  return "Write access is limited to the current session workspace.";
}
