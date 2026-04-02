-- Tighten activity_log RLS: replace USING(true) with program-scoped checks.
-- Reuses can_access_record() created in the previous migration.
--
-- activity_log is append-only — no UPDATE/DELETE policies are created,
-- so those operations remain denied by default under RLS.

DROP POLICY IF EXISTS "activity_select" ON activity_log;
DROP POLICY IF EXISTS "activity_insert" ON activity_log;

CREATE POLICY "activity_select" ON activity_log FOR SELECT USING (
    can_access_record(record_id, record_type)
);

CREATE POLICY "activity_insert" ON activity_log FOR INSERT WITH CHECK (
    can_access_record(record_id, record_type)
);
