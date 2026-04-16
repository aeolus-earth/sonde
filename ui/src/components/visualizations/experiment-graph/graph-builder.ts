/**
 * Pure graph construction for the research map.
 *
 * The main React component feeds this function with normalized data
 * plus expansion / callback state and gets back ready-to-render
 * `{ nodes, edges }` that dagre has laid out. Extracted from
 * `experiment-graph.tsx` (1400+ LOC) so the graph logic is:
 *
 * 1. Unit-testable without mounting React Flow.
 * 2. Invariant-checked — no edge is ever returned whose source or
 *    target isn't also in `nodes`. That single invariant is the fix
 *    for the orphan-edge class of bug that produced the "floating
 *    line" artifacts on the map view.
 * 3. Free of the 19-parameter recursive mutation pattern — a single
 *    `BuildContext` object threads through the subtree builders.
 *
 * The builders here still push into shared `nodes[]` / `edges[]`
 * arrays because the tree can be deep and allocating intermediate
 * arrays per recursion would be wasteful. Shared arrays + a final
 * validation filter is the trade-off we picked.
 *
 * ── Measuring performance ─────────────────────────────────────────
 *
 * Dev builds emit `performance.mark` entries under the `sonde:` prefix:
 *   - `sonde:graph-build` — total time for `buildExperimentGraph`
 *   - `sonde:graph-layout` — time for dagre inside `layoutGraph`
 *
 * To profile a laggy toggle:
 *   1. `npm run dev` and open DevTools → Performance.
 *   2. Start recording, toggle a few times, stop.
 *   3. Check the "Timings" / User Timing lane for `sonde:graph-build`
 *      and `sonde:graph-layout` durations. >50ms per toggle at the
 *      N you're testing is worth investigating.
 *
 * Marks are no-ops when `import.meta.env.DEV` is false, so they
 * never ship to production.
 */

import dagre from "@dagrejs/dagre";
import type { Edge, Node } from "@xyflow/react";

import { sortFindingsByImportanceAndRecency } from "@/lib/finding-importance";
import type {
  DirectionSummary,
  ExperimentStatus,
  ExperimentSummary,
  Finding,
  ProjectSummary,
  QuestionSummary,
} from "@/types/sonde";

// ── Dev-only performance measurement ──────────────────────────────
// Emits `performance.mark` / `performance.measure` entries so
// DevTools → Performance → User Timing shows graph-build and
// dagre-layout costs. Zero cost in production builds.

const PERF_ENABLED =
  typeof performance !== "undefined" &&
  typeof import.meta !== "undefined" &&
  Boolean((import.meta as ImportMeta & { env?: { DEV?: boolean } }).env?.DEV);

function perfMeasure<T>(label: string, fn: () => T): T {
  if (!PERF_ENABLED) return fn();
  const startMark = `sonde:${label}:start`;
  const endMark = `sonde:${label}:end`;
  performance.mark(startMark);
  try {
    return fn();
  } finally {
    performance.mark(endMark);
    try {
      performance.measure(`sonde:${label}`, startMark, endMark);
    } catch {
      // Browsers that don't support measure() silently no-op.
    }
    // Keep the entry buffer from growing unbounded across long sessions.
    try {
      performance.clearMarks(startMark);
      performance.clearMarks(endMark);
    } catch {
      // Ignore.
    }
  }
}

// ── Public types ──────────────────────────────────────────────────

export type StatusColorMap = Record<ExperimentStatus, string>;

export interface NavigationHandlers {
  onExperimentOpen?: (id: string) => void;
  onQuestionOpen?: (id: string) => void;
  onDirectionOpen?: (id: string) => void;
  onFindingOpen?: (id: string) => void;
  onProjectOpen?: (id: string) => void;
}

/**
 * Factory functions the component supplies so the builder can obtain
 * a *stable* 0-arg callback per id. Why factories instead of raw
 * callbacks:
 *
 * If the builder wraps `toggle(id)` inline (`() => toggle(id)`) every
 * call, the wrapped closure is a fresh reference on every build. That
 * ends up in the node's `data` object → shallow-compare sees a
 * different `data` → `memo(NodeComponent)` can't skip the render →
 * every node re-renders on every toggle. For N=1000 that's 1000
 * wasted renders per user click.
 *
 * Factories returning cached-per-id closures let every build hand
 * React Flow the *same* `onToggle` reference for a given id as the
 * previous build, so the shallow compare passes and React skips the
 * un-needed render.
 *
 * Callers construct these with `useRef(new Map<string, () => void>())`
 * caches — see `experiment-graph.tsx` for the idiom.
 */
