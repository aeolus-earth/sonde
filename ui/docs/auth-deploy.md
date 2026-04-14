# Web UI auth (Google + Supabase)

See also: **[OAuth: CLI vs web UI](../../docs/oauth-flows.md)** (two callback URLs, VM vs hosted).

The UI uses the **same Supabase project and Google OAuth** as the Sonde CLI. Access to data is enforced by **Row Level Security** and the **`custom_access_token_hook`**, which only issues JWTs for **`@aeolus.earth`** addresses (see `supabase/migrations/`).

## Vercel (or any hosted UI): avoid redirect to localhost

**Symptom:** After “Continue with Google,” the browser opens **`http://localhost/?code=...`** and shows connection refused.

**Cause:** In Supabase, either **Redirect URLs** does not include your deployed app’s `/auth/callback`, or **Site URL** is still `http://localhost:5173`. Supabase then sends the auth `code` to localhost instead of your Vercel URL.

The app code uses `redirectTo = {window.location.origin}/auth/callback` at runtime ([`src/stores/auth.ts`](../src/stores/auth.ts)); no code change fixes this—**update Supabase (and verify Google) as below.**

### Checklist (Supabase Dashboard)

1. **Authentication → URL configuration → Redirect URLs** — add:
   - **`http://localhost:*/callback`** — required only for the explicit CLI fallback `sonde login --method loopback`; uses a random port each run. See [`docs/oauth-flows.md`](../../docs/oauth-flows.md).
   - `http://localhost:5173/auth/callback` (local Vite)
   - `https://<your-vercel-deployment>.vercel.app/auth/callback` (production or preview host; replace with your real hostname)
   - **Optional (preview builds):** `https://*.vercel.app/**` if your Supabase project accepts this wildcard (saves adding each preview URL)
2. **Authentication → URL configuration → Site URL** — set to your **canonical** deployed origin, e.g. `https://<your-vercel-deployment>.vercel.app` (no trailing slash), not only localhost, if you rely on production sign-in.

Save, then retry sign-in on the deployed site.

### Checklist (Google Cloud Console — usually already correct)

Under **APIs & Services → Credentials →** your OAuth 2.0 Client → **Authorized redirect URIs**, ensure this exists (use your real project ref from Supabase):

- `https://<project-ref>.supabase.co/auth/v1/callback`

That is Supabase’s callback, **not** the Vercel URL. If CLI `sonde login` works against the same Supabase project, this is typically already set.

### Vercel env

`VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` must match the **same** Supabase project you configured above.

### Vercel: `404 NOT_FOUND` on `/auth/callback`

OAuth is working if the browser opens `https://<your-app>.vercel.app/auth/callback?code=...` but **Vercel** shows a plain 404 (not the Sonde UI). That means the static host is not serving `index.html` for that path (SPA fallback).

- **If the Vercel project’s Root Directory is the repo root** (empty or `.`): routing is controlled by [`vercel.json`](../../vercel.json) at the **repository root** (`installCommand` / `buildCommand` / `outputDirectory` / `rewrites`).
- **If Root Directory is `ui`**: routing uses [`ui/vercel.json`](../vercel.json) only.

After changing `vercel.json` or Root Directory, **redeploy** the project.

---

## Redirect URLs (required)

In the Supabase dashboard: **Authentication → URL configuration → Redirect URLs**, add every exact URL the app uses after Google returns:

| Environment | URL |
|-------------|-----|
| Local Vite | `http://localhost:5173/auth/callback` |
| Production / hosted | `https://<your-host>/auth/callback` |

The app starts OAuth with `redirectTo` set to `{origin}/auth/callback` and **PKCE** (`flowType: "pkce"` in [`src/lib/supabase.ts`](../src/lib/supabase.ts)).

## Site URL

Set **Site URL** to your primary deployed origin (e.g. `https://app.example.com` or your Vercel URL). Do not leave **only** localhost if production OAuth must work.

## Google Cloud Console

The OAuth client’s **authorized redirect URIs** must include **Supabase’s** callback:

`https://<project-ref>.supabase.co/auth/v1/callback`

—not the Vercel app URL. Supabase exchanges the code and then redirects the browser to `{origin}/auth/callback` on your app.

## OAuth query hint (CLI parity)

The UI passes **`hd=aeolus.earth`** on the Google authorization URL (same idea as the CLI) so the account picker prefers the Aeolus Workspace domain. **Enforcement** is still server-side in the access token hook.

## Environment variables

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`

Never commit secrets; configure in CI/hosting env.
