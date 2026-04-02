-- Direction-level takeaways: scoped synthesis per research direction.
-- Same pattern as program_takeaways and project_takeaways but keyed on direction_id.

CREATE TABLE direction_takeaways (
    direction_id TEXT PRIMARY KEY REFERENCES directions(id) ON DELETE CASCADE,
    body TEXT NOT NULL DEFAULT '',
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE direction_takeaways ENABLE ROW LEVEL SECURITY;

-- Member-scoped RLS: access only takeaways for directions in your programs
CREATE POLICY "direction_takeaways_select" ON direction_takeaways FOR SELECT USING (
    EXISTS (SELECT 1 FROM directions d WHERE d.id = direction_id AND d.program = ANY(user_programs()))
);

CREATE POLICY "direction_takeaways_insert" ON direction_takeaways FOR INSERT WITH CHECK (
    EXISTS (SELECT 1 FROM directions d WHERE d.id = direction_id AND d.program = ANY(user_programs()))
);

CREATE POLICY "direction_takeaways_update" ON direction_takeaways FOR UPDATE USING (
    EXISTS (SELECT 1 FROM directions d WHERE d.id = direction_id AND d.program = ANY(user_programs()))
);

CREATE TRIGGER direction_takeaways_updated_at
    BEFORE UPDATE ON direction_takeaways
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();

GRANT SELECT, INSERT, UPDATE ON direction_takeaways TO authenticated;
GRANT ALL ON direction_takeaways TO service_role;
