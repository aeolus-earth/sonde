/**
 * Isolated test: does session.query() hang on the sandbox MCP server?
 * No WebSocket, no UI — just Agent SDK + sandbox.
 *
 * Uses the server's existing shared sandbox (must be running).
 */

import "dotenv/config";
import { query } from "@anthropic-ai/claude-agent-sdk";
import { createSdkMcpServer } from "@anthropic-ai/claude-agent-sdk";
import { tool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";

// Minimal sandbox MCP server — just one tool, no Daytona dependency
function createTestSandboxServer() {
  return createSdkMcpServer({
    name: "sonde-sandbox",
    version: "0.1.0",
    tools: [
      tool(
        "sandbox_exec",
        "Run a shell command",
        { command: z.string().describe("Command to run") },
        async (args) => {
          return {
            content: [
              { type: "text" as const, text: `Would run: ${args.command}` },
            ],
          };
        }
      ),
    ],
  });
}

// For comparison — same structure but named "sonde"
function createTestSondeServer() {
  return createSdkMcpServer({
    name: "sonde",
    version: "0.1.0",
    tools: [
      tool(
        "sonde_brief",
        "Get research brief",
        { program: z.string().describe("Program name") },
        async (args) => {
          return {
            content: [
              { type: "text" as const, text: `Brief for: ${args.program}` },
            ],
          };
        }
      ),
    ],
  });
}

async function testQuery(name: string, server: ReturnType<typeof createSdkMcpServer>) {
  console.log(`\n--- Testing "${name}" MCP server ---`);
  const t0 = Date.now();
  let eventCount = 0;

  const timeout = setTimeout(() => {
    console.log(`  HUNG after 15s. Events: ${eventCount}`);
    process.exit(1);
  }, 15_000);

  const q = query({
    prompt: "Say hello briefly.",
    options: {
      model: "claude-sonnet-4-6",
      systemPrompt: "Respond in one sentence.",
      mcpServers: { [name]: server },
      permissionMode: "default",
      canUseTool: async (_n: string, input: unknown) => ({
        behavior: "allow" as const,
        updatedInput: input,
      }),
      maxTurns: 1,
    },
  });

  for await (const rawMsg of q) {
    const msg = rawMsg as Record<string, unknown>;
    eventCount++;
    const type = msg.type as string;
    const sub = (msg.subtype as string) ?? "";
    if (eventCount <= 3) console.log(`  event ${eventCount}: ${type} ${sub}`);
    if (type === "result") break;
  }

  clearTimeout(timeout);
  console.log(`  OK: ${eventCount} events in ${Date.now() - t0}ms`);
}

async function main() {
  // Test 1: server named "sonde" (like MCP mode)
  await testQuery("sonde", createTestSondeServer());

  // Test 2: server named "sonde-sandbox"
  await testQuery("sonde-sandbox", createTestSandboxServer());

  // Test 3: second call on "sonde-sandbox" (to see if second works)
  await testQuery("sonde-sandbox", createTestSandboxServer());

  console.log("\nAll tests passed!");
  process.exit(0);
}

main().catch((e) => {
  console.error("ERROR:", e.message);
  process.exit(1);
});
