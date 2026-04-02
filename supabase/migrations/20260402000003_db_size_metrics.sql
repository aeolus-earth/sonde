-- Database size metrics for admin dashboard
-- Tracks table sizes and total DB size, with periodic snapshots for growth tracking

-- Snapshot table for historical tracking
CREATE TABLE db_size_snapshots (
    id BIGSERIAL PRIMARY KEY,
    captured_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    total_db_bytes BIGINT NOT NULL,
    table_sizes JSONB NOT NULL,      -- { "experiments": 12345, "activity_log": 67890, ... }
    storage_bytes BIGINT             -- total artifact file bytes (from artifacts.size_bytes)
);

CREATE INDEX idx_db_snapshots_captured ON db_size_snapshots (captured_at DESC);

-- Returns current table sizes (SECURITY DEFINER to access pg_class)
CREATE OR REPLACE FUNCTION get_db_sizes()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    result JSONB;
    db_total BIGINT;
    storage_total BIGINT;
BEGIN
    -- Total database size
    SELECT pg_database_size(current_database()) INTO db_total;

    -- Per-table sizes for public schema tables we care about
    SELECT jsonb_object_agg(relname, total_bytes)
    INTO result
    FROM (
        SELECT c.relname,
               pg_total_relation_size(c.oid) AS total_bytes
        FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public'
          AND c.relkind = 'r'
          AND c.relname IN (
              'experiments', 'findings', 'directions', 'questions',
              'projects', 'artifacts', 'notes', 'activity_log',
              'agent_tokens', 'user_programs', 'programs',
              'record_links', 'db_size_snapshots'
          )
        ORDER BY total_bytes DESC
    ) t;

    -- Total artifact storage (sum of file sizes)
    SELECT COALESCE(SUM(size_bytes), 0) INTO storage_total FROM artifacts;

    RETURN jsonb_build_object(
        'total_db_bytes', db_total,
        'table_sizes', COALESCE(result, '{}'::jsonb),
        'storage_bytes', storage_total,
        'captured_at', now()
    );
END;
$$;

-- Captures a snapshot, rate-limited to 1 per hour
CREATE OR REPLACE FUNCTION capture_db_snapshot()
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    last_capture TIMESTAMPTZ;
    sizes JSONB;
BEGIN
    -- Check rate limit: skip if captured within last hour
    SELECT captured_at INTO last_capture
    FROM db_size_snapshots
    ORDER BY captured_at DESC
    LIMIT 1;

    IF last_capture IS NOT NULL AND last_capture > now() - INTERVAL '1 hour' THEN
        RETURN FALSE;
    END IF;

    -- Get current sizes and insert snapshot
    sizes := get_db_sizes();

    INSERT INTO db_size_snapshots (total_db_bytes, table_sizes, storage_bytes)
    VALUES (
        (sizes->>'total_db_bytes')::BIGINT,
        sizes->'table_sizes',
        (sizes->>'storage_bytes')::BIGINT
    );

    RETURN TRUE;
END;
$$;

-- RLS: only authenticated users can read snapshots (admin guard is in the app)
ALTER TABLE db_size_snapshots ENABLE ROW LEVEL SECURITY;

CREATE POLICY "snapshots_select" ON db_size_snapshots
    FOR SELECT TO authenticated USING (true);

-- Grant execute on functions to authenticated users
GRANT EXECUTE ON FUNCTION get_db_sizes() TO authenticated;
GRANT EXECUTE ON FUNCTION capture_db_snapshot() TO authenticated;
