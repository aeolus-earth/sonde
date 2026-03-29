-- Security hardening: missing DELETE/UPDATE policies, storage RLS, email check
--
-- F1: Add DELETE policies to all core tables
-- F2: Add storage.objects RLS policies
-- F4: Add agent token revocation check
-- F7: Fix email domain validation regex

-- ---------------------------------------------------------------------------
-- F1: Missing DELETE policies on core tables
-- ---------------------------------------------------------------------------

-- Experiments
CREATE POLICY "experiments_delete" ON experiments
    FOR DELETE USING (program = ANY(user_programs()));

-- Findings
CREATE POLICY "findings_delete" ON findings
    FOR DELETE USING (program = ANY(user_programs()));

-- Directions
CREATE POLICY "directions_delete" ON directions
    FOR DELETE USING (program = ANY(user_programs()));

-- Questions
CREATE POLICY "questions_delete" ON questions
    FOR DELETE USING (program = ANY(user_programs()));

-- Artifacts: add both UPDATE and DELETE (only SELECT/INSERT existed)
CREATE POLICY "artifacts_update" ON artifacts
    FOR UPDATE USING (
        (experiment_id IS NOT NULL AND EXISTS (
            SELECT 1 FROM experiments e
            WHERE e.id = experiment_id AND e.program = ANY(user_programs())
        ))
        OR (finding_id IS NOT NULL AND EXISTS (
            SELECT 1 FROM findings f
            WHERE f.id = finding_id AND f.program = ANY(user_programs())
        ))
        OR (direction_id IS NOT NULL AND EXISTS (
            SELECT 1 FROM directions d
            WHERE d.id = direction_id AND d.program = ANY(user_programs())
        ))
    );

CREATE POLICY "artifacts_delete" ON artifacts
    FOR DELETE USING (
        (experiment_id IS NOT NULL AND EXISTS (
            SELECT 1 FROM experiments e
            WHERE e.id = experiment_id AND e.program = ANY(user_programs())
        ))
        OR (finding_id IS NOT NULL AND EXISTS (
            SELECT 1 FROM findings f
            WHERE f.id = finding_id AND f.program = ANY(user_programs())
        ))
        OR (direction_id IS NOT NULL AND EXISTS (
            SELECT 1 FROM directions d
            WHERE d.id = direction_id AND d.program = ANY(user_programs())
        ))
    );

-- ---------------------------------------------------------------------------
-- F2: Storage bucket RLS policies
-- ---------------------------------------------------------------------------

CREATE POLICY "artifacts_storage_select" ON storage.objects
    FOR SELECT USING (
        bucket_id = 'artifacts'
        AND EXISTS (
            SELECT 1 FROM artifacts a
            WHERE a.storage_path = name
            AND (
                (a.experiment_id IS NOT NULL AND EXISTS (
                    SELECT 1 FROM experiments e
                    WHERE e.id = a.experiment_id AND e.program = ANY(user_programs())
                ))
                OR (a.finding_id IS NOT NULL AND EXISTS (
                    SELECT 1 FROM findings f
                    WHERE f.id = a.finding_id AND f.program = ANY(user_programs())
                ))
                OR (a.direction_id IS NOT NULL AND EXISTS (
                    SELECT 1 FROM directions d
                    WHERE d.id = a.direction_id AND d.program = ANY(user_programs())
                ))
            )
        )
    );

CREATE POLICY "artifacts_storage_insert" ON storage.objects
    FOR INSERT WITH CHECK (
        bucket_id = 'artifacts'
        AND EXISTS (
            SELECT 1 FROM artifacts a
            WHERE a.storage_path = name
            AND (
                (a.experiment_id IS NOT NULL AND EXISTS (
                    SELECT 1 FROM experiments e
                    WHERE e.id = a.experiment_id AND e.program = ANY(user_programs())
                ))
                OR (a.finding_id IS NOT NULL AND EXISTS (
                    SELECT 1 FROM findings f
                    WHERE f.id = a.finding_id AND f.program = ANY(user_programs())
                ))
                OR (a.direction_id IS NOT NULL AND EXISTS (
                    SELECT 1 FROM directions d
                    WHERE d.id = a.direction_id AND d.program = ANY(user_programs())
                ))
            )
        )
    );

