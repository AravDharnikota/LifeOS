# AravOS: API server + MCP server + web app in one container.
FROM node:22-bookworm-slim AS build
RUN corepack enable && apt-get update && apt-get install -y --no-install-recommends python3 make g++ && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml tsconfig.base.json ./
COPY apps/server/package.json apps/server/package.json
COPY apps/web/package.json apps/web/package.json
COPY packages/shared/package.json packages/shared/package.json
RUN pnpm install --frozen-lockfile
COPY . .
RUN pnpm --filter @aravos/web build && pnpm --filter @aravos/server typecheck

FROM node:22-bookworm-slim
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/apps/server/node_modules ./apps/server/node_modules
COPY --from=build /app/packages/shared ./packages/shared
COPY --from=build /app/apps/server/src ./apps/server/src
COPY --from=build /app/apps/server/drizzle ./apps/server/drizzle
COPY --from=build /app/apps/server/package.json ./apps/server/package.json
COPY --from=build /app/apps/web/dist ./apps/web/dist
COPY --from=build /app/package.json /app/pnpm-workspace.yaml /app/tsconfig.base.json ./
ENV PORT=8787 ARAVOS_DATA_DIR=/data
VOLUME ["/data"]
EXPOSE 8787
WORKDIR /app/apps/server
CMD ["node", "--import", "tsx", "src/index.ts"]
