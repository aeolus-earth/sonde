import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  randomUUID,
} from "node:crypto";
import { getServiceRoleSupabaseClient } from "./supabase.js";
import { verifyToken, type VerifiedUser } from "./auth.js";

const DEVICE_AUTH_TABLE = "device_auth_requests";
const DEFAULT_TTL_SECONDS = 600;
const DEFAULT_POLL_INTERVAL_SECONDS = 5;
const USER_CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
const USER_CODE_PATTERN = /^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{4}-[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{4}$/;
const LOCAL_HOSTNAMES = new Set([
  "localhost",
  "127.0.0.1",
  "::1",
  "[::1]",
]);

type DeviceAuthStatus =
  | "pending"
  | "approved"
  | "denied"
  | "consumed"
  | "expired";

type DevicePollState =
  | "authorization_pending"
  | "slow_down"
  | "access_denied"
  | "expired_token"
  | "approved";

export interface DeviceAuthSessionPayload {
  access_token: string;
  refresh_token: string;
  user: {
    id: string;
    email?: string | null;
    app_metadata?: Record<string, unknown>;
    user_metadata?: Record<string, unknown>;
  };
}

export interface DeviceAuthStartResult {
  deviceCode: string;
  userCode: string;
  expiresIn: number;
  interval: number;
  verificationUri: string;
  verificationUriComplete: string;
}

export interface DeviceAuthRequestDetails {
  hostLabel: string | null;
  cliVersion: string | null;
  remoteHint: boolean;
  loginMethod: string | null;
  requestedAt: string;
  expiresAt: string;
  status: DeviceAuthStatus;
}

export interface DeviceAuthPollResult {
  status: DevicePollState;
  interval: number;
  session?: DeviceAuthSessionPayload;
}

export interface DeviceAuthConfigStatus {
  enabled: boolean;
  configError: string | null;
  verificationOrigin: string | null;
  ttlSeconds: number;
  pollIntervalSeconds: number;
}

interface DeviceAuthStartInput {
  cliVersion?: string | null;
  hostLabel?: string | null;
  remoteHint?: boolean;
  loginMethod?: string | null;
  requestMetadata?: Record<string, unknown>;
}

interface DeviceAuthApprovalInput {
  userCode: string;
  decision: "approve" | "deny";
  session?: DeviceAuthSessionPayload;
  approvedBy: VerifiedUser;
}

interface StoredDeviceAuthRequest {
  id: string;
  deviceCodeHash: string;
  userCodeHash: string;
  status: DeviceAuthStatus;
  cliVersion: string | null;
  hostLabel: string | null;
  remoteHint: boolean;
  loginMethod: string | null;
  requestMetadata: Record<string, unknown>;
  sessionCiphertext: string | null;
  approvedByUserId: string | null;
  approvedByEmail: string | null;
  denyReason: string | null;
  pollIntervalSeconds: number;
  pollAttemptCount: number;
  requestedAt: string;
  expiresAt: string;
  approvedAt: string | null;
  deniedAt: string | null;
  consumedAt: string | null;
  lastPollAt: string | null;
}

class DeviceAuthConfigError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "DeviceAuthConfigError";
    this.code = code;
  }
}

const memoryRequests = new Map<string, StoredDeviceAuthRequest>();
const memoryByDeviceHash = new Map<string, string>();
const memoryByUserHash = new Map<string, string>();

function isStrictEnvironment(env: NodeJS.ProcessEnv = process.env): boolean {
  const current =
    env.SONDE_ENVIRONMENT?.trim() || env.NODE_ENV?.trim() || "development";
  return current === "production" || current === "staging";
}

function normalizeNullableString(value: string | null | undefined): string | null {
  const trimmed = value?.trim() ?? "";
  return trimmed || null;
}

function clampInteger(
  rawValue: string | undefined,
  fallback: number,
  min: number,
  max: number,
): number {
  const parsed = Number.parseInt(rawValue?.trim() ?? "", 10);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return Math.min(Math.max(parsed, min), max);
}

