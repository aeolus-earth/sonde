-- Keep human program scope live after create/grant operations.
--
-- Human sessions currently cache program membership in app_metadata.programs
-- until the JWT is refreshed. That leaves freshly created programs unreadable
-- and unwritable under RLS even though the user_programs row exists.
--
-- Agents stay JWT-scoped so token revocation and per-token program scope keep
-- working as designed.

CREATE OR REPLACE FUNCTION user_programs()
RETURNS text[]
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    jwt_programs text[];
    live_programs text[];
    is_agent boolean := coalesce((auth.jwt() -> 'app_metadata' ->> 'agent')::boolean, false);
BEGIN
    jwt_programs := coalesce(
        array(
            SELECT jsonb_array_elements_text(auth.jwt() -> 'app_metadata' -> 'programs')
        ),
        ARRAY[]::text[]
    );

    IF is_agent THEN
        IF EXISTS (
            SELECT 1 FROM agent_tokens
            WHERE id = (auth.jwt() -> 'app_metadata' ->> 'token_id')::uuid
            AND revoked_at IS NOT NULL
        ) THEN
            RETURN ARRAY[]::text[];
        END IF;

        RETURN jwt_programs;
    END IF;

    SELECT coalesce(array_agg(up.program ORDER BY up.program), ARRAY[]::text[])
    INTO live_programs
    FROM user_programs up
    WHERE up.user_id = auth.uid();

    IF live_programs <> ARRAY[]::text[] THEN
        RETURN live_programs;
    END IF;

    RETURN jwt_programs;
END;
$$;
