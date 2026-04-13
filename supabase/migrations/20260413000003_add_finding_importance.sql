-- Add a second curation axis for findings so importance can be edited and filtered
-- independently from confidence.

ALTER TABLE findings
    ADD COLUMN IF NOT EXISTS importance TEXT NOT NULL DEFAULT 'medium';

ALTER TABLE findings
    DROP CONSTRAINT IF EXISTS findings_importance_check;

ALTER TABLE findings
    ADD CONSTRAINT findings_importance_check
    CHECK (importance IN ('low', 'medium', 'high'));

DROP VIEW IF EXISTS current_findings;

CREATE VIEW current_findings AS
SELECT
    f.id,
    f.program,
    f.topic,
    f.finding,
    f.confidence,
    f.importance,
    f.evidence,
    f.source,
    f.valid_from,
    f.supersedes,
    (SELECT count(*) FROM question_findings qf WHERE qf.finding_id = f.id) AS question_count
FROM findings f
WHERE f.valid_until IS NULL
ORDER BY
    CASE f.importance
        WHEN 'high' THEN 0
        WHEN 'medium' THEN 1
        ELSE 2
    END,
    f.valid_from DESC;

NOTIFY pgrst, 'reload schema';
