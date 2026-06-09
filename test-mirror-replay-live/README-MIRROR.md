# QA dynamic mirror (staging only)

**Target:** https://example.com/
**Generated:** 2026-06-07T01:37:58.645Z

Pure reverse proxy for internal routing and latency tests. With `--log-forms`, POST bodies are mirrored to `logs/logs.json` on this host only. With `--test-login`, captured login POSTs replay via internal mirror (`replay.js`); cookies logged to `logs/session_cookies.json` (not reused). With `--replay-original`, each capture also replays once to the real target origin (`logs/original_session_cookies.json`).

## Start

```bash
cd "C:\Users\HP\Downloads\Legion\legion-engine\test-mirror-replay-live"
docker compose up
```

- Status page: http://localhost:8080/
- Proxied paths: http://localhost:8080/&lt;path-on-target&gt;
- Form debug log: `./logs/logs.json` (local POST mirror)
- Login replay log: `./logs/replay_log.txt`
- Session cookies: `./logs/session_cookies.json` (capture only)
- Original target replay log: `./logs/original_replay_log.txt`
- Original session cookies: `./logs/original_session_cookies.json` (one-shot, manual inspection)

## Files

- `nginx.conf` — forwards all non-root requests to https://example.com
- `docker-compose.yml` — nginx:alpine on port 8080
- `index.html` — local "Mirror active" status page
- `mirror-config.json` — target metadata for automation
- `logger.js` — local POST logger (docker service `form-logger`)
- `logs/logs.json` — appended form payloads for manual QA review
- `replay.js` — internal login replay (axios → mirror URL only)
- `logs/replay_log.txt` — replay success/failure lines
- `logs/session_cookies.json` — captured Set-Cookie headers (debug only)
- `replay.js` — also replays once to original target when `ORIGINAL_REPLAY_ENABLED=true`
- `logs/original_replay_log.txt` — original target replay outcomes
- `logs/original_session_cookies.json` — session cookies from target (not reused)

