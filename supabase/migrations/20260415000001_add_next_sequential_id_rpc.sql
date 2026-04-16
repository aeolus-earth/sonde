-- Single source of truth for sequential ID allocation.
--
-- The CLI's previous behavior was to SELECT every id LIKE 'PREFIX-%' and take
-- max() client-side. PostgREST silently caps SELECT responses at 1000 rows, so
-- once any prefix table crossed that threshold the client computed a stale max
-- and inserts collided on the PK. Already tripping on artifacts (>1000 rows);
-- experiments and findings are next at current growth.
--
-- This RPC returns max(numeric_suffix) + 1 in O(1), bypassing the row cap.
-- SECURITY DEFINER so the function sees the global max regardless of RLS:
-- ID allocation is a system-level operation, and an RLS-filtered max would
-- still produce collisions for any user who can't see the highest existing id.
-- The privacy implication (a caller can probe row counts via repeated calls)
-- is acceptable for our single-tenant team app.
--
-- The CLI's bundled fallback (paginated client-side scan) handles deploys
-- where this function isn't yet present, so the migration is not a hard
-- prerequisite for the CLI release that uses it.

CREATE OR REPLACE FUNCTION public.sonde_next_sequential_id(
    p_table text,
    p_prefix text
)
RETURNS bigint
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    next_num bigint;
BEGIN
    -- Defense-in-depth: format(%I, %L) below already quote the inputs, but
    -- reject anything that isn't a plausible Postgres identifier or our
    -- conventional uppercase prefix before we hand it to the SQL builder.
    IF p_table !~ '^[a-z_][a-z0-9_]*$' THEN
        RAISE EXCEPTION 'Invalid table name: %', p_table;
    END IF;
    IF p_prefix !~ '^[A-Z]+$' THEN
        RAISE EXCEPTION 'Invalid prefix: %', p_prefix;
    END IF;

    EXECUTE format(
        'SELECT coalesce(max((substring(id from %L))::bigint), 0) + 1
           FROM %I
          WHERE id LIKE %L',
        '\d+$',
        p_table,
        p_prefix || '-%'
    ) INTO next_num;

    RETURN next_num;
END;
$$;

COMMENT ON FUNCTION public.sonde_next_sequential_id(text, text) IS
    'Returns max numeric suffix + 1 for rows in p_table with id LIKE p_prefix-%. SECURITY DEFINER so RLS does not hide rows during ID allocation.';

GRANT EXECUTE ON FUNCTION public.sonde_next_sequential_id(text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.sonde_next_sequential_id(text, text) TO service_role;
-- Intentionally NOT granted to anon: ID allocation is for authenticated users only.
