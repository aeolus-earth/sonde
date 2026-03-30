-- Repair: re-create search_experiments RPC.
-- Migration 20260329000018 is marked as applied but the function is missing
-- from the database (likely a partial failure during initial migration).

CREATE OR REPLACE FUNCTION search_experiments(
    search_query text DEFAULT NULL,
    filter_program text DEFAULT NULL,
    filter_status text DEFAULT NULL,
    filter_tags text[] DEFAULT NULL,
    result_limit integer DEFAULT 50,
    result_offset integer DEFAULT 0
)
RETURNS SETOF experiments
LANGUAGE sql
STABLE
SECURITY INVOKER
AS $$
    SELECT e.*
    FROM experiments e
    WHERE
        (search_query IS NULL OR to_tsvector('english',
            coalesce(e.content, '') || ' ' ||
            coalesce(e.hypothesis, '') || ' ' ||
            coalesce(e.finding, ''))
            @@ plainto_tsquery('english', search_query))
        AND (filter_program IS NULL OR e.program = filter_program)
        AND (filter_status IS NULL OR e.status = filter_status)
        AND (filter_tags IS NULL OR e.tags @> filter_tags)
    ORDER BY
        CASE WHEN search_query IS NOT NULL THEN
            ts_rank(to_tsvector('english',
                coalesce(e.content, '') || ' ' ||
                coalesce(e.hypothesis, '') || ' ' ||
                coalesce(e.finding, '')),
                plainto_tsquery('english', search_query))
        ELSE 0 END DESC,
        e.created_at DESC
    LIMIT result_limit
    OFFSET result_offset;
$$;

GRANT EXECUTE ON FUNCTION search_experiments TO authenticated;
NOTIFY pgrst, 'reload schema';
