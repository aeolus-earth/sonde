-- Add a description (markdown) field to projects.
-- objective stays as the one-liner; description holds detailed motivation,
-- constraints, success criteria — the "why this project exists" narrative.

ALTER TABLE projects ADD COLUMN IF NOT EXISTS description TEXT;

-- Update FTS index to include description
DROP INDEX IF EXISTS idx_projects_fts;
CREATE INDEX idx_projects_fts ON projects USING GIN (
    to_tsvector('english', coalesce(name, '') || ' ' || coalesce(objective, '') || ' ' || coalesce(description, ''))
);

-- Rebuild project_status view to include description and linear_id
DROP VIEW IF EXISTS project_status;

CREATE VIEW project_status AS
SELECT
    p.id,
    p.program,
    p.name,
    p.objective,
    p.description,
    p.status,
    p.source,
    p.linear_id,
    (SELECT count(*) FROM directions d WHERE d.project_id = p.id) AS direction_count,
    (SELECT count(*) FROM experiments e WHERE e.project_id = p.id) AS experiment_count,
    (SELECT count(*) FROM experiments e WHERE e.project_id = p.id AND e.status = 'complete') AS complete_count,
    (SELECT count(*) FROM experiments e WHERE e.project_id = p.id AND e.status = 'open') AS open_count,
    (SELECT count(*) FROM experiments e WHERE e.project_id = p.id AND e.status = 'running') AS running_count,
    (SELECT count(*) FROM experiments e WHERE e.project_id = p.id AND e.status = 'failed') AS failed_count,
    p.created_at,
    p.updated_at
FROM projects p
ORDER BY p.updated_at DESC;

NOTIFY pgrst, 'reload schema';
