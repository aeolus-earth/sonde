-- Fix agent token signing on Supabase projects where pgjwt exposes sign(json, text)
-- but not sign(jsonb, text). The original RPC built a jsonb payload and called
-- extensions.sign(jsonb, text), which fails even when pgjwt is installed.

CREATE OR REPLACE FUNCTION create_agent_token(
    token_name text,
    token_programs text[],
    expires_in_days integer DEFAULT 365
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    caller_id uuid;
    is_caller_admin boolean;
    token_id uuid;
    token_sub uuid;
    expires_ts timestamptz;
    jwt_payload json;
    signed_jwt text;
BEGIN
    caller_id := auth.uid();

    SELECT bool_or(role = 'admin') INTO is_caller_admin
    FROM user_programs WHERE user_id = caller_id;

    IF NOT coalesce(is_caller_admin, false) THEN
        RAISE EXCEPTION 'Only admins can create agent tokens';
    END IF;

    IF EXISTS (
        SELECT 1 FROM unnest(token_programs) AS p
        WHERE p NOT IN (SELECT id FROM programs)
    ) THEN
        RAISE EXCEPTION 'One or more programs do not exist';
    END IF;

    token_id := gen_random_uuid();
    token_sub := gen_random_uuid();
    expires_ts := now() + (expires_in_days || ' days')::interval;

    INSERT INTO agent_tokens (id, name, programs, created_by, expires_at)
    VALUES (token_id, token_name, token_programs, caller_id, expires_ts);

    jwt_payload := json_build_object(
        'sub', token_sub,
        'role', 'authenticated',
        'aud', 'authenticated',
        'iss', 'sonde-cli',
        'iat', extract(epoch FROM now())::integer,
        'exp', extract(epoch FROM expires_ts)::integer,
        'app_metadata', json_build_object(
            'programs', to_json(token_programs),
            'agent', true,
            'token_id', token_id,
            'token_name', token_name
        )
    );

    SELECT extensions.sign(jwt_payload, current_setting('app.settings.jwt_secret'))
    INTO signed_jwt;

    RETURN jsonb_build_object(
        'token_id', token_id,
        'token', 'sonde_at_' || signed_jwt,
        'expires_at', expires_ts,
        'programs', to_jsonb(token_programs)
    );
END;
$$;
