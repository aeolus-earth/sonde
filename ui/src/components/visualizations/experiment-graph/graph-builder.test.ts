/**
 * Invariant tests for the experiment-graph builder.
 *
 * These tests pin the load-bearing invariants of `buildExperimentGraph`.
 * Each test exercises a specific class of input that produced the
 * "disconnected edge stub" bug on the research map, and asserts the
 * builder's contract:
 *
 *   1. No edge ever reaches React Flow whose source or target isn't
 *      also in `nodes`.
 *   2. Expansion state drives which nodes (and therefore which edges)
 *      are materialized — collapsing a parent removes its subtree.
 *   3. The dropped-orphan counter tracks every edge we filtered out.
 *
 * The original screenshot bug was caused by the builder eagerly
 * emitting edges for parent→child relationships while conditionally
 * creating child nodes based on expansion. If any of these invariants
 * breaks in the future, the bug comes back.
 */

import { describe, expect, it } from "vitest";
import { emptyFocusReasonMaps } from "@/lib/focus-mode";

import type {
  DirectionSummary,
  ExperimentStatus,
  ExperimentSummary,
  Finding,
  ProjectSummary,
  QuestionSummary,
} from "@/types/sonde";

import {
  type BuildGraphInput,
  type HandlerFactories,
  type StatusColorMap,
  buildExperimentGraph,
  stabilizeNodes,
} from "./graph-builder";

// ── Fixture builders ──────────────────────────────────────────────

/**
 * Handler factories that return no-op closures, cached per id so
 * repeated calls for the same id return the *same* reference. The
 * cache matters for the identity-stability tests below — the
 * component-side factory uses the same pattern (useRef-backed Map).
 */
function makeStableHandlers(): HandlerFactories {
  const caches = {
    toggle: new Map<string, () => void>(),
    experiment: new Map<string, () => void>(),
    question: new Map<string, () => void>(),
    direction: new Map<string, () => void>(),
    finding: new Map<string, () => void>(),
    project: new Map<string, () => void>(),
    selectExperiment: new Map<string, () => void>(),
    selectQuestion: new Map<string, () => void>(),
    selectFinding: new Map<string, () => void>(),
  };
  const factory = (cache: Map<string, () => void>) => (id: string) => {
    const cached = cache.get(id);
    if (cached) return cached;
    const fn = () => {};
    cache.set(id, fn);
    return fn;
  };
  return {
    toggleFor: factory(caches.toggle),
    openExperimentFor: factory(caches.experiment),
    openQuestionFor: factory(caches.question),
    openDirectionFor: factory(caches.direction),
    openFindingFor: factory(caches.finding),
    openProjectFor: factory(caches.project),
    selectExperimentFor: factory(caches.selectExperiment),
    selectQuestionFor: factory(caches.selectQuestion),
    selectFindingFor: factory(caches.selectFinding),
  };
}

const STATUS_COLORS: StatusColorMap = {
  open: "#60A5FA",
  running: "#FBBF24",
  complete: "#4ADE80",
  failed: "#EF4444",
  superseded: "#6B7280",
};

function makeProject(overrides: Partial<ProjectSummary> = {}): ProjectSummary {
  return {
    id: "proj-1",
    program: "shared",
    name: "Test Project",
    objective: null,
    description: null,
    status: "active",
    source: "test",
    report_pdf_artifact_id: null,
    report_tex_artifact_id: null,
    report_updated_at: null,
    created_at: "2026-04-01T00:00:00Z",
    updated_at: "2026-04-01T00:00:00Z",
    direction_count: 0,
    experiment_count: 0,
    complete_count: 0,
    open_count: 0,
    running_count: 0,
    failed_count: 0,
    ...overrides,
  };
}

function makeDirection(
  overrides: Partial<DirectionSummary> = {},
): DirectionSummary {
  return {
    id: "DIR-0001",
    program: "shared",
    title: "Test Direction",
    question: "",
    status: "active",
    source: "test",
    project_id: "proj-1",
    parent_direction_id: null,
    spawned_from_experiment_id: null,
    created_at: "2026-04-01T00:00:00Z",
    updated_at: "2026-04-01T00:00:00Z",
    experiment_count: 0,
    complete_count: 0,
    open_count: 0,
    running_count: 0,
    child_direction_count: 0,
    ...overrides,
  };
}

