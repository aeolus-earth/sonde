-- Direction forking: parent-child hierarchy for sub-investigations.
-- Adds parent_direction_id and spawned_from_experiment_id to directions,
-- enforces max 2-level nesting via trigger, and rebuilds the direction_status view.

-- 1. New columns
ALTER TABLE directions ADD COLUMN IF NOT EXISTS parent_direction_id TEXT REFERENCES directions(id);
ALTER TABLE directions ADD COLUMN IF NOT EXISTS spawned_from_experiment_id TEXT REFERENCES experiments(id);

CREATE INDEX IF NOT EXISTS idx_directions_parent ON directions(parent_direction_id);
CREATE INDEX IF NOT EXISTS idx_directions_spawned_from ON directions(spawned_from_experiment_id)
  WHERE spawned_from_experiment_id IS NOT NULL;

-- 2. Enforce max 2-level depth
CREATE OR REPLACE FUNCTION check_direction_max_depth()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.parent_direction_id IS NOT NULL THEN
    -- Parent must not itself have a parent
    IF EXISTS (
      SELECT 1 FROM directions
      WHERE id = NEW.parent_direction_id
        AND parent_direction_id IS NOT NULL
    ) THEN
      RAISE EXCEPTION 'Direction nesting limited to 2 levels: % already has a parent',
        NEW.parent_direction_id;
    END IF;
    -- A direction with children cannot become a child itself
    IF NEW.id IS NOT NULL AND EXISTS (
      SELECT 1 FROM directions
      WHERE parent_direction_id = NEW.id
    ) THEN
      RAISE EXCEPTION 'Direction % already has children and cannot become a sub-direction',
        NEW.id;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER enforce_direction_max_depth
  BEFORE INSERT OR UPDATE OF parent_direction_id ON directions
  FOR EACH ROW EXECUTE FUNCTION check_direction_max_depth();

-- 3. Rebuild direction_status view with new columns
DROP VIEW IF EXISTS direction_status;

CREATE VIEW direction_status AS
SELECT
    d.id,
    d.program,
    d.title,
    d.question,
    d.context,
    d.status,
    d.source,
    d.project_id,
    d.parent_direction_id,
    d.spawned_from_experiment_id,
    (SELECT count(*) FROM experiments e WHERE e.direction_id = d.id) AS experiment_count,
    (SELECT count(*) FROM experiments e WHERE e.direction_id = d.id AND e.status = 'complete') AS complete_count,
    (SELECT count(*) FROM experiments e WHERE e.direction_id = d.id AND e.status = 'open') AS open_count,
    (SELECT count(*) FROM experiments e WHERE e.direction_id = d.id AND e.status = 'running') AS running_count,
    (SELECT count(*) FROM directions c WHERE c.parent_direction_id = d.id) AS child_direction_count,
    d.created_at,
    d.updated_at
FROM directions d
ORDER BY d.updated_at DESC;

-- 4. RPC to fetch child directions of a parent
CREATE OR REPLACE FUNCTION get_direction_children(dir_id TEXT)
RETURNS TABLE (
  id TEXT,
  parent_direction_id TEXT,
  spawned_from_experiment_id TEXT,
  program TEXT,
  title TEXT,
  question TEXT,
  context TEXT,
  status TEXT,
  source TEXT,
  project_id TEXT,
  created_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ,
  experiment_count BIGINT
)
LANGUAGE sql STABLE
AS $$
  SELECT
    d.id, d.parent_direction_id, d.spawned_from_experiment_id,
    d.program, d.title, d.question, d.context, d.status, d.source, d.project_id,
    d.created_at, d.updated_at,
    (SELECT count(*) FROM experiments e WHERE e.direction_id = d.id)
  FROM directions d
  WHERE d.parent_direction_id = dir_id
  ORDER BY d.created_at;
$$;

GRANT EXECUTE ON FUNCTION get_direction_children(TEXT) TO authenticated;

NOTIFY pgrst, 'reload schema';
