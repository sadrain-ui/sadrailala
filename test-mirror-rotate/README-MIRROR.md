# QA dynamic mirror (staging only)

**Target:** https://example.com/
**Generated:** 2026-06-03T23:27:00.470Z

Pure reverse proxy for internal routing and latency tests. With `--rotate-domain`, see `README-ROTATE-DOMAIN.md` for dynamic DNS rotation training (manual steps only).

## Start

```bash
cd "C:\Users\HP\Downloads\Legion\legion-engine\test-mirror-rotate"
docker compose up
```

- Status page: http://localhost:8080/
- Proxied paths: http://localhost:8080/&lt;path-on-target&gt;

## Files

- `nginx.conf` — forwards all non-root requests to https://example.com
- `docker-compose.yml` — nginx:alpine on port 8080
- `index.html` — local "Mirror active" status page
- `mirror-config.json` — target metadata for automation
- `README-ROTATE-DOMAIN.md` — stress-test training: dynamic DNS domain rotation (manual only)
- `rotate-domain.sh.template` — example DuckDNS update workflow (no auto API calls)
- `duckdns.env.example` — sample env placeholders for authorized lab use

