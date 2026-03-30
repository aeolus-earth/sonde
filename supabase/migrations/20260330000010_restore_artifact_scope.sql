-- Restore program-scoped artifact access after earlier debugging relaxations.
-- Keep artifact lifecycle queueing, but remove globally permissive artifact/blob access.

DROP POLICY IF EXISTS "artifacts_all" ON artifacts;

DROP POLICY IF EXISTS "artifacts_insert" ON artifacts;
CREATE POLICY "artifacts_insert" ON artifacts
    FOR INSERT WITH CHECK (
        (experiment_id IS NOT NULL AND EXISTS (
            SELECT 1 FROM experiments e
            WHERE e.id = experiment_id AND e.program = ANY(user_programs())
        ))
        OR (finding_id IS NOT NULL AND EXISTS (
            SELECT 1 FROM findings f
            WHERE f.id = finding_id AND f.program = ANY(user_programs())
        ))
        OR (direction_id IS NOT NULL AND EXISTS (
            SELECT 1 FROM directions d
            WHERE d.id = direction_id AND d.program = ANY(user_programs())
        ))
    );

DROP POLICY IF EXISTS "artifacts_delete" ON artifacts;
CREATE POLICY "artifacts_delete" ON artifacts
    FOR DELETE USING (
        (experiment_id IS NOT NULL AND EXISTS (
            SELECT 1 FROM experiments e
            WHERE e.id = experiment_id AND e.program = ANY(user_programs())
        ))
        OR (finding_id IS NOT NULL AND EXISTS (
            SELECT 1 FROM findings f
            WHERE f.id = finding_id AND f.program = ANY(user_programs())
        ))
        OR (direction_id IS NOT NULL AND EXISTS (
            SELECT 1 FROM directions d
            WHERE d.id = direction_id AND d.program = ANY(user_programs())
        ))
    );

DROP POLICY IF EXISTS "artifacts_bucket_select" ON storage.objects;
DROP POLICY IF EXISTS "artifacts_bucket_insert" ON storage.objects;
DROP POLICY IF EXISTS "artifacts_bucket_update" ON storage.objects;

DROP POLICY IF EXISTS "artifacts_storage_update" ON storage.objects;
CREATE POLICY "artifacts_storage_update" ON storage.objects
    FOR UPDATE USING (
        bucket_id = 'artifacts'
        AND EXISTS (
            SELECT 1 FROM artifacts a
            WHERE a.storage_path = name
            AND (
                (a.experiment_id IS NOT NULL AND EXISTS (
                    SELECT 1 FROM experiments e
                    WHERE e.id = a.experiment_id AND e.program = ANY(user_programs())
                ))
                OR (a.finding_id IS NOT NULL AND EXISTS (
                    SELECT 1 FROM findings f
                    WHERE f.id = a.finding_id AND f.program = ANY(user_programs())
                ))
                OR (a.direction_id IS NOT NULL AND EXISTS (
                    SELECT 1 FROM directions d
                    WHERE d.id = a.direction_id AND d.program = ANY(user_programs())
                ))
            )
        )
    )
    WITH CHECK (
        bucket_id = 'artifacts'
        AND EXISTS (
            SELECT 1 FROM artifacts a
            WHERE a.storage_path = name
            AND (
                (a.experiment_id IS NOT NULL AND EXISTS (
                    SELECT 1 FROM experiments e
                    WHERE e.id = a.experiment_id AND e.program = ANY(user_programs())
                ))
                OR (a.finding_id IS NOT NULL AND EXISTS (
                    SELECT 1 FROM findings f
                    WHERE f.id = a.finding_id AND f.program = ANY(user_programs())
                ))
                OR (a.direction_id IS NOT NULL AND EXISTS (
                    SELECT 1 FROM directions d
                    WHERE d.id = a.direction_id AND d.program = ANY(user_programs())
                ))
            )
        )
    );
