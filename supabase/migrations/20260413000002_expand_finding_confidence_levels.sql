-- Expand finding confidence to a 5-point scale for richer curation in the UI.

ALTER TABLE findings
    DROP CONSTRAINT IF EXISTS findings_confidence_check;

ALTER TABLE findings
    ADD CONSTRAINT findings_confidence_check
    CHECK (confidence IN ('very_low', 'low', 'medium', 'high', 'very_high'));

NOTIFY pgrst, 'reload schema';
