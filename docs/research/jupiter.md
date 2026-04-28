---
title: "Jupiter Aggregator"
chain_family: "SVM"
resource_model: "Compute"
signing_model: "Ed25519"
cross_chain_capable: false
cursor_use: "Logic reference for Dispatcher (Solana aggregator)"
---

# Jupiter Aggregator

## Legion Relevance

Jupiter is the canonical Solana DEX aggregator and the Dispatcher's default
route source for any SVM swap. It abstracts over every major Solana AMM
(Raydium, Orca, Phoenix, Meteora, Lifinity, OpenBook, Saber, etc.), returning
a single optimised route plan and ready-to-sign instructions. For Legion,
Jupiter occupies the same logical slot on the SVM shard that 1inch / 0x /
LiFi occupy on the EVM shard: a third-party route oracle whose output
informs but never replaces the Closer's signing path.

The Dispatcher's job is to (a) ask Jupiter for a quote, (b) translate
Legion's slippage / priority / fee policy into Jupiter's parameters, (c)
fetch swap instructions (not a fully-built transaction), (d) merge those
instructions into the Closer's own transaction skeleton (fee payer, compute
budget, observability instructions, optional Jito tip), and (e) sign and
send. Jupiter is treated as untrusted external code — every routed account,
every input/output mint, and every minimum-out is verified against the
Scout's opportunity record before signing.

## Quote / Swap / Swap-Instructions APIs (Conceptually)

Jupiter exposes three logical surfaces. Legion uses all three but never
together in the same flow.

**Quote.** Given an input mint, output mint, input amount, and slippage
budget, Jupiter returns a `routePlan` (sequence of swap legs across one or
more AMMs), an estimated `outAmount`, an `otherAmountThreshold` (the
minimum-out enforced on-chain at given slippage), price-impact and platform
fee details, and a `contextSlot` (the slot the quote was priced against).
The Dispatcher uses Quote for opportunity sizing and for the slippage
narrative; the Closer never signs against Quote alone.

**Swap.** Given a quote and a user pubkey, Jupiter builds a complete
versioned transaction (base64) with blockhash, ALTs, and compute budget
already inlined. This is convenient for thin clients but **the Closer does
not use Swap directly** — Legion needs to inject its own fee-payer,
priority-fee policy, optional Jito tip, and pre/post observability
instructions.

**Swap-Instructions.** Given a quote and a user pubkey, Jupiter returns the
component parts: `setupInstructions` (typically ATA creates / wraps),
`swapInstruction` (the core route execution), `cleanupInstruction`
(typically unwrap WSOL), `addressLookupTableAddresses`, and a
`computeUnitLimit` recommendation. **This is the Dispatcher's primary
entry point.** The Closer assembles the final transaction from these parts
plus its own additions, compiles V0, fetches the ALTs, signs, and sends.

## Route Plan

The `routePlan` is an array of legs. Each leg names an AMM
(`swapInfo.label`), an input mint, an output mint, an input amount, an
output amount, and a fee. A multi-leg plan threads through intermediate
mints (e.g. USDC → SOL → JUP); a *split* route runs multiple parallel legs
into the same intermediate to reduce price impact on a single pool. The
Dispatcher inspects the plan to:

- Verify every intermediate mint is on Legion's allowlist (no unexpected
  detours through low-liquidity scam mints).
- Sum the per-leg fees and compare against Scout's expected cost.
- Tag the strike with the route shape so the Archivist can correlate
  post-trade slippage with route topology.

## ALT / Versioned Tx

Jupiter routes routinely touch 25–60 distinct accounts (pool state,
oracles, vaults, tick arrays). Without Address Lookup Tables, the resulting
transaction overflows the 1232-byte limit. `swap-instructions` returns
`addressLookupTableAddresses`, an array of ALT pubkeys that Jupiter has
pre-published with the relevant accounts. The Closer:

1. `getMultipleAccounts` against those ALT pubkeys with commitment
   `confirmed`.
2. Deserializes the ALT state (including the appended-but-not-frozen
   entries, which is why a fresh fetch is mandatory).
3. Passes the ALTs to `MessageV0.compile()`.
4. Includes the same ALT pubkeys in `addressTableLookups` of the final
   message.

