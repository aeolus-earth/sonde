-- Enrich experiment_summary with artifact type and filename arrays
-- so the UI can filter experiments by artifact content without joining.

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
    (SELECT count(*)            FROM artifacts a WHERE a.experiment_id = e.id) AS artifact_count,
    (SELECT array_agg(DISTINCT a.type) FROM artifacts a WHERE a.experiment_id = e.id) AS artifact_types,
    (SELECT array_agg(a.filename)      FROM artifacts a WHERE a.experiment_id = e.id) AS artifact_filenames
FROM experiments e
ORDER BY e.created_at DESC;
