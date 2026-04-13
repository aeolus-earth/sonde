-- Managed session telemetry, cost estimation, and provider reconciliation cache

CREATE TABLE managed_sessions (
    session_id TEXT PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    user_email TEXT,
    environment TEXT NOT NULL,
    source TEXT NOT NULL CHECK (source IN ('prewarm', 'chat', 'resume')),
    provider TEXT NOT NULL DEFAULT 'anthropic',
    model TEXT,
    anthropic_environment_id TEXT,
    anthropic_agent_id TEXT,
    repo_mounted BOOLEAN NOT NULL DEFAULT FALSE,
    status TEXT NOT NULL DEFAULT 'prewarmed' CHECK (
        status IN ('prewarmed', 'active', 'idle', 'awaiting_approval', 'archived', 'deleted', 'error')
    ),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    first_turn_at TIMESTAMPTZ,
    last_activity_at TIMESTAMPTZ,
    last_idle_at TIMESTAMPTZ,
    archived_at TIMESTAMPTZ,
    deleted_at TIMESTAMPTZ,
    archive_reason TEXT,
    delete_reason TEXT,
    turn_count INTEGER NOT NULL DEFAULT 0,
    tool_call_count INTEGER NOT NULL DEFAULT 0,
    approval_count INTEGER NOT NULL DEFAULT 0,
    last_error_code TEXT,
    last_error_message TEXT,
    last_request_id TEXT,
    input_tokens BIGINT NOT NULL DEFAULT 0,
    output_tokens BIGINT NOT NULL DEFAULT 0,
    cache_creation_tokens BIGINT NOT NULL DEFAULT 0,
    cache_read_tokens BIGINT NOT NULL DEFAULT 0,
    runtime_seconds NUMERIC(18, 3) NOT NULL DEFAULT 0,
    estimated_token_cost_usd NUMERIC(18, 6) NOT NULL DEFAULT 0,
    estimated_runtime_cost_usd NUMERIC(18, 6) NOT NULL DEFAULT 0,
    estimated_total_cost_usd NUMERIC(18, 6) NOT NULL DEFAULT 0,
    latest_usage JSONB NOT NULL DEFAULT '{}'::jsonb,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX idx_managed_sessions_user_created ON managed_sessions (user_id, created_at DESC);
CREATE INDEX idx_managed_sessions_status_activity ON managed_sessions (status, last_activity_at DESC NULLS LAST);
CREATE INDEX idx_managed_sessions_environment_created ON managed_sessions (environment, created_at DESC);
CREATE INDEX idx_managed_sessions_archived ON managed_sessions (archived_at DESC NULLS LAST);

CREATE TABLE managed_session_cost_samples (
    id BIGSERIAL PRIMARY KEY,
    session_id TEXT NOT NULL REFERENCES managed_sessions(session_id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    sample_type TEXT NOT NULL CHECK (sample_type IN ('idle', 'archive', 'delete', 'reconcile')),
    status TEXT NOT NULL,
    input_tokens BIGINT NOT NULL DEFAULT 0,
    output_tokens BIGINT NOT NULL DEFAULT 0,
    cache_creation_tokens BIGINT NOT NULL DEFAULT 0,
    cache_read_tokens BIGINT NOT NULL DEFAULT 0,
    runtime_seconds NUMERIC(18, 3) NOT NULL DEFAULT 0,
    estimated_token_cost_usd NUMERIC(18, 6) NOT NULL DEFAULT 0,
    estimated_runtime_cost_usd NUMERIC(18, 6) NOT NULL DEFAULT 0,
    estimated_total_cost_usd NUMERIC(18, 6) NOT NULL DEFAULT 0,
    usage JSONB NOT NULL DEFAULT '{}'::jsonb,
    sampled_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_managed_session_cost_samples_session ON managed_session_cost_samples (session_id, sampled_at DESC);
CREATE INDEX idx_managed_session_cost_samples_user ON managed_session_cost_samples (user_id, sampled_at DESC);

CREATE TABLE managed_session_events (
    id BIGSERIAL PRIMARY KEY,
    session_id TEXT NOT NULL REFERENCES managed_sessions(session_id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    event_type TEXT NOT NULL,
    severity TEXT NOT NULL DEFAULT 'info' CHECK (severity IN ('info', 'warn', 'error')),
    tool_name TEXT,
    tool_use_id TEXT,
    approval_id TEXT,
    request_id TEXT,
    error_code TEXT,
    error_message TEXT,
    duration_ms INTEGER,
    details JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_managed_session_events_session ON managed_session_events (session_id, created_at DESC);
CREATE INDEX idx_managed_session_events_user ON managed_session_events (user_id, created_at DESC);
CREATE INDEX idx_managed_session_events_type ON managed_session_events (event_type, created_at DESC);

CREATE TABLE anthropic_cost_sync_runs (
    id BIGSERIAL PRIMARY KEY,
    requested_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    environment TEXT NOT NULL,
    mode TEXT NOT NULL CHECK (mode IN ('provider', 'estimated_only')),
    success BOOLEAN NOT NULL DEFAULT FALSE,
    starting_at TIMESTAMPTZ NOT NULL,
    ending_at TIMESTAMPTZ NOT NULL,
    bucket_count INTEGER NOT NULL DEFAULT 0,
    total_cost_usd NUMERIC(18, 6) NOT NULL DEFAULT 0,
    error_message TEXT,
    summary JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    completed_at TIMESTAMPTZ
);

CREATE INDEX idx_anthropic_cost_sync_runs_created ON anthropic_cost_sync_runs (created_at DESC);

CREATE TABLE anthropic_cost_buckets (
    id BIGSERIAL PRIMARY KEY,
    sync_run_id BIGINT NOT NULL REFERENCES anthropic_cost_sync_runs(id) ON DELETE CASCADE,
    bucket_start TIMESTAMPTZ NOT NULL,
    bucket_end TIMESTAMPTZ NOT NULL,
    workspace_id TEXT,
    description TEXT,
    currency TEXT NOT NULL DEFAULT 'USD',
    amount_cents NUMERIC(18, 6) NOT NULL DEFAULT 0,
    amount_usd NUMERIC(18, 6) NOT NULL DEFAULT 0,
    bucket_width TEXT,
    raw JSONB NOT NULL DEFAULT '{}'::jsonb,
    synced_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_anthropic_cost_buckets_window ON anthropic_cost_buckets (bucket_start DESC, bucket_end DESC);
CREATE INDEX idx_anthropic_cost_buckets_workspace ON anthropic_cost_buckets (workspace_id, bucket_start DESC);

ALTER TABLE managed_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE managed_session_cost_samples ENABLE ROW LEVEL SECURITY;
ALTER TABLE managed_session_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE anthropic_cost_sync_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE anthropic_cost_buckets ENABLE ROW LEVEL SECURITY;

CREATE POLICY "managed_sessions_select" ON managed_sessions
    FOR SELECT TO authenticated USING (true);

CREATE POLICY "managed_sessions_insert_own" ON managed_sessions
    FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());

CREATE POLICY "managed_sessions_update_own" ON managed_sessions
    FOR UPDATE TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

CREATE POLICY "managed_session_cost_samples_select" ON managed_session_cost_samples
    FOR SELECT TO authenticated USING (true);

CREATE POLICY "managed_session_cost_samples_insert_own" ON managed_session_cost_samples
    FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());

CREATE POLICY "managed_session_events_select" ON managed_session_events
    FOR SELECT TO authenticated USING (true);

CREATE POLICY "managed_session_events_insert_own" ON managed_session_events
    FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());

CREATE POLICY "anthropic_cost_sync_runs_select" ON anthropic_cost_sync_runs
    FOR SELECT TO authenticated USING (true);

CREATE POLICY "anthropic_cost_sync_runs_insert" ON anthropic_cost_sync_runs
    FOR INSERT TO authenticated WITH CHECK (requested_by = auth.uid() OR requested_by IS NULL);

CREATE POLICY "anthropic_cost_sync_runs_update" ON anthropic_cost_sync_runs
    FOR UPDATE TO authenticated USING (requested_by = auth.uid() OR requested_by IS NULL)
    WITH CHECK (requested_by = auth.uid() OR requested_by IS NULL);

CREATE POLICY "anthropic_cost_buckets_select" ON anthropic_cost_buckets
    FOR SELECT TO authenticated USING (true);

CREATE POLICY "anthropic_cost_buckets_insert" ON anthropic_cost_buckets
    FOR INSERT TO authenticated WITH CHECK (
        EXISTS (
            SELECT 1
            FROM anthropic_cost_sync_runs runs
            WHERE runs.id = sync_run_id
              AND (runs.requested_by = auth.uid() OR runs.requested_by IS NULL)
        )
    );
