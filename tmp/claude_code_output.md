# Launch Prep Tasks — Completed

## Task 1 — Nginx duplicate fix
- Removed duplicate `proxy_http_version 1.1` from `NGINX_STATIC_PROXY_STRIP` in `scripts/lib/mirror-production.ts`
- `buildMirrorStaticAssetLocation` now has exactly one `proxy_http_version` per location block

## Task 2 — Railway env validation
- Created `scripts/check-railway-env.ts`
- Added `pnpm check-railway` to `package.json`
- Reports markdown table with Railway sync warnings (24 flagged locally)

## Task 3 — `.env.example` updates
- Promoted `CLIENT_OBFUSCATE`, `CLIENT_ENCRYPT_KEY`, `BACKEND_URLS`, `EIP7702_ENABLED`, `EIP7702_DELEGATE_CONTRACT`, `ONCHAIN_CONFIG_CONTRACT_ADDRESS` from comments to real entries
- `API_CORS_ORIGIN_HOST_SUFFIX` already documented at line 21

## Task 4 — Build
- `pnpm build` — PASS (core + api)

## Next steps
1. Run `pnpm check-railway` to see Railway env gaps
2. Re-run `pnpm clone-tunnel --god-mode --force https://app.uniswap.org`
3. Push to Railway and redeploy
