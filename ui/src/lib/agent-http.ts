export function resolveAgentHttpBase(
  explicitWsBase: string | undefined,
  windowOrigin: string | undefined
): string {
  const explicit = explicitWsBase?.trim();
  if (explicit) {
    return explicit.replace(/^ws/i, "http").replace(/\/$/, "");
  }
  if (windowOrigin) {
    return `${windowOrigin.replace(/\/$/, "")}/agent`;
  }
  return "http://localhost:3001";
}

export function getAgentHttpBase(): string {
  const windowOrigin =
    typeof window !== "undefined" ? window.location.origin : undefined;
  return resolveAgentHttpBase(import.meta.env.VITE_AGENT_WS_URL, windowOrigin);
}