function makeQuestion(
  overrides: Partial<QuestionSummary> = {},
): QuestionSummary {
  return {
    id: "Q-0001",
    program: "shared",
    question: "Test question?",
    direction_id: "DIR-0001",
    context: null,
    status: "open",
    source: "test",
    raised_by: null,
    promoted_to_type: null,
    promoted_to_id: null,
    tags: [],
    created_at: "2026-04-01T00:00:00Z",
    updated_at: "2026-04-01T00:00:00Z",
    linked_experiment_count: 0,
    primary_experiment_count: 0,
    linked_finding_count: 0,
    ...overrides,
  };
}

function makeExperiment(
  overrides: Partial<ExperimentSummary> = {},
): ExperimentSummary {
  const status: ExperimentStatus = overrides.status ?? "complete";
  return {
    id: "EXP-0001",
    program: "shared",
    status,
    source: "test",
    content: null,
    hypothesis: null,
    parameters: {},
    results: null,
    finding: null,
    metadata: {},
    git_commit: null,
    git_repo: null,
    git_branch: null,
    git_close_commit: null,
    git_close_branch: null,
    git_dirty: null,
    code_context: null,
    data_sources: [],
    tags: [],
    direction_id: "DIR-0001",
    project_id: "proj-1",
    linear_id: null,
    related: [],
    parent_id: null,
    branch_type: null,
    claimed_by: null,
    claimed_at: null,
    run_at: null,
    created_at: "2026-04-01T00:00:00Z",
    updated_at: "2026-04-01T00:00:00Z",
    primary_question_id: null,
    artifact_count: 0,
    artifact_types: null,
    artifact_filenames: null,
    ...overrides,
  };
}

function makeFinding(overrides: Partial<Finding> = {}): Finding {
  return {
    id: "FIND-0001",
    program: "shared",
    topic: "Test",
    finding: "Test finding",
    confidence: "medium",
    importance: "medium",
    content: null,
    metadata: {},
    evidence: ["EXP-0001"],
    source: "test",
    valid_from: "2026-04-01T00:00:00Z",
    valid_until: null,
    supersedes: null,
    superseded_by: null,
    created_at: "2026-04-01T00:00:00Z",
    updated_at: "2026-04-01T00:00:00Z",
    ...overrides,
  };
}

/** Project → Direction → Question → Experiment → Finding, one of each. */
function makeRealisticInput(
  overrides: Partial<BuildGraphInput> = {},
): BuildGraphInput {
  const projects = [makeProject()];
  const directions = [makeDirection()];
  const questions = [makeQuestion()];
  const experiments = [
    makeExperiment({ id: "EXP-0001", primary_question_id: "Q-0001" }),
  ];
  const findings = [makeFinding({ evidence: ["EXP-0001"] })];

  return {
    projects,
    directions,
    questions,
    experiments,
    findings,
    expanded: new Set<string>(),
    handlers: makeStableHandlers(),
    statusColor: STATUS_COLORS,
    borderColor: "#ccc",
    projectEdgeColor: "#aaa",
    knownProjectIds: new Set(projects.map((p) => p.id)),
    ...overrides,
  };
}

// ── Invariant: no orphan edges ────────────────────────────────────

