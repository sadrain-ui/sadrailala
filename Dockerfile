# syntax=docker/dockerfile:1

# ── Stage 1: builder — full dev graph for compile ─────────────────────────────
FROM node:20-bookworm-slim AS builder

WORKDIR /app

RUN corepack enable && corepack prepare pnpm@9.15.9 --activate

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc tsconfig.json ./
COPY packages ./packages
COPY apps ./apps
COPY scripts ./scripts

RUN pnpm install --frozen-lockfile

RUN pnpm --filter @legion/api... build

# Fail fast if the API entry artifact is missing
RUN test -f /app/apps/api/dist/index.js

# ── Stage 2: runner — full monorepo tree so workspace symlinks stay intact ────
FROM node:20-bookworm-slim AS runner

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=4000
EXPOSE 4000

# Copy full workspace: hoisted node_modules + built packages + api dist
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/packages ./packages
COPY --from=builder /app/apps/api ./apps/api
COPY --from=builder /app/package.json ./
COPY --from=builder /app/pnpm-workspace.yaml ./

WORKDIR /app/apps/api

CMD ["node", "dist/index.js"]
