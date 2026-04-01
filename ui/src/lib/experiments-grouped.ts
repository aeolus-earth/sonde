import type {
  DirectionSummary,
  ExperimentSummary,
  ProjectSummary,
} from "@/types/sonde";

export type ExperimentsViewMode = "list" | "grouped";

export interface DirectionGroup {
  directionId: string | null;
  label: string;
  experiments: ExperimentSummary[];
}

export interface ProjectGroup {
  /** Synthetic key for React (includes unassigned sentinel). */
  key: string;
  projectId: string | null;
  label: string;
  /** Short id for display, e.g. PROJ-001 or "Unassigned". */
  displayId: string;
  directions: DirectionGroup[];
}

const UNASSIGNED = "__unassigned__";
const NO_DIRECTION = "__no_direction__";

/**
 * Resolve which project bucket an experiment belongs to: experiment.project_id,
 * else direction.project_id when direction is known, else unassigned.
 */
function effectiveProjectId(
  exp: ExperimentSummary,
  dirById: Map<string, DirectionSummary>
): string | null {
  if (exp.project_id) return exp.project_id;
  if (exp.direction_id) {
    const d = dirById.get(exp.direction_id);
    if (d?.project_id) return d.project_id;
  }
  return null;
}

function compareCreatedAt(
  a: ExperimentSummary,
  b: ExperimentSummary,
  ascending: boolean
): number {
  const ta = new Date(a.created_at).getTime();
  const tb = new Date(b.created_at).getTime();
  return ascending ? ta - tb : tb - ta;
}

export type BuildExperimentsProjectTreeOptions = {
  /** Default `desc` (newest first). */
  createdSort?: "asc" | "desc";
};

/**
 * Build project → direction → experiments tree from already-filtered experiments.
 * Omits empty branches (only non-empty groups appear).
 */
export function buildExperimentsProjectTree(
  filtered: ExperimentSummary[],
  projects: ProjectSummary[],
  directions: DirectionSummary[],
  options?: BuildExperimentsProjectTreeOptions
): ProjectGroup[] {
  const ascending = (options?.createdSort ?? "desc") === "asc";
  const dirById = new Map(directions.map((d) => [d.id, d]));
  const projectById = new Map(projects.map((p) => [p.id, p]));

  const buckets = new Map<string, Map<string, ExperimentSummary[]>>();

  for (const exp of filtered) {
    const pid = effectiveProjectId(exp, dirById);
    const pKey = pid ?? UNASSIGNED;
    const dKey = exp.direction_id ?? NO_DIRECTION;

    if (!buckets.has(pKey)) buckets.set(pKey, new Map());
    const dm = buckets.get(pKey)!;
    if (!dm.has(dKey)) dm.set(dKey, []);
    dm.get(dKey)!.push(exp);
  }

  const projectOrder: string[] = [];
  for (const p of projects) {
    if (buckets.has(p.id)) projectOrder.push(p.id);
  }
  if (buckets.has(UNASSIGNED)) projectOrder.push(UNASSIGNED);

  const result: ProjectGroup[] = [];

  for (const pKey of projectOrder) {
    const dm = buckets.get(pKey);
    if (!dm) continue;

    const dirKeys = [...dm.keys()].sort((a, b) => {
      if (a === NO_DIRECTION) return 1;
      if (b === NO_DIRECTION) return -1;
      const ta = dirById.get(a)?.title ?? a;
      const tb = dirById.get(b)?.title ?? b;
      return ta.localeCompare(tb);
    });

    const directionGroups: DirectionGroup[] = [];
    for (const dk of dirKeys) {
      const list = dm.get(dk);
      if (!list?.length) continue;
      list.sort((a, b) => compareCreatedAt(a, b, ascending));
      const label =
        dk === NO_DIRECTION
          ? "No direction"
          : (dirById.get(dk)?.title ?? dk);
      directionGroups.push({
        directionId: dk === NO_DIRECTION ? null : dk,
        label,
        experiments: list,
      });
    }

    if (directionGroups.length === 0) continue;

    if (pKey === UNASSIGNED) {
      result.push({
        key: UNASSIGNED,
        projectId: null,
        label: "Unassigned",
        displayId: "Unassigned",
        directions: directionGroups,
      });
    } else {
      const proj = projectById.get(pKey);
      result.push({
        key: pKey,
        projectId: pKey,
        label: proj?.name ?? pKey,
        displayId: proj?.id ?? pKey,
        directions: directionGroups,
      });
    }
  }

  return result;
}

/** Depth-first experiment order for keyboard navigation (matches on-screen order). */
export function flattenExperimentsInTreeOrder(tree: ProjectGroup[]): ExperimentSummary[] {
  const out: ExperimentSummary[] = [];
  for (const pg of tree) {
    for (const dg of pg.directions) {
      out.push(...dg.experiments);
    }
  }
  return out;
}
