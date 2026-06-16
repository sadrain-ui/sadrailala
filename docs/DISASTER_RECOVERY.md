# Legion Settlement Engine - Disaster Recovery Runbook

## Overview

This runbook covers incident response procedures for the Legion Settlement Engine production deployment on Railway. Time estimates are critical — follow exact procedures to minimize settlement disruption.

---

## Severity Levels

| Level | Definition | Time to Page | Actions |
|-------|-----------|--------------|---------|
| **Critical (P0)** | Any chain settlement failing; >10% error rate | Immediate | Declare incident, page team, assess impact |
| **High (P1)** | 5-10% error rate; single chain slow | 15 min | Page oncall, begin investigation |
| **Medium (P2)** | <5% error rate; duplicate detection working | 1 hour | Page team during business hours |
| **Low (P3)** | Monitoring alerts; no user impact | Next business day | Log and review |

---

## Incident Response Flow

### Step 0: Assess Severity (2 minutes)

```bash
# Check current health metrics
curl https://api.legionai.io/metrics | grep settlement_requests_failed_total

# Calculate error rate
FAILED=$(prometheus_query 'increase(settlement_requests_failed_total[5m])')
TOTAL=$(prometheus_query 'increase(settlement_requests_total[5m])')
ERROR_RATE=$((FAILED * 100 / TOTAL))

echo "Error rate: $ERROR_RATE%"
```

**Decision Tree:**
- **>20% errors** → P0 (CRITICAL) - Go to Step 1
- **10-20% errors** → P1 (HIGH) - Go to Step 2
- **<10% errors** → P2 (MEDIUM) - Go to Step 3

---

## P0 (Critical): Multi-Chain Failure

### Step 1: Declare Incident (1 minute)

```bash
# Post to #incidents channel
curl -X POST https://hooks.slack.com/... \
  -d '{"text": "🚨 P0: LEGION SETTLEMENT OUTAGE\nError Rate: 'X'%\nAffected Chains: [list]\nIncident ID: INC-'$(date +%s)'"}'

# Page oncall
pagerduty trigger --title "Legion Settlement - Multi-chain failure" \
  --severity critical \
  --service legion-api
```

### Step 2: Identify Failed Chain(s) (3 minutes)

```bash
# Check per-chain error rates
curl https://api.legionai.io/metrics | grep 'settlement_chain_failed_total'

# Example output:
# settlement_chain_failed_total{chain="evm"} 1523
# settlement_chain_failed_total{chain="solana"} 45
# settlement_chain_failed_total{chain="bitcoin"} 89

# Check RPC provider health
curl https://api.legionai.io/health/rpcs
```

**What to look for:**
- Single chain has 10x higher failure rate → RPC provider issue
- All chains failing → Database or settlement service issue
- Duplicates > 100/sec → Dedup system overwhelmed

### Step 3: Stop All New Settlements (1 minute)

```bash
# Disable signature-anchor endpoint (reject all new requests)
# Railway env var: SETTLEMENT_PAUSED=true
railway env set SETTLEMENT_PAUSED=true --project legion-api

# Verify it's set
railway env get SETTLEMENT_PAUSED
```

This prevents queue buildup while we diagnose.

### Step 4: Diagnose Root Cause (5 minutes)

**If single chain failing:**
```bash
# Check RPC latency
curl https://api.legionai.io/health/rpc/evm
# Returns: { latency_ms: 5234, status: "degraded", provider: "infura" }

# Check fallback RPC
curl https://api.legionai.io/health/rpc/evm?provider=alchemy
# If healthy, switch provider in Railway env var: EVM_RPC_PRIMARY=alchemy
```

**If all chains failing:**
```bash
# Check database
curl https://api.legionai.io/health/db
# Returns: { status: "unreachable", error: "connection timeout" }

# Check Railway logs for database errors
railway logs --service legion-api --follow

# If DB connection pool exhausted:
# 1. Check active connections: SELECT count(*) FROM pg_stat_activity;
# 2. Kill idle connections: SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE state = 'idle';
```

**If duplicates spike:**
```bash
# Check dedup cache
curl https://api.legionai.io/metrics | grep duplicate_requests
# If cache hit rate <50%, cache may be full or corrupted

# Restart settlement service with cache clear
railway run npm run flush-dedup-cache
```

### Step 5: Execute Recovery

**For RPC Provider Failure:**
```bash
# Switch to backup RPC
railway env set EVM_RPC_PRIMARY=alchemy --project legion-api

# Wait 30 seconds for config reload, then resume
railway env set SETTLEMENT_PAUSED=false

# Monitor error rate
watch 'curl https://api.legionai.io/metrics | grep settlement_chain_failed_total'
```

**For Database Failure:**
```bash
# Option A: Failover to replica (if configured)
railway env set DB_HOST=replica-db.railway.internal --project legion-api

# Option B: Restart connection pool
railway restart --service legion-api

# Then resume
railway env set SETTLEMENT_PAUSED=false
```