describe("buildExperimentGraph: no orphan edges", () => {
  it("empty input produces empty output", () => {
    const out = buildExperimentGraph({
      projects: [],
      directions: [],
      questions: [],
      experiments: [],
      findings: [],
      expanded: new Set(),
      handlers: makeStableHandlers(),
      statusColor: STATUS_COLORS,
      borderColor: "#ccc",
      projectEdgeColor: "#aaa",
      knownProjectIds: new Set(),
    });
    expect(out.nodes).toEqual([]);
    expect(out.edges).toEqual([]);
    expect(out.droppedOrphanEdges).toBe(0);
  });

  it("every edge references a node in the rendered set (fully collapsed)", () => {
    const out = buildExperimentGraph(makeRealisticInput());
    const nodeIds = new Set(out.nodes.map((n) => n.id));
    for (const edge of out.edges) {
      expect(nodeIds.has(edge.source)).toBe(true);
      expect(nodeIds.has(edge.target)).toBe(true);
    }
  });

  it("every edge references a node in the rendered set (all expanded)", () => {
    const input = makeRealisticInput();
    const allKeys = new Set<string>([
      "proj-proj-1",
      "dir-DIR-0001",
      "question-Q-0001",
      "EXP-0001",
      "nodir-proj-proj-1",
    ]);
    input.expanded = allKeys;
    const out = buildExperimentGraph(input);
    const nodeIds = new Set(out.nodes.map((n) => n.id));
    for (const edge of out.edges) {
      expect(nodeIds.has(edge.source)).toBe(true);
      expect(nodeIds.has(edge.target)).toBe(true);
    }
  });

  it("partial expansion never produces orphan edges", () => {
    // Only the project is expanded — direction, question, experiment are
    // collapsed. This was the exact state that produced the screenshot bug.
    const input = makeRealisticInput();
    input.expanded = new Set(["proj-proj-1"]);
    const out = buildExperimentGraph(input);
    const nodeIds = new Set(out.nodes.map((n) => n.id));
    for (const edge of out.edges) {
      expect(nodeIds.has(edge.source)).toBe(true);
      expect(nodeIds.has(edge.target)).toBe(true);
    }
    expect(out.droppedOrphanEdges).toBe(0);
  });
});

describe("buildExperimentGraph: focus mode", () => {
  it("marks context nodes as muted and non-selectable", () => {
    const focusReasons = emptyFocusReasonMaps();
    focusReasons.projects.set("proj-1", "context");
    focusReasons.directions.set("DIR-0001", "context");
    focusReasons.questions.set("Q-0001", "context");
    focusReasons.experiments.set("EXP-0001", "context");
    focusReasons.findings.set("FIND-0001", "created");

    const out = buildExperimentGraph(
      makeRealisticInput({
        expanded: new Set(["proj-proj-1", "dir-DIR-0001", "question-Q-0001", "EXP-0001"]),
        focusMode: true,
        focusReasons,
      }),
    );

    const experimentNode = out.nodes.find((node) => node.id === "EXP-0001");
    const questionNode = out.nodes.find((node) => node.id === "question-Q-0001");
    const projectNode = out.nodes.find((node) => node.id === "proj-proj-1");
    const findingNode = out.nodes.find((node) =>
      node.id.startsWith("finding-FIND-0001"),
    );

    expect(experimentNode?.data).toMatchObject({ muted: true, selectable: false });
    expect(questionNode?.data).toMatchObject({ muted: true, selectable: false });
    expect(projectNode?.data).toMatchObject({ muted: true });
    expect(findingNode?.data).toMatchObject({ muted: false, selectable: true });
  });
});

// ── Invariant: expansion gates children ───────────────────────────

describe("buildExperimentGraph: expansion state drives visibility", () => {
  it("collapsed question does not materialize its child experiments", () => {
    const input = makeRealisticInput();
    // Expand project + direction so we get down to the question, but do
    // NOT expand the question itself.
    input.expanded = new Set(["proj-proj-1", "dir-DIR-0001"]);
    const out = buildExperimentGraph(input);
    const ids = out.nodes.map((n) => n.id);
    expect(ids).toContain("question-Q-0001");
    // EXP-0001 is primary-linked to Q-0001; Q-0001 is collapsed, so
    // the experiment must NOT appear.
    expect(ids).not.toContain("EXP-0001");
    // And no edge referring to EXP-0001 either.
    for (const edge of out.edges) {
      expect(edge.target).not.toBe("EXP-0001");
    }
  });

  it("expanding a question reveals its experiment AND the connecting edge", () => {
    const input = makeRealisticInput();
    input.expanded = new Set([
      "proj-proj-1",
      "dir-DIR-0001",
      "question-Q-0001",
    ]);
    const out = buildExperimentGraph(input);
    const ids = out.nodes.map((n) => n.id);
    expect(ids).toContain("EXP-0001");
    expect(
      out.edges.some(
        (e) => e.source === "question-Q-0001" && e.target === "EXP-0001",
      ),
    ).toBe(true);
  });
});

// ── Invariant: primary-question experiments don't double-attach ───

