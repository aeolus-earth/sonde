import {
  useMemo,
  useCallback,
  useRef,
  useState,
  useEffect,
  memo,
  type KeyboardEvent,
} from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import {
  CheckSquare2,
  CircleHelp,
  ChevronDown,
  ChevronRight,
  Compass,
  FolderKanban,
  GitFork,
  Square,
} from "lucide-react";
import { FindingImportanceBadge } from "@/components/shared/finding-importance-badge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { InlineMarkdownText } from "@/components/shared/inline-markdown-text";
import { Input } from "@/components/ui/input";
import {
  useStatusChartColors,
  useThemeCssColors,
} from "@/hooks/use-theme-css-colors";
import {
  experimentMatchesSearchQuery,
  parseExperimentSearchTokens,
} from "@/lib/experiment-search-match";
import { sortFindingsByImportanceAndRecency } from "@/lib/finding-importance";
import {
  type FocusReasonMaps,
  isDirectFocusReason,
} from "@/lib/focus-mode";
import { cn } from "@/lib/utils";
import type {
  DirectionSummary,
  ExperimentStatus,
  ExperimentSummary,
  Finding,
  FindingConfidence,
  PruneSelection,
  ProjectSummary,
  QuestionSummary,
} from "@/types/sonde";

// ── Shared helpers (aligned with experiment-graph) ─────────────────

function countStatuses(exps: ExperimentSummary[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const e of exps) counts[e.status] = (counts[e.status] ?? 0) + 1;
  return counts;
}

function buildChildMap(
  exps: ExperimentSummary[],
): Map<string, ExperimentSummary[]> {
  const map = new Map<string, ExperimentSummary[]>();
  for (const e of exps) {
    if (e.parent_id) {
      if (!map.has(e.parent_id)) map.set(e.parent_id, []);
      map.get(e.parent_id)!.push(e);
    }
  }
  return map;
}

