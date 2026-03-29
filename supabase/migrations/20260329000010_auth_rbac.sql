-- RBAC: program-scoped access via JWT claims
--
-- Two auth paths produce the same JWT shape:
--   Human login → Custom Access Token Hook injects programs from user_programs table
--   Agent token → programs baked into JWT at creation time
--
-- RLS reads auth.jwt()->'app_metadata'->'programs' to scope all queries.

-- ---------------------------------------------------------------------------
-- 1. Tables
-- ---------------------------------------------------------------------------

CREATE TABLE user_programs (
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    program TEXT NOT NULL REFERENCES programs(id),
    role TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('member', 'admin')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, program)
);

ALTER TABLE user_programs ENABLE ROW LEVEL SECURITY;

-- Admins can manage user_programs; members can read their own
CREATE POLICY "user_programs_read_own" ON user_programs
    FOR SELECT USING (user_id = auth.uid());

CREATE POLICY "user_programs_admin_all" ON user_programs
    FOR ALL USING (
        EXISTS (
            SELECT 1 FROM user_programs up
            WHERE up.user_id = auth.uid() AND up.role = 'admin'
        )
    );

CREATE TABLE agent_tokens (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    programs TEXT[] NOT NULL,
    created_by UUID NOT NULL REFERENCES auth.users(id),
    expires_at TIMESTAMPTZ NOT NULL,
    revoked_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE agent_tokens ENABLE ROW LEVEL SECURITY;

CREATE POLICY "agent_tokens_admin_only" ON agent_tokens
    FOR ALL USING (
        EXISTS (
            SELECT 1 FROM user_programs up
            WHERE up.user_id = auth.uid() AND up.role = 'admin'
        )
    );

-- ---------------------------------------------------------------------------
-- 2. Helper: extract programs from JWT
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION user_programs()
RETURNS text[]
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT coalesce(
        array(
            SELECT jsonb_array_elements_text(
                auth.jwt() -> 'app_metadata' -> 'programs'
            )
        ),
        ARRAY[]::text[]
    );
$$;

-- ---------------------------------------------------------------------------
-- 3. Replace permissive RLS with program-scoped policies
-- ---------------------------------------------------------------------------

-- Programs: everyone can read (they're public metadata)
-- (keep existing programs_read policy — it's already correct)

-- Experiments
DROP POLICY IF EXISTS "experiments_read" ON experiments;
DROP POLICY IF EXISTS "experiments_insert" ON experiments;
DROP POLICY IF EXISTS "experiments_update" ON experiments;

CREATE POLICY "experiments_select" ON experiments
    FOR SELECT USING (program = ANY(user_programs()));
CREATE POLICY "experiments_insert" ON experiments
    FOR INSERT WITH CHECK (program = ANY(user_programs()));
CREATE POLICY "experiments_update" ON experiments
    FOR UPDATE USING (program = ANY(user_programs()));

-- Findings
DROP POLICY IF EXISTS "findings_read" ON findings;
DROP POLICY IF EXISTS "findings_insert" ON findings;
DROP POLICY IF EXISTS "findings_update" ON findings;

CREATE POLICY "findings_select" ON findings
    FOR SELECT USING (program = ANY(user_programs()));
CREATE POLICY "findings_insert" ON findings
    FOR INSERT WITH CHECK (program = ANY(user_programs()));
CREATE POLICY "findings_update" ON findings
    FOR UPDATE USING (program = ANY(user_programs()));

-- Directions
DROP POLICY IF EXISTS "directions_read" ON directions;
DROP POLICY IF EXISTS "directions_insert" ON directions;
DROP POLICY IF EXISTS "directions_update" ON directions;

CREATE POLICY "directions_select" ON directions
    FOR SELECT USING (program = ANY(user_programs()));
CREATE POLICY "directions_insert" ON directions
    FOR INSERT WITH CHECK (program = ANY(user_programs()));
CREATE POLICY "directions_update" ON directions
    FOR UPDATE USING (program = ANY(user_programs()));

-- Questions
DROP POLICY IF EXISTS "questions_read" ON questions;
DROP POLICY IF EXISTS "questions_insert" ON questions;
DROP POLICY IF EXISTS "questions_update" ON questions;

CREATE POLICY "questions_select" ON questions
    FOR SELECT USING (program = ANY(user_programs()));
CREATE POLICY "questions_insert" ON questions
    FOR INSERT WITH CHECK (program = ANY(user_programs()));
CREATE POLICY "questions_update" ON questions
    FOR UPDATE USING (program = ANY(user_programs()));

-- Artifacts: scoped via parent experiment/finding/direction
DROP POLICY IF EXISTS "artifacts_read" ON artifacts;
DROP POLICY IF EXISTS "artifacts_insert" ON artifacts;

CREATE POLICY "artifacts_select" ON artifacts
    FOR SELECT USING (
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

CREATE POLICY "artifacts_insert" ON artifacts
    FOR INSERT WITH CHECK (
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
-- 4. Custom Access Token Hook
--    Injects programs into JWT on login. Rejects non-aeolus.earth emails.
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

    -- Reject non-aeolus.earth emails (defense in depth — Google hd param is UI-only)
    IF user_email IS NOT NULL AND user_email NOT LIKE '%@aeolus.earth' THEN
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

-- Required grants for auth hooks
GRANT USAGE ON SCHEMA public TO supabase_auth_admin;
GRANT EXECUTE ON FUNCTION public.custom_access_token_hook TO supabase_auth_admin;
GRANT SELECT ON TABLE public.user_programs TO supabase_auth_admin;
REVOKE EXECUTE ON FUNCTION public.custom_access_token_hook FROM authenticated, anon, public;

-- ---------------------------------------------------------------------------
-- 5. Enable pgjwt for agent token signing
-- ---------------------------------------------------------------------------

CREATE EXTENSION IF NOT EXISTS pgjwt WITH SCHEMA extensions;

-- ---------------------------------------------------------------------------
-- 6. RPC: create agent tokens (admin only)
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION create_agent_token(
    token_name text,
    token_programs text[],
    expires_in_days integer DEFAULT 365
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    caller_id uuid;
    is_caller_admin boolean;
    token_id uuid;
    token_sub uuid;
    expires_ts timestamptz;
    jwt_payload jsonb;
    signed_jwt text;
BEGIN
    caller_id := auth.uid();

    -- Verify caller is admin
    SELECT bool_or(role = 'admin') INTO is_caller_admin
    FROM user_programs WHERE user_id = caller_id;

    IF NOT coalesce(is_caller_admin, false) THEN
        RAISE EXCEPTION 'Only admins can create agent tokens';
    END IF;

    -- Validate all programs exist
    IF EXISTS (
        SELECT 1 FROM unnest(token_programs) AS p
        WHERE p NOT IN (SELECT id FROM programs)
    ) THEN
        RAISE EXCEPTION 'One or more programs do not exist';
    END IF;

    token_id := gen_random_uuid();
    token_sub := gen_random_uuid();
    expires_ts := now() + (expires_in_days || ' days')::interval;

    INSERT INTO agent_tokens (id, name, programs, created_by, expires_at)
    VALUES (token_id, token_name, token_programs, caller_id, expires_ts);

    jwt_payload := jsonb_build_object(
        'sub', token_sub,
        'role', 'authenticated',
        'aud', 'authenticated',
        'iss', 'sonde-cli',
        'iat', extract(epoch FROM now())::integer,
        'exp', extract(epoch FROM expires_ts)::integer,
        'app_metadata', jsonb_build_object(
            'programs', to_jsonb(token_programs),
            'agent', true,
            'token_id', token_id,
            'token_name', token_name
        )
    );

    SELECT extensions.sign(jwt_payload, current_setting('app.settings.jwt_secret'))
    INTO signed_jwt;

    RETURN jsonb_build_object(
        'token_id', token_id,
        'token', 'sonde_at_' || signed_jwt,
        'expires_at', expires_ts,
        'programs', to_jsonb(token_programs)
    );
END;
$$;

-- Only authenticated users can call (function checks admin internally)
GRANT EXECUTE ON FUNCTION create_agent_token TO authenticated;
