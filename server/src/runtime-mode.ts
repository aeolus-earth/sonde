export type AgentBackend = "managed";

const LEGACY_BACKENDS = new Set(["sandbox", "direct", "auto"]);

export function getAgentBackend(env: NodeJS.ProcessEnv = process.env): AgentBackend {
  const configured = env.SONDE_AGENT_BACKEND?.trim().toLowerCase();
  if (configured && LEGACY_BACKENDS.has(configured)) {
    throw new Error(
      `Unsupported SONDE_AGENT_BACKEND=${configured}. Sonde chat now supports only Claude Managed Agents.`,
    );
  }
  if (configured && configured !== "managed") {
    throw new Error(
      `Unsupported SONDE_AGENT_BACKEND=${configured}. Expected "managed" or an empty value.`,
    );
  }
  return "managed";
}
