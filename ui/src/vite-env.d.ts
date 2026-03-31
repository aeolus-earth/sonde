/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_REACT_SCAN?: string;
  readonly VITE_REACT_SCAN_LOG?: string;
  /** Override agent WebSocket base (e.g. wss://api.example.com). Dev uses Vite /agent proxy by default. */
  readonly VITE_AGENT_WS_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
