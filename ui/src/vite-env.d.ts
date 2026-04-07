/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_REACT_SCAN?: string;
  readonly VITE_REACT_SCAN_LOG?: string;
  /** Override agent WebSocket base (e.g. wss://api.example.com). Dev uses Vite /agent proxy by default. */
  readonly VITE_AGENT_WS_URL?: string;
  /** Optional label shown until the server reports the live model (e.g. claude-sonnet-4-5-20250929). */
  readonly VITE_AGENT_MODEL_LABEL?: string;
  /**
   * Override public app origin for share links (no trailing slash).
   * If unset, localhost uses the default prod host; deployed builds use `window.location.origin`.
   */
  readonly VITE_PUBLIC_APP_ORIGIN?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
