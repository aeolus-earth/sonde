import { describe, expect, it } from "vitest";
import type {
  DirectionSummary,
  ExperimentSummary,
  Finding,
  ProjectSummary,
  QuestionSummary,
} from "@/types/sonde";
import { buildTimelineVisibleTreeData } from "./tree-timeline-visibility";

const BEFORE_CUTOFF = "2026-04-12T12:00:00Z";
const CUTOFF = "2026-04-12T13:00:00Z";
const AFTER_CUTOFF = "2026-04-12T14:00:00Z";

function project(overrides: Partial<ProjectSummary> = {}): ProjectSummary {
  return {
    id: "PROJ-001",
    program: "prism-development",
    name: "Project",
    objective: null,
    description: null,
    status: "active",
    source: "test",
    report_pdf_artifact_id: null,
    report_tex_artifact_id: null,
    report_updated_at: null,
    created_at: BEFORE_CUTOFF,
    updated_at: BEFORE_CUTOFF,
    direction_count: 0,
    experiment_count: 0,
    complete_count: 0,
    open_count: 0,
    running_count: 0,
    failed_count: 0,
    ...overrides,
  };
}

function direction(
  overrides: Partial<DirectionSummary> = {},
): DirectionSummary {
  return {
    id: "DIR-001",
    program: "prism-development",
    title: "Direction",
    question: "Direction question",
    status: "active",
    source: "test",
    project_id: "PROJ-001",
    parent_direction_id: null,
    spawned_from_experiment_id: null,
    created_at: BEFORE_CUTOFF,
    updated_at: BEFORE_CUTOFF,
    experiment_count: 0,
    complete_count: 0,
    open_count: 0,
    running_count: 0,
    child_direction_count: 0,
    ...overrides,
  };
}

function question(overrides: Partial<QuestionSummary> = {}): QuestionSummary {
  return {
    id: "Q-001",
    program: "prism-development",
    question: "Question?",
    direction_id: "DIR-001",
    context: null,
    status: "open",
    source: "test",
    raised_by: null,
    promoted_to_type: null,
    promoted_to_id: null,
    tags: [],
    created_at: BEFORE_CUTOFF,
    updated_at: BEFORE_CUTOFF,
    linked_experiment_count: 0,
    primary_experiment_count: 0,
    linked_finding_count: 0,
    ...overrides,
  };
}

function experiment(
  overrides: Partial<ExperimentSummary> = {},
): ExperimentSummary {
  return {
    id: "EXP-001",
    program: "prism-development",
    status: "complete",
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
    direction_id: "DIR-001",
    project_id: "PROJ-001",
    linear_id: null,
    related: [],
    parent_id: null,
    branch_type: null,
    claimed_by: null,
    claimed_at: null,
    run_at: null,
    created_at: BEFORE_CUTOFF,
    updated_at: BEFORE_CUTOFF,
    primary_question_id: "Q-001",
    artifact_count: 0,
    artifact_types: null,
    artifact_filenames: null,
    ...overrides,
  };
}

function finding(overrides: Partial<Finding> = {}): Finding {
  return {
    id: "FIND-001",
    program: "prism-development",
    topic: "Finding",
    finding: "Supported by an experiment",
    confidence: "medium",
    importance: "medium",
    content: null,
    metadata: {},
    evidence: ["EXP-001"],
    source: "test",
    valid_from: BEFORE_CUTOFF,
    valid_until: null,
    supersedes: null,
    superseded_by: null,
    created_at: BEFORE_CUTOFF,
    updated_at: BEFORE_CUTOFF,
    ...overrides,
  };
}

describe("buildTimelineVisibleTreeData", () => {
  it("keeps structural question ancestors for visible experiments", () => {
    const visible = buildTimelineVisibleTreeData({
      projects: [project()],
      directions: [direction()],
      questions: [question({ created_at: AFTER_CUTOFF })],
      experiments: [experiment()],
      findings: [],
      cutoff: CUTOFF,
    });

    expect(visible.experiments.map((item) => item.id)).toEqual(["EXP-001"]);
    expect(visible.questions.map((item) => item.id)).toEqual(["Q-001"]);
    expect(visible.directions.map((item) => item.id)).toEqual(["DIR-001"]);
    expect(visible.projects.map((item) => item.id)).toEqual(["PROJ-001"]);
  });

  it("keeps structural experiment ancestors for visible child experiments", () => {
    const visible = buildTimelineVisibleTreeData({
      projects: [project()],
      directions: [direction()],
      questions: [question()],
      experiments: [
        experiment({ id: "EXP-001", created_at: AFTER_CUTOFF }),
        experiment({
          id: "EXP-002",
          parent_id: "EXP-001",
          created_at: BEFORE_CUTOFF,
        }),
      ],
      findings: [],
      cutoff: CUTOFF,
    });

    expect(visible.experiments.map((item) => item.id)).toEqual([
      "EXP-001",
      "EXP-002",
    ]);
  });

  it("does not show unrelated future leaves", () => {
    const visible = buildTimelineVisibleTreeData({
      projects: [project()],
      directions: [direction()],
      questions: [question()],
      experiments: [
        experiment({ id: "EXP-001" }),
        experiment({ id: "EXP-999", created_at: AFTER_CUTOFF }),
      ],
      findings: [
        finding({ id: "FIND-001" }),
        finding({ id: "FIND-999", created_at: AFTER_CUTOFF }),
      ],
      cutoff: CUTOFF,
    });

    expect(visible.experiments.map((item) => item.id)).toEqual(["EXP-001"]);
    expect(visible.findings.map((item) => item.id)).toEqual(["FIND-001"]);
  });

  it("shows the supporting experiment path for visible findings", () => {
    const visible = buildTimelineVisibleTreeData({
      projects: [project()],
      directions: [direction()],
      questions: [question()],
      experiments: [experiment({ created_at: AFTER_CUTOFF })],
      findings: [finding()],
      cutoff: CUTOFF,
    });

    expect(visible.findings.map((item) => item.id)).toEqual(["FIND-001"]);
    expect(visible.experiments.map((item) => item.id)).toEqual(["EXP-001"]);
  });
});
