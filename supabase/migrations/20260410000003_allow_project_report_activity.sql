-- Allow project_report_updated action in the activity log.
-- The project report command logs this action when a report PDF/LaTeX is
-- attached or updated, but it was missing from the allowed actions list.

ALTER TABLE activity_log DROP CONSTRAINT IF EXISTS activity_log_action_check;
ALTER TABLE activity_log ADD CONSTRAINT activity_log_action_check
    CHECK (action IN (
        'created', 'updated', 'status_changed',
        'note_added', 'artifact_attached', 'artifact_deleted',
        'tag_added', 'tag_removed',
        'claim_released', 'archived',
        'deleted',
        'review_opened', 'review_comment_added',
        'review_resolved', 'review_reopened',
        'project_report_updated'
    ));
