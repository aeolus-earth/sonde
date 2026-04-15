import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { PluginOption } from "vite";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const devAgentTarget =
  process.env.VITE_AGENT_PROXY_TARGET?.trim() ||
  process.env.VITE_AGENT_HTTP_BASE?.trim() ||
  process.env.VITE_AGENT_WS_URL?.trim().replace(/^ws/i, "http") ||
  "http://127.0.0.1:3001";

function versionMetadataPlugin(): PluginOption {
  return {
    name: "sonde-version-metadata",
    generateBundle() {
      const inferredUrl =
        process.env.VITE_PUBLIC_APP_ORIGIN?.trim() ||
        process.env.VERCEL_PROJECT_PRODUCTION_URL?.trim() ||
        process.env.VERCEL_URL?.trim() ||
        "";
      const inferredEnvironment = inferredUrl.includes("staging")
        ? "staging"
        : process.env.VERCEL_ENV?.trim() === "production"
          ? "production"
          : "";
      const environment =
        process.env.SONDE_ENVIRONMENT?.trim() ||
        inferredEnvironment ||
        process.env.NODE_ENV?.trim() ||
        "development";
      const commitSha =
        process.env.SONDE_COMMIT_SHA?.trim() ||
        process.env.VERCEL_GIT_COMMIT_SHA?.trim() ||
        null;
      const explicitAgentWsBase = process.env.VITE_AGENT_WS_URL?.trim() || "";
      let agentWsOrigin: string | null = null;
      if (explicitAgentWsBase) {
        try {
          const agentUrl = new URL(explicitAgentWsBase);
          agentUrl.protocol = agentUrl.protocol === "wss:" ? "https:" : "http:";
          agentWsOrigin = agentUrl.origin;
        } catch {
          agentWsOrigin = null;
        }
      }

      this.emitFile({
        type: "asset",
        fileName: "version.json",
        source: JSON.stringify(
          {
            environment,
            commitSha,
            agentWsConfigured: Boolean(explicitAgentWsBase),
            agentWsOrigin,
          },
          null,
          2
        ),
      });
    },
  };
}

const appVersion =
  process.env.VITE_APP_VERSION?.trim() ||
  process.env.VERCEL_GIT_COMMIT_REF?.trim() ||
  process.env.RAILWAY_GIT_BRANCH?.trim() ||
  "dev";
const appCommitSha =
  process.env.VITE_APP_COMMIT_SHA?.trim() ||
  process.env.SONDE_COMMIT_SHA?.trim() ||
  process.env.VERCEL_GIT_COMMIT_SHA?.trim() ||
  "local";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
  define: {
    "import.meta.env.VITE_APP_VERSION": JSON.stringify(appVersion),
    "import.meta.env.VITE_APP_COMMIT_SHA": JSON.stringify(appCommitSha),
  },
  plugins: [react(), tailwindcss(), versionMetadataPlugin()],
  /** Same-origin WebSocket in dev (localhost vs 127.0.0.1, no cross-origin upgrade issues). */
  server: {
    proxy: {
      "/auth/device": {
        target: devAgentTarget,
        changeOrigin: true,
      },
      "/agent": {
        target: devAgentTarget,
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
    sourcemap: false,
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
