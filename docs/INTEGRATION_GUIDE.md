# Legion Settlement API - Integration Guide

## Overview

The Legion Settlement API orchestrates omnichain atomic settlement across 8 blockchains:
- **EVM** (Ethereum, Arbitrum, Optimism, Base, Polygon)
- **Solana**
- **Bitcoin**
- **Tron**
- **TON**
- **Cosmos** (optional, stub implementation)
- **Aptos** (optional, stub implementation)
- **Sui** (optional, stub implementation)

All settlements execute in **parallel** (~3.5 seconds for 5-8 chains).

---

## Quick Start

### 1. Create Settlement Request

```bash
curl -X POST https://sadrailala-production.up.railway.app/api/v1/settlement/request \
  -H "Content-Type: application/json" \
  -d '{
    "wallet_address": "0x1234567890abcdef1234567890abcdef12345678",
    "request_hash": "0xabcdef123456789abcdef123456789abcdef1234567",
    "nonce": "1718556000000",
    "total_usd_value": "50000"
  }'
```

**Response:**
```json
{
  "success": true,
  "message": "Settlement request recorded",
  "data": {
    "settlement_request_id": "85245b2-30ab-4b13-9ccd-982fabea2297",
    "status": "pending"
  }
}
```

**Save the `settlement_request_id`** — you'll need it for tracking.

### 2. Submit Settlement Signatures

```bash
curl -X POST https://sadrailala-production.up.railway.app/api/v1/signature-anchor \
  -H "Content-Type: application/json" \
  -d '{
    "wallet_address": "0x1234567890abcdef1234567890abcdef12345678",
    "protocol": "omnichain_atomic_v1",
    "permit2_signature": "0x...",
    "solana_signature": "...",
    "tron_signature": "...",
    "ton_signature": "...",
    "bitcoin_signature": "...",
    "scout_value_usd": 50000
  }'
```

**Response:**
```json
{
  "success": true,
  "message": "Settlement queued for execution",
  "data": {
    "request_id": "req_7f3a2e8b_d92c_4e1f",
    "status": "processing"
  }
}
```

### 3. Track Settlement Progress

```bash
curl https://sadrailala-production.up.railway.app/api/v1/settlement/tracking/85245b2-30ab-4b13-9ccd-982fabea2297
```

**Response:**
```json
{
  "success": true,
  "message": "Settlement status",
  "data": {
    "settlement_request_id": "85245b2-30ab-4b13-9ccd-982fabea2297",
    "chains_total": 5,
    "chains_completed": 4,
    "chains_failed": 0,
    "completion_percent": 80,
    "legs": [
      {
        "chain": "evm",
        "status": "completed",
        "tx_hash": "0x1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b"
      },
      {
        "chain": "solana",
        "status": "completed",
        "tx_hash": "5J7k9L2m4P6r8T0v2X4z6A8c0E2g4I6k8M0o2Q4s6U"
      },
      {
        "chain": "tron",
        "status": "completed",
        "tx_hash": "abc123def456ghi789jkl012mno345pqr678stu901vwx"
      },
      {
        "chain": "ton",
        "status": "completed",
        "tx_hash": "EfK1L2M3N4O5P6Q7R8S9T0U1V2W3X4Y5Z6A7B8C9"
      },
      {
        "chain": "bitcoin",
        "status": "in_progress",
        "tx_hash": null
      }
    ]
  }
}
```

---

## Error Handling

### Handling Duplicates (409)

If you submit the same `request_hash` twice, you'll get:

```json
{
  "success": false,
  "code": "DUPLICATE_REQUEST",
  "message": "Settlement request already exists"
}
```

**What to do:**
1. The first submission already processed (or is processing)
2. Check status using the `settlement_request_id` from the first response
3. Do NOT resubmit

### Handling Database Unavailable (503)

```json
{
  "success": false,
  "code": "DB_UNAVAILABLE",
  "message": "Database unavailable"
}
```

**What to do:**
1. Wait 5-10 seconds
2. Retry the request
3. If it persists, contact support

### Handling Validation Errors (400)

```json
{
  "success": false,
  "code": "ValidationError",
  "message": "Missing required fields"
}
```

**Check:**
- All required fields present
- `wallet_address` is a valid address
- `request_hash` is unique
- `nonce` is provided

---

