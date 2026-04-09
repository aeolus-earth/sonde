-- Completed projects must keep a canonical PDF report pointer.
--
-- This is added NOT VALID so legacy completed projects can be repaired
-- incrementally, while all new inserts and updates enforce the invariant.

ALTER TABLE projects
    DROP CONSTRAINT IF EXISTS projects_completed_requires_report_pdf;

ALTER TABLE projects
    ADD CONSTRAINT projects_completed_requires_report_pdf
    CHECK (status <> 'completed' OR report_pdf_artifact_id IS NOT NULL) NOT VALID;
