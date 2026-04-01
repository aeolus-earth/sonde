import { useEffect } from "react";
import { createRoute, useNavigate } from "@tanstack/react-router";
import { Route as rootRoute } from "../__root";
import { supabase } from "@/lib/supabase";
import { safeAuthRedirect } from "@/lib/auth-redirect";
import { Spinner } from "@/components/ui/spinner";

function AuthCallbackPage() {
  const navigate = useNavigate();

  useEffect(() => {
    let alive = true;

    void (async () => {
      const params = new URLSearchParams(window.location.search);
      const stored = sessionStorage.getItem("sonde-post-login");
      sessionStorage.removeItem("sonde-post-login");
      const next = safeAuthRedirect(
        stored ?? params.get("redirect") ?? undefined
      );

      const code = params.get("code");
      const oauthError =
        params.get("error_description") || params.get("error");

      if (oauthError) {
        if (!alive) return;
        navigate({
          to: "/login",
          search: { error: oauthError },
          replace: true,
        });
        return;
      }

      const finish = async () => {
        let {
          data: { session },
          error,
        } = await supabase.auth.getSession();

        if (!session && code) {
          const exchanged = await supabase.auth.exchangeCodeForSession(code);
          if (exchanged.data.session) {
            session = exchanged.data.session;
          } else if (exchanged.error) {
            const again = await supabase.auth.getSession();
            session = again.data.session;
            error = again.error ?? exchanged.error;
          }
        }

        if (!alive) return;
        if (error) {
          navigate({
            to: "/login",
            search: { error: error.message },
            replace: true,
          });
          return;
        }
        if (session) {
          navigate({ href: next, replace: true });
          return;
        }
        await new Promise((r) => setTimeout(r, 150));
        const {
          data: { session: retry },
          error: err2,
        } = await supabase.auth.getSession();
        if (!alive) return;
        if (err2) {
          navigate({
            to: "/login",
            search: { error: err2.message },
            replace: true,
          });
          return;
        }
        if (retry) {
          navigate({ href: next, replace: true });
        } else {
          navigate({
            to: "/login",
            search: {
              error: "Sign-in did not complete. Use an @aeolus.earth Google account.",
            },
            replace: true,
          });
        }
      };

      await finish();
    })();

    return () => {
      alive = false;
    };
  }, [navigate]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-bg">
      <div className="flex flex-col items-center gap-3 text-text-secondary">
        <Spinner className="h-8 w-8" />
        <p className="text-[13px]">Signing you in…</p>
      </div>
    </div>
  );
}

export const Route = createRoute({
  getParentRoute: () => rootRoute,
  path: "/auth/callback",
  component: AuthCallbackPage,
});
