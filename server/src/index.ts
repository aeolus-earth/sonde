import "dotenv/config";
import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { createNodeWebSocket } from "@hono/node-ws";
import { handleWebSocket } from "./ws-handler.js";
import { probeSondeCliEnvironment } from "./sonde-runner.js";

const app = new Hono();
const { injectWebSocket, upgradeWebSocket } = createNodeWebSocket({ app });

app.use(
  "/chat",
  cors({
    origin: [
      "http://localhost:5173",
      "http://127.0.0.1:5173",
      "http://localhost:4173",
      "http://127.0.0.1:4173",
    ],
    credentials: true,
  })
);

app.get("/health", (c) => c.json({ status: "ok" }));

app.get("/chat", upgradeWebSocket((c) => handleWebSocket(c)));

const port = Number(process.env.SONDE_SERVER_PORT ?? 3001);

await probeSondeCliEnvironment();

const server = serve({ fetch: app.fetch, port }, (info) => {
  console.log(`Sonde agent server listening on http://localhost:${info.port}`);
});

injectWebSocket(server);

// Daytona sandbox lifecycle management
import { isSandboxMode } from "./agent.js";
if (isSandboxMode()) {
  // Clean up orphaned sandboxes from previous server runs on startup
  import("./sandbox/daytona-client.js").then(({ cleanupStaleSandboxes }) =>
    cleanupStaleSandboxes().catch((err) =>
      console.error("[sandbox] Startup cleanup failed:", err.message)
    )
  );

  // Clean up all sandboxes on graceful shutdown (Ctrl+C, SIGTERM, etc.)
  const shutdownCleanup = () => {
    console.log("[sandbox] Server shutting down, cleaning up sandboxes...");
    import("./sandbox/daytona-client.js").then(({ cleanupStaleSandboxes }) =>
      cleanupStaleSandboxes()
        .catch(() => {})
        .finally(() => process.exit(0))
    );
    // Force exit after 10s if cleanup hangs
    setTimeout(() => process.exit(1), 10_000);
  };
  process.on("SIGINT", shutdownCleanup);
  process.on("SIGTERM", shutdownCleanup);
}
