-- Expiring program access grants and bulk offboarding helpers.
--
-- The existing RBAC boundary remains program/library scoped. This migration
-- adds an operational expiry layer on top of explicit grants while preserving
-- legacy user_programs rows that do not have a matching grant record.

ALTER TABLE public.program_access_grants
    ADD COLUMN IF NOT EXISTS expires_at timestamptz;

-- Program-admin helpers must ignore expired grant-backed access. Rows in
-- user_programs without a grant are treated as durable legacy/FTE access.
CREATE OR REPLACE FUNCTION public.admin_programs()
RETURNS text[]
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT coalesce(array_agg(up.program ORDER BY up.program), ARRAY[]::text[])
    FROM public.user_programs up
    JOIN auth.users u ON u.id = up.user_id
    LEFT JOIN public.program_access_grants g
      ON g.email = lower(u.email)
     AND g.program = up.program
    WHERE up.user_id = auth.uid()
      AND up.role = 'admin'
      AND (g.expires_at IS NULL OR g.expires_at > now());
$$;

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
    JOIN auth.users u ON u.id = up.user_id
    LEFT JOIN public.program_access_grants g
      ON g.email = lower(u.email)
     AND g.program = up.program
    WHERE up.user_id = auth.uid()
      AND (g.expires_at IS NULL OR g.expires_at > now());

    RETURN live_programs;
END;
$$;

DROP FUNCTION IF EXISTS public.grant_program_access(text, text, text);
CREATE OR REPLACE FUNCTION public.grant_program_access(
    p_email text,
    p_program text,
    p_role text DEFAULT 'member',
    p_expires_at timestamptz DEFAULT NULL
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
    target_expires_at timestamptz := p_expires_at;
    target_user_id uuid;
    old_role text;
    result_status text;
    shared_admin_count integer;
BEGIN
    IF target_expires_at IS NOT NULL AND target_expires_at <= now() THEN
        RAISE EXCEPTION 'Expiration must be in the future'
            USING ERRCODE = '22023';
    END IF;

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
            FROM public.user_programs up
            JOIN auth.users u ON u.id = up.user_id
            LEFT JOIN public.program_access_grants g
              ON g.email = lower(u.email)
             AND g.program = up.program
            WHERE up.program = 'shared'
              AND up.role = 'admin'
              AND (g.expires_at IS NULL OR g.expires_at > now());

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
        applied_at,
        expires_at
    )
    VALUES (
        target_email,
        target_program,
        target_role,
        auth.uid(),
        now(),
        target_user_id,
        CASE WHEN target_user_id IS NULL THEN NULL ELSE now() END,
        target_expires_at
    )
    ON CONFLICT (email, program) DO UPDATE
    SET role = EXCLUDED.role,
        granted_by = EXCLUDED.granted_by,
        created_at = EXCLUDED.created_at,
        applied_user_id = EXCLUDED.applied_user_id,
        applied_at = EXCLUDED.applied_at,
        expires_at = EXCLUDED.expires_at;

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
        jsonb_build_object(
            'status', result_status,
            'expires_at', target_expires_at
        )
    );

    RETURN jsonb_build_object(
        'email', target_email,
        'program', target_program,
        'role', target_role,
        'status', result_status,
        'user_id', target_user_id,
        'expires_at', target_expires_at
    );
END;
$$;

