-- Fix artifacts_storage_path_matches_parent check constraint to include project_id.
--
-- The original constraint (20260330000009) only covered experiment_id,
-- finding_id, and direction_id. When project_id was added as a parent FK
-- (20260401000004), this constraint was not updated. Project-scoped artifacts
-- (e.g. report PDFs) use storage paths like "PROJ-013/reports/project-report.pdf"
-- which fail the old constraint.

ALTER TABLE artifacts DROP CONSTRAINT IF EXISTS artifacts_storage_path_matches_parent;

ALTER TABLE artifacts
    ADD CONSTRAINT artifacts_storage_path_matches_parent
    CHECK (
        (experiment_id IS NOT NULL AND storage_path LIKE experiment_id || '/%')
        OR (finding_id IS NOT NULL AND storage_path LIKE finding_id || '/%')
        OR (direction_id IS NOT NULL AND storage_path LIKE direction_id || '/%')
        OR (project_id IS NOT NULL AND storage_path LIKE project_id || '/%')
    ) NOT VALID;
