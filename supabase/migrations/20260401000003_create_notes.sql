-- Polymorphic notes table: supports notes on experiments, directions, and projects.
-- Replaces the experiment-only experiment_notes table.

CREATE TABLE notes (
    id TEXT PRIMARY KEY,
    record_type TEXT NOT NULL CHECK (record_type IN ('experiment', 'direction', 'project')),
    record_id TEXT NOT NULL,
    content TEXT NOT NULL,
    source TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_notes_v2_record ON notes (record_type, record_id);
CREATE INDEX idx_notes_v2_created ON notes (created_at);

ALTER TABLE notes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "notes_v2_select" ON notes FOR SELECT USING (true);
CREATE POLICY "notes_v2_insert" ON notes FOR INSERT WITH CHECK (true);
CREATE POLICY "notes_v2_update" ON notes FOR UPDATE USING (true);

CREATE TRIGGER notes_updated_at
    BEFORE UPDATE ON notes
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- Migrate existing experiment_notes into the new table
INSERT INTO notes (id, record_type, record_id, content, source, created_at)
SELECT id, 'experiment', experiment_id, content, source, created_at
FROM experiment_notes
ON CONFLICT (id) DO NOTHING;

-- Start new sequence above existing note IDs to avoid collisions
CREATE SEQUENCE IF NOT EXISTS note_v2_id_seq START 10000;

GRANT SELECT, INSERT, UPDATE ON notes TO authenticated;
GRANT ALL ON notes TO service_role;
