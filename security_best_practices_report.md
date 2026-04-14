# Security Best Practices Audit

Branch audited: `codex/fix-ipv6-local-agent-detection`  
Audit date: `2026-04-13`  
Scope: first-party code and current worktree state in `cli/`, `ui/`, `server/src`, `supabase/`, `.github/`, `server/scripts`, `scripts/`, `Dockerfile`, and `Makefile`

This review used the `security-best-practices` guidance where it applied cleanly:
- React / TypeScript frontend security guidance for `ui/`
- General browser/frontend security guidance for client-side sinks and redirects

Unsupported repo areas such as the Click CLI, Hono server, Supabase SQL/RLS, and deployment workflows were reviewed manually using secure-by-default standards.

## Findings

### SBP-001 — Critical — Workspace-local plaintext secrets in `server/.env`
- Severity: Critical
- Location:
  - [server/.env](/Users/mlee27/code/sonde/server/.env:5)
  - [server/.env](/Users/mlee27/code/sonde/server/.env:6)
  - [server/.env](/Users/mlee27/code/sonde/server/.env:9)
  - [server/.env](/Users/mlee27/code/sonde/server/.env:14)
  - [server/example.env](/Users/mlee27/code/sonde/server/example.env:1)
  - [server/example.env](/Users/mlee27/code/sonde/server/example.env:9)
- Evidence:
  - The current workspace contains non-empty live-looking credentials in `server/.env`, including a Daytona API key and GitHub token, plus Supabase project values.
  - The checked-in example explicitly says `Copy to .env in this directory (never commit .env).`
- Impact:
  - Anyone with local workspace access, shell history access, backup access, or accidental file sharing can recover active credentials.
  - If any of these values are already reused elsewhere, compromise can extend beyond this repo.
- Recommended fix:
  - Rotate every non-empty secret currently present in `server/.env`.
  - Replace the file with a freshly generated local-only `.env` using new credentials.
  - Keep secrets in a secret manager or per-user env injection flow instead of leaving live keys in long-lived plaintext files.
  - Add a local secret scan to pre-push or CI for defense in depth, even though `.env` is gitignored.
- False-positive note:
  - `server/.env` is currently gitignored and not tracked, so this is a workspace-state issue rather than a committed-source leak. It is still a real exposure because the audit scope included the current repo state.

### SBP-002 — High — Program-scoped principals can hard-delete core records and attached artifacts
- Severity: High
- Location:
  - [supabase/migrations/20260329000012_security_hardening.sql](/Users/mlee27/code/sonde/supabase/migrations/20260329000012_security_hardening.sql:13)
  - [supabase/migrations/20260329000012_security_hardening.sql](/Users/mlee27/code/sonde/supabase/migrations/20260329000012_security_hardening.sql:17)
  - [supabase/migrations/20260329000012_security_hardening.sql](/Users/mlee27/code/sonde/supabase/migrations/20260329000012_security_hardening.sql:21)
  - [supabase/migrations/20260329000012_security_hardening.sql](/Users/mlee27/code/sonde/supabase/migrations/20260329000012_security_hardening.sql:25)
  - [supabase/migrations/20260329000012_security_hardening.sql](/Users/mlee27/code/sonde/supabase/migrations/20260329000012_security_hardening.sql:45)
  - [supabase/migrations/20260401000006_projects_rls.sql](/Users/mlee27/code/sonde/supabase/migrations/20260401000006_projects_rls.sql:18)
  - [cli/src/sonde/db/experiments/maintenance.py](/Users/mlee27/code/sonde/cli/src/sonde/db/experiments/maintenance.py:13)
  - [cli/src/sonde/db/findings.py](/Users/mlee27/code/sonde/cli/src/sonde/db/findings.py:127)
  - [cli/src/sonde/db/directions.py](/Users/mlee27/code/sonde/cli/src/sonde/db/directions.py:86)
  - [cli/src/sonde/db/questions.py](/Users/mlee27/code/sonde/cli/src/sonde/db/questions.py:91)
  - [cli/src/sonde/db/projects.py](/Users/mlee27/code/sonde/cli/src/sonde/db/projects.py:71)
- Evidence:
  - Core tables grant `FOR DELETE USING (program = ANY(user_programs()))`, which means any authenticated principal with that program scope can delete rows directly.
  - The CLI exposes real destructive flows that immediately delete experiments, findings, directions, questions, projects, and linked artifacts.
- Impact:
  - A compromised agent token or a mistaken same-program human/agent action can irreversibly remove research records and evidence, not just mutate them.
  - This is broader than admin-only maintenance; it is ordinary program-scope authorization.