export interface HandlerFactories {
  toggleFor: (key: string) => () => void;
  openExperimentFor: (id: string) => () => void;
  openQuestionFor: (id: string) => () => void;
  openDirectionFor: (id: string) => () => void;
  openFindingFor: (id: string) => () => void;
  openProjectFor: (id: string) => () => void;
}

export interface BuildGraphInput {
  projects: ProjectSummary[];
  directions: DirectionSummary[];
  experiments: ExperimentSummary[];
  questions: QuestionSummary[];
  findings: Finding[];
  expanded: Set<string>;
  handlers: HandlerFactories;
  statusColor: StatusColorMap;
  borderColor: string;
  projectEdgeColor: string;
  knownProjectIds: Set<string>;
}

export interface BuildGraphOutput {
  nodes: Node[];
  edges: Edge[];
  /**
   * Edges whose source or target was not materialized into `nodes`.
   * Always 0 in steady state; >0 during loading when React Query hooks
   * arrive staggered. Surfaced so the caller can log / alarm if the
   * number is non-trivially non-zero in production.
   */
  droppedOrphanEdges: number;
}

// ── Node dimensions ───────────────────────────────────────────────

export const NODE_DIMENSIONS = {
  experiment: { w: 220, h: 76 },
  project: { w: 280, h: 56 },
  direction: { w: 260, h: 52 },
  question: { w: 240, h: 56 },
  finding: { w: 220, h: 70 },
  ungrouped: { w: 260, h: 52 },
} as const;

type NodeType = keyof typeof NODE_DIMENSIONS;

export function nodeBox(type: string | undefined): { w: number; h: number } {
  if (type && type in NODE_DIMENSIONS) {
    return NODE_DIMENSIONS[type as NodeType];
  }
  return NODE_DIMENSIONS.ungrouped;
}

// ── Dagre layout ──────────────────────────────────────────────────

export function layoutGraph(
  nodes: Node[],
  edges: Edge[],
): { nodes: Node[]; edges: Edge[] } {
  return perfMeasure("graph-layout", () => {
    const g = new dagre.graphlib.Graph();
    g.setDefaultEdgeLabel(() => ({}));
    g.setGraph({
      rankdir: "TB",
      ranksep: 88,
      nodesep: 44,
      marginx: 60,
      marginy: 60,
    });

    for (const node of nodes) {
      const { w, h } = nodeBox(node.type);
      g.setNode(node.id, { width: w + 20, height: h + 16 });
    }
    for (const edge of edges) {
      g.setEdge(edge.source, edge.target);
    }

    dagre.layout(g);

    return {
      nodes: nodes.map((node) => {
        const pos = g.node(node.id);
        const { w, h } = nodeBox(node.type);
        return {
          ...node,
          position: { x: pos.x - w / 2, y: pos.y - h / 2 },
        };
      }),
      edges,
    };
  });
}

// ── Index builders (pure) ─────────────────────────────────────────

export function countStatuses(
  exps: ExperimentSummary[],
): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const e of exps) counts[e.status] = (counts[e.status] ?? 0) + 1;
  return counts;
}

export function buildFindingsByExperiment(
  findings: Finding[],
): Map<string, Finding[]> {
  const map = new Map<string, Finding[]>();
  for (const finding of findings) {
    for (const experimentId of finding.evidence) {
      const list = map.get(experimentId) ?? [];
      list.push(finding);
      map.set(experimentId, list);
    }
  }
  for (const [experimentId, linkedFindings] of map.entries()) {
    map.set(experimentId, sortFindingsByImportanceAndRecency(linkedFindings));
  }
  return map;
}

export function buildChildMap(
  exps: ExperimentSummary[],
): Map<string, ExperimentSummary[]> {
  const map = new Map<string, ExperimentSummary[]>();
  for (const e of exps) {
    if (!e.parent_id) continue;
    if (!map.has(e.parent_id)) map.set(e.parent_id, []);
    map.get(e.parent_id)!.push(e);
  }
  return map;
}

