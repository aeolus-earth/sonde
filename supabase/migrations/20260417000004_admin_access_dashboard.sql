-- Admin access dashboard helpers. These RPCs expose only the programs and
-- access rows the caller can manage, so the UI can remain a thin operator
-- console over the existing Postgres-enforced RBAC model.

CREATE OR REPLACE FUNCTION public.require_program_access_manager()
RETURNS void
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    IF NOT public.is_sonde_admin()
       AND coalesce(array_length(public.admin_programs(), 1), 0) = 0 THEN
        RAISE EXCEPTION 'Program admin access required'
            USING ERRCODE = '42501';
    END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.list_manageable_programs()
RETURNS TABLE (
    id text,
    name text,
    description text,
    created_at timestamptz
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    PERFORM public.require_program_access_manager();

    RETURN QUERY
    SELECT p.id, p.name, p.description, p.created_at
    FROM public.programs p
    WHERE public.can_manage_program(p.id)
    ORDER BY p.name, p.id;
END;
$$;

CREATE OR REPLACE FUNCTION public.list_manageable_program_access()
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
            'active'::text AS status,
            coalesce(g.created_at, up.created_at) AS granted_at,
            g.applied_at
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
            'pending'::text AS status,
            g.created_at AS granted_at,
            NULL::timestamptz AS applied_at
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

REVOKE ALL ON FUNCTION public.require_program_access_manager() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.list_manageable_programs() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.list_manageable_program_access() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_manageable_programs() TO authenticated;
GRANT EXECUTE ON FUNCTION public.list_manageable_program_access() TO authenticated;

UPDATE public.schema_version
SET version = GREATEST(version, 7),
    updated_at = now()
WHERE singleton = TRUE;
