import { useEffect } from "react";
import { createRoute, useNavigate } from "@tanstack/react-router";
import { Route as rootRoute } from "./__root";
import { activationSupabase } from "@/lib/activation-supabase";
import { Spinner } from "@/components/ui/spinner";

const ACTIVATION_CODE_STORAGE_KEY = "sonde-activation-code";

function ActivationCallbackPage() {
  const navigate = useNavigate();

  useEffect(() => {
    let alive = true;

    void (async () => {
      const params = new URLSearchParams(window.location.search);
      const oauthError =
        params.get("error_description") || params.get("error") || "";
      const oauthCode = params.get("code") || "";
      const storedCode = sessionStorage.getItem(ACTIVATION_CODE_STORAGE_KEY) || "";
      const userCode = params.get("user_code") || storedCode;

      const redirectWithError = async (message: string) => {
        sessionStorage.removeItem(ACTIVATION_CODE_STORAGE_KEY);
        if (!alive) return;
        navigate({
          href: `/activate?${new URLSearchParams({
            ...(userCode ? { code: userCode } : {}),
            error: message,
          }).toString()}`,
          replace: true,
        });
      };

      if (oauthError) {
        await redirectWithError(oauthError);
        return;
      }

      try {
        if (oauthCode) {
          const exchanged = await activationSupabase.auth.exchangeCodeForSession(oauthCode);
          if (exchanged.error) {
            await redirectWithError(exchanged.error.message);
            return;
          }
        } else {
          const {
            data: { session },
            error: currentError,
          } = await activationSupabase.auth.getSession();
          if (currentError) {
            await redirectWithError(currentError.message);
            return;
          }
          if (!session) {
            await redirectWithError("Activation sign-in did not complete.");
            return;
          }
        }
      } catch (error) {
        await redirectWithError(
          error instanceof Error ? error.message : "Activation sign-in did not complete."
        );
        return;
      }

      if (!alive) return;
      sessionStorage.removeItem(ACTIVATION_CODE_STORAGE_KEY);
      navigate({
        href: userCode ? `/activate?code=${encodeURIComponent(userCode)}` : "/activate",
        replace: true,
      });
    })();

    return () => {
      alive = false;
    };
  }, [navigate]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-bg">
      <div className="flex flex-col items-center gap-3 text-text-secondary">
        <Spinner className="h-8 w-8" />
        <p className="text-[13px]">Finishing activation…</p>
      </div>
    </div>
  );
}

export const Route = createRoute({
  getParentRoute: () => rootRoute,
  path: "/activate/callback",
  component: ActivationCallbackPage,
});
