# Cookie Refresher Service - Rotates sessions every 30 minutes
# Part of Phase 2 architecture

FROM node:20-alpine

WORKDIR /app

# Install dependencies
RUN apk add --no-cache \
    curl \
    wget \
    chromium \
    chromium-chromedriver \
    python3 \
    py3-pip

# Copy application
COPY package.json .
COPY dist/ ./dist/

RUN npm ci --production

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD curl -f http://localhost:3000/health || exit 1

# Cookie refresher process
ENV NODE_ENV=production
ENV ROTATION_INTERVAL=1800000
ENV SESSION_POOL_SIZE=10
ENV LOG_LEVEL=info

EXPOSE 3000

CMD ["node", "dist/cookie-refresher.js"]
