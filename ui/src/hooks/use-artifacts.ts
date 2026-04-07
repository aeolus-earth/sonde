import { useMemo } from "react";
import { useQuery, useQueries } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { artifactContentCache } from "@/lib/artifact-content-cache";
import { queryClient } from "@/lib/query-client";
import { queryKeys } from "@/lib/query-keys";
import type { Artifact } from "@/types/sonde";

/** Max blob size to hold in the LRU + Object URL cache (aligned with gallery / chat use). */
export const BLOB_CACHE_MAX_ENTRY_BYTES = 50 * 1024 * 1024;

export function isBlobCacheable(sizeBytes: number | null): boolean {
  return sizeBytes != null && sizeBytes > 0 && sizeBytes <= BLOB_CACHE_MAX_ENTRY_BYTES;
}

async function fetchArtifactBlobObjectUrl(storagePath: string): Promise<string> {
  const cached = artifactContentCache.get(storagePath);
  if (cached) return cached;

  const { data, error } = await supabase.storage.from("artifacts").download(storagePath);
  if (error) throw error;
  return artifactContentCache.set(storagePath, data, data.type);
}

/** Shared fetch for `useArtifacts` and chat inline parent-based previews. */
export async function fetchArtifactsByParentId(parentId: string): Promise<Artifact[]> {
  const prefix = parentId.split("-")[0]?.toUpperCase();
  const column =
    prefix === "EXP"
      ? "experiment_id"
      : prefix === "FIND"
        ? "finding_id"
        : prefix === "PROJ"
          ? "project_id"
          : "direction_id";

  const { data, error } = await supabase
    .from("artifacts")
    .select("*")
    .eq(column, parentId)
    .order("created_at", { ascending: true });

  if (error) throw error;
  return data;
}

export function useArtifacts(parentId: string) {
  return useQuery({
    queryKey: queryKeys.artifacts.byParent(parentId),
    queryFn: () => fetchArtifactsByParentId(parentId),
    enabled: !!parentId,
  });
}

/** Fetch a single artifact by id (e.g. ART-0010) for inline chat previews. */
export function useArtifactById(artifactId: string | null) {
  return useQuery({
    queryKey: artifactId
      ? queryKeys.artifacts.detail(artifactId)
      : (["artifacts", "detail", "none"] as const),
    queryFn: async (): Promise<Artifact | null> => {
      const { data, error } = await supabase
        .from("artifacts")
        .select("*")
        .eq("id", artifactId!)
        .maybeSingle();

      if (error) throw error;
      return data;
    },
    enabled: !!artifactId,
  });
}

/** Parallel fetch for multiple artifact ids (order preserved). */
export function useArtifactsByIds(artifactIds: string[]) {
  return useQueries({
    queries: artifactIds.map((id) => ({
      queryKey: queryKeys.artifacts.detail(id),
      queryFn: async (): Promise<Artifact | null> => {
        const { data, error } = await supabase
          .from("artifacts")
          .select("*")
          .eq("id", id)
          .maybeSingle();

        if (error) throw error;
        return data;
      },
      enabled: !!id,
    })),
  });
}

/**
 * Generate a signed URL for a storage path.
 * Cached for 50 minutes (URLs expire in 60 min).
 */
/**
 * Download blob into LRU-backed Object URL cache. Use for rendering when
 * {@link isBlobCacheable}; otherwise use {@link useArtifactUrl} (streaming / signed URL).
 */
export function useArtifactBlob(storagePath: string | null, sizeBytes: number | null) {
  const cacheable = !!storagePath && isBlobCacheable(sizeBytes);
  return useQuery({
    queryKey: queryKeys.artifacts.blob(cacheable ? storagePath : null),
    queryFn: async (): Promise<string> => fetchArtifactBlobObjectUrl(storagePath!),
    enabled: cacheable,
    staleTime: Number.POSITIVE_INFINITY,
    gcTime: Number.POSITIVE_INFINITY,
  });
}

/** Warm blob cache for an artifact (e.g. adjacent gallery items). */
export function prefetchArtifactContent(artifact: Artifact): void {
  if (!isBlobCacheable(artifact.size_bytes)) return;
  if (artifactContentCache.has(artifact.storage_path)) return;

  void queryClient.prefetchQuery({
    queryKey: queryKeys.artifacts.blob(artifact.storage_path),
    queryFn: async () => fetchArtifactBlobObjectUrl(artifact.storage_path),
    staleTime: Number.POSITIVE_INFINITY,
    gcTime: Number.POSITIVE_INFINITY,
  });
}

export function useArtifactUrl(storagePath: string | null) {
  return useQuery({
    queryKey: ["artifact-url", storagePath] as const,
    queryFn: async (): Promise<string> => {
      const { data, error } = await supabase.storage
        .from("artifacts")
        .createSignedUrl(storagePath!, 3600); // 1 hour

      if (error) throw error;
      return data.signedUrl;
    },
    enabled: !!storagePath,
    staleTime: 50 * 60_000, // cache 50 min (URL good for 60)
    gcTime: 55 * 60_000,
  });
}

/**
 * One storage round-trip for many paths; seeds {@link useArtifactUrl} cache entries.
 */
export function useBatchArtifactUrls(storagePaths: string[]) {
  const { paths, pathsKey } = useMemo(() => {
    const u = [...new Set(storagePaths.filter(Boolean))];
    u.sort((a, b) => a.localeCompare(b));
    return { paths: u, pathsKey: JSON.stringify(u) };
  }, [storagePaths]);

  return useQuery({
    queryKey: queryKeys.artifacts.urlBatch(pathsKey),
    queryFn: async (): Promise<void> => {
      if (paths.length === 0) return;
      const { data, error } = await supabase.storage
        .from("artifacts")
        .createSignedUrls(paths, 3600);

      if (error) throw error;
      for (const row of data ?? []) {
        if (!row.error && row.signedUrl && row.path) {
          queryClient.setQueryData(["artifact-url", row.path], row.signedUrl);
        }
      }
    },
    enabled: paths.length > 0,
    staleTime: 50 * 60_000,
    gcTime: 55 * 60_000,
  });
}

/**
 * Fetch text content of an artifact (csv, md, json, yaml, log, txt).
 */
export function useArtifactText(storagePath: string | null, enabled: boolean) {
  return useQuery({
    queryKey: ["artifact-text", storagePath] as const,
    queryFn: async (): Promise<string> => {
      const { data, error } = await supabase.storage
        .from("artifacts")
        .download(storagePath!);

      if (error) throw error;
      return await data.text();
    },
    enabled: !!storagePath && enabled,
    staleTime: Number.POSITIVE_INFINITY,
    gcTime: 5 * 60_000,
  });
}
