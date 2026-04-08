import type { Context, Next } from "hono";
import { constantTimeSecretEquals, getRuntimeAuditToken } from "./security-config.js";

function extractBearerToken(c: Context): string {
  const authHeader = c.req.header("Authorization") ?? "";
  if (!authHeader.startsWith("Bearer ")) return "";
  return authHeader.slice("Bearer ".length).trim();
}

export async function requireRuntimeAuditAuth(
  c: Context,
  next: Next,
): Promise<Response | void> {
  const expected = getRuntimeAuditToken();
  if (!expected) {
    return c.json(
      {
        error: {
          type: "runtime_audit_unavailable",
          message: "Runtime audit token is not configured.",
        },
      },
      503,
    );
  }

  const provided = extractBearerToken(c);
  if (!constantTimeSecretEquals(expected, provided)) {
    return c.json(
      {
        error: {
          type: "unauthorized",
          message: "Missing or invalid runtime audit token.",
        },
      },
      401,
    );
  }

  await next();
}
