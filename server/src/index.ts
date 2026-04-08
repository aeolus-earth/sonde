import "dotenv/config";
import { serve } from "@hono/node-server";
import { createNodeWebSocket } from "@hono/node-ws";
import { createApp, handleWebSocket } from "./app.js";
import { probeSondeCliEnvironment } from "./sonde-runner.js";

const app = createApp();
const { injectWebSocket, upgradeWebSocket } = createNodeWebSocket({ app });

app.get("/chat", upgradeWebSocket((c) => handleWebSocket(c)));

const configuredPort = process.env.PORT ?? process.env.SONDE_SERVER_PORT ?? "3001";
const port = Number.parseInt(configuredPort, 10);

if (!Number.isFinite(port) || port <= 0) {
  throw new Error(`Invalid server port: ${configuredPort}`);
}

await probeSondeCliEnvironment();

const server = serve({ fetch: app.fetch, port }, (info) => {
  console.log(`Sonde agent server listening on http://localhost:${info.port}`);
});

injectWebSocket(server);

// Daytona sandbox lifecycle management
import { isSandboxMode } from "./agent.js";
if (isSandboxMode()) {
  // Clean up orphaned Daytona sandboxes on boot so a crashed server does not
  // strand quota indefinitely.
  import("./sandbox/daytona-client.js")
    .then(({ cleanupStaleSandboxes }) => cleanupStaleSandboxes())
    .catch((err) =>
      console.error("[sandbox] Startup failed:", err.message)
    );

  const cleanupInterval = setInterval(() => {
    import("./sandbox/user-sandbox-pool.js")
      .then(({ cleanupExpiredUserSandboxes }) => cleanupExpiredUserSandboxes())
      .catch(() => {});
  }, 5 * 60_000);

  // Clean up active user sandboxes + stale sandboxes on graceful shutdown
  const shutdownCleanup = () => {
    console.log("[sandbox] Server shutting down, cleaning up...");
    clearInterval(cleanupInterval);
    Promise.all([
      import("./sandbox/user-sandbox-pool.js").then(({ disposeUserSandboxes }) =>
        disposeUserSandboxes()
      ),
      import("./sandbox/daytona-client.js").then(({ cleanupStaleSandboxes }) =>
        cleanupStaleSandboxes()
      ),
    ])
      .catch(() => {})
      .finally(() => process.exit(0));
    setTimeout(() => process.exit(1), 10_000);
  };
  process.on("SIGINT", shutdownCleanup);
  process.on("SIGTERM", shutdownCleanup);
}
