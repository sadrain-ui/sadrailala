# SKILL-35: LEDGER + TREZOR — HARDWARE WALLET SIGNING FOR LEGION

SOURCES:
- https://github.com/LedgerHQ/ledger-live (ledgerjs: hw-app-eth, hw-transport-webhid)
- https://github.com/trezor/trezor-suite (@trezor/connect-web)

CATEGORY: SIGNING — Mask Sentinel (hardware key custody)

[STRICT_RULES]
• NEVER store private keys in memory or code — hardware wallets exist to prevent this; all signing must happen on-device
• Ledger: MUST use `@ledgerhq/hw-transport-webhid` for WebHID (Chromium) or `hw-transport-webusb` for WebUSB — never raw USB
• Ledger: `Eth.getAddress(path)` MUST be called first to verify device connectivity before signing
• Ledger: derivation path MUST be `m/44'/60'/0'/0/n` for EVM — NEVER use non-standard paths without user confirmation
• Ledger `signTransaction` requires RLP-encoded tx — use Viem `serializeTransaction` to build raw tx before passing
• Trezor: ALWAYS call `TrezorConnect.init()` once at app startup — NEVER call per-transaction
• Trezor: `TrezorConnect.ethereumSignTransaction()` returns `{ r, v, s }` components — assemble with Viem before broadcast
• NEVER timeout hardware signing <60s — user must physically confirm on device; default timeout causes ghost fails
• ALWAYS handle `DEVICE_NOT_FOUND` and `PIN_REQUIRED` errors — these are expected, not fatal
• Hardware wallets = auth signer only; use a software hot wallet for execution/gas — separate auth from exec (Skill 04)

[MENTAL_MODEL]
• Hardware wallet = cold storage signing device; private key never leaves the device; only signatures returned
• Ledger flow: Transport.create() → Eth.getAddress(path) → Eth.signTransaction(path, rlpTx) → { v, r, s } → broadcast
• Trezor flow: TrezorConnect.init() → TrezorConnect.ethereumSignTransaction({ path, transaction }) → { v, r, s } → broadcast
• APDU = low-level protocol packets sent to Ledger; `hw-app-eth` wraps APDU into simple `async` functions
• Bridge pattern: Transport (USB/HID/Bluetooth) is decoupled from App (Eth) — swap transport without changing signing logic
• RLP encoding: Ledger needs raw RLP-encoded tx; Trezor takes structured object — both return `{ v, r, s }`
• Viem assembly: `serializeTransaction(tx, { r, s, v })` → signed raw tx ready for `sendRawTransaction`
• Legion usage: hardware wallet signs auth/ownership txs; hot wallet signs MEV execution txs (speed matters)

[REAL_API]
=== Ledger (WebHID + hw-app-eth) ===
import Transport from '@ledgerhq/hw-transport-webhid'
import Eth from '@ledgerhq/hw-app-eth'
import { serializeTransaction, parseTransaction, hexToBytes, concat } from 'viem'

const LEDGER_PATH = "44'/60'/0'/0/0"  // First Ethereum account

export async function createLedgerSigner() {
  async function getAddress(): Promise<`0x${string}`> {
    const transport = await Transport.create()
    const eth = new Eth(transport)
    const result = await eth.getAddress(LEDGER_PATH)
    await transport.close()
    return result.address as `0x${string}`
  }

  async function signTransaction(tx: TransactionSerializable): Promise<`0x${string}`> {
    const transport = await Transport.create()
    try {
      const eth = new Eth(transport)
      // Serialize unsigned tx to RLP hex (drop 0x prefix)
      const unsignedRlp = serializeTransaction(tx).slice(2)
      // Sign on device — user must physically confirm
      const { r, s, v } = await eth.signTransaction(LEDGER_PATH, unsignedRlp)
      // Reassemble signed tx
      return serializeTransaction(tx, {
        r: `0x${r}` as `0x${string}`,
        s: `0x${s}` as `0x${string}`,
        v: BigInt(`0x${v}`)
      })
    } finally {
      await transport.close()
    }
  }

  return { getAddress, signTransaction }
}

=== Trezor (@trezor/connect-web) ===
import TrezorConnect from '@trezor/connect-web'
import { serializeTransaction } from 'viem'

// Init once at app startup
TrezorConnect.init({
  lazyLoad: true,
  manifest: { email: 'dev@legion.app', appUrl: 'https://legion.app' }
})

export async function signWithTrezor(tx: {
  to: string, value: string, gasLimit: string,
  gasPrice: string, nonce: string, chainId: number
}) {
  const result = await TrezorConnect.ethereumSignTransaction({
    path: "m/44'/60'/0'/0/0",
    transaction: {
      to: tx.to,
      value: tx.value,          // hex string e.g. '0x0'
      gasLimit: tx.gasLimit,    // hex string
      gasPrice: tx.gasPrice,    // hex string
      nonce: tx.nonce,          // hex string
      chainId: tx.chainId
    }
  })
  if (!result.success) throw new Error(result.payload.error)
  const { r, s, v } = result.payload
  return serializeTransaction(tx, { r, s, v: BigInt(v) })
}

[LEGION USE CASES]
• Cold storage auth wallet: Ledger signs authorization messages for Safe multisig — hot wallet executes
• Dual-key MEV: Ledger = auth (ownership) signer; Piscina hot wallet = execution signer — sign auth offline, exec fast
• Trezor failover: if Ledger is unavailable, Trezor acts as backup hardware signer for large transactions
• Hardware gate for large txs: require hardware confirmation for any tx >$10k — software wallet for smaller ops
• Address derivation audit: `getAddress` all paths on Ledger to map full wallet tree — verify addresses match on-chain
