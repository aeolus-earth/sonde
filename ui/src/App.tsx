import { useEffect } from "react";
import { QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider } from "@tanstack/react-router";
import { queryClient } from "./lib/query-client";
import { setupGitHubCachePersistence } from "./lib/github-cache-persist";
import { router } from "./router";
import { useAuthStore } from "./stores/auth";
import { useUIStore } from "./stores/ui";
import { applyThemeToDocument } from "./lib/theme";

// Hydrate GitHub commit cache from localStorage on startup
setupGitHubCachePersistence(queryClient);

export function App() {
  const initialize = useAuthStore((s) => s.initialize);

  useEffect(() => {
    applyThemeToDocument(useUIStore.getState().theme);
  }, []);

  useEffect(() => {
    const unsubscribe = initialize();
    return unsubscribe;
  }, [initialize]);

  return (
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  );
}