export function buildDirectionsByParent(
  directions: DirectionSummary[],
): Map<string, DirectionSummary[]> {
  const map = new Map<string, DirectionSummary[]>();
  for (const direction of directions) {
    if (!direction.parent_direction_id) continue;
    const list = map.get(direction.parent_direction_id) ?? [];
    list.push(direction);
    map.set(direction.parent_direction_id, list);
  }
  for (const list of map.values()) {
    list.sort((a, b) => a.title.localeCompare(b.title));
  }
  return map;
}

export function buildDirectionsBySpawnExperiment(
  directions: DirectionSummary[],
): Map<string, DirectionSummary[]> {
  const map = new Map<string, DirectionSummary[]>();
  for (const direction of directions) {
    if (!direction.spawned_from_experiment_id) continue;
    const list = map.get(direction.spawned_from_experiment_id) ?? [];
    list.push(direction);
    map.set(direction.spawned_from_experiment_id, list);
  }
  for (const list of map.values()) {
    list.sort((a, b) => a.title.localeCompare(b.title));
  }
  return map;
}

export function buildExperimentsByDirection(
  experiments: ExperimentSummary[],
): Map<string, ExperimentSummary[]> {
  const map = new Map<string, ExperimentSummary[]>();
  for (const experiment of experiments) {
    if (!experiment.direction_id) continue;
    const list = map.get(experiment.direction_id) ?? [];
    list.push(experiment);
    map.set(experiment.direction_id, list);
  }
  return map;
}

export function buildQuestionsByDirection(
  questions: QuestionSummary[],
): Map<string, QuestionSummary[]> {
  const map = new Map<string, QuestionSummary[]>();
  for (const question of questions) {
    if (!question.direction_id) continue;
    const list = map.get(question.direction_id) ?? [];
    list.push(question);
    map.set(question.direction_id, list);
  }
  for (const list of map.values()) {
    list.sort((a, b) => a.created_at.localeCompare(b.created_at));
  }
  return map;
}

export function buildExperimentsByPrimaryQuestion(
  experiments: ExperimentSummary[],
): Map<string, ExperimentSummary[]> {
  const map = new Map<string, ExperimentSummary[]>();
  for (const experiment of experiments) {
    if (!experiment.primary_question_id) continue;
    const list = map.get(experiment.primary_question_id) ?? [];
    list.push(experiment);
    map.set(experiment.primary_question_id, list);
  }
  return map;
}

function rootExperimentsForGroup(
  experiments: ExperimentSummary[],
): ExperimentSummary[] {
  const ids = new Set(experiments.map((experiment) => experiment.id));
  return experiments.filter(
    (experiment) => !experiment.parent_id || !ids.has(experiment.parent_id),
  );
}

function visibleExperimentChildren(
  exp: ExperimentSummary,
  childMap: Map<string, ExperimentSummary[]>,
  directionsBySpawnExperiment: Map<string, DirectionSummary[]>,
): ExperimentSummary[] {
  const children = childMap.get(exp.id) ?? [];
  const spawnedDirections = directionsBySpawnExperiment.get(exp.id) ?? [];
  if (spawnedDirections.length === 0) return children;

  const spawnedDirectionIds = new Set(
    spawnedDirections.map((direction) => direction.id),
  );
  return children.filter(
    (child) =>
      !child.direction_id || !spawnedDirectionIds.has(child.direction_id),
  );
}

function countDescendants(
  exp: ExperimentSummary,
  childMap: Map<string, ExperimentSummary[]>,
  directionsBySpawnExperiment: Map<string, DirectionSummary[]>,
): number {
  const children = visibleExperimentChildren(
    exp,
    childMap,
    directionsBySpawnExperiment,
  );
  let count = children.length;
  for (const c of children) {
    count += countDescendants(c, childMap, directionsBySpawnExperiment);
  }
  return count;
}

function rootUnlinkedExperimentsForDirection(
  experiments: ExperimentSummary[],
): ExperimentSummary[] {
  return rootExperimentsForGroup(experiments).filter(
    (experiment) => !experiment.primary_question_id,
  );
}

export function projectNodeId(raw: string | null): string {
  return raw === null ? "proj-unassigned" : `proj-${raw}`;
}

/** Resolve a project FK to a known project row; orphan ids bucket with "unassigned". */
export function bucketProjectId(
  projectId: string | null | undefined,
  knownIds: Set<string>,
): string | null {
  if (projectId == null) return null;
  return knownIds.has(projectId) ? projectId : null;
}

