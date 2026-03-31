import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { initReactScan } from "./dev/react-scan";
import { App } from "./App";

export function mountApp(): void {
  initReactScan();
  const el = document.getElementById("root");
  if (!el) return;
  createRoot(el).render(
    <StrictMode>
      <App />
    </StrictMode>
  );
}
