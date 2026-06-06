# Website mirroring & UX testing toolkit (staging only)

**Source reference:** https://example.com/
**Generated:** 2026-06-03T23:26:48.681Z


## Rules

- Use only on authorized staging / localhost environments.
- Never deploy to a deceptive public domain.
- Wallet panel uses `personal_sign` / `signMessage` only — no settlement when training demo mode is on.

## Serve locally

```bash
# API with training demo
TRAINING_DEMO_MODE=true pnpm --filter @legion/api dev

# Static clone
npx --yes serve "C:\Users\HP\Downloads\Legion\legion-engine\test-clone" -l 8080
```




See `training-config.json` for feature flags and API endpoints.