// ── Subtree builders ──────────────────────────────────────────────
//
// `BuildContext` bundles the arguments every subtree builder needs so
// we stop threading 19 parameters through recursive calls. Callbacks
// and indexes are stable per render.

interface BuildContext {
  childMap: Map<string, ExperimentSummary[]>;
  directionsByParent: Map<string, DirectionSummary[]>;
  directionsBySpawnExperiment: Map<string, DirectionSummary[]>;
  experimentsByDirection: Map<string, ExperimentSummary[]>;
  questionsByDirection: Map<string, QuestionSummary[]>;
  experimentsByQuestion: Map<string, ExperimentSummary[]>;
  findingsByExperiment: Map<string, Finding[]>;
  renderedDirections: Set<string>;
  renderedExperiments: Set<string>;
  renderedQuestions: Set<string>;
  expanded: Set<string>;
  handlers: HandlerFactories;
  statusColor: StatusColorMap;
  borderColor: string;
}

function addExperimentSubtree(
  exp: ExperimentSummary,
  depth: number,
  parentNodeId: string,
  ctx: BuildContext,
  nodes: Node[],
  edges: Edge[],
): void {
  if (ctx.renderedExperiments.has(exp.id)) return;
  ctx.renderedExperiments.add(exp.id);

  const spawnedDirections = ctx.directionsBySpawnExperiment.get(exp.id) ?? [];
  const children = visibleExperimentChildren(
    exp,
    ctx.childMap,
    ctx.directionsBySpawnExperiment,
  );
  const findings = ctx.findingsByExperiment.get(exp.id) ?? [];
  const hasChildren =
    children.length > 0 || spawnedDirections.length > 0 || findings.length > 0;
  const isExpanded = ctx.expanded.has(exp.id);

  nodes.push({
    id: exp.id,
    type: "experiment",
    position: { x: 0, y: 0 },
    data: {
      ...exp,
      statusColors: ctx.statusColor,
      hasChildren,
      childCount:
        countDescendants(
          exp,
          ctx.childMap,
          ctx.directionsBySpawnExperiment,
        ) +
        spawnedDirections.length +
        findings.length,
      isExpanded,
      depth,
      onToggle: hasChildren ? ctx.handlers.toggleFor(exp.id) : undefined,
      onOpen: ctx.handlers.openExperimentFor(exp.id),
    } as Record<string, unknown>,
    draggable: true,
  });

  edges.push({
    id: `${parentNodeId}->${exp.id}`,
    source: parentNodeId,
    target: exp.id,
    type: "smoothstep",
    style: { stroke: ctx.borderColor, strokeWidth: 1 },
    animated: exp.status === "running",
  });

  if (!isExpanded) return;

  for (const finding of findings) {
    const findingNodeId = `finding-${finding.id}-for-${exp.id}`;
    nodes.push({
      id: findingNodeId,
      type: "finding",
      position: { x: 0, y: 0 },
      data: {
        ...finding,
        onOpen: ctx.handlers.openFindingFor(finding.id),
      } as Record<string, unknown>,
      draggable: true,
    });

    edges.push({
      id: `${exp.id}->${findingNodeId}`,
      source: exp.id,
      target: findingNodeId,
      type: "smoothstep",
      style: {
        stroke: ctx.borderColor,
        strokeWidth: 1,
        strokeDasharray: "3 3",
      },
    });
  }

  for (const direction of spawnedDirections) {
    addDirectionSubtree(direction, exp.id, ctx, nodes, edges);
  }

  for (const child of children) {
    addExperimentSubtree(child, depth + 1, exp.id, ctx, nodes, edges);
  }
}

function addQuestionSubtree(
  question: QuestionSummary,
  parentNodeId: string,
  ctx: BuildContext,
  nodes: Node[],
  edges: Edge[],
): void {
  if (ctx.renderedQuestions.has(question.id)) return;
  ctx.renderedQuestions.add(question.id);

  const headerId = `question-${question.id}`;
  const isExpanded = ctx.expanded.has(headerId);
  const questionExperiments = ctx.experimentsByQuestion.get(question.id) ?? [];
  const questionRoots = rootExperimentsForGroup(questionExperiments);
  const findingCount = question.linked_finding_count ?? 0;

  nodes.push({
    id: headerId,
    type: "question",
    position: { x: 0, y: 0 },
    data: {
      question: question.question,
      questionId: question.id,
      count: questionExperiments.length,
      findingCount,
      expanded: isExpanded,
      onToggle: ctx.handlers.toggleFor(headerId),
      onOpen: ctx.handlers.openQuestionFor(question.id),
    } as Record<string, unknown>,
    draggable: true,
  });

  edges.push({
    id: `${parentNodeId}->${headerId}`,
    source: parentNodeId,
    target: headerId,
    type: "smoothstep",
    style: { stroke: ctx.borderColor, strokeWidth: 1 },
  });

  if (!isExpanded) return;

  for (const experiment of questionRoots) {
    addExperimentSubtree(experiment, 0, headerId, ctx, nodes, edges);
  }
}