- Recommended fix:
  - Restrict hard delete to admins only, or move destructive actions behind privileged RPCs with explicit authorization checks.
  - Prefer soft delete / tombstones plus an admin restore path for experiments, findings, directions, questions, projects, and artifacts.
  - Preserve full pre-delete snapshots or immutable delete logs so recovery does not depend on database restore alone.
- False-positive note:
  - This may be intentional product policy for now, but it is still a meaningful authorization risk because destructive power is granted to every scoped principal, not just elevated operators.

### SBP-003 — Low — Hosted server always trusts localhost browser origins for CORS
- Severity: Low
- Location:
  - [server/src/app.ts](/Users/mlee27/code/sonde/server/src/app.ts:22)
  - [server/src/app.ts](/Users/mlee27/code/sonde/server/src/app.ts:135)
  - [server/src/app.ts](/Users/mlee27/code/sonde/server/src/app.ts:150)
  - [server/src/app.ts](/Users/mlee27/code/sonde/server/src/app.ts:159)
- Evidence:
  - `LOCAL_UI_ORIGINS` hardcodes multiple `localhost` and `127.0.0.1` origins.
  - `getAllowedOrigins()` always unions those with configured origins, and the result is used for hosted `/chat`, `/mcp/*`, and `/github/*` CORS with `credentials: true`.
- Impact:
  - This expands the trusted browser-origin surface on every deployment, including hosted environments that do not need local browser access.
  - Today this is partially mitigated because the server relies on bearer tokens rather than ambient cookie auth, but it is still unnecessary attack surface and makes future auth changes easier to get wrong.
- Recommended fix:
  - Gate localhost origins to development/test only.
  - In staging/production, require all allowed origins to come from explicit configuration.
- False-positive note:
  - I did not find a direct bearer-token theft path from this alone. This is a hardening finding, not a confirmed auth bypass.

### SBP-004 — Low — Predictable fallback secrets are used outside strict environments
- Severity: Low
- Location:
  - [server/src/security-config.ts](/Users/mlee27/code/sonde/server/src/security-config.ts:26)
  - [server/src/security-config.ts](/Users/mlee27/code/sonde/server/src/security-config.ts:35)
  - [server/src/security-config.ts](/Users/mlee27/code/sonde/server/src/security-config.ts:105)
  - [server/src/ws-session-token.ts](/Users/mlee27/code/sonde/server/src/ws-session-token.ts:41)
- Evidence:
  - `getWsTokenSecret()` falls back to the static string `sonde-dev-ws-token-secret` outside staging/production.
  - `getRuntimeAuditToken()` falls back to `sonde-dev-runtime-audit-token` outside staging/production.
- Impact:
  - Any internet-exposed dev or preview deployment that forgets to set explicit secrets inherits guessable defaults for protected flows.
  - For the WebSocket path, a party that knows the fallback secret can forge pre-upgrade session tokens for that environment.
- Recommended fix:
  - Remove default secrets entirely, or only allow them when the server is bound to loopback during local development.
  - Fail closed whenever the server is reachable beyond local-only development.
- False-positive note:
  - Staging and production are already guarded by `assertSecurityConfig()`, so this is a preview/dev hardening issue rather than a production bug when environment classification is correct.

## Verified Strengths

These controls looked solid in the current branch and lowered risk materially:

- Safe auth redirect handling rejects off-site redirects and protocol-relative paths in [ui/src/lib/auth-redirect.ts](/Users/mlee27/code/sonde/ui/src/lib/auth-redirect.ts:1).
- The hosted UI config sets strong response headers, including CSP, HSTS, `X-Frame-Options`, and `Referrer-Policy`, in [ui/vercel.ts](/Users/mlee27/code/sonde/ui/vercel.ts:29).
- The server verifies access tokens with `supabase.auth.getUser(accessToken)` before trusting user identity, instead of relying on locally decoded claims alone, in [server/src/auth.ts](/Users/mlee27/code/sonde/server/src/auth.ts:60).
- Test-only auth bypass is guarded so it cannot be enabled outside `NODE_ENV=test` in [server/src/security-config.ts](/Users/mlee27/code/sonde/server/src/security-config.ts:95).

## Recommended Next Steps

1. Rotate and remove all live secrets currently present in `server/.env`.
2. Narrow hard-delete permissions and add soft-delete or restore-safe tombstones for core research records and artifacts.
3. Restrict localhost CORS origins to local development only.
4. Remove predictable fallback secrets for non-strict environments, or make them loopback-only.

