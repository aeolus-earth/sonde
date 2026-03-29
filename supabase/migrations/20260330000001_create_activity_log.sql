-- Activity log: append-only audit trail of every action.
-- Never modified, never deleted. Answers "who did what when."

CREATE TABLE IF NOT EXISTS activity_log (
    id BIGSERIAL PRIMARY KEY,
    record_id TEXT NOT NULL,
    record_type TEXT NOT NULL,
    action TEXT NOT NULL,
    actor TEXT NOT NULL,
    actor_email TEXT,
    actor_name TEXT,
    details JSONB NOT NULL DEFAULT '{}',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_activity_record ON activity_log (record_id);
CREATE INDEX IF NOT EXISTS idx_activity_actor ON activity_log (actor);
CREATE INDEX IF NOT EXISTS idx_activity_created ON activity_log (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_activity_type ON activity_log (record_type, created_at DESC);

ALTER TABLE activity_log ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
    CREATE POLICY "activity_select" ON activity_log FOR SELECT USING (true);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
    CREATE POLICY "activity_insert" ON activity_log FOR INSERT WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
