-- Project-level takeaways: scoped synthesis per project.
-- Same pattern as program_takeaways but keyed on project_id.

CREATE TABLE project_takeaways (
    project_id TEXT PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
    body TEXT NOT NULL DEFAULT '',
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE project_takeaways ENABLE ROW LEVEL SECURITY;

-- Member-scoped RLS: access only takeaways for projects in your programs
CREATE POLICY "project_takeaways_select" ON project_takeaways FOR SELECT USING (
    EXISTS (SELECT 1 FROM projects p WHERE p.id = project_id AND p.program = ANY(user_programs()))
);

CREATE POLICY "project_takeaways_insert" ON project_takeaways FOR INSERT WITH CHECK (
    EXISTS (SELECT 1 FROM projects p WHERE p.id = project_id AND p.program = ANY(user_programs()))
);

CREATE POLICY "project_takeaways_update" ON project_takeaways FOR UPDATE USING (
    EXISTS (SELECT 1 FROM projects p WHERE p.id = project_id AND p.program = ANY(user_programs()))
);

CREATE TRIGGER project_takeaways_updated_at
    BEFORE UPDATE ON project_takeaways
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();

GRANT SELECT, INSERT, UPDATE ON project_takeaways TO authenticated;
GRANT ALL ON project_takeaways TO service_role;
