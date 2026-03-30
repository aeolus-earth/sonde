-- Document the allowed activity log actions.
-- This constraint may already exist in the hosted DB (added via dashboard).
-- This migration ensures local dev matches production.
DO $$ BEGIN
    ALTER TABLE activity_log ADD CONSTRAINT activity_log_action_check
        CHECK (action IN (
            'created', 'updated', 'status_changed',
            'note_added', 'artifact_attached',
            'tag_added', 'tag_removed'
        ));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
