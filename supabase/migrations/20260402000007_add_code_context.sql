-- Multi-repo code context: snapshot git state of all tracked repos at experiment time.
-- Stores an array of {name, remote, commit, branch, dirty, modified_files} objects.

ALTER TABLE experiments ADD COLUMN IF NOT EXISTS code_context JSONB;

-- Recreate experiment_summary view to include code_context
DROP VIEW IF EXISTS experiment_summary;

CREATE VIEW experiment_summary AS
SELECT
    e.id,
    e.program,
    e.status,
    e.source,
    e.content,
    e.hypothesis,
    e.parameters,
    e.results,
    e.finding,
    e.metadata,
    e.direction_id,
    e.project_id,
    e.linear_id,
    e.tags,
    e.related,
    e.data_sources,
    e.created_at,
    e.updated_at,
    e.run_at,
    e.parent_id,
    e.branch_type,
    e.claimed_by,
    e.claimed_at,
    e.git_commit,
    e.git_repo,
    e.git_branch,
    e.git_close_commit,
    e.git_close_branch,
    e.git_dirty,
    e.code_context,
    (SELECT count(*)                   FROM artifacts a WHERE a.experiment_id = e.id) AS artifact_count,
    (SELECT array_agg(DISTINCT a.type) FROM artifacts a WHERE a.experiment_id = e.id) AS artifact_types,
    (SELECT array_agg(a.filename)      FROM artifacts a WHERE a.experiment_id = e.id) AS artifact_filenames
FROM experiments e
ORDER BY e.created_at DESC;

NOTIFY pgrst, 'reload schema';