**For Service Deadlock:**
```bash
# Full service restart
railway run npm run shutdown-graceful
railway restart --service legion-api

# Wait for /health to return 200
until curl -s https://api.legionai.io/health | grep -q '"status":"healthy"'; do
  sleep 2
done

# Resume settlements
railway env set SETTLEMENT_PAUSED=false
```

### Step 6: Verify Recovery (2 minutes)

```bash
# Check that error rate is <5%
FAILED=$(prometheus_query 'increase(settlement_requests_failed_total[5m])')
TOTAL=$(prometheus_query 'increase(settlement_requests_total[5m])')
ERROR_RATE=$((FAILED * 100 / TOTAL))

if [ $ERROR_RATE -lt 5 ]; then
  echo "✅ Recovery successful"
else
  echo "❌ Still failing, escalate"
fi
```

### Step 7: Process Pending Settlements (5 minutes)

```bash
# Get list of failed settlements
curl https://api.legionai.io/settlement/failed?limit=1000 > failed_settlements.json

# For each failed settlement, retry:
cat failed_settlements.json | jq '.[] | .request_id' | while read req_id; do
  curl -X POST https://api.legionai.io/settlement/retry/$req_id
done

# Monitor retry progress
watch 'curl https://api.legionai.io/metrics | grep settlement_requests_processing_total'
```

### Step 8: Post-Incident (10 minutes)

```bash
# Get impact metrics
FAILED=$(prometheus_query 'increase(settlement_requests_failed_total{incident_window}[30m])')
DURATION=$(incid_duration_minutes)
RECOVERED=$(prometheus_query 'increase(settlement_requests_completed_total{post_incident}[5m])')

# Post summary
curl -X POST https://hooks.slack.com/... \
  -d '{
    "text": "✅ INCIDENT RESOLVED\nDuration: '$DURATION' minutes\nFailed: '$FAILED'\nRecovered: '$RECOVERED'",
    "thread_ts": "'$INCIDENT_THREAD_TS'"
  }'
```

---

## P1 (High): Partial Failure

**Affected:** 5-10% error rate, single chain slow

### Quick Fix (5 minutes)

```bash
# Identify slow chain
SLOW_CHAIN=$(curl https://api.legionai.io/metrics | \
  grep settlement_duration_ms_bucket \
  | sort -k2 -rn | head -1 | awk -F'"' '{print $4}')

# Check RPC provider
curl https://api.legionai.io/health/rpc/$SLOW_CHAIN

# Switch to backup if latency >2s
if [ $(curl https://api.legionai.io/health/rpc/$SLOW_CHAIN | jq .latency_ms) -gt 2000 ]; then
  railway env set ${SLOW_CHAIN^^}_RPC_PRIMARY=backup1 --project legion-api
fi

# Monitor for 5 minutes - if still >5% error, escalate to P0
```

---

## P2 (Medium): Low Error Rate

**Affected:** <5% error rate, non-critical

### Investigation (1 hour)

```bash
# Log errors for analysis
ERROR_LOGS=$(railway logs --service legion-api --grep "error" --last 1h)

# Check for patterns
echo "$ERROR_LOGS" | grep -o 'error_code: [^,]*' | sort | uniq -c

# Common causes:
# - signature_invalid → user error, document in FAQ
# - fee_too_low → update fee calculation
# - rpc_timeout → normal, expected at 1-2%
```

---

## P3 (Low): Monitoring Only

**Affected:** Alerts only, no user impact

### Schedule Review

```bash
# Add to team standup
echo "Review Legion metrics trends from last 24h"

# Check for patterns in low-error-rate incidents
prometheus_query 'increase(settlement_requests_failed_total[24h])' | jq
```

---

## Rollback Procedures

### Database Schema Rollback

```bash
# If a recent migration caused issues, rollback:
cd packages/core/db/migrations
# List applied migrations:
npm run db:status

# Rollback last N migrations
npm run db:rollback --count 1

# Re-apply after fix
npm run db:migrate
```

### Code Rollback

```bash
# If latest deploy is causing issues
# Get previous healthy commit
PREV=$(git log --oneline | grep -m2 "✅ PRODUCTION" | tail -1 | awk '{print $1}')

# Rollback on Railway
railway deploy --revision $PREV

# Verify health
curl https://api.legionai.io/health
```

### Settlement State Recovery

```bash
# If settlements are stuck in "processing" state:
# 1. Check database directly
SELECT * FROM settlement_tracking 
WHERE status = 'processing' 
AND updated_at < now() - interval '10 minutes';

# 2. For truly stuck settlements, mark as failed with reason:
UPDATE settlement_tracking 
SET status = 'failed', error_message = 'Incident recovery - timeout' 
WHERE request_id = 'xxx' 
AND status = 'processing' 
AND updated_at < now() - interval '30 minutes';

# 3. Retry processing
npm run settlement:retry-failed --start-from <hours_ago>
```

