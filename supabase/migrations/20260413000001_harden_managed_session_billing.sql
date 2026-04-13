-- Harden managed session billing access, pricing auditability, and error sampling.

CREATE OR REPLACE FUNCTION public.is_sonde_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT coalesce(
        (auth.jwt() -> 'app_metadata' ->> 'is_admin')::boolean,
        (auth.jwt() -> 'app_metadata' ->> 'isAdmin')::boolean,
        false
    );
$$;

ALTER TABLE managed_sessions
    ADD COLUMN IF NOT EXISTS pricing_version TEXT NOT NULL DEFAULT 'anthropic-2026-04',
    ADD COLUMN IF NOT EXISTS pricing_source TEXT NOT NULL DEFAULT 'anthropic-published-pricing';

ALTER TABLE managed_session_cost_samples
    ADD COLUMN IF NOT EXISTS pricing_version TEXT NOT NULL DEFAULT 'anthropic-2026-04',
    ADD COLUMN IF NOT EXISTS pricing_source TEXT NOT NULL DEFAULT 'anthropic-published-pricing';

ALTER TABLE managed_session_cost_samples
    DROP CONSTRAINT IF EXISTS managed_session_cost_samples_sample_type_check;

ALTER TABLE managed_session_cost_samples
    ADD CONSTRAINT managed_session_cost_samples_sample_type_check
    CHECK (sample_type IN ('idle', 'archive', 'delete', 'reconcile', 'error'));

DROP POLICY IF EXISTS "managed_sessions_select" ON managed_sessions;
DROP POLICY IF EXISTS "managed_session_cost_samples_select" ON managed_session_cost_samples;
DROP POLICY IF EXISTS "managed_session_events_select" ON managed_session_events;
DROP POLICY IF EXISTS "anthropic_cost_sync_runs_select" ON anthropic_cost_sync_runs;
DROP POLICY IF EXISTS "anthropic_cost_buckets_select" ON anthropic_cost_buckets;
DROP POLICY IF EXISTS "anthropic_cost_sync_runs_insert" ON anthropic_cost_sync_runs;
DROP POLICY IF EXISTS "anthropic_cost_sync_runs_update" ON anthropic_cost_sync_runs;
DROP POLICY IF EXISTS "anthropic_cost_buckets_insert" ON anthropic_cost_buckets;

CREATE POLICY "managed_sessions_admin_select" ON managed_sessions
    FOR SELECT TO authenticated USING (public.is_sonde_admin());

CREATE POLICY "managed_session_cost_samples_admin_select" ON managed_session_cost_samples
    FOR SELECT TO authenticated USING (public.is_sonde_admin());

CREATE POLICY "managed_session_events_admin_select" ON managed_session_events
    FOR SELECT TO authenticated USING (public.is_sonde_admin());

CREATE POLICY "anthropic_cost_sync_runs_admin_select" ON anthropic_cost_sync_runs
    FOR SELECT TO authenticated USING (public.is_sonde_admin());

CREATE POLICY "anthropic_cost_sync_runs_admin_insert" ON anthropic_cost_sync_runs
    FOR INSERT TO authenticated WITH CHECK (public.is_sonde_admin());

CREATE POLICY "anthropic_cost_sync_runs_admin_update" ON anthropic_cost_sync_runs
    FOR UPDATE TO authenticated USING (public.is_sonde_admin())
    WITH CHECK (public.is_sonde_admin());

CREATE POLICY "anthropic_cost_buckets_admin_select" ON anthropic_cost_buckets
    FOR SELECT TO authenticated USING (public.is_sonde_admin());

CREATE POLICY "anthropic_cost_buckets_admin_insert" ON anthropic_cost_buckets
    FOR INSERT TO authenticated WITH CHECK (
        public.is_sonde_admin()
        AND EXISTS (
            SELECT 1
            FROM anthropic_cost_sync_runs runs
            WHERE runs.id = sync_run_id
        )
    );
