# OAuth: CLI vs web UI

Sonde uses one Supabase project and Google OAuth for both the CLI and the web UI, but there are two distinct CLI login transports:

- Hosted activation as the standard `sonde login` flow.
- Loopback PKCE as the explicit `--method loopback` fallback.

## Two flows

| Surface | Redirect after Google | Callback path | Implementation |
|--------|------------------------|---------------|----------------|
| **CLI** (`sonde login`) | `{origin}/activate/callback` | `/activate/callback` on the hosted Sonde UI | [`cli/src/sonde/auth.py`](../cli/src/sonde/auth.py), [`server/src/device-auth.ts`](../server/src/device-auth.ts), [`ui/src/routes/activate.tsx`](../ui/src/routes/activate.tsx) |
| **CLI** (`sonde login --method loopback`) | `http://localhost:{port}/callback` | `/callback` on the machine running the CLI | [`cli/src/sonde/auth.py`](../cli/src/sonde/auth.py) |
| **Web UI** | `{origin}/auth/callback` | `/auth/callback` on the app origin | [`ui/src/stores/auth.ts`](../ui/src/stores/auth.ts), [`ui/src/routes/auth/callback.tsx`](../ui/src/routes/auth/callback.tsx) |

Both browser-facing Google authorization URLs keep the `hd=aeolus.earth` workspace hint.

## Standard CLI login

`sonde login` now uses the hosted activation flow by default:

```text
$ sonde login
Open Sonde activation
Enter code: ABCD-EFGH
Waiting for authorization...
```

The user opens the hosted Sonde link in any browser, signs in, approves the request, and the CLI finishes without any localhost callback or SSH port forwarding.

`sonde login --remote` remains as a compatibility alias for the hosted activation flow.

## Loopback fallback

`sonde login --method loopback` still uses a random localhost callback URL:

- `http://localhost:*/callback`
- optionally `http://127.0.0.1:*/callback`

Those redirect patterns must stay allowlisted in Supabase for local desktop login and break-glass troubleshooting.

If `AEOLUS_SUPABASE_URL` points at a local or alternate Supabase project, configure the matching hosted Sonde origin with `SONDE_UI_URL` or `SONDE_AGENT_HTTP_BASE`. Otherwise the CLI will stop with guidance instead of silently falling back to localhost.

## Supabase redirect checklist

Production and staging Supabase projects should allow all three callback families:

1. CLI loopback fallback: `http://localhost:*/callback`
2. Hosted CLI activation: `https://<your-ui-origin>/activate/callback`
3. Web UI auth: `https://<your-ui-origin>/auth/callback`

See [Web UI auth deploy](../ui/docs/auth-deploy.md) for the hosted browser callback setup.
