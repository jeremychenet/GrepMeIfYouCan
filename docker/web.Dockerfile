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

# The `prod` stage (static build served by Nginx) is added in milestone J18.
