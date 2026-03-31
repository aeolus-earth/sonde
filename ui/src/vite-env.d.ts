/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_REACT_SCAN?: string;
  readonly VITE_REACT_SCAN_LOG?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
