-- Add project_id to artifacts, allowing files to be attached to projects.

ALTER TABLE artifacts ADD COLUMN IF NOT EXISTS project_id TEXT REFERENCES projects(id);

-- Rebuild polymorphic constraint to include project_id
ALTER TABLE artifacts DROP CONSTRAINT IF EXISTS artifacts_single_parent;
ALTER TABLE artifacts ADD CONSTRAINT artifacts_single_parent CHECK (
    (experiment_id IS NOT NULL)::int +
    (finding_id IS NOT NULL)::int +
    (direction_id IS NOT NULL)::int +
    (project_id IS NOT NULL)::int = 1
);

CREATE INDEX IF NOT EXISTS idx_artifacts_project ON artifacts (project_id);
