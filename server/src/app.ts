import { Hono } from "hono";
import { cors } from "hono/cors";
import { registerGitHubRoutes } from "./github.js";
import { handleWebSocket } from "./ws-handler.js";

const LOCAL_UI_ORIGINS = [
  "http://localhost:5173",
  "http://127.0.0.1:5173",
  "http://localhost:4173",
  "http://127.0.0.1:4173",
];

function normalizeOrigin(origin: string): string {
  return origin.trim().replace(/\/+$/, "");
}

export function getAllowedOrigins(
  env: NodeJS.ProcessEnv = process.env
): string[] {
  const configured = (env.SONDE_ALLOWED_ORIGINS ?? "")
    .split(",")
    .map(normalizeOrigin)
    .filter(Boolean);

  return [...new Set([...LOCAL_UI_ORIGINS, ...configured])];
}

export function createApp(): Hono {
  const app = new Hono();
  const allowedOrigins = getAllowedOrigins();

  app.use(
    "/chat",
    cors({
      origin: allowedOrigins,
      credentials: true,
    })
  );

  app.use(
    "/github/*",
    cors({
      origin: allowedOrigins,
      credentials: true,
    })
  );

  app.get("/health", (c) =>
    c.json({
      status: "ok",
      environment: process.env.NODE_ENV ?? "development",
      commitSha: process.env.SONDE_COMMIT_SHA ?? null,
    })
  );

  registerGitHubRoutes(app);
  return app;
}

export { handleWebSocket };
