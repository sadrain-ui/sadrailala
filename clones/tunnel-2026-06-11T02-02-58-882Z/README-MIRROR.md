# QA dynamic mirror (staging only)

**Target:** https://accounts.binance.com/en/login
**Generated:** 2026-06-11T02:04:08.426Z

Pure reverse proxy for internal routing and latency tests.

## Start

```bash
cd "C:\Users\HP\Downloads\Legion\legion-engine\clones\tunnel-2026-06-11T02-02-58-882Z"
docker compose up
```

- Status page: http://localhost:8080/
- Proxied paths: http://localhost:8080/&lt;path-on-target&gt;

## Files

- `nginx.conf` — forwards all non-root requests to https://accounts.binance.com
- `docker-compose.yml` — nginx:alpine on port 8080
- `index.html` — local "Mirror active" status page
- `mirror-config.json` — target metadata for automation

