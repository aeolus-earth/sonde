-- Directions: research questions requiring multiple experiments
-- Organizes experiments into coherent research threads

CREATE TABLE directions (
    id TEXT PRIMARY KEY,  -- DIR-001 format
    program TEXT NOT NULL REFERENCES programs(id),
    title TEXT NOT NULL,
    question TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'active'
        CHECK (status IN ('proposed', 'active', 'paused', 'completed', 'abandoned')),

    source TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_directions_program ON directions (program);
CREATE INDEX idx_directions_status ON directions (status);

CREATE TRIGGER directions_updated_at
    BEFORE UPDATE ON directions
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE SEQUENCE direction_id_seq START 1;

-- Now add the FK from experiments to directions
ALTER TABLE experiments
    ADD CONSTRAINT fk_experiments_direction
    FOREIGN KEY (direction_id) REFERENCES directions(id);
