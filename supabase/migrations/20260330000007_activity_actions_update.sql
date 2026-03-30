-- Add missing activity log actions: claim_released (release command), archived (archive command).
-- Drop and recreate to include the full set of actions used in the codebase.

ALTER TABLE activity_log DROP CONSTRAINT IF EXISTS activity_log_action_check;
ALTER TABLE activity_log ADD CONSTRAINT activity_log_action_check
    CHECK (action IN (
        'created', 'updated', 'status_changed',
        'note_added', 'artifact_attached',
        'tag_added', 'tag_removed',
        'claim_released', 'archived'
    ));
