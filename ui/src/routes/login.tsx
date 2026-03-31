import { useEffect } from "react";
import { createRoute, redirect } from "@tanstack/react-router";
import { Route as rootRoute } from "./__root";
import { supabase } from "@/lib/supabase";
import { safeAuthRedirect } from "@/lib/auth-redirect";
import { applyThemeToDocument } from "@/lib/theme";
import { useAuthStore } from "@/stores/auth";
import { useUIStore } from "@/stores/ui";

type LoginSearch = {
  redirect?: string;
  error?: string;
};

function LoginPage() {
  const search = Route.useSearch();
  const signInWithGoogle = useAuthStore((s) => s.signInWithGoogle);
  const storeError = useAuthStore((s) => s.authError);
  const clearAuthError = useAuthStore((s) => s.clearAuthError);

  const urlError =
    search.error !== undefined
      ? (() => {
          try {
            return decodeURIComponent(String(search.error).replace(/\+/g, " "));
          } catch {
            return String(search.error);
          }
        })()
      : null;

  const displayError = urlError ?? storeError;

  useEffect(() => {
    const theme = useUIStore.getState().theme;
    const root = document.documentElement;
    root.classList.remove("dark");
    return () => {
      applyThemeToDocument(theme);
    };
  }, []);

  useEffect(() => {
    if (urlError) {
      clearAuthError();
    }
  }, [urlError, clearAuthError]);

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-bg px-4">
      <div className="w-full max-w-[380px] rounded-[10px] border border-border bg-surface px-8 py-10 shadow-sm">
        <h1 className="text-center font-display text-[2rem] font-normal leading-none tracking-[0.06em] text-text">
          Sonde
        </h1>
        <p className="mt-3 text-center text-[13px] leading-relaxed text-text-secondary">
          Sign in with your Aeolus Google account to continue.
        </p>

        {displayError && (
          <div
            role="alert"
            className="mt-5 rounded-[5.5px] border border-status-failed/30 bg-surface-raised px-3 py-2 text-[12px] text-status-failed"
          >
            {displayError}
          </div>
        )}

        <button
          type="button"
          onClick={() =>
            void signInWithGoogle({
              returnPath: search.redirect
                ? safeAuthRedirect(search.redirect)
                : undefined,
            })
          }
          className="mt-6 w-full rounded-[5.5px] bg-accent px-4 py-2.5 text-[13px] font-medium text-on-accent transition-colors hover:bg-accent-hover"
        >
          Continue with Google
        </button>

        <p className="mt-5 text-center text-[11px] text-text-quaternary">
          Only <span className="font-mono text-text-tertiary">@aeolus.earth</span> accounts
          are permitted.
        </p>
      </div>
    </div>
  );
}

export const Route = createRoute({
  getParentRoute: () => rootRoute,
  path: "/login",
  validateSearch: (search: Record<string, unknown>): LoginSearch => ({
    redirect: typeof search.redirect === "string" ? search.redirect : undefined,
    error: typeof search.error === "string" ? search.error : undefined,
  }),
  beforeLoad: async ({ search }) => {
    const {
      data: { session },
    } = await supabase.auth.getSession();
    if (session) {
      throw redirect({ href: safeAuthRedirect(search.redirect) });
    }
  },
  component: LoginPage,
});
