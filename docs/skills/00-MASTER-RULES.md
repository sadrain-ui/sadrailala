# SKILL-00: MASTER RULES — Legion Engine Skills Index

## [STRICT_RULES] — READ THIS FIRST
```
PRIORITY: SUPREME
SCOPE: All code in @packages/core, @packages/api, @apps/*
OVERRIDES: All default AI patterns

RULE-00-A: This file is the INDEX. Before writing ANY function,
           check the FILE OWNERSHIP MAP in .cursorrules and load
           the correct skill files. Never skip this step.

RULE-00-B: Skills are CONSTRAINTS, not suggestions. If a skill
           says "use undici", using fetch is a VIOLATION.

RULE-00-C: When in doubt about which skill applies, check
           PRIORITY HIERARCHY in .cursorrules. Higher number
           = applied LAST (lowest priority).

RULE-00-D: Every function completion requires the Resilience &
           Stealth Audit checklist from .cursorrules to be passed.
```

---

## Skills Index

| File | Skill | Applies To | Priority |
|---|---|---|---|
| 01-concurrency.md | High-Speed Concurrency | All I/O-heavy code | 8 (lowest) |
| 02-stealth.md | Apex Stealth | All HTTP/RPC calls | 3 |
| 03-evm-math.md | EVM Assembly/Math | Simulation, gas, BigInt | 7 |
| 04-mev-bundles.md | Advanced MEV Logic | Flashbots, Jito, bundles | 5 |
| 05-honeypot-rugcheck.md | Honeypot & Rug-Check | Token scanning (Shadow) | 4 |
| 06-liquidity-pathfinding.md | Liquidity Path-Finding | Route discovery (Scout) | 6 |
| 07-nonstandard-tokens.md | Non-Standard Token Handling | Closer, token approvals | 4 |
| 08-tx-resilience.md | TX Resilience | Dispatcher, NonceManager | 2 |
| 09-ghost-fail-hardening.md | Ghost-Fail Prevention | Post-strike verification | 1 (highest) |

---

## Skill Loading Protocol

When Cursor writes a function, it MUST:

```
1. Identify which Sentinel owns the function
   Scout / Gatekeeper / Mask / Closer / Shadow / Dispatcher

2. Load FILE OWNERSHIP MAP from .cursorrules
   → Which @docs/research/*.md files to read?
   → Which skill numbers apply?

3. Load the skill files (this folder)
   → Read [STRICT_RULES] section of each skill
   → Apply constraints in PRIORITY ORDER (09 first, 01 last)

4. Write the function
   → Only AFTER steps 1-3 are complete

5. Run Resilience & Stealth Audit (from .cursorrules)
   → All 10 checkboxes must pass
   → Only THEN mark function complete
```

---

## Sentinel → Primary Skills Map

```
Scout     → Skills: 01 (concurrency), 02 (stealth), 06 (pathfinding)
Gatekeeper → Skills: 05 (honeypot), 06 (pathfinding), 03 (evm-math)
Mask      → Skills: 02 (stealth), 08 (resilience)
Closer    → Skills: 07 (nonstandard tokens), 08 (resilience)
Shadow    → Skills: 05 (honeypot), 03 (evm-math), 09 (ghost-fail)
Dispatcher → Skills: 04 (mev), 08 (resilience), 09 (ghost-fail)
```

---

## Common Anti-Patterns (DO NOT DO)

| Anti-Pattern | Correct Pattern | Skill |
|---|---|---|
| `axios.get(rpcUrl)` | `undici Pool` with connection reuse | 01, 02 |
| `await Promise.all(heavyWork)` | Piscina worker pool | 01 |
| `ethers.providers.JsonRpcProvider` | `createPublicClient` (Viem) | .cursorrules |
| Skip simulation, just broadcast | Shadow.simulate() first | 09 |
| `token.transfer(to, amount)` | Delta check + SafeERC20 | 07 |
| `nonce = await getNonce()` inline | NonceManager.acquire() | 08 |
| `catch(e) { }` empty catch | LegionError emit + log | .cursorrules |
| `JSON.stringify(bigData)` in loop | fast-json-stringify compiled | 01 |
| Direct IP RPC call | Proxy mesh + TLS rotation | 02 |
| Mark lane Settled after tx hash | Post-strike balance verify | 09 |
