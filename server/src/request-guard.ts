interface RateLimitBucket {
  timestamps: number[];
}

interface ConcurrentBucket {
  count: number;
}

export interface RateLimitDecision {
  allowed: boolean;
  retryAfterMs: number;
  remaining: number;
}

interface RedisConfig {
  url: string;
  token: string;
}

const RATE_LIMIT_TTL_MS = 15 * 60_000;
const rateBuckets = new Map<string, RateLimitBucket>();
const concurrentBuckets = new Map<string, ConcurrentBucket>();

function buildKey(scope: string, subject: string): string {
  return `${scope}:${subject}`;
}

function getRedisConfig(env: NodeJS.ProcessEnv = process.env): RedisConfig | null {
  const url =
    env.SONDE_REDIS_REST_URL?.trim() || env.UPSTASH_REDIS_REST_URL?.trim() || "";
  const token =
    env.SONDE_REDIS_REST_TOKEN?.trim() || env.UPSTASH_REDIS_REST_TOKEN?.trim() || "";
  if (!url || !token) return null;
  return { url: url.replace(/\/+$/, ""), token };
}

async function redisCommand(
  command: string[],
  env: NodeJS.ProcessEnv = process.env,
): Promise<unknown> {
  const config = getRedisConfig(env);
  if (!config) {
    throw new Error("Shared Redis rate limit backend is not configured");
  }

  const response = await fetch(`${config.url}/pipeline`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.token}`,
      "content-type": "application/json",
    },
    body: JSON.stringify([command]),
  });

  if (!response.ok) {
    throw new Error(`Redis command failed with status ${response.status}`);
  }

  const body = (await response.json()) as Array<{ result?: unknown; error?: string }>;
  const result = body[0];
  if (!result) {
    throw new Error("Redis command returned no result");
  }
  if (result.error) {
    throw new Error(result.error);
  }
  return result.result;
}

function parseInteger(value: unknown, fallback: number): number {
  const parsed =
    typeof value === "number"
      ? value
      : typeof value === "string"
        ? Number.parseInt(value, 10)
        : Number.NaN;
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function resetRequestGuardsForTests(): void {
  rateBuckets.clear();
  concurrentBuckets.clear();
}

function checkUserRateLimitInMemory(
  scope: string,
  subject: string,
  limit: number,
  windowMs: number,
  now: number,
): RateLimitDecision {
  const key = buildKey(scope, subject);
  const bucket = rateBuckets.get(key) ?? { timestamps: [] };
  const cutoff = now - windowMs;
  bucket.timestamps = bucket.timestamps.filter((timestamp) => timestamp > cutoff);

  if (bucket.timestamps.length >= limit) {
    const earliest = bucket.timestamps[0] ?? now;
    return {
      allowed: false,
      retryAfterMs: Math.max(0, earliest + windowMs - now),
      remaining: 0,
    };
  }

  bucket.timestamps.push(now);
  rateBuckets.set(key, bucket);
  return {
    allowed: true,
    retryAfterMs: 0,
    remaining: Math.max(0, limit - bucket.timestamps.length),
  };
}

async function checkUserRateLimitInRedis(
  scope: string,
  subject: string,
  limit: number,
  windowMs: number,
  now: number,
  env: NodeJS.ProcessEnv = process.env,
): Promise<RateLimitDecision> {
  const windowId = Math.floor(now / windowMs);
  const key = `sonde:rate:${buildKey(scope, subject)}:${windowId}`;
  const count = parseInteger(await redisCommand(["INCR", key], env), 0);
  if (count === 1) {
    await redisCommand(["PEXPIRE", key, String(windowMs)], env);
  }
  const ttl = Math.max(
    0,
    parseInteger(await redisCommand(["PTTL", key], env), windowMs),
  );

  if (count > limit) {
    return {
      allowed: false,
      retryAfterMs: ttl,
      remaining: 0,
    };
  }

  return {
    allowed: true,
    retryAfterMs: 0,
    remaining: Math.max(0, limit - count),
  };
}

export async function checkUserRateLimit(
  scope: string,
  subject: string,
  limit: number,
  windowMs: number,
  now: number = Date.now(),
): Promise<RateLimitDecision> {
  const redis = getRedisConfig();
  if (!redis) {
    return checkUserRateLimitInMemory(scope, subject, limit, windowMs, now);
  }
  return checkUserRateLimitInRedis(scope, subject, limit, windowMs, now);
}

function tryStartUserOperationInMemory(
  scope: string,
  subject: string,
  maxConcurrent: number,
): (() => Promise<void>) | null {
  const key = buildKey(scope, subject);
  const bucket = concurrentBuckets.get(key) ?? { count: 0 };
  if (bucket.count >= maxConcurrent) {
    return null;
  }

  bucket.count += 1;
  concurrentBuckets.set(key, bucket);

  let released = false;
  return async () => {
    if (released) return;
    released = true;
    const current = concurrentBuckets.get(key);
    if (!current) return;
    current.count = Math.max(0, current.count - 1);
    if (current.count === 0) {
      concurrentBuckets.delete(key);
      return;
    }
    concurrentBuckets.set(key, current);
  };
}

async function tryStartUserOperationInRedis(
  scope: string,
  subject: string,
  maxConcurrent: number,
  env: NodeJS.ProcessEnv = process.env,
): Promise<(() => Promise<void>) | null> {
  const key = `sonde:concurrent:${buildKey(scope, subject)}`;
  const count = parseInteger(await redisCommand(["INCR", key], env), 0);
  if (count === 1) {
    await redisCommand(["PEXPIRE", key, String(RATE_LIMIT_TTL_MS)], env);
  }

  if (count > maxConcurrent) {
    await redisCommand(["DECR", key], env);
    return null;
  }

  let released = false;
  return async () => {
    if (released) return;
    released = true;
    const next = parseInteger(await redisCommand(["DECR", key], env), 0);
    if (next <= 0) {
      await redisCommand(["DEL", key], env);
    }
  };
}

export async function tryStartUserOperation(
  scope: string,
  subject: string,
  maxConcurrent: number,
): Promise<(() => Promise<void>) | null> {
  const redis = getRedisConfig();
  if (!redis) {
    return tryStartUserOperationInMemory(scope, subject, maxConcurrent);
  }
  return tryStartUserOperationInRedis(scope, subject, maxConcurrent);
}
