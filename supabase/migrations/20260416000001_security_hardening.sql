-- Security hardening: make admin privileges program-scoped, lock auth
-- telemetry writes behind a trusted RPC, and enforce agent-token expiry.

-- ---------------------------------------------------------------------------
-- 1. Program-scoped admin helpers
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.admin_programs()
RETURNS text[]
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT coalesce(array_agg(up.program ORDER BY up.program), ARRAY[]::text[])
    FROM public.user_programs up
    WHERE up.user_id = auth.uid()
      AND up.role = 'admin';
$$;

CREATE OR REPLACE FUNCTION public.is_sonde_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    -- Program admins are scoped to their programs. Admin on the cross-cutting
    -- shared program is the explicit org-admin role for global telemetry.
    SELECT 'shared' = ANY(public.admin_programs());
$$;

CREATE OR REPLACE FUNCTION public.is_program_admin(target_program text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT target_program = ANY(public.admin_programs());
$$;

CREATE OR REPLACE FUNCTION public.can_admin_programs(target_programs text[])
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    requested text[];
BEGIN
    SELECT coalesce(array_agg(trimmed ORDER BY trimmed), ARRAY[]::text[])
    INTO requested
    FROM (
        SELECT DISTINCT btrim(program) AS trimmed
        FROM unnest(coalesce(target_programs, ARRAY[]::text[])) AS program
    ) normalized;

    IF requested = ARRAY[]::text[] THEN
        RETURN false;
    END IF;

    IF EXISTS (
        SELECT 1
        FROM unnest(coalesce(target_programs, ARRAY[]::text[])) AS program
        WHERE program IS NULL OR btrim(program) = ''
    ) THEN
        RETURN false;
    END IF;

    RETURN requested <@ public.admin_programs();
END;
$$;

-- ---------------------------------------------------------------------------
-- 2. Program-scoped user/admin token management
-- ---------------------------------------------------------------------------

DROP POLICY IF EXISTS "user_programs_read_own" ON public.user_programs;
DROP POLICY IF EXISTS "user_programs_admin_all" ON public.user_programs;

CREATE POLICY "user_programs_select_own_or_program_admin" ON public.user_programs
    FOR SELECT TO authenticated
    USING (user_id = auth.uid() OR public.is_program_admin(program));

CREATE POLICY "user_programs_insert_program_admin" ON public.user_programs
    FOR INSERT TO authenticated
    WITH CHECK (public.is_program_admin(program));

CREATE POLICY "user_programs_update_program_admin" ON public.user_programs
    FOR UPDATE TO authenticated
    USING (public.is_program_admin(program))
    WITH CHECK (public.is_program_admin(program));

CREATE POLICY "user_programs_delete_program_admin" ON public.user_programs
    FOR DELETE TO authenticated
    USING (public.is_program_admin(program));

DROP POLICY IF EXISTS "agent_tokens_admin_only" ON public.agent_tokens;
DROP POLICY IF EXISTS "agent_tokens_admin_select" ON public.agent_tokens;
DROP POLICY IF EXISTS "agent_tokens_admin_insert" ON public.agent_tokens;
DROP POLICY IF EXISTS "agent_tokens_admin_update" ON public.agent_tokens;
DROP POLICY IF EXISTS "agent_tokens_admin_delete" ON public.agent_tokens;

CREATE POLICY "agent_tokens_admin_select" ON public.agent_tokens
    FOR SELECT TO authenticated
    USING (public.can_admin_programs(programs));

CREATE POLICY "agent_tokens_admin_insert" ON public.agent_tokens
    FOR INSERT TO authenticated
    WITH CHECK (
        created_by = auth.uid()
        AND public.can_admin_programs(programs)
    );

CREATE POLICY "agent_tokens_admin_update" ON public.agent_tokens
    FOR UPDATE TO authenticated
    USING (public.can_admin_programs(programs))
    WITH CHECK (public.can_admin_programs(programs));

CREATE POLICY "agent_tokens_admin_delete" ON public.agent_tokens
    FOR DELETE TO authenticated
    USING (public.can_admin_programs(programs));

CREATE OR REPLACE FUNCTION public.create_agent_token(
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
    normalized_programs text[];
    token_id uuid;
    token_sub uuid;
    expires_ts timestamptz;
    jwt_payload json;
    signed_jwt text;
BEGIN
    caller_id := auth.uid();

    SELECT coalesce(array_agg(trimmed ORDER BY trimmed), ARRAY[]::text[])
    INTO normalized_programs
    FROM (
        SELECT DISTINCT btrim(program) AS trimmed
        FROM unnest(coalesce(token_programs, ARRAY[]::text[])) AS program
    ) normalized
    WHERE trimmed <> '';

    IF normalized_programs = ARRAY[]::text[] THEN
        RAISE EXCEPTION 'At least one program is required' USING ERRCODE = '22023';
    END IF;

    IF NOT public.can_admin_programs(normalized_programs) THEN
        RAISE EXCEPTION 'Only program admins can create agent tokens for requested programs'
            USING ERRCODE = '42501';
    END IF;

    IF expires_in_days IS NULL OR expires_in_days < 1 OR expires_in_days > 365 THEN
        RAISE EXCEPTION 'Token expiry must be between 1 and 365 days' USING ERRCODE = '22023';
    END IF;

    IF EXISTS (
        SELECT 1
        FROM unnest(normalized_programs) AS p
        WHERE p NOT IN (SELECT id FROM public.programs)
    ) THEN
        RAISE EXCEPTION 'One or more programs do not exist' USING ERRCODE = 'P0001';
    END IF;

    token_id := gen_random_uuid();
    token_sub := gen_random_uuid();
    expires_ts := now() + (expires_in_days || ' days')::interval;

    INSERT INTO public.agent_tokens (id, name, programs, created_by, expires_at)
    VALUES (token_id, token_name, normalized_programs, caller_id, expires_ts);

    jwt_payload := json_build_object(
        'sub', token_sub,
        'role', 'authenticated',
        'aud', 'authenticated',
        'iss', 'sonde-cli',
        'iat', extract(epoch FROM now())::integer,
        'exp', extract(epoch FROM expires_ts)::integer,
        'app_metadata', json_build_object(
            'programs', to_json(normalized_programs),
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
        'programs', to_jsonb(normalized_programs)
    );
END;
$$;

REVOKE ALL ON FUNCTION public.create_agent_token(text, text[], integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_agent_token(text, text[], integer) TO authenticated;

-- ---------------------------------------------------------------------------
-- 3. Agent token expiry/revocation enforcement in RLS helpers
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.user_programs()
RETURNS text[]
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    jwt_programs text[];
    live_programs text[];
    is_agent boolean := coalesce((auth.jwt() -> 'app_metadata' ->> 'agent')::boolean, false);
    token_id_text text;
    token_id uuid;
    token_is_active boolean;
BEGIN
    jwt_programs := coalesce(
        array(
            SELECT jsonb_array_elements_text(auth.jwt() -> 'app_metadata' -> 'programs')
        ),
        ARRAY[]::text[]
    );

    IF is_agent THEN
        token_id_text := auth.jwt() -> 'app_metadata' ->> 'token_id';
        IF token_id_text IS NULL OR token_id_text !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
            RETURN ARRAY[]::text[];
        END IF;

        token_id := token_id_text::uuid;
        SELECT EXISTS (
            SELECT 1
            FROM public.agent_tokens token
            WHERE token.id = token_id
              AND token.revoked_at IS NULL
              AND token.expires_at > now()
              AND jwt_programs <@ token.programs
        )
        INTO token_is_active;

        IF NOT token_is_active THEN
            RETURN ARRAY[]::text[];
        END IF;

        RETURN jwt_programs;
    END IF;

    SELECT coalesce(array_agg(up.program ORDER BY up.program), ARRAY[]::text[])
    INTO live_programs
    FROM public.user_programs up
    WHERE up.user_id = auth.uid();

    IF live_programs <> ARRAY[]::text[] THEN
        RETURN live_programs;
    END IF;

    IF 'shared' = ANY(jwt_programs) THEN
        RETURN ARRAY['shared'];
    END IF;

    RETURN ARRAY[]::text[];
END;
$$;

CREATE OR REPLACE FUNCTION public.has_program_access(target_program text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT target_program = ANY(public.user_programs());
$$;

-- ---------------------------------------------------------------------------
-- 4. Auth event hardening
-- ---------------------------------------------------------------------------

DROP POLICY IF EXISTS "auth_events_select" ON public.auth_events;
DROP POLICY IF EXISTS "auth_events_insert" ON public.auth_events;
DROP POLICY IF EXISTS "auth_events_admin_select" ON public.auth_events;

CREATE POLICY "auth_events_admin_select" ON public.auth_events
    FOR SELECT TO authenticated
    USING (
        public.is_sonde_admin()
        OR coalesce(programs, ARRAY[]::text[]) && public.admin_programs()
    );

CREATE OR REPLACE FUNCTION public.record_auth_event(
    p_event_type text,
    p_client_version text DEFAULT NULL,
    p_details jsonb DEFAULT '{}'::jsonb
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    claims jsonb := auth.jwt();
    app_meta jsonb := coalesce(claims -> 'app_metadata', '{}'::jsonb);
    user_meta jsonb := coalesce(claims -> 'user_metadata', '{}'::jsonb);
    caller_id uuid := auth.uid();
    is_agent boolean := coalesce((app_meta ->> 'agent')::boolean, false);
    actor_value text;
    email_value text;
    name_value text;
BEGIN
    IF caller_id IS NULL THEN
        RAISE EXCEPTION 'Authentication is required to record auth events'
            USING ERRCODE = '42501';
    END IF;

    IF p_event_type NOT IN ('login', 'logout', 'token_auth') THEN
        RAISE EXCEPTION 'Unsupported auth event type: %', p_event_type
            USING ERRCODE = '22023';
    END IF;

    email_value := nullif(coalesce(claims ->> 'email', user_meta ->> 'email'), '');
    name_value := nullif(coalesce(user_meta ->> 'full_name', user_meta ->> 'name'), '');

    IF is_agent THEN
        actor_value := 'agent/' || coalesce(
            nullif(app_meta ->> 'agent_name', ''),
            nullif(app_meta ->> 'token_name', ''),
            nullif(claims ->> 'name', ''),
            left(caller_id::text, 8)
        );
        email_value := NULL;
    ELSE
        IF email_value IS NULL THEN
            actor_value := 'human/' || left(caller_id::text, 8);
        ELSE
            actor_value := 'human/' || split_part(email_value, '@', 1);
        END IF;
    END IF;

    INSERT INTO public.auth_events (
        event_type,
        actor,
        actor_email,
        actor_name,
        user_id,
        programs,
        client_version,
        details
    )
    VALUES (
        p_event_type,
        actor_value,
        email_value,
        name_value,
        caller_id::text,
        public.user_programs(),
        p_client_version,
        coalesce(p_details, '{}'::jsonb)
    );
END;
$$;

REVOKE ALL ON FUNCTION public.record_auth_event(text, text, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.record_auth_event(text, text, jsonb) TO authenticated;

-- ---------------------------------------------------------------------------
-- 5. Admin-only database size metrics
-- ---------------------------------------------------------------------------

DROP POLICY IF EXISTS "snapshots_select" ON public.db_size_snapshots;
DROP POLICY IF EXISTS "snapshots_admin_select" ON public.db_size_snapshots;

CREATE POLICY "snapshots_admin_select" ON public.db_size_snapshots
    FOR SELECT TO authenticated
    USING (public.is_sonde_admin());

CREATE OR REPLACE FUNCTION public.get_db_sizes()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    result JSONB;
    db_total BIGINT;
    storage_total BIGINT;
BEGIN
    IF NOT public.is_sonde_admin() THEN
        RAISE EXCEPTION 'Only admins can view database size metrics'
            USING ERRCODE = '42501';
    END IF;

    SELECT pg_database_size(current_database()) INTO db_total;

    SELECT jsonb_object_agg(relname, total_bytes)
    INTO result
    FROM (
        SELECT c.relname,
               pg_total_relation_size(c.oid) AS total_bytes
        FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public'
          AND c.relkind = 'r'
          AND c.relname IN (
              'experiments', 'findings', 'directions', 'questions',
              'projects', 'artifacts', 'notes', 'activity_log',
              'agent_tokens', 'user_programs', 'programs',
              'record_links', 'db_size_snapshots'
          )
        ORDER BY total_bytes DESC
    ) t;

    SELECT COALESCE(SUM(size_bytes), 0) INTO storage_total FROM public.artifacts;

    RETURN jsonb_build_object(
        'total_db_bytes', db_total,
        'table_sizes', COALESCE(result, '{}'::jsonb),
        'storage_bytes', storage_total,
        'captured_at', now()
    );
END;
$$;

CREATE OR REPLACE FUNCTION public.capture_db_snapshot()
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    last_capture TIMESTAMPTZ;
    sizes JSONB;
BEGIN
    IF NOT public.is_sonde_admin() THEN
        RAISE EXCEPTION 'Only admins can capture database size metrics'
            USING ERRCODE = '42501';
    END IF;

    SELECT captured_at INTO last_capture
    FROM public.db_size_snapshots
    ORDER BY captured_at DESC
    LIMIT 1;

    IF last_capture IS NOT NULL AND last_capture > now() - INTERVAL '1 hour' THEN
        RETURN FALSE;
    END IF;

    sizes := public.get_db_sizes();

    INSERT INTO public.db_size_snapshots (total_db_bytes, table_sizes, storage_bytes)
    VALUES (
        (sizes->>'total_db_bytes')::BIGINT,
        sizes->'table_sizes',
        (sizes->>'storage_bytes')::BIGINT
    );

    RETURN TRUE;
END;
$$;

REVOKE ALL ON FUNCTION public.get_db_sizes() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.capture_db_snapshot() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_db_sizes() TO authenticated;
GRANT EXECUTE ON FUNCTION public.capture_db_snapshot() TO authenticated;

-- ---------------------------------------------------------------------------
-- 6. Schema compatibility bump for the new security contract
-- ---------------------------------------------------------------------------

UPDATE public.schema_version
SET version = GREATEST(version, 3),
    updated_at = now()
WHERE singleton = TRUE;
