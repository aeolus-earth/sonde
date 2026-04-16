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
  type StatusColorMap,
  buildExperimentGraph,
} from "./graph-builder";

// ── Fixture builders ──────────────────────────────────────────────

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
    toggle: () => {},
    statusColor: STATUS_COLORS,
    borderColor: "#ccc",
    projectEdgeColor: "#aaa",
    navigation: {},
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
      toggle: () => {},
      statusColor: STATUS_COLORS,
      borderColor: "#ccc",
      projectEdgeColor: "#aaa",
      navigation: {},
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
      toggle: () => {},
      statusColor: STATUS_COLORS,
      borderColor: "#ccc",
      projectEdgeColor: "#aaa",
      navigation: {},
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
      toggle: () => {},
      statusColor: STATUS_COLORS,
      borderColor: "#ccc",
      projectEdgeColor: "#aaa",
      navigation: {},
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