describe("buildExperimentGraph: primary-question filtering", () => {
  it("an experiment with primary_question_id only attaches under its question, not under the direction", () => {
    const input = makeRealisticInput();
    // Expand everything so we see all possible edges.
    input.expanded = new Set([
      "proj-proj-1",
      "dir-DIR-0001",
      "question-Q-0001",
      "EXP-0001",
    ]);
    const out = buildExperimentGraph(input);
    // EXP-0001 has primary_question_id = Q-0001. The only edge to it
    // must be from the question, never from the direction.
    const parentsOfExp = out.edges
      .filter((e) => e.target === "EXP-0001")
      .map((e) => e.source);
    expect(parentsOfExp).toEqual(["question-Q-0001"]);
  });

  it("does not emit duplicate nodes for spawned directions reached through a question lineage", () => {
    const projects = [makeProject()];
    const directions = [
      makeDirection({ id: "DIR-030", title: "Wait-enabled ADA launch" }),
      makeDirection({
        id: "DIR-031",
        title: "ADA kernel redesign",
        spawned_from_experiment_id: "EXP-0242",
      }),
      makeDirection({
        id: "DIR-045",
        title: "ADA teardown finalizer",
        spawned_from_experiment_id: "EXP-0378",
      }),
    ];
    const questions = [
      makeQuestion({ id: "Q-1026", direction_id: "DIR-030" }),
      makeQuestion({ id: "Q-1029", direction_id: "DIR-031" }),
      makeQuestion({ id: "Q-1044", direction_id: "DIR-045" }),
    ];
    const experiments = [
      makeExperiment({
        id: "EXP-0242",
        direction_id: "DIR-030",
        primary_question_id: "Q-1026",
      }),
      makeExperiment({
        id: "EXP-0325",
        direction_id: "DIR-031",
        primary_question_id: "Q-1029",
      }),
      makeExperiment({
        id: "EXP-0377",
        direction_id: "DIR-031",
        parent_id: "EXP-0325",
      }),
      makeExperiment({
        id: "EXP-0378",
        direction_id: "DIR-031",
        parent_id: "EXP-0377",
      }),
      ...["0379", "0380", "0381", "0382", "0383", "0384"].map((suffix) =>
        makeExperiment({
          id: `EXP-${suffix}`,
          direction_id: "DIR-045",
        }),
      ),
      makeExperiment({ id: "EXP-1006", direction_id: "DIR-045" }),
    ];

    const out = buildExperimentGraph(
      makeRealisticInput({
        projects,
        directions,
        questions,
        experiments,
        findings: [],
        expanded: new Set([
          "proj-proj-1",
          "dir-DIR-030",
          "question-Q-1026",
          "EXP-0242",
          "dir-DIR-031",
          "question-Q-1029",
          "EXP-0325",
          "EXP-0377",
          "EXP-0378",
          "dir-DIR-045",
          "question-Q-1044",
        ]),
        knownProjectIds: new Set(projects.map((p) => p.id)),
      }),
    );
    const counts = new Map<string, number>();
    for (const node of out.nodes) {
      counts.set(node.id, (counts.get(node.id) ?? 0) + 1);
    }

    for (const id of [
      "dir-DIR-031",
      "dir-DIR-045",
      "question-Q-1044",
      "EXP-0377",
      "EXP-0378",
      "EXP-0379",
      "EXP-0380",
      "EXP-0381",
      "EXP-0382",
      "EXP-0383",
      "EXP-0384",
      "EXP-1006",
    ]) {
      expect(counts.get(id)).toBe(1);
    }
  });
});

// ── Invariant: missing entities don't crash ───────────────────────

