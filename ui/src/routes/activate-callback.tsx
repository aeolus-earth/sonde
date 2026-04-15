import { useEffect } from "react";
import { createRoute, useNavigate } from "@tanstack/react-router";
import { Route as rootRoute } from "./__root";
import { activationSupabase } from "@/lib/activation-supabase";
import {
  ACTIVATION_CODE_STORAGE_KEY,
  resolveActivationCallbackHref,
} from "@/lib/device-activation-browser";
import { Spinner } from "@/components/ui/spinner";

function ActivationCallbackPage() {
  const navigate = useNavigate();

  useEffect(() => {
    let alive = true;

    void (async () => {
      const storedCode = sessionStorage.getItem(ACTIVATION_CODE_STORAGE_KEY) || "";
      const href = await resolveActivationCallbackHref({
        search: window.location.search,
        storedCode,
        authClient: activationSupabase.auth,
      });
      sessionStorage.removeItem(ACTIVATION_CODE_STORAGE_KEY);
      if (!alive) return;
      navigate({
        href,
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
