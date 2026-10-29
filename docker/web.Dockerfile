# syntax=docker/dockerfile:1

FROM node:24.22.1-alpine3.24 AS base
WORKDIR /app
# Pre-create node_modules owned by `node` so the named volume mounted
# there inherits this ownership instead of being created as root.
RUN mkdir -p /app/node_modules && chown -R node:node /app

# ---- dev: source is bind-mounted, deps live in a named volume ----
FROM base AS dev
COPY --chmod=755 docker/web-entrypoint.sh /usr/local/bin/web-entrypoint.sh
USER node
ENV NODE_ENV=development \
    ASTRO_TELEMETRY_DISABLED=1 \
    NPM_CONFIG_UPDATE_NOTIFIER=false
EXPOSE 4321
ENTRYPOINT ["web-entrypoint.sh"]
CMD ["npm", "run", "dev"]

# ---- build: static site into /app/dist (SPEC §6.5) ----
FROM base AS build
USER node
ENV NODE_ENV=production \
    ASTRO_TELEMETRY_DISABLED=1 \
    NPM_CONFIG_UPDATE_NOTIFIER=false
COPY --chown=node:node package.json package-lock.json ./
# Dev dependencies are needed to build (astro check, tsx for lint-content).
RUN npm ci --include=dev --no-audit --no-fund
COPY --chown=node:node . .
# Baked into the pages at build time: canonical URLs and the Umami site id
# (public, it ends up in the HTML anyway). An empty id means no tracker.
ARG PUBLIC_BASE_URL=https://grepmeifyoucan.com
ARG PUBLIC_UMAMI_WEBSITE_ID=
RUN PUBLIC_BASE_URL="$PUBLIC_BASE_URL" PUBLIC_UMAMI_WEBSITE_ID="$PUBLIC_UMAMI_WEBSITE_ID" npm run build

# ---- prod: Nginx serves dist/ and proxies /stats to Umami ----
# Same image as the dev proxy (compose.dev.yaml, kept equal by tests/config).
FROM nginxinc/nginx-unprivileged:1.30.6-alpine3.24-slim AS prod
USER root
COPY docker/nginx/nginx.prod.conf /etc/nginx/conf.d/default.conf
COPY docker/nginx/security-headers.conf /etc/nginx/snippets/security-headers.conf
COPY docker/nginx/csp.prod.conf /etc/nginx/snippets/csp.conf
COPY docker/nginx/headers.prod.conf /etc/nginx/snippets/headers.prod.conf
COPY docker/nginx/stats-proxy.conf /etc/nginx/snippets/stats-proxy.conf
# Owned by root and read-only for nginx (uid 101): the site cannot be altered
# from inside the container, whose file system is read-only anyway.
RUN rm -rf /usr/share/nginx/html
COPY --from=build /app/dist /usr/share/nginx/html
# Back to the image's unprivileged user (nginx, uid 101).
USER 101
# Port 8080 (HTTP) and 8443 (HTTPS) inside, published as 80/443: no
# capability is needed to bind them (SPEC §6.7).
EXPOSE 8080 8443
# Skip the image's entrypoint scripts: they rewrite the config at start,
# which a read-only file system forbids, and we need none of them.
ENTRYPOINT ["nginx", "-g", "daemon off;"]
CMD []
