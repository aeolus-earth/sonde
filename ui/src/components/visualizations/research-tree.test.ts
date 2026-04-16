import { describe, expect, it } from "vitest";
import type {
  DirectionSummary,
  ExperimentStatus,
  ExperimentSummary,
  Finding,
  ProjectSummary,
  QuestionSummary,
} from "@/types/sonde";
import { buildResearchTreeRows } from "./research-tree";

function makeProject(overrides: Partial<ProjectSummary> = {}): ProjectSummary {
  return {
    id: "PROJ-012",
    program: "dart-benchmarking",
    name: "Dart Benchmarking",
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
    id: "DIR-030",
    program: "dart-benchmarking",
    title: "Direction",
    question: "Direction question",
    status: "active",
    source: "test",
    project_id: "PROJ-012",
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
    id: "Q-1026",
    program: "dart-benchmarking",
    question: "Question?",
    direction_id: "DIR-030",
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
    id: "EXP-0242",
    program: "dart-benchmarking",
    status,
    source: "test",
    content: null,
    hypothesis: "Experiment",
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
    direction_id: "DIR-030",
    project_id: "PROJ-012",
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
    id: "FIND-111",
    program: "dart-benchmarking",
    topic: "Shared finding",
    finding: "Supported by multiple experiments",
    confidence: "medium",
    importance: "medium",
    content: null,
    metadata: {},
    evidence: ["EXP-0312", "EXP-0313"],
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

function dartDuplicateFixture() {
  return {
    projects: [makeProject()],
    directions: [
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
    ],
    questions: [
      makeQuestion({ id: "Q-1026", direction_id: "DIR-030" }),
      makeQuestion({ id: "Q-1029", direction_id: "DIR-031" }),
      makeQuestion({ id: "Q-1044", direction_id: "DIR-045" }),
    ],
    experiments: [
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
        hypothesis: "clean-worktree scalar-internal baseline",
      }),
      makeExperiment({
        id: "EXP-0378",
        direction_id: "DIR-031",
        parent_id: "EXP-0377",
      }),
      ...["0379", "0380", "0381", "0382", "0383", "0384"].map((suffix, index) =>
        makeExperiment({
          id: `EXP-${suffix}`,
          direction_id: "DIR-045",
          created_at: `2026-04-16T1${index}:00:00Z`,
        }),
      ),
      makeExperiment({
        id: "EXP-1006",
        direction_id: "DIR-045",
        created_at: "2026-04-16T21:56:00Z",
      }),
    ],
    findings: [],
  };
}

describe("buildResearchTreeRows", () => {
  it("does not duplicate spawned-direction experiment subtrees", () => {
    const fixture = dartDuplicateFixture();
    const rows = buildResearchTreeRows({
      ...fixture,
      collapsed: new Set(),
      search: "",
    });

    for (const id of [
      "DIR-031",
      "DIR-045",
      "Q-1044",
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
      expect(rows.filter((row) => row.rowKey.endsWith(id))).toHaveLength(1);
    }
  });

  it("keeps multi-evidence findings attached to each supporting experiment", () => {
    const rows = buildResearchTreeRows({
      projects: [makeProject()],
      directions: [makeDirection({ id: "DIR-031" })],
      questions: [],
      experiments: [
        makeExperiment({ id: "EXP-0312", direction_id: "DIR-031" }),
        makeExperiment({
          id: "EXP-0313",
          direction_id: "DIR-031",
          parent_id: "EXP-0312",
        }),
      ],
      findings: [makeFinding()],
      collapsed: new Set(),
      search: "",
    });

    const exp0312 = rows.find(
      (row) => row.kind === "experiment" && row.exp.id === "EXP-0312",
    );
    const exp0313 = rows.find(
      (row) => row.kind === "experiment" && row.exp.id === "EXP-0313",
    );

    expect(exp0312?.kind === "experiment" && exp0312.findings[0]?.id).toBe(
      "FIND-111",
    );
    expect(exp0313?.kind === "experiment" && exp0313.findings[0]?.id).toBe(
      "FIND-111",
    );
  });
});
