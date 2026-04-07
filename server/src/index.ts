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
  // Clean up orphaned sandboxes, then pre-warm the shared sandbox
  // so it's ready before anyone connects (no blocking in onOpen)
  import("./sandbox/daytona-client.js")
    .then(({ cleanupStaleSandboxes }) => cleanupStaleSandboxes())
    .then(() => import("./sandbox/shared-sandbox.js"))
    .then(({ getSharedSandbox }) => {
      const token = "startup-prewarm"; // Dummy — real token passed per-session
      return getSharedSandbox(
        token,
        process.env.VITE_SUPABASE_URL,
        process.env.VITE_SUPABASE_ANON_KEY
      );
    })
    .then((sb) => {
      if (sb) console.log("[sandbox] Pre-warmed and ready for connections");
      else console.error("[sandbox] Pre-warm returned null");
    })
    .catch((err) =>
      console.error("[sandbox] Startup failed:", err.message)
    );

  // Clean up shared sandbox + stale sandboxes on graceful shutdown
  const shutdownCleanup = () => {
    console.log("[sandbox] Server shutting down, cleaning up...");
    Promise.all([
      import("./sandbox/shared-sandbox.js").then(({ disposeSharedSandbox }) =>
        disposeSharedSandbox()
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
