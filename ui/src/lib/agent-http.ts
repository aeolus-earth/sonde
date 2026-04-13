const LOCAL_HOSTNAMES = new Set(["localhost", "127.0.0.1", "::1"]);

export class HostedAgentConfigError extends Error {
  constructor(message = "Hosted Sonde UI is missing VITE_AGENT_WS_URL.") {
    super(message);
    this.name = "HostedAgentConfigError";
  }
}

function normalizeWsBase(value: string): string {
  return value.trim().replace(/^http/i, "ws").replace(/\/$/, "");
}

function isLocalBrowserOrigin(windowOrigin: string | undefined): boolean {
  if (!windowOrigin) return false;
  try {
    return LOCAL_HOSTNAMES.has(new URL(windowOrigin).hostname);
  } catch {
    return false;
  }
}

export function resolveAgentWsBase(
  explicitWsBase: string | undefined,
  windowOrigin: string | undefined
): string {
  const explicit = explicitWsBase?.trim();
  if (explicit) {
    return normalizeWsBase(explicit);
  }

  if (windowOrigin && isLocalBrowserOrigin(windowOrigin)) {
    const url = new URL(windowOrigin);
    url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
    url.pathname = `${url.pathname.replace(/\/$/, "")}/agent`;
    return url.toString().replace(/\/$/, "");
  }

  if (windowOrigin) {
    throw new HostedAgentConfigError(
      "Hosted Sonde UI is missing VITE_AGENT_WS_URL. Set it to the deployed agent WebSocket base for this environment."
    );
  }

  return "ws://localhost:3001";
}

export function resolveAgentHttpBase(
  explicitWsBase: string | undefined,
  windowOrigin: string | undefined
): string {
  return resolveAgentWsBase(explicitWsBase, windowOrigin)
    .replace(/^ws/i, "http")
    .replace(/\/$/, "");
}

export function getAgentWsBase(): string {
  const windowOrigin =
    typeof window !== "undefined" ? window.location.origin : undefined;
  return resolveAgentWsBase(import.meta.env.VITE_AGENT_WS_URL, windowOrigin);
}

export function getAgentHttpBase(): string {
  const windowOrigin =
    typeof window !== "undefined" ? window.location.origin : undefined;
  return resolveAgentHttpBase(import.meta.env.VITE_AGENT_WS_URL, windowOrigin);
}
