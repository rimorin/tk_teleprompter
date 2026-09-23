# Deployment

The app runs anywhere that can run containers, or a static site plus a Node.js service. Nothing
in the code or images is tied to a particular platform: everything is configured at runtime with
environment variables.

- [What you deploy](#what-you-deploy)
- [Requirements for any platform](#requirements-for-any-platform)
- [Configuration reference](#configuration-reference)
- [Recipes](#recipes): [Docker Compose](#docker-compose-any-server) ·
  [Kubernetes](#kubernetes) · [Container platforms](#container-platforms-railway-render-flyio-and-others) ·
  [Static front end + separate API](#static-front-end--separate-api) ·
  [Behind Cloudflare](#behind-cloudflare)
- [Capacity and cost](#capacity-and-cost)
- [Verify a deployment](#verify-a-deployment) · [Troubleshooting](#troubleshooting)

## What you deploy

Two services, built from this repository:

| Service | Image                    | What it does                                                                                                                             |
| ------- | ------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------- |
| **api** | `apps/server/Dockerfile` | Fastify server: relays microphone audio to the speech provider and returns transcripts. Holds `DEEPGRAM_API_KEY`. Health: `GET /health`. |
| **web** | `apps/web/Dockerfile`    | Caddy: serves the front end, adds security headers, and proxies `/ws` and `/health` to **api**. Health: `GET /healthz`.                  |

Both images build from the repository root (`docker build -f apps/server/Dockerfile .`). Most
platforms build them for you from the Git repository; nothing needs to be pushed to a registry.

There are two ways to connect them:

**A. Proxied (recommended).** One public domain; the API stays private.

```
Browser ──https / wss──▶ web (public) ──private network──▶ api (private)
```

The browser only talks to `web`, so no CORS or build-time settings are needed, and the service
holding the API key isn't reachable from the internet.

**B. Split origin.** The front end is on a static host (Netlify, Vercel, Cloudflare Pages, S3 +
CloudFront, GitHub Pages…) and the API has its own public domain.

```
Browser ──https──▶ static host (front end)
        ──wss────▶ api (public)
```

Use this when your front-end host can't proxy WebSockets. The front end is built with
`VITE_API_ORIGIN=https://api.example.com`.

## Requirements for any platform

| Requirement                                             | Why                                                                                 | Notes                                                                                                                                           |
| ------------------------------------------------------- | ----------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| **HTTPS** in front of the public service                | Browsers only allow the microphone on secure pages                                  | Most platforms provide it; on your own server use a TLS proxy (Caddy, nginx, Traefik) or a tunnel                                               |
| **WebSocket support** on the public path                | Audio and transcripts stream over `/ws`                                             | Raise idle/read timeouts on proxies you control to ≥ 1 hour (nginx `proxy_read_timeout`, load-balancer idle timeout)                            |
| **Private networking** between web and api (topology A) | `web` reaches `api` at `API_URL`                                                    | Any internal hostname works: `http://api:8080` (Compose/Kubernetes), `http://api.railway.internal:8080`, `http://<app>.internal:8080` (Fly.io)… |
| **Graceful stop**                                       | On SIGTERM/SIGINT the API finalizes open sessions and tells presenters to reconnect | Keep `SHUTDOWN_GRACE_SECONDS` (default 8) below the platform's stop timeout (Docker 10 s, Kubernetes 30 s; check yours)                         |
| **One api replica**                                     | Access-code lockouts and session limits are kept in memory                          | Scale up only after moving those counters to a shared store                                                                                     |
| **Health checks** (optional)                            | Gate rollouts on a healthy container                                                | api `GET /health`, web `GET /healthz`; both images also define a Docker `HEALTHCHECK`                                                           |

## Configuration reference

**api** (full list with defaults: [`apps/server/.env.example`](apps/server/.env.example))

| Variable                                                                | Required             | Example / default              | Purpose                                                                                                                   |
| ----------------------------------------------------------------------- | -------------------- | ------------------------------ | ------------------------------------------------------------------------------------------------------------------------- |
| `DEEPGRAM_API_KEY`                                                      | yes                  | —                              | Speech provider key (keep secret)                                                                                         |
| `APP_ACCESS_CODE`                                                       | strongly recommended | —                              | Passcode presenters enter before voice tracking starts                                                                    |
| `ALLOWED_ORIGINS`                                                       | yes                  | `https://prompter.example.com` | Exact browser origin(s) of the front end, comma-separated                                                                 |
| `PORT` / `HOST`                                                         | no                   | `8080` / `::` (in the image)   | Listen address                                                                                                            |
| `TRUST_PROXY`                                                           | no                   | `false`                        | `true` behind the web image (it overwrites `X-Forwarded-For`); a hop count (`1`) or CIDR list behind other load balancers |
| `MAX_CONCURRENT_SESSIONS`, `MAX_SESSIONS_PER_IP`, `MAX_SESSION_MINUTES` | no                   | `10`, `10`, `90`               | Cost limits                                                                                                               |
| `SHUTDOWN_GRACE_SECONDS`                                                | no                   | `8`                            | Time to finalize sessions on shutdown                                                                                     |

**web** (see [`apps/web/Caddyfile`](apps/web/Caddyfile))

| Variable          | Default           | Purpose                                                                                                                                             |
| ----------------- | ----------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `PORT`            | `8080`            | Listen port                                                                                                                                         |
| `API_URL`         | `http://api:8080` | Private URL of the api service                                                                                                                      |
| `TRUSTED_PROXIES` | `private_ranges`  | Proxies in front of `web` whose `X-Forwarded-For` is trusted; add your platform's ranges if they aren't private (e.g. `private_ranges 100.0.0.0/8`) |
| `CSP_CONNECT_SRC` | empty             | Extra CSP `connect-src` sources, only if the page must reach another origin                                                                         |

**Build-time (front end only)**

| Variable          | Default             | Purpose                                                                                            |
| ----------------- | ------------------- | -------------------------------------------------------------------------------------------------- |
| `VITE_API_ORIGIN` | empty (same origin) | API origin for topology B, e.g. `https://api.example.com`. Docker: `--build-arg VITE_API_ORIGIN=…` |

## Recipes

### Docker Compose (any server)

For a VPS, a home server, or a local production preview. See [`compose.yaml`](compose.yaml).

```bash
cp apps/server/.env.example apps/server/.env      # set DEEPGRAM_API_KEY and APP_ACCESS_CODE
PUBLIC_ORIGIN=https://prompter.example.com docker compose up -d --build
```

`web` listens on port 8080 (`WEB_PORT` to change); `api` isn't published. Point your TLS proxy
at `http://<server>:8080`. For example, with Caddy on the host:

```
prompter.example.com {
	reverse_proxy 127.0.0.1:8080
}
```

### Kubernetes

Build the two images and push them to a registry your cluster can pull from, then:

- **api:** a Deployment with `replicas: 1` and a Service named `api` on port 8080. Put secrets in
  a Secret. Set `TRUST_PROXY=true`, `ALLOWED_ORIGINS=https://<your host>`, readiness probe
  `/health`, and `terminationGracePeriodSeconds` above `SHUTDOWN_GRACE_SECONDS`.
- **web:** a Deployment and Service (readiness probe `/healthz`, `API_URL=http://api:8080`) behind
  your Ingress. Allow WebSockets and long-lived connections (for ingress-nginx:
  `nginx.ingress.kubernetes.io/proxy-read-timeout: "3600"` and `proxy-send-timeout: "3600"`), and
  set `TRUSTED_PROXIES` to your ingress pods' range if it isn't private.

### Container platforms (Railway, Render, Fly.io, and others)

The pattern is the same everywhere:

1. Create an **api** service from `apps/server/Dockerfile` (build context: repo root), set its
   variables (table above) with `TRUST_PROXY=true`, and **don't** give it a public domain. Use a
   private service type where the platform has one.
2. Create a **web** service from `apps/web/Dockerfile` with `API_URL` set to the api's
   private-network address, and give **web** the public domain.
3. Set `ALLOWED_ORIGINS` on api to web's public origin (plus any custom domains).

Platform notes:

- **Railway:** ready-made service configs are in [`deploy/railway/`](deploy/railway). Create the
  `api` and `web` services from this repo, leave the root directory as `/`, and set each service's
  config file to `/deploy/railway/api.json` or `/deploy/railway/web.json`.
  - **api** variables: `PORT=8080`, `TRUST_PROXY=true`,
    `ALLOWED_ORIGINS=https://${{web.RAILWAY_PUBLIC_DOMAIN}}` and
    `RAILWAY_DEPLOYMENT_DRAINING_SECONDS=10`.
  - **web** variables: `PORT=8080`, `API_URL=http://${{api.RAILWAY_PRIVATE_DOMAIN}}:${{api.PORT}}`
    and `TRUSTED_PROXIES=private_ranges 100.0.0.0/8` (Railway's edge).
  - Generate a domain for **web** only.
- **Render / Fly.io / others:** use the platform's private-network hostname for `API_URL` and its
  stop-timeout setting to allow graceful shutdown.

### Static front end + separate API

1. Deploy **api** publicly using any recipe above, with `ALLOWED_ORIGINS=https://<front-end
origin>`. Set `TRUST_PROXY` to match what sits in front of it: a hop count such as `1` for a
   single load balancer. Avoid `true` here, because clients can forge `X-Forwarded-For` when
   nothing overwrites it.
2. Build the front end with the API origin and publish `apps/web/dist`:

   ```bash
   VITE_API_ORIGIN=https://api.example.com pnpm --filter @teleprompter/web build
   ```

3. On the static host, route all unknown paths to `index.html` (SPA fallback) and, ideally, send
   `Permissions-Policy: microphone=(self)` and the other headers from `apps/web/Caddyfile`.

### Behind Cloudflare

Cloudflare's proxy (orange cloud) works in front of any recipe. WebSockets are supported on all
plans. Four things need attention.

**1. Client IPs: required for per-IP limits and access-code lockouts.** Behind Cloudflare, every
visitor arrives from a few Cloudflare addresses. Unless the real client IP is used, visitors share
per-IP limits, and one person's wrong access codes can lock out everyone behind the same edge.
Use Cloudflare's `CF-Connecting-IP` header, trusted only from Cloudflare's own ranges:

| Setup                                                     | web variables                                                                            | api variables                                                           |
| --------------------------------------------------------- | ---------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| Cloudflare → **web** directly (DNS points at your server) | `CLIENT_IP_HEADERS=CF-Connecting-IP`, `TRUSTED_PROXIES=` from `deploy/cloudflare/ips.sh` | unchanged (`TRUST_PROXY=true`)                                          |
| Cloudflare → platform load balancer → **web**             | `CLIENT_IP_HEADERS=CF-Connecting-IP`; keep the platform's ranges in `TRUSTED_PROXIES`    | unchanged                                                               |
| Cloudflare Tunnel → **web**                               | `CLIENT_IP_HEADERS=CF-Connecting-IP` (the tunnel connects from the private network)      | unchanged                                                               |
| Cloudflare → **api** directly (split origin)              | n/a                                                                                      | `TRUST_PROXY=` the comma-separated list from `deploy/cloudflare/ips.sh` |

`deploy/cloudflare/ips.sh` prints Cloudflare's current ranges
([published here](https://www.cloudflare.com/ips/)) in both formats. The headers are trusted only
from the proxies you list, so a request that bypasses Cloudflare can't fake them. For the same
reason, make Cloudflare the **only** way in: turn off or don't publish the platform's own
hostname, bind the port to localhost when using a tunnel (`WEB_PORT=127.0.0.1:8080`), or restrict
the origin firewall to Cloudflare's ranges.

**2. TLS.** Set SSL/TLS mode to **Full (strict)**. Platforms provide an origin certificate; on
your own server use a Cloudflare Origin CA certificate on your TLS proxy, or a tunnel (no
certificate or open ports needed):

```bash
CLOUDFLARE_TUNNEL_TOKEN=... WEB_PORT=127.0.0.1:8080 PUBLIC_ORIGIN=https://prompter.example.com \
CLIENT_IP_HEADERS=CF-Connecting-IP docker compose --profile cloudflare up -d
```

In the tunnel's public hostname settings, route your hostname to `http://web:8080`.

**3. Dashboard settings.**

- Keep **WebSockets** enabled (Network).
- Turn **Rocket Loader** off: it rewrites script tags, which the app's Content Security Policy
  blocks.
- Don't add cache rules for `/ws` or `/health`. Hashed files in `/assets/` are safe to cache (the
  app already marks them immutable).
- Exclude `/ws` from WAF challenges and Bot Fight Mode: a WebSocket upgrade can't solve a
  challenge.
- Optional: put the site behind **Cloudflare Access** to require sign-in in addition to (or
  instead of) `APP_ACCESS_CODE`.

**4. Dropped connections.** Cloudflare may restart its servers, which closes WebSockets. The
presenter shows that the connection was lost, keeps its place, and stays usable manually; start the
microphone again to continue. Active sessions aren't idle: audio streams continuously while the
microphone is on.

## Capacity and cost

The api service only relays audio. Script matching runs in each presenter's browser, so server
load depends on how many microphones are on at once, not on script length.

**Measured on one Node.js process** (the production build on a laptop; simulated speakers
streaming real-time audio through the server to a local stand-in for the speech provider for
20 s; "latency" is the time the server adds, not speech recognition time):

| Simultaneous speakers | Server CPU (one core) | Memory | Added latency p50 / p99 |
| --------------------- | --------------------- | ------ | ----------------------- |
| 5                     | 3.6%                  | 64 MB  | 1.0 / 2.0 ms            |
| 25                    | 4.4%                  | 66 MB  | 0.9 / 2.5 ms            |
| 100                   | 10.9%                 | 67 MB  | 1.5 / 4.4 ms            |
| 250                   | 20.8%                 | 113 MB | 2.3 / 6.6 ms            |

Rules of thumb:

- **Size:** a small instance (0.5 vCPU, 256 MB) comfortably serves dozens of simultaneous
  speakers. Keep one api replica (limits are in memory).
- **Bandwidth:** about 32 KB/s (≈ 256 kbit/s) per active microphone, in each direction between
  browser → api → provider.
- **App limits:** `MAX_CONCURRENT_SESSIONS` (default 10) caps everyone combined;
  `MAX_SESSIONS_PER_IP` (default 10) caps one network address. Speakers at the same venue or
  office usually share a public IP, so keep the per-IP limit at least your group size. Raise
  both for larger events; the access code remains the main protection.
- **Speech provider limits:** Deepgram allows up to 150 concurrent streams per project on
  pay-as-you-go (225 on Growth in North America), but **secondary projects on self-serve
  accounts are limited to one stream**: use a key from your primary project. See
  [Deepgram's rate limits](https://developers.deepgram.com/reference/api-rate-limits).
- **Cost:** the provider bills per minute of streamed audio, so cost grows linearly with the
  number of open microphones. `MAX_SESSION_MINUTES` (default 90) bounds forgotten sessions.

## Verify a deployment

- `https://<your-domain>/health` (or the API domain in topology B) returns
  `{"ok":true,…,"asr":{"configured":true},"access":{"codeRequired":true}}`.
- Open the site on a phone, load a script, **Start presenting → Start microphone**, enter the
  access code, and read a few lines.
- Restart or redeploy **api** mid-session: the presenter shows "The server is restarting…", keeps
  its place, and manual control keeps working. Start the microphone again to continue.

## Troubleshooting

| Symptom                                                                                          | Likely cause                                                                                                            |
| ------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------- |
| 502 on `/health` or the mic can't connect (topology A)                                           | `API_URL` is wrong, or api isn't listening (its log should show `Server listening at http://[::]:8080`)                 |
| `rejected websocket origin` in api logs                                                          | `ALLOWED_ORIGINS` doesn't exactly match the browser's origin (scheme, host, port; no trailing slash)                    |
| Setup page says "Server offline" in topology B                                                   | `VITE_API_ORIGIN` wasn't set at build time, the API is unreachable, or its origin isn't in `ALLOWED_ORIGINS` (CORS)     |
| "Live tracking is not configured"                                                                | `DEEPGRAM_API_KEY` is missing on api                                                                                    |
| "The speech provider rejected the server's credentials"                                          | Invalid or expired Deepgram key                                                                                         |
| Sessions drop after about a minute of silence                                                    | A proxy's idle or read timeout is too short for WebSockets                                                              |
| Behind Cloudflare, one person's wrong codes lock out others, or everyone shares one per-IP limit | Set `CLIENT_IP_HEADERS=CF-Connecting-IP` and Cloudflare's ranges (see [Behind Cloudflare](#behind-cloudflare))          |
| Per-IP limits hit everyone at once                                                               | `TRUST_PROXY` is off behind a proxy, so every client looks like the proxy's IP                                          |
| “Voice tracking is at capacity” when a group starts at once                                      | `MAX_CONCURRENT_SESSIONS` or `MAX_SESSIONS_PER_IP` is below the group size (people on one network share an IP)          |
| Only one speaker can use voice tracking at a time                                                | The Deepgram key belongs to a secondary self-serve project (limited to one stream); use a key from your primary project |
