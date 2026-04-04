/**
 * MCP server factory for sandbox mode.
 *
 * Replaces sonde-server.ts when the agent backend is set to "sandbox".
 * Uses 4 general sandbox tools instead of 40+ sonde-specific tools.
 */

import { createSdkMcpServer } from "@anthropic-ai/claude-agent-sdk";
import { createSandboxTools } from "./sandbox-tools.js";
import { createTaskTools } from "../mcp/tools/tasks.js";
import type { SandboxHandle } from "./daytona-client.js";

export function createSandboxMcpServer(sandbox: SandboxHandle) {
  return createSdkMcpServer({
    name: "sonde-sandbox",
    version: "0.1.0",
    tools: [...createSandboxTools(sandbox), ...createTaskTools()],
  });
}
