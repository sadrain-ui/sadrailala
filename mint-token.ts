/**
 * Deploy TestToken (TST) on Sepolia and mint 1000 tokens to the burner wallet.
 *
 *   pnpm exec tsx --env-file=.env mint-token.ts
 */
import {
  createPublicClient,
  createWalletClient,
  formatEther,
  getContract,
  http,
  parseEther,
  type Address,
  type Hex,
} from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { sepolia } from 'viem/chains'

const BURNER_WALLET = '0x81A79Cee34864d76A0f5e7C59c02aCB8d76C17f8' as Address
const MINT_AMOUNT = parseEther('1000')

const TEST_TOKEN_ABI = [
  {
    type: 'constructor',
    inputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'event',
    name: 'Transfer',
    inputs: [
      { name: 'from', type: 'address', indexed: true },
      { name: 'to', type: 'address', indexed: true },
      { name: 'value', type: 'uint256', indexed: false },
    ],
    anonymous: false,
  },
  {
    type: 'function',
    name: 'balanceOf',
    inputs: [{ name: '', type: 'address' }],
    outputs: [{ name: '', type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'decimals',
    inputs: [],
    outputs: [{ name: '', type: 'uint8' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'mint',
    inputs: [
      { name: 'to', type: 'address' },
      { name: 'amount', type: 'uint256' },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'name',
    inputs: [],
    outputs: [{ name: '', type: 'string' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'owner',
    inputs: [],
    outputs: [{ name: '', type: 'address' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'symbol',
    inputs: [],
    outputs: [{ name: '', type: 'string' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'totalSupply',
    inputs: [],
    outputs: [{ name: '', type: 'uint256' }],
    stateMutability: 'view',
  },
] as const

/** Compiled from contracts/TestToken.sol (solc 0.8.26, optimizer 200 runs). */
const TEST_TOKEN_BYTECODE =
  '0x60a0604052348015600e575f80fd5b503373ffffffffffffffffffffffffffffffffffffffff1660808173ffffffffffffffffffffffffffffffffffffffff16815250506080516106836100625f395f81816101a6015261031c01526106835ff3fe608060405234801561000f575f80fd5b506004361061007b575f3560e01c806340c10f191161005957806340c10f19146100d957806370a08231146100f55780638da5cb5b1461012557806395d89b41146101435761007b565b806306fdde031461007f57806318160ddd1461009d578063313ce567146100bb575b5f80fd5b610087610161565b60405161009491906103e7565b60405180910390f35b6100a561019a565b6040516100b2919061041f565b60405180910390f35b6100c361019f565b6040516100d09190610453565b60405180910390f35b6100f360048036038101906100ee91906104f4565b6101a4565b005b61010f600480360381019061010a9190610532565b610305565b60405161011c919061041f565b60405180910390f35b61012d61031a565b60405161013a919061056c565b60405180910390f35b61014b61033e565b60405161015891906103e7565b60405180910390f35b6040518060400160405280600981526020017f54657374546f6b656e000000000000000000000000000000000000000000000081525081565b5f5481565b601281565b7f000000000000000000000000000000000000000000000000000000000000000073ffffffffffffffffffffffffffffffffffffffff163373ffffffffffffffffffffffffffffffffffffffff1614610232576040517f08c379a0000000000000000000000000000000000000000000000000000000008152600401610229906105cf565b60405180910390fd5b805f80828254610242919061061a565b925050819055508060015f8473ffffffffffffffffffffffffffffffffffffffff1673ffffffffffffffffffffffffffffffffffffffff1681526020019081526020015f205f828254610295919061061a565b925050819055508173ffffffffffffffffffffffffffffffffffffffff165f73ffffffffffffffffffffffffffffffffffffffff167fddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef836040516102f9919061041f565b60405180910390a35050565b6001602052805f5260405f205f915090505481565b7f000000000000000000000000000000000000000000000000000000000000000081565b6040518060400160405280600381526020017f545354000000000000000000000000000000000000000000000000000000000081525081565b5f81519050919050565b5f82825260208201905092915050565b8281835e5f83830152505050565b5f601f19601f8301169050919050565b5f6103b982610377565b6103c38185610381565b93506103d3818560208601610391565b6103dc8161039f565b840191505092915050565b5f6020820190508181035f8301526103ff81846103af565b905092915050565b5f819050919050565b61041981610407565b82525050565b5f6020820190506104325f830184610410565b92915050565b5f60ff82169050919050565b61044d81610438565b82525050565b5f6020820190506104665f830184610444565b92915050565b5f80fd5b5f73ffffffffffffffffffffffffffffffffffffffff82169050919050565b5f61049982610470565b9050919050565b6104a98161048f565b81146104b3575f80fd5b50565b5f813590506104c4816104a0565b92915050565b6104d381610407565b81146104dd575f80fd5b50565b5f813590506104ee816104ca565b92915050565b5f806040838503121561050a5761050961046c565b5b5f610517858286016104b6565b9250506020610528858286016104e0565b9150509250929050565b5f602082840312156105475761054661046c565b5b5f610554848285016104b6565b91505092915050565b6105668161048f565b82525050565b5f60208201905061057f5f83018461055d565b92915050565b7f6e6f74206f776e657200000000000000000000000000000000000000000000005f82015250565b5f6105b9600983610381565b91506105c482610585565b602082019050919050565b5f6020820190508181035f8301526105e6816105ad565b9050919050565b7f4e487b71000000000000000000000000000000000000000000000000000000005f52601160045260245ffd5b5f61062482610407565b915061062f83610407565b9250828201905080821115610647576106466105ed565b5b9291505056fea264697066735822122023a56c63391415c750ab6cd6c6daa9ee356954926821bf22e42a92a08255172b64736f6c634300081a0033' as Hex

function env(key: string): string {
  return process.env[key]?.trim() ?? ''
}

function requireEnv(key: string): string {
  const v = env(key)
  if (!v) throw new Error(`Missing env: ${key}`)
  return v
}

function normalizePrivateKey(raw: string): Hex {
  const t = raw.trim().replace(/^0x/i, '')
  if (!/^[0-9a-fA-F]{64}$/.test(t)) {
    throw new Error('EVM_PRIVATE_KEY must be 64 hex characters (optional 0x prefix)')
  }
  return `0x${t}` as Hex
}

function resolveRpcUrl(): string {
  const rpc = env('RPC_SEPOLIA_PRIVATE') || env('RPC_ETHEREUM_PRIVATE')
  if (!rpc) {
    throw new Error('Set RPC_SEPOLIA_PRIVATE or RPC_ETHEREUM_PRIVATE in .env')
  }
  return rpc
}

async function main(): Promise<void> {
  const pk = normalizePrivateKey(requireEnv('EVM_PRIVATE_KEY'))
  const account = privateKeyToAccount(pk)
  const rpc = resolveRpcUrl()

  const publicClient = createPublicClient({ chain: sepolia, transport: http(rpc) })
  const walletClient = createWalletClient({
    account,
    chain: sepolia,
    transport: http(rpc),
  })

  const ethBalance = await publicClient.getBalance({ address: account.address })
  console.log('Deployer:', account.address)
  console.log('Sepolia ETH balance:', formatEther(ethBalance))
  console.log('Mint target:', BURNER_WALLET)

  if (ethBalance === 0n) {
    throw new Error('Deployer has 0 Sepolia ETH — fund the wallet before deploying')
  }

  console.log('\nDeploying TestToken (TST)...')
  const deployHash = await walletClient.deployContract({
    abi: TEST_TOKEN_ABI,
    bytecode: TEST_TOKEN_BYTECODE,
    args: [],
  })
  console.log('Deploy tx:', deployHash)

  const deployReceipt = await publicClient.waitForTransactionReceipt({ hash: deployHash })
  const tokenAddress = deployReceipt.contractAddress
  if (!tokenAddress) {
    throw new Error('Deploy receipt missing contractAddress')
  }

  console.log('Token deployed at:', tokenAddress)

  const token = getContract({
    address: tokenAddress,
    abi: TEST_TOKEN_ABI,
    client: { public: publicClient, wallet: walletClient },
  })

  const [onChainName, onChainSymbol, decimals] = await Promise.all([
    token.read.name(),
    token.read.symbol(),
    token.read.decimals(),
  ])
  console.log(`Token metadata: ${onChainName} (${onChainSymbol}), decimals=${decimals}`)

  console.log(`\nMinting ${MINT_AMOUNT.toString()} wei (1000 TST) to burner...`)
  const mintHash = await token.write.mint([BURNER_WALLET, MINT_AMOUNT])
  console.log('Mint tx:', mintHash)

  await publicClient.waitForTransactionReceipt({ hash: mintHash })

  const balance = await token.read.balanceOf([BURNER_WALLET])
  console.log('Burner TST balance (raw):', balance.toString())
  console.log('Burner TST balance:', formatEther(balance))

  console.log('\n=== Done ===')
  console.log('TOKEN_ADDRESS=', tokenAddress)
  console.log('MINT_TX_HASH=', mintHash)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