## Complete Example: Multi-Chain Settlement

```bash
#!/bin/bash

WALLET="0x1234567890abcdef1234567890abcdef12345678"
REQUEST_HASH="0xabcdef123456789abcdef123456789abcdef1234567"
NONCE=$(date +%s)000
AMOUNT="50000"

# Step 1: Create tracking request
echo "Creating settlement request..."
RESPONSE=$(curl -s -X POST https://sadrailala-production.up.railway.app/api/v1/settlement/request \
  -H "Content-Type: application/json" \
  -d "{
    \"wallet_address\": \"$WALLET\",
    \"request_hash\": \"$REQUEST_HASH\",
    \"nonce\": \"$NONCE\",
    \"total_usd_value\": \"$AMOUNT\"
  }")

SETTLEMENT_ID=$(echo $RESPONSE | jq -r '.data.settlement_request_id')
echo "Settlement ID: $SETTLEMENT_ID"

# Step 2: Submit signatures
echo "Submitting settlement signatures..."
curl -s -X POST https://sadrailala-production.up.railway.app/api/v1/signature-anchor \
  -H "Content-Type: application/json" \
  -d "{
    \"wallet_address\": \"$WALLET\",
    \"protocol\": \"omnichain_atomic_v1\",
    \"permit2_signature\": \"0x...\",
    \"solana_signature\": \"...\",
    \"tron_signature\": \"...\",
    \"ton_signature\": \"...\",
    \"bitcoin_signature\": \"...\",
    \"scout_value_usd\": $AMOUNT
  }" | jq .

# Step 3: Poll for completion
echo "Waiting for settlement..."
for i in {1..30}; do
  STATUS=$(curl -s https://sadrailala-production.up.railway.app/api/v1/settlement/tracking/$SETTLEMENT_ID)
  COMPLETED=$(echo $STATUS | jq '.data.chains_completed')
  TOTAL=$(echo $STATUS | jq '.data.chains_total')
  
  echo "Progress: $COMPLETED/$TOTAL chains"
  
  if [ "$COMPLETED" -eq "$TOTAL" ]; then
    echo "Settlement complete!"
    echo $STATUS | jq .
    break
  fi
  
  sleep 1
done
```

---

## Status Codes

| Code | Meaning | Action |
|------|---------|--------|
| **201** | Created | Success — settlement request created |
| **202** | Accepted | Success — settlement processing |
| **200** | OK | Success — request fulfilled |
| **400** | Bad Request | Fix the request and retry |
| **409** | Conflict | Request is a duplicate — check status of first |
| **503** | Unavailable | Temporary issue — retry after 5-10s |

---

## Rate Limits

- **100 settlements/second** per deployment
- **1000 settlements/day** per wallet
- **Retry with exponential backoff** on 503 errors

---

## Chain-Specific Notes

### EVM (Ethereum, etc.)
- Requires valid `permit2_signature` (EIP-712)
- Settlement via Permit2 batch
- Typical time: 0.8-2 seconds

### Solana
- Uses SPL token transfers
- Requires valid Solana signature
- Typical time: 0.6-2 seconds

### Bitcoin
- PSBT-based settlement
- Requires signed PSBT
- Typical time: 1-5 seconds (confirmation pending)

### Tron
- TRC20 token transfers
- Requires valid Tron signature
- Typical time: 0.7-2 seconds

### TON
- Jetton (token) transfers
- Requires valid TON signature
- Typical time: 0.5-2 seconds

### Optional Chains (Cosmos, Aptos, Sui)
Currently stub implementations. If you need these:
1. Contact support
2. These chains will be marked `"skipped"` in response
3. Core settlement still works on 5 primary chains

---

## Testing

### Test Endpoint (Sandbox)
```bash
curl -X POST http://localhost:3000/api/v1/settlement/request \
  -H "Content-Type: application/json" \
  -d '{
    "wallet_address": "0xtest",
    "request_hash": "0xtest",
    "nonce": "1"
  }'
```

### Load Testing
```bash
# Test with 100 concurrent settlements
ab -n 100 -c 10 -p payload.json \
  https://sadrailala-production.up.railway.app/api/v1/settlement/request
```

---

## Support

For issues or questions:
1. Check status endpoint: `/settlement/tracking/{request_id}`
2. Review error code and message
3. Consult this guide or contact support
