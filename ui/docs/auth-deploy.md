# Web UI auth (Google + Supabase)

The UI uses the **same Supabase project and Google OAuth** as the Sonde CLI. Access to data is enforced by **Row Level Security** and the **`custom_access_token_hook`**, which only issues JWTs for **`@aeolus.earth`** addresses (see `supabase/migrations/`).

## Redirect URLs (required)

In the Supabase dashboard: **Authentication → URL configuration → Redirect URLs**, add every exact URL the app uses after Google returns:

| Environment | URL |
|-------------|-----|
| Local Vite | `http://localhost:5173/auth/callback` |
| Production | `https://<your-host>/auth/callback` |

The app starts OAuth with `redirectTo` set to `{origin}/auth/callback` and **PKCE** (`flowType: "pkce"` in [`src/lib/supabase.ts`](../src/lib/supabase.ts)).

## Site URL

Set **Site URL** to your primary deployed origin (e.g. `https://app.example.com`). Local dev can keep `http://localhost:5173`.

## Google Cloud Console

The OAuth client’s **authorized redirect URIs** must include Supabase’s callback URL for your project (the same as for the CLI), not the SPA path directly—Supabase exchanges the code and then redirects the browser to `/auth/callback` on your app.

## OAuth query hint (CLI parity)

The UI passes **`hd=aeolus.earth`** on the Google authorization URL (same idea as the CLI) so the account picker prefers the Aeolus Workspace domain. **Enforcement** is still server-side in the access token hook.

## Environment variables

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`

Never commit secrets; configure in CI/hosting env.
