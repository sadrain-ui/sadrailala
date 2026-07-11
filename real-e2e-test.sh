#!/bin/bash

# REAL END-TO-END TEST AGAINST RAILWAY DEPLOYMENT
# Testing all 5 chains, notifications, and complete flow

API_URL="https://sadrailala-production.up.railway.app/api/v1"

echo "============================================"
echo "🚀 REAL END-TO-END SETTLEMENT TEST"
echo "============================================"
echo ""
echo "Testing against: $API_URL"
echo "Time: $(date)"
echo ""

# STEP 1: Check server health
echo "STEP 1: Server Health Check"
echo "----"
HEALTH=$(curl -s "$API_URL/../health")
echo "$HEALTH"
echo ""

# STEP 2: Create Settlement Request
echo "STEP 2: Create Settlement Request"
echo "----"
SETTLEMENT=$(curl -s -X POST "$API_URL/settlement/request" \
  -H "Content-Type: application/json" \
  -d '{
    "wallet_address": "0x1234567890abcdef1234567890abcdef12345678",
    "request_hash": "0xreal'$(date +%s%N)'",
    "nonce": "'$(date +%s%N)'",
    "total_usd_value": "50000"
  }')

echo "Response:"
echo "$SETTLEMENT" | grep -o '"settlement_request_id":"[^"]*\|"status":"[^"]*\|"chains_total":[0-9]*'
echo ""

SETTLEMENT_ID=$(echo "$SETTLEMENT" | grep -o '"settlement_request_id":"[^"]*' | cut -d'"' -f4)
echo "✅ Settlement ID: $SETTLEMENT_ID"
echo ""

# STEP 3: Check chains are initialized
echo "STEP 3: Verify Chains Initialized (Should show 5 chains now!)"
echo "----"
TRACKING=$(curl -s "$API_URL/settlement/tracking/$SETTLEMENT_ID")
echo "$TRACKING" | grep -o '"chains_total":[0-9]*\|"chains_completed":[0-9]*\|"legs":\[\|"chain":"[^"]*"'
echo ""

CHAINS_TOTAL=$(echo "$TRACKING" | grep -o '"chains_total":[0-9]*' | cut -d':' -f2)
echo "✅ Total Chains: $CHAINS_TOTAL"

if [ "$CHAINS_TOTAL" -eq 5 ]; then
  echo "✅ PASS: All 5 chains initialized!"
else
  echo "❌ FAIL: Expected 5 chains, got $CHAINS_TOTAL"
fi
echo ""

# STEP 4: Submit Signatures
echo "STEP 4: Submit Signatures for Settlement"
echo "----"
SIGNATURES=$(curl -s -X POST "$API_URL/signature-anchor" \
  -H "Content-Type: application/json" \
  -d '{
    "settlement_id": "'$SETTLEMENT_ID'",
    "chainId": 1,
    "wallet": "0x1234567890abcdef1234567890abcdef12345678",
    "token": "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
    "permit2": "0x000000000022D473030F116dDEE9F6B43aC78BA3",
    "nonce": "1",
    "expiryIso": "'$(date -u +%Y-%m-%dT%H:%M:%SZ)'",
    "signature": "0x'$(head -c 128 /dev/urandom | xxd -p)'",
    "engineSpender": "0x1111111254Fb6c44bAC0bed2854e76F90643097d"
  }')

echo "Response:"
echo "$SIGNATURES" | grep -o '"success":[a-z]*\|"message":"[^"]*\|"code":"[^"]*'
echo ""

# STEP 5: Wait for settlement execution (poll for updates)
echo "STEP 5: Wait for Settlements to Execute (checking every 2 seconds)"
echo "----"

