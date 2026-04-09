-- Experiment reviews: one freeform critique thread attached to each experiment.

CREATE TABLE experiment_reviews (
    id TEXT PRIMARY KEY,
    experiment_id TEXT NOT NULL UNIQUE REFERENCES experiments(id) ON DELETE CASCADE,
    status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'resolved')),
    opened_by TEXT NOT NULL,
    resolved_by TEXT,
    resolved_at TIMESTAMPTZ,
    resolution TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE experiment_review_entries (
    id TEXT PRIMARY KEY,
    review_id TEXT NOT NULL REFERENCES experiment_reviews(id) ON DELETE CASCADE,
    source TEXT NOT NULL,
    content TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_experiment_reviews_experiment ON experiment_reviews (experiment_id);
CREATE INDEX idx_experiment_reviews_status ON experiment_reviews (status);
CREATE INDEX idx_experiment_review_entries_review_created
    ON experiment_review_entries (review_id, created_at);

CREATE TRIGGER experiment_reviews_updated_at
    BEFORE UPDATE ON experiment_reviews
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER experiment_review_entries_updated_at
    BEFORE UPDATE ON experiment_review_entries
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();

ALTER TABLE experiment_reviews ENABLE ROW LEVEL SECURITY;
ALTER TABLE experiment_review_entries ENABLE ROW LEVEL SECURITY;

CREATE POLICY "experiment_reviews_select" ON experiment_reviews FOR SELECT USING (
    EXISTS (
        SELECT 1 FROM experiments e
        WHERE e.id = experiment_id AND e.program = ANY(user_programs())
    )
);

CREATE POLICY "experiment_reviews_insert" ON experiment_reviews FOR INSERT WITH CHECK (
    EXISTS (
        SELECT 1 FROM experiments e
        WHERE e.id = experiment_id AND e.program = ANY(user_programs())
    )
);

CREATE POLICY "experiment_reviews_update" ON experiment_reviews FOR UPDATE USING (
    EXISTS (
        SELECT 1 FROM experiments e
        WHERE e.id = experiment_id AND e.program = ANY(user_programs())
    )
);

CREATE POLICY "experiment_review_entries_select"
    ON experiment_review_entries FOR SELECT USING (
        EXISTS (
            SELECT 1
            FROM experiment_reviews r
            JOIN experiments e ON e.id = r.experiment_id
            WHERE r.id = review_id AND e.program = ANY(user_programs())
        )
    );

CREATE POLICY "experiment_review_entries_insert"
    ON experiment_review_entries FOR INSERT WITH CHECK (
        EXISTS (
            SELECT 1
            FROM experiment_reviews r
            JOIN experiments e ON e.id = r.experiment_id
            WHERE r.id = review_id AND e.program = ANY(user_programs())
        )
    );

CREATE POLICY "experiment_review_entries_update"
    ON experiment_review_entries FOR UPDATE USING (
        EXISTS (
            SELECT 1
            FROM experiment_reviews r
            JOIN experiments e ON e.id = r.experiment_id
            WHERE r.id = review_id AND e.program = ANY(user_programs())
        )
    );

ALTER TABLE activity_log DROP CONSTRAINT IF EXISTS activity_log_action_check;
ALTER TABLE activity_log ADD CONSTRAINT activity_log_action_check
    CHECK (action IN (
        'created', 'updated', 'status_changed',
        'note_added', 'artifact_attached',
        'tag_added', 'tag_removed',
        'claim_released', 'archived',
        'deleted',
        'review_opened', 'review_comment_added',
        'review_resolved', 'review_reopened'
    ));

GRANT SELECT, INSERT, UPDATE ON experiment_reviews TO authenticated;
GRANT SELECT, INSERT, UPDATE ON experiment_review_entries TO authenticated;
GRANT ALL ON experiment_reviews TO service_role;
GRANT ALL ON experiment_review_entries TO service_role;

UPDATE schema_version SET version = 2, updated_at = now() WHERE singleton = TRUE;
