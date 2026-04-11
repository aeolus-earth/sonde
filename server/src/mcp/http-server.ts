import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { z } from "zod";
import { createSondeToolDefinitions } from "./registry.js";

function createRemoteSondeMcpServer(sondeToken: string): McpServer {
  const server = new McpServer({
    name: "sonde",
    version: "0.1.0",
  });

  for (const definition of createSondeToolDefinitions(sondeToken)) {
    server.registerTool(
      definition.name,
      {
        description: definition.description,
        inputSchema: definition.inputSchema as Record<string, z.ZodType>,
      },
      async (args) => definition.handler(args as Record<string, unknown>)
    );
  }

  return server;
}

export async function handleSondeMcpRequest(
  request: Request,
  sondeToken: string
): Promise<Response> {
  const transport = new WebStandardStreamableHTTPServerTransport();
  const server = createRemoteSondeMcpServer(sondeToken);
  await server.connect(transport);
  return transport.handleRequest(request);
}
