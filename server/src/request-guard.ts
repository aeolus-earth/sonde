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

const rateBuckets = new Map<string, RateLimitBucket>();
const concurrentBuckets = new Map<string, ConcurrentBucket>();

function buildKey(scope: string, userId: string): string {
  return `${scope}:${userId}`;
}

export function resetRequestGuardsForTests(): void {
  rateBuckets.clear();
  concurrentBuckets.clear();
}

export function checkUserRateLimit(
  scope: string,
  userId: string,
  limit: number,
  windowMs: number,
  now: number = Date.now()
): RateLimitDecision {
  const key = buildKey(scope, userId);
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

export function tryStartUserOperation(
  scope: string,
  userId: string,
  maxConcurrent: number
): (() => void) | null {
  const key = buildKey(scope, userId);
  const bucket = concurrentBuckets.get(key) ?? { count: 0 };
  if (bucket.count >= maxConcurrent) {
    return null;
  }

  bucket.count += 1;
  concurrentBuckets.set(key, bucket);

  let released = false;
  return () => {
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
