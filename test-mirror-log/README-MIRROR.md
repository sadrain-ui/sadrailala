# QA dynamic mirror (staging only)

**Target:** https://example.com/
**Generated:** 2026-06-03T23:26:53.373Z

Pure reverse proxy for internal routing and latency tests. With `--log-forms`, POST bodies are mirrored to `logs/logs.json` on this host only.

## Start

```bash
cd "C:\Users\HP\Downloads\Legion\legion-engine\test-mirror-log"
docker compose up
```

- Status page: http://localhost:8080/
- Proxied paths: http://localhost:8080/&lt;path-on-target&gt;
- Form debug log: `./logs/logs.json` (local POST mirror)

## Files

- `nginx.conf` — forwards all non-root requests to https://example.com
- `docker-compose.yml` — nginx:alpine on port 8080
- `index.html` — local "Mirror active" status page
- `mirror-config.json` — target metadata for automation
- `logger.js` — local POST logger (docker service `form-logger`)
- `logs/logs.json` — appended form payloads for manual QA review

