/** LRU cache of blob Object URLs keyed by Supabase storage_path. Survives React unmounts. */

import { queryClient } from "@/lib/query-client";
import { queryKeys } from "@/lib/query-keys";

const DEFAULT_BUDGET_BYTES = 200 * 1024 * 1024;

interface CacheEntry {
  objectUrl: string;
  sizeBytes: number;
  storagePath: string;
  mimeType: string | null;
  accessedAt: number;
}

const entries = new Map<string, CacheEntry>();
let totalBytes = 0;
let hits = 0;
let misses = 0;
let budgetBytes = DEFAULT_BUDGET_BYTES;

function touchLru(key: string): void {
  const e = entries.get(key);
  if (!e) return;
  entries.delete(key);
  e.accessedAt = Date.now();
  entries.set(key, e);
}

function evictOne(): void {
  const firstKey = entries.keys().next().value as string | undefined;
  if (!firstKey) return;
  const e = entries.get(firstKey);
  if (!e) return;
  queryClient.removeQueries({ queryKey: queryKeys.artifacts.blob(firstKey) });
  URL.revokeObjectURL(e.objectUrl);
  entries.delete(firstKey);
  totalBytes -= e.sizeBytes;
}

function evictUntilFits(neededBytes: number): void {
  while (totalBytes + neededBytes > budgetBytes && entries.size > 0) {
    evictOne();
  }
}

export const artifactContentCache = {
  get(storagePath: string): string | null {
    const e = entries.get(storagePath);
    if (!e) {
      misses += 1;
      return null;
    }
    hits += 1;
    touchLru(storagePath);
    return e.objectUrl;
  },

  set(storagePath: string, blob: Blob, mimeType: string | null): string {
    const existing = entries.get(storagePath);
    if (existing) {
      queryClient.removeQueries({ queryKey: queryKeys.artifacts.blob(storagePath) });
      URL.revokeObjectURL(existing.objectUrl);
      entries.delete(storagePath);
      totalBytes -= existing.sizeBytes;
    }

    const sizeBytes = blob.size;
    evictUntilFits(sizeBytes);
    if (totalBytes + sizeBytes > budgetBytes) {
      const objectUrl = URL.createObjectURL(blob);
      return objectUrl;
    }

    const objectUrl = URL.createObjectURL(blob);
    const entry: CacheEntry = {
      objectUrl,
      sizeBytes,
      storagePath,
      mimeType,
      accessedAt: Date.now(),
    };
    entries.set(storagePath, entry);
    totalBytes += sizeBytes;
    return objectUrl;
  },

  has(storagePath: string): boolean {
    return entries.has(storagePath);
  },

  delete(storagePath: string): void {
    const e = entries.get(storagePath);
    if (!e) return;
    queryClient.removeQueries({ queryKey: queryKeys.artifacts.blob(storagePath) });
    URL.revokeObjectURL(e.objectUrl);
    entries.delete(storagePath);
    totalBytes -= e.sizeBytes;
  },

  clear(): void {
    for (const key of entries.keys()) {
      queryClient.removeQueries({ queryKey: queryKeys.artifacts.blob(key) });
    }
    for (const e of entries.values()) {
      URL.revokeObjectURL(e.objectUrl);
    }
    entries.clear();
    totalBytes = 0;
    hits = 0;
    misses = 0;
  },

  stats(): {
    totalBytes: number;
    entryCount: number;
    budgetBytes: number;
    hits: number;
    misses: number;
    hitRatio: number;
  } {
    const total = hits + misses;
    return {
      totalBytes,
      entryCount: entries.size,
      budgetBytes,
      hits,
      misses,
      hitRatio: total === 0 ? 0 : hits / total,
    };
  },

  /** For tests or tuning memory pressure. */
  setBudgetBytes(bytes: number): void {
    budgetBytes = Math.max(0, bytes);
    while (totalBytes > budgetBytes && entries.size > 0) {
      evictOne();
    }
  },
};
