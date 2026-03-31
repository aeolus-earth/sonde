-- Projects: coherent bodies of work grouping directions and experiments.
-- Hierarchy: Program → Project → Direction → Experiment
-- All FKs to project are nullable — the layer is opt-in.

-- ── 1. Create projects table ────────────────────────────────────

CREATE TABLE projects (
    id TEXT PRIMARY KEY,  -- PROJ-001 format
    program TEXT NOT NULL REFERENCES programs(id),
    name TEXT NOT NULL,
    objective TEXT,
    status TEXT NOT NULL DEFAULT 'proposed'
        CHECK (status IN ('proposed', 'active', 'paused', 'completed', 'archived')),
    source TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_projects_program ON projects (program);
CREATE INDEX idx_projects_status ON projects (status);

CREATE TRIGGER projects_updated_at
    BEFORE UPDATE ON projects
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE SEQUENCE project_id_seq START 1;

-- FTS index for search_all
CREATE INDEX idx_projects_fts ON projects USING GIN (
    to_tsvector('english', coalesce(name, '') || ' ' || coalesce(objective, ''))
);


-- ── 2. Add project_id FK to directions and experiments ──────────

ALTER TABLE directions ADD COLUMN IF NOT EXISTS project_id TEXT REFERENCES projects(id);
CREATE INDEX IF NOT EXISTS idx_directions_project ON directions (project_id);

ALTER TABLE experiments ADD COLUMN IF NOT EXISTS project_id TEXT REFERENCES projects(id);
CREATE INDEX IF NOT EXISTS idx_experiments_project ON experiments (project_id);


-- ── 3. RLS ──────────────────────────────────────────────────────

ALTER TABLE projects ENABLE ROW LEVEL SECURITY;

CREATE POLICY "projects_select" ON projects FOR SELECT USING (true);
CREATE POLICY "projects_insert" ON projects FOR INSERT WITH CHECK (true);
CREATE POLICY "projects_update" ON projects FOR UPDATE USING (true);
CREATE POLICY "projects_delete" ON projects FOR DELETE USING (true);


-- ── 4. project_status view ──────────────────────────────────────

CREATE VIEW project_status AS
SELECT
    p.id,
    p.program,
    p.name,
    p.objective,
    p.status,
    p.source,
    (SELECT count(*) FROM directions d WHERE d.project_id = p.id) AS direction_count,
    (SELECT count(*) FROM experiments e WHERE e.project_id = p.id) AS experiment_count,
    (SELECT count(*) FROM experiments e WHERE e.project_id = p.id AND e.status = 'complete') AS complete_count,
    (SELECT count(*) FROM experiments e WHERE e.project_id = p.id AND e.status = 'open') AS open_count,
    (SELECT count(*) FROM experiments e WHERE e.project_id = p.id AND e.status = 'running') AS running_count,
    (SELECT count(*) FROM experiments e WHERE e.project_id = p.id AND e.status = 'failed') AS failed_count,
    p.created_at,
    p.updated_at
FROM projects p
ORDER BY p.updated_at DESC;


-- ── 5. Rebuild experiment_summary with project_id ───────────────

DROP VIEW IF EXISTS experiment_summary;

CREATE VIEW experiment_summary AS
SELECT
    e.id,
    e.program,
    e.status,
    e.source,
    e.hypothesis,
    e.parameters,
    e.results,
    e.finding,
    e.direction_id,
    e.project_id,
    e.tags,
    e.created_at,
    e.run_at,
    e.parent_id,
    e.branch_type,
    e.git_commit,
    e.git_repo,
    e.git_branch,
    e.git_close_commit,
    e.git_close_branch,
    e.git_dirty,
    (SELECT count(*)                   FROM artifacts a WHERE a.experiment_id = e.id) AS artifact_count,
    (SELECT array_agg(DISTINCT a.type) FROM artifacts a WHERE a.experiment_id = e.id) AS artifact_types,
    (SELECT array_agg(a.filename)      FROM artifacts a WHERE a.experiment_id = e.id) AS artifact_filenames
FROM experiments e
ORDER BY e.created_at DESC;


-- ── 6. Update search_all to include projects ────────────────────

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
        -- Experiments
        SELECT
            e.id, 'experiment'::text AS record_type,
            coalesce(left(e.hypothesis, 120), left(e.content, 120), e.id) AS title,
            left(e.finding, 200) AS subtitle,
            e.program, NULL::text AS parent_id,
            ts_rank(to_tsvector('english',
                coalesce(e.content, '') || ' ' || coalesce(e.hypothesis, '') || ' ' || coalesce(e.finding, '')),
                plainto_tsquery('english', query)) AS rank,
            e.created_at
        FROM experiments e
        WHERE to_tsvector('english',
                coalesce(e.content, '') || ' ' || coalesce(e.hypothesis, '') || ' ' || coalesce(e.finding, ''))
              @@ plainto_tsquery('english', query)
          AND (filter_program IS NULL OR e.program = filter_program)

        UNION ALL

        -- Findings
        SELECT
            f.id, 'finding'::text, f.topic, left(f.finding, 200),
            f.program, NULL::text,
            ts_rank(to_tsvector('english', f.topic || ' ' || f.finding),
                plainto_tsquery('english', query)),
            f.created_at
        FROM findings f
        WHERE to_tsvector('english', f.topic || ' ' || f.finding)
              @@ plainto_tsquery('english', query)
          AND (filter_program IS NULL OR f.program = filter_program)

        UNION ALL

        -- Directions
        SELECT
            d.id, 'direction'::text, d.title, left(d.question, 200),
            d.program, d.project_id,
            ts_rank(to_tsvector('english',
                coalesce(d.title, '') || ' ' || coalesce(d.question, '')),
                plainto_tsquery('english', query)),
            d.created_at
        FROM directions d
        WHERE to_tsvector('english',
                coalesce(d.title, '') || ' ' || coalesce(d.question, ''))
              @@ plainto_tsquery('english', query)
          AND (filter_program IS NULL OR d.program = filter_program)

        UNION ALL

        -- Questions
        SELECT
            q.id, 'question'::text, left(q.question, 120), left(q.context, 200),
            q.program, NULL::text,
            ts_rank(to_tsvector('english',
                q.question || ' ' || coalesce(q.context, '')),
                plainto_tsquery('english', query)),
            q.created_at
        FROM questions q
        WHERE to_tsvector('english',
                q.question || ' ' || coalesce(q.context, ''))
              @@ plainto_tsquery('english', query)
          AND (filter_program IS NULL OR q.program = filter_program)

        UNION ALL

        -- Projects (NEW)
        SELECT
            p.id, 'project'::text, p.name, left(p.objective, 200),
            p.program, NULL::text,
            ts_rank(to_tsvector('english',
                coalesce(p.name, '') || ' ' || coalesce(p.objective, '')),
                plainto_tsquery('english', query)),
            p.created_at
        FROM projects p
        WHERE to_tsvector('english',
                coalesce(p.name, '') || ' ' || coalesce(p.objective, ''))
              @@ plainto_tsquery('english', query)
          AND (filter_program IS NULL OR p.program = filter_program)

        UNION ALL

        -- Artifacts (filename match)
        SELECT
            a.id, 'artifact'::text, a.filename,
            a.type || ' · ' || coalesce(a.description, a.mime_type, ''),
            coalesce(
                (SELECT e.program FROM experiments e WHERE e.id = a.experiment_id),
                (SELECT f.program FROM findings f WHERE f.id = a.finding_id),
                (SELECT d.program FROM directions d WHERE d.id = a.direction_id)
            ),
            coalesce(a.experiment_id, a.finding_id, a.direction_id),
            0.5,
            a.created_at
        FROM artifacts a
        WHERE a.filename ILIKE '%' || query || '%'
          AND (filter_program IS NULL OR EXISTS (
              SELECT 1 FROM experiments e WHERE e.id = a.experiment_id AND e.program = filter_program
          ) OR EXISTS (
              SELECT 1 FROM findings f WHERE f.id = a.finding_id AND f.program = filter_program
          ) OR EXISTS (
              SELECT 1 FROM directions d WHERE d.id = a.direction_id AND d.program = filter_program
          ))
    )
    SELECT * FROM ranked
    ORDER BY rank DESC, created_at DESC
    LIMIT max_results;
$$;

GRANT EXECUTE ON FUNCTION search_all TO authenticated;
NOTIFY pgrst, 'reload schema';
