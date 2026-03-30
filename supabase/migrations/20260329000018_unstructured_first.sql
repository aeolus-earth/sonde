-- Unstructured-first: unified FTS index and search RPC.
--
-- Experiments are markdown documents. Search should cover the full content
-- body plus legacy hypothesis/finding fields for old records.

-- Drop the separate FTS indexes
DROP INDEX IF EXISTS idx_experiments_fts;
DROP INDEX IF EXISTS idx_experiments_content_fts;

-- Unified FTS index covering content + legacy fields
CREATE INDEX idx_experiments_fts_unified ON experiments USING GIN (
    to_tsvector('english',
        coalesce(content, '') || ' ' ||
        coalesce(hypothesis, '') || ' ' ||
        coalesce(finding, ''))
);

-- Search RPC: full-text search with structured filters, ranked results.
-- Uses SECURITY INVOKER so existing RLS policies apply automatically.
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

-- Ensure PostgREST discovers the new function immediately
NOTIFY pgrst, 'reload schema';
