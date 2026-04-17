-- Hosted-compatible opaque agent exchange.
--
-- Hosted Supabase projects do not expose app.settings.jwt_secret to SQL, so
-- the exchange RPC cannot sign a first-party JWT itself. Keep the database as
-- the revocation/expiry source of truth, but have the hosted server mint a
-- Supabase Auth session after this RPC validates the opaque token.

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

    UPDATE public.agent_tokens
    SET last_exchanged_at = now(),
        exchange_count = exchange_count + 1
    WHERE id = token_row.id;

    RETURN jsonb_build_object(
        'token_id', token_row.id,
        'name', token_row.name,
        'programs', to_jsonb(token_row.programs),
        'expires_at', token_row.expires_at
    );
END;
$$;

REVOKE ALL ON FUNCTION public.exchange_agent_token(text, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.exchange_agent_token(text, text, text) TO service_role;

CREATE OR REPLACE FUNCTION public.custom_access_token_hook(event jsonb)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    claims jsonb;
    app_meta jsonb;
    user_email text;
    user_programs_arr text[];
    agent_programs text[];
    is_admin boolean;
    is_agent boolean;
    token_id_text text;
    token_id uuid;
    token_name text;
BEGIN
    claims := event -> 'claims';
    app_meta := coalesce(claims -> 'app_metadata', '{}'::jsonb);
    user_email := claims ->> 'email';
    is_agent := coalesce((app_meta ->> 'agent')::boolean, false);

    -- Reject non-aeolus.earth emails (defense in depth — Google hd param is UI-only).
    IF user_email IS NOT NULL AND user_email NOT LIKE '%@aeolus.earth' THEN
        RETURN jsonb_build_object(
            'error', jsonb_build_object(
                'http_code', 403,
                'message', 'Only @aeolus.earth accounts are allowed'
            )
        );
    END IF;

    IF is_agent THEN
        token_id_text := app_meta ->> 'token_id';
        IF token_id_text IS NULL
           OR token_id_text !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
            RETURN jsonb_build_object(
                'error', jsonb_build_object(
                    'http_code', 403,
                    'message', 'Invalid or expired agent token'
                )
            );
        END IF;

        token_id := token_id_text::uuid;
        SELECT token.programs, token.name
        INTO agent_programs, token_name
        FROM public.agent_tokens token
        WHERE token.id = token_id
          AND token.revoked_at IS NULL
          AND token.expires_at > now();

        IF NOT FOUND THEN
            RETURN jsonb_build_object(
                'error', jsonb_build_object(
                    'http_code', 403,
                    'message', 'Invalid or expired agent token'
                )
            );
        END IF;

        claims := jsonb_set(
            claims,
            '{app_metadata}',
            app_meta ||
            jsonb_build_object(
                'agent', true,
                'programs', to_jsonb(agent_programs),
                'is_admin', false,
                'token_id', token_id,
                'token_name', token_name,
                'agent_name', token_name
            )
        );

        event := jsonb_set(event, '{claims}', claims);
        RETURN event;
    END IF;

    -- Look up human user's live program assignments.
    SELECT
        coalesce(array_agg(up.program), ARRAY['shared']),
        coalesce(bool_or(up.role = 'admin'), false)
    INTO user_programs_arr, is_admin
    FROM public.user_programs up
    WHERE up.user_id = (claims ->> 'sub')::uuid;

    -- New humans with no assignments get 'shared' by default.
    IF user_programs_arr IS NULL OR user_programs_arr = '{}' THEN
        user_programs_arr := ARRAY['shared'];
        is_admin := false;
    END IF;

    claims := jsonb_set(
        claims,
        '{app_metadata}',
        app_meta ||
        jsonb_build_object(
            'programs', to_jsonb(user_programs_arr),
            'is_admin', is_admin
        )
    );

    event := jsonb_set(event, '{claims}', claims);
    RETURN event;
END;
$$;

GRANT USAGE ON SCHEMA public TO supabase_auth_admin;
GRANT EXECUTE ON FUNCTION public.custom_access_token_hook(jsonb) TO supabase_auth_admin;
GRANT SELECT ON TABLE public.user_programs TO supabase_auth_admin;
GRANT SELECT ON TABLE public.agent_tokens TO supabase_auth_admin;
REVOKE EXECUTE ON FUNCTION public.custom_access_token_hook(jsonb) FROM authenticated, anon, public;

UPDATE public.schema_version
SET version = GREATEST(version, 5),
    updated_at = now()
WHERE singleton = TRUE;
