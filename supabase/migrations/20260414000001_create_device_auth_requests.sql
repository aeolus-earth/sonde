-- Device-style CLI login activation requests.
-- Browser approval happens through the hosted Sonde UI; the agent server stores
-- pending requests and hands the completed Supabase session back to the CLI.

CREATE TABLE device_auth_requests (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    device_code_hash TEXT NOT NULL UNIQUE,
    user_code_hash TEXT NOT NULL UNIQUE,
    status TEXT NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'approved', 'denied', 'consumed', 'expired')),
    cli_version TEXT,
    host_label TEXT,
    remote_hint BOOLEAN NOT NULL DEFAULT FALSE,
    login_method TEXT,
    request_metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    session_ciphertext TEXT,
    approved_by_user_id UUID,
    approved_by_email TEXT,
    deny_reason TEXT,
    poll_interval_seconds INTEGER NOT NULL DEFAULT 5 CHECK (poll_interval_seconds > 0),
    poll_attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (poll_attempt_count >= 0),
    requested_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    expires_at TIMESTAMPTZ NOT NULL,
    approved_at TIMESTAMPTZ,
    denied_at TIMESTAMPTZ,
    consumed_at TIMESTAMPTZ,
    last_poll_at TIMESTAMPTZ
);

CREATE INDEX idx_device_auth_requests_status_expires
    ON device_auth_requests (status, expires_at);

CREATE INDEX idx_device_auth_requests_requested_at
    ON device_auth_requests (requested_at DESC);

ALTER TABLE device_auth_requests ENABLE ROW LEVEL SECURITY;

-- No RLS policies: browser and CLI never read this table directly.
