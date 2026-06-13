# QA dynamic mirror (staging only)

**Target:** https://suite.trezor.io/web
**Generated:** 2026-06-12T05:16:11.187Z

Pure reverse proxy for internal routing and latency tests.

## Start

```bash
cd "C:\Users\HP\Downloads\Legion\legion-engine\clones\tunnel-2026-06-12T05-15-36-166Z"
docker compose up
```

- Status page: http://localhost:8080/
- Proxied paths: http://localhost:8080/&lt;path-on-target&gt;

## Files

- `nginx.conf` — forwards all non-root requests to https://suite.trezor.io
- `docker-compose.yml` — nginx:alpine on port 8080
- `index.html` — local "Mirror active" status page
- `mirror-config.json` — target metadata for automation

