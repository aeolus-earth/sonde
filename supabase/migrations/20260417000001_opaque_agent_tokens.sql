-- Opaque agent tokens: stop issuing password-bearing bot token bundles.
--
-- New agent credentials are opaque one-time secrets. The database stores
-- only a SHA-256 hash and mints short-lived JWTs through a service-role-only
-- exchange RPC. Revocation and expiry remain enforced by user_programs().

ALTER TABLE public.agent_tokens
    ADD COLUMN IF NOT EXISTS token_hash text,
    ADD COLUMN IF NOT EXISTS token_prefix text,
    ADD COLUMN IF NOT EXISTS token_preview text,
    ADD COLUMN IF NOT EXISTS last_exchanged_at timestamptz,
    ADD COLUMN IF NOT EXISTS exchange_count integer NOT NULL DEFAULT 0;

CREATE UNIQUE INDEX IF NOT EXISTS agent_tokens_token_hash_key
    ON public.agent_tokens (token_hash)
    WHERE token_hash IS NOT NULL;

ALTER TABLE public.agent_tokens
    ADD CONSTRAINT agent_tokens_token_hash_hex
    CHECK (token_hash IS NULL OR token_hash ~ '^[0-9a-f]{64}$');

ALTER TABLE public.agent_tokens
    ADD CONSTRAINT agent_tokens_exchange_count_nonnegative
    CHECK (exchange_count >= 0);

-- Hard cutoff: pre-existing rows do not have an opaque-token hash and were
-- created by previous token models. Mark them revoked so old direct JWTs lose
-- RLS access. Password-bundle CLI support is also removed in this release.
UPDATE public.agent_tokens
SET revoked_at = coalesce(revoked_at, now())
WHERE token_hash IS NULL;

DROP POLICY IF EXISTS "agent_tokens_admin_insert" ON public.agent_tokens;
CREATE POLICY "agent_tokens_admin_insert" ON public.agent_tokens
    FOR INSERT TO authenticated
    WITH CHECK (
        created_by = auth.uid()
        AND public.can_admin_programs(programs)
        AND token_hash IS NOT NULL
        AND token_prefix = 'sonde_ak_'
        AND token_preview IS NOT NULL
        AND expires_at > now()
        AND expires_at <= now() + interval '365 days' + interval '15 minutes'
    );

CREATE OR REPLACE FUNCTION public.exchange_agent_token(
    p_token_hash text,
    p_cli_version text DEFAULT NULL,
    p_host_label text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    token_row public.agent_tokens%rowtype;
    exchange_expires_at timestamptz;
    jwt_payload json;
    signed_jwt text;
    expires_in_seconds integer;
BEGIN
    IF p_token_hash IS NULL OR p_token_hash !~ '^[0-9a-f]{64}$' THEN
        RAISE EXCEPTION 'Invalid or expired agent token' USING ERRCODE = '42501';
    END IF;

    SELECT *
    INTO token_row
    FROM public.agent_tokens
    WHERE token_hash = p_token_hash
      AND revoked_at IS NULL
      AND expires_at > now()
    LIMIT 1;

    IF token_row.id IS NULL THEN
        RAISE EXCEPTION 'Invalid or expired agent token' USING ERRCODE = '42501';
    END IF;

    exchange_expires_at := least(token_row.expires_at, now() + interval '15 minutes');
    expires_in_seconds := greatest(
        1,
        floor(extract(epoch FROM exchange_expires_at - now()))::integer
    );

    jwt_payload := json_build_object(
        'sub', token_row.id,
        'role', 'authenticated',
        'aud', 'authenticated',
        'iss', 'sonde-agent-exchange',
        'iat', extract(epoch FROM now())::integer,
        'exp', extract(epoch FROM exchange_expires_at)::integer,
        'app_metadata', json_build_object(
            'programs', to_json(token_row.programs),
            'agent', true,
            'token_id', token_row.id,
            'token_name', token_row.name,
            'agent_name', token_row.name
        ),
        'user_metadata', json_build_object(
            'agent_name', token_row.name
        )
    );

    SELECT extensions.sign(jwt_payload, current_setting('app.settings.jwt_secret'))
    INTO signed_jwt;

    UPDATE public.agent_tokens
    SET last_exchanged_at = now(),
        exchange_count = exchange_count + 1
    WHERE id = token_row.id;

    RETURN jsonb_build_object(
        'access_token', signed_jwt,
        'token_type', 'bearer',
        'expires_in', expires_in_seconds,
        'expires_at', exchange_expires_at,
        'token_id', token_row.id,
        'programs', to_jsonb(token_row.programs)
    );
END;
$$;

REVOKE ALL ON FUNCTION public.exchange_agent_token(text, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.exchange_agent_token(text, text, text) TO service_role;

-- The old RPC issued long-lived direct JWTs. Keep the symbol so stale clients
-- fail with an explicit migration error instead of continuing to mint them.
CREATE OR REPLACE FUNCTION public.create_agent_token(
    token_name text,
    token_programs text[],
    expires_in_days integer DEFAULT 365
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    RAISE EXCEPTION 'Direct agent-token signing is disabled. Upgrade the Sonde CLI to create opaque agent tokens.'
        USING ERRCODE = '0A000';
END;
$$;

REVOKE ALL ON FUNCTION public.create_agent_token(text, text[], integer) FROM PUBLIC, anon, authenticated;

UPDATE public.schema_version
SET version = GREATEST(version, 4),
    updated_at = now()
WHERE singleton = TRUE;
