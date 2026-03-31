// ── Sonde domain types ─────────────────────────────────────────
// Mirrors the Supabase schema. Keep in sync with migrations.

export type ExperimentStatus =
  | "open"
  | "running"
  | "complete"
  | "failed"
  | "superseded";

export type BranchType =
  | "exploratory"
  | "refinement"
  | "alternative"
  | "debug"
  | "replication";

export type DirectionStatus =
  | "proposed"
  | "active"
  | "paused"
  | "completed"
  | "abandoned";

export type QuestionStatus =
  | "open"
  | "investigating"
  | "promoted"
  | "dismissed";

export type FindingConfidence = "low" | "medium" | "high";

export type ArtifactType =
  | "figure"
  | "paper"
  | "dataset"
  | "notebook"
  | "config"
  | "log"
  | "report"
  | "other";

export type RecordType = "experiment" | "finding" | "question" | "direction";

// ── Core entities ──────────────────────────────────────────────

export interface Program {
  id: string;
  name: string;
  description: string | null;
  created_at: string;
}

export interface Experiment {
  id: string;
  program: string;
  status: ExperimentStatus;
  source: string;
  content: string | null;
  hypothesis: string | null;
  parameters: Record<string, unknown>;
  results: Record<string, unknown> | null;
  finding: string | null;
  metadata: Record<string, unknown>;

  // Git provenance
  git_commit: string | null;
  git_repo: string | null;
  git_branch: string | null;
  git_close_commit: string | null;
  git_close_branch: string | null;
  git_dirty: boolean | null;

  // References
  data_sources: string[];
  tags: string[];
  direction_id: string | null;
  related: string[];

  // Tree
  parent_id: string | null;
  branch_type: BranchType | null;
  claimed_by: string | null;
  claimed_at: string | null;

  // Timing
  run_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface ExperimentSummary extends Experiment {
  artifact_count: number;
}

export interface Finding {
  id: string;
  program: string;
  topic: string;
  finding: string;
  confidence: FindingConfidence;
  content: string | null;
  metadata: Record<string, unknown>;
  evidence: string[];
  source: string;
  valid_from: string;
  valid_until: string | null;
  supersedes: string | null;
  superseded_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface Direction {
  id: string;
  program: string;
  title: string;
  question: string;
  status: DirectionStatus;
  source: string;
  created_at: string;
  updated_at: string;
}

export interface DirectionSummary extends Direction {
  experiment_count: number;
  complete_count: number;
  open_count: number;
  running_count: number;
}

export interface Question {
  id: string;
  program: string;
  question: string;
  context: string | null;
  content: string | null;
  metadata: Record<string, unknown>;
  status: QuestionStatus;
  source: string;
  raised_by: string | null;
  promoted_to_type: RecordType | null;
  promoted_to_id: string | null;
  tags: string[];
  created_at: string;
  updated_at: string;
}

export interface Artifact {
  id: string;
  filename: string;
  type: ArtifactType;
  mime_type: string | null;
  size_bytes: number | null;
  description: string | null;
  storage_path: string;
  experiment_id: string | null;
  finding_id: string | null;
  direction_id: string | null;
  source: string;
  created_at: string;
}

export interface ExperimentNote {
  id: string;
  experiment_id: string;
  content: string;
  source: string;
  created_at: string;
}

export interface ActivityLogEntry {
  id: number;
  record_id: string;
  record_type: string;
  action: string;
  actor: string;
  actor_email: string | null;
  actor_name: string | null;
  details: Record<string, unknown>;
  created_at: string;
}

export interface RecordLink {
  source_id: string;
  source_type: RecordType;
  target_id: string;
  target_type: RecordType;
  label: string | null;
  created_at: string;
}

// ── Tree node (from RPC) ───────────────────────────────────────

export interface ExperimentTreeNode {
  id: string;
  parent_id: string | null;
  depth: number;
  status: ExperimentStatus;
  branch_type: BranchType | null;
  source: string;
  program: string;
  content: string | null;
  finding: string | null;
  tags: string[];
  direction_id: string | null;
  claimed_by: string | null;
  claimed_at: string | null;
  created_at: string;
  updated_at: string;
}
