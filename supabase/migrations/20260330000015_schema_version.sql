-- Schema version tracking for CLI compatibility checks.
--
-- The CLI calls get_schema_version() on startup to verify the hosted
-- database has the features it expects.  Bump the version number at
-- the end of any migration that adds or changes an RPC, table, column,
-- or view the CLI depends on, and update MINIMUM_SCHEMA_VERSION in
-- cli/src/sonde/db/compat.py to match.

CREATE TABLE IF NOT EXISTS schema_version (
    singleton   BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK (singleton),
    version     INTEGER NOT NULL DEFAULT 1,
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Seed with version 1 (represents the full migration set through 000012).
INSERT INTO schema_version (version)
VALUES (1)
ON CONFLICT (singleton) DO NOTHING;

-- Public RPC — callable with the anon key so the check works before login.
CREATE OR REPLACE FUNCTION get_schema_version()
RETURNS INTEGER
LANGUAGE sql STABLE SECURITY DEFINER
AS $$
    SELECT version FROM schema_version WHERE singleton = TRUE;
$$;

-- Grant to both anon (pre-login compat check) and authenticated.
GRANT EXECUTE ON FUNCTION get_schema_version() TO anon, authenticated;
GRANT SELECT ON schema_version TO anon, authenticated;

NOTIFY pgrst, 'reload schema';
