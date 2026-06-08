# syntax=docker/dockerfile:1
# cache-bust: 2026-05-31-railway-native-build

# ── Stage 1: builder ────────────────────────────────────────────────────────
FROM node:22-bookworm-slim AS builder

WORKDIR /app

# Native addons (tiny-secp256k1, bigint-buffer, etc.) need node-gyp toolchain.
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 \
    make \
    g++ \
    && rm -rf /var/lib/apt/lists/*

RUN corepack enable && corepack prepare pnpm@9.15.9 --activate

# Layer cache: workspace manifests first
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc tsconfig.json ./

# Copy sources
COPY packages/ ./packages/
COPY apps/ ./apps/
COPY scripts/ ./scripts/

# Install only @legion/api and its workspace dependencies (core, sentinels)
RUN pnpm install --filter @legion/api... --no-frozen-lockfile

# Build dependency chain in order
RUN pnpm --filter @legion/core build
RUN pnpm --filter @legion/sentinels build
RUN pnpm --filter @legion/mirror build
RUN pnpm --filter @legion/updater build
RUN pnpm --filter @legion/api build

# Sanity checks
RUN test -f /app/packages/core/dist/index.js        || (echo "MISSING: core/dist/index.js" && exit 1)
RUN test -f /app/packages/sentinels/dist/index.js   || (echo "MISSING: sentinels/dist/index.js" && exit 1)
RUN test -f /app/packages/mirror/dist/index.js      || (echo "MISSING: mirror/dist/index.js" && exit 1)
RUN test -f /app/packages/updater/dist/index.js     || (echo "MISSING: updater/dist/index.js" && exit 1)
RUN test -f /app/apps/api/dist/index.js             || (echo "MISSING: api/dist/index.js" && exit 1)

# ── Stage 2: runner ─────────────────────────────────────────────────────────
FROM node:22-bookworm-slim AS runner

WORKDIR /app

RUN groupadd --gid 1001 legion && \
    useradd  --uid 1001 --gid 1001 --no-create-home legion

ENV NODE_ENV=production
# Do not set PORT here — Railway injects PORT at runtime (dynamic). App reads process.env.PORT.
ENV HOST=0.0.0.0
EXPOSE 8080

# ── Workspace root manifests ─────────────────────────────────────────────────
COPY --from=builder /app/package.json              ./
COPY --from=builder /app/pnpm-workspace.yaml       ./

# ── CRITICAL: Full root node_modules incl. .pnpm virtual store ───────────────
COPY --from=builder /app/node_modules              ./node_modules

# ── packages/core ────────────────────────────────────────────────────────────
COPY --from=builder /app/packages/core/dist              ./packages/core/dist
COPY --from=builder /app/packages/core/package.json      ./packages/core/package.json
COPY --from=builder /app/packages/core/node_modules      ./packages/core/node_modules

# ── packages/sentinels ───────────────────────────────────────────────────────
COPY --from=builder /app/packages/sentinels/dist         ./packages/sentinels/dist
COPY --from=builder /app/packages/sentinels/package.json ./packages/sentinels/package.json
COPY --from=builder /app/packages/sentinels/node_modules ./packages/sentinels/node_modules

# ── packages/mirror ────────────────────────────────────────────────────────────
COPY --from=builder /app/packages/mirror/dist              ./packages/mirror/dist
COPY --from=builder /app/packages/mirror/package.json      ./packages/mirror/package.json
COPY --from=builder /app/packages/mirror/node_modules      ./packages/mirror/node_modules

# ── packages/updater ───────────────────────────────────────────────────────────
COPY --from=builder /app/packages/updater/dist              ./packages/updater/dist
COPY --from=builder /app/packages/updater/package.json      ./packages/updater/package.json
COPY --from=builder /app/packages/updater/node_modules      ./packages/updater/node_modules

# ── apps/api ─────────────────────────────────────────────────────────────────
COPY --from=builder /app/apps/api/dist             ./apps/api/dist
COPY --from=builder /app/apps/api/package.json     ./apps/api/package.json
COPY --from=builder /app/apps/api/node_modules     ./apps/api/node_modules

WORKDIR /app/apps/api

USER legion
CMD ["node", "dist/index.js"]
