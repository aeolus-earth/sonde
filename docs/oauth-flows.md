# OAuth: CLI vs web UI

Sonde uses **one Supabase project** and **Google OAuth** for both the CLI and the Vite web app. The **callback URLs differ by design** — they cannot be merged into a single redirect without a different product (for example device-code flow).

## Two flows

| Surface | Redirect after Google | Callback path | Implementation |
|--------|------------------------|---------------|----------------|
| **CLI** (`sonde login`) | `http://127.0.0.1:{port}/callback` | `/callback` on the machine running the CLI | [`cli/src/sonde/auth.py`](../cli/src/sonde/auth.py) — local HTTP server + `exchange_code_for_session` |
| **Web UI** | `{origin}/auth/callback` | `/auth/callback` on the app origin | [`ui/src/stores/auth.ts`](../ui/src/stores/auth.ts), [`ui/src/routes/auth/callback.tsx`](../ui/src/routes/auth/callback.tsx) — PKCE in the browser |

Both pass **`hd=aeolus.earth`** on the Google authorization URL (workspace hint). Enforcement remains server-side (access token hook / RLS).

**VM / SSH:** If you run `sonde login` on a remote machine, the browser must reach the **same** loopback port where the CLI listens (browser on the machine, or `ssh -L` port forwarding). The CLI prints that guidance when `SSH_CONNECTION` is set.

**Do not confuse flows:** A URL like `https://*.vercel.app/auth/callback?code=...` is the **web UI** flow. The CLI never uses `/auth/callback` on Vercel.

## Vercel: `404 NOT_FOUND` on `/auth/callback`

If the browser shows a **plain Vercel 404** (not the Sonde UI) at `/auth/callback?code=...`, OAuth already returned a `code`; the failure is **static hosting / SPA routing**. The app bundle never loads, so the client cannot exchange the code.

**Checklist:**

1. **Root Directory** in the Vercel project must match where `vercel.json` applies:
   - **Repository root** as deploy root: use root [`vercel.json`](../vercel.json) (`outputDirectory: ui/dist`, `rewrites` → `/index.html`).
   - **Root Directory = `ui`**: use [`ui/vercel.json`](../ui/vercel.json) (same SPA rewrite).
2. **Redeploy** after changing Root Directory or `vercel.json`.
3. Confirm `GET /auth/callback` returns `200` with `index.html` (not 404).

## Supabase: redirect URLs

**Checklist:**

1. **Authentication → URL configuration → Redirect URLs** — include every origin you use (`localhost` for Vite, production hostname, and preview hosts or a supported wildcard). See [Web UI auth deploy (detailed)](../ui/docs/auth-deploy.md).
2. **Site URL** — set to your **canonical** deployed origin when production sign-in matters, not only localhost.

Full dashboard steps and Google Cloud Console notes: [`ui/docs/auth-deploy.md`](../ui/docs/auth-deploy.md).
