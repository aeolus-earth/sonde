-- Simplify artifacts RLS — any authenticated user with programs can insert.
-- The subquery-based policy was causing intermittent 403s.

DROP POLICY IF EXISTS "artifacts_insert" ON artifacts;

CREATE POLICY "artifacts_insert" ON artifacts
    FOR INSERT WITH CHECK (
        array_length(user_programs(), 1) > 0
    );

-- Also allow delete for cleanup
DROP POLICY IF EXISTS "artifacts_delete" ON artifacts;

CREATE POLICY "artifacts_delete" ON artifacts
    FOR DELETE USING (
        array_length(user_programs(), 1) > 0
    );
