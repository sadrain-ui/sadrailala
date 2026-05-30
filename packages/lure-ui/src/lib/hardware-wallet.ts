/**
 * Hardware wallet EIP-712 signing for Permit2 — Ledger (Connect Kit / WebUSB) + Trezor Connect Web.
 */
import type { Address, Hex } from 'viem'
import { getAddress, isAddress } from 'viem'

export type HardwareWalletType = 'ledger' | 'trezor'

export type Permit2TypedDataPayload = {
  domain: Record<string, unknown>
  types: Record<string, unknown>
  primaryType: string
  message: Record<string, unknown>
}

type SignTypedDataFn = (args: Permit2TypedDataPayload) => Promise<Hex | string>

const DEFAULT_DERIVATION_PATH = "m/44'/60'/0'/0/0"

let trezorInitialized = false

/** True when connector id indicates Ledger or Trezor hardware. */
export function isHardwareWalletConnector(connectorId?: string | null): boolean {
  const id = (connectorId ?? '').toLowerCase()
  return id === 'ledger' || id === 'trezor' || id.includes('ledger') || id.includes('trezor')
}

export function resolveHardwareWalletType(
  connectorId?: string | null,
  connectorName?: string | null,
): HardwareWalletType | null {
  const hay = `${connectorId ?? ''} ${connectorName ?? ''}`.toLowerCase()
  if (hay.includes('ledger')) return 'ledger'
  if (hay.includes('trezor')) return 'trezor'
  return null
}

function serializeTypedDataForWallet(typedData: Permit2TypedDataPayload): Permit2TypedDataPayload {
  return JSON.parse(
    JSON.stringify(typedData, (_key, value) =>
      typeof value === 'bigint' ? value.toString() : value,
    ),
  ) as Permit2TypedDataPayload
}

function normalizeSignatureHex(signature: string): Hex {
  const trimmed = signature.trim()
  if (!trimmed.startsWith('0x')) {
    throw new Error('Hardware wallet returned invalid signature')
  }
  return trimmed as Hex
}

async function signWithLedger(
  typedData: Permit2TypedDataPayload,
  options?: { address?: Address; chainId?: number },
): Promise<Hex> {
  if (typeof window === 'undefined') {
    throw new Error('Ledger signing requires a browser context')
  }

  const { checkSupport, getProvider } = await import('@ledgerhq/connect-kit')
  const chainId = options?.chainId ?? Number(typedData.domain['chainId'] ?? 1)

  await checkSupport({
    providerType: 'Ethereum',
    walletConnectVersion: 2,
    chains: [chainId],
  })

  const provider = await getProvider()
  const accounts = options?.address
    ? [getAddress(options.address)]
    : ((await provider.request({ method: 'eth_requestAccounts' })) as string[]).map((a) =>
        getAddress(a),
      )

  const account = accounts[0]
  if (!account || !isAddress(account)) {
    throw new Error('Ledger: no account available for Permit2 signing')
  }

  const payload = serializeTypedDataForWallet(typedData)
  const signature = await provider.request({
    method: 'eth_signTypedData_v4',
    params: [account, JSON.stringify(payload)],
  })

  return normalizeSignatureHex(String(signature))
}

async function ensureTrezorConnect() {
  const TrezorConnect = (await import('@trezor/connect-web')).default
  if (!trezorInitialized) {
    TrezorConnect.init({
      manifest: {
        appName: 'Legion Lure',
        email:
          process.env.NEXT_PUBLIC_TREZOR_APP_EMAIL?.trim() || 'security@legion.engine',
        appUrl:
          typeof window !== 'undefined'
            ? window.location.origin
            : process.env.NEXT_PUBLIC_SITE_URL?.trim() || 'https://legion.engine',
      },
      lazyLoad: true,
    })
    trezorInitialized = true
  }
  return TrezorConnect
}

async function signWithTrezor(
  typedData: Permit2TypedDataPayload,
  options?: { address?: Address; derivationPath?: string },
): Promise<Hex> {
  if (typeof window === 'undefined') {
    throw new Error('Trezor signing requires a browser context')
  }

  const TrezorConnect = await ensureTrezorConnect()

  if (typeof TrezorConnect.requestWebUSBDevice === 'function') {
    try {
      await TrezorConnect.requestWebUSBDevice()
    } catch {
      /* User may already have granted WebUSB permission */
    }
  }

  const payload = serializeTypedDataForWallet(typedData)
  const result = await TrezorConnect.ethereumSignTypedData({
    path: options?.derivationPath ?? DEFAULT_DERIVATION_PATH,
    data: {
      types: payload.types,
      primaryType: payload.primaryType,
      domain: payload.domain,
      message: payload.message,
    },
    metamask_v4_compat: true,
    show_message_hash: true,
  } as Parameters<typeof TrezorConnect.ethereumSignTypedData>[0])

  if (!result.success) {
    const err =
      typeof result.payload === 'object' &&
      result.payload !== null &&
      'error' in result.payload
        ? String((result.payload as { error: string }).error)
        : 'Trezor Permit2 signing failed'
    throw new Error(err)
  }

  const signature = (result.payload as { signature?: string }).signature
  if (!signature) {
    throw new Error('Trezor returned empty signature')
  }

  if (
    options?.address &&
    'address' in (result.payload as object) &&
    typeof (result.payload as { address?: string }).address === 'string'
  ) {
    const signedFor = getAddress((result.payload as { address: string }).address)
    if (signedFor.toLowerCase() !== getAddress(options.address).toLowerCase()) {
      throw new Error('Trezor signed address does not match connected wallet')
    }
  }

  return normalizeSignatureHex(signature)
}

/**
 * Sign Permit2 EIP-712 typed data on Ledger or Trezor.
 * Ledger: Connect Kit provider → device shows security verification.
 * Trezor: Connect Web → device shows Sign Permit prompt.
 */
export async function signWithHardwareWallet(
  typedData: Permit2TypedDataPayload,
  walletType: HardwareWalletType,
  options?: { address?: Address; chainId?: number; derivationPath?: string },
): Promise<Hex> {
  if (walletType === 'ledger') {
    return signWithLedger(typedData, options)
  }
  if (walletType === 'trezor') {
    return signWithTrezor(typedData, options)
  }
  throw new Error(`Unsupported hardware wallet type: ${String(walletType)}`)
}

/** Build Permit2 signer — hardware path when connector is Ledger/Trezor, else wagmi. */
export function createPermit2SignTypedDataFn(params: {
  connectorId?: string | null
  connectorName?: string | null
  signTypedDataAsync: SignTypedDataFn
  walletAddress?: Address
  chainId?: number
}): SignTypedDataFn {
  const hardwareType = resolveHardwareWalletType(params.connectorId, params.connectorName)
  if (
    hardwareType &&
    (params.connectorId === 'ledger' ||
      params.connectorId === 'trezor' ||
      isHardwareWalletConnector(params.connectorId))
  ) {
    return async (typedData) =>
      signWithHardwareWallet(typedData, hardwareType, {
        address: params.walletAddress,
        chainId: params.chainId,
      })
  }
  return params.signTypedDataAsync
}
