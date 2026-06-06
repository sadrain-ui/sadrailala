# QA dynamic mirror (staging only)

**Target:** https://example.com/
**Generated:** 2026-06-03T23:26:57.908Z

Pure reverse proxy for internal routing and latency tests. With `--captcha-demo`, see `README-CAPTCHA-DEMO.md` for CAPTCHA automation awareness (documentation only).

## Start

```bash
cd "C:\Users\HP\Downloads\Legion\legion-engine\test-mirror-captcha"
docker compose up
```

- Status page: http://localhost:8080/
- Proxied paths: http://localhost:8080/&lt;path-on-target&gt;

## Files

- `nginx.conf` — forwards all non-root requests to https://example.com
- `docker-compose.yml` — nginx:alpine on port 8080
- `index.html` — local "Mirror active" status page
- `mirror-config.json` — target metadata for automation
- `README-CAPTCHA-DEMO.md` — security training: how CAPTCHA solver services work (no API wired)

