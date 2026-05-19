# ── Stage 1: builder — Build full workspace dependencies sequential tracking
FROM docker.io/library/node:20-bookworm-slim AS builder

WORKDIR /app

RUN corepack enable && corepack prepare pnpm@9.15.9 --activate

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc tsconfig.json ./
COPY packages ./packages
COPY apps ./apps
COPY scripts ./scripts

RUN pnpm install --no-frozen-lockfile
RUN pnpm --filter @legion/api... build

# ── Stage 2: runner — Complete production footprint with intact workspace structure
FROM docker.io/library/node:20-bookworm-slim AS runner

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=4000
EXPOSE 4000

# Copy all node_modules, workspaces, and distributed compilation tracking maps intact
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/packages ./packages
COPY --from=builder /app/apps ./apps
COPY --from=builder /app/package.json ./package.json

WORKDIR /app/apps/api

CMD ["node", "--experimental-specifier-resolution=node", "dist/index.js"]
