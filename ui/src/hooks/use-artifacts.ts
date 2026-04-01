import { useQuery, useQueries } from "@tanstack/react-query";
import { isPptx, isTextRenderable } from "@/lib/artifact-kind";
import { queryClient } from "@/lib/query-client";
import { supabase } from "@/lib/supabase";
import { queryKeys } from "@/lib/query-keys";
import type { Artifact } from "@/types/sonde";

const ARTIFACT_TEXT_STALE_TIME_MS = 5 * 60_000;
const ARTIFACT_SIGNED_URL_STALE_TIME_MS = 50 * 60_000;
const ARTIFACT_SIGNED_URL_GC_TIME_MS = 55 * 60_000;
const ARTIFACT_BLOB_STALE_TIME_MS = 5 * 60_000;
const ARTIFACT_BLOB_GC_TIME_MS = 10 * 60_000;
const MAX_CACHEABLE_BLOB_BYTES = 25 * 1024 * 1024;

function artifactUrlKey(storagePath: string) {
  return ["artifact-url", storagePath] as const;
}

function artifactTextKey(storagePath: string) {
  return ["artifact-text", storagePath] as const;
}

function artifactBlobKey(storagePath: string) {
  return ["artifact-blob", storagePath] as const;
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

async function fetchArtifactBlobUrl(storagePath: string): Promise<string> {
  const { data, error } = await supabase.storage.from("artifacts").download(storagePath);

  if (error) throw error;
  return URL.createObjectURL(data);
}

export function useArtifacts(parentId: string) {
  return useQuery({
    queryKey: queryKeys.artifacts.byParent(parentId),
    queryFn: async (): Promise<Artifact[]> => {
      // Try experiment_id first (most common), then finding_id, then direction_id
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
    },
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
    staleTime: ARTIFACT_TEXT_STALE_TIME_MS,
  });
}

export function isBlobCacheable(sizeBytes: number | null): boolean {
  return sizeBytes !== null && sizeBytes <= MAX_CACHEABLE_BLOB_BYTES;
}

export function useArtifactBlob(storagePath: string | null, sizeBytes: number | null) {
  return useQuery({
    queryKey: storagePath ? artifactBlobKey(storagePath) : (["artifact-blob", null] as const),
    queryFn: async (): Promise<string> => fetchArtifactBlobUrl(storagePath!),
    enabled: !!storagePath && isBlobCacheable(sizeBytes),
    staleTime: ARTIFACT_BLOB_STALE_TIME_MS,
    gcTime: ARTIFACT_BLOB_GC_TIME_MS,
  });
}

export function prefetchArtifactContent(artifact: Artifact): void {
  const storagePath = artifact.storage_path;

  if (isTextRenderable(artifact)) {
    void queryClient.prefetchQuery({
      queryKey: artifactTextKey(storagePath),
      queryFn: async (): Promise<string> => fetchArtifactText(storagePath),
      staleTime: ARTIFACT_TEXT_STALE_TIME_MS,
    });
    return;
  }

  if (isBlobCacheable(artifact.size_bytes) && !isPptx(artifact)) {
    void queryClient.prefetchQuery({
      queryKey: artifactBlobKey(storagePath),
      queryFn: async (): Promise<string> => fetchArtifactBlobUrl(storagePath),
      staleTime: ARTIFACT_BLOB_STALE_TIME_MS,
      gcTime: ARTIFACT_BLOB_GC_TIME_MS,
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
