#!/usr/bin/env bash
# =============================================================================
# Session replay demonstration — SECURITY TRAINING ONLY
# =============================================================================
# Target reference: https://example.com
# Generated: 2026-06-03T23:26:55.594Z
#
# PURPOSE
#   Teach developers how HTTP session cookies can be replayed after capture.
#   This script prints example curl commands. It does NOT send requests or
#   replay sessions automatically.
#
# USAGE
#   cat replay-demo.sh          # read in terminal
#   bash replay-demo.sh         # prints training examples (no network replay)
#
# AUTHORIZED USE
#   Internal staging / security awareness training on systems you own only.
# =============================================================================

set -euo pipefail

echo ""
echo "=== Session hijacking awareness (documentation only) ==="
echo "Target: https://example.com"
echo "Local mirror: http://localhost:8080/"
echo ""
echo "No curl commands below are executed by this script."
echo "Copy examples manually only in authorized staging labs."
echo ""

cat <<EOF
--- Concept ---
If an attacker obtains a valid session cookie (e.g. from XSS, malware, or
insecure logging), they can replay it in a Cookie header to impersonate the
user until the session expires or is rotated.

--- Example 1: Baseline request (no session cookie) ---
# Expect 401/403 or login redirect on protected routes.

curl -sS -D - -o /dev/null \
  'https://example.com/dashboard'

--- Example 2: Hypothetical replay with a captured cookie ---
# Replace PASTE_STAGING_COOKIE with a value from YOUR staging logs only.
# Never use real user cookies from production.

curl -sS -D - -o /dev/null \
  -H 'Cookie: session=PASTE_STAGING_COOKIE' \
  'https://example.com/dashboard'

--- Example 3: Same idea via local QA mirror ---
# Useful when testing through docker compose on localhost.

curl -sS -D - -o /dev/null \
  -H 'Cookie: session=PASTE_STAGING_COOKIE' \
  'http://localhost:8080/dashboard'

--- Example 4: Inspecting Set-Cookie on login (staging lab) ---
curl -sS -D - -o /dev/null \
  -X POST \
  -H 'Content-Type: application/x-www-form-urlencoded' \
  --data 'username=training-user&password=training-password' \
  'https://example.com/login'

--- Developer mitigations ---
- Set-Cookie: HttpOnly; Secure; SameSite=Lax or Strict
- Rotate session ID on login, logout, and privilege elevation
- Short session TTL; prefer refresh-token patterns
- Never log raw Cookie headers in application logs
- Use CSRF tokens for state-changing requests
EOF

echo ""
echo "End of training examples."
exit 0
