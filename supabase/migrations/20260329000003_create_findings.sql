-- Findings: distilled knowledge derived from experiments
-- Findings have temporal validity — they can be superseded but never deleted

CREATE TABLE findings (
    id TEXT PRIMARY KEY,  -- FIND-001 format
    program TEXT NOT NULL REFERENCES programs(id),
    topic TEXT NOT NULL,
    finding TEXT NOT NULL,
    confidence TEXT NOT NULL DEFAULT 'medium'
        CHECK (confidence IN ('low', 'medium', 'high')),

    -- Evidence and lineage
    evidence TEXT[] NOT NULL DEFAULT '{}',  -- experiment IDs
    source TEXT NOT NULL,  -- who synthesized this

    -- Temporal validity
    valid_from TIMESTAMPTZ NOT NULL DEFAULT now(),
    valid_until TIMESTAMPTZ,  -- NULL = still current
    supersedes TEXT REFERENCES findings(id),
    superseded_by TEXT REFERENCES findings(id),

    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_findings_program ON findings (program);
CREATE INDEX idx_findings_topic ON findings (topic);
CREATE INDEX idx_findings_valid ON findings (valid_from, valid_until);
CREATE INDEX idx_findings_fts ON findings USING GIN (
    to_tsvector('english', topic || ' ' || finding)
);

CREATE TRIGGER findings_updated_at
    BEFORE UPDATE ON findings
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE SEQUENCE finding_id_seq START 1;