CREATE OR REPLACE FUNCTION public.revoke_user_program_access(p_email text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    target_email text := public.normalize_program_access_email(p_email);
    target_user_id uuid;
    access_row record;
    deleted_grants integer := 0;
    deleted_active integer := 0;
    shared_admin_count integer;
    revoked_programs jsonb := '[]'::jsonb;
    skipped_programs jsonb := '[]'::jsonb;
BEGIN
    SELECT u.id
    INTO target_user_id
    FROM auth.users u
    WHERE lower(u.email) = target_email
    ORDER BY u.created_at DESC
    LIMIT 1;

    FOR access_row IN
        SELECT DISTINCT ON (program)
            program,
            role,
            has_active,
            has_grant
        FROM (
            SELECT
                up.program,
                up.role,
                true AS has_active,
                false AS has_grant
            FROM public.user_programs up
            JOIN auth.users u ON u.id = up.user_id
            WHERE lower(u.email) = target_email
              AND public.can_manage_program(up.program)

            UNION ALL

            SELECT
                g.program,
                g.role,
                false AS has_active,
                true AS has_grant
            FROM public.program_access_grants g
            WHERE g.email = target_email
              AND public.can_manage_program(g.program)
        ) scoped_access
        ORDER BY program, has_active DESC
    LOOP
        deleted_active := 0;
        deleted_grants := 0;

        IF access_row.program = 'shared' AND access_row.role = 'admin' THEN
            SELECT count(*)
            INTO shared_admin_count
            FROM public.user_programs up
            JOIN auth.users u ON u.id = up.user_id
            LEFT JOIN public.program_access_grants g
              ON g.email = lower(u.email)
             AND g.program = up.program
            WHERE up.program = 'shared'
              AND up.role = 'admin'
              AND (g.expires_at IS NULL OR g.expires_at > now());

            IF shared_admin_count <= 1 THEN
                skipped_programs := skipped_programs || jsonb_build_array(
                    jsonb_build_object(
                        'program', access_row.program,
                        'reason', 'last_shared_admin'
                    )
                );
                CONTINUE;
            END IF;
        END IF;

        IF target_user_id IS NOT NULL THEN
            DELETE FROM public.user_programs
            WHERE user_id = target_user_id
              AND program = access_row.program;
            GET DIAGNOSTICS deleted_active = ROW_COUNT;
        END IF;

        DELETE FROM public.program_access_grants
        WHERE email = target_email
          AND program = access_row.program;
        GET DIAGNOSTICS deleted_grants = ROW_COUNT;

        IF deleted_active > 0 OR deleted_grants > 0 THEN
            revoked_programs := revoked_programs || jsonb_build_array(
                jsonb_build_object(
                    'program', access_row.program,
                    'revoked_active', deleted_active > 0,
                    'revoked_grant', deleted_grants > 0
                )
            );

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
                access_row.program,
                access_row.role,
                NULL,
                jsonb_build_object(
                    'source', 'bulk_offboard',
                    'revoked_active', deleted_active > 0,
                    'revoked_grant', deleted_grants > 0
                )
            );
        END IF;
    END LOOP;

    RETURN jsonb_build_object(
        'email', target_email,
        'revoked_count', jsonb_array_length(revoked_programs),
        'skipped_count', jsonb_array_length(skipped_programs),
        'revoked_programs', revoked_programs,
        'skipped_programs', skipped_programs
    );
END;
$$;