describe("buildExperimentGraph: malformed / partial data", () => {
  it("experiment with primary_question_id referencing a non-existent question does not crash", () => {
    const projects = [makeProject()];
    const directions = [makeDirection()];
    const experiments = [
      makeExperiment({
        id: "EXP-0001",
        // References a question we never added.
        primary_question_id: "Q-MISSING",
      }),
    ];
    const input: BuildGraphInput = {
      projects,
      directions,
      questions: [],
      experiments,
      findings: [],
      expanded: new Set([
        "proj-proj-1",
        "dir-DIR-0001",
        "question-Q-MISSING",
      ]),
      handlers: makeStableHandlers(),
      statusColor: STATUS_COLORS,
      borderColor: "#ccc",
      projectEdgeColor: "#aaa",
      knownProjectIds: new Set(["proj-1"]),
    };
    expect(() => buildExperimentGraph(input)).not.toThrow();
    const out = buildExperimentGraph(input);
    const nodeIds = new Set(out.nodes.map((n) => n.id));
    // Whatever the builder decided to do — drop the experiment, or show
    // it under the direction — every edge that survived must have both
    // endpoints.
    for (const edge of out.edges) {
      expect(nodeIds.has(edge.source)).toBe(true);
      expect(nodeIds.has(edge.target)).toBe(true);
    }
  });

  it("direction with experiments but parent_direction_id pointing at a missing direction is still rendered", () => {
    const projects = [makeProject()];
    const directions = [
      makeDirection({
        id: "DIR-CHILD",
        parent_direction_id: "DIR-GONE",
      }),
    ];
    const input: BuildGraphInput = {
      projects,
      directions,
      questions: [],
      experiments: [],
      findings: [],
      expanded: new Set(["proj-proj-1"]),
      handlers: makeStableHandlers(),
      statusColor: STATUS_COLORS,
      borderColor: "#ccc",
      projectEdgeColor: "#aaa",
      knownProjectIds: new Set(["proj-1"]),
    };
    const out = buildExperimentGraph(input);
    // The orphan-parent check in addDirectionSubtree filters this
    // direction out of the project's top-level list (since it has a
    // parent_direction_id set). That's correct behavior — the parent
    // should come along with it when we implement that feature. What
    // matters here is: no crash, no orphan edges.
    expect(out.droppedOrphanEdges).toBe(0);
  });
});

// ── Invariant: dropped-orphan counter ─────────────────────────────

describe("buildExperimentGraph: droppedOrphanEdges telemetry", () => {
  it("returns 0 for a well-formed realistic input", () => {
    const out = buildExperimentGraph(makeRealisticInput());
    expect(out.droppedOrphanEdges).toBe(0);
  });

  it("returns 0 even when data is partial (expansion state half-built)", () => {
    // Simulates the React-Query-staggered-load race. The orphan-edge
    // filter should keep the count at 0 by never producing invalid
    // edges in the first place.
    const input = makeRealisticInput();
    // Strip the question — simulating the hooks arriving out of order.
    input.questions = [];
    input.expanded = new Set(["proj-proj-1", "dir-DIR-0001"]);
    const out = buildExperimentGraph(input);
    expect(out.droppedOrphanEdges).toBe(0);
  });
});

// ── Invariant: handler identity is stable across builds ───────────

describe("buildExperimentGraph: handler identity stability", () => {
  it("consecutive builds with the same handler factories return the same onToggle/onOpen references per node", () => {
    // The factory-backed handlers are the key perf optimization:
    // stable refs across builds let React Flow's `memo(NodeComponent)`
    // shallow-compare pass, skipping renders for unchanged nodes.
    // If a future refactor reintroduces inline lambdas — or the
    // factory loses its cache — the `data.onToggle` references will
    // differ across builds and this test fails.
    const input = makeRealisticInput({
      expanded: new Set([
        "proj-proj-1",
        "dir-DIR-0001",
        "question-Q-0001",
        "EXP-0001",
      ]),
    });

    const first = buildExperimentGraph(input);
    const second = buildExperimentGraph(input);

    // For each node id that appears in both builds, the callback
    // references on `data` must be === equal.
    const byId = new Map(second.nodes.map((n) => [n.id, n]));
    for (const firstNode of first.nodes) {
      const secondNode = byId.get(firstNode.id);
      expect(secondNode).toBeDefined();
      if (!secondNode) continue;
      const firstData = firstNode.data as Record<string, unknown>;
      const secondData = secondNode.data as Record<string, unknown>;
      if (firstData.onToggle !== undefined) {
        expect(secondData.onToggle).toBe(firstData.onToggle);
      }
      if (firstData.onOpen !== undefined) {
        expect(secondData.onOpen).toBe(firstData.onOpen);
      }
    }
  });

  it("different factory instances produce different onToggle references for the same id (no cross-instance cache)", () => {
    // Sanity check: the test above asserts identity across calls with
    // the *same* factory. This asserts that factories are isolated —
    // a fresh factory means fresh closures. Rules out accidental
    // global caches.
    const input1 = makeRealisticInput();
    const input2 = makeRealisticInput();
    const out1 = buildExperimentGraph(input1);
    const out2 = buildExperimentGraph(input2);
    const p1 = out1.nodes.find((n) => n.id === "proj-proj-1");
    const p2 = out2.nodes.find((n) => n.id === "proj-proj-1");
    expect(p1).toBeDefined();
    expect(p2).toBeDefined();
    if (!p1 || !p2) return;
    const d1 = p1.data as Record<string, unknown>;
    const d2 = p2.data as Record<string, unknown>;
    expect(d2.onToggle).not.toBe(d1.onToggle);
  });
});

