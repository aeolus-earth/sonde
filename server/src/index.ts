import "dotenv/config";
import { serve } from "@hono/node-server";
import { createNodeWebSocket } from "@hono/node-ws";
import { createApp, handleWebSocket } from "./app.js";
import { probeSondeCliEnvironment } from "./sonde-runner.js";
import { assertSecurityConfig } from "./security-config.js";
import { installAnthropicAbortGuard } from "./anthropic-abort-guard.js";
import { getAgentBackend } from "./runtime-mode.js";
import { getCommitSha } from "./runtime-metadata.js";

const app = createApp();
const { injectWebSocket, upgradeWebSocket } = createNodeWebSocket({ app });

app.get("/chat", upgradeWebSocket((c) => handleWebSocket(c)));

const configuredPort = process.env.PORT ?? process.env.SONDE_SERVER_PORT ?? "3001";
const port = Number.parseInt(configuredPort, 10);

if (!Number.isFinite(port) || port <= 0) {
  throw new Error(`Invalid server port: ${configuredPort}`);
}

installAnthropicAbortGuard();
getAgentBackend();
assertSecurityConfig();
await probeSondeCliEnvironment();

const server = serve({ fetch: app.fetch, port }, (info) => {
  console.log(
    JSON.stringify({
      msg: "server.start",
      port: info.port,
      commitSha: getCommitSha(),
      ref:
        process.env.SONDE_ENVIRONMENT?.trim() ||
        process.env.RAILWAY_GIT_BRANCH?.trim() ||
        process.env.NODE_ENV?.trim() ||
        "development",
      startedAt: new Date().toISOString(),
    })
  );
});

injectWebSocket(server);
