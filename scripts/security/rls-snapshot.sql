-- RLS snapshot probe for the Sonde audit harness.
--
-- Run against a fresh local Supabase (`supabase start`) that has all
-- migrations applied. Dumps:
--   1. every policy on public + storage schemas (with qualifier + check)
--   2. public tables where RLS is disabled
--   3. public tables that have RLS enabled but zero policies (deny-all)
--   4. policies whose `qual` or `with_check` is literally `true`
--   5. SECURITY DEFINER functions and grants on sensitive RPCs
--
-- Usage (from repo root):
--   docker exec -i supabase_db_sonde \
--     psql -U postgres -d postgres -f - < scripts/security/rls-snapshot.sql
--   # or pipe to a file:
--   docker exec supabase_db_sonde \
--     psql -U postgres -d postgres -f /dev/stdin \
--     < scripts/security/rls-snapshot.sql > snapshot.txt

\echo '============================================================'
\echo '1. ALL POLICIES (public + storage)'
\echo '============================================================'
SELECT schemaname, tablename, policyname, cmd, roles, qual, with_check
FROM pg_policies
WHERE schemaname IN ('public', 'storage')
ORDER BY schemaname, tablename, cmd, policyname;

\echo ''
\echo '============================================================'
\echo '2. PUBLIC TABLES WITH RLS DISABLED'
\echo '============================================================'
SELECT c.relname AS tablename,
       c.relrowsecurity AS rls_enabled,
       c.relforcerowsecurity AS rls_forced
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public'
  AND c.relkind = 'r'
  AND c.relrowsecurity IS FALSE
ORDER BY c.relname;

\echo ''
\echo '============================================================'
\echo '3. PUBLIC TABLES WITH RLS ENABLED BUT ZERO POLICIES'
\echo '(deny-all — only accessible via SECURITY DEFINER funcs)'
\echo '============================================================'
SELECT c.relname AS tablename
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public'
  AND c.relkind = 'r'
  AND c.relrowsecurity IS TRUE
  AND NOT EXISTS (
    SELECT 1 FROM pg_policies p
    WHERE p.schemaname = 'public' AND p.tablename = c.relname
  )
ORDER BY c.relname;

\echo ''
\echo '============================================================'
\echo '4. POLICIES WITH qual = true OR with_check = true'
\echo '(may be intentional for append-only or read-any — review each)'
\echo '============================================================'
SELECT schemaname, tablename, policyname, cmd,
       qual, with_check
FROM pg_policies
WHERE schemaname IN ('public', 'storage')
  AND (qual = 'true' OR with_check = 'true')
ORDER BY schemaname, tablename, policyname;

\echo ''
\echo '============================================================'
\echo '5. SECURITY DEFINER FUNCTIONS IN PUBLIC'
\echo '(run with creator privileges — audit each for auth bypass)'
\echo '============================================================'
SELECT p.proname,
       pg_catalog.pg_get_function_identity_arguments(p.oid) AS args,
       p.prosecdef AS security_definer
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.prosecdef IS TRUE
ORDER BY p.proname;

\echo ''
\echo '============================================================'
\echo '6. SENSITIVE RPC EXECUTE GRANTS'
\echo '(review PUBLIC/anon grants on RPCs that bypass table RLS)'
\echo '============================================================'
SELECT routine_name, grantee, privilege_type
FROM information_schema.routine_privileges
WHERE routine_schema = 'public'
  AND routine_name IN (
    'create_agent_token',
    'record_auth_event',
    'get_db_sizes',
    'capture_db_snapshot'
  )
ORDER BY routine_name, grantee;
