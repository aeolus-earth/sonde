-- Canonical project report pointers.
--
-- Report files remain ordinary rows in artifacts; projects only keep pointers
-- to the PDF deliverable and editable LaTeX entrypoint.

ALTER TABLE projects
    ADD COLUMN IF NOT EXISTS report_pdf_artifact_id TEXT REFERENCES artifacts(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS report_tex_artifact_id TEXT REFERENCES artifacts(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS report_updated_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_projects_report_pdf_artifact
    ON projects (report_pdf_artifact_id);

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
    p.report_pdf_artifact_id,
    p.report_tex_artifact_id,
    p.report_updated_at,
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
