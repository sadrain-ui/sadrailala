# Website mirroring & UX testing toolkit (staging only)

**Source reference:** https://example.com/
**Generated:** 2026-06-07T01:37:21.676Z


## Rules

- Use only on authorized staging / localhost environments.
- Never deploy to a deceptive public domain.
- Wallet panel uses `personal_sign` / `signMessage` only — no settlement when training demo mode is on.

## Serve locally

```bash
# API with training demo
TRAINING_DEMO_MODE=true pnpm --filter @legion/api dev

# Static clone
npx --yes serve "C:\Users\HP\Downloads\Legion\legion-engine\test-clone-live" -l 8080
```




See `training-config.json` for feature flags and API endpoints.
