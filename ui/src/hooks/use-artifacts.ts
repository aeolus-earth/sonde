import { useQuery, useQueries } from "@tanstack/react-query";
import { isPptx, isTextRenderable } from "@/lib/artifact-kind";
import { artifactContentCache } from "@/lib/artifact-content-cache";
import { queryClient } from "@/lib/query-client";
import { queryKeys } from "@/lib/query-keys";
import { supabase } from "@/lib/supabase";
import type { Artifact } from "@/types/sonde";

const ARTIFACT_SIGNED_URL_STALE_TIME_MS = 50 * 60_000;
const ARTIFACT_SIGNED_URL_GC_TIME_MS = 55 * 60_000;
const ARTIFACT_TEXT_GC_TIME_MS = 5 * 60_000;

/** Max blob size to hold in the LRU + Object URL cache (aligned with gallery / chat use). */
export const BLOB_CACHE_MAX_ENTRY_BYTES = 50 * 1024 * 1024;

function artifactUrlKey(storagePath: string) {
  return ["artifact-url", storagePath] as const;
}

function artifactTextKey(storagePath: string) {
  return ["artifact-text", storagePath] as const;
}

export function isBlobCacheable(sizeBytes: number | null): boolean {
  return sizeBytes != null && sizeBytes > 0 && sizeBytes <= BLOB_CACHE_MAX_ENTRY_BYTES;
}

async function fetchArtifactSignedUrl(storagePath: string): Promise<string> {
  const { data, error } = await supabase.storage
    .from("artifacts")
    .createSignedUrl(storagePath, 3600);

  if (error) throw error;
  return data.signedUrl;
}

async function fetchArtifactText(storagePath: string): Promise<string> {
  const { data, error } = await supabase.storage.from("artifacts").download(storagePath);

  if (error) throw error;
  return await data.text();
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
  const prefix = parentId.split("-")[0];
  const column =
    prefix === "EXP"
      ? "experiment_id"
      : prefix === "FIND"
        ? "finding_id"
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

/** Warm the most appropriate artifact cache for adjacent gallery items. */
export function prefetchArtifactContent(artifact: Artifact): void {
  const storagePath = artifact.storage_path;

  if (isTextRenderable(artifact)) {
    void queryClient.prefetchQuery({
      queryKey: artifactTextKey(storagePath),
      queryFn: async (): Promise<string> => fetchArtifactText(storagePath),
      staleTime: Number.POSITIVE_INFINITY,
      gcTime: ARTIFACT_TEXT_GC_TIME_MS,
    });
    return;
  }

  if (isBlobCacheable(artifact.size_bytes) && !isPptx(artifact)) {
    if (artifactContentCache.has(storagePath)) return;

    void queryClient.prefetchQuery({
      queryKey: queryKeys.artifacts.blob(storagePath),
      queryFn: async (): Promise<string> => fetchArtifactBlobObjectUrl(storagePath),
      staleTime: Number.POSITIVE_INFINITY,
      gcTime: Number.POSITIVE_INFINITY,
    });
    return;
  }

  void queryClient.prefetchQuery({
    queryKey: artifactUrlKey(storagePath),
    queryFn: async (): Promise<string> => fetchArtifactSignedUrl(storagePath),
    staleTime: ARTIFACT_SIGNED_URL_STALE_TIME_MS,
    gcTime: ARTIFACT_SIGNED_URL_GC_TIME_MS,
  });
}

export function useArtifactUrl(storagePath: string | null) {
  return useQuery({
    queryKey: storagePath ? artifactUrlKey(storagePath) : (["artifact-url", null] as const),
    queryFn: async (): Promise<string> => fetchArtifactSignedUrl(storagePath!),
    enabled: !!storagePath,
    staleTime: ARTIFACT_SIGNED_URL_STALE_TIME_MS,
    gcTime: ARTIFACT_SIGNED_URL_GC_TIME_MS,
  });
}

/**
 * Fetch text content of an artifact (csv, md, json, yaml, log, txt).
 */
export function useArtifactText(storagePath: string | null, enabled: boolean) {
  return useQuery({
    queryKey: storagePath ? artifactTextKey(storagePath) : (["artifact-text", null] as const),
    queryFn: async (): Promise<string> => fetchArtifactText(storagePath!),
    enabled: !!storagePath && enabled,
    staleTime: Number.POSITIVE_INFINITY,
    gcTime: ARTIFACT_TEXT_GC_TIME_MS,
  });
}