A V0 transaction is mandatory; legacy is rejected as it cannot reference
ALTs. See `docs/research/solana.md` for the V0 message structure.

## Compute Budget

`swap-instructions` returns a `computeUnitLimit` hint reflecting the route's
expected cost. The Closer uses this as a starting point but **simulates the
fully-assembled transaction** (after injecting its own instructions) to get
the true CU consumption, then sets the limit at `simulated_cus * 1.10`.
Setting the limit too low aborts mid-route and burns the priority fee;
setting it too high overpays the priority fee and competes worse for slot
inclusion at a given lamport budget.

The priority fee (`compute_unit_price`) is set by the Dispatcher's own
oracle (per-account write-lock contention from
`getRecentPrioritizationFees`), **not** by Jupiter. Jupiter knows nothing
about Legion's urgency model.

## Slippage / Fee Pitfalls

- **Slippage drift between quote and swap.** A quote priced at slot N may be
  meaningfully different by the time the strike lands at slot N+50.
  `slippageBps` must reflect the time-to-land, not the time-to-quote. The
  Dispatcher inflates the slippage budget for high-volatility tokens or
  congested slots; on stable pairs in calm markets it tightens.
- **`otherAmountThreshold` is the binding floor.** This is what the on-chain
  program enforces; the displayed `outAmount` is informational. The Closer
  verifies `otherAmountThreshold` matches Scout's profit floor before
  signing — never signs a higher slippage than authorised.
- **Auto-slippage modes.** Jupiter's dynamic slippage endpoint returns a
  computed bps value. Legion's Dispatcher does not delegate slippage policy
  to a third party; auto-slippage is logged for comparison but the binding
  number is Legion's own.
- **Platform fee account.** Jupiter accepts an optional `feeAccount`
  routing a basis-points cut to a token account. Legion does not collect
  platform fees on internal flows; this field is left empty on engine
  strikes.
- **Wrap/unwrap on native SOL.** When trading from or into native SOL,
  `setupInstructions` includes a wrap and `cleanupInstruction` an unwrap.
  Skipping `cleanupInstruction` strands wrapped SOL in a temporary WSOL
  account.
- **Stale ALT data.** Jupiter publishes new ALT entries as new pools are
  integrated. A cached ALT deserialization will miss accounts referenced by
  a fresh quote and the tx will fail with `InvalidLookupIndex`. Always
  refetch ALTs at sign time.
- **Quote / instruction mismatch.** A quote and a `swap-instructions` call
  must use the same parameters and the same `quoteResponse` payload. Mixing
  parameters between calls produces a tx whose minimum-out doesn't match
  the quoted slippage.
- **Indirect mint surprises.** A multi-leg route may pass through a mint
  with a transfer hook or freeze authority, causing the route to fail in
  ways the quote did not predict. The Dispatcher pre-checks every
  intermediate mint's metadata.
- **Direct-routes-only failure.** Setting `onlyDirectRoutes=true` may yield
  no quote on illiquid pairs. Treat empty quote as a clean "no route"
  signal, not as an error to retry.

## Post-Strike Checks

After the Closer's tx confirms, the Dispatcher runs a verification pass
before the strike is recorded as successful:

1. **Signature confirmed at `confirmed`** with no error in
   `getSignatureStatuses`.
2. **Realised out-amount** read from the destination ATA's post-balance is
   `>= otherAmountThreshold`. If a quirk in the route landed less than the
   on-chain floor (which should not happen — the program would have
   reverted), surface as a critical anomaly.
3. **Realised slippage** = `(quoted_outAmount - realised_out) /
   quoted_outAmount`. Logged for the Archivist's slippage distribution per
   route shape.
4. **CU consumed** vs. CU limit. A consumption ratio > 0.95 means the next
   strike on this route should bump the limit; < 0.6 means it can be
   tightened to compete on priority fee.
5. **Priority fee paid** (lamports per CU × CUs consumed) is recorded
   against the priority-fee oracle's prediction at submit time, feeding the
   Dispatcher's calibration loop.
6. **Route fingerprint** (sorted list of pool pubkeys) is hashed and stored
   so the Archivist can detect when "the same route" silently became a
   different topology.

A failed Jupiter strike is *not* automatically retried with the same quote
— the quote is stale. The Dispatcher requests a fresh quote and re-runs
the full pipeline.
