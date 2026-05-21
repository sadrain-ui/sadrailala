# syntax=docker/dockerfile:1
# cache-bust: 2026-05-22-v5

# ── Stage 1: builder ─────────────────────────────────────────────────────────
FROM node:20-bookworm-slim AS builder

WORKDIR /app

RUN corepack enable && corepack prepare pnpm@9.15.9 --activate

# Copy root workspace config first (layer cache)
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc tsconfig.json ./

# Copy source — Railway sends full repo context from root
COPY packages/ ./packages/
COPY apps/ ./apps/
COPY scripts/ ./scripts/

RUN pnpm install --frozen-lockfile

# Deterministic build order: core → sentinels → api
RUN pnpm --filter @legion/core build
RUN pnpm --filter @legion/sentinels build
RUN pnpm --filter @legion/api build

RUN pnpm install --frozen-lockfile

# Fail fast if artifacts missing
RUN test -f /app/packages/core/dist/index.js
RUN test -f /app/packages/sentinels/dist/index.js
RUN test -f /app/apps/api/dist/index.js

# ── Stage 2: runner ───────────────────────────────────────────────────────────
FROM node:20-bookworm-slim AS runner

WORKDIR /app

RUN groupadd --gid 1001 legion && \
    useradd --uid 1001 --gid 1001 --no-create-home legion

ENV NODE_ENV=production
ENV PORT=3000
EXPOSE 3000

COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/packages ./packages
COPY --from=builder /app/apps/api ./apps/api
COPY --from=builder /app/package.json ./
COPY --from=builder /app/pnpm-workspace.yaml ./

WORKDIR /app/apps/api

USER legion
CMD ["node", "dist/index.js"]
