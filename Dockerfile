# syntax=docker/dockerfile:1.7

FROM oven/bun:1.3.10 AS deps

WORKDIR /app

COPY package.json bun.lock bunfig.toml tsconfig.json ./
COPY packages/agents/package.json packages/agents/package.json
COPY packages/api/package.json packages/api/package.json
COPY packages/connectors/package.json packages/connectors/package.json
COPY packages/core/package.json packages/core/package.json
COPY packages/orchestrator/package.json packages/orchestrator/package.json
COPY packages/web/package.json packages/web/package.json

RUN bun install --frozen-lockfile

FROM oven/bun:1.3.10 AS workspace

WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY . .

FROM workspace AS build

RUN bun --cwd packages/web build

FROM oven/bun:1.3.10 AS web

WORKDIR /app
ENV NODE_ENV=production
ENV INTERNAL_API_TARGET=http://digital-life:3000
ENV PORT=4173

COPY --from=deps /app/node_modules ./node_modules
COPY package.json bunfig.toml tsconfig.json ./
COPY packages/web/package.json packages/web/package.json
COPY packages/web/src/server.ts packages/web/src/server.ts
COPY --from=build /app/packages/web/dist packages/web/dist

EXPOSE 4173

CMD ["bun", "--cwd", "packages/web", "serve"]

FROM workspace AS api

ENV NODE_ENV=production
ENV DIGITAL_LIFE_CONFIG_PATH=/app/config/digital-life.yaml
ENV DIGITAL_LIFE_RUN_MIGRATIONS=true
ENV PORT=3000

RUN chmod +x /app/scripts/docker-entrypoint.sh

EXPOSE 3000

ENTRYPOINT ["/app/scripts/docker-entrypoint.sh"]
CMD ["bun", "--cwd", "packages/api", "src/server.ts"]
