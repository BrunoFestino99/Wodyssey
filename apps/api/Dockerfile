# syntax=docker/dockerfile:1
# Build from the repository root, for example:
#   docker build -f apps/api/Dockerfile --target production -t wodyssey-api .

FROM node:22-bookworm-slim AS manifests
WORKDIR /app
# Every workspace manifest, so npm ci can verify the shared lockfile.
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/

FROM manifests AS dependencies
RUN npm ci --workspace @wodyssey/api

# Used by docker-compose.yml, which mounts apps/api/src for hot reload.
FROM dependencies AS development
COPY apps/api apps/api
WORKDIR /app/apps/api
ENV HOST=0.0.0.0
EXPOSE 3000
# Polling, because file events from a bind-mounted host folder do not reach every container.
CMD ["node", "/app/node_modules/ts-node-dev/lib/bin.js", "--respawn", "--transpile-only", "--poll", "src/main.ts"]

FROM dependencies AS build
COPY apps/api apps/api
RUN npm run build --workspace @wodyssey/api

FROM manifests AS production-dependencies
RUN npm ci --omit=dev --workspace @wodyssey/api

FROM node:22-bookworm-slim AS production
ENV NODE_ENV=production HOST=0.0.0.0 PORT=3000
WORKDIR /app
COPY --from=production-dependencies /app/node_modules node_modules
COPY --from=build /app/apps/api/dist apps/api/dist
USER node
EXPOSE 3000
HEALTHCHECK --interval=10s --timeout=3s --start-period=10s \
  CMD ["node", "-e", "fetch(`http://127.0.0.1:${process.env.PORT}/health`).then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))"]
# Applies pending migrations before it starts listening.
CMD ["node", "apps/api/dist/main.js"]
