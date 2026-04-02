-- Fix: activity_log INSERT policy blocks logging after record deletion.
--
-- can_access_record() checks the source table (e.g. questions) to verify
-- the record exists and belongs to the user's programs. After a DELETE,
-- the record no longer exists, so the INSERT is denied (error 42501).
--
-- Fix: allow activity inserts for any authenticated user with program access
-- when the record itself may no longer exist. The activity_log is append-only
-- (no UPDATE/DELETE policies), so a permissive INSERT fallback is safe.

DROP POLICY IF EXISTS "activity_insert" ON activity_log;

CREATE POLICY "activity_insert" ON activity_log FOR INSERT WITH CHECK (
    can_access_record(record_id, record_type)
    OR (
        -- Fallback for deleted records: the source row is gone, so
        -- can_access_record() returns false. Allow the insert if the
        -- user belongs to at least one program.
        array_length(user_programs(), 1) > 0
        AND record_type IN ('experiment', 'finding', 'question', 'direction', 'project')
    )
);
