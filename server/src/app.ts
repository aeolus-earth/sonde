import { Hono } from "hono";
import { cors } from "hono/cors";
import type { Context, Next } from "hono";
import { registerGitHubRoutes } from "./github.js";
import { handleWebSocket } from "./ws-handler.js";
import { getRuntimeMetadata } from "./runtime-metadata.js";
import { requireRuntimeAuditAuth } from "./runtime-audit.js";
import { verifyToken } from "./auth.js";
import { issueWsSessionToken, verifyWsSessionToken } from "./ws-session-token.js";
import { checkUserRateLimit } from "./request-guard.js";
import { handleSondeMcpRequest } from "./mcp/http-server.js";
import { getAgentBackend } from "./runtime-mode.js";
import { reconcileManagedCostBuckets } from "./managed/cost-reconcile.js";

const LOCAL_UI_ORIGINS = [
  "http://localhost:5173",
  "http://127.0.0.1:5173",
  "http://localhost:4173",
  "http://127.0.0.1:4173",
  "http://localhost:4174",
  "http://127.0.0.1:4174",
];

function normalizeOrigin(origin: string): string {
  return origin.trim().replace(/\/+$/, "");
}

function getClientAddress(c: Context): string {
  const forwarded = c.req.header("x-forwarded-for") ?? "";
  const firstForwarded = forwarded
    .split(",")
    .map((value) => value.trim())
    .find(Boolean);
  return (
    firstForwarded ||
    c.req.header("cf-connecting-ip")?.trim() ||
    c.req.header("x-real-ip")?.trim() ||
    "unknown"
  );
}

function getBearerToken(c: Context): string {
  const authHeader = c.req.header("Authorization") ?? "";
  return authHeader.startsWith("Bearer ")
    ? authHeader.slice("Bearer ".length).trim()
    : "";
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

  const chatCors = cors({
    origin: allowedOrigins,
    credentials: true,
  });
  app.use("/chat", chatCors);
  app.use("/chat/*", chatCors);
  app.use("/mcp/*", chatCors);

  app.use(
    "/github/*",
    cors({
      origin: allowedOrigins,
      credentials: true,
    })
  );

  app.use("/health/runtime", requireRuntimeAuditAuth);

  app.use("/chat", async (c: Context, next: Next) => {
    if (c.req.method !== "GET") {
      await next();
      return;
    }
    const upgradeHeader = c.req.header("upgrade")?.toLowerCase();
    if (upgradeHeader !== "websocket") {
      await next();
      return;
    }

    const ipRateLimit = await checkUserRateLimit(
      "chat-upgrade-ip",
      getClientAddress(c),
      30,
      60_000,
    );
    if (!ipRateLimit.allowed) {
      return c.json(
        {
          error: {
            type: "rate_limited",
            message: "Too many chat connection attempts. Please retry shortly.",
          },
        },
        429,
      );
    }

    const wsToken = c.req.query("ws_token")?.trim() ?? "";
    if (wsToken) {
      const verified = verifyWsSessionToken(wsToken);
      if (!verified) {
        return c.json(
          {
            error: {
              type: "unauthorized",
              message: "Missing or invalid chat session token",
            },
          },
          401,
        );
      }
      c.set("sondeVerifiedUser", verified.user);
      c.set("sondeAccessToken", verified.accessToken);
      await next();
      return;
    }

    if ((process.env.SONDE_CHAT_ALLOW_FRAME_AUTH ?? "0").trim() === "1") {
      await next();
      return;
    }

    return c.json(
      {
        error: {
          type: "unauthorized",
          message: "Chat session token is required before opening the socket",
        },
      },
      401,
    );
  });

  app.get("/health", (c) => c.json({ status: "ok" }));
  app.get("/health/runtime", (c) => c.json(getRuntimeMetadata()));

  app.get("/admin/runtime", async (c) => {
    const accessToken = getBearerToken(c);
    if (!accessToken) {
      return c.json(
        {
          error: {
            type: "unauthorized",
            message: "Missing or invalid Sonde session token",
          },
        },
        401,
      );
    }

    const user = await verifyToken(accessToken);
    if (!user?.isAdmin) {
      return c.json(
        {
          error: {
            type: "forbidden",
            message: "Admin access required",
          },
        },
        403,
      );
    }

    return c.json(getRuntimeMetadata());
  });

  app.post("/admin/managed-costs/reconcile", async (c) => {
    const accessToken = getBearerToken(c);
    if (!accessToken) {
      return c.json(
        {
          error: {
            type: "unauthorized",
            message: "Missing or invalid Sonde session token",
          },
        },
        401,
      );
    }

    const user = await verifyToken(accessToken);
    if (!user?.isAdmin) {
      return c.json(
        {
          error: {
            type: "forbidden",
            message: "Admin access required",
          },
        },
        403,
      );
    }

    const body = await c.req.json().catch(() => ({}));
    const days = typeof body?.days === "number" ? body.days : undefined;
    const result = await reconcileManagedCostBuckets({
      user,
      accessToken,
      days,
    });
    return c.json(result);
  });

  app.all("/mcp/sonde", async (c) => {
    const accessToken = getBearerToken(c);
    if (!accessToken) {
      return c.json(
        {
          error: {
            type: "unauthorized",
            message: "Missing or invalid Sonde session token",
          },
        },
        401,
      );
    }

    const user = await verifyToken(accessToken);
    if (!user) {
      return c.json(
        {
          error: {
            type: "unauthorized",
            message: "Missing or invalid Sonde session token",
          },
        },
        401,
      );
    }

    return handleSondeMcpRequest(c.req.raw, accessToken);
  });

  app.post("/chat/session-token", async (c) => {
    const accessToken = getBearerToken(c);
    if (!accessToken) {
      return c.json(
        {
          error: {
            type: "unauthorized",
            message: "Missing or invalid Sonde session token",
          },
        },
        401,
      );
    }

    const user = await verifyToken(accessToken);
    if (!user) {
      return c.json(
        {
          error: {
            type: "unauthorized",
            message: "Missing or invalid Sonde session token",
          },
        },
        401,
      );
    }

    return c.json({
      token: issueWsSessionToken(accessToken, user),
      expires_at: new Date(Date.now() + 60_000).toISOString(),
    });
  });

  app.post("/chat/prewarm", async (c) => {
    const accessToken = getBearerToken(c);
    if (!accessToken) {
      return c.json(
        {
          error: {
            type: "unauthorized",
            message: "Missing or invalid Sonde session token",
          },
        },
        401,
      );
    }

    const user = await verifyToken(accessToken);
    if (!user) {
      return c.json(
        {
          error: {
            type: "unauthorized",
            message: "Missing or invalid Sonde session token",
          },
        },
        401,
      );
    }

    const startedAt = Date.now();
    const { prewarmManagedSession } = await import("./managed/session-cache.js");
    const result = await prewarmManagedSession({
      user,
      sondeToken: accessToken,
    });
    return c.json({
      status: "ready",
      backend: getAgentBackend(),
      reused: result.reused,
      duration_ms: Date.now() - startedAt,
      session_id: result.sessionId,
    });
  });

  registerGitHubRoutes(app);
  return app;
}

export { handleWebSocket };
