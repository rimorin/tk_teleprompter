/**
 * Where the backend lives. By default it's the page's own origin (the web server proxies /ws and
 * /health). Set VITE_API_ORIGIN at build time (e.g. https://api.example.com) when the front end
 * is hosted separately, such as on a static host that can't proxy WebSockets.
 */
export function resolveEndpoints(
  apiOrigin: string | undefined,
  page: { protocol: string; host: string },
) {
  const base = apiOrigin?.trim().replace(/\/+$/, '') || `${page.protocol}//${page.host}`;
  const url = new URL(base);
  const wsScheme = url.protocol === 'https:' ? 'wss:' : 'ws:';
  return {
    healthUrl: `${url.origin}/health`,
    sessionUrl: `${wsScheme}//${url.host}/ws`,
  };
}

export const endpoints = resolveEndpoints(import.meta.env.VITE_API_ORIGIN, window.location);
