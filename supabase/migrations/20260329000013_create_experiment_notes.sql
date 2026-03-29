-- Experiment notes: timestamped observations on experiments.
-- Agents and humans add notes as they work. Pulled to local .sonde/ on sync.

CREATE TABLE experiment_notes (
    id TEXT PRIMARY KEY,
    experiment_id TEXT NOT NULL REFERENCES experiments(id),
    content TEXT NOT NULL,
    source TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_notes_experiment ON experiment_notes (experiment_id);
CREATE INDEX idx_notes_created ON experiment_notes (created_at);

ALTER TABLE experiment_notes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "notes_select" ON experiment_notes
    FOR SELECT USING (
        EXISTS (
            SELECT 1 FROM experiments e
            WHERE e.id = experiment_id
            AND e.program = ANY(user_programs())
        )
    );

CREATE POLICY "notes_insert" ON experiment_notes
    FOR INSERT WITH CHECK (
        EXISTS (
            SELECT 1 FROM experiments e
            WHERE e.id = experiment_id
            AND e.program = ANY(user_programs())
        )
    );

CREATE SEQUENCE note_id_seq START 1;
