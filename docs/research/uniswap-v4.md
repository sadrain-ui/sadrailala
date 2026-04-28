---
title: "Uniswap v4"
chain_family: "EVM"
resource_model: "Gas"
signing_model: "ECDSA"
cross_chain_capable: false
cursor_use: "Logic reference for Dispatcher/Scout (hooks and singleton pools)"
---

# Uniswap v4

Uniswap v4 is the fourth iteration of the Uniswap automated market maker.
Its design departs sharply from v3 in three ways: pools are no longer
deployed as individual contracts but live inside a single PoolManager;
arbitrary pre/post-hook contracts can extend pool behavior; and all
state changes during a transaction execute under a flash-accounting
discipline that nets balances at the end rather than transferring on
each step. For the Legion Engine, v4 is the highest-leverage reference
point for how a modern EVM protocol packs many logical pools into one
contract surface and how the engine must adapt routing and risk checks
when a pool's behavior is no longer fully described by its address.

## Singleton PoolManager

Every v4 pool is identified not by a deployed contract address but by a
`PoolKey` stored in the singleton PoolManager. The PoolManager holds the
state for all pools as a mapping keyed by the hash of the PoolKey. From
the Dispatcher's perspective, this means there is one address to
approve, one address to call, and one address to monitor for events,
regardless of how many pairs are traded. From the Scout's perspective,
it means pool discovery is no longer "scan factory deployments" but
"observe `Initialize` events emitted by the singleton". The singleton
also enables all multi-hop routes to settle inside a single call frame,
which is the precondition for flash accounting.

## PoolKey

A PoolKey is a five-field struct: two currency addresses (sorted
canonically), a fee (a uint24 — `0x800000` denotes a hook-managed
dynamic fee), a tick spacing, and a hooks address. The hash of the
PoolKey is the pool's identity. Two PoolKeys with identical currencies,
fee, and tick spacing but different hook addresses are different pools;
this is intentional, because hooks change behavior. Adapters MUST
treat the PoolKey, not the pool's bytes32 hash, as the canonical
identity for human inspection and audit logs, because the hash alone
elides the hook contract and obscures the security profile.

## Hooks

A hook is an external contract whose address is encoded in the PoolKey
and whose permitted callbacks are encoded in the low bits of that
address. Permitted callbacks include `beforeInitialize`, `afterInitialize`,
`beforeAddLiquidity`, `afterAddLiquidity`, `beforeRemoveLiquidity`,
`afterRemoveLiquidity`, `beforeSwap`, `afterSwap`, `beforeDonate`,
`afterDonate`, plus return-delta variants that allow the hook to alter
balances. The PoolManager checks that the hook address actually
declares the callbacks it implements; this is how the protocol
distinguishes a passive hook from an active one without an external
registry.

The implication for any caller — including the engine's Dispatcher —
is that a swap into a v4 pool is not a closed, well-typed operation.
A hook can charge an additional fee, redirect liquidity, return a
non-canonical price, revert under conditions not expressible in the
pool's storage, or modify state in unrelated contracts. Pre-trade risk
analysis MUST include the hook contract's bytecode hash, the set of
callbacks it declares, and a policy decision about whether the hook
is in an allowlist of known-safe contracts.

## Flash Accounting

Within a single PoolManager call sequence, balance changes are tracked
as deltas against the caller rather than as eager token transfers.
The caller invokes `unlock`, performs an arbitrary sequence of
operations (swap, modify liquidity, donate, take, settle), and at the
end MUST have a net-zero or net-positive position in every currency
touched. The PoolManager enforces this invariant at the boundary of
the unlock call. The advantage is that multi-hop routes, just-in-time
liquidity, and atomic arbitrage become single-call operations with
minimal token movement. The risk is that a malformed call sequence
that leaves a non-zero negative delta reverts the entire transaction,
discarding work the engine may have charged for in fee estimation.

## Lock / Unlock

The lock pattern is the gating mechanism for flash accounting. The
PoolManager exposes `unlock(bytes data)`; the caller passes a payload,
and the PoolManager calls back into the caller's `unlockCallback`
with that payload. Inside the callback, the caller has a single,
exclusive lock on the PoolManager and may make any sequence of pool
operations. Re-entry into `unlock` from within `unlockCallback` is
disallowed; the PoolManager tracks the lock holder explicitly. This
shape forces all v4 routing logic into the callback frame, which has
implications for gas accounting (deep call stacks), error handling
(reverts cascade), and adapter design (the engine's Dispatcher MUST
build the entire route's payload up front).

## Transient Storage

v4 leverages EIP-1153 transient storage (`TSTORE`/`TLOAD`) for the
delta tracking and lock state described above. Transient storage
persists only for the duration of the transaction; on transaction end,
all transient slots reset. This is what makes flash accounting
gas-efficient and re-entrancy-safe in a way pre-1153 designs could
not match, but it also means that any chain hosting a v4 deployment
MUST enable Cancun-and-later semantics. The Scout, when enumerating
chains for v4 support, MUST verify EIP-1153 availability, not merely
EVM-compatibility.

## Route and Hook Trust Pitfalls

- A hook with a returns-delta variant can extract value from the
  caller silently; routing must compare expected to realized output
  rather than relying on the pool's pre-trade quote.
- Two pools with the same currencies and fee but different hooks are
  *different markets*. Routing software that aggregates by
  `(currency0, currency1, fee)` will mis-price.
- A hook that mutates external state can re-enter the caller's
  protocol surface (not the PoolManager itself) during its callback.
  Adapters MUST assume hook code is adversarial when computing
  allowance and recipient parameters.
- A hook with `beforeSwap` can force the swap path to revert on
  conditions not visible in the pool's reserves; pre-sign simulation
  is the only reliable way to detect this before broadcast.
- Dynamic-fee pools (`fee == 0x800000`) compute fee at swap time via
  the hook; static fee estimates are wrong for these pools, and the
  Dispatcher's fee envelope MUST budget for the worst-case fee the
  hook can return.
- Multi-hop routes that pass through one trusted and one untrusted
  hook are only as trusted as the weaker hook; allowlisting MUST be
  whole-route, not per-hop.

## Legion Relevance

The Scout uses v4's `Initialize` events from the singleton to
enumerate pools and the encoded callback bits in each PoolKey's hooks
address to classify pool risk before the Dispatcher considers routing
through it. The Dispatcher uses the lock/unlock model to stage
multi-hop routes inside a single transaction, with flash-accounting
deltas validated against the hook trust policy described above.
Because v4's behavior is partly defined by hook bytecode rather than
solely by the PoolManager, the engine's pre-sign simulation
(documented separately) becomes mandatory rather than optional for
v4 routes; static analysis of the PoolKey is necessary but not
sufficient.
