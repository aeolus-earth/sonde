-- Artifacts: files attached to experiments, findings, or directions
-- Metadata lives here; actual files live in Supabase Storage

CREATE TABLE artifacts (
    id TEXT PRIMARY KEY,  -- ART-0001 format
    filename TEXT NOT NULL,
    type TEXT NOT NULL DEFAULT 'other'
        CHECK (type IN ('figure', 'paper', 'dataset', 'notebook', 'config', 'log', 'report', 'other')),
    mime_type TEXT,
    size_bytes BIGINT,
    description TEXT,

    -- Where the file lives
    storage_path TEXT NOT NULL,  -- path in Supabase Storage bucket

    -- What it's attached to (polymorphic — exactly one should be set)
    experiment_id TEXT REFERENCES experiments(id),
    finding_id TEXT REFERENCES findings(id),
    direction_id TEXT REFERENCES directions(id),

    source TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_artifacts_experiment ON artifacts (experiment_id);
CREATE INDEX idx_artifacts_finding ON artifacts (finding_id);
CREATE INDEX idx_artifacts_direction ON artifacts (direction_id);
CREATE INDEX idx_artifacts_type ON artifacts (type);

CREATE SEQUENCE artifact_id_seq START 1;

-- Ensure artifact is attached to exactly one parent
ALTER TABLE artifacts ADD CONSTRAINT artifacts_single_parent CHECK (
    (experiment_id IS NOT NULL)::int +
    (finding_id IS NOT NULL)::int +
    (direction_id IS NOT NULL)::int = 1
);
