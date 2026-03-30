-- Allow delete operations to append an audit trail entry.
--
-- The CLI already logs `deleted` for experiments, directions, findings, and
-- questions. The activity_log constraint was never updated to accept that
-- action, which makes delete commands fail before the record is removed.

ALTER TABLE activity_log DROP CONSTRAINT IF EXISTS activity_log_action_check;
ALTER TABLE activity_log ADD CONSTRAINT activity_log_action_check
    CHECK (action IN (
        'created', 'updated', 'status_changed',
        'note_added', 'artifact_attached',
        'tag_added', 'tag_removed',
        'claim_released', 'archived',
        'deleted'
    ));
