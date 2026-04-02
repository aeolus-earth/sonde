-- Auth events: tracks CLI logins, logouts, and token usage.
-- Separate from activity_log because auth events are not record-scoped.

CREATE TABLE auth_events (
    id BIGSERIAL PRIMARY KEY,
    event_type TEXT NOT NULL CHECK (event_type IN ('login', 'logout', 'token_auth')),
    actor TEXT NOT NULL,            -- "human/mason" or "agent/codex-weather"
    actor_email TEXT,               -- nullable, only for humans
    actor_name TEXT,                -- nullable
    user_id TEXT,                   -- Supabase auth.users UUID
    programs TEXT[],                -- programs available at auth time
    client_version TEXT,            -- CLI version, e.g. "0.1.0"
    details JSONB NOT NULL DEFAULT '{}',  -- extra context (remote login, token name, etc.)
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_auth_events_created ON auth_events (created_at DESC);
CREATE INDEX idx_auth_events_actor ON auth_events (actor);

-- RLS: only authenticated users can read (admin guard is in the app layer)
ALTER TABLE auth_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "auth_events_select" ON auth_events
    FOR SELECT TO authenticated USING (true);

-- INSERT: any authenticated user can log their own auth event
CREATE POLICY "auth_events_insert" ON auth_events
    FOR INSERT TO authenticated WITH CHECK (true);
