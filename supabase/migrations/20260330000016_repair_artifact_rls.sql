-- Repair artifact and storage RLS using helper functions instead of nested
-- policy subqueries. The previous policies could deny valid inserts even when
-- the caller had access to the parent experiment/finding/direction.

CREATE OR REPLACE FUNCTION has_program_access(target_program text)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    jwt_programs text[];
    is_agent boolean := coalesce((auth.jwt() -> 'app_metadata' ->> 'agent')::boolean, false);
BEGIN
    jwt_programs := coalesce(
        array(
            SELECT jsonb_array_elements_text(auth.jwt() -> 'app_metadata' -> 'programs')
        ),
        ARRAY[]::text[]
    );

    IF is_agent THEN
        IF EXISTS (
            SELECT 1 FROM agent_tokens
            WHERE id = (auth.jwt() -> 'app_metadata' ->> 'token_id')::uuid
            AND revoked_at IS NOT NULL
        ) THEN
            RETURN false;
        END IF;

        RETURN target_program = ANY(jwt_programs);
    END IF;

    IF auth.uid() IS NOT NULL AND EXISTS (
        SELECT 1 FROM user_programs up
        WHERE up.user_id = auth.uid() AND up.program = target_program
    ) THEN
        RETURN true;
    END IF;

    RETURN target_program = ANY(jwt_programs);
END;
$$;


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
        WHERE a.storage_path = target_storage_path
          AND (
              (a.experiment_id IS NOT NULL AND has_program_access(e.program))
              OR (a.finding_id IS NOT NULL AND has_program_access(f.program))
              OR (a.direction_id IS NOT NULL AND has_program_access(d.program))
          )
    );
$$;


DROP POLICY IF EXISTS "artifacts_select" ON artifacts;
DROP POLICY IF EXISTS "artifacts_insert" ON artifacts;
DROP POLICY IF EXISTS "artifacts_update" ON artifacts;
DROP POLICY IF EXISTS "artifacts_delete" ON artifacts;

CREATE POLICY "artifacts_select" ON artifacts
    FOR SELECT USING (
        can_access_artifact_parent(experiment_id, finding_id, direction_id)
    );

CREATE POLICY "artifacts_insert" ON artifacts
    FOR INSERT WITH CHECK (
        can_access_artifact_parent(experiment_id, finding_id, direction_id)
    );

CREATE POLICY "artifacts_update" ON artifacts
    FOR UPDATE USING (
        can_access_artifact_parent(experiment_id, finding_id, direction_id)
    )
    WITH CHECK (
        can_access_artifact_parent(experiment_id, finding_id, direction_id)
    );

CREATE POLICY "artifacts_delete" ON artifacts
    FOR DELETE USING (
        can_access_artifact_parent(experiment_id, finding_id, direction_id)
    );


DROP POLICY IF EXISTS "artifacts_storage_select" ON storage.objects;
DROP POLICY IF EXISTS "artifacts_storage_insert" ON storage.objects;
DROP POLICY IF EXISTS "artifacts_storage_update" ON storage.objects;
DROP POLICY IF EXISTS "artifacts_storage_delete" ON storage.objects;

CREATE POLICY "artifacts_storage_select" ON storage.objects
    FOR SELECT USING (
        bucket_id = 'artifacts' AND can_access_artifact_storage(name)
    );

CREATE POLICY "artifacts_storage_insert" ON storage.objects
    FOR INSERT WITH CHECK (
        bucket_id = 'artifacts' AND can_access_artifact_storage(name)
    );

CREATE POLICY "artifacts_storage_update" ON storage.objects
    FOR UPDATE USING (
        bucket_id = 'artifacts' AND can_access_artifact_storage(name)
    )
    WITH CHECK (
        bucket_id = 'artifacts' AND can_access_artifact_storage(name)
    );

CREATE POLICY "artifacts_storage_delete" ON storage.objects
    FOR DELETE USING (
        bucket_id = 'artifacts' AND can_access_artifact_storage(name)
    );
