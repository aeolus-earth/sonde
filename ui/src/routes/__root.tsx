import { lazy, Suspense } from "react";
import { createRootRoute, Outlet } from "@tanstack/react-router";
import { ErrorBoundary } from "@/components/ui/error-boundary";
import { ToastContainer } from "@/components/ui/toast";
import { VersionBadge } from "@/components/layout/version-badge";
import { useHotkey } from "@/hooks/use-keyboard";
import { useUIStore } from "@/stores/ui";
import { useAuthStore } from "@/stores/auth";

const CommandPalette = lazy(
  () => import("@/components/command-palette/command-palette")
);

function RootComponent() {
  const commandPaletteOpen = useUIStore((s) => s.commandPaletteOpen);
  const session = useAuthStore((s) => s.session);

  useHotkey(
    "k",
    () => {
      if (useAuthStore.getState().session) {
        useUIStore.getState().setCommandPaletteOpen(true);
      }
    },
    { meta: true }
  );
  useHotkey(
    "/",
    () => {
      if (useAuthStore.getState().session) {
        useUIStore.getState().setCommandPaletteOpen(true);
      }
    }
  );

  return (
    <>
      <ErrorBoundary>
        <Outlet />
      </ErrorBoundary>
      <ToastContainer />
      <VersionBadge />
      {session && commandPaletteOpen && (
        <Suspense fallback={null}>
          <CommandPalette />
        </Suspense>
      )}
    </>
  );
}

export const Route = createRootRoute({
  component: RootComponent,
});
