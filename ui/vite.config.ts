import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { execSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { PluginOption } from "vite";
import { resolveBuildMetadata } from "./src/lib/build-metadata";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const buildMetadata = resolveBuildMetadata(process.env, runCommand);
const devAgentTarget =
  process.env.VITE_AGENT_PROXY_TARGET?.trim() ||
  process.env.VITE_AGENT_HTTP_BASE?.trim() ||
  process.env.VITE_AGENT_WS_URL?.trim().replace(/^ws/i, "http") ||
  "http://127.0.0.1:3001";

function runCommand(command: string): string | null {
  try {
    const out = execSync(command, {
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 5000,
    })
      .toString()
      .trim();
    return out || null;
  } catch {
    return null;
  }
}

function versionMetadataPlugin(): PluginOption {
  return {
    name: "sonde-version-metadata",
    generateBundle() {
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
            environment: buildMetadata.environment,
            branch: buildMetadata.branch,
            appVersion: buildMetadata.appVersion,
            appVersionSource: buildMetadata.appVersionSource,
            commitSha: buildMetadata.commitSha,
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

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    setupFiles: ["src/test/setup.ts"],
  },
  define: {
    "import.meta.env.VITE_APP_VERSION": JSON.stringify(buildMetadata.appVersion),
    "import.meta.env.VITE_APP_BRANCH": JSON.stringify(buildMetadata.branch),
    "import.meta.env.VITE_APP_COMMIT_SHA": JSON.stringify(buildMetadata.commitSha),
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
