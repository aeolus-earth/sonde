-- Storage bucket RLS: allow authenticated users to upload/download artifacts.
-- The 403 was from Storage RLS, not the artifacts table.

CREATE POLICY "artifacts_bucket_select" ON storage.objects
    FOR SELECT USING (bucket_id = 'artifacts');

CREATE POLICY "artifacts_bucket_insert" ON storage.objects
    FOR INSERT WITH CHECK (bucket_id = 'artifacts');

CREATE POLICY "artifacts_bucket_update" ON storage.objects
    FOR UPDATE USING (bucket_id = 'artifacts');
