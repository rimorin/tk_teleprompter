# syntax=docker/dockerfile:1
# Frontend: static SPA served by Caddy, which also proxies /ws and /health to the backend.
# Build context: repository root. Runtime configuration: see apps/web/Caddyfile.

FROM node:22-alpine AS build
ENV CI=true
# Latest corepack: older bundled versions can reject newer pnpm release signing keys.
RUN npm install -g corepack@latest && corepack enable
WORKDIR /repo
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/shared/package.json packages/shared/
COPY apps/web/package.json apps/web/
RUN pnpm install --frozen-lockfile --filter @teleprompter/web...
COPY tsconfig.base.json ./
COPY packages/shared packages/shared
COPY apps/web apps/web
# Optional: bake in a separately hosted API origin (default: same origin, via the proxy below).
ARG VITE_API_ORIGIN=
ENV VITE_API_ORIGIN=$VITE_API_ORIGIN
RUN pnpm --filter @teleprompter/web build

FROM caddy:2-alpine
WORKDIR /srv
COPY apps/web/Caddyfile /etc/caddy/Caddyfile
COPY --from=build /repo/apps/web/dist ./dist
RUN caddy fmt --overwrite /etc/caddy/Caddyfile && caddy validate --config /etc/caddy/Caddyfile
ENV PORT=8080
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s \
  CMD wget -qO- "http://127.0.0.1:${PORT}/healthz" >/dev/null || exit 1
CMD ["caddy", "run", "--config", "/etc/caddy/Caddyfile", "--adapter", "caddyfile"]
