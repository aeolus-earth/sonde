-- Backfill canonical experiment hypotheses from content-first markdown.
-- Only populate rows where the dedicated field is empty.

UPDATE experiments
SET hypothesis = NULLIF(
    btrim(
        substring(content FROM '(?ms)^## Hypothesis\s*(.*?)(?=^## \S|\Z)')
    ),
    ''
)
WHERE NULLIF(btrim(hypothesis), '') IS NULL
  AND NULLIF(btrim(content), '') IS NOT NULL
  AND content ~* '(?m)^## Hypothesis\s*$';
