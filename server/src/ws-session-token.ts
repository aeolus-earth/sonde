import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from "node:crypto";
import type { VerifiedUser } from "./auth.js";
import { getWsTokenSecret } from "./security-config.js";

const WS_TOKEN_TTL_MS = 60_000;
const WS_TOKEN_AAD = Buffer.from("sonde-ws-token:v1", "utf-8");

interface WsTokenPayload {
  v: 1;
  aud: "sonde-ws";
  exp: number;
  accessToken: string;
  user: VerifiedUser;
}

function base64urlEncode(value: Buffer): string {
  return value.toString("base64url");
}

function base64urlDecode(value: string): Buffer {
  return Buffer.from(value, "base64url");
}

function buildKey(secret: string): Buffer {
  return createHash("sha256").update(secret, "utf-8").digest();
}

function getTokenSecretOrThrow(env: NodeJS.ProcessEnv = process.env): string {
  const secret = getWsTokenSecret(env);
  if (!secret) {
    throw new Error("SONDE_WS_TOKEN_SECRET is not configured");
  }
  return secret;
}

export function issueWsSessionToken(
  accessToken: string,
  user: VerifiedUser,
  env: NodeJS.ProcessEnv = process.env,
): string {
  const secret = getTokenSecretOrThrow(env);
  const iv = randomBytes(12);
  const payload: WsTokenPayload = {
    v: 1,
    aud: "sonde-ws",
    exp: Date.now() + WS_TOKEN_TTL_MS,
    accessToken,
    user,
  };
  const cipher = createCipheriv("aes-256-gcm", buildKey(secret), iv);
  cipher.setAAD(WS_TOKEN_AAD);
  const ciphertext = Buffer.concat([
    cipher.update(JSON.stringify(payload), "utf-8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  return [base64urlEncode(iv), base64urlEncode(ciphertext), base64urlEncode(tag)].join(".");
}

export function verifyWsSessionToken(
  token: string,
  env: NodeJS.ProcessEnv = process.env,
): { accessToken: string; user: VerifiedUser } | null {
  const secret = getWsTokenSecret(env);
  if (!secret) return null;

  const parts = token.split(".");
  if (parts.length !== 3) return null;

  try {
    const [ivPart, cipherPart, tagPart] = parts;
    const decipher = createDecipheriv(
      "aes-256-gcm",
      buildKey(secret),
      base64urlDecode(ivPart),
    );
    decipher.setAAD(WS_TOKEN_AAD);
    decipher.setAuthTag(base64urlDecode(tagPart));
    const plaintext = Buffer.concat([
      decipher.update(base64urlDecode(cipherPart)),
      decipher.final(),
    ]).toString("utf-8");
    const payload = JSON.parse(plaintext) as Partial<WsTokenPayload>;
    if (
      payload.v !== 1 ||
      payload.aud !== "sonde-ws" ||
      typeof payload.exp !== "number" ||
      payload.exp <= Date.now() ||
      typeof payload.accessToken !== "string" ||
      !payload.accessToken.trim() ||
      !payload.user ||
      typeof payload.user.id !== "string"
    ) {
      return null;
    }
    return {
      accessToken: payload.accessToken,
      user: payload.user,
    };
  } catch {
    return null;
  }
}
