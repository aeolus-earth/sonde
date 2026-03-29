-- Add content and metadata columns to support freeform research documents.
--
-- content: the full markdown body of the experiment/finding/question
-- metadata: flexible key-value pairs for structured search (agent-defined)
-- record_links: bidirectional links between any records

-- Experiments
ALTER TABLE experiments ADD COLUMN IF NOT EXISTS content TEXT;
ALTER TABLE experiments ADD COLUMN IF NOT EXISTS metadata JSONB NOT NULL DEFAULT '{}';

CREATE INDEX IF NOT EXISTS idx_experiments_content_fts
    ON experiments USING GIN (to_tsvector('english', coalesce(content, '')));
CREATE INDEX IF NOT EXISTS idx_experiments_metadata
    ON experiments USING GIN (metadata);

-- Findings
ALTER TABLE findings ADD COLUMN IF NOT EXISTS content TEXT;
ALTER TABLE findings ADD COLUMN IF NOT EXISTS metadata JSONB NOT NULL DEFAULT '{}';

CREATE INDEX IF NOT EXISTS idx_findings_content_fts
    ON findings USING GIN (to_tsvector('english', coalesce(content, '')));

-- Questions
ALTER TABLE questions ADD COLUMN IF NOT EXISTS content TEXT;
ALTER TABLE questions ADD COLUMN IF NOT EXISTS metadata JSONB NOT NULL DEFAULT '{}';

CREATE INDEX IF NOT EXISTS idx_questions_content_fts
    ON questions USING GIN (to_tsvector('english', coalesce(content, '')));

-- Record links: bidirectional references between any records
CREATE TABLE IF NOT EXISTS record_links (
    source_id TEXT NOT NULL,
    source_type TEXT NOT NULL CHECK (source_type IN ('experiment', 'finding', 'question', 'direction')),
    target_id TEXT NOT NULL,
    target_type TEXT NOT NULL CHECK (target_type IN ('experiment', 'finding', 'question', 'direction')),
    label TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (source_id, target_id)
);

ALTER TABLE record_links ENABLE ROW LEVEL SECURITY;

-- Links are visible if you can see either the source or target
CREATE POLICY "links_select" ON record_links FOR SELECT USING (true);
CREATE POLICY "links_insert" ON record_links FOR INSERT WITH CHECK (true);
CREATE POLICY "links_delete" ON record_links FOR DELETE USING (true);
