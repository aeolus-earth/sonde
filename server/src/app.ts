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
import { isManagedConfigError } from "./managed/config.js";
import {
  approveDeviceAuth,
  getDeviceAuthRuntimeStatus,
  inspectDeviceAuth,
  pollDeviceAuth,
  startDeviceAuth,
} from "./device-auth.js";

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
  const adminCors = cors({
    origin: allowedOrigins,
    credentials: true,
  });
  app.use("/chat", chatCors);
  app.use("/chat/*", chatCors);
  app.use("/mcp/*", chatCors);
  app.use("/auth/device", chatCors);
  app.use("/auth/device/*", chatCors);
  app.use("/admin", adminCors);
  app.use("/admin/*", adminCors);

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

  // Public /health is liveness-only by contract — the deployed-stack audit
  // fails if this leaks any metadata. Commit SHA and environment live on
  // /health/runtime, which is gated by the runtime-audit token.
  app.get("/health", (c) => c.json({ status: "ok" }));
  app.get("/health/runtime", (c) => c.json(getRuntimeMetadata()));
  app.get("/auth/device/health", (c) => {
    const config = getDeviceAuthRuntimeStatus();
    return c.json({
      status: "ok",
      enabled: config.enabled,
    });
  });

  app.post("/auth/device/start", async (c) => {
    const ipRateLimit = await checkUserRateLimit(
      "device-auth-start-ip",
      getClientAddress(c),
      5,
      15 * 60_000,
    );
    if (!ipRateLimit.allowed) {
      return c.json(
        {
          error: {
            type: "rate_limited",
            message: "Too many device login attempts. Please retry shortly.",
          },
        },
        429,
      );
    }

    const config = getDeviceAuthRuntimeStatus();
    if (!config.enabled) {
      return c.json(
        {
          error: {
            type: "device_auth_unavailable",
            message: config.configError ?? "Device login is not configured.",
          },
        },
        503,
      );
    }

    let body: Record<string, unknown> = {};
    try {
      body = (await c.req.json()) as Record<string, unknown>;
    } catch {
      body = {};
    }

    try {
      const result = await startDeviceAuth({
        cliVersion: typeof body.cli_version === "string" ? body.cli_version : null,
        hostLabel: typeof body.host_label === "string" ? body.host_label : null,
        remoteHint: body.remote_hint === true,
        loginMethod: typeof body.login_method === "string" ? body.login_method : null,
        requestMetadata:
          body.request_metadata && typeof body.request_metadata === "object"
            ? (body.request_metadata as Record<string, unknown>)
            : undefined,
      });
      return c.json({
        device_code: result.deviceCode,
        user_code: result.userCode,
        verification_uri: result.verificationUri,
        verification_uri_complete: result.verificationUriComplete,
        expires_in: result.expiresIn,
        interval: result.interval,
      });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Failed to start device login.";
      return c.json(
        {
          error: {
            type: "device_auth_start_failed",
            message,
          },
        },
        500,
      );
    }
  });

  app.post("/auth/device/poll", async (c) => {
    const ipRateLimit = await checkUserRateLimit(
      "device-auth-poll-ip",
      getClientAddress(c),
      180,
      15 * 60_000,
    );
    if (!ipRateLimit.allowed) {
      return c.json(
        {
          status: "slow_down",
          interval: getDeviceAuthRuntimeStatus().pollIntervalSeconds,
        },
        200,
      );
    }

    let body: Record<string, unknown>;
    try {
      body = (await c.req.json()) as Record<string, unknown>;
    } catch {
      return c.json(
        {
          error: {
            type: "bad_request",
            message: "device_code is required.",
          },
        },
        400,
      );
    }

    const deviceCode =
      typeof body.device_code === "string" ? body.device_code.trim() : "";
    if (!deviceCode) {
      return c.json(
        {
          error: {
            type: "bad_request",
            message: "device_code is required.",
          },
        },
        400,
      );
    }

    try {
      const result = await pollDeviceAuth(deviceCode);
      if (result.status !== "approved") {
        return c.json({
          status: result.status,
          interval: result.interval,
        });
      }
      return c.json({
        status: "approved",
        interval: result.interval,
        session: result.session,
      });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Failed to poll device login.";
      return c.json(
        {
          error: {
            type: "device_auth_poll_failed",
            message,
          },
        },
        500,
      );
    }
  });

  app.post("/auth/device/introspect", async (c) => {
    const user = await requireVerifiedUser(c);
    if (user instanceof Response) {
      return user;
    }
    const userRateLimit = await checkUserRateLimit(
      "device-auth-introspect-user",
      user.id,
      60,
      5 * 60_000,
    );
    if (!userRateLimit.allowed) {
      return c.json(
        {
          error: {
            type: "rate_limited",
            message: "Too many activation checks. Please retry shortly.",
          },
        },
        429,
      );
    }

    let body: Record<string, unknown>;
    try {
      body = (await c.req.json()) as Record<string, unknown>;
    } catch {
      return c.json(
        {
          error: {
            type: "bad_request",
            message: "user_code is required.",
          },
        },
        400,
      );
    }

    const userCode = typeof body.user_code === "string" ? body.user_code : "";
    const details = await inspectDeviceAuth(userCode);
    if (!details) {
      return c.json(
        {
          error: {
            type: "not_found",
            message: "Activation code not found or already expired.",
          },
        },
        404,
      );
    }
    return c.json({
      status: details.status,
      host_label: details.hostLabel,
      cli_version: details.cliVersion,
      remote_hint: details.remoteHint,
      login_method: details.loginMethod,
      requested_at: details.requestedAt,
      expires_at: details.expiresAt,
    });
  });

  app.post("/auth/device/approve", async (c) => {
    const user = await requireVerifiedUser(c);
    if (user instanceof Response) {
      return user;
    }
    const userRateLimit = await checkUserRateLimit(
      "device-auth-approve-user",
      user.id,
      30,
      5 * 60_000,
    );
    if (!userRateLimit.allowed) {
      return c.json(
        {
          error: {
            type: "rate_limited",
            message: "Too many activation approvals. Please retry shortly.",
          },
        },
        429,
      );
    }

    let body: Record<string, unknown>;
    try {
      body = (await c.req.json()) as Record<string, unknown>;
    } catch {
      return c.json(
        {
          error: {
            type: "bad_request",
            message: "user_code is required.",
          },
        },
        400,
      );
    }

    const userCode = typeof body.user_code === "string" ? body.user_code : "";
    const decision =
      body.decision === "deny" ? "deny" : ("approve" as "approve" | "deny");

    try {
      const details = await approveDeviceAuth({
        userCode,
        decision,
        session:
          body.session && typeof body.session === "object"
            ? (body.session as {
                access_token: string;
                refresh_token: string;
                user: {
                  id: string;
                  email?: string | null;
                  app_metadata?: Record<string, unknown>;
                  user_metadata?: Record<string, unknown>;
                };
              })
            : undefined,
        approvedBy: user,
      });
      if (!details) {
        return c.json(
          {
            error: {
              type: "not_found",
              message: "Activation code not found or already expired.",
            },
          },
          404,
        );
      }

      return c.json({
        status: details.status,
        host_label: details.hostLabel,
        cli_version: details.cliVersion,
        remote_hint: details.remoteHint,
        login_method: details.loginMethod,
        requested_at: details.requestedAt,
        expires_at: details.expiresAt,
      });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Failed to complete device login.";
      return c.json(
        {
          error: {
            type: "device_auth_approval_failed",
            message,
          },
        },
        400,
      );
    }
  });

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
      const scope = c.req.query("scope")?.trim() === "live" ? "live" : "recent";
      const status = c.req.query("status")?.trim() || "";
      const user = c.req.query("user")?.trim() || "";
      const limit = parseIntegerQuery(c, "limit", 100);
      const offset = parseIntegerQuery(c, "offset", 0);
      const sessions = await fetchManagedSessions({
        accessToken: admin.accessToken,
        environment,
        days,
        scope,
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

    try {
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
    } catch (error) {
      return errorResponse(
        c,
        isManagedConfigError(error) ? 503 : 500,
        isManagedConfigError(error) ? "chat_runtime_unavailable" : "chat_prewarm_failed",
        error instanceof Error ? error.message : "Failed to prepare chat runtime.",
      );
    }
  });

  registerGitHubRoutes(app);
  return app;
}

export { handleWebSocket };