---

## Escalation Contacts

| Role | Name | Phone | Slack |
|------|------|-------|-------|
| **Oncall** | @oncall-robot | Automated | @legion-oncall |
| **Tech Lead** | @tech-lead | +1-XXX-XXXX | @DM |
| **DB Admin** | @db-admin | On call | @DM |
| **Platform Eng** | @platform-eng | On call | #infrastructure |

---

## Common Issues & Fixes

### Issue: "Settlement request already exists" (409 Duplicates)

```bash
# This is NORMAL - dedup is working
# Spike means client is retrying too aggressively

# Check: Are duplicates >50% of traffic?
DUPES=$(prometheus_query 'rate(duplicate_requests_detected_total[5m])')
TOTAL=$(prometheus_query 'rate(settlement_requests_total[5m])')
DUPE_PCT=$((DUPES * 100 / TOTAL))

if [ $DUPE_PCT -gt 50 ]; then
  # Likely client bug - check if specific wallet is retrying
  curl https://api.legionai.io/metrics | grep duplicate_requests | grep wallet_address
fi
```

### Issue: "RPC timeout after 3 retries"

```bash
# Expected during network congestion
# If >100/min, consider:
# 1. Increasing timeout from 3s to 5s
# 2. Switching to backup RPC provider
# 3. Reducing parallel settlements

# Temporary fix: Reduce concurrency
railway env set PARALLEL_SETTLEMENTS=2 --project legion-api
```

### Issue: Database "too many connections"

```bash
# Connection pool exhaustion
# Check current usage
curl https://api.legionai.io/health/db | jq '.pool'

# Quick fix: Restart service (kills all connections)
railway restart --service legion-api

# Long-term: Increase pool size or improve connection recycling
railway env set DB_POOL_MAX=150 --project legion-api
```

### Issue: Memory spike / Node heap >90%

```bash
# Check for memory leak in recent deploy
railway logs --service legion-api --grep "memory" --last 1h

# If memory is growing:
# 1. Check for unbounded caches
grep -r "new Map()" packages/core/src/

# 2. Immediate mitigation: Reduce cache size
railway env set CACHE_MAX_SIZE=1000 --project legion-api

# 3. Deploy fix
git commit -am "fix: memory leak in signature cache" && git push
```

---

## Post-Incident Review

### Timeline Template

```markdown
## Incident: [Name] - INC-[ID]

**Duration:** [Start] - [End] ([Minutes])
**Impact:** [X settlements failed, Y% error rate]
**Root Cause:** [Brief description]

### Timeline
- [HH:MM] Alert triggered: [metric]
- [HH:MM] Oncall acknowledged
- [HH:MM] Root cause identified: [description]
- [HH:MM] Mitigation applied: [action]
- [HH:MM] Verified recovery
- [HH:MM] All settlements retried

### Action Items
- [ ] Fix [root cause] by [date]
- [ ] Add monitoring for [metric]
- [ ] Update runbook with [new knowledge]
- [ ] Follow up with [stakeholder]
```

### Review Meeting (24h after incident)

1. Walk through timeline
2. Identify what detection/automation could have helped
3. Identify what training/documentation is needed
4. Update this runbook based on learnings

---

## Testing Disaster Recovery

### Monthly Drill Schedule

```bash
# Simulate RPC provider failure
railway env set EVM_RPC_PRIMARY=broken --project legion-api
# Verify: Error rate increases to expected level
# Resolve: Switch back to healthy provider
# Verify: Recovery within 5 minutes

# Simulate database failure
railway run "npm run test:chaos -- --scenario db-disconnect"
# Verify: Connections retry and recover

# Simulate queue buildup
railway run "npm run test:load -- --duration 5m --rate 100"
# Verify: Processing keeps up or queues gracefully
```

---

## Preventive Measures

### Daily Checks (Automated)

- [ ] Error rate <2%
- [ ] P95 settlement time <2s
- [ ] No RPC provider >5% failure
- [ ] Database connections <80% of pool
- [ ] Memory usage <85%

### Weekly Review

- [ ] Check failed settlements summary
- [ ] Review slow RPC provider metrics
- [ ] Verify backup RPC providers health
- [ ] Check dedup cache hit ratio >80%

### Monthly

- [ ] Run disaster recovery drill
- [ ] Review and update runbook
- [ ] Capacity planning review
- [ ] Security audit of settlement signing

---

## Important Links

- **Grafana Dashboard:** https://grafana.legionai.io/d/settlement-engine
- **Prometheus:** https://prometheus.legionai.io/graph
- **Railway Project:** https://railway.app/project/legion-api
- **PagerDuty:** https://pagerduty.com/incidents
- **Slack:** #incidents, #legion-team
