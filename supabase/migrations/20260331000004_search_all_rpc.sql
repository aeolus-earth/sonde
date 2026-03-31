-- Unified cross-entity search RPC.
-- Searches experiments, findings, directions, questions, and artifacts
-- in one call. Returns a ranked, unified result set.

-- FTS index for directions (missing until now)
CREATE INDEX IF NOT EXISTS idx_directions_fts
    ON directions USING GIN (
        to_tsvector('english', coalesce(title, '') || ' ' || coalesce(question, ''))
    );

-- Result type
DO $$ BEGIN
    CREATE TYPE search_result AS (
        id text,
        record_type text,
        title text,
        subtitle text,
        program text,
        parent_id text,
        rank real,
        created_at timestamptz
    );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Search function
CREATE OR REPLACE FUNCTION search_all(
    query text,
    filter_program text DEFAULT NULL,
    max_results integer DEFAULT 30
)
RETURNS SETOF search_result
LANGUAGE sql
STABLE
SECURITY INVOKER
AS $$
    WITH ranked AS (
        -- Experiments: full-text search on content + hypothesis + finding
        SELECT
            e.id,
            'experiment'::text AS record_type,
            coalesce(
                left(e.hypothesis, 120),
                left(e.content, 120),
                e.id
            ) AS title,
            left(e.finding, 200) AS subtitle,
            e.program,
            NULL::text AS parent_id,
            ts_rank(
                to_tsvector('english',
                    coalesce(e.content, '') || ' ' ||
                    coalesce(e.hypothesis, '') || ' ' ||
                    coalesce(e.finding, '')),
                plainto_tsquery('english', query)
            ) AS rank,
            e.created_at
        FROM experiments e
        WHERE
            to_tsvector('english',
                coalesce(e.content, '') || ' ' ||
                coalesce(e.hypothesis, '') || ' ' ||
                coalesce(e.finding, ''))
            @@ plainto_tsquery('english', query)
            AND (filter_program IS NULL OR e.program = filter_program)

        UNION ALL

        -- Findings: full-text search on topic + finding
        SELECT
            f.id,
            'finding'::text,
            f.topic,
            left(f.finding, 200),
            f.program,
            NULL::text,
            ts_rank(
                to_tsvector('english', f.topic || ' ' || f.finding),
                plainto_tsquery('english', query)
            ),
            f.created_at
        FROM findings f
        WHERE
            to_tsvector('english', f.topic || ' ' || f.finding)
            @@ plainto_tsquery('english', query)
            AND (filter_program IS NULL OR f.program = filter_program)

        UNION ALL

        -- Directions: full-text search on title + question
        SELECT
            d.id,
            'direction'::text,
            d.title,
            left(d.question, 200),
            d.program,
            NULL::text,
            ts_rank(
                to_tsvector('english',
                    coalesce(d.title, '') || ' ' || coalesce(d.question, '')),
                plainto_tsquery('english', query)
            ),
            d.created_at
        FROM directions d
        WHERE
            to_tsvector('english',
                coalesce(d.title, '') || ' ' || coalesce(d.question, ''))
            @@ plainto_tsquery('english', query)
            AND (filter_program IS NULL OR d.program = filter_program)

        UNION ALL

        -- Questions: full-text search on question + context
        SELECT
            q.id,
            'question'::text,
            left(q.question, 120),
            left(q.context, 200),
            q.program,
            NULL::text,
            ts_rank(
                to_tsvector('english',
                    q.question || ' ' || coalesce(q.context, '')),
                plainto_tsquery('english', query)
            ),
            q.created_at
        FROM questions q
        WHERE
            to_tsvector('english',
                q.question || ' ' || coalesce(q.context, ''))
            @@ plainto_tsquery('english', query)
            AND (filter_program IS NULL OR q.program = filter_program)

        UNION ALL

        -- Artifacts: ILIKE match on filename (not FTS — filenames are short)
        SELECT
            a.id,
            'artifact'::text,
            a.filename,
            a.type || ' · ' || coalesce(a.description, a.mime_type, ''),
            coalesce(
                (SELECT e.program FROM experiments e WHERE e.id = a.experiment_id),
                (SELECT f.program FROM findings f WHERE f.id = a.finding_id),
                (SELECT d.program FROM directions d WHERE d.id = a.direction_id)
            ),
            coalesce(a.experiment_id, a.finding_id, a.direction_id),
            0.5,  -- fixed rank for filename matches
            a.created_at
        FROM artifacts a
        WHERE
            a.filename ILIKE '%' || query || '%'
            AND (filter_program IS NULL OR EXISTS (
                SELECT 1 FROM experiments e
                WHERE e.id = a.experiment_id AND e.program = filter_program
            ) OR EXISTS (
                SELECT 1 FROM findings f
                WHERE f.id = a.finding_id AND f.program = filter_program
            ) OR EXISTS (
                SELECT 1 FROM directions d
                WHERE d.id = a.direction_id AND d.program = filter_program
            ))
    )
    SELECT * FROM ranked
    ORDER BY rank DESC, created_at DESC
    LIMIT max_results;
$$;

GRANT EXECUTE ON FUNCTION search_all TO authenticated;
NOTIFY pgrst, 'reload schema';