DROP FUNCTION IF EXISTS public.list_program_access(text);
CREATE OR REPLACE FUNCTION public.list_program_access(p_program text)
RETURNS TABLE (
    email text,
    user_id uuid,
    program text,
    role text,
    status text,
    granted_at timestamptz,
    applied_at timestamptz,
    expires_at timestamptz
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
        CASE
            WHEN g.expires_at IS NOT NULL AND g.expires_at <= now() THEN 'expired'
            ELSE 'active'
        END::text AS status,
        coalesce(g.created_at, up.created_at) AS granted_at,
        g.applied_at,
        g.expires_at
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
        CASE
            WHEN g.expires_at IS NOT NULL AND g.expires_at <= now() THEN 'expired'
            ELSE 'pending'
        END::text AS status,
        g.created_at AS granted_at,
        NULL::timestamptz AS applied_at,
        g.expires_at
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

DROP FUNCTION IF EXISTS public.get_user_program_access(text);
CREATE OR REPLACE FUNCTION public.get_user_program_access(p_email text)
RETURNS TABLE (
    email text,
    user_id uuid,
    program text,
    role text,
    status text,
    granted_at timestamptz,
    applied_at timestamptz,
    expires_at timestamptz
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
        CASE
            WHEN g.expires_at IS NOT NULL AND g.expires_at <= now() THEN 'expired'
            ELSE 'active'
        END::text AS status,
        coalesce(g.created_at, up.created_at) AS granted_at,
        g.applied_at,
        g.expires_at
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
        CASE
            WHEN g.expires_at IS NOT NULL AND g.expires_at <= now() THEN 'expired'
            ELSE 'pending'
        END::text AS status,
        g.created_at AS granted_at,
        NULL::timestamptz AS applied_at,
        g.expires_at
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

DROP FUNCTION IF EXISTS public.list_manageable_program_access();
CREATE OR REPLACE FUNCTION public.list_manageable_program_access()
RETURNS TABLE (
    email text,
    user_id uuid,
    program text,
    role text,
    status text,
    granted_at timestamptz,
    applied_at timestamptz,
    expires_at timestamptz
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    PERFORM public.require_program_access_manager();

    RETURN QUERY
    WITH manageable_programs AS (
        SELECT p.id
        FROM public.programs p
        WHERE public.can_manage_program(p.id)
    ),
    active_access AS (
        SELECT
            lower(u.email)::text AS email,
            up.user_id,
            up.program,
            up.role,
            CASE
                WHEN g.expires_at IS NOT NULL AND g.expires_at <= now() THEN 'expired'
                ELSE 'active'
            END::text AS status,
            coalesce(g.created_at, up.created_at) AS granted_at,
            g.applied_at,
            g.expires_at
        FROM public.user_programs up
        JOIN manageable_programs mp ON mp.id = up.program
        JOIN auth.users u ON u.id = up.user_id
        LEFT JOIN public.program_access_grants g
          ON g.email = lower(u.email)
         AND g.program = up.program
    ),
    pending_access AS (
        SELECT
            g.email,
            NULL::uuid AS user_id,
            g.program,
            g.role,
            CASE
                WHEN g.expires_at IS NOT NULL AND g.expires_at <= now() THEN 'expired'
                ELSE 'pending'
            END::text AS status,
            g.created_at AS granted_at,
            NULL::timestamptz AS applied_at,
            g.expires_at
        FROM public.program_access_grants g
        JOIN manageable_programs mp ON mp.id = g.program
        LEFT JOIN auth.users u ON lower(u.email) = g.email
        LEFT JOIN public.user_programs up
          ON up.user_id = u.id
         AND up.program = g.program
        WHERE u.id IS NULL
    )
    SELECT *
    FROM active_access
    UNION ALL
    SELECT *
    FROM pending_access
    ORDER BY program, status, email;
END;
$$;

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
          AND (expires_at IS NULL OR expires_at > now())
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
            jsonb_build_object(
                'source', 'auth.users trigger',
                'expires_at', grant_row.expires_at
            )
        );
    END LOOP;

    RETURN NEW;
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
    JOIN auth.users u ON u.id = up.user_id
    LEFT JOIN public.program_access_grants g
      ON g.email = lower(u.email)
     AND g.program = up.program
    WHERE up.user_id = (claims ->> 'sub')::uuid
      AND (g.expires_at IS NULL OR g.expires_at > now());

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

REVOKE ALL ON FUNCTION public.grant_program_access(text, text, text, timestamptz) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.revoke_user_program_access(text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.list_program_access(text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_user_program_access(text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.list_manageable_program_access() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.grant_program_access(text, text, text, timestamptz) TO authenticated;
GRANT EXECUTE ON FUNCTION public.revoke_user_program_access(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.list_program_access(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_user_program_access(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.list_manageable_program_access() TO authenticated;
GRANT EXECUTE ON FUNCTION public.custom_access_token_hook(jsonb) TO supabase_auth_admin;
GRANT SELECT ON TABLE public.program_access_grants TO supabase_auth_admin;

UPDATE public.schema_version
SET version = GREATEST(version, 8),
    updated_at = now()
WHERE singleton = TRUE;
