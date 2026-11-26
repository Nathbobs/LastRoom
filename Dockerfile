# syntax=docker/dockerfile:1
# Three stages so the final image has only what runs in production:
#   deps    -> production node_modules only (no compiler, test or lint tools)
#   build   -> full install + TypeScript compile
#   runtime -> compiled dist + production node_modules, as a non-root user
ARG NODE_IMAGE=node:24-alpine

FROM ${NODE_IMAGE} AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force

FROM ${NODE_IMAGE} AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts
COPY tsconfig.json tsconfig.build.json nest-cli.json ./
COPY src ./src
RUN npm run build

FROM ${NODE_IMAGE} AS runtime
ENV NODE_ENV=production
WORKDIR /app
# Owned by root and read-only for the app user: a compromised process can't
# rewrite its own code. The `node` user ships with the official image.
COPY --from=deps /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY package.json ./
USER node
EXPOSE 3000
# Health = Mongo reachable (Redis down is only "degraded", still 200).
# busybox wget is part of alpine, so no extra package is needed.
HEALTHCHECK --interval=10s --timeout=3s --start-period=15s --retries=5 \
  CMD wget -qO- "http://127.0.0.1:${PORT:-3000}/health" > /dev/null || exit 1
CMD ["node", "dist/main.js"]
