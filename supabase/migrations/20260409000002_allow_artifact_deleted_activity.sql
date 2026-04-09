-- Allow artifact delete operations to append an audit trail entry.

ALTER TABLE activity_log DROP CONSTRAINT IF EXISTS activity_log_action_check;
ALTER TABLE activity_log ADD CONSTRAINT activity_log_action_check
    CHECK (action IN (
        'created', 'updated', 'status_changed',
        'note_added', 'artifact_attached', 'artifact_deleted',
        'tag_added', 'tag_removed',
        'claim_released', 'archived',
        'deleted',
        'review_opened', 'review_comment_added',
        'review_resolved', 'review_reopened'
    ));
