-- Make questions first-class research objects tied to directions, experiments,
-- and findings.

ALTER TABLE questions
    ADD COLUMN IF NOT EXISTS direction_id TEXT REFERENCES directions(id) ON DELETE SET NULL;

ALTER TABLE directions
    ADD COLUMN IF NOT EXISTS primary_question_id TEXT REFERENCES questions(id) ON DELETE SET NULL;

ALTER TABLE questions
    DROP CONSTRAINT IF EXISTS questions_status_check;

UPDATE questions
SET status = 'investigating'
WHERE status = 'promoted';

ALTER TABLE questions
    ADD CONSTRAINT questions_status_check
    CHECK (status IN ('open', 'investigating', 'answered', 'dismissed'));

CREATE INDEX IF NOT EXISTS idx_questions_direction ON questions (direction_id);
CREATE INDEX IF NOT EXISTS idx_directions_primary_question ON directions (primary_question_id);

CREATE TABLE IF NOT EXISTS question_experiments (
    question_id TEXT NOT NULL REFERENCES questions(id) ON DELETE CASCADE,
    experiment_id TEXT NOT NULL REFERENCES experiments(id) ON DELETE CASCADE,
    is_primary BOOLEAN NOT NULL DEFAULT false,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (question_id, experiment_id)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_question_experiments_primary_experiment
    ON question_experiments (experiment_id)
    WHERE is_primary;

CREATE INDEX IF NOT EXISTS idx_question_experiments_question ON question_experiments (question_id);
CREATE INDEX IF NOT EXISTS idx_question_experiments_experiment ON question_experiments (experiment_id);

CREATE TABLE IF NOT EXISTS question_findings (
    question_id TEXT NOT NULL REFERENCES questions(id) ON DELETE CASCADE,
    finding_id TEXT NOT NULL REFERENCES findings(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (question_id, finding_id)
);

CREATE INDEX IF NOT EXISTS idx_question_findings_question ON question_findings (question_id);
CREATE INDEX IF NOT EXISTS idx_question_findings_finding ON question_findings (finding_id);

ALTER TABLE question_experiments ENABLE ROW LEVEL SECURITY;
ALTER TABLE question_findings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "question_experiments_select" ON question_experiments;
DROP POLICY IF EXISTS "question_experiments_insert" ON question_experiments;
DROP POLICY IF EXISTS "question_experiments_delete" ON question_experiments;

CREATE POLICY "question_experiments_select" ON question_experiments
    FOR SELECT USING (
        EXISTS (
            SELECT 1
            FROM questions q
            WHERE q.id = question_id
              AND q.program = ANY(user_programs())
        )
    );

CREATE POLICY "question_experiments_insert" ON question_experiments
    FOR INSERT WITH CHECK (
        EXISTS (
            SELECT 1
            FROM questions q
            JOIN experiments e ON e.id = experiment_id
            WHERE q.id = question_id
              AND q.program = ANY(user_programs())
              AND q.program = e.program
        )
    );

CREATE POLICY "question_experiments_delete" ON question_experiments
    FOR DELETE USING (
        EXISTS (
            SELECT 1
            FROM questions q
            WHERE q.id = question_id
              AND q.program = ANY(user_programs())
        )
    );

DROP POLICY IF EXISTS "question_findings_select" ON question_findings;
DROP POLICY IF EXISTS "question_findings_insert" ON question_findings;
DROP POLICY IF EXISTS "question_findings_delete" ON question_findings;

CREATE POLICY "question_findings_select" ON question_findings
    FOR SELECT USING (
        EXISTS (
            SELECT 1
            FROM questions q
            WHERE q.id = question_id
              AND q.program = ANY(user_programs())
        )
    );

CREATE POLICY "question_findings_insert" ON question_findings
    FOR INSERT WITH CHECK (
        EXISTS (
            SELECT 1
            FROM questions q
            JOIN findings f ON f.id = finding_id
            WHERE q.id = question_id
              AND q.program = ANY(user_programs())
              AND q.program = f.program
        )
    );

CREATE POLICY "question_findings_delete" ON question_findings
    FOR DELETE USING (
        EXISTS (
            SELECT 1
            FROM questions q
            WHERE q.id = question_id
              AND q.program = ANY(user_programs())
        )
    );

WITH question_max AS (
    SELECT COALESCE(MAX((regexp_replace(id, '^Q-', ''))::int), 0) AS max_id
    FROM questions
    WHERE id ~ '^Q-[0-9]+$'
)
SELECT setval(
    'question_id_seq',
    CASE WHEN max_id > 0 THEN max_id ELSE 1 END,
    max_id > 0
)
FROM question_max;

WITH inserted AS (
    INSERT INTO questions (
        id,
        program,
        question,
        context,
        status,
        source,
        direction_id
    )
    SELECT
        'Q-' || lpad(nextval('question_id_seq')::text, 4, '0'),
        d.program,
        d.question,
        d.context,
        CASE
            WHEN d.status = 'completed' THEN 'answered'
            WHEN d.status IN ('active', 'paused') THEN 'investigating'
            ELSE 'open'
        END,
        d.source,
        d.id
    FROM directions d
    WHERE coalesce(nullif(trim(d.question), ''), '') <> ''
      AND NOT EXISTS (
          SELECT 1
          FROM questions q
          WHERE q.direction_id = d.id
      )
    RETURNING id, direction_id
)
UPDATE directions d
SET primary_question_id = inserted.id
FROM inserted
WHERE d.id = inserted.direction_id
  AND d.primary_question_id IS NULL;

UPDATE questions q
SET direction_id = CASE
    WHEN q.promoted_to_type = 'direction' THEN q.promoted_to_id
    WHEN q.promoted_to_type = 'experiment' THEN e.direction_id
    ELSE q.direction_id
END
FROM experiments e
WHERE q.promoted_to_type = 'experiment'
  AND q.promoted_to_id = e.id
  AND q.direction_id IS NULL;

UPDATE directions d
SET primary_question_id = q.id
FROM questions q
WHERE q.direction_id = d.id
  AND d.primary_question_id IS NULL;

INSERT INTO question_experiments (question_id, experiment_id, is_primary)
SELECT q.id, q.promoted_to_id, true
FROM questions q
JOIN experiments e ON e.id = q.promoted_to_id
WHERE q.promoted_to_type = 'experiment'
  AND NOT EXISTS (
      SELECT 1
      FROM question_experiments qe
      WHERE qe.question_id = q.id
        AND qe.experiment_id = q.promoted_to_id
  );

INSERT INTO question_experiments (question_id, experiment_id, is_primary)
SELECT d.primary_question_id, e.id, true
FROM directions d
JOIN experiments e ON e.direction_id = d.id
WHERE d.primary_question_id IS NOT NULL
  AND NOT EXISTS (
      SELECT 1
      FROM question_experiments qe
      WHERE qe.experiment_id = e.id
        AND qe.is_primary
  );

WITH finding_primary_questions AS (
    SELECT
        f.id AS finding_id,
        MIN(qe.question_id) AS question_id,
        COUNT(DISTINCT qe.question_id) AS question_count
    FROM findings f
    JOIN LATERAL unnest(f.evidence) AS evidence(experiment_id) ON true
    JOIN question_experiments qe
      ON qe.experiment_id = evidence.experiment_id
     AND qe.is_primary
    GROUP BY f.id
)
INSERT INTO question_findings (question_id, finding_id)
SELECT fpq.question_id, fpq.finding_id
FROM finding_primary_questions fpq
WHERE fpq.question_count = 1
  AND NOT EXISTS (
      SELECT 1
      FROM question_findings qf
      WHERE qf.question_id = fpq.question_id
        AND qf.finding_id = fpq.finding_id
  );

UPDATE questions q
SET status = 'answered'
WHERE q.status <> 'dismissed'
  AND EXISTS (
      SELECT 1
      FROM question_findings qf
      WHERE qf.question_id = q.id
  );

DROP VIEW IF EXISTS question_status;

CREATE VIEW question_status AS
SELECT
    q.id,
    q.program,
    q.question,
    q.context,
    q.status,
    q.source,
    q.raised_by,
    q.tags,
    q.direction_id,
    q.promoted_to_type,
    q.promoted_to_id,
    q.created_at,
    q.updated_at,
    (SELECT count(*) FROM question_experiments qe WHERE qe.question_id = q.id) AS linked_experiment_count,
    (SELECT count(*) FROM question_experiments qe WHERE qe.question_id = q.id AND qe.is_primary) AS primary_experiment_count,
    (SELECT count(*) FROM question_findings qf WHERE qf.question_id = q.id) AS linked_finding_count
FROM questions q
ORDER BY q.updated_at DESC;

DROP VIEW IF EXISTS direction_status;

CREATE VIEW direction_status AS
SELECT
    d.id,
    d.program,
    d.title,
    d.question,
    d.context,
    d.status,
    d.source,
    d.project_id,
    d.parent_direction_id,
    d.spawned_from_experiment_id,
    d.primary_question_id,
    (SELECT count(*) FROM questions q WHERE q.direction_id = d.id) AS question_count,
    (SELECT count(*) FROM questions q WHERE q.direction_id = d.id AND q.status = 'answered') AS answered_question_count,
    (SELECT count(*) FROM experiments e WHERE e.direction_id = d.id) AS experiment_count,
    (SELECT count(*) FROM experiments e WHERE e.direction_id = d.id AND e.status = 'complete') AS complete_count,
    (SELECT count(*) FROM experiments e WHERE e.direction_id = d.id AND e.status = 'open') AS open_count,
    (SELECT count(*) FROM experiments e WHERE e.direction_id = d.id AND e.status = 'running') AS running_count,
    (SELECT count(*) FROM directions c WHERE c.parent_direction_id = d.id) AS child_direction_count,
    d.created_at,
    d.updated_at
FROM directions d
ORDER BY d.updated_at DESC;

DROP VIEW IF EXISTS experiment_summary;

CREATE VIEW experiment_summary AS
SELECT
    e.id,
    e.program,
    e.status,
    e.source,
    e.content,
    e.hypothesis,
    e.parameters,
    e.results,
    e.finding,
    e.metadata,
    e.git_commit,
    e.git_repo,
    e.git_branch,
    e.git_close_commit,
    e.git_close_branch,
    e.git_dirty,
    e.code_context,
    (SELECT count(*)                   FROM artifacts a WHERE a.experiment_id = e.id) AS artifact_count,
    (SELECT array_agg(DISTINCT a.type) FROM artifacts a WHERE a.experiment_id = e.id) AS artifact_types,
    (SELECT array_agg(a.filename)      FROM artifacts a WHERE a.experiment_id = e.id) AS artifact_filenames,
    (SELECT qe.question_id FROM question_experiments qe WHERE qe.experiment_id = e.id AND qe.is_primary ORDER BY qe.created_at ASC LIMIT 1) AS primary_question_id,
    (SELECT count(*) FROM question_experiments qe WHERE qe.experiment_id = e.id) AS question_count,
    e.data_sources,
    e.tags,
    e.direction_id,
    e.project_id,
    e.linear_id,
    e.related,
    e.parent_id,
    e.branch_type,
    e.claimed_by,
    e.claimed_at,
    e.run_at,
    e.created_at,
    e.updated_at
FROM experiments e
ORDER BY e.created_at DESC;

DROP VIEW IF EXISTS current_findings;

CREATE VIEW current_findings AS
SELECT
    f.id,
    f.program,
    f.topic,
    f.finding,
    f.confidence,
    f.evidence,
    f.source,
    f.valid_from,
    f.supersedes,
    (SELECT count(*) FROM question_findings qf WHERE qf.finding_id = f.id) AS question_count
FROM findings f
WHERE f.valid_until IS NULL
ORDER BY f.valid_from DESC;

DROP VIEW IF EXISTS research_inbox;

CREATE VIEW research_inbox AS
SELECT *
FROM question_status
WHERE status IN ('open', 'investigating')
ORDER BY created_at DESC;

NOTIFY pgrst, 'reload schema';
