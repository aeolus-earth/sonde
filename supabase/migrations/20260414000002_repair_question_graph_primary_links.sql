-- Repair missing question graph links and ensure a primary question exists when
-- the graph has already been created.

WITH ranked_direction_questions AS (
    SELECT
        q.direction_id,
        q.id AS question_id,
        row_number() OVER (
            PARTITION BY q.direction_id
            ORDER BY q.created_at ASC, q.id ASC
        ) AS direction_rank
    FROM questions q
    WHERE q.direction_id IS NOT NULL
)
UPDATE directions d
SET primary_question_id = ranked_direction_questions.question_id
FROM ranked_direction_questions
WHERE d.id = ranked_direction_questions.direction_id
  AND d.primary_question_id IS NULL
  AND ranked_direction_questions.direction_rank = 1;

INSERT INTO question_experiments (question_id, experiment_id, is_primary)
SELECT q.id, q.promoted_to_id, false
FROM questions q
JOIN experiments e ON e.id = q.promoted_to_id
WHERE q.promoted_to_type = 'experiment'
  AND NOT EXISTS (
      SELECT 1
      FROM question_experiments qe
      WHERE qe.question_id = q.id
        AND qe.experiment_id = q.promoted_to_id
  );

WITH direction_primary_links AS (
    SELECT d.primary_question_id AS question_id, e.id AS experiment_id
    FROM directions d
    JOIN experiments e ON e.direction_id = d.id
    WHERE d.primary_question_id IS NOT NULL
      AND NOT EXISTS (
          SELECT 1
          FROM question_experiments qe
          WHERE qe.experiment_id = e.id
            AND qe.is_primary
      )
)
INSERT INTO question_experiments (question_id, experiment_id, is_primary)
SELECT direction_primary_links.question_id, direction_primary_links.experiment_id, false
FROM direction_primary_links
ON CONFLICT (question_id, experiment_id) DO NOTHING;

WITH ranked_duplicate_primary_links AS (
    SELECT
        qe.question_id,
        qe.experiment_id,
        row_number() OVER (
            PARTITION BY qe.experiment_id
            ORDER BY
                CASE
                    WHEN d.primary_question_id = qe.question_id THEN 0
                    ELSE 1
                END,
                q.created_at ASC,
                q.id ASC
        ) AS primary_rank
    FROM question_experiments qe
    JOIN questions q ON q.id = qe.question_id
    JOIN experiments e ON e.id = qe.experiment_id
    LEFT JOIN directions d ON d.id = e.direction_id
    WHERE qe.experiment_id IN (
        SELECT duplicate_primary_experiments.experiment_id
        FROM (
            SELECT question_experiments.experiment_id
            FROM question_experiments
            WHERE is_primary
            GROUP BY question_experiments.experiment_id
            HAVING count(*) > 1
        ) AS duplicate_primary_experiments
    )
)
UPDATE question_experiments qe
SET is_primary = (ranked_duplicate_primary_links.primary_rank = 1)
FROM ranked_duplicate_primary_links
WHERE qe.question_id = ranked_duplicate_primary_links.question_id
  AND qe.experiment_id = ranked_duplicate_primary_links.experiment_id;

WITH ranked_missing_primary_links AS (
    SELECT
        qe.question_id,
        qe.experiment_id,
        row_number() OVER (
            PARTITION BY qe.experiment_id
            ORDER BY
                CASE
                    WHEN d.primary_question_id = qe.question_id THEN 0
                    ELSE 1
                END,
                q.created_at ASC,
                q.id ASC
        ) AS primary_rank
    FROM question_experiments qe
    JOIN questions q ON q.id = qe.question_id
    JOIN experiments e ON e.id = qe.experiment_id
    LEFT JOIN directions d ON d.id = e.direction_id
    WHERE qe.experiment_id IN (
        SELECT missing_primary_experiments.experiment_id
        FROM (
            SELECT question_experiments.experiment_id
            FROM question_experiments
            GROUP BY question_experiments.experiment_id
            HAVING NOT bool_or(question_experiments.is_primary)
        ) AS missing_primary_experiments
    )
)
UPDATE question_experiments qe
SET is_primary = (ranked_missing_primary_links.primary_rank = 1)
FROM ranked_missing_primary_links
WHERE qe.question_id = ranked_missing_primary_links.question_id
  AND qe.experiment_id = ranked_missing_primary_links.experiment_id;
