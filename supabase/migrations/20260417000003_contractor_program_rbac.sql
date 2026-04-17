-- Contractor RBAC: explicit program grants, scoped program discovery, and
-- shared-program admins as the global access managers.

-- ---------------------------------------------------------------------------
-- 1. Admin helpers: shared admin is the explicit org-admin role
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.can_manage_program(target_program text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT public.is_sonde_admin() OR public.is_program_admin(target_program);
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

    IF public.is_sonde_admin() THEN
        RETURN true;
    END IF;

    RETURN requested <@ public.admin_programs();
END;
$$;

-- ---------------------------------------------------------------------------
-- 2. Program grants + audit trail
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.program_access_grants (
    email text NOT NULL,
    program text NOT NULL REFERENCES public.programs(id) ON DELETE CASCADE,
    role text NOT NULL DEFAULT 'member' CHECK (role IN ('member', 'admin')),
    granted_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    applied_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
    applied_at timestamptz,
    PRIMARY KEY (email, program),
    CHECK (email = lower(email)),
    CHECK (email LIKE '%@aeolus.earth')
);

ALTER TABLE public.program_access_grants ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "program_access_grants_select_manager" ON public.program_access_grants;
DROP POLICY IF EXISTS "program_access_grants_insert_manager" ON public.program_access_grants;
DROP POLICY IF EXISTS "program_access_grants_update_manager" ON public.program_access_grants;
DROP POLICY IF EXISTS "program_access_grants_delete_manager" ON public.program_access_grants;

CREATE POLICY "program_access_grants_select_manager" ON public.program_access_grants
    FOR SELECT TO authenticated
    USING (public.can_manage_program(program));

CREATE POLICY "program_access_grants_insert_manager" ON public.program_access_grants
    FOR INSERT TO authenticated
    WITH CHECK (public.can_manage_program(program));

CREATE POLICY "program_access_grants_update_manager" ON public.program_access_grants
    FOR UPDATE TO authenticated
    USING (public.can_manage_program(program))
    WITH CHECK (public.can_manage_program(program));

CREATE POLICY "program_access_grants_delete_manager" ON public.program_access_grants
    FOR DELETE TO authenticated
    USING (public.can_manage_program(program));

CREATE TABLE IF NOT EXISTS public.program_access_events (
    id bigserial PRIMARY KEY,
    action text NOT NULL CHECK (action IN ('grant', 'revoke', 'apply_pending')),
    actor_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
    actor_email text,
    target_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
    target_email text NOT NULL,
    program text NOT NULL REFERENCES public.programs(id) ON DELETE CASCADE,
    old_role text CHECK (old_role IS NULL OR old_role IN ('member', 'admin')),
    new_role text CHECK (new_role IS NULL OR new_role IN ('member', 'admin')),
    details jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.program_access_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "program_access_events_select_manager" ON public.program_access_events;
CREATE POLICY "program_access_events_select_manager" ON public.program_access_events
    FOR SELECT TO authenticated
    USING (public.can_manage_program(program));

GRANT SELECT, INSERT, UPDATE, DELETE ON public.program_access_grants TO authenticated;
GRANT SELECT ON public.program_access_events TO authenticated;
GRANT USAGE, SELECT ON SEQUENCE public.program_access_events_id_seq TO authenticated;

-- Keep existing users usable when removing the implicit shared fallback. Future
-- users must be granted explicitly or arrive through a pending grant.
INSERT INTO public.user_programs (user_id, program, role)
SELECT u.id, 'shared', 'member'
FROM auth.users u
WHERE lower(coalesce(u.email, '')) LIKE '%@aeolus.earth'
  AND NOT EXISTS (
      SELECT 1
      FROM public.user_programs up
      WHERE up.user_id = u.id
  )
ON CONFLICT (user_id, program) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 3. Guard against deleting or downgrading the last shared admin
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.prevent_last_shared_admin_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    shared_admin_count integer;
BEGIN
    IF TG_OP = 'DELETE'
       AND OLD.program = 'shared'
       AND OLD.role = 'admin' THEN
        SELECT count(*)
        INTO shared_admin_count
        FROM public.user_programs
        WHERE program = 'shared'
          AND role = 'admin';

        IF shared_admin_count <= 1 THEN
            RAISE EXCEPTION 'Cannot remove the last shared admin'
                USING ERRCODE = '42501';
        END IF;

        RETURN OLD;
    END IF;

    IF TG_OP = 'UPDATE'
       AND OLD.program = 'shared'
       AND OLD.role = 'admin'
       AND (NEW.program <> 'shared' OR NEW.role <> 'admin') THEN
        SELECT count(*)
        INTO shared_admin_count
        FROM public.user_programs
        WHERE program = 'shared'
          AND role = 'admin';

        IF shared_admin_count <= 1 THEN
            RAISE EXCEPTION 'Cannot downgrade the last shared admin'
                USING ERRCODE = '42501';
        END IF;
    END IF;

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS prevent_last_shared_admin_change ON public.user_programs;
CREATE TRIGGER prevent_last_shared_admin_change
BEFORE UPDATE OR DELETE ON public.user_programs
FOR EACH ROW
EXECUTE FUNCTION public.prevent_last_shared_admin_change();

-- ---------------------------------------------------------------------------
-- 4. Program-access RPCs used by the admin CLI
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.normalize_program_access_email(p_email text)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public
AS $$
DECLARE
    normalized text := lower(btrim(coalesce(p_email, '')));
BEGIN
    IF normalized !~ '^[^[:space:]@]+@aeolus[.]earth$' THEN
        RAISE EXCEPTION 'Only @aeolus.earth accounts can receive Sonde access'
            USING ERRCODE = '22023';
    END IF;

    RETURN normalized;
END;
$$;

CREATE OR REPLACE FUNCTION public.normalize_program_access_role(p_role text)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public
AS $$
DECLARE
    normalized text := lower(btrim(coalesce(p_role, 'member')));
BEGIN
    IF normalized = 'contributor' THEN
        RETURN 'member';
    END IF;

    IF normalized NOT IN ('member', 'admin') THEN
        RAISE EXCEPTION 'Role must be contributor or admin'
            USING ERRCODE = '22023';
    END IF;

    RETURN normalized;
END;
$$;

CREATE OR REPLACE FUNCTION public.grant_program_access(
    p_email text,
    p_program text,
    p_role text DEFAULT 'member'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    target_email text := public.normalize_program_access_email(p_email);
    target_program text := btrim(coalesce(p_program, ''));
    target_role text := public.normalize_program_access_role(p_role);
    target_user_id uuid;
    old_role text;
    result_status text;
    shared_admin_count integer;
BEGIN
    IF target_program = '' OR NOT EXISTS (SELECT 1 FROM public.programs WHERE id = target_program) THEN
        RAISE EXCEPTION 'Program does not exist: %', target_program
            USING ERRCODE = 'P0001';
    END IF;

    IF NOT public.can_manage_program(target_program) THEN
        RAISE EXCEPTION 'Only admins of % can grant program access', target_program
            USING ERRCODE = '42501';
    END IF;

    SELECT u.id
    INTO target_user_id
    FROM auth.users u
    WHERE lower(u.email) = target_email
    ORDER BY u.created_at DESC
    LIMIT 1;

    IF target_user_id IS NOT NULL THEN
        SELECT role
        INTO old_role
        FROM public.user_programs
        WHERE user_id = target_user_id
          AND program = target_program;

        IF target_program = 'shared'
           AND old_role = 'admin'
           AND target_role <> 'admin' THEN
            SELECT count(*)
            INTO shared_admin_count
            FROM public.user_programs
            WHERE program = 'shared'
              AND role = 'admin';

            IF shared_admin_count <= 1 THEN
                RAISE EXCEPTION 'Cannot downgrade the last shared admin'
                    USING ERRCODE = '42501';
            END IF;
        END IF;

        INSERT INTO public.user_programs (user_id, program, role)
        VALUES (target_user_id, target_program, target_role)
        ON CONFLICT (user_id, program) DO UPDATE
        SET role = EXCLUDED.role;

        result_status := 'active';
    ELSE
        result_status := 'pending';
    END IF;

    INSERT INTO public.program_access_grants (
        email,
        program,
        role,
        granted_by,
        created_at,
        applied_user_id,
        applied_at
    )
    VALUES (
        target_email,
        target_program,
        target_role,
        auth.uid(),
        now(),
        target_user_id,
        CASE WHEN target_user_id IS NULL THEN NULL ELSE now() END
    )
    ON CONFLICT (email, program) DO UPDATE
    SET role = EXCLUDED.role,
        granted_by = EXCLUDED.granted_by,
        created_at = EXCLUDED.created_at,
        applied_user_id = EXCLUDED.applied_user_id,
        applied_at = EXCLUDED.applied_at;

    INSERT INTO public.program_access_events (
        action,
        actor_user_id,
        actor_email,
        target_user_id,
        target_email,
        program,
        old_role,
        new_role,
        details
    )
    VALUES (
        'grant',
        auth.uid(),
        auth.jwt() ->> 'email',
        target_user_id,
        target_email,
        target_program,
        old_role,
        target_role,
        jsonb_build_object('status', result_status)
    );

    RETURN jsonb_build_object(
        'email', target_email,
        'program', target_program,
        'role', target_role,
        'status', result_status,
        'user_id', target_user_id
    );
END;
$$;

CREATE OR REPLACE FUNCTION public.revoke_program_access(
    p_email text,
    p_program text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    target_email text := public.normalize_program_access_email(p_email);
    target_program text := btrim(coalesce(p_program, ''));
    target_user_id uuid;
    old_role text;
    deleted_grants integer := 0;
    deleted_active integer := 0;
    shared_admin_count integer;
BEGIN
    IF target_program = '' OR NOT EXISTS (SELECT 1 FROM public.programs WHERE id = target_program) THEN
        RAISE EXCEPTION 'Program does not exist: %', target_program
            USING ERRCODE = 'P0001';
    END IF;

    IF NOT public.can_manage_program(target_program) THEN
        RAISE EXCEPTION 'Only admins of % can revoke program access', target_program
            USING ERRCODE = '42501';
    END IF;

    SELECT u.id
    INTO target_user_id
    FROM auth.users u
    WHERE lower(u.email) = target_email
    ORDER BY u.created_at DESC
    LIMIT 1;

    IF target_user_id IS NOT NULL THEN
        SELECT role
        INTO old_role
        FROM public.user_programs
        WHERE user_id = target_user_id
          AND program = target_program;

        IF target_program = 'shared' AND old_role = 'admin' THEN
            SELECT count(*)
            INTO shared_admin_count
            FROM public.user_programs
            WHERE program = 'shared'
              AND role = 'admin';

            IF shared_admin_count <= 1 THEN
                RAISE EXCEPTION 'Cannot revoke the last shared admin'
                    USING ERRCODE = '42501';
            END IF;
        END IF;

        DELETE FROM public.user_programs
        WHERE user_id = target_user_id
          AND program = target_program;
        GET DIAGNOSTICS deleted_active = ROW_COUNT;
    END IF;

    DELETE FROM public.program_access_grants
    WHERE email = target_email
      AND program = target_program;
    GET DIAGNOSTICS deleted_grants = ROW_COUNT;

    INSERT INTO public.program_access_events (
        action,
        actor_user_id,
        actor_email,
        target_user_id,
        target_email,
        program,
        old_role,
        new_role,
        details
    )
    VALUES (
        'revoke',
        auth.uid(),
        auth.jwt() ->> 'email',
        target_user_id,
        target_email,
        target_program,
        old_role,
        NULL,
        jsonb_build_object(
            'revoked_active', deleted_active > 0,
            'revoked_pending', deleted_grants > 0
        )
    );

    RETURN jsonb_build_object(
        'email', target_email,
        'program', target_program,
        'revoked_active', deleted_active > 0,
        'revoked_pending', deleted_grants > 0
    );
END;
$$;

CREATE OR REPLACE FUNCTION public.list_program_access(p_program text)
RETURNS TABLE (
    email text,
    user_id uuid,
    program text,
    role text,
    status text,
    granted_at timestamptz,
    applied_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    target_program text := btrim(coalesce(p_program, ''));
BEGIN
    IF target_program = '' OR NOT EXISTS (SELECT 1 FROM public.programs WHERE id = target_program) THEN
        RAISE EXCEPTION 'Program does not exist: %', target_program
            USING ERRCODE = 'P0001';
    END IF;

    IF NOT public.can_manage_program(target_program) THEN
        RAISE EXCEPTION 'Only admins of % can list program access', target_program
            USING ERRCODE = '42501';
    END IF;

    RETURN QUERY
    SELECT
        lower(u.email)::text AS email,
        up.user_id,
        up.program,
        up.role,
        'active'::text AS status,
        coalesce(g.created_at, up.created_at) AS granted_at,
        g.applied_at
    FROM public.user_programs up
    JOIN auth.users u ON u.id = up.user_id
    LEFT JOIN public.program_access_grants g
      ON g.email = lower(u.email)
     AND g.program = up.program
    WHERE up.program = target_program

    UNION ALL

    SELECT
        g.email,
        NULL::uuid AS user_id,
        g.program,
        g.role,
        'pending'::text AS status,
        g.created_at AS granted_at,
        NULL::timestamptz AS applied_at
    FROM public.program_access_grants g
    LEFT JOIN auth.users u ON lower(u.email) = g.email
    LEFT JOIN public.user_programs up
      ON up.user_id = u.id
     AND up.program = g.program
    WHERE g.program = target_program
      AND u.id IS NULL
    ORDER BY status, email;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_user_program_access(p_email text)
RETURNS TABLE (
    email text,
    user_id uuid,
    program text,
    role text,
    status text,
    granted_at timestamptz,
    applied_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    target_email text := public.normalize_program_access_email(p_email);
BEGIN
    RETURN QUERY
    SELECT
        lower(u.email)::text AS email,
        up.user_id,
        up.program,
        up.role,
        'active'::text AS status,
        coalesce(g.created_at, up.created_at) AS granted_at,
        g.applied_at
    FROM public.user_programs up
    JOIN auth.users u ON u.id = up.user_id
    LEFT JOIN public.program_access_grants g
      ON g.email = lower(u.email)
     AND g.program = up.program
    WHERE lower(u.email) = target_email
      AND public.can_manage_program(up.program)

    UNION ALL

    SELECT
        g.email,
        NULL::uuid AS user_id,
        g.program,
        g.role,
        'pending'::text AS status,
        g.created_at AS granted_at,
        NULL::timestamptz AS applied_at
    FROM public.program_access_grants g
    LEFT JOIN auth.users u ON lower(u.email) = g.email
    LEFT JOIN public.user_programs up
      ON up.user_id = u.id
     AND up.program = g.program
    WHERE g.email = target_email
      AND u.id IS NULL
      AND public.can_manage_program(g.program)
    ORDER BY status, program;
END;
$$;

REVOKE ALL ON FUNCTION public.normalize_program_access_email(text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.normalize_program_access_role(text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.grant_program_access(text, text, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.revoke_program_access(text, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.list_program_access(text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_user_program_access(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.grant_program_access(text, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.revoke_program_access(text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.list_program_access(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_user_program_access(text) TO authenticated;

-- ---------------------------------------------------------------------------
-- 5. Apply pending grants when an Aeolus-managed Google account first appears
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.apply_pending_program_access_grants()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    normalized_email text;
    grant_row public.program_access_grants%rowtype;
BEGIN
    normalized_email := lower(coalesce(NEW.email, ''));

    IF normalized_email NOT LIKE '%@aeolus.earth' THEN
        RETURN NEW;
    END IF;

    FOR grant_row IN
        SELECT *
        FROM public.program_access_grants
        WHERE email = normalized_email
    LOOP
        INSERT INTO public.user_programs (user_id, program, role)
        VALUES (NEW.id, grant_row.program, grant_row.role)
        ON CONFLICT (user_id, program) DO UPDATE
        SET role = EXCLUDED.role;

        UPDATE public.program_access_grants
        SET applied_user_id = NEW.id,
            applied_at = now()
        WHERE email = grant_row.email
          AND program = grant_row.program;

        INSERT INTO public.program_access_events (
            action,
            actor_user_id,
            target_user_id,
            target_email,
            program,
            old_role,
            new_role,
            details
        )
        VALUES (
            'apply_pending',
            grant_row.granted_by,
            NEW.id,
            normalized_email,
            grant_row.program,
            NULL,
            grant_row.role,
            jsonb_build_object('source', 'auth.users trigger')
        );
    END LOOP;

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS apply_pending_program_access_grants ON auth.users;
CREATE TRIGGER apply_pending_program_access_grants
AFTER INSERT ON auth.users
FOR EACH ROW
EXECUTE FUNCTION public.apply_pending_program_access_grants();

-- ---------------------------------------------------------------------------
-- 6. RLS: explicit grants only, and programs are not world-readable metadata
-- ---------------------------------------------------------------------------

DROP POLICY IF EXISTS "user_programs_select_own_or_program_admin" ON public.user_programs;
DROP POLICY IF EXISTS "user_programs_insert_program_admin" ON public.user_programs;
DROP POLICY IF EXISTS "user_programs_update_program_admin" ON public.user_programs;
DROP POLICY IF EXISTS "user_programs_delete_program_admin" ON public.user_programs;

CREATE POLICY "user_programs_select_own_or_program_admin" ON public.user_programs
    FOR SELECT TO authenticated
    USING (user_id = auth.uid() OR public.can_manage_program(program));

CREATE POLICY "user_programs_insert_program_admin" ON public.user_programs
    FOR INSERT TO authenticated
    WITH CHECK (public.can_manage_program(program));

CREATE POLICY "user_programs_update_program_admin" ON public.user_programs
    FOR UPDATE TO authenticated
    USING (public.can_manage_program(program))
    WITH CHECK (public.can_manage_program(program));

CREATE POLICY "user_programs_delete_program_admin" ON public.user_programs
    FOR DELETE TO authenticated
    USING (public.can_manage_program(program));

DROP POLICY IF EXISTS "programs_read" ON public.programs;
DROP POLICY IF EXISTS "programs_select_scoped" ON public.programs;

CREATE POLICY "programs_select_scoped" ON public.programs
    FOR SELECT TO authenticated
    USING (id = ANY(public.user_programs()) OR public.is_sonde_admin());

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

    RETURN live_programs;
END;
$$;

CREATE OR REPLACE FUNCTION public.custom_access_token_hook(event jsonb)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    claims jsonb;
    app_meta jsonb;
    user_email text;
    user_programs_arr text[];
    agent_programs text[];
    is_admin boolean;
    is_agent boolean;
    token_id_text text;
    token_id uuid;
    token_name text;
BEGIN
    claims := event -> 'claims';
    app_meta := coalesce(claims -> 'app_metadata', '{}'::jsonb);
    user_email := claims ->> 'email';
    is_agent := coalesce((app_meta ->> 'agent')::boolean, false);

    IF user_email IS NOT NULL AND user_email NOT LIKE '%@aeolus.earth' THEN
        RETURN jsonb_build_object(
            'error', jsonb_build_object(
                'http_code', 403,
                'message', 'Only @aeolus.earth accounts are allowed'
            )
        );
    END IF;

    IF is_agent THEN
        token_id_text := app_meta ->> 'token_id';
        IF token_id_text IS NULL
           OR token_id_text !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
            RETURN jsonb_build_object(
                'error', jsonb_build_object(
                    'http_code', 403,
                    'message', 'Invalid or expired agent token'
                )
            );
        END IF;

        token_id := token_id_text::uuid;
        SELECT token.programs, token.name
        INTO agent_programs, token_name
        FROM public.agent_tokens token
        WHERE token.id = token_id
          AND token.revoked_at IS NULL
          AND token.expires_at > now();

        IF NOT FOUND THEN
            RETURN jsonb_build_object(
                'error', jsonb_build_object(
                    'http_code', 403,
                    'message', 'Invalid or expired agent token'
                )
            );
        END IF;

        claims := jsonb_set(
            claims,
            '{app_metadata}',
            app_meta ||
            jsonb_build_object(
                'agent', true,
                'programs', to_jsonb(agent_programs),
                'is_admin', false,
                'token_id', token_id,
                'token_name', token_name,
                'agent_name', token_name
            )
        );

        event := jsonb_set(event, '{claims}', claims);
        RETURN event;
    END IF;

    SELECT
        coalesce(array_agg(up.program ORDER BY up.program), ARRAY[]::text[]),
        coalesce(bool_or(up.role = 'admin'), false)
    INTO user_programs_arr, is_admin
    FROM public.user_programs up
    WHERE up.user_id = (claims ->> 'sub')::uuid;

    claims := jsonb_set(
        claims,
        '{app_metadata}',
        app_meta ||
        jsonb_build_object(
            'programs', to_jsonb(coalesce(user_programs_arr, ARRAY[]::text[])),
            'is_admin', coalesce(is_admin, false)
        )
    );

    event := jsonb_set(event, '{claims}', claims);
    RETURN event;
END;
$$;

GRANT EXECUTE ON FUNCTION public.custom_access_token_hook(jsonb) TO supabase_auth_admin;
GRANT SELECT ON TABLE public.user_programs TO supabase_auth_admin;
GRANT SELECT ON TABLE public.agent_tokens TO supabase_auth_admin;
REVOKE EXECUTE ON FUNCTION public.custom_access_token_hook(jsonb) FROM authenticated, anon, public;

UPDATE public.schema_version
SET version = GREATEST(version, 6),
    updated_at = now()
WHERE singleton = TRUE;
