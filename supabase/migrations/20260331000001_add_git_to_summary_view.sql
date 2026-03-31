-- Add git provenance columns to experiment_summary view
-- so the UI can display commit links and branch info.
--
-- CREATE OR REPLACE cannot reorder/add columns before existing ones,
-- so we must DROP + CREATE.

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
    e.git_commit,
    e.git_repo,
    e.git_branch,
    e.git_close_commit,
    e.git_close_branch,
    e.git_dirty,
    (SELECT count(*) FROM artifacts a WHERE a.experiment_id = e.id) AS artifact_count
FROM experiments e
ORDER BY e.created_at DESC;
