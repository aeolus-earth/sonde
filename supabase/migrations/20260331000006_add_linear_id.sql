-- Add optional linear_id to experiments, directions, and projects.
-- Enables loose linking between sonde records and Linear issues.

ALTER TABLE experiments ADD COLUMN IF NOT EXISTS linear_id TEXT;
ALTER TABLE directions  ADD COLUMN IF NOT EXISTS linear_id TEXT;
ALTER TABLE projects    ADD COLUMN IF NOT EXISTS linear_id TEXT;

CREATE INDEX IF NOT EXISTS idx_experiments_linear ON experiments (linear_id) WHERE linear_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_directions_linear  ON directions  (linear_id) WHERE linear_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_projects_linear    ON projects    (linear_id) WHERE linear_id IS NOT NULL;

-- Rebuild experiment_summary with linear_id
DROP VIEW IF EXISTS experiment_summary;

CREATE VIEW experiment_summary AS
SELECT
    e.id,
    e.program,
    e.status,
    e.source,
    e.hypothesis,
    e.parameters,
    e.results,
    e.finding,
    e.direction_id,
    e.project_id,
    e.linear_id,
    e.tags,
    e.created_at,
    e.run_at,
    e.parent_id,
    e.branch_type,
    e.git_commit,
    e.git_repo,
    e.git_branch,
    e.git_close_commit,
    e.git_close_branch,
    e.git_dirty,
    (SELECT count(*)                   FROM artifacts a WHERE a.experiment_id = e.id) AS artifact_count,
    (SELECT array_agg(DISTINCT a.type) FROM artifacts a WHERE a.experiment_id = e.id) AS artifact_types,
    (SELECT array_agg(a.filename)      FROM artifacts a WHERE a.experiment_id = e.id) AS artifact_filenames
FROM experiments e
ORDER BY e.created_at DESC;

NOTIFY pgrst, 'reload schema';
