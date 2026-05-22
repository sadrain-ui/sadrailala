# syntax=docker/dockerfile:1
# cache-bust: 2026-05-22-v11

# ── Stage 1: builder ────────────────────────────────────────────────────────
FROM node:20-bookworm-slim AS builder

WORKDIR /app

RUN corepack enable && corepack prepare pnpm@9.15.9 --activate

# Layer cache: workspace manifests first
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc tsconfig.json ./

# Copy sources
COPY packages/ ./packages/
COPY apps/ ./apps/
COPY scripts/ ./scripts/

# Install all deps including dotenv (needed for tsc to resolve types)
RUN pnpm install --no-frozen-lockfile

# Build dependency chain in order
RUN pnpm --filter @legion/core build
RUN pnpm --filter @legion/sentinels build

# api build: tsc --build + flatten
RUN pnpm --filter @legion/api build

# Sanity checks
RUN test -f /app/packages/core/dist/index.js        || (echo "MISSING: core/dist/index.js" && exit 1)
RUN test -f /app/packages/sentinels/dist/index.js   || (echo "MISSING: sentinels/dist/index.js" && exit 1)
RUN test -f /app/apps/api/dist/index.js             || (echo "MISSING: api/dist/index.js" && exit 1)

# ── Stage 2: runner ─────────────────────────────────────────────────────────
FROM node:20-bookworm-slim AS runner

WORKDIR /app

RUN groupadd --gid 1001 legion && \
    useradd  --uid 1001 --gid 1001 --no-create-home legion

ENV NODE_ENV=production
ENV PORT=3000
EXPOSE 3000

# Workspace manifests
COPY --from=builder /app/package.json              ./
COPY --from=builder /app/pnpm-workspace.yaml       ./

# packages — dist + package.json only (no node_modules needed at runtime for these)
COPY --from=builder /app/packages/core/dist        ./packages/core/dist
COPY --from=builder /app/packages/core/package.json ./packages/core/package.json
COPY --from=builder /app/packages/sentinels/dist   ./packages/sentinels/dist
COPY --from=builder /app/packages/sentinels/package.json ./packages/sentinels/package.json

# api dist + package.json
COPY --from=builder /app/apps/api/dist             ./apps/api/dist
COPY --from=builder /app/apps/api/package.json     ./apps/api/package.json

# Full node_modules from builder (includes all workspace symlinks + .pnpm store)
COPY --from=builder /app/node_modules              ./node_modules
COPY --from=builder /app/apps/api/node_modules     ./apps/api/node_modules

WORKDIR /app/apps/api

USER legion
CMD ["node", "dist/index.js"]