function buildDirectionsByParent(
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

function buildDirectionsBySpawnExperiment(
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

function buildExperimentsByDirection(
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

function buildQuestionsByDirection(
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

function buildExperimentsByPrimaryQuestion(
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

function projectNodeId(raw: string | null): string {
  return raw === null ? "proj-unassigned" : `proj-${raw}`;
}

function bucketProjectId(
  projectId: string | null | undefined,
  knownIds: Set<string>,
): string | null {
  if (projectId == null) return null;
  return knownIds.has(projectId) ? projectId : null;
}

function buildFindingsByExperiment(
  findings: Finding[],
): Map<string, Finding[]> {
  const map = new Map<string, Finding[]>();
  for (const f of findings) {
    for (const eid of f.evidence) {
      if (!map.has(eid)) map.set(eid, []);
      map.get(eid)!.push(f);
    }
  }
  for (const [experimentId, linkedFindings] of map.entries()) {
    map.set(experimentId, sortFindingsByImportanceAndRecency(linkedFindings));
  }
  return map;
}

function findingMatchesSearchQuery(f: Finding, rawQuery: string): boolean {
  const tokens = parseExperimentSearchTokens(rawQuery);
  if (tokens.length === 0) return true;
  return tokens.every((tok) => {
    const t = tok.toLowerCase();
    if (f.id.toLowerCase().includes(t)) return true;
    if (f.topic.toLowerCase().includes(t)) return true;
    if (f.finding.toLowerCase().includes(t)) return true;
    return false;
  });
}

/** When query is non-empty: experiments to show (matches + ancestors). Null = all experiments. */
function filterExperimentsForSearch(
  experiments: ExperimentSummary[],
  findings: Finding[],
  rawQuery: string,
): ExperimentSummary[] | null {
  const tokens = parseExperimentSearchTokens(rawQuery);
  if (tokens.length === 0) return null;

  const byId = new Map(experiments.map((e) => [e.id, e]));
  const directMatch = new Set<string>();

  for (const e of experiments) {
    if (experimentMatchesSearchQuery(e, rawQuery)) directMatch.add(e.id);
  }
  for (const f of findings) {
    if (!findingMatchesSearchQuery(f, rawQuery)) continue;
    for (const eid of f.evidence) {
      if (byId.has(eid)) directMatch.add(eid);
    }
  }

  const included = new Set<string>();

  function addAncestors(id: string) {
    let cur = byId.get(id);
    while (cur) {
      included.add(cur.id);
      if (!cur.parent_id || !byId.has(cur.parent_id)) break;
      cur = byId.get(cur.parent_id)!;
    }
  }

  for (const id of directMatch) {
    addAncestors(id);
    included.add(id);
  }

  return experiments.filter((e) => included.has(e.id));
}

// ── Row model ────────────────────────────────────────────────────

export type TreeNavigateTarget =
  | { kind: "experiment"; id: string }
  | { kind: "project"; id: string }
  | { kind: "direction"; id: string }
  | { kind: "question"; id: string }
  | { kind: "finding"; id: string };

export type TreeRowData =
  | {
      kind: "project";
      rowKey: string;
      depth: number;
      pid: string;
      label: string;
      projectId: string | null;
      directionCount: number;
      expCount: number;
      toggleKey: string;
    }
  | {
      kind: "direction";
      rowKey: string;
      depth: number;
      dir: DirectionSummary;
      expCount: number;
      statusCounts: Record<string, number>;
      toggleKey: string;
    }
  | {
      kind: "ungrouped";
      rowKey: string;
      depth: number;
      expCount: number;
      statusCounts: Record<string, number>;
      toggleKey: string;
    }
  | {
      kind: "question";
      rowKey: string;
      depth: number;
      question: QuestionSummary;
      expCount: number;
      toggleKey: string;
    }
  | {
      kind: "experiment";
      rowKey: string;
      depth: number;
      exp: ExperimentSummary;
      hasChildren: boolean;
      childCount: number;
      toggleKey: string;
      findings: Finding[];
    }
  | {
      kind: "sub-direction";
      rowKey: string;
      depth: number;
      dir: DirectionSummary;
      parentKind: "direction" | "experiment";
      expCount: number;
      statusCounts: Record<string, number>;
      toggleKey: string;
    };

const ROW_H = 40;

function confidenceVariant(c: FindingConfidence): FindingConfidence {
  return c;
}

// ── Flat row builder ───────────────────────────────────────────────

type RenderedTreeEntities = {
  directions: Set<string>;
  experiments: Set<string>;
  questions: Set<string>;
};

function addExperimentRows(
  exp: ExperimentSummary,
  depth: number,
  childMap: Map<string, ExperimentSummary[]>,
  collapsed: Set<string>,
  findingsByExp: Map<string, Finding[]>,
  directionsByParent: Map<string, DirectionSummary[]>,
  directionsBySpawnExperiment: Map<string, DirectionSummary[]>,
  experimentsByDirection: Map<string, ExperimentSummary[]>,
  questionsByDirection: Map<string, QuestionSummary[]>,
  experimentsByQuestion: Map<string, ExperimentSummary[]>,
  rendered: RenderedTreeEntities,
  rows: TreeRowData[],
) {
  if (rendered.experiments.has(exp.id)) return;
  rendered.experiments.add(exp.id);

  const spawnedDirections = directionsBySpawnExperiment.get(exp.id) ?? [];
  const children = visibleExperimentChildren(
    exp,
    childMap,
    directionsBySpawnExperiment,
  );
  const hasChildren = children.length > 0 || spawnedDirections.length > 0;
  const isCollapsed = collapsed.has(exp.id);
  const childCount =
    countDescendants(exp, childMap, directionsBySpawnExperiment) +
    spawnedDirections.length;

  rows.push({
    kind: "experiment",
    rowKey: `exp-${exp.id}`,
    depth,
    exp,
    hasChildren,
    childCount,
    toggleKey: exp.id,
    findings: findingsByExp.get(exp.id) ?? [],
  });

  if (!isCollapsed) {
    for (const direction of spawnedDirections) {
      addDirectionRows(
        direction,
        depth + 1,
        "experiment",
        childMap,
        collapsed,
        findingsByExp,
        directionsByParent,
        directionsBySpawnExperiment,
        experimentsByDirection,
        questionsByDirection,
        experimentsByQuestion,
        rendered,
        rows,
      );
    }
  }

  if (hasChildren && !isCollapsed) {
    for (const c of children) {
      addExperimentRows(
        c,
        depth + 1,
        childMap,
        collapsed,
        findingsByExp,
        directionsByParent,
        directionsBySpawnExperiment,
        experimentsByDirection,
        questionsByDirection,
        experimentsByQuestion,
        rendered,
        rows,
      );
    }
  }
}

function addQuestionRows(
  question: QuestionSummary,
  depth: number,
  childMap: Map<string, ExperimentSummary[]>,
  collapsed: Set<string>,
  findingsByExp: Map<string, Finding[]>,
  directionsByParent: Map<string, DirectionSummary[]>,
  directionsBySpawnExperiment: Map<string, DirectionSummary[]>,
  experimentsByDirection: Map<string, ExperimentSummary[]>,
  questionsByDirection: Map<string, QuestionSummary[]>,
  experimentsByQuestion: Map<string, ExperimentSummary[]>,
  rendered: RenderedTreeEntities,
  rows: TreeRowData[],
) {
  if (rendered.questions.has(question.id)) return;
  rendered.questions.add(question.id);

  const questionExperiments = experimentsByQuestion.get(question.id) ?? [];
  const questionRoots = rootExperimentsForGroup(questionExperiments);
  const toggleKey = `question-${question.id}`;

  rows.push({
    kind: "question",
    rowKey: toggleKey,
    depth,
    question,
    expCount: questionExperiments.length,
    toggleKey,
  });

  if (collapsed.has(toggleKey)) return;

  for (const experiment of questionRoots) {
    addExperimentRows(
      experiment,
      depth + 1,
      childMap,
      collapsed,
      findingsByExp,
      directionsByParent,
      directionsBySpawnExperiment,
      experimentsByDirection,
      questionsByDirection,
      experimentsByQuestion,
      rendered,
      rows,
    );
  }
}

function addDirectionRows(
  dir: DirectionSummary,
  depth: number,
  parentKind: "direction" | "experiment",
  childMap: Map<string, ExperimentSummary[]>,
  collapsed: Set<string>,
  findingsByExp: Map<string, Finding[]>,
  directionsByParent: Map<string, DirectionSummary[]>,
  directionsBySpawnExperiment: Map<string, DirectionSummary[]>,
  experimentsByDirection: Map<string, ExperimentSummary[]>,
  questionsByDirection: Map<string, QuestionSummary[]>,
  experimentsByQuestion: Map<string, ExperimentSummary[]>,
  rendered: RenderedTreeEntities,
  rows: TreeRowData[],
) {
  if (rendered.directions.has(dir.id)) return;
  rendered.directions.add(dir.id);

  const directionExperiments = experimentsByDirection.get(dir.id) ?? [];
  const directionQuestions = questionsByDirection.get(dir.id) ?? [];
  const directionRoots =
    rootUnlinkedExperimentsForDirection(directionExperiments);
  const toggleKey = `dir-${dir.id}`;

  rows.push({
    kind: "sub-direction",
    rowKey: toggleKey,
    depth,
    dir,
    parentKind,
    expCount: directionExperiments.length,
    statusCounts: countStatuses(directionExperiments),
    toggleKey,
  });

  if (collapsed.has(toggleKey)) return;

  for (const question of directionQuestions) {
    addQuestionRows(
      question,
      depth + 1,
      childMap,
      collapsed,
      findingsByExp,
      directionsByParent,
      directionsBySpawnExperiment,
      experimentsByDirection,
      questionsByDirection,
      experimentsByQuestion,
      rendered,
      rows,
    );
  }

  for (const experiment of directionRoots) {
    addExperimentRows(
      experiment,
      depth + 1,
      childMap,
      collapsed,
      findingsByExp,
      directionsByParent,
      directionsBySpawnExperiment,
      experimentsByDirection,
      questionsByDirection,
      experimentsByQuestion,
      rendered,
      rows,
    );
  }

  const childDirections = directionsByParent.get(dir.id) ?? [];
  for (const childDir of childDirections) {
    addDirectionRows(
      childDir,
      depth + 1,
      "direction",
      childMap,
      collapsed,
      findingsByExp,
      directionsByParent,
      directionsBySpawnExperiment,
      experimentsByDirection,
      questionsByDirection,
      experimentsByQuestion,
      rendered,
      rows,
    );
  }
}

export interface BuildResearchTreeRowsInput {
  experiments: ExperimentSummary[];
  directions: DirectionSummary[];
  projects: ProjectSummary[];
  findings: Finding[];
  questions: QuestionSummary[];
  collapsed: Set<string>;
  search: string;
}

// eslint-disable-next-line react-refresh/only-export-components
export function buildResearchTreeRows({
  experiments,
  directions,
  projects,
  findings,
  questions,
  collapsed,
  search,
}: BuildResearchTreeRowsInput): TreeRowData[] {
  const rows: TreeRowData[] = [];
  const rendered: RenderedTreeEntities = {
    directions: new Set(),
    experiments: new Set(),
    questions: new Set(),
  };
  const isFiltering = search.trim().length > 0;
  const experimentIds = new Set(experiments.map((e) => e.id));
  const knownProjectIds = new Set(projects.map((p) => p.id));
  const isRoot = (e: ExperimentSummary) =>
    !e.parent_id || !experimentIds.has(e.parent_id);
  const findingsByExp = buildFindingsByExperiment(findings);
  const directionsByParent = buildDirectionsByParent(directions);
  const directionsBySpawnExperiment =
    buildDirectionsBySpawnExperiment(directions);
  const questionsByDirection = buildQuestionsByDirection(questions);
  const experimentsForTree =
    filterExperimentsForSearch(experiments, findings, search) ?? experiments;
  const childMapFiltered = buildChildMap(experimentsForTree);
  const experimentsByDirection =
    buildExperimentsByDirection(experimentsForTree);
  const experimentsByQuestion =
    buildExperimentsByPrimaryQuestion(experimentsForTree);

  const sortedProjects = [...projects].sort((a, b) =>
    a.name.localeCompare(b.name),
  );
  const needsUnassigned =
    directions.some(
      (d) => bucketProjectId(d.project_id, knownProjectIds) === null,
    ) ||
    experimentsForTree.some(
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
    const projCollapsed = collapsed.has(pid);

    const dirsInProj = directions
      .filter(
        (d) =>
          bucketProjectId(d.project_id, knownProjectIds) === bucketId &&
          !d.parent_direction_id &&
          (!d.spawned_from_experiment_id ||
            !experimentIds.has(d.spawned_from_experiment_id)),
      )
      .sort((a, b) => a.title.localeCompare(b.title));

    const allInProject = experimentsForTree.filter(
      (e) => bucketProjectId(e.project_id, knownProjectIds) === bucketId,
    );

    if (isFiltering && allInProject.length === 0) continue;

    rows.push({
      kind: "project",
      rowKey: pid,
      depth: 0,
      pid,
      label: p.label,
      projectId: p.id,
      directionCount: dirsInProj.length,
      expCount: allInProject.length,
      toggleKey: pid,
    });

    if (projCollapsed) continue;

    for (const dir of dirsInProj) {
      const headerId = `dir-${dir.id}`;
      const dirCollapsed = collapsed.has(headerId);
      const allInDirection = experimentsByDirection.get(dir.id) ?? [];
      const rootExps = rootUnlinkedExperimentsForDirection(allInDirection);

      if (isFiltering && allInDirection.length === 0) continue;
      if (rendered.directions.has(dir.id)) continue;
      rendered.directions.add(dir.id);

      rows.push({
        kind: "direction",
        rowKey: headerId,
        depth: 1,
        dir,
        expCount: allInDirection.length,
        statusCounts: countStatuses(allInDirection),
        toggleKey: headerId,
      });

      if (dirCollapsed) continue;

      for (const question of questionsByDirection.get(dir.id) ?? []) {
        addQuestionRows(
          question,
          2,
          childMapFiltered,
          collapsed,
          findingsByExp,
          directionsByParent,
          directionsBySpawnExperiment,
          experimentsByDirection,
          questionsByDirection,
          experimentsByQuestion,
          rendered,
          rows,
        );
      }

      for (const exp of rootExps) {
        addExperimentRows(
          exp,
          2,
          childMapFiltered,
          collapsed,
          findingsByExp,
          directionsByParent,
          directionsBySpawnExperiment,
          experimentsByDirection,
          questionsByDirection,
          experimentsByQuestion,
          rendered,
          rows,
        );
      }

      const childDirs = directionsByParent.get(dir.id) ?? [];
      for (const childDir of childDirs) {
        const subDirExps = experimentsByDirection.get(childDir.id) ?? [];
        if (isFiltering && subDirExps.length === 0) continue;
        addDirectionRows(
          childDir,
          2,
          "direction",
          childMapFiltered,
          collapsed,
          findingsByExp,
          directionsByParent,
          directionsBySpawnExperiment,
          experimentsByDirection,
          questionsByDirection,
          experimentsByQuestion,
          rendered,
          rows,
        );
      }
    }

    const noDirExps = experimentsForTree.filter(
      (e) =>
        isRoot(e) &&
        e.direction_id === null &&
        bucketProjectId(e.project_id, knownProjectIds) === bucketId,
    );

    if (noDirExps.length > 0) {
      const nodirId = `nodir-${pid}`;
      const nodirCollapsed = collapsed.has(nodirId);

      rows.push({
        kind: "ungrouped",
        rowKey: nodirId,
        depth: 1,
        expCount: noDirExps.length,
        statusCounts: countStatuses(noDirExps),
        toggleKey: nodirId,
      });

      if (!nodirCollapsed) {
        for (const exp of noDirExps) {
          addExperimentRows(
            exp,
            2,
            childMapFiltered,
            collapsed,
            findingsByExp,
            directionsByParent,
            directionsBySpawnExperiment,
            experimentsByDirection,
            questionsByDirection,
            experimentsByQuestion,
            rendered,
            rows,
          );
        }
      }
    }
  }

  return rows;
}

export interface ResearchTreeProps {
  experiments: ExperimentSummary[];
  directions: DirectionSummary[];
  projects: ProjectSummary[];
  findings: Finding[];
  questions: QuestionSummary[];
  expansionResetKey?: string | null;
  manageMode?: boolean;
  selection?: PruneSelection;
  focusMode?: boolean;
  focusReasons?: FocusReasonMaps | null;
  onToggleQuestionSelection?: (questionId: string) => void;
  onToggleExperimentSelection?: (experimentId: string) => void;
  onToggleFindingSelection?: (findingId: string) => void;
  onNavigate: (target: TreeNavigateTarget) => void;
}

const EMPTY_SELECTION: PruneSelection = {
  questions: [],
  findings: [],
  experiments: [],
};

export const ResearchTree = memo(function ResearchTree({
  experiments,
  directions,
  projects,
  findings,
  questions,
  expansionResetKey,
  manageMode = false,
  selection = EMPTY_SELECTION,
  focusMode = false,
  focusReasons = null,
  onToggleQuestionSelection,
  onToggleExperimentSelection,
  onToggleFindingSelection,
  onNavigate,
}: ResearchTreeProps) {
  const colors = useThemeCssColors();
  const statusColor = useStatusChartColors();

  const [search, setSearch] = useState("");
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());
  const [focusedIndex, setFocusedIndex] = useState(-1);
  const scrollRef = useRef<HTMLDivElement>(null);
  const didAutoCollapse = useRef(false);

  const experimentIds = useMemo(
    () => new Set(experiments.map((e) => e.id)),
    [experiments],
  );
  const knownProjectIds = useMemo(
    () => new Set(projects.map((p) => p.id)),
    [projects],
  );
  const selectedQuestions = useMemo(
    () => new Set(selection.questions),
    [selection.questions],
  );
  const selectedFindings = useMemo(
    () => new Set(selection.findings),
    [selection.findings],
  );
  const selectedExperiments = useMemo(
    () => new Set(selection.experiments),
    [selection.experiments],
  );
  const isDirectProject = useCallback(
    (projectId: string | null) =>
      !focusMode ||
      (projectId !== null &&
        isDirectFocusReason(focusReasons?.projects.get(projectId))),
    [focusMode, focusReasons],
  );
  const isDirectDirection = useCallback(
    (directionId: string) =>
      !focusMode ||
      isDirectFocusReason(focusReasons?.directions.get(directionId)),
    [focusMode, focusReasons],
  );
  const isDirectQuestion = useCallback(
    (questionId: string) =>
      !focusMode || isDirectFocusReason(focusReasons?.questions.get(questionId)),
    [focusMode, focusReasons],
  );
  const isDirectExperiment = useCallback(
    (experimentId: string) =>
      !focusMode ||
      isDirectFocusReason(focusReasons?.experiments.get(experimentId)),
    [focusMode, focusReasons],
  );
  const isDirectFinding = useCallback(
    (findingId: string) =>
      !focusMode || isDirectFocusReason(focusReasons?.findings.get(findingId)),
    [focusMode, focusReasons],
  );

  const isRoot = useCallback(
    (e: ExperimentSummary) => !e.parent_id || !experimentIds.has(e.parent_id),
    [experimentIds],
  );

  useEffect(() => {
    setFocusedIndex(-1);
  }, [search, experiments.length, findings.length]);

  useEffect(() => {
    if (expansionResetKey === undefined) return;
    setCollapsed(new Set());
    setFocusedIndex(-1);
  }, [expansionResetKey]);

  useEffect(() => {
    if (didAutoCollapse.current) return;
    if (experiments.length === 0) return;
    const est = projects.length + directions.length + experiments.length;
    if (est > 120) {
      const sortedProjects = [...projects].sort((a, b) =>
        a.name.localeCompare(b.name),
      );
      const needsUnassigned =
        directions.some(
          (d) => bucketProjectId(d.project_id, knownProjectIds) === null,
        ) ||
        experiments.some(
          (e) =>
            bucketProjectId(e.project_id, knownProjectIds) === null &&
            isRoot(e),
        );
      type PEntry = { id: string | null; label: string };
      const entries: PEntry[] = sortedProjects.map((p) => ({
        id: p.id,
        label: p.name,
      }));
      if (needsUnassigned) entries.push({ id: null, label: "Unassigned" });
      if (entries.length > 1) {
        const collapseKeys = entries.slice(1).map((p) => {
          const bucketId = bucketProjectId(p.id, knownProjectIds);
          return projectNodeId(bucketId);
        });
        setCollapsed((prev) => {
          const next = new Set(prev);
          for (const k of collapseKeys) next.add(k);
          return next;
        });
      }
    }
    didAutoCollapse.current = true;
  }, [experiments, projects, directions, knownProjectIds, isRoot]);

  const flatRows = useMemo(
    () =>
      buildResearchTreeRows({
        projects,
        directions,
        experiments,
        findings,
        questions,
        collapsed,
        search,
      }),
    [projects, directions, experiments, findings, questions, collapsed, search],
  );

  const toggle = useCallback((key: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  const virtualizer = useVirtualizer({
    count: flatRows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_H,
    overscan: 24,
  });

  useEffect(() => {
    if (focusedIndex < 0) return;
    virtualizer.scrollToIndex(focusedIndex, { align: "auto" });
  }, [focusedIndex, virtualizer]);

  const activateRow = useCallback(
    (row: TreeRowData) => {
      if (manageMode && row.kind === "question" && isDirectQuestion(row.question.id)) {
        onToggleQuestionSelection?.(row.question.id);
        return;
      }
      if (manageMode && row.kind === "experiment" && isDirectExperiment(row.exp.id)) {
        onToggleExperimentSelection?.(row.exp.id);
        return;
      }
      if (row.kind === "project") {
        if (row.projectId) onNavigate({ kind: "project", id: row.projectId });
      } else if (row.kind === "direction" || row.kind === "sub-direction") {
        onNavigate({ kind: "direction", id: row.dir.id });
      } else if (row.kind === "question") {
        onNavigate({ kind: "question", id: row.question.id });
      } else if (row.kind === "ungrouped") {
        return;
      } else {
        onNavigate({ kind: "experiment", id: row.exp.id });
      }
    },
    [
      manageMode,
      onNavigate,
      onToggleExperimentSelection,
      onToggleQuestionSelection,
      isDirectExperiment,
      isDirectQuestion,
    ],
  );

  const onKeyDown = useCallback(
    (e: KeyboardEvent<HTMLDivElement>) => {
      const t = e.target as HTMLElement;
      if (
        t.tagName === "INPUT" ||
        t.tagName === "TEXTAREA" ||
        t.isContentEditable
      ) {
        return;
      }

      const rows = flatRows;
      if (rows.length === 0) return;

      if (e.key === "ArrowDown") {
        e.preventDefault();
        setFocusedIndex((i) => Math.min(i < 0 ? 0 : i + 1, rows.length - 1));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setFocusedIndex((i) => Math.max((i < 0 ? 0 : i) - 1, 0));
      } else if (e.key === "Enter" && focusedIndex >= 0) {
        e.preventDefault();
        activateRow(rows[focusedIndex]);
      } else if (e.key === "ArrowRight" && focusedIndex >= 0) {
        e.preventDefault();
        const row = rows[focusedIndex];
        if (
          row.kind === "project" ||
          row.kind === "direction" ||
          row.kind === "question" ||
          row.kind === "ungrouped"
        ) {
          setCollapsed((prev) => {
            const next = new Set(prev);
            next.delete(row.toggleKey);
            return next;
          });
        } else if (row.kind === "experiment" && row.hasChildren) {
          setCollapsed((prev) => {
            const next = new Set(prev);
            next.delete(row.toggleKey);
            return next;
          });
        }
      } else if (e.key === "ArrowLeft" && focusedIndex >= 0) {
        e.preventDefault();
        const row = rows[focusedIndex];
        if (
          row.kind === "project" ||
          row.kind === "direction" ||
          row.kind === "question" ||
          row.kind === "ungrouped"
        ) {
          setCollapsed((prev) => new Set(prev).add(row.toggleKey));
        } else if (row.kind === "experiment" && row.hasChildren) {
          setCollapsed((prev) => new Set(prev).add(row.toggleKey));
        }
      }
    },
    [activateRow, flatRows, focusedIndex],
  );

  const pad = (depth: number) => ({ paddingLeft: 8 + depth * 20 });

  const renderRow = (row: TreeRowData, index: number) => {
    const focused = focusedIndex === index;
    const questionSelected =
      row.kind === "question" && selectedQuestions.has(row.question.id);
    const experimentSelected =
      row.kind === "experiment" && selectedExperiments.has(row.exp.id);
    const projectContext =
      row.kind === "project" && focusMode && !isDirectProject(row.projectId);
    const directionContext =
      (row.kind === "direction" || row.kind === "sub-direction") &&
      focusMode &&
      !isDirectDirection(row.dir.id);
    const questionContext =
      row.kind === "question" && focusMode && !isDirectQuestion(row.question.id);
    const experimentContext =
      row.kind === "experiment" &&
      focusMode &&
      !isDirectExperiment(row.exp.id);

    if (row.kind === "project") {
      const expanded = !collapsed.has(row.toggleKey);
      return (
        <div
          key={row.rowKey}
          role="row"
          tabIndex={0}
          onClick={() => {
            setFocusedIndex(index);
            toggle(row.toggleKey);
          }}
          onDoubleClick={(e) => {
            e.stopPropagation();
            if (row.projectId)
              onNavigate({ kind: "project", id: row.projectId });
          }}
          onKeyDown={(e) => {
            if (e.key === " ") {
              e.preventDefault();
              toggle(row.toggleKey);
            }
          }}
          className={cn(
            "flex cursor-pointer items-center gap-2 border-b border-border-subtle pr-2 text-left transition-colors",
            focused
              ? "bg-surface-hover ring-1 ring-inset ring-accent"
              : "hover:bg-surface-hover/80",
            projectContext && "opacity-60",
          )}
          style={{ ...pad(row.depth), minHeight: ROW_H }}
        >
          <span className="text-text-quaternary">
            {expanded ? (
              <ChevronDown className="h-3.5 w-3.5" />
            ) : (
              <ChevronRight className="h-3.5 w-3.5" />
            )}
          </span>
          <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-[4px] border border-border-subtle bg-surface-raised text-text-secondary">
            <FolderKanban className="h-3.5 w-3.5" />
          </span>
          <div className="min-w-0 flex-1">
            <div className="truncate text-[12px] font-semibold text-text">
              {row.label}
            </div>
            <div className="mt-0.5 flex flex-wrap items-center gap-2">
              {row.projectId && (
                <span className="font-mono text-[10px] text-text-quaternary">
                  {row.projectId}
                </span>
              )}
              <span className="text-[10px] text-text-quaternary">
                {row.directionCount} dir · {row.expCount} exp
              </span>
            </div>
          </div>
        </div>
      );
    }

    if (row.kind === "direction") {
      const expanded = !collapsed.has(row.toggleKey);
      return (
        <div
          key={row.rowKey}
          role="row"
          tabIndex={0}
          onClick={() => {
            setFocusedIndex(index);
            toggle(row.toggleKey);
          }}
          onDoubleClick={(e) => {
            e.stopPropagation();
            onNavigate({ kind: "direction", id: row.dir.id });
          }}
          onKeyDown={(e) => {
            if (e.key === " ") {
              e.preventDefault();
              toggle(row.toggleKey);
            }
          }}
          className={cn(
            "flex cursor-pointer items-center gap-2 border-b border-border-subtle border-l-[3px] border-l-accent/40 pr-2 text-left transition-colors",
            focused
              ? "bg-surface-hover ring-1 ring-inset ring-accent"
              : "hover:bg-surface-hover/80",
            directionContext && "opacity-60",
          )}
          style={{ ...pad(row.depth), minHeight: ROW_H }}
        >
          <span className="text-accent">
            {expanded ? (
              <ChevronDown className="h-3.5 w-3.5" />
            ) : (
              <ChevronRight className="h-3.5 w-3.5" />
            )}
          </span>
          <Compass className="h-3.5 w-3.5 shrink-0 text-accent" />
          <div className="min-w-0 flex-1">
            <div className="truncate text-[12px] font-medium text-text">
              {row.dir.title}
            </div>
            <div className="mt-0.5 flex flex-wrap items-center gap-2">
              <span className="font-mono text-[10px] text-text-quaternary">
                {row.dir.id}
              </span>
              <div className="flex items-center gap-1.5">
                {Object.entries(row.statusCounts).map(([status, count]) => (
                  <span
                    key={status}
                    className="flex items-center gap-0.5 text-[10px]"
                    style={{
                      color:
                        statusColor[status as ExperimentStatus] ??
                        colors.textQuaternary,
                    }}
                  >
                    <span className="inline-block h-[5px] w-[5px] rounded-full bg-current" />
                    {count}
                  </span>
                ))}
              </div>
            </div>
          </div>
        </div>
      );
    }

    if (row.kind === "sub-direction") {
      const expanded = !collapsed.has(row.toggleKey);
      return (
        <div
          key={row.rowKey}
          role="row"
          tabIndex={0}
          onClick={() => {
            setFocusedIndex(index);
            toggle(row.toggleKey);
          }}
          onDoubleClick={(e) => {
            e.stopPropagation();
            onNavigate({ kind: "direction", id: row.dir.id });
          }}
          onKeyDown={(e) => {
            if (e.key === " ") {
              e.preventDefault();
              toggle(row.toggleKey);
            }
          }}
          className={cn(
            "flex cursor-pointer items-center gap-2 border-b border-border-subtle border-l-[3px] border-l-accent/60 pr-2 text-left transition-colors",
            focused
              ? "bg-surface-hover ring-1 ring-inset ring-accent"
              : "hover:bg-surface-hover/80",
            directionContext && "opacity-60",
          )}
          style={{ ...pad(row.depth), minHeight: ROW_H }}
        >
          <span className="text-accent">
            {expanded ? (
              <ChevronDown className="h-3.5 w-3.5" />
            ) : (
              <ChevronRight className="h-3.5 w-3.5" />
            )}
          </span>
          <GitFork className="h-3.5 w-3.5 shrink-0 text-accent" />
          <div className="min-w-0 flex-1">
            <div className="truncate text-[12px] font-medium text-text">
              {row.dir.title}
            </div>
            <div className="mt-0.5 flex flex-wrap items-center gap-2">
              <span className="font-mono text-[10px] text-text-quaternary">
                {row.dir.id}
              </span>
              {row.parentKind === "experiment" && (
                <span className="text-[10px] text-text-quaternary">
                  spawned from experiment
                </span>
              )}
              <div className="flex items-center gap-1.5">
                {Object.entries(row.statusCounts).map(([status, count]) => (
                  <span
                    key={status}
                    className="flex items-center gap-0.5 text-[10px]"
                    style={{
                      color:
                        statusColor[status as ExperimentStatus] ??
                        colors.textQuaternary,
                    }}
                  >
                    <span className="inline-block h-[5px] w-[5px] rounded-full bg-current" />
                    {count}
                  </span>
                ))}
              </div>
            </div>
          </div>
        </div>
      );
    }

    if (row.kind === "question") {
      const expanded = !collapsed.has(row.toggleKey);
      return (
        <div
          key={row.rowKey}
          role="row"
          tabIndex={0}
          onClick={() => {
            setFocusedIndex(index);
            if (manageMode) {
              if (questionContext) return;
              onToggleQuestionSelection?.(row.question.id);
              return;
            }
            toggle(row.toggleKey);
          }}
          onDoubleClick={(event) => {
            event.stopPropagation();
            onNavigate({ kind: "question", id: row.question.id });
          }}
          onKeyDown={(event) => {
            if (manageMode && (event.key === " " || event.key === "Enter")) {
              event.preventDefault();
              if (questionContext) return;
              onToggleQuestionSelection?.(row.question.id);
              return;
            }
            if (event.key === " ") {
              event.preventDefault();
              toggle(row.toggleKey);
            }
          }}
          className={cn(
            "flex cursor-pointer items-center gap-2 border-b border-border-subtle pr-2 text-left transition-colors",
            questionSelected
              ? "bg-accent/10 ring-1 ring-inset ring-accent"
              : focused
              ? "bg-surface-hover ring-1 ring-inset ring-accent"
              : "hover:bg-surface-hover/80",
            questionContext && "opacity-60",
          )}
          style={{ ...pad(row.depth), minHeight: ROW_H }}
        >
          <button
            type="button"
            className="shrink-0 rounded p-0.5 text-text-tertiary hover:bg-surface-raised hover:text-text-secondary"
            aria-label={expanded ? "Collapse question" : "Expand question"}
            onClick={(event) => {
              event.stopPropagation();
              setFocusedIndex(index);
              toggle(row.toggleKey);
            }}
          >
            {expanded ? (
              <ChevronDown className="h-3.5 w-3.5" />
            ) : (
              <ChevronRight className="h-3.5 w-3.5" />
            )}
          </button>
          {manageMode && !questionContext ? (
            questionSelected ? (
              <CheckSquare2 className="h-3.5 w-3.5 shrink-0 text-accent" />
            ) : (
              <Square className="h-3.5 w-3.5 shrink-0 text-text-tertiary" />
            )
          ) : null}
          <CircleHelp className="h-3.5 w-3.5 shrink-0 text-text-tertiary" />
          <div className="min-w-0 flex-1">
            <div className="truncate text-[12px] font-medium text-text">
              {row.question.question}
            </div>
            <div className="mt-0.5 flex flex-wrap items-center gap-2">
              <span className="font-mono text-[10px] text-text-quaternary">
                {row.question.id}
              </span>
              <span className="text-[10px] text-text-quaternary">
                {row.expCount} exp · {row.question.linked_finding_count}{" "}
                findings
              </span>
            </div>
          </div>
          {manageMode ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="shrink-0"
              onClick={(event) => {
                event.stopPropagation();
                onNavigate({ kind: "question", id: row.question.id });
              }}
            >
              Open
            </Button>
          ) : null}
        </div>
      );
    }

    if (row.kind === "ungrouped") {
      const expanded = !collapsed.has(row.toggleKey);
      return (
        <div
          key={row.rowKey}
          role="row"
          tabIndex={0}
          onClick={() => {
            setFocusedIndex(index);
            toggle(row.toggleKey);
          }}
          onKeyDown={(e) => {
            if (e.key === " ") {
              e.preventDefault();
              toggle(row.toggleKey);
            }
          }}
          className={cn(
            "flex cursor-pointer items-center gap-2 border-b border-border-subtle pr-2 text-left transition-colors",
            focused
              ? "bg-surface-hover ring-1 ring-inset ring-accent"
              : "hover:bg-surface-hover/80",
            focusMode && "opacity-60",
          )}
          style={{ ...pad(row.depth), minHeight: ROW_H }}
        >
          <span className="text-text-tertiary">
            {expanded ? (
              <ChevronDown className="h-3.5 w-3.5" />
            ) : (
              <ChevronRight className="h-3.5 w-3.5" />
            )}
          </span>
          <div className="min-w-0 flex-1">
            <div className="text-[12px] font-medium italic text-text-secondary">
              No direction
            </div>
            <div className="mt-0.5 flex items-center gap-1.5">
              {Object.entries(row.statusCounts).map(([status, count]) => (
                <span
                  key={status}
                  className="flex items-center gap-0.5 text-[10px]"
                  style={{
                    color:
                      statusColor[status as ExperimentStatus] ??
                      colors.textQuaternary,
                  }}
                >
                  <span className="inline-block h-[5px] w-[5px] rounded-full bg-current" />
                  {count}
                </span>
              ))}
            </div>
          </div>
        </div>
      );
    }

    const exp = row.exp;
    const expChildrenExpanded = !collapsed.has(row.toggleKey);
    const summary = exp.finding ?? exp.hypothesis ?? "";

    return (
      <div
        key={row.rowKey}
        role="row"
        tabIndex={0}
        onClick={(ev) => {
          setFocusedIndex(index);
          if (
            row.hasChildren &&
            (ev.target as HTMLElement).closest("[data-exp-toggle]")
          ) {
            toggle(row.toggleKey);
            return;
          }
          if (manageMode) {
            if (experimentContext) return;
            onToggleExperimentSelection?.(exp.id);
            return;
          }
          onNavigate({ kind: "experiment", id: exp.id });
        }}
        onDoubleClick={() => onNavigate({ kind: "experiment", id: exp.id })}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            if (manageMode) {
              if (experimentContext) return;
              onToggleExperimentSelection?.(exp.id);
              return;
            }
            onNavigate({ kind: "experiment", id: exp.id });
          }
        }}
        className={cn(
          "flex cursor-pointer items-center gap-1.5 border-b border-border-subtle pr-2 text-left transition-colors",
          experimentSelected
            ? "bg-accent/10 ring-1 ring-inset ring-accent"
            : focused
            ? "bg-surface-hover ring-1 ring-inset ring-accent"
            : "hover:bg-surface-hover/80",
          experimentContext && "opacity-60",
        )}
        style={{
          ...pad(row.depth),
          minHeight: ROW_H,
          borderLeftWidth: 3,
          borderLeftColor: statusColor[exp.status],
        }}
      >
        <div className="flex min-w-0 flex-1 items-center gap-1.5 overflow-x-auto pl-1">
          {row.hasChildren ? (
            <button
              type="button"
              data-exp-toggle
              className="shrink-0 rounded p-0.5 text-text-quaternary hover:bg-surface-raised hover:text-text-secondary"
              aria-label={
                expChildrenExpanded ? "Collapse children" : "Expand children"
              }
              onClick={(e) => {
                e.stopPropagation();
                setFocusedIndex(index);
                toggle(row.toggleKey);
              }}
            >
              {expChildrenExpanded ? (
                <ChevronDown className="h-3.5 w-3.5" />
              ) : (
                <ChevronRight className="h-3.5 w-3.5" />
              )}
            </button>
          ) : (
            <span className="w-4 shrink-0" />
          )}
          {manageMode && !experimentContext ? (
            experimentSelected ? (
              <CheckSquare2 className="h-3.5 w-3.5 shrink-0 text-accent" />
            ) : (
              <Square className="h-3.5 w-3.5 shrink-0 text-text-tertiary" />
            )
          ) : null}
          <span className="shrink-0 font-mono text-[11px] font-medium text-text">
            {exp.id}
          </span>
          <Badge variant={exp.status}>{exp.status}</Badge>
          {exp.branch_type && (
            <span className="flex shrink-0 items-center gap-0.5 text-[9px] text-text-quaternary">
              <GitFork className="h-2.5 w-2.5" />
              {exp.branch_type}
            </span>
          )}
          {summary && (
            <InlineMarkdownText
              content={summary}
              className="min-w-0 flex-1 truncate text-[11px] text-text-tertiary"
              title={summary}
            />
          )}
          {row.findings.length > 0 && (
            <div className="flex shrink-0 flex-wrap items-center gap-1">
              {row.findings.map((f) => (
                <div
                  key={f.id}
                  className={cn(
                    "inline-flex items-center gap-1 rounded border px-1 py-0.5 text-[10px]",
                    manageMode && selectedFindings.has(f.id)
                      ? "border-accent bg-accent/10 text-accent"
                      : "border-border-subtle bg-surface-raised text-text-secondary",
                    focusMode && !isDirectFinding(f.id) && "opacity-60",
                  )}
                >
                  <button
                    type="button"
                    className="inline-flex items-center gap-1"
                    onClick={(e) => {
                      e.stopPropagation();
                      if (manageMode) {
                        if (!isDirectFinding(f.id)) return;
                        onToggleFindingSelection?.(f.id);
                        return;
                      }
                      onNavigate({ kind: "finding", id: f.id });
                    }}
                  >
                    {manageMode && isDirectFinding(f.id) ? (
                      selectedFindings.has(f.id) ? (
                        <CheckSquare2 className="h-3 w-3 shrink-0 text-accent" />
                      ) : (
                        <Square className="h-3 w-3 shrink-0 text-text-tertiary" />
                      )
                    ) : null}
                    <Badge
                      variant={confidenceVariant(f.confidence)}
                      className="text-[9px]"
                    >
                      {f.id}
                    </Badge>
                    <FindingImportanceBadge
                      importance={f.importance}
                      className="px-1.5 py-0.5 text-[9px]"
                    />
                  </button>
                  {manageMode ? (
                    <button
                      type="button"
                      className="rounded px-1 text-[9px] text-text-tertiary hover:bg-surface hover:text-text-secondary"
                      onClick={(event) => {
                        event.stopPropagation();
                        onNavigate({ kind: "finding", id: f.id });
                      }}
                    >
                      Open
                    </button>
                  ) : null}
                </div>
              ))}
            </div>
          )}
        </div>
        {manageMode ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="shrink-0"
            onClick={(event) => {
              event.stopPropagation();
              onNavigate({ kind: "experiment", id: exp.id });
            }}
          >
            Open
          </Button>
        ) : null}
        {!expChildrenExpanded && row.childCount > 0 && (
          <span className="shrink-0 text-[9px] text-text-quaternary">
            +{row.childCount}
          </span>
        )}
      </div>
    );
  };

  return (
    <div className="flex h-full min-h-0 flex-col gap-2">
      <Input
        placeholder="Filter experiments & findings…"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        className="h-9 max-w-md rounded-[6px] border-border bg-surface text-[13px]"
        aria-label="Filter tree"
      />
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => setCollapsed(new Set())}
          className="inline-flex items-center rounded-[5.5px] border border-border-subtle bg-surface-raised px-2.5 py-1 text-[11px] font-medium text-text-secondary transition-colors hover:bg-surface-hover"
        >
          Expand all
        </button>
        <button
          type="button"
          onClick={() => {
            const next = new Set<string>();
            for (const row of flatRows) {
              if (row.kind !== "experiment" || row.hasChildren) {
                next.add(row.toggleKey);
              }
            }
            setCollapsed(next);
          }}
          className="inline-flex items-center rounded-[5.5px] border border-border-subtle bg-surface-raised px-2.5 py-1 text-[11px] font-medium text-text-secondary transition-colors hover:bg-surface-hover"
        >
          Collapse all
        </button>
      </div>
      <div
        ref={scrollRef}
        className="min-h-0 flex-1 overflow-auto rounded-[8px] border border-border bg-bg"
        tabIndex={-1}
        onKeyDown={onKeyDown}
      >
        {flatRows.length === 0 ? (
          <div className="p-4 text-[13px] text-text-quaternary">
            {search.trim() ? "No matching rows." : "Nothing to show."}
          </div>
        ) : (
          <div
            className="relative w-full"
            style={{ height: virtualizer.getTotalSize() }}
          >
            {virtualizer.getVirtualItems().map((vi) => {
              const row = flatRows[vi.index];
              if (!row) return null;
              return (
                <div
                  key={vi.key}
                  className="absolute left-0 top-0 w-full"
                  style={{ transform: `translateY(${vi.start}px)` }}
                >
                  {renderRow(row, vi.index)}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
});
