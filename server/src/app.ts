import { Hono } from "hono";
import { cors } from "hono/cors";
import type { Context, Next } from "hono";
import { registerGitHubRoutes } from "./github.js";
import { handleWebSocket } from "./ws-handler.js";
import { getRuntimeMetadata } from "./runtime-metadata.js";
import { requireRuntimeAuditAuth } from "./runtime-audit.js";
import { verifyToken, type VerifiedUser } from "./auth.js";
import { issueWsSessionToken, verifyWsSessionToken } from "./ws-session-token.js";
import { checkUserRateLimit } from "./request-guard.js";
import { handleSondeMcpRequest } from "./mcp/http-server.js";
import { getAgentBackend } from "./runtime-mode.js";
import { reconcileManagedCostBuckets } from "./managed/cost-reconcile.js";
import {
  fetchManagedCostSummary,
  fetchManagedSessionDetail,
  fetchManagedSessions,
} from "./admin-managed-costs.js";
import { constantTimeSecretEquals, getInternalAdminToken } from "./security-config.js";

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

function parseIntegerQuery(
  c: Context,
  name: string,
  fallback: number,
): number {
  const raw = c.req.query(name)?.trim() ?? "";
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function errorResponse(
  c: Context,
  status: 401 | 403 | 404 | 500 | 503,
  type: string,
  message: string,
): Response {
  return c.json(
    {
      error: {
        type,
        message,
      },
    },
    status,
  );
}

async function requireVerifiedUser(c: Context): Promise<VerifiedUser | Response> {
  const accessToken = getBearerToken(c);
  if (!accessToken) {
    return errorResponse(c, 401, "unauthorized", "Missing or invalid Sonde session token");
  }

  const user = await verifyToken(accessToken);
  if (!user) {
    return errorResponse(c, 401, "unauthorized", "Missing or invalid Sonde session token");
  }

  return user;
}

async function requireAdminUser(
  c: Context,
): Promise<{ accessToken: string; user: VerifiedUser } | Response> {
  const accessToken = getBearerToken(c);
  if (!accessToken) {
    return errorResponse(c, 401, "unauthorized", "Missing or invalid Sonde session token");
  }

  const user = await verifyToken(accessToken);
  if (!user) {
    return errorResponse(c, 401, "unauthorized", "Missing or invalid Sonde session token");
  }
  if (!user.isAdmin) {
    return errorResponse(c, 403, "forbidden", "Admin access required");
  }

  return { accessToken, user };
}

function requireInternalAdminToken(c: Context): Response | null {
  const expected = getInternalAdminToken();
  if (!expected) {
    return errorResponse(
      c,
      503,
      "internal_admin_unavailable",
      "Internal managed-cost reconcile token is not configured.",
    );
  }

  const provided = getBearerToken(c);
  if (!constantTimeSecretEquals(expected, provided)) {
    return errorResponse(c, 401, "unauthorized", "Missing or invalid internal admin token.");
  }

  return null;
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
    const admin = await requireAdminUser(c);
    if (admin instanceof Response) {
      return admin;
    }

    return c.json(getRuntimeMetadata());
  });

  app.get("/admin/managed-costs/summary", async (c) => {
    const admin = await requireAdminUser(c);
    if (admin instanceof Response) {
      return admin;
    }

    try {
      const environment = c.req.query("environment")?.trim() || "all";
      const days = Math.min(Math.max(parseIntegerQuery(c, "days", 7), 1), 365);
      const summary = await fetchManagedCostSummary({
        accessToken: admin.accessToken,
        environment,
        selectedWindowDays: days,
      });
      return c.json(summary);
    } catch (error) {
      return errorResponse(
        c,
        500,
        "managed_cost_summary_failed",
        error instanceof Error ? error.message : "Failed to load managed cost summary.",
      );
    }
  });

  app.get("/admin/managed-sessions", async (c) => {
    const admin = await requireAdminUser(c);
    if (admin instanceof Response) {
      return admin;
    }

    try {
      const environment = c.req.query("environment")?.trim() || "all";
      const days = Math.min(Math.max(parseIntegerQuery(c, "days", 30), 1), 365);
      const status = c.req.query("status")?.trim() || "";
      const user = c.req.query("user")?.trim() || "";
      const limit = parseIntegerQuery(c, "limit", 100);
      const offset = parseIntegerQuery(c, "offset", 0);
      const sessions = await fetchManagedSessions({
        accessToken: admin.accessToken,
        environment,
        days,
        status,
        user,
        limit,
        offset,
      });
      return c.json(sessions);
    } catch (error) {
      return errorResponse(
        c,
        500,
        "managed_sessions_failed",
        error instanceof Error ? error.message : "Failed to load managed sessions.",
      );
    }
  });

  app.get("/admin/managed-sessions/:sessionId", async (c) => {
    const admin = await requireAdminUser(c);
    if (admin instanceof Response) {
      return admin;
    }

    try {
      const sessionId = c.req.param("sessionId")?.trim() ?? "";
      if (!sessionId) {
        return errorResponse(c, 404, "managed_session_missing", "Missing managed session id.");
      }
      const detail = await fetchManagedSessionDetail({
        accessToken: admin.accessToken,
        sessionId,
      });
      if (!detail) {
        return errorResponse(c, 404, "managed_session_missing", "Managed session not found.");
      }
      return c.json(detail);
    } catch (error) {
      return errorResponse(
        c,
        500,
        "managed_session_detail_failed",
        error instanceof Error ? error.message : "Failed to load managed session detail.",
      );
    }
  });

  app.post("/admin/managed-costs/reconcile", async (c) => {
    const admin = await requireAdminUser(c);
    if (admin instanceof Response) {
      return admin;
    }

    try {
      const body = await c.req.json().catch(() => ({}));
      const days = typeof body?.days === "number" ? body.days : undefined;
      const result = await reconcileManagedCostBuckets({
        requestedBy: admin.user.id,
        accessToken: admin.accessToken,
        days,
      });
      return c.json(result);
    } catch (error) {
      return errorResponse(
        c,
        500,
        "managed_cost_reconcile_failed",
        error instanceof Error ? error.message : "Failed to reconcile managed costs.",
      );
    }
  });

  app.post("/internal/managed-costs/reconcile", async (c) => {
    const authError = requireInternalAdminToken(c);
    if (authError) {
      return authError;
    }

    try {
      const body = await c.req.json().catch(() => ({}));
      const days = typeof body?.days === "number" ? body.days : undefined;
      const result = await reconcileManagedCostBuckets({
        requestedBy: null,
        days,
      });
      return c.json(result);
    } catch (error) {
      return errorResponse(
        c,
        500,
        "managed_cost_reconcile_failed",
        error instanceof Error ? error.message : "Failed to reconcile managed costs.",
      );
    }
  });

  app.all("/mcp/sonde", async (c) => {
    const accessToken = getBearerToken(c);
    const user = await requireVerifiedUser(c);
    if (user instanceof Response) {
      return user;
    }

    return handleSondeMcpRequest(c.req.raw, accessToken);
  });

  app.post("/chat/session-token", async (c) => {
    const accessToken = getBearerToken(c);
    const user = await requireVerifiedUser(c);
    if (user instanceof Response) {
      return user;
    }

    return c.json({
      token: issueWsSessionToken(accessToken, user),
      expires_at: new Date(Date.now() + 60_000).toISOString(),
    });
  });

  app.post("/chat/prewarm", async (c) => {
    const accessToken = getBearerToken(c);
    const user = await requireVerifiedUser(c);
    if (user instanceof Response) {
      return user;
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
