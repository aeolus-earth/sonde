/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_REACT_SCAN?: string;
  readonly VITE_REACT_SCAN_LOG?: string;
  /** Required in hosted staging/production. Dev uses Vite /agent proxy by default. */
  readonly VITE_AGENT_WS_URL?: string;
  /** Optional label shown until the server reports the live model (e.g. claude-sonnet-4-5-20250929). */
  readonly VITE_AGENT_MODEL_LABEL?: string;
  /**
   * Override public app origin for share links (no trailing slash).
   * If unset, localhost uses the default prod host; deployed builds use `window.location.origin`.
   */
  readonly VITE_PUBLIC_APP_ORIGIN?: string;
  /** Build-time version label: git tag/describe label in hosted builds, "dev" locally. */
  readonly VITE_APP_VERSION: string;
  /** Build-time git branch/ref label. */
  readonly VITE_APP_BRANCH: string;
  /** Build-time commit SHA (full). "local" on dev builds. */
  readonly VITE_APP_COMMIT_SHA: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
