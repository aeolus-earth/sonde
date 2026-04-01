-- Expose directions.project_id on direction_status for UI grouping (Program → Project → Direction → Experiment).

DROP VIEW IF EXISTS direction_status;

CREATE VIEW direction_status AS
SELECT
    d.id,
    d.program,
    d.title,
    d.question,
    d.status,
    d.project_id,
    (SELECT count(*) FROM experiments e WHERE e.direction_id = d.id) AS experiment_count,
    (SELECT count(*) FROM experiments e WHERE e.direction_id = d.id AND e.status = 'complete') AS complete_count,
    (SELECT count(*) FROM experiments e WHERE e.direction_id = d.id AND e.status = 'open') AS open_count,
    (SELECT count(*) FROM experiments e WHERE e.direction_id = d.id AND e.status = 'running') AS running_count,
    d.created_at,
    d.updated_at
FROM directions d
ORDER BY d.updated_at DESC;

NOTIFY pgrst, 'reload schema';
