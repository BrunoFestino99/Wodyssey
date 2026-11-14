# syntax=docker/dockerfile:1
# Build from the repository root, for example:
#   docker build -f apps/web/Dockerfile --target production \
#     --build-arg VITE_API_URL=https://api.example.com -t wodyssey-web .

FROM node:22-bookworm-slim AS dependencies
WORKDIR /app
# Every workspace manifest, so npm ci can verify the shared lockfile.
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
RUN npm ci --workspace @wodyssey/web

# Used by docker-compose.yml, which mounts the web sources for hot reload.
FROM dependencies AS development
COPY apps/web apps/web
EXPOSE 5173
CMD ["node", "node_modules/vite/bin/vite.js", "apps/web", "--host", "0.0.0.0", "--port", "5173", "--strictPort"]

FROM dependencies AS build
# The public API origin is compiled into the bundle.
ARG VITE_API_URL
RUN test -n "$VITE_API_URL" || (echo "Set the VITE_API_URL build argument to the public API origin." >&2 && exit 1)
COPY apps/web apps/web
RUN npm run build --workspace @wodyssey/web

FROM nginxinc/nginx-unprivileged:1.27-alpine AS production
COPY apps/web/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/apps/web/dist /usr/share/nginx/html
EXPOSE 8080
