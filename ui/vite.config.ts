import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  plugins: [react(), tailwindcss()],
  /** Same-origin WebSocket in dev (localhost vs 127.0.0.1, no cross-origin upgrade issues). */
  server: {
    proxy: {
      "/agent": {
        target: "http://127.0.0.1:3001",
        ws: true,
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/agent/, ""),
      },
    },
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
    },
  },
  build: {
    target: "es2020",
    sourcemap: true,
    rollupOptions: {
      output: {
        manualChunks: {
          vendor: ["react", "react-dom"],
          /** Router + Query reference each other; one chunk avoids Rollup circular chunk warnings. */
          appFramework: [
            "@tanstack/react-query",
            "@tanstack/react-virtual",
            "@tanstack/react-router",
          ],
          supabase: ["@supabase/supabase-js"],
          charts: ["recharts"],
          flow: ["@xyflow/react"],
        },
      },
    },
  },
});
