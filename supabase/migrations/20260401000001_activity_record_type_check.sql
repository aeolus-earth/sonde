-- Fix: add "project" to allowed record_type values.
-- The constraint may have been added via dashboard but missed "project",
-- causing sonde project create/update to crash after the DB write.

DO $$ BEGIN
    ALTER TABLE activity_log DROP CONSTRAINT IF EXISTS activity_log_record_type_check;
EXCEPTION WHEN undefined_object THEN NULL;
END $$;

ALTER TABLE activity_log ADD CONSTRAINT activity_log_record_type_check
    CHECK (record_type IN ('experiment', 'finding', 'question', 'direction', 'project'));
