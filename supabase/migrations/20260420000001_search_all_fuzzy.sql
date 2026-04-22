-- search_all: smarter ranking for less-direct queries.
--
-- Changes vs. 20260331120000_search_all_id_match.sql:
--   1. parser: plainto_tsquery → websearch_to_tsquery (handles quoted phrases,
--      OR, -negation, and tolerates unknown tokens instead of failing the match)
--   2. weights: setweight() per field (A = title-like, B = summary, D = body),
--      scored with ts_rank_cd(…, 32) so rank stays in [0,1) regardless of body
--      length. Matches in hypothesis/topic/title/question/name rank above
--      matches buried in long bodies.
--   3. fuzzy fallback: pg_trgm similarity on the primary (A-weighted) field
--      so typos and partial terms ("hurric", "hurricne seedng") still surface
--      candidates. Capped at 0.4 so trigram never outranks a real FTS hit or
--      an ID exact match (0.9 / 0.88).
--
-- Rank invariants preserved from the id_match overlay:
--   - ID exact contains           → 0.90
--   - ID digit-substring (≥2)     → 0.88
--   - FTS ts_rank_cd (normalized) → [0, 1)
--   - Trigram similarity * 0.4    → [0, 0.4]
--   GREATEST() keeps the strongest signal per row.

CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- Trigram indexes on short, high-value fields. Skipped for long bodies
-- (content / finding / context / objective) — seq-scan fallback is fine at
-- current scale and the index size isn't worth it.
CREATE INDEX IF NOT EXISTS idx_experiments_hypothesis_trgm
    ON experiments USING GIN (hypothesis gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_findings_topic_trgm
    ON findings USING GIN (topic gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_directions_title_trgm
    ON directions USING GIN (title gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_questions_question_trgm
    ON questions USING GIN (question gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_projects_name_trgm
    ON projects USING GIN (name gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_artifacts_filename_trgm
    ON artifacts USING GIN (filename gin_trgm_ops);

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
    WITH
    q AS (SELECT websearch_to_tsquery('english', query) AS tsq),
    digits AS (SELECT regexp_replace(query, '\D', '', 'g') AS digits_only),
    ranked AS (
        -- Experiments ---------------------------------------------------
        SELECT
            e.id,
            'experiment'::text AS record_type,
            coalesce(left(e.hypothesis, 120), left(e.content, 120), e.id) AS title,
            left(e.finding, 200) AS subtitle,
            e.program,
            NULL::text AS parent_id,
            GREATEST(
                CASE
                    WHEN (
                        setweight(to_tsvector('english', coalesce(e.hypothesis, '')), 'A') ||
                        setweight(to_tsvector('english', coalesce(e.finding,    '')), 'B') ||
                        setweight(to_tsvector('english', coalesce(e.content,    '')), 'D')
                    ) @@ (SELECT tsq FROM q)
                    THEN ts_rank_cd(
                        setweight(to_tsvector('english', coalesce(e.hypothesis, '')), 'A') ||
                        setweight(to_tsvector('english', coalesce(e.finding,    '')), 'B') ||
                        setweight(to_tsvector('english', coalesce(e.content,    '')), 'D'),
                        (SELECT tsq FROM q),
                        32)
                    ELSE 0::real
                END,
                CASE WHEN e.id ILIKE '%' || query || '%' THEN 0.9::real ELSE 0::real END,
                CASE
                    WHEN length((SELECT digits_only FROM digits)) >= 2
                        AND regexp_replace(e.id, '\D', '', 'g')
                            LIKE '%' || (SELECT digits_only FROM digits) || '%'
                    THEN 0.88::real
                    ELSE 0::real
                END,
                CASE
                    WHEN similarity(coalesce(e.hypothesis, ''), query) > 0.2
                    THEN similarity(coalesce(e.hypothesis, ''), query) * 0.4::real
                    ELSE 0::real
                END
            ) AS rank,
            e.created_at
        FROM experiments e
        WHERE (filter_program IS NULL OR e.program = filter_program)
          AND (
              (setweight(to_tsvector('english', coalesce(e.hypothesis, '')), 'A') ||
               setweight(to_tsvector('english', coalesce(e.finding,    '')), 'B') ||
               setweight(to_tsvector('english', coalesce(e.content,    '')), 'D'))
                @@ (SELECT tsq FROM q)
              OR e.id ILIKE '%' || query || '%'
              OR (
                  length((SELECT digits_only FROM digits)) >= 2
                  AND regexp_replace(e.id, '\D', '', 'g')
                      LIKE '%' || (SELECT digits_only FROM digits) || '%'
              )
              OR similarity(coalesce(e.hypothesis, ''), query) > 0.2
          )

        UNION ALL

        -- Findings ------------------------------------------------------
        SELECT
            f.id,
            'finding'::text,
            f.topic,
            left(f.finding, 200),
            f.program,
            NULL::text,
            GREATEST(
                CASE
                    WHEN (
                        setweight(to_tsvector('english', coalesce(f.topic,   '')), 'A') ||
                        setweight(to_tsvector('english', coalesce(f.finding, '')), 'B')
                    ) @@ (SELECT tsq FROM q)
                    THEN ts_rank_cd(
                        setweight(to_tsvector('english', coalesce(f.topic,   '')), 'A') ||
                        setweight(to_tsvector('english', coalesce(f.finding, '')), 'B'),
                        (SELECT tsq FROM q),
                        32)
                    ELSE 0::real
                END,
                CASE WHEN f.id ILIKE '%' || query || '%' THEN 0.9::real ELSE 0::real END,
                CASE
                    WHEN length((SELECT digits_only FROM digits)) >= 2
                        AND regexp_replace(f.id, '\D', '', 'g')
                            LIKE '%' || (SELECT digits_only FROM digits) || '%'
                    THEN 0.88::real
                    ELSE 0::real
                END,
                CASE
                    WHEN similarity(coalesce(f.topic, ''), query) > 0.2
                    THEN similarity(coalesce(f.topic, ''), query) * 0.4::real
                    ELSE 0::real
                END
            ),
            f.created_at
        FROM findings f
        WHERE (filter_program IS NULL OR f.program = filter_program)
          AND (
              (setweight(to_tsvector('english', coalesce(f.topic,   '')), 'A') ||
               setweight(to_tsvector('english', coalesce(f.finding, '')), 'B'))
                @@ (SELECT tsq FROM q)
              OR f.id ILIKE '%' || query || '%'
              OR (
                  length((SELECT digits_only FROM digits)) >= 2
                  AND regexp_replace(f.id, '\D', '', 'g')
                      LIKE '%' || (SELECT digits_only FROM digits) || '%'
              )
              OR similarity(coalesce(f.topic, ''), query) > 0.2
          )

        UNION ALL

        -- Directions ----------------------------------------------------
        SELECT
            d.id,
            'direction'::text,
            d.title,
            left(d.question, 200),
            d.program,
            d.project_id,
            GREATEST(
                CASE
                    WHEN (
                        setweight(to_tsvector('english', coalesce(d.title,    '')), 'A') ||
                        setweight(to_tsvector('english', coalesce(d.question, '')), 'B')
                    ) @@ (SELECT tsq FROM q)
                    THEN ts_rank_cd(
                        setweight(to_tsvector('english', coalesce(d.title,    '')), 'A') ||
                        setweight(to_tsvector('english', coalesce(d.question, '')), 'B'),
                        (SELECT tsq FROM q),
                        32)
                    ELSE 0::real
                END,
                CASE WHEN d.id ILIKE '%' || query || '%' THEN 0.9::real ELSE 0::real END,
                CASE
                    WHEN length((SELECT digits_only FROM digits)) >= 2
                        AND regexp_replace(d.id, '\D', '', 'g')
                            LIKE '%' || (SELECT digits_only FROM digits) || '%'
                    THEN 0.88::real
                    ELSE 0::real
                END,
                CASE
                    WHEN similarity(coalesce(d.title, ''), query) > 0.2
                    THEN similarity(coalesce(d.title, ''), query) * 0.4::real
                    ELSE 0::real
                END
            ),
            d.created_at
        FROM directions d
        WHERE (filter_program IS NULL OR d.program = filter_program)
          AND (
              (setweight(to_tsvector('english', coalesce(d.title,    '')), 'A') ||
               setweight(to_tsvector('english', coalesce(d.question, '')), 'B'))
                @@ (SELECT tsq FROM q)
              OR d.id ILIKE '%' || query || '%'
              OR (
                  length((SELECT digits_only FROM digits)) >= 2
                  AND regexp_replace(d.id, '\D', '', 'g')
                      LIKE '%' || (SELECT digits_only FROM digits) || '%'
              )
              OR similarity(coalesce(d.title, ''), query) > 0.2
          )

        UNION ALL

        -- Questions -----------------------------------------------------
        SELECT
            qu.id,
            'question'::text,
            left(qu.question, 120),
            left(qu.context, 200),
            qu.program,
            NULL::text,
            GREATEST(
                CASE
                    WHEN (
                        setweight(to_tsvector('english', coalesce(qu.question, '')), 'A') ||
                        setweight(to_tsvector('english', coalesce(qu.context,  '')), 'B')
                    ) @@ (SELECT tsq FROM q)
                    THEN ts_rank_cd(
                        setweight(to_tsvector('english', coalesce(qu.question, '')), 'A') ||
                        setweight(to_tsvector('english', coalesce(qu.context,  '')), 'B'),
                        (SELECT tsq FROM q),
                        32)
                    ELSE 0::real
                END,
                CASE WHEN qu.id ILIKE '%' || query || '%' THEN 0.9::real ELSE 0::real END,
                CASE
                    WHEN length((SELECT digits_only FROM digits)) >= 2
                        AND regexp_replace(qu.id, '\D', '', 'g')
                            LIKE '%' || (SELECT digits_only FROM digits) || '%'
                    THEN 0.88::real
                    ELSE 0::real
                END,
                CASE
                    WHEN similarity(coalesce(qu.question, ''), query) > 0.2
                    THEN similarity(coalesce(qu.question, ''), query) * 0.4::real
                    ELSE 0::real
                END
            ),
            qu.created_at
        FROM questions qu
        WHERE (filter_program IS NULL OR qu.program = filter_program)
          AND (
              (setweight(to_tsvector('english', coalesce(qu.question, '')), 'A') ||
               setweight(to_tsvector('english', coalesce(qu.context,  '')), 'B'))
                @@ (SELECT tsq FROM q)
              OR qu.id ILIKE '%' || query || '%'
              OR (
                  length((SELECT digits_only FROM digits)) >= 2
                  AND regexp_replace(qu.id, '\D', '', 'g')
                      LIKE '%' || (SELECT digits_only FROM digits) || '%'
              )
              OR similarity(coalesce(qu.question, ''), query) > 0.2
          )

        UNION ALL

        -- Projects ------------------------------------------------------
        SELECT
            p.id,
            'project'::text,
            p.name,
            left(p.objective, 200),
            p.program,
            NULL::text,
            GREATEST(
                CASE
                    WHEN (
                        setweight(to_tsvector('english', coalesce(p.name,      '')), 'A') ||
                        setweight(to_tsvector('english', coalesce(p.objective, '')), 'B')
                    ) @@ (SELECT tsq FROM q)
                    THEN ts_rank_cd(
                        setweight(to_tsvector('english', coalesce(p.name,      '')), 'A') ||
                        setweight(to_tsvector('english', coalesce(p.objective, '')), 'B'),
                        (SELECT tsq FROM q),
                        32)
                    ELSE 0::real
                END,
                CASE WHEN p.id ILIKE '%' || query || '%' THEN 0.9::real ELSE 0::real END,
                CASE
                    WHEN length((SELECT digits_only FROM digits)) >= 2
                        AND regexp_replace(p.id, '\D', '', 'g')
                            LIKE '%' || (SELECT digits_only FROM digits) || '%'
                    THEN 0.88::real
                    ELSE 0::real
                END,
                CASE
                    WHEN similarity(coalesce(p.name, ''), query) > 0.2
                    THEN similarity(coalesce(p.name, ''), query) * 0.4::real
                    ELSE 0::real
                END
            ),
            p.created_at
        FROM projects p
        WHERE (filter_program IS NULL OR p.program = filter_program)
          AND (
              (setweight(to_tsvector('english', coalesce(p.name,      '')), 'A') ||
               setweight(to_tsvector('english', coalesce(p.objective, '')), 'B'))
                @@ (SELECT tsq FROM q)
              OR p.id ILIKE '%' || query || '%'
              OR (
                  length((SELECT digits_only FROM digits)) >= 2
                  AND regexp_replace(p.id, '\D', '', 'g')
                      LIKE '%' || (SELECT digits_only FROM digits) || '%'
              )
              OR similarity(coalesce(p.name, ''), query) > 0.2
          )

        UNION ALL

        -- Artifacts (filename ILIKE + id match + trigram fallback) ------
        SELECT
            a.id,
            'artifact'::text,
            a.filename,
            a.type || ' · ' || coalesce(a.description, a.mime_type, ''),
            coalesce(
                (SELECT e.program FROM experiments e WHERE e.id = a.experiment_id),
                (SELECT f.program FROM findings f WHERE f.id = a.finding_id),
                (SELECT dir.program FROM directions dir WHERE dir.id = a.direction_id)
            ),
            coalesce(a.experiment_id, a.finding_id, a.direction_id),
            GREATEST(
                CASE WHEN a.filename ILIKE '%' || query || '%' THEN 0.5::real ELSE 0::real END,
                CASE WHEN a.id ILIKE '%' || query || '%' THEN 0.9::real ELSE 0::real END,
                CASE
                    WHEN length((SELECT digits_only FROM digits)) >= 2
                        AND regexp_replace(a.id, '\D', '', 'g')
                            LIKE '%' || (SELECT digits_only FROM digits) || '%'
                    THEN 0.88::real
                    ELSE 0::real
                END,
                CASE
                    WHEN similarity(coalesce(a.filename, ''), query) > 0.2
                    THEN similarity(coalesce(a.filename, ''), query) * 0.4::real
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
                  SELECT 1 FROM directions dir WHERE dir.id = a.direction_id AND dir.program = filter_program
              )
          )
          AND (
              a.filename ILIKE '%' || query || '%'
              OR a.id ILIKE '%' || query || '%'
              OR (
                  length((SELECT digits_only FROM digits)) >= 2
                  AND regexp_replace(a.id, '\D', '', 'g')
                      LIKE '%' || (SELECT digits_only FROM digits) || '%'
              )
              OR similarity(coalesce(a.filename, ''), query) > 0.2
          )
    )
    SELECT * FROM ranked
    ORDER BY rank DESC, created_at DESC
    LIMIT max_results;
$$;

GRANT EXECUTE ON FUNCTION search_all TO authenticated;
NOTIFY pgrst, 'reload schema';
