---
title: "Architecture - Hardware Signing Safety"
chain_family: "MULTICHAIN"
resource_model: "Mixed"
signing_model: "Mixed"
cross_chain_capable: true
cursor_use: "Logic reference for Mask/Closer (hardware signing safety)"
---

# Architecture — Hardware Signing Safety

A hardware signer is a small, mostly air-gapped device that holds
private keys and produces signatures on demand for messages presented
to it. The two devices that have shaped the ecosystem's expectations
are Ledger and Trezor; their patterns — secure-element key storage,
on-device confirmation, derivation paths, and the signing-policy
firmware — define the contract any service that drives them must
honor. The Legion Engine treats a hardware signer as a privileged
co-signer whose UX is the only ground truth about what was actually
authorized. This document records the architectural posture that
follows from that view.

## Why Hardware Signers Are Different

A software-resident key can be exfiltrated by a process that gains
access to the host. A hardware-resident key can be exercised, but
not exfiltrated, by such a process. The asymmetry is the entire point
of the device. The corollary, which is often missed, is that the
signature the device produces is the only attestation of user intent
that survives a host compromise. Therefore the integrity of the
signing flow rests on what the device displays, not on what the host
software claims the device is signing.

## Derivation Paths

Hardware signers do not hold one key per user; they hold a master
seed from which keys are derived along BIP-32 / SLIP-10 derivation
paths. A derivation path encodes purpose, coin type, account, and
address index, and different chain families use different conventions
(BIP-44 for Bitcoin, distinct purposes for Ethereum, Solana,
Polkadot, etc.). Two architectural points follow:

- The engine MUST track the derivation path alongside the public
  address for every signer, because the same device with the same
  seed can serve any number of accounts and the path is what
  disambiguates them. Logging only the address on a sign request is
  insufficient if the operator must later prove which key signed.
- The engine MUST surface the derivation path on the Sentinel side
  of the request before it is sent to the device, because a host
  compromise that swaps the path for a path the user did not intend
  produces a valid signature on a key the user has not authorized
  for this operation. Defense in depth here is to display the path
  on the device when the firmware supports it.

## Clear Signing

Clear signing is the practice of having the device decode the
transaction and display its semantically meaningful fields — recipient,
amount, asset, contract function, parameter values — in human-readable
form on the device's screen. This is the property that makes a
hardware signer useful as a co-signer rather than as an opaque
signature oracle. Clear signing depends on the device firmware, the
chain's transaction format, and the application protocol the host
uses to drive the device.

For the engine, the architectural commitment is: an operation that
involves user-visible value or counterparty MUST be signed in clear
form. An operation that the device can only blind-sign is, by
definition, an operation the engine has not been able to demonstrate
to the user. Such operations are quarantined behind an explicit
policy gate.

## Blind Signing Controls

Blind signing — the device producing a signature on a hash with no
context — is sometimes unavoidable. Some chain transaction formats
exceed the device's display budget; some smart-contract calls are not
in the device's whitelist; some EIP-712 typed-data structures use
custom domains the firmware does not yet decode. The engine MUST treat
blind signing as a privilege rather than a default:

- A blind-sign capability is opt-in per signer and per operation
  class. The default for all signers is "clear signing required".
- Each blind-sign operation produces an audit record describing what
  was signed, what could not be displayed, and the operator who
  authorized the override.
- The engine MUST pre-sign-simulate the operation (see the pre-sign
  simulation architecture) and MUST present the simulation outcome
  to the human operator before the device receives the request,
  because the device cannot present what the device cannot decode.

## PSBT Safety

For UTXO chains, the standard signing flow is the Partially Signed
Bitcoin Transaction (PSBT, BIP-174). A PSBT carries the unsigned
transaction, the input UTXOs being spent, the script witnesses needed,
and the BIP-32 derivation paths for the keys involved. The device
verifies the inputs, computes the change outputs against its expected
scripts, and signs only the inputs whose paths it owns. PSBT safety
hinges on three properties:

- Input authenticity. The device MUST be able to verify the input
  UTXO's value against a previous transaction, not merely accept
  the host's claim. Without this, a malicious host can present
  smaller inputs and lead the device to sign a transaction that pays
  a much larger fee than the user expects.
- Change recognition. The device MUST identify which outputs are
  the user's own change. An output the device cannot prove is
  change is treated as a payment, displayed as such, and counted
  against the user's net outflow. A host that hides change as a
  payment to an attacker-controlled address is the prototypical
  PSBT attack; the device's job is to refuse to be hidden from.
- Script policy. The device MUST display the script type for each
  input and output (P2PKH, P2WPKH, P2TR, etc.); script-type
  ambiguity has historically been exploited to coerce signing
  against unintended scripts.

The engine's PSBT flow MUST construct PSBTs that satisfy these
properties (full previous-transaction inclusion for non-segwit
inputs, BIP-174 v2 with `PSBT_GLOBAL_TX_VERSION`, complete input
metadata, change derivation paths) so the device can in turn enforce
its own checks.

## Application Protocol Boundaries

Hardware signers expose chain-specific applications: an Ethereum app,
a Solana app, a Polkadot app. The host software speaks an APDU
protocol to the device app. Two boundary conditions matter:

- The wrong app for the operation produces nothing useful. The
  engine MUST request the operator (or the device-management layer)
  open the correct app for the chain family being signed, and MUST
  refuse to fall over to a generic-message-signing flow when the
  expected app is unavailable, because generic message signing
  bypasses clear-signing entirely.
- App firmware versions matter. A new chain feature (EIP-1559,
  EIP-4844 blobs, an updated SCALE pallet, a new Solana versioned
  transaction layout) may not be decoded by older firmware. The
  engine MUST pin a minimum firmware version per chain and MUST
  refuse to drive a device whose firmware is below that version
  rather than fall back to blind signing.

## Custody and Key Discovery

The engine MUST NOT enumerate keys on a hardware signer beyond what
the operator has explicitly bound. Walking derivation paths to find
funded accounts is acceptable in a wallet UX with a present user; it
is not acceptable in an unattended service, because it produces a
signing surface broader than the operator's explicit authorization.
Each signer is bound to a fixed set of `(derivation_path, public_key,
chain_family)` triples at registration time, and operations route
only to those triples.

## Legion Relevance

The Mask Sentinel is the policy gate that decides whether a request
is allowed to reach a signer at all; the Closer is the component that
actually drives the device. Together they implement the posture in
this document: clear-signing-by-default, blind-signing-as-explicit-
override, derivation-path tracking from the Sentinel layer down to
the audit log, PSBT construction that respects what the device needs
to verify, and minimum-firmware enforcement per chain family. The
hardware signer is the last and strongest line of defense against a
compromised host; the engine's architecture treats it as such.
