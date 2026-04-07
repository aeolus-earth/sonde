import "dotenv/config";
import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { createNodeWebSocket } from "@hono/node-ws";
import { handleWebSocket } from "./ws-handler.js";
import { probeSondeCliEnvironment } from "./sonde-runner.js";
import { registerGitHubRoutes } from "./github.js";

const app = new Hono();
const { injectWebSocket, upgradeWebSocket } = createNodeWebSocket({ app });
const uiOrigins = [
  "http://localhost:5173",
  "http://127.0.0.1:5173",
  "http://localhost:4173",
  "http://127.0.0.1:4173",
];

app.use(
  "/chat",
  cors({
    origin: uiOrigins,
    credentials: true,
  })
);

app.use(
  "/github/*",
  cors({
    origin: uiOrigins,
    credentials: true,
  })
);

app.get("/health", (c) => c.json({ status: "ok" }));

app.get("/chat", upgradeWebSocket((c) => handleWebSocket(c)));
registerGitHubRoutes(app);

const port = Number(process.env.SONDE_SERVER_PORT ?? 3001);

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
