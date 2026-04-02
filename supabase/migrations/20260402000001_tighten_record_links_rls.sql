-- Tighten record_links and activity_log RLS policies.
-- Replace USING(true) with program-scoped checks via parent record joins.
--
-- Creates a helper function can_access_record(rid, rtype) reused by both tables.

-- ---------------------------------------------------------------------------
-- 1. Helper: can the current user access a record by id + type?
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION can_access_record(rid TEXT, rtype TEXT)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
    SELECT CASE rtype
        WHEN 'experiment' THEN EXISTS (
            SELECT 1 FROM experiments e WHERE e.id = rid AND e.program = ANY(user_programs()))
        WHEN 'finding' THEN EXISTS (
            SELECT 1 FROM findings f WHERE f.id = rid AND f.program = ANY(user_programs()))
        WHEN 'question' THEN EXISTS (
            SELECT 1 FROM questions q WHERE q.id = rid AND q.program = ANY(user_programs()))
        WHEN 'direction' THEN EXISTS (
            SELECT 1 FROM directions d WHERE d.id = rid AND d.program = ANY(user_programs()))
        WHEN 'project' THEN EXISTS (
            SELECT 1 FROM projects p WHERE p.id = rid AND p.program = ANY(user_programs()))
        ELSE false
    END;
$$;

GRANT EXECUTE ON FUNCTION can_access_record(TEXT, TEXT) TO authenticated;

-- ---------------------------------------------------------------------------
-- 2. record_links: replace open policies with program-scoped ones
--    A link is accessible if the user can access the source OR target record.
-- ---------------------------------------------------------------------------

DROP POLICY IF EXISTS "links_select" ON record_links;
DROP POLICY IF EXISTS "links_insert" ON record_links;
DROP POLICY IF EXISTS "links_delete" ON record_links;

CREATE POLICY "links_select" ON record_links FOR SELECT USING (
    can_access_record(source_id, source_type)
    OR can_access_record(target_id, target_type)
);

CREATE POLICY "links_insert" ON record_links FOR INSERT WITH CHECK (
    can_access_record(source_id, source_type)
    OR can_access_record(target_id, target_type)
);

CREATE POLICY "links_delete" ON record_links FOR DELETE USING (
    can_access_record(source_id, source_type)
    OR can_access_record(target_id, target_type)
);