function addDirectionSubtree(
  direction: DirectionSummary,
  parentNodeId: string,
  ctx: BuildContext,
  nodes: Node[],
  edges: Edge[],
): void {
  if (ctx.renderedDirections.has(direction.id)) return;
  ctx.renderedDirections.add(direction.id);

  const headerId = `dir-${direction.id}`;
  const isExpanded = ctx.expanded.has(headerId);
  const directionExperiments =
    ctx.experimentsByDirection.get(direction.id) ?? [];
  const directionQuestions = ctx.questionsByDirection.get(direction.id) ?? [];
  const directionRoots =
    rootUnlinkedExperimentsForDirection(directionExperiments);

  nodes.push({
    id: headerId,
    type: "direction",
    position: { x: 0, y: 0 },
    data: {
      label: direction.title,
      dirId: direction.id,
      count: directionExperiments.length,
      expanded: isExpanded,
      statusCounts: countStatuses(directionExperiments),
      statusColors: ctx.statusColor,
      onToggle: ctx.handlers.toggleFor(headerId),
      onOpen: ctx.handlers.openDirectionFor(direction.id),
    } as Record<string, unknown>,
    draggable: true,
  });

  edges.push({
    id: `${parentNodeId}->${headerId}`,
    source: parentNodeId,
    target: headerId,
    type: "smoothstep",
    style: { stroke: ctx.borderColor, strokeWidth: 1 },
  });

  if (!isExpanded) return;

  for (const question of directionQuestions) {
    addQuestionSubtree(question, headerId, ctx, nodes, edges);
  }

  for (const experiment of directionRoots) {
    addExperimentSubtree(experiment, 0, headerId, ctx, nodes, edges);
  }

  const childDirections = ctx.directionsByParent.get(direction.id) ?? [];
  for (const childDirection of childDirections) {
    addDirectionSubtree(childDirection, headerId, ctx, nodes, edges);
  }
}

// ── Top-level entry point ─────────────────────────────────────────

/**
 * Build the research-map graph from normalized data + expansion state.
 *
 * Guarantees:
 *   1. Every edge in the returned `edges` array has a `source` and
 *      `target` that also appear in `nodes`. No orphan edges can
 *      reach React Flow.
 *   2. Node positions have been laid out by dagre (top-to-bottom).
 *   3. `droppedOrphanEdges` counts any edges that the subtree
 *      builders produced but that failed the final validation.
 *      >0 indicates a builder bug or a transient data-race; either
 *      way, the caller is free to log / alarm on it.
 */
export function buildExperimentGraph(
  input: BuildGraphInput,
): BuildGraphOutput {
  return perfMeasure("graph-build", () => buildExperimentGraphImpl(input));
}

