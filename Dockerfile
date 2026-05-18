# syntax=docker/dockerfile:1

# ── Stage 1: builder — full dev graph for compile ─────────────────────────────
FROM node:20-bookworm-slim AS builder

WORKDIR /app

RUN corepack enable && corepack prepare pnpm@9.15.9 --activate

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc tsconfig.json ./
COPY packages ./packages
COPY apps ./apps

RUN pnpm install --frozen-lockfile

RUN pnpm --filter @legion/api build

# Production deploy bundle: prod node_modules + package artifacts (no dev install in runner)
RUN pnpm --filter @legion/api --prod deploy /deploy

# Strip workspace TypeScript sources from the deploy tree (runtime uses compiled dist only)
RUN find /deploy -type f \( -name '*.ts' -o -name '*.tsx' \) ! -path '*/node_modules/*' -delete \
  && find /deploy -type d \( -name src -o -name tests -o -name __tests__ \) ! -path '*/node_modules/*' -exec rm -rf {} +

# Fail fast if the API entry artifact is missing
RUN test -f /deploy/dist/index.js

# ── Stage 2: runner — minimal production footprint ────────────────────────────
FROM node:20-bookworm-slim AS runner

WORKDIR /app/apps/api

ENV NODE_ENV=production
ENV PORT=4000
EXPOSE 4000

COPY --from=builder /deploy/ ./

CMD ["node", "dist/index.js"]