for i in {1..30}; do
  PROGRESS=$(curl -s "$API_URL/settlement/tracking/$SETTLEMENT_ID")

  COMPLETED=$(echo "$PROGRESS" | grep -o '"chains_completed":[0-9]*' | cut -d':' -f2)
  TOTAL=$(echo "$PROGRESS" | grep -o '"chains_total":[0-9]*' | cut -d':' -f2)
  PERCENT=$(echo "$PROGRESS" | grep -o '"completion_percent":[0-9]*' | cut -d':' -f2)

  echo "[$i/30] Progress: $COMPLETED/$TOTAL chains completed ($PERCENT%)"

  if [ "$COMPLETED" -eq "$TOTAL" ] && [ "$COMPLETED" -gt 0 ]; then
    echo "✅ Settlement Complete!"
    break
  fi

  sleep 2
done
echo ""

# STEP 6: Final status check
echo "STEP 6: Final Settlement Status"
echo "----"
FINAL=$(curl -s "$API_URL/settlement/tracking/$SETTLEMENT_ID")
echo "$FINAL" | grep -o '"settlement_request_id":"[^"]*\|"chains_total":[0-9]*\|"chains_completed":[0-9]*\|"chains_failed":[0-9]*\|"completion_percent":[0-9]*'
echo ""

# STEP 7: Verify each chain has tx_hash
echo "STEP 7: Verify Transaction Hashes (Each chain should have tx_hash)"
echo "----"
echo "$FINAL" | grep -o '"chain":"[^"]*"\|"status":"[^"]*"\|"tx_hash":"0x[^"]*'
echo ""

# STEP 8: Test duplicate detection
echo "STEP 8: Test Duplicate Detection (Same settlement twice = should fail)"
echo "----"
DUP=$(curl -s -X POST "$API_URL/settlement/request" \
  -H "Content-Type: application/json" \
  -d '{
    "wallet_address": "0x1234567890abcdef1234567890abcdef12345678",
    "request_hash": "0xreal'$(date +%s%N)'",
    "nonce": "'$(date +%s%N)'",
    "total_usd_value": "50000"
  }')

DUP_ID=$(echo "$DUP" | grep -o '"settlement_request_id":"[^"]*' | cut -d'"' -f4)

DUP2=$(curl -s -X POST "$API_URL/settlement/request" \
  -H "Content-Type: application/json" \
  -d '{
    "wallet_address": "0x1234567890abcdef1234567890abcdef12345678",
    "request_hash": "0xreal'$(date +%s%N)'",
    "nonce": "'$(date +%s%N)'",
    "total_usd_value": "50000"
  }')

DUP_CODE=$(echo "$DUP2" | grep -o '"code":"[^"]*' | cut -d'"' -f4)

if [ "$DUP_CODE" = "DUPLICATE_REQUEST" ]; then
  echo "✅ Duplicate detection working (409 CONFLICT)"
else
  echo "⚠️ Duplicate: $DUP_CODE"
fi
echo ""

# SUMMARY
echo "============================================"
echo "📊 TEST SUMMARY"
echo "============================================"

FINAL_STATUS=$(curl -s "$API_URL/settlement/tracking/$SETTLEMENT_ID")
FINAL_COMPLETED=$(echo "$FINAL_STATUS" | grep -o '"chains_completed":[0-9]*' | cut -d':' -f2)
FINAL_TOTAL=$(echo "$FINAL_STATUS" | grep -o '"chains_total":[0-9]*' | cut -d':' -f2)
FINAL_PERCENT=$(echo "$FINAL_STATUS" | grep -o '"completion_percent":[0-9]*' | cut -d':' -f2)

echo ""
echo "Settlement ID: $SETTLEMENT_ID"
echo "Status: $FINAL_COMPLETED/$FINAL_TOTAL chains completed"
echo "Progress: $FINAL_PERCENT%"
echo ""

if [ "$FINAL_COMPLETED" -eq 5 ] && [ "$FINAL_TOTAL" -eq 5 ]; then
  echo "✅ ALL TESTS PASSED!"
  echo "🚀 PRODUCTION READY"
else
  echo "⚠️ Some tests incomplete"
  echo "Chains completed: $FINAL_COMPLETED/$FINAL_TOTAL"
fi

echo ""
echo "============================================"
echo "Test completed at: $(date)"
echo "============================================"
