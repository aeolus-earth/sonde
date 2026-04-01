-- Program-level brief takeaways (member-scoped; not exposed on public programs metadata)

CREATE TABLE program_takeaways (
    program TEXT PRIMARY KEY REFERENCES programs(id) ON DELETE CASCADE,
    body TEXT NOT NULL DEFAULT '',
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE program_takeaways ENABLE ROW LEVEL SECURITY;

CREATE POLICY "program_takeaways_select" ON program_takeaways
    FOR SELECT USING (program = ANY(user_programs()));

CREATE POLICY "program_takeaways_insert" ON program_takeaways
    FOR INSERT WITH CHECK (program = ANY(user_programs()));

CREATE POLICY "program_takeaways_update" ON program_takeaways
    FOR UPDATE USING (program = ANY(user_programs()));

CREATE TRIGGER program_takeaways_updated_at
    BEFORE UPDATE ON program_takeaways
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();

GRANT SELECT, INSERT, UPDATE ON program_takeaways TO authenticated;
GRANT ALL ON program_takeaways TO service_role;
