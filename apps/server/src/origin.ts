/** localhost or a private/loopback IP literal (not a DNS name, which could be rebound). */
function isLocalNetworkHost(hostname: string): boolean {
  const h = hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (h === 'localhost' || h === '::1') return true;
  if (/^f[cd][0-9a-f]{2}:/.test(h) || /^fe80:/.test(h)) return true; // IPv6 ULA / link-local
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(h);
  if (!m) return false;
  const [a, b] = [Number(m[1]), Number(m[2])];
  return a === 10 || a === 127 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
}

/**
 * Allowed: an explicitly configured origin, or a same-origin page on the local network (the
 * page's host equals the host it connected to, e.g. a phone loading the app over the LAN via
 * the dev proxy). Same-origin is only trusted for localhost/private IP literals so a DNS
 * rebinding attack (attacker hostname pointed at this machine) cannot pass the check.
 */
export function isAllowedOrigin(
  origin: string | undefined,
  host: string | undefined,
  allowedOrigins: string[],
): boolean {
  if (!origin) return false;
  if (allowedOrigins.includes(origin)) return true;
  try {
    const url = new URL(origin);
    return Boolean(host) && url.host === host && isLocalNetworkHost(url.hostname);
  } catch {
    return false;
  }
}
