-- Fix artifact RLS to support project_id as a parent.
--
-- The can_access_artifact_parent function was created before artifacts could
-- belong to projects. When project_id was added (20260401000004), the RLS
-- helper was never updated. This blocks all artifact inserts/selects for
-- project-scoped artifacts (e.g. project reports).

CREATE OR REPLACE FUNCTION can_access_artifact_parent(
    target_experiment_id text,
    target_finding_id text,
    target_direction_id text
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT
        (target_experiment_id IS NOT NULL AND EXISTS (
            SELECT 1 FROM experiments e
            WHERE e.id = target_experiment_id
              AND has_program_access(e.program)
        ))
        OR (target_finding_id IS NOT NULL AND EXISTS (
            SELECT 1 FROM findings f
            WHERE f.id = target_finding_id
              AND has_program_access(f.program)
        ))
        OR (target_direction_id IS NOT NULL AND EXISTS (
            SELECT 1 FROM directions d
            WHERE d.id = target_direction_id
              AND has_program_access(d.program)
        ));
$$;

-- New 4-arg overload that includes project_id.
CREATE OR REPLACE FUNCTION can_access_artifact_parent(
    target_experiment_id text,
    target_finding_id text,
    target_direction_id text,
    target_project_id text
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT
        (target_experiment_id IS NOT NULL AND EXISTS (
            SELECT 1 FROM experiments e
            WHERE e.id = target_experiment_id
              AND has_program_access(e.program)
        ))
        OR (target_finding_id IS NOT NULL AND EXISTS (
            SELECT 1 FROM findings f
            WHERE f.id = target_finding_id
              AND has_program_access(f.program)
        ))
        OR (target_direction_id IS NOT NULL AND EXISTS (
            SELECT 1 FROM directions d
            WHERE d.id = target_direction_id
              AND has_program_access(d.program)
        ))
        OR (target_project_id IS NOT NULL AND EXISTS (
            SELECT 1 FROM projects p
            WHERE p.id = target_project_id
              AND has_program_access(p.program)
        ));
$$;

-- Rebuild artifact RLS policies to use the 4-arg overload.

DROP POLICY IF EXISTS "artifacts_select" ON artifacts;
DROP POLICY IF EXISTS "artifacts_insert" ON artifacts;
DROP POLICY IF EXISTS "artifacts_update" ON artifacts;
DROP POLICY IF EXISTS "artifacts_delete" ON artifacts;

CREATE POLICY "artifacts_select" ON artifacts
    FOR SELECT USING (
        can_access_artifact_parent(experiment_id, finding_id, direction_id, project_id)
    );

CREATE POLICY "artifacts_insert" ON artifacts
    FOR INSERT WITH CHECK (
        can_access_artifact_parent(experiment_id, finding_id, direction_id, project_id)
    );

CREATE POLICY "artifacts_update" ON artifacts
    FOR UPDATE USING (
        can_access_artifact_parent(experiment_id, finding_id, direction_id, project_id)
    )
    WITH CHECK (
        can_access_artifact_parent(experiment_id, finding_id, direction_id, project_id)
    );

CREATE POLICY "artifacts_delete" ON artifacts
    FOR DELETE USING (
        can_access_artifact_parent(experiment_id, finding_id, direction_id, project_id)
    );

-- Also fix storage RLS to join through project_id.
CREATE OR REPLACE FUNCTION can_access_artifact_storage(target_storage_path text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT EXISTS (
        SELECT 1
        FROM artifacts a
        LEFT JOIN experiments e ON e.id = a.experiment_id
        LEFT JOIN findings f ON f.id = a.finding_id
        LEFT JOIN directions d ON d.id = a.direction_id
        LEFT JOIN projects p ON p.id = a.project_id
        WHERE a.storage_path = target_storage_path
          AND (
              (a.experiment_id IS NOT NULL AND has_program_access(e.program))
              OR (a.finding_id IS NOT NULL AND has_program_access(f.program))
              OR (a.direction_id IS NOT NULL AND has_program_access(d.program))
              OR (a.project_id IS NOT NULL AND has_program_access(p.program))
          )
    );
$$;
