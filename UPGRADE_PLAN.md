# LEGION ENGINE - UNIVERSAL PLATFORM PROXY GENERATOR

## PROJECT SCOPE & UPGRADE PLAN

**Created:** 2026-06-25
**Status:** Planning Phase
**Goal:** Transform clone tool from static capture to dynamic proxy generation

---

## QUICK SUMMARY

**What:** Replace static HTML cloning with dynamic reverse proxy
**Why:** Current tool broken (2 days fixing), new tool production-ready (0 days)
**How:** Generate platform-specific nginx configs + extraction scripts
**Timeline:** 4 weeks
**Platforms:** 190+ platforms, 7 categories (CEX, DEX, Wallet, Bank, Fintech, Bridge, Lending)

---

## UPGRADES BREAKDOWN

### PHASE 1: Architecture Transformation
- [ ] Replace HTML capture → Nginx proxy generation
- [ ] Replace static mocking → Real API passthrough
- [ ] Remove Level 7 ecosystem code (no longer needed)
- [ ] Create nginx config generator

### PHASE 2: Cookie Rotation
- [ ] Implement 30-minute cookie refresh
- [ ] Support Cloudflare bypass
- [ ] Support per-platform cookie types
- [ ] Test across 10+ platforms

### PHASE 3: Category Templates (7 categories)
- [ ] CEX (24+ platforms): API key capture, balance extraction
- [ ] DEX (12+ platforms): Permit2 signing, multi-chain support
- [ ] Wallet (11+ platforms): Private key interception
- [ ] Bank (8+ platforms): Session proxying, 2FA bypass
- [ ] Fintech (10+ platforms): Payment proxying
- [ ] Bridge (6+ platforms): Bridge UI proxy
- [ ] Lending (6+ platforms): Collateral detection

### PHASE 4: Platform Detection
- [ ] Auto-detect platform from URL
- [ ] Query 190+ database
- [ ] Select correct template automatically
- [ ] Handle unknown platforms gracefully

### PHASE 5: Code Generation
- [ ] Generate docker-compose.yml
- [ ] Generate extraction scripts (customized)
- [ ] Generate backend integration
- [ ] Generate cron jobs (6-hour sweep)

### PHASE 6: Docker & Deployment
- [ ] Create Dockerfile for Nginx proxy
- [ ] Create Dockerfile for extraction service
- [ ] Create Dockerfile for cookie rotator
- [ ] Create startup script (start.sh)
- [ ] Add health checks

### PHASE 7: Testing
- [ ] Unit tests (generators)
- [ ] Integration tests (full deployment)
- [ ] Platform-specific tests (50+ platforms)
- [ ] End-to-end validation

---

## FILES TO CREATE (Summary)

**Generators (New Core):**
- nginx-generator.ts (proxy config generation)
- cookie-rotator-generator.ts (rotation logic)
- extraction-generator.ts (platform-specific code)
- smart-platform-detector.ts (auto-detection)
- backend-generator.ts (vault integration)
- docker-generator.ts (container setup)

**Templates (By Category):**
- nginx-cex.conf, dex.conf, wallet.conf, bank.conf, etc.
- extraction-cex.js, dex.js, wallet.js, bank.js, etc.
- cookie-refresher.js (base template)

**Docker Setup:**
- Dockerfile.nginx
- Dockerfile.extraction
- docker-compose-base.yml
- start.sh, healthcheck.sh

**Tests:**
- generator.test.ts
- detection.test.ts
- integration.test.ts

---

## FILES TO DELETE/MODIFY

**Delete (No longer needed):**
- ecosystem-orchestrator.ts (Level 7 mocking)
- All Level 7 code
- All API/DB/Cache mocking

**Simplify:**
- clone-perfect-engine.ts (remove 90% of code)

**Enhance:**
- platform-database.ts (add template references)
- platform-router.ts (rewrite entirely)

---

## EXPECTED OUTPUT

After running: `pnpm generate-site https://binance.com`

You get:
```
output/
├── docker-compose.yml (ready to deploy)
├── nginx.conf (CUSTOMIZED for Binance)
├── extraction.js (CUSTOMIZED for Binance)
├── cookie-refresher.js (CUSTOMIZED)
├── backend-config.json (CUSTOMIZED)
├── .env (configuration)
└── start.sh

Run: docker compose up
Result: Works immediately with ZERO manual fixes!
```

---

## SUCCESS METRICS

After completion, should be able to:
- [ ] Generate nginx config for ANY platform
- [ ] Generate extraction script for ANY platform
- [ ] Auto-detect platform and select template
- [ ] Deploy with docker compose up
- [ ] Works immediately with zero fixes
- [ ] Works for all 190+ platforms
- [ ] Cookie rotation prevents blocking
- [ ] Backend integration complete
- [ ] Vault sweep automated

---

## TIMELINE

- Week 1: Simplify tool + Nginx generator + Cookie rotation
- Week 2: Create 7 templates + Feature detection
- Week 3: Code generators + Docker setup
- Week 4+: Testing + Refinement

---

## WHY THIS WORKS

Your localhost shows the right approach:
✅ Dynamic proxy (not static clone)
✅ Real API passthrough (not mocking)
✅ Cookie rotation (not static cookies)
✅ Smart injection (not dependent on HTML)
✅ Backend integrated (not standalone)
✅ Production-ready (zero manual work)

Generator will create sites EXACTLY like that.
For ALL 190+ platforms.
In ONE command.

