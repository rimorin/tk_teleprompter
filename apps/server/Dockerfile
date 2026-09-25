# syntax=docker/dockerfile:1
# Backend: Fastify WebSocket relay to the speech provider. Build context: repository root.
# Runtime configuration: see apps/server/.env.example.

FROM node:22-alpine AS build
ENV CI=true
# Latest corepack: older bundled versions can reject newer pnpm release signing keys.
RUN npm install -g corepack@latest && corepack enable
WORKDIR /repo
# Manifests first so dependency installs are cached across source-only changes.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/shared/package.json packages/shared/
COPY apps/server/package.json apps/server/
RUN pnpm install --frozen-lockfile --filter @teleprompter/server...
COPY tsconfig.base.json ./
COPY packages/shared packages/shared
COPY apps/server apps/server
RUN pnpm --filter @teleprompter/server build

# Runtime: the bundle is self-contained, so no node_modules are shipped.
FROM node:22-alpine
ENV NODE_ENV=production \
    HOST=:: \
    PORT=8080
WORKDIR /app
# The source map stays behind: Node runs without --enable-source-maps, which costs ~15 MB of memory.
COPY --from=build /repo/apps/server/dist/index.cjs /repo/apps/server/dist/index.cjs.LEGAL.txt ./dist/
USER node
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s \
  CMD wget -qO- "http://127.0.0.1:${PORT}/health" >/dev/null || exit 1
CMD ["node", "dist/index.cjs"]
