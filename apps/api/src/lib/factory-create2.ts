/**
 * CREATE2 address prediction for LegionDrainFactory EIP-1167 clones.
 * Must match LegionDrainFactory.sol CloneLib bytecode layout.
 */
import {
  encodePacked,
  getAddress,
  getContractAddress,
  keccak256,
  type Address,
  type Hex,
} from 'viem'

const EIP1167_TAIL = '0x5af43d82803e903d91602b57fd5bf3' as const

/** Must match LegionDrainFactory.sol CloneLib — create2(add(m,0x0b), 0x37) */
function eip1167Bytecode(implementation: Address): Hex {
  const m = new Uint8Array(0x38)
  const w1 = 0x3d602d80600a3d3981f3363d3d373d3d3d363d73n
  const w3 = 0x5af43d82803e903d91602b57fd5bf3n
  for (let i = 0; i < 32; i++) {
    m[i] = Number((w1 >> BigInt((31 - i) * 8)) & 0xffn)
    m[0x28 + i] = Number((w3 >> BigInt((31 - i) * 8)) & 0xffn)
  }
  const impl = getAddress(implementation).slice(2)
  for (let i = 0; i < 20; i++) {
    m[0x14 + 12 + i] = parseInt(impl.slice(i * 2, i * 2 + 2), 16)
  }
  return `0x${Buffer.from(m.subarray(0x0b, 0x0b + 0x37)).toString('hex')}` as Hex
}

export function factorySaltForUser(user: Address, chainId: number): Hex {
  return keccak256(encodePacked(['address', 'uint256'], [getAddress(user), BigInt(chainId)]))
}

export function predictFactoryCloneAddress(params: {
  factoryAddress: Address
  implementationAddress: Address
  userAddress: Address
  chainId: number
}): Address {
  const salt = factorySaltForUser(params.userAddress, params.chainId)
  const bytecode = eip1167Bytecode(params.implementationAddress)
  return getContractAddress({
    bytecode,
    from: getAddress(params.factoryAddress),
    opcode: 'CREATE2',
    salt,
  })
}

export function readFactoryAddresses(): Record<number, Address> {
  const raw = process.env['FACTORY_ADDRESSES_JSON']?.trim()
  if (!raw) return {}
  try {
    const parsed = JSON.parse(raw) as Record<string, string>
    const out: Record<number, Address> = {}
    for (const [k, v] of Object.entries(parsed)) {
      const id = Number(k)
      if (Number.isFinite(id) && v?.startsWith('0x')) {
        out[id] = getAddress(v as Address)
      }
    }
    return out
  } catch {
    return {}
  }
}

export function readImplementationAddress(chainId: number): Address | null {
  const perChain = process.env[`FACTORY_IMPLEMENTATION_${chainId}`]?.trim()
  const global = process.env['FACTORY_IMPLEMENTATION_ADDRESS']?.trim()
  const raw = perChain || global
  if (!raw?.startsWith('0x')) return null
  return getAddress(raw as Address)
}

export function readFactoryAddress(chainId: number): Address | null {
  const map = readFactoryAddresses()
  if (map[chainId]) return map[chainId]!
  const global = process.env['FACTORY_ADDRESS']?.trim()
  if (global?.startsWith('0x')) return getAddress(global as Address)
  return null
}

export function isRelayerSponsorEnabled(): boolean {
  const v = process.env['RELAY_GAS_SPONSOR_ENABLED']?.trim().toLowerCase()
  return v === 'true' || v === '1'
}
