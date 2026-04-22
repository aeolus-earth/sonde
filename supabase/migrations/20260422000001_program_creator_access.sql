-- Program creator allowlist.
-- Sonde admins can manage the allowlist; allowlisted creators can create new programs.

CREATE TABLE IF NOT EXISTS public.program_creator_grants (
    email text PRIMARY KEY,
    granted_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
    granted_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_program_creator_grants_granted_at
    ON public.program_creator_grants (granted_at DESC);

ALTER TABLE public.program_creator_grants ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "program_creator_grants_select_admin" ON public.program_creator_grants;
CREATE POLICY "program_creator_grants_select_admin" ON public.program_creator_grants
    FOR SELECT TO authenticated
    USING (public.is_sonde_admin());

DROP POLICY IF EXISTS "program_creator_grants_insert_admin" ON public.program_creator_grants;
CREATE POLICY "program_creator_grants_insert_admin" ON public.program_creator_grants
    FOR INSERT TO authenticated
    WITH CHECK (public.is_sonde_admin());

DROP POLICY IF EXISTS "program_creator_grants_update_admin" ON public.program_creator_grants;
CREATE POLICY "program_creator_grants_update_admin" ON public.program_creator_grants
    FOR UPDATE TO authenticated
    USING (public.is_sonde_admin())
    WITH CHECK (public.is_sonde_admin());

DROP POLICY IF EXISTS "program_creator_grants_delete_admin" ON public.program_creator_grants;
CREATE POLICY "program_creator_grants_delete_admin" ON public.program_creator_grants
    FOR DELETE TO authenticated
    USING (public.is_sonde_admin());

CREATE TABLE IF NOT EXISTS public.program_creator_events (
    id bigserial PRIMARY KEY,
    action text NOT NULL CHECK (action IN ('grant', 'revoke')),
    actor_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
    actor_email text,
    target_email text NOT NULL,
    details jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_program_creator_events_created_at
    ON public.program_creator_events (created_at DESC);

CREATE INDEX IF NOT EXISTS idx_program_creator_events_target_email
    ON public.program_creator_events (target_email, created_at DESC);

ALTER TABLE public.program_creator_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "program_creator_events_select_admin" ON public.program_creator_events;
CREATE POLICY "program_creator_events_select_admin" ON public.program_creator_events
    FOR SELECT TO authenticated
    USING (public.is_sonde_admin());

CREATE OR REPLACE FUNCTION public.require_program_creator_manager()
RETURNS void
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    IF NOT public.is_sonde_admin() THEN
        RAISE EXCEPTION 'Only Sonde admins can manage program creators'
            USING ERRCODE = '42501';
    END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.can_create_program()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT public.is_sonde_admin()
        OR EXISTS (
            SELECT 1
            FROM public.program_creator_grants g
            WHERE g.email = lower(coalesce(auth.jwt() ->> 'email', ''))
        );
$$;

CREATE OR REPLACE FUNCTION public.require_program_creator()
RETURNS void
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    IF NOT public.can_create_program() THEN
        RAISE EXCEPTION 'Only program creators and Sonde admins can create programs'
            USING ERRCODE = '42501';
    END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.list_program_creators()
RETURNS TABLE (
    email text,
    granted_by_email text,
    granted_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    PERFORM public.require_program_creator_manager();

    RETURN QUERY
    SELECT
        g.email,
        lower(u.email)::text AS granted_by_email,
        g.granted_at
    FROM public.program_creator_grants g
    LEFT JOIN auth.users u ON u.id = g.granted_by
    ORDER BY g.granted_at DESC, g.email;
END;
$$;

CREATE OR REPLACE FUNCTION public.grant_program_creator(p_email text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    target_email text := public.normalize_program_access_email(p_email);
    actor_email text := auth.jwt() ->> 'email';
    grant_time timestamptz := now();
BEGIN
    PERFORM public.require_program_creator_manager();

    INSERT INTO public.program_creator_grants (
        email,
        granted_by,
        granted_at,
        updated_at
    )
    VALUES (
        target_email,
        auth.uid(),
        grant_time,
        grant_time
    )
    ON CONFLICT (email) DO UPDATE
    SET granted_by = EXCLUDED.granted_by,
        granted_at = EXCLUDED.granted_at,
        updated_at = EXCLUDED.updated_at;

    INSERT INTO public.program_creator_events (
        action,
        actor_user_id,
        actor_email,
        target_email,
        details
    )
    VALUES (
        'grant',
        auth.uid(),
        actor_email,
        target_email,
        jsonb_build_object('granted_by', actor_email)
    );

    RETURN jsonb_build_object(
        'email', target_email,
        'granted_by_email', actor_email,
        'granted_at', grant_time
    );
END;
$$;

CREATE OR REPLACE FUNCTION public.revoke_program_creator(p_email text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    target_email text := public.normalize_program_access_email(p_email);
    actor_email text := auth.jwt() ->> 'email';
    deleted_rows integer := 0;
BEGIN
    PERFORM public.require_program_creator_manager();

    DELETE FROM public.program_creator_grants
    WHERE email = target_email;
    GET DIAGNOSTICS deleted_rows = ROW_COUNT;

    IF deleted_rows > 0 THEN
        INSERT INTO public.program_creator_events (
            action,
            actor_user_id,
            actor_email,
            target_email,
            details
        )
        VALUES (
            'revoke',
            auth.uid(),
            actor_email,
            target_email,
            jsonb_build_object('revoked', true)
        );
    END IF;

    RETURN jsonb_build_object(
        'email', target_email,
        'revoked', deleted_rows > 0
    );
END;
$$;

-- Program creation now requires creator access or Sonde admin privileges.
CREATE OR REPLACE FUNCTION public.create_program(
    program_id TEXT,
    program_name TEXT,
    program_description TEXT DEFAULT NULL
)
RETURNS programs
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    caller_id UUID := auth.uid();
    result programs;
BEGIN
    PERFORM public.require_program_creator();

    INSERT INTO programs (id, name, description)
    VALUES (program_id, program_name, program_description)
    RETURNING * INTO result;

    -- Auto-grant admin role to creator
    INSERT INTO user_programs (user_id, program, role)
    VALUES (caller_id, program_id, 'admin');

    RETURN result;
END;
$$;

REVOKE ALL ON FUNCTION public.require_program_creator_manager() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.can_create_program() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.require_program_creator() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.list_program_creators() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.grant_program_creator(text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.revoke_program_creator(text) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.list_program_creators() TO authenticated;
GRANT EXECUTE ON FUNCTION public.grant_program_creator(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.revoke_program_creator(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_program(TEXT, TEXT, TEXT) TO authenticated;

NOTIFY pgrst, 'reload schema';
