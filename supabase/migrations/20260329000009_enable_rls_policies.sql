-- Enable RLS with permissive policies for development
-- In production, these will be scoped by program + auth token

-- Programs: readable by everyone, writable by service role only
ALTER TABLE programs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "programs_read" ON programs FOR SELECT USING (true);

-- Experiments: full access for now (scope by program later)
ALTER TABLE experiments ENABLE ROW LEVEL SECURITY;
CREATE POLICY "experiments_read" ON experiments FOR SELECT USING (true);
CREATE POLICY "experiments_insert" ON experiments FOR INSERT WITH CHECK (true);
CREATE POLICY "experiments_update" ON experiments FOR UPDATE USING (true);

-- Findings: full access for now
ALTER TABLE findings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "findings_read" ON findings FOR SELECT USING (true);
CREATE POLICY "findings_insert" ON findings FOR INSERT WITH CHECK (true);
CREATE POLICY "findings_update" ON findings FOR UPDATE USING (true);

-- Directions: full access for now
ALTER TABLE directions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "directions_read" ON directions FOR SELECT USING (true);
CREATE POLICY "directions_insert" ON directions FOR INSERT WITH CHECK (true);
CREATE POLICY "directions_update" ON directions FOR UPDATE USING (true);

-- Questions: full access for now
ALTER TABLE questions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "questions_read" ON questions FOR SELECT USING (true);
CREATE POLICY "questions_insert" ON questions FOR INSERT WITH CHECK (true);
CREATE POLICY "questions_update" ON questions FOR UPDATE USING (true);

-- Artifacts: full access for now
ALTER TABLE artifacts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "artifacts_read" ON artifacts FOR SELECT USING (true);
CREATE POLICY "artifacts_insert" ON artifacts FOR INSERT WITH CHECK (true);