function getPollIntervalSeconds(env: NodeJS.ProcessEnv = process.env): number {
  return clampInteger(
    env.SONDE_DEVICE_AUTH_POLL_INTERVAL_SECONDS,
    DEFAULT_POLL_INTERVAL_SECONDS,
    2,
    30,
  );
}

function getTtlSeconds(env: NodeJS.ProcessEnv = process.env): number {
  return clampInteger(
    env.SONDE_DEVICE_AUTH_TTL_SECONDS,
    DEFAULT_TTL_SECONDS,
    60,
    3600,
  );
}

function isLocalOrigin(origin: string): boolean {
  try {
    const hostname = new URL(origin).hostname;
    return LOCAL_HOSTNAMES.has(hostname) || hostname.endsWith(".localhost");
  } catch {
    return false;
  }
}

export function getDeviceAuthPublicOrigin(
  env: NodeJS.ProcessEnv = process.env,
): string | null {
  const explicit =
    normalizeNullableString(env.SONDE_PUBLIC_APP_ORIGIN) ??
    normalizeNullableString(env.VITE_PUBLIC_APP_ORIGIN);
  if (explicit) {
    return explicit.replace(/\/+$/, "");
  }

  const configuredOrigins = (env.SONDE_ALLOWED_ORIGINS ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  const hostedOrigin = configuredOrigins.find((origin) => !isLocalOrigin(origin));
  if (hostedOrigin) {
    return hostedOrigin.replace(/\/+$/, "");
  }
  const localOrigin = configuredOrigins.find((origin) => isLocalOrigin(origin));
  if (localOrigin) {
    return localOrigin.replace(/\/+$/, "");
  }
  if (!isStrictEnvironment(env)) {
    return "http://localhost:5173";
  }
  return null;
}

function getVerificationUris(
  env: NodeJS.ProcessEnv,
  userCode: string,
): { verificationUri: string; verificationUriComplete: string } {
  const origin = getDeviceAuthPublicOrigin(env);
  if (!origin) {
    throw new DeviceAuthConfigError(
      "device_auth_origin_missing",
      "A public Sonde UI origin is required for device login.",
    );
  }

  const verificationUri = `${origin}/activate`;
  return {
    verificationUri,
    verificationUriComplete: `${verificationUri}?code=${encodeURIComponent(userCode)}`,
  };
}

function getEncryptionSecret(env: NodeJS.ProcessEnv = process.env): string | null {
  const explicit = normalizeNullableString(env.SONDE_DEVICE_AUTH_ENCRYPTION_KEY);
  if (explicit) {
    return explicit;
  }
  if (isStrictEnvironment(env)) {
    return null;
  }
  const fallback = normalizeNullableString(env.SONDE_WS_TOKEN_SECRET);
  if (fallback) {
    return fallback;
  }
  if (!isStrictEnvironment(env)) {
    return "sonde-dev-device-auth-secret";
  }
  return null;
}

function getEncryptionKey(env: NodeJS.ProcessEnv = process.env): Buffer | null {
  const secret = getEncryptionSecret(env);
  if (!secret) {
    return null;
  }
  return createHash("sha256").update(secret).digest();
}

function assertEncryptionKey(env: NodeJS.ProcessEnv = process.env): Buffer {
  const key = getEncryptionKey(env);
  if (!key) {
    throw new DeviceAuthConfigError(
      "device_auth_encryption_missing",
      "SONDE_DEVICE_AUTH_ENCRYPTION_KEY is not configured.",
    );
  }
  return key;
}

function hashValue(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function randomAlphabetCode(length: number): string {
  const alphabetLength = USER_CODE_ALPHABET.length;
  const maxUnbiasedByte = Math.floor(256 / alphabetLength) * alphabetLength;
  let code = "";
  while (code.length < length) {
    const bytes = randomBytes(length - code.length);
    for (const byte of bytes) {
      if (byte >= maxUnbiasedByte) {
        continue;
      }
      code += USER_CODE_ALPHABET[byte % alphabetLength];
      if (code.length === length) {
        break;
      }
    }
  }
  return code;
}

function generateUserCode(): string {
  const raw = randomAlphabetCode(8);
  return `${raw.slice(0, 4)}-${raw.slice(4)}`;
}

function generateDeviceCode(): string {
  return randomBytes(32).toString("base64url");
}

export function normalizeUserCode(rawValue: string): string | null {
  const cleaned = rawValue
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
    .replace(/[01ILO]/g, "");
  if (cleaned.length !== 8) {
    return null;
  }
  const formatted = `${cleaned.slice(0, 4)}-${cleaned.slice(4)}`;
  return USER_CODE_PATTERN.test(formatted) ? formatted : null;
}

function encryptSessionPayload(
  payload: DeviceAuthSessionPayload,
  env: NodeJS.ProcessEnv = process.env,
): string {
  const key = assertEncryptionKey(env);
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([
    cipher.update(JSON.stringify(payload), "utf8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  return `${iv.toString("base64url")}.${tag.toString("base64url")}.${ciphertext.toString("base64url")}`;
}

function decryptSessionPayload(
  ciphertext: string,
  env: NodeJS.ProcessEnv = process.env,
): DeviceAuthSessionPayload {
  const key = assertEncryptionKey(env);
  const [ivPart, tagPart, dataPart] = ciphertext.split(".");
  if (!ivPart || !tagPart || !dataPart) {
    throw new DeviceAuthConfigError(
      "device_auth_cipher_invalid",
      "Stored device login payload is malformed.",
    );
  }
  const decipher = createDecipheriv(
    "aes-256-gcm",
    key,
    Buffer.from(ivPart, "base64url"),
  );
  decipher.setAuthTag(Buffer.from(tagPart, "base64url"));
  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(dataPart, "base64url")),
    decipher.final(),
  ]).toString("utf8");
  return JSON.parse(plaintext) as DeviceAuthSessionPayload;
}

function toStoredRecord(row: Record<string, unknown>): StoredDeviceAuthRequest {
  return {
    id: String(row.id),
    deviceCodeHash: String(row.device_code_hash),
    userCodeHash: String(row.user_code_hash),
    status: String(row.status) as DeviceAuthStatus,
    cliVersion: normalizeNullableString(String(row.cli_version ?? "")),
    hostLabel: normalizeNullableString(String(row.host_label ?? "")),
    remoteHint: row.remote_hint === true,
    loginMethod: normalizeNullableString(String(row.login_method ?? "")),
    requestMetadata:
      row.request_metadata && typeof row.request_metadata === "object"
        ? (row.request_metadata as Record<string, unknown>)
        : {},
    sessionCiphertext: normalizeNullableString(String(row.session_ciphertext ?? "")),
    approvedByUserId: normalizeNullableString(String(row.approved_by_user_id ?? "")),
    approvedByEmail: normalizeNullableString(String(row.approved_by_email ?? "")),
    denyReason: normalizeNullableString(String(row.deny_reason ?? "")),
    pollIntervalSeconds: Number(row.poll_interval_seconds ?? DEFAULT_POLL_INTERVAL_SECONDS),
    pollAttemptCount: Number(row.poll_attempt_count ?? 0),
    requestedAt: String(row.requested_at),
    expiresAt: String(row.expires_at),
    approvedAt: normalizeNullableString(String(row.approved_at ?? "")),
    deniedAt: normalizeNullableString(String(row.denied_at ?? "")),
    consumedAt: normalizeNullableString(String(row.consumed_at ?? "")),
    lastPollAt: normalizeNullableString(String(row.last_poll_at ?? "")),
  };
}

function toSupabaseInsertRow(record: StoredDeviceAuthRequest): Record<string, unknown> {
  return {
    id: record.id,
    device_code_hash: record.deviceCodeHash,
    user_code_hash: record.userCodeHash,
    status: record.status,
    cli_version: record.cliVersion,
    host_label: record.hostLabel,
    remote_hint: record.remoteHint,
    login_method: record.loginMethod,
    request_metadata: record.requestMetadata,
    session_ciphertext: record.sessionCiphertext,
    approved_by_user_id: record.approvedByUserId,
    approved_by_email: record.approvedByEmail,
    deny_reason: record.denyReason,
    poll_interval_seconds: record.pollIntervalSeconds,
    poll_attempt_count: record.pollAttemptCount,
    requested_at: record.requestedAt,
    expires_at: record.expiresAt,
    approved_at: record.approvedAt,
    denied_at: record.deniedAt,
    consumed_at: record.consumedAt,
    last_poll_at: record.lastPollAt,
  };
}

function toSupabaseUpdateRow(record: StoredDeviceAuthRequest): Record<string, unknown> {
  const { id: _id, ...rest } = toSupabaseInsertRow(record);
  return rest;
}

async function insertRecord(
  record: StoredDeviceAuthRequest,
  env: NodeJS.ProcessEnv = process.env,
): Promise<void> {
  const client = getServiceRoleSupabaseClient(env);
  if (!client) {
    memoryRequests.set(record.id, { ...record });
    memoryByDeviceHash.set(record.deviceCodeHash, record.id);
    memoryByUserHash.set(record.userCodeHash, record.id);
    return;
  }

  const { error } = await client.from(DEVICE_AUTH_TABLE).insert(toSupabaseInsertRow(record));
  if (error) {
    throw new Error(`Failed to create device login request: ${error.message}`);
  }
}

function memoryRecordByHash(kind: "device" | "user", hash: string): StoredDeviceAuthRequest | null {
  const id = kind === "device" ? memoryByDeviceHash.get(hash) : memoryByUserHash.get(hash);
  if (!id) {
    return null;
  }
  const record = memoryRequests.get(id);
  return record ? { ...record } : null;
}

async function findRecordByHash(
  kind: "device" | "user",
  hash: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<StoredDeviceAuthRequest | null> {
  const client = getServiceRoleSupabaseClient(env);
  if (!client) {
    return memoryRecordByHash(kind, hash);
  }

  const column = kind === "device" ? "device_code_hash" : "user_code_hash";
  const { data, error } = await client
    .from(DEVICE_AUTH_TABLE)
    .select("*")
    .eq(column, hash)
    .limit(1)
    .maybeSingle();
  if (error) {
    throw new Error(`Failed to load device login request: ${error.message}`);
  }
  if (!data) {
    return null;
  }
  return toStoredRecord(data as Record<string, unknown>);
}

function updateMemoryRecord(
  id: string,
  updates: Partial<StoredDeviceAuthRequest>,
): StoredDeviceAuthRequest | null {
  const current = memoryRequests.get(id);
  if (!current) {
    return null;
  }
  const next = { ...current, ...updates };
  memoryRequests.set(id, next);
  return { ...next };
}

async function updateRecord(
  id: string,
  updates: Partial<StoredDeviceAuthRequest>,
  env: NodeJS.ProcessEnv = process.env,
): Promise<StoredDeviceAuthRequest | null> {
  const client = getServiceRoleSupabaseClient(env);
  if (!client) {
    return updateMemoryRecord(id, updates);
  }

  const nextRecord = {
    ...(await findRecordById(id, env)),
    ...updates,
  };
  const supabaseUpdates = toSupabaseUpdateRow(nextRecord);
  const { data, error } = await client
    .from(DEVICE_AUTH_TABLE)
    .update(supabaseUpdates)
    .eq("id", id)
    .select("*")
    .maybeSingle();
  if (error) {
    throw new Error(`Failed to update device login request: ${error.message}`);
  }
  if (!data) {
    return null;
  }
  return toStoredRecord(data as Record<string, unknown>);
}

async function findRecordById(
  id: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<StoredDeviceAuthRequest> {
  const client = getServiceRoleSupabaseClient(env);
  if (!client) {
    const record = memoryRequests.get(id);
    if (!record) {
      throw new Error("Missing device login request");
    }
    return { ...record };
  }

  const { data, error } = await client
    .from(DEVICE_AUTH_TABLE)
    .select("*")
    .eq("id", id)
    .limit(1)
    .single();
  if (error) {
    throw new Error(`Failed to load device login request: ${error.message}`);
  }
  return toStoredRecord(data as Record<string, unknown>);
}

async function consumeApprovedRecord(
  id: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<StoredDeviceAuthRequest | null> {
  const client = getServiceRoleSupabaseClient(env);
  const consumedAt = new Date().toISOString();
  if (!client) {
    const current = memoryRequests.get(id);
    if (!current || current.status !== "approved" || current.consumedAt) {
      return null;
    }
    return updateMemoryRecord(id, { status: "consumed", consumedAt });
  }

  const { data, error } = await client
    .from(DEVICE_AUTH_TABLE)
    .update({
      status: "consumed",
      consumed_at: consumedAt,
    })
    .eq("id", id)
    .eq("status", "approved")
    .is("consumed_at", null)
    .select("*")
    .maybeSingle();
  if (error) {
    throw new Error(`Failed to consume device login request: ${error.message}`);
  }
  if (!data) {
    return null;
  }
  return toStoredRecord(data as Record<string, unknown>);
}

function maybeExpireRecord(
  record: StoredDeviceAuthRequest,
): StoredDeviceAuthRequest | null {
  if (record.status === "expired") {
    return record;
  }
  if (Date.parse(record.expiresAt) > Date.now()) {
    return null;
  }
  return {
    ...record,
    status: "expired",
  };
}

async function expireRecordIfNeeded(
  record: StoredDeviceAuthRequest,
  env: NodeJS.ProcessEnv = process.env,
): Promise<StoredDeviceAuthRequest> {
  const expired = maybeExpireRecord(record);
  if (!expired) {
    return record;
  }
  const updated = await updateRecord(record.id, { status: "expired" }, env);
  return updated ?? expired;
}

function shouldSlowDown(
  record: StoredDeviceAuthRequest,
  nowMs: number,
): boolean {
  if (!record.lastPollAt) {
    return false;
  }
  const nextPollAt =
    Date.parse(record.lastPollAt) + record.pollIntervalSeconds * 1000;
  return nextPollAt > nowMs;
}

async function notePollAttempt(
  record: StoredDeviceAuthRequest,
  nowIso: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<StoredDeviceAuthRequest> {
  const updated = await updateRecord(record.id, {
    lastPollAt: nowIso,
    pollAttemptCount: record.pollAttemptCount + 1,
  }, env);
  return updated ?? {
    ...record,
    lastPollAt: nowIso,
    pollAttemptCount: record.pollAttemptCount + 1,
  };
}

export function getDeviceAuthRuntimeStatus(
  env: NodeJS.ProcessEnv = process.env,
): DeviceAuthConfigStatus {
  const verificationOrigin = getDeviceAuthPublicOrigin(env);
  const ttlSeconds = getTtlSeconds(env);
  const pollIntervalSeconds = getPollIntervalSeconds(env);
  const serviceRolePresent = Boolean(env.SUPABASE_SERVICE_ROLE_KEY?.trim());
  const encryptionKey = getEncryptionKey(env);

  let configError: string | null = null;
  if (!verificationOrigin) {
    configError = "A public Sonde UI origin is required for device login.";
  } else if (!encryptionKey) {
    configError = "SONDE_DEVICE_AUTH_ENCRYPTION_KEY is not configured.";
  } else if (isStrictEnvironment(env) && !serviceRolePresent) {
    configError =
      "SUPABASE_SERVICE_ROLE_KEY is required for hosted device login in staging and production.";
  }

  return {
    enabled: configError === null,
    configError,
    verificationOrigin,
    ttlSeconds,
    pollIntervalSeconds,
  };
}

export function assertDeviceAuthConfig(
  env: NodeJS.ProcessEnv = process.env,
): void {
  const status = getDeviceAuthRuntimeStatus(env);
  if (!status.enabled) {
    throw new DeviceAuthConfigError(
      "device_auth_config_invalid",
      status.configError ?? "Device login is not configured.",
    );
  }
}

function sanitizeMetadata(
  metadata: Record<string, unknown> | undefined,
): Record<string, unknown> {
  if (!metadata || typeof metadata !== "object") {
    return {};
  }
  return Object.fromEntries(
    Object.entries(metadata).filter(([key, value]) => {
      if (!key || value === undefined) {
        return false;
      }
      return typeof value === "string"
        ? value.length <= 200
        : typeof value === "number" || typeof value === "boolean";
    }),
  );
}

export async function startDeviceAuth(
  input: DeviceAuthStartInput,
  env: NodeJS.ProcessEnv = process.env,
): Promise<DeviceAuthStartResult> {
  assertDeviceAuthConfig(env);

  const deviceCode = generateDeviceCode();
  const userCode = generateUserCode();
  const requestedAt = new Date().toISOString();
  const expiresAt = new Date(Date.now() + getTtlSeconds(env) * 1000).toISOString();
  const record: StoredDeviceAuthRequest = {
    id: randomUUID(),
    deviceCodeHash: hashValue(deviceCode),
    userCodeHash: hashValue(userCode),
    status: "pending",
    cliVersion: normalizeNullableString(input.cliVersion),
    hostLabel: normalizeNullableString(input.hostLabel),
    remoteHint: input.remoteHint === true,
    loginMethod: normalizeNullableString(input.loginMethod),
    requestMetadata: sanitizeMetadata(input.requestMetadata),
    sessionCiphertext: null,
    approvedByUserId: null,
    approvedByEmail: null,
    denyReason: null,
    pollIntervalSeconds: getPollIntervalSeconds(env),
    pollAttemptCount: 0,
    requestedAt,
    expiresAt,
    approvedAt: null,
    deniedAt: null,
    consumedAt: null,
    lastPollAt: null,
  };

  await insertRecord(record, env);
  const { verificationUri, verificationUriComplete } = getVerificationUris(env, userCode);
  return {
    deviceCode,
    userCode,
    expiresIn: getTtlSeconds(env),
    interval: record.pollIntervalSeconds,
    verificationUri,
    verificationUriComplete,
  };
}

function recordDetails(record: StoredDeviceAuthRequest): DeviceAuthRequestDetails {
  return {
    hostLabel: record.hostLabel,
    cliVersion: record.cliVersion,
    remoteHint: record.remoteHint,
    loginMethod: record.loginMethod,
    requestedAt: record.requestedAt,
    expiresAt: record.expiresAt,
    status: record.status,
  };
}

export async function inspectDeviceAuth(
  userCode: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<DeviceAuthRequestDetails | null> {
  const normalized = normalizeUserCode(userCode);
  if (!normalized) {
    return null;
  }
  const record = await findRecordByHash("user", hashValue(normalized), env);
  if (!record) {
    return null;
  }
  const current = await expireRecordIfNeeded(record, env);
  return recordDetails(current);
}

function assertSessionMatchesUser(
  session: DeviceAuthSessionPayload | undefined,
  user: VerifiedUser,
): asserts session is DeviceAuthSessionPayload {
  if (!session?.access_token?.trim() || !session.refresh_token?.trim()) {
    throw new DeviceAuthConfigError(
      "device_auth_session_missing",
      "A valid browser session is required to approve device login.",
    );
  }
  if ((session.user?.id ?? "").trim() !== user.id) {
    throw new DeviceAuthConfigError(
      "device_auth_session_mismatch",
      "The approval session does not match the signed-in user.",
    );
  }
}

export async function approveDeviceAuth(
  input: DeviceAuthApprovalInput,
  env: NodeJS.ProcessEnv = process.env,
): Promise<DeviceAuthRequestDetails | null> {
  const normalized = normalizeUserCode(input.userCode);
  if (!normalized) {
    return null;
  }

  const record = await findRecordByHash("user", hashValue(normalized), env);
  if (!record) {
    return null;
  }
  const current = await expireRecordIfNeeded(record, env);
  if (current.status !== "pending") {
    return recordDetails(current);
  }

  let updates: Partial<StoredDeviceAuthRequest>;
  if (input.decision === "deny") {
    updates = {
      status: "denied",
      deniedAt: new Date().toISOString(),
      denyReason: "user_cancelled",
    };
  } else {
    assertSessionMatchesUser(input.session, input.approvedBy);
    const verifiedSessionUser = await verifyToken(input.session.access_token);
    if (!verifiedSessionUser || verifiedSessionUser.id !== input.approvedBy.id) {
      throw new DeviceAuthConfigError(
        "device_auth_session_invalid",
        "The browser session is invalid or belongs to a different user.",
      );
    }
    updates = {
      status: "approved",
      approvedAt: new Date().toISOString(),
      approvedByUserId: input.approvedBy.id,
      approvedByEmail: input.approvedBy.email ?? input.session.user.email ?? null,
      sessionCiphertext: encryptSessionPayload(input.session, env),
      denyReason: null,
    };
  }

  const updated = await updateRecord(current.id, updates, env);
  return updated ? recordDetails(updated) : recordDetails({ ...current, ...updates });
}

export async function pollDeviceAuth(
  deviceCode: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<DeviceAuthPollResult> {
  const trimmed = deviceCode.trim();
  if (!trimmed) {
    return {
      status: "expired_token",
      interval: DEFAULT_POLL_INTERVAL_SECONDS,
    };
  }

  const record = await findRecordByHash("device", hashValue(trimmed), env);
  if (!record) {
    return {
      status: "expired_token",
      interval: DEFAULT_POLL_INTERVAL_SECONDS,
    };
  }

  const current = await expireRecordIfNeeded(record, env);
  if (current.status === "expired" || current.status === "consumed") {
    return {
      status: "expired_token",
      interval: current.pollIntervalSeconds,
    };
  }
  if (current.status === "denied") {
    return {
      status: "access_denied",
      interval: current.pollIntervalSeconds,
    };
  }

  const nowMs = Date.now();
  if (current.status === "pending" && shouldSlowDown(current, nowMs)) {
    return {
      status: "slow_down",
      interval: current.pollIntervalSeconds,
    };
  }

  const noted = await notePollAttempt(current, new Date(nowMs).toISOString(), env);
  if (noted.status === "pending") {
    return {
      status: "authorization_pending",
      interval: noted.pollIntervalSeconds,
    };
  }
  if (noted.status !== "approved" || !noted.sessionCiphertext) {
    return {
      status: "expired_token",
      interval: noted.pollIntervalSeconds,
    };
  }

  const consumed = await consumeApprovedRecord(noted.id, env);
  if (!consumed?.sessionCiphertext) {
    return {
      status: "expired_token",
      interval: noted.pollIntervalSeconds,
    };
  }

  return {
    status: "approved",
    interval: consumed.pollIntervalSeconds,
    session: decryptSessionPayload(consumed.sessionCiphertext, env),
  };
}

export function resetDeviceAuthStateForTests(): void {
  memoryRequests.clear();
  memoryByDeviceHash.clear();
  memoryByUserHash.clear();
}
