-- Experiment tree branching: parent-child relationships, branch types, claim mechanism.
-- Pure additive — nullable columns, no existing data modified.

-- Tree structure
ALTER TABLE experiments ADD COLUMN IF NOT EXISTS parent_id TEXT REFERENCES experiments(id);
ALTER TABLE experiments ADD COLUMN IF NOT EXISTS branch_type TEXT
  CHECK (branch_type IS NULL OR branch_type IN (
    'exploratory', 'refinement', 'alternative', 'debug', 'replication'
  ));

-- Lightweight claim mechanism
ALTER TABLE experiments ADD COLUMN IF NOT EXISTS claimed_by TEXT;
ALTER TABLE experiments ADD COLUMN IF NOT EXISTS claimed_at TIMESTAMPTZ;

-- Indexes
CREATE INDEX IF NOT EXISTS idx_experiments_parent ON experiments(parent_id);
CREATE INDEX IF NOT EXISTS idx_experiments_claimed ON experiments(claimed_by)
  WHERE claimed_by IS NOT NULL;


-- ---------------------------------------------------------------------------
-- RPC: get_experiment_subtree
-- Recursive CTE walking children downward from a root.
-- Returns flat rows with a depth column.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION get_experiment_subtree(
  root_id TEXT,
  max_depth INT DEFAULT 10
)
RETURNS TABLE (
  id TEXT,
  parent_id TEXT,
  depth INT,
  status TEXT,
  branch_type TEXT,
  source TEXT,
  program TEXT,
  content TEXT,
  finding TEXT,
  tags TEXT[],
  direction_id TEXT,
  claimed_by TEXT,
  claimed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ
)
LANGUAGE sql STABLE
AS $$
  WITH RECURSIVE tree AS (
    SELECT
      e.id, e.parent_id, 0 AS depth,
      e.status, e.branch_type, e.source, e.program,
      e.content, e.finding, e.tags, e.direction_id,
      e.claimed_by, e.claimed_at, e.created_at, e.updated_at
    FROM experiments e
    WHERE e.id = root_id

    UNION ALL

    SELECT
      c.id, c.parent_id, t.depth + 1,
      c.status, c.branch_type, c.source, c.program,
      c.content, c.finding, c.tags, c.direction_id,
      c.claimed_by, c.claimed_at, c.created_at, c.updated_at
    FROM experiments c
    INNER JOIN tree t ON c.parent_id = t.id
    WHERE t.depth < max_depth
  )
  SELECT * FROM tree ORDER BY depth, created_at;
$$;


-- ---------------------------------------------------------------------------
-- RPC: get_experiment_ancestors
-- Walks parent_id upward to the root. Returns leaf-to-root order.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION get_experiment_ancestors(exp_id TEXT)
RETURNS TABLE (
  id TEXT,
  parent_id TEXT,
  depth INT,
  status TEXT,
  branch_type TEXT,
  source TEXT,
  program TEXT,
  content TEXT,
  finding TEXT,
  claimed_by TEXT,
  claimed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ
)
LANGUAGE sql STABLE
AS $$
  WITH RECURSIVE ancestors AS (
    SELECT
      e.id, e.parent_id, 0 AS depth,
      e.status, e.branch_type, e.source, e.program,
      e.content, e.finding,
      e.claimed_by, e.claimed_at, e.created_at, e.updated_at
    FROM experiments e
    WHERE e.id = exp_id

    UNION ALL

    SELECT
      p.id, p.parent_id, a.depth + 1,
      p.status, p.branch_type, p.source, p.program,
      p.content, p.finding,
      p.claimed_by, p.claimed_at, p.created_at, p.updated_at
    FROM experiments p
    INNER JOIN ancestors a ON p.id = a.parent_id
  )
  SELECT * FROM ancestors ORDER BY depth;
$$;


-- ---------------------------------------------------------------------------
-- RPC: get_experiment_siblings
-- Returns children of the same parent, excluding the given experiment.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION get_experiment_siblings(exp_id TEXT)
RETURNS SETOF experiments
LANGUAGE sql STABLE
AS $$
  SELECT s.*
  FROM experiments s
  WHERE s.parent_id = (SELECT e.parent_id FROM experiments e WHERE e.id = exp_id)
    AND s.id != exp_id
  ORDER BY s.created_at;
$$;


-- Permissions
GRANT EXECUTE ON FUNCTION get_experiment_subtree(TEXT, INT) TO authenticated;
GRANT EXECUTE ON FUNCTION get_experiment_ancestors(TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION get_experiment_siblings(TEXT) TO authenticated;

NOTIFY pgrst, 'reload schema';