function buildExperimentGraphImpl(input: BuildGraphInput): BuildGraphOutput {
  const {
    projects,
    directions,
    experiments,
    questions,
    findings,
    expanded,
    handlers,
    statusColor,
    borderColor,
    projectEdgeColor,
    knownProjectIds,
  } = input;

  // Derive all the lookup indexes in one place, then bundle them into
  // the ctx that subtree builders consume.
  const childMap = buildChildMap(experiments);
  const directionsByParent = buildDirectionsByParent(directions);
  const directionsBySpawnExperiment =
    buildDirectionsBySpawnExperiment(directions);
  const experimentsByDirection = buildExperimentsByDirection(experiments);
  const questionsByDirection = buildQuestionsByDirection(questions);
  const experimentsByQuestion = buildExperimentsByPrimaryQuestion(experiments);
  const findingsByExperiment = buildFindingsByExperiment(findings);
  const experimentIds = new Set(experiments.map((e) => e.id));

  const ctx: BuildContext = {
    childMap,
    directionsByParent,
    directionsBySpawnExperiment,
    experimentsByDirection,
    questionsByDirection,
    experimentsByQuestion,
    findingsByExperiment,
    renderedDirections: new Set(),
    renderedExperiments: new Set(),
    renderedQuestions: new Set(),
    expanded,
    handlers,
    statusColor,
    borderColor,
  };

  const isRoot = (e: ExperimentSummary): boolean =>
    !e.parent_id || !experimentIds.has(e.parent_id);

  const rawNodes: Node[] = [];
  const rawEdges: Edge[] = [];
  const projEdgeStyle = { stroke: projectEdgeColor, strokeWidth: 2 };

  const sortedProjects = [...projects].sort((a, b) =>
    a.name.localeCompare(b.name),
  );

  const needsUnassigned =
    directions.some(
      (d) => bucketProjectId(d.project_id, knownProjectIds) === null,
    ) ||
    experiments.some(
      (e) =>
        bucketProjectId(e.project_id, knownProjectIds) === null && isRoot(e),
    );

  type PEntry = { id: string | null; label: string };
  const entries: PEntry[] = sortedProjects.map((p) => ({
    id: p.id,
    label: p.name,
  }));
  if (needsUnassigned) {
    entries.push({ id: null, label: "Unassigned" });
  }

  for (const p of entries) {
    const bucketId = bucketProjectId(p.id, knownProjectIds);
    const pid = projectNodeId(bucketId);
    const isProjExpanded = expanded.has(pid);

    const allInProject = experiments.filter(
      (e) => bucketProjectId(e.project_id, knownProjectIds) === bucketId,
    );

    const dirsInProj = directions
      .filter(
        (d) =>
          bucketProjectId(d.project_id, knownProjectIds) === bucketId &&
          !d.parent_direction_id &&
          (!d.spawned_from_experiment_id ||
            !experimentIds.has(d.spawned_from_experiment_id)),
      )
      .sort((a, b) => a.title.localeCompare(b.title));

    rawNodes.push({
      id: pid,
      type: "project",
      position: { x: 0, y: 0 },
      data: {
        label: p.label,
        projectId: p.id,
        count: allInProject.length,
        directionCount: dirsInProj.length,
        expanded: isProjExpanded,
        onToggle: handlers.toggleFor(pid),
        onOpen: p.id === null ? undefined : handlers.openProjectFor(p.id),
      } as Record<string, unknown>,
      draggable: true,
    });

    if (!isProjExpanded) continue;

    for (const dir of dirsInProj) {
      addDirectionSubtree(dir, pid, ctx, rawNodes, rawEdges);
    }

    const noDirExps = experiments.filter(
      (e) =>
        isRoot(e) &&
        e.direction_id === null &&
        bucketProjectId(e.project_id, knownProjectIds) === bucketId,
    );

    if (noDirExps.length === 0) continue;

    const nodirId = `nodir-${pid}`;
    const isNodirExpanded = expanded.has(nodirId);

    rawNodes.push({
      id: nodirId,
      type: "ungrouped",
      position: { x: 0, y: 0 },
      data: {
        count: noDirExps.length,
        expanded: isNodirExpanded,
        statusCounts: countStatuses(noDirExps),
        statusColors: statusColor,
        onToggle: handlers.toggleFor(nodirId),
      } as Record<string, unknown>,
      draggable: true,
    });

    rawEdges.push({
      id: `${pid}->${nodirId}`,
      source: pid,
      target: nodirId,
      type: "smoothstep",
      style: projEdgeStyle,
    });

    if (!isNodirExpanded) continue;

    for (const exp of noDirExps) {
      addExperimentSubtree(exp, 0, nodirId, ctx, rawNodes, rawEdges);
    }
  }

  // Invariant filter — see module docstring. This is the single line of
  // defense against the orphan-edge class of bug. Every edge must have
  // both endpoints in the final node set; anything else gets dropped
  // and surfaced via `droppedOrphanEdges` for telemetry.
  const nodeIds = new Set(rawNodes.map((node) => node.id));
  const validEdges = rawEdges.filter(
    (edge) => nodeIds.has(edge.source) && nodeIds.has(edge.target),
  );
  const droppedOrphanEdges = rawEdges.length - validEdges.length;

  const laidOut = layoutGraph(rawNodes, validEdges);
  return {
    nodes: laidOut.nodes,
    edges: laidOut.edges,
    droppedOrphanEdges,
  };
}