CREATE POLICY "artifacts_storage_delete" ON storage.objects
    FOR DELETE USING (
        bucket_id = 'artifacts'
        AND EXISTS (
            SELECT 1 FROM artifacts a
            WHERE a.storage_path = name
            AND (
                (a.experiment_id IS NOT NULL AND EXISTS (
                    SELECT 1 FROM experiments e
                    WHERE e.id = a.experiment_id AND e.program = ANY(user_programs())
                ))
                OR (a.finding_id IS NOT NULL AND EXISTS (
                    SELECT 1 FROM findings f
                    WHERE f.id = a.finding_id AND f.program = ANY(user_programs())
                ))
                OR (a.direction_id IS NOT NULL AND EXISTS (
                    SELECT 1 FROM directions d
                    WHERE d.id = a.direction_id AND d.program = ANY(user_programs())
                ))
            )
        )
    );

-- ---------------------------------------------------------------------------
-- F4: Agent token revocation enforcement
--     Replace user_programs() to also check token revocation status.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION user_programs()
RETURNS text[]
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT CASE
        -- If this is an agent token, verify it hasn't been revoked
        WHEN (auth.jwt() -> 'app_metadata' ->> 'agent')::boolean = true THEN
            CASE
                WHEN EXISTS (
                    SELECT 1 FROM agent_tokens
                    WHERE id = (auth.jwt() -> 'app_metadata' ->> 'token_id')::uuid
                    AND revoked_at IS NOT NULL
                )
                THEN ARRAY[]::text[]  -- Revoked: return empty → deny all access
                ELSE coalesce(
                    array(SELECT jsonb_array_elements_text(
                        auth.jwt() -> 'app_metadata' -> 'programs'
                    )),
                    ARRAY[]::text[]
                )
            END
        -- Human token: extract programs from JWT as before
        ELSE coalesce(
            array(SELECT jsonb_array_elements_text(
                auth.jwt() -> 'app_metadata' -> 'programs'
            )),
            ARRAY[]::text[]
        )
    END;
$$;

-- ---------------------------------------------------------------------------
-- F7: Fix email domain validation (anchored regex)
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.custom_access_token_hook(event jsonb)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    claims jsonb;
    user_email text;
    user_programs_arr text[];
    is_admin boolean;
BEGIN
    claims := event -> 'claims';
    user_email := claims ->> 'email';

    -- Reject non-aeolus.earth emails (defense in depth — Google hd param is primary)
    -- Anchored regex: must end with exactly @aeolus.earth
    IF user_email IS NOT NULL AND NOT (user_email ~ '^.+@aeolus\.earth$') THEN
        RETURN jsonb_build_object(
            'error', jsonb_build_object(
                'http_code', 403,
                'message', 'Only @aeolus.earth accounts are allowed'
            )
        );
    END IF;

    -- Look up user's program assignments
    SELECT
        coalesce(array_agg(up.program), ARRAY['shared']),
        coalesce(bool_or(up.role = 'admin'), false)
    INTO user_programs_arr, is_admin
    FROM user_programs up
    WHERE up.user_id = (claims ->> 'sub')::uuid;

    -- New users with no assignments get 'shared' by default
    IF user_programs_arr IS NULL OR user_programs_arr = '{}' THEN
        user_programs_arr := ARRAY['shared'];
        is_admin := false;
    END IF;

    -- Inject into app_metadata
    claims := jsonb_set(
        claims,
        '{app_metadata}',
        coalesce(claims -> 'app_metadata', '{}'::jsonb) ||
        jsonb_build_object(
            'programs', to_jsonb(user_programs_arr),
            'is_admin', is_admin
        )
    );

    event := jsonb_set(event, '{claims}', claims);
    RETURN event;
END;
$$;