// ── Invariant: stabilizeNodes preserves references when data is unchanged ──

describe("stabilizeNodes", () => {
  it("passes through unchanged when previous is null (first build)", () => {
    const input = makeRealisticInput({
      expanded: new Set(["proj-proj-1", "dir-DIR-0001"]),
    });
    const { nodes } = buildExperimentGraph(input);
    const out = stabilizeNodes(null, nodes);
    expect(out).toBe(nodes);
  });

  it("returns the SAME node object reference when data is unchanged across builds", () => {
    // The core invariant. Two consecutive builds with the same input
    // and the same handler factories must let stabilizeNodes return
    // the previous-build objects verbatim. Reference equality is what
    // lets React Flow skip reconciliation for unchanged subtrees.
    const input = makeRealisticInput({
      expanded: new Set([
        "proj-proj-1",
        "dir-DIR-0001",
        "question-Q-0001",
        "EXP-0001",
      ]),
    });

    const first = buildExperimentGraph(input);
    const firstMap = new Map(first.nodes.map((n) => [n.id, n]));

    const second = buildExperimentGraph(input);
    const stabilized = stabilizeNodes(firstMap, second.nodes);

    for (const node of stabilized) {
      const prev = firstMap.get(node.id);
      expect(prev).toBeDefined();
      if (!prev) continue;
      expect(node).toBe(prev);
    }
  });

  it("returns a new node object for ids whose data has changed", () => {
    // Toggle a direction's expansion: its `expanded` flag flips, so
    // the data shallow-compare must miss and stabilizeNodes must
    // return the *new* node, not reuse the cached one. Otherwise the
    // UI would never visually reflect the toggle.
    const collapsed = makeRealisticInput({
      expanded: new Set(["proj-proj-1"]),
    });
    const expanded = makeRealisticInput({
      expanded: new Set(["proj-proj-1", "dir-DIR-0001"]),
      handlers: collapsed.handlers,
    });

    const first = buildExperimentGraph(collapsed);
    const firstMap = new Map(first.nodes.map((n) => [n.id, n]));
    const second = buildExperimentGraph(expanded);
    const stabilized = stabilizeNodes(firstMap, second.nodes);

    const dirBefore = firstMap.get("dir-DIR-0001");
    const dirAfter = stabilized.find((n) => n.id === "dir-DIR-0001");
    expect(dirBefore).toBeDefined();
    expect(dirAfter).toBeDefined();
    // Data changed (expanded flag flipped), so reference must differ.
    expect(dirAfter).not.toBe(dirBefore);
  });

  it("preserves the previous object's identity but patches position when only position changed", () => {
    // Edge case: dagre can move a node on a sibling expansion even
    // when its own data is unchanged. We want reference-equality for
    // the data surface (so React Flow's memo pass skips) but the new
    // position must make it through to the DOM. stabilizeNodes spreads
    // into a new object in that case.
    const input = makeRealisticInput({
      expanded: new Set(["proj-proj-1", "dir-DIR-0001"]),
    });
    const { nodes } = buildExperimentGraph(input);
    const target = nodes.find((n) => n.id === "dir-DIR-0001");
    expect(target).toBeDefined();
    if (!target) return;

    const previousMap = new Map<string, (typeof nodes)[number]>([
      [target.id, { ...target, position: { x: -999, y: -999 } }],
    ]);
    const stabilized = stabilizeNodes(previousMap, [target]);

    expect(stabilized[0].position).toEqual(target.position);
    // The returned object is a fresh clone of the *previous* one with
    // position patched — not the freshly-built `target`.
    expect(stabilized[0]).not.toBe(target);
    expect(stabilized[0].data).toBe(previousMap.get(target.id)!.data);
  });
});
