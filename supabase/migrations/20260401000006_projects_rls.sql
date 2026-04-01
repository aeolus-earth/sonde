-- Tighten project RLS to program-scoped (was open USING(true)).
-- Matches the security model of experiments, directions, and other tables.

DROP POLICY IF EXISTS "projects_select" ON projects;
DROP POLICY IF EXISTS "projects_insert" ON projects;
DROP POLICY IF EXISTS "projects_update" ON projects;
DROP POLICY IF EXISTS "projects_delete" ON projects;

CREATE POLICY "projects_select" ON projects FOR SELECT
    USING (program = ANY(user_programs()));

CREATE POLICY "projects_insert" ON projects FOR INSERT
    WITH CHECK (program = ANY(user_programs()));

CREATE POLICY "projects_update" ON projects FOR UPDATE
    USING (program = ANY(user_programs()));

CREATE POLICY "projects_delete" ON projects FOR DELETE
    USING (program = ANY(user_programs()));
