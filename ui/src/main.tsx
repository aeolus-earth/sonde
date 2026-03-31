import { StrictMode, useEffect } from "react";
import { createRoot } from "react-dom/client";
import { QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider } from "@tanstack/react-router";
import { initReactScan } from "./dev/react-scan";
import { queryClient } from "./lib/query-client";
import { router } from "./router";
import { useAuthStore } from "./stores/auth";
import { useUIStore } from "./stores/ui";
import { applyThemeToDocument } from "./lib/theme";
import "./index.css";

initReactScan();

function App() {
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

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>
);
