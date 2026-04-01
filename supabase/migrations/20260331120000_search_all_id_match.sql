-- search_all: match record IDs (ILIKE + digit substring) in addition to FTS, so queries like
-- EXP-0156, 0156, 156 find experiments across programs when filter_program is null.

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
        -- Experiments (FTS + id / digit match)
        SELECT
            e.id,
            'experiment'::text AS record_type,
            coalesce(left(e.hypothesis, 120), left(e.content, 120), e.id) AS title,
            left(e.finding, 200) AS subtitle,
            e.program,
            NULL::text AS parent_id,
            GREATEST(
                CASE
                    WHEN to_tsvector('english',
                            coalesce(e.content, '') || ' ' || coalesce(e.hypothesis, '') || ' ' || coalesce(e.finding, ''))
                        @@ plainto_tsquery('english', query)
                    THEN ts_rank(
                        to_tsvector('english',
                            coalesce(e.content, '') || ' ' || coalesce(e.hypothesis, '') || ' ' || coalesce(e.finding, '')),
                        plainto_tsquery('english', query))
                    ELSE 0::real
                END,
                CASE WHEN e.id ILIKE '%' || query || '%' THEN 0.9::real ELSE 0::real END,
                CASE
                    WHEN length(regexp_replace(query, '\D', '', 'g')) >= 2
                        AND regexp_replace(e.id, '\D', '', 'g')
                            LIKE '%' || regexp_replace(query, '\D', '', 'g') || '%'
                    THEN 0.88::real
                    ELSE 0::real
                END
            ) AS rank,
            e.created_at
        FROM experiments e
        WHERE (filter_program IS NULL OR e.program = filter_program)
          AND (
              to_tsvector('english',
                  coalesce(e.content, '') || ' ' || coalesce(e.hypothesis, '') || ' ' || coalesce(e.finding, ''))
              @@ plainto_tsquery('english', query)
              OR e.id ILIKE '%' || query || '%'
              OR (
                  length(regexp_replace(query, '\D', '', 'g')) >= 2
                  AND regexp_replace(e.id, '\D', '', 'g')
                      LIKE '%' || regexp_replace(query, '\D', '', 'g') || '%'
              )
          )

        UNION ALL

        -- Findings (FTS + id / digit match)
        SELECT
            f.id,
            'finding'::text,
            f.topic,
            left(f.finding, 200),
            f.program,
            NULL::text,
            GREATEST(
                CASE
                    WHEN to_tsvector('english', f.topic || ' ' || f.finding) @@ plainto_tsquery('english', query)
                    THEN ts_rank(
                        to_tsvector('english', f.topic || ' ' || f.finding),
                        plainto_tsquery('english', query))
                    ELSE 0::real
                END,
                CASE WHEN f.id ILIKE '%' || query || '%' THEN 0.9::real ELSE 0::real END,
                CASE
                    WHEN length(regexp_replace(query, '\D', '', 'g')) >= 2
                        AND regexp_replace(f.id, '\D', '', 'g')
                            LIKE '%' || regexp_replace(query, '\D', '', 'g') || '%'
                    THEN 0.88::real
                    ELSE 0::real
                END
            ),
            f.created_at
        FROM findings f
        WHERE (filter_program IS NULL OR f.program = filter_program)
          AND (
              to_tsvector('english', f.topic || ' ' || f.finding) @@ plainto_tsquery('english', query)
              OR f.id ILIKE '%' || query || '%'
              OR (
                  length(regexp_replace(query, '\D', '', 'g')) >= 2
                  AND regexp_replace(f.id, '\D', '', 'g')
                      LIKE '%' || regexp_replace(query, '\D', '', 'g') || '%'
              )
          )

        UNION ALL

        -- Directions (FTS + id / digit match)
        SELECT
            d.id,
            'direction'::text,
            d.title,
            left(d.question, 200),
            d.program,
            d.project_id,
            GREATEST(
                CASE
                    WHEN to_tsvector('english',
                            coalesce(d.title, '') || ' ' || coalesce(d.question, ''))
                        @@ plainto_tsquery('english', query)
                    THEN ts_rank(
                        to_tsvector('english',
                            coalesce(d.title, '') || ' ' || coalesce(d.question, '')),
                        plainto_tsquery('english', query))
                    ELSE 0::real
                END,
                CASE WHEN d.id ILIKE '%' || query || '%' THEN 0.9::real ELSE 0::real END,
                CASE
                    WHEN length(regexp_replace(query, '\D', '', 'g')) >= 2
                        AND regexp_replace(d.id, '\D', '', 'g')
                            LIKE '%' || regexp_replace(query, '\D', '', 'g') || '%'
                    THEN 0.88::real
                    ELSE 0::real
                END
            ),
            d.created_at
        FROM directions d
        WHERE (filter_program IS NULL OR d.program = filter_program)
          AND (
              to_tsvector('english',
                  coalesce(d.title, '') || ' ' || coalesce(d.question, ''))
              @@ plainto_tsquery('english', query)
              OR d.id ILIKE '%' || query || '%'
              OR (
                  length(regexp_replace(query, '\D', '', 'g')) >= 2
                  AND regexp_replace(d.id, '\D', '', 'g')
                      LIKE '%' || regexp_replace(query, '\D', '', 'g') || '%'
              )
          )

        UNION ALL

        -- Questions (FTS + id / digit match)
        SELECT
            q.id,
            'question'::text,
            left(q.question, 120),
            left(q.context, 200),
            q.program,
            NULL::text,
            GREATEST(
                CASE
                    WHEN to_tsvector('english', q.question || ' ' || coalesce(q.context, ''))
                        @@ plainto_tsquery('english', query)
                    THEN ts_rank(
                        to_tsvector('english', q.question || ' ' || coalesce(q.context, '')),
                        plainto_tsquery('english', query))
                    ELSE 0::real
                END,
                CASE WHEN q.id ILIKE '%' || query || '%' THEN 0.9::real ELSE 0::real END,
                CASE
                    WHEN length(regexp_replace(query, '\D', '', 'g')) >= 2
                        AND regexp_replace(q.id, '\D', '', 'g')
                            LIKE '%' || regexp_replace(query, '\D', '', 'g') || '%'
                    THEN 0.88::real
                    ELSE 0::real
                END
            ),
            q.created_at
        FROM questions q
        WHERE (filter_program IS NULL OR q.program = filter_program)
          AND (
              to_tsvector('english', q.question || ' ' || coalesce(q.context, ''))
              @@ plainto_tsquery('english', query)
              OR q.id ILIKE '%' || query || '%'
              OR (
                  length(regexp_replace(query, '\D', '', 'g')) >= 2
                  AND regexp_replace(q.id, '\D', '', 'g')
                      LIKE '%' || regexp_replace(query, '\D', '', 'g') || '%'
              )
          )

        UNION ALL

        -- Projects (FTS + id / digit match)
        SELECT
            p.id,
            'project'::text,
            p.name,
            left(p.objective, 200),
            p.program,
            NULL::text,
            GREATEST(
                CASE
                    WHEN to_tsvector('english',
                            coalesce(p.name, '') || ' ' || coalesce(p.objective, ''))
                        @@ plainto_tsquery('english', query)
                    THEN ts_rank(
                        to_tsvector('english',
                            coalesce(p.name, '') || ' ' || coalesce(p.objective, '')),
                        plainto_tsquery('english', query))
                    ELSE 0::real
                END,
                CASE WHEN p.id ILIKE '%' || query || '%' THEN 0.9::real ELSE 0::real END,
                CASE
                    WHEN length(regexp_replace(query, '\D', '', 'g')) >= 2
                        AND regexp_replace(p.id, '\D', '', 'g')
                            LIKE '%' || regexp_replace(query, '\D', '', 'g') || '%'
                    THEN 0.88::real
                    ELSE 0::real
                END
            ),
            p.created_at
        FROM projects p
        WHERE (filter_program IS NULL OR p.program = filter_program)
          AND (
              to_tsvector('english',
                  coalesce(p.name, '') || ' ' || coalesce(p.objective, ''))
              @@ plainto_tsquery('english', query)
              OR p.id ILIKE '%' || query || '%'
              OR (
                  length(regexp_replace(query, '\D', '', 'g')) >= 2
                  AND regexp_replace(p.id, '\D', '', 'g')
                      LIKE '%' || regexp_replace(query, '\D', '', 'g') || '%'
              )
          )

        UNION ALL

        -- Artifacts (filename + id match)
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
            GREATEST(
                CASE WHEN a.filename ILIKE '%' || query || '%' THEN 0.5::real ELSE 0::real END,
                CASE WHEN a.id ILIKE '%' || query || '%' THEN 0.9::real ELSE 0::real END,
                CASE
                    WHEN length(regexp_replace(query, '\D', '', 'g')) >= 2
                        AND regexp_replace(a.id, '\D', '', 'g')
                            LIKE '%' || regexp_replace(query, '\D', '', 'g') || '%'
                    THEN 0.88::real
                    ELSE 0::real
                END
            ),
            a.created_at
        FROM artifacts a
        WHERE (
              filter_program IS NULL
              OR EXISTS (
                  SELECT 1 FROM experiments e WHERE e.id = a.experiment_id AND e.program = filter_program
              )
              OR EXISTS (
                  SELECT 1 FROM findings f WHERE f.id = a.finding_id AND f.program = filter_program
              )
              OR EXISTS (
                  SELECT 1 FROM directions d WHERE d.id = a.direction_id AND d.program = filter_program
              )
          )
          AND (
              a.filename ILIKE '%' || query || '%'
              OR a.id ILIKE '%' || query || '%'
              OR (
                  length(regexp_replace(query, '\D', '', 'g')) >= 2
                  AND regexp_replace(a.id, '\D', '', 'g')
                      LIKE '%' || regexp_replace(query, '\D', '', 'g') || '%'
              )
          )
    )
    SELECT * FROM ranked
    ORDER BY rank DESC, created_at DESC
    LIMIT max_results;
$$;

GRANT EXECUTE ON FUNCTION search_all TO authenticated;
NOTIFY pgrst, 'reload schema';
