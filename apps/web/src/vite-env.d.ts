/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Backend origin when it isn't the page's own origin, e.g. https://api.example.com. */
  readonly VITE_API_ORIGIN?: string;
}
