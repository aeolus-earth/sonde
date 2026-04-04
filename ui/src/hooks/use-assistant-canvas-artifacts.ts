import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { queryKeys } from "@/lib/query-keys";
import { usePrograms } from "@/hooks/use-programs";
import { isImage, isVideo } from "@/lib/artifact-kind";
import type { Artifact } from "@/types/sonde";

const FETCH_LIMIT_PER_SOURCE = 90;
export const ASSISTANT_CANVAS_CARD_COUNT = 10;

const STALE_MS = 2 * 60_000;

export type CanvasLinkKind = "experiment" | "direction" | "project";

/** Canvas card: artifact + deep-link target + project key for diversity. */
export type AssistantCanvasArtifactRow = Artifact & {
  linkTo: { kind: CanvasLinkKind; id: string };
  resolvedProjectId: string | null;
  /** Program namespace (for cross-program diversity). */
  sourceProgram: string;
};

function isVisualArtifact(a: Artifact): boolean {
  return isImage(a) || isVideo(a);
}

function one<T>(x: T | T[] | null | undefined): T | null {
  if (x == null) return null;
  return Array.isArray(x) ? (x[0] ?? null) : x;
}

function toArtifact(row: Record<string, unknown>): Artifact {
  const { experiments: _ex, directions: _di, projects: _pr, ...rest } = row;
  void _ex;
  void _di;
  void _pr;
  return rest as unknown as Artifact;
}

const ARTIFACT_SELECT = `
  id,
  filename,
  mime_type,
  size_bytes,
  type,
  description,
  source,
  storage_path,
  experiment_id,
  finding_id,
  direction_id,
  project_id,
  created_at
`;

function selectDiverse(
  candidates: AssistantCanvasArtifactRow[],
  n: number,
): AssistantCanvasArtifactRow[] {
  const sorted = [...candidates].sort(
    (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
  );

  const parentKey = (a: AssistantCanvasArtifactRow) => `${a.linkTo.kind}:${a.linkTo.id}`;

  const result: AssistantCanvasArtifactRow[] = [];
  const pickedIds = new Set<string>();
  const usedPrograms = new Set<string>();
  const usedProjects = new Set<string>();
  const usedParents = new Set<string>();

  for (const row of sorted) {
    if (result.length >= n) return result;
    if (pickedIds.has(row.id)) continue;
    const sp = row.sourceProgram;
    if (usedPrograms.has(sp)) continue;
    usedPrograms.add(sp);
    const pk = parentKey(row);
    usedParents.add(pk);
    const pid = row.resolvedProjectId;
    if (pid) usedProjects.add(pid);
    pickedIds.add(row.id);
    result.push(row);
  }

  for (const row of sorted) {
    if (result.length >= n) return result;
    if (pickedIds.has(row.id)) continue;
    const pid = row.resolvedProjectId;
    if (!pid) continue;
    const pk = parentKey(row);
    if (usedParents.has(pk) || usedProjects.has(pid)) continue;
    usedProjects.add(pid);
    usedParents.add(pk);
    pickedIds.add(row.id);
    result.push(row);
  }

  for (const row of sorted) {
    if (pickedIds.has(row.id)) continue;
    const pk = parentKey(row);
    if (usedParents.has(pk)) continue;
    usedParents.add(pk);
    pickedIds.add(row.id);
    result.push(row);
    if (result.length >= n) return result;
  }

  for (const row of sorted) {
    if (result.length >= n) return result;
    if (pickedIds.has(row.id)) continue;
    pickedIds.add(row.id);
    result.push(row);
  }

  return result;
}

/**
 * Recent image/video artifacts across all programs the user can access.
 * Diversity: distinct program first, then project/parent passes.
 */
export function useAssistantCanvasArtifacts() {
  const { data: programs, isSuccess } = usePrograms();

  const programIds = useMemo(() => {
    const list = programs ?? [];
    return [...new Set(list.map((p) => p.id))].sort((a, b) => a.localeCompare(b));
  }, [programs]);

  const programsKey = programIds.join(",");

  return useQuery({
    queryKey: queryKeys.artifacts.assistantCanvas(programsKey),
    queryFn: async (): Promise<AssistantCanvasArtifactRow[]> => {
      if (programIds.length === 0) return [];

      const [expRes, dirRes, projRes] = await Promise.all([
        supabase
          .from("artifacts")
          .select(`${ARTIFACT_SELECT}, experiments!inner ( program, project_id )`)
          .in("experiments.program", programIds)
          .not("experiment_id", "is", null)
          .order("created_at", { ascending: false })
          .limit(FETCH_LIMIT_PER_SOURCE),
        supabase
          .from("artifacts")
          .select(`${ARTIFACT_SELECT}, directions!inner ( program, project_id )`)
          .in("directions.program", programIds)
          .not("direction_id", "is", null)
          .order("created_at", { ascending: false })
          .limit(FETCH_LIMIT_PER_SOURCE),
        supabase
          .from("artifacts")
          .select(`${ARTIFACT_SELECT}, projects!inner ( program )`)
          .in("projects.program", programIds)
          .not("project_id", "is", null)
          .order("created_at", { ascending: false })
          .limit(FETCH_LIMIT_PER_SOURCE),
      ]);

      if (expRes.error) throw expRes.error;
      if (dirRes.error) throw dirRes.error;
      if (projRes.error) throw projRes.error;

      const merged: AssistantCanvasArtifactRow[] = [];

      type ExpJoin = { program: string; project_id: string | null };
      type DirJoin = { program: string; project_id: string | null };
      type ProjJoin = { program: string };

      for (const row of expRes.data ?? []) {
        const exp = one(row.experiments as ExpJoin | ExpJoin[] | null | undefined);
        const eid = row.experiment_id;
        if (!eid || !exp) continue;
        merged.push({
          ...toArtifact(row as Record<string, unknown>),
          linkTo: { kind: "experiment", id: eid },
          resolvedProjectId: exp.project_id ?? null,
          sourceProgram: exp.program,
        });
      }

      for (const row of dirRes.data ?? []) {
        const dir = one(row.directions as DirJoin | DirJoin[] | null | undefined);
        const did = row.direction_id;
        if (!did || !dir) continue;
        merged.push({
          ...toArtifact(row as Record<string, unknown>),
          linkTo: { kind: "direction", id: did },
          resolvedProjectId: dir.project_id ?? null,
          sourceProgram: dir.program,
        });
      }

      for (const row of projRes.data ?? []) {
        const pr = one(row.projects as ProjJoin | ProjJoin[] | null | undefined);
        const pid = row.project_id;
        if (!pid || !pr) continue;
        merged.push({
          ...toArtifact(row as Record<string, unknown>),
          linkTo: { kind: "project", id: pid },
          resolvedProjectId: pid,
          sourceProgram: pr.program,
        });
      }

      const visual = merged.filter(isVisualArtifact);
      return selectDiverse(visual, ASSISTANT_CANVAS_CARD_COUNT);
    },
    enabled: isSuccess && programIds.length > 0,
    staleTime: STALE_MS,
    gcTime: 5 * 60_000,
  });
}
