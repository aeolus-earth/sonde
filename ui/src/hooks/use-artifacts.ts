import { useQuery, useQueries } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { queryKeys } from "@/lib/query-keys";
import type { Artifact } from "@/types/sonde";

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
    staleTime: 5 * 60_000,
  });
}
