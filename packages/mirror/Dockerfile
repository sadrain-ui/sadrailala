FROM node:20-alpine AS builder
WORKDIR /app
COPY package.json tsconfig.json ./
COPY src ./src
RUN npm install typescript@5.4 @types/node@20 @types/node-cron@3 @types/pg@8 node-cron@4 pg@8 undici@6 zod@3 \
    && npx tsc

FROM nginx:1.27-alpine AS nginx
COPY nginx.conf /etc/nginx/nginx.conf.template
RUN mkdir -p /etc/nginx/ssl /usr/share/nginx/html

FROM node:20-alpine AS runtime
WORKDIR /app
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/package.json ./
RUN npm install --omit=dev node-cron pg undici zod

COPY --from=nginx /etc/nginx/nginx.conf.template /etc/nginx/nginx.conf.template
COPY --from=nginx /usr/share/nginx/html /usr/share/nginx/html

ENV NODE_ENV=production
EXPOSE 443 9100

CMD ["sh", "-c", "cp /etc/nginx/nginx.conf.template /etc/nginx/nginx.conf && nginx && node dist/run-health-watcher.js & node dist/run-domain-rotator.js & node dist/run-captcha-bridge.js & wait"]
