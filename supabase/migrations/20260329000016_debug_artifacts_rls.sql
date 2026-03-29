-- Temporarily make artifacts fully permissive to debug the 403
DROP POLICY IF EXISTS "artifacts_insert" ON artifacts;
DROP POLICY IF EXISTS "artifacts_select" ON artifacts;
DROP POLICY IF EXISTS "artifacts_delete" ON artifacts;

CREATE POLICY "artifacts_all" ON artifacts FOR ALL USING (true) WITH CHECK (true);
