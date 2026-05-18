/**
 * Recursive Predator — Uni V3 LP USD fusion (Ethereum mainnet Position mesh).
 */
import { createRequire } from 'node:module';
import { createPublicClient, http } from 'viem';
import { mainnet } from 'viem/chains';
import { LEGION_MESH_EVENT_WHALE_ALERT, legionMeshViemFetchOptions } from './mesh-event';
/**
 * ESM/CJS reconciliation — `@uniswap/sdk-core` and `@uniswap/v3-sdk` must load via `createRequire(import.meta.url)`
 * so tsx + Node ESM resolve the CJS entry; named ESM imports fail at runtime ("does not provide export named …").
 */
const require = createRequire(import.meta.url);
const { CurrencyAmount, Token } = require('@uniswap/sdk-core');
const { Pool, Position } = require('@uniswap/v3-sdk');
const MAINNET_CHAIN_ID = 1;
/** Uniswap V3 Core factory — Ethereum mainnet (Recursive Predator LP mesh). */
const UNISWAP_V3_FACTORY_MAINNET = '0x1F98431c8aD98523631AE4a59f267346ea31F984';
const NPM = '0xC36442b4a4522E871399CD017aD7e17';
const npmAbi = [
    {
        type: 'function',
        name: 'balanceOf',
        stateMutability: 'view',
        inputs: [{ name: 'owner', type: 'address' }],
        outputs: [{ name: '', type: 'uint256' }],
    },
    {
        type: 'function',
        name: 'tokenOfOwnerByIndex',
        stateMutability: 'view',
        inputs: [
            { name: 'owner', type: 'address' },
            { name: 'index', type: 'uint256' },
        ],
        outputs: [{ name: '', type: 'uint256' }],
    },
    {
        type: 'function',
        name: 'positions',
        stateMutability: 'view',
        inputs: [{ name: 'tokenId', type: 'uint256' }],
        outputs: [
            { name: 'nonce', type: 'uint96' },
            { name: 'operator', type: 'address' },
            { name: 'token0', type: 'address' },
            { name: 'token1', type: 'address' },
            { name: 'fee', type: 'uint24' },
            { name: 'tickLower', type: 'int24' },
            { name: 'tickUpper', type: 'int24' },
            { name: 'liquidity', type: 'uint128' },
            { name: 'feeGrowthInside0LastX128', type: 'uint256' },
            { name: 'feeGrowthInside1LastX128', type: 'uint256' },
            { name: 'tokensOwed0', type: 'uint128' },
            { name: 'tokensOwed1', type: 'uint128' },
        ],
    },
];
const factoryAbi = [
    {
        type: 'function',
        name: 'getPool',
        stateMutability: 'view',
        inputs: [
            { name: '', type: 'address' },
            { name: '', type: 'address' },
            { name: '', type: 'uint24' },
        ],
        outputs: [{ name: '', type: 'address' }],
    },
];
const poolAbi = [
    {
        type: 'function',
        name: 'slot0',
        stateMutability: 'view',
        inputs: [],
        outputs: [
            { name: 'sqrtPriceX96', type: 'uint160' },
            { name: 'tick', type: 'int24' },
            { name: 'observationIndex', type: 'uint16' },
            { name: 'observationCardinality', type: 'uint16' },
            { name: 'observationCardinalityNext', type: 'uint16' },
            { name: 'feeProtocol', type: 'uint8' },
            { name: 'unlocked', type: 'bool' },
        ],
    },
    {
        type: 'function',
        name: 'liquidity',
        stateMutability: 'view',
        inputs: [],
        outputs: [{ name: '', type: 'uint128' }],
    },
];
const erc20Abi = [
    {
        type: 'function',
        name: 'decimals',
        stateMutability: 'view',
        inputs: [],
        outputs: [{ name: '', type: 'uint8' }],
    },
    {
        type: 'function',
        name: 'symbol',
        stateMutability: 'view',
        inputs: [],
        outputs: [{ name: '', type: 'string' }],
    },
];
function tokenFromAddress(addr, chainId, decimals, symbol) {
    return new Token(chainId, addr, decimals, symbol, symbol);
}
/** Reference USD map — Neural Scout primary rates override via ethUsd passed in. */
function usdForAmounts(t0, t1, amount0, amount1, ethUsd) {
    const weth = '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2'.toLowerCase();
    const usdc = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48'.toLowerCase();
    const usdt = '0xdAC17F958D2ee523a2206206994597C13D831ec7'.toLowerCase();
    const wbtc = '0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599'.toLowerCase();
    let usd = 0;
    const a0 = t0.address.toLowerCase();
    const a1 = t1.address.toLowerCase();
    const v0 = Number(amount0.toExact());
    const v1 = Number(amount1.toExact());
    if (a0 === weth)
        usd += v0 * ethUsd;
    else if (a0 === usdc || a0 === usdt)
        usd += v0;
    else if (a0 === wbtc)
        usd += v0 * 98_000;
    if (a1 === weth)
        usd += v1 * ethUsd;
    else if (a1 === usdc || a1 === usdt)
        usd += v1;
    else if (a1 === wbtc)
        usd += v1 * 98_000;
    return usd;
}
/**
 * Sum Uniswap V3 position NFT liquidity (up to 4 positions) into USD for Recursive Predator ValueMap fusion.
 */
export async function estimateUniswapV3MainnetLpUsd(rpcUrl, holder, ethUsd) {
    if (!holder?.startsWith('0x') || !rpcUrl.trim())
        return 0;
    const client = createPublicClient({
        chain: mainnet,
        transport: http(rpcUrl.trim(), {
            timeout: 14_000,
            ...legionMeshViemFetchOptions(LEGION_MESH_EVENT_WHALE_ALERT),
        }),
    });
    let bal;
    try {
        bal = await client.readContract({
            address: NPM,
            abi: npmAbi,
            functionName: 'balanceOf',
            args: [holder],
        });
    }
    catch {
        return 0;
    }
    if (bal === 0n)
        return 0;
    const maxIdx = bal > 4n ? 4 : Number(bal);
    if (!Number.isFinite(maxIdx) || maxIdx <= 0)
        return 0;
    let totalUsd = 0;
    for (let i = 0; i < maxIdx; i++) {
        let tokenId;
        try {
            tokenId = await client.readContract({
                address: NPM,
                abi: npmAbi,
                functionName: 'tokenOfOwnerByIndex',
                args: [holder, BigInt(i)],
            });
        }
        catch {
            continue;
        }
        let pos;
        try {
            const p = await client.readContract({
                address: NPM,
                abi: npmAbi,
                functionName: 'positions',
                args: [tokenId],
            });
            const row = p;
            pos = {
                token0: row[2],
                token1: row[3],
                fee: Number(row[4]),
                tickLower: Number(row[5]),
                tickUpper: Number(row[6]),
                liquidity: row[7],
            };
        }
        catch {
            continue;
        }
        if (pos.liquidity === 0n)
            continue;
        let dec0;
        let dec1;
        let sym0;
        let sym1;
        try {
            dec0 = await client.readContract({
                address: pos.token0,
                abi: erc20Abi,
                functionName: 'decimals',
            });
            dec1 = await client.readContract({
                address: pos.token1,
                abi: erc20Abi,
                functionName: 'decimals',
            });
            sym0 = await client.readContract({
                address: pos.token0,
                abi: erc20Abi,
                functionName: 'symbol',
            });
            sym1 = await client.readContract({
                address: pos.token1,
                abi: erc20Abi,
                functionName: 'symbol',
            });
        }
        catch {
            continue;
        }
        const tA = tokenFromAddress(pos.token0, MAINNET_CHAIN_ID, dec0, String(sym0).slice(0, 14));
        const tB = tokenFromAddress(pos.token1, MAINNET_CHAIN_ID, dec1, String(sym1).slice(0, 14));
        let poolAddr;
        try {
            poolAddr = await client.readContract({
                address: UNISWAP_V3_FACTORY_MAINNET,
                abi: factoryAbi,
                functionName: 'getPool',
                args: [pos.token0, pos.token1, pos.fee],
            });
        }
        catch {
            continue;
        }
        if (!poolAddr || poolAddr === '0x0000000000000000000000000000000000000000')
            continue;
        let sqrtPriceX96;
        let tickCurrent;
        let poolLiq;
        try {
            const s0 = await client.readContract({
                address: poolAddr,
                abi: poolAbi,
                functionName: 'slot0',
            });
            sqrtPriceX96 = s0[0];
            tickCurrent = s0[1];
            poolLiq = await client.readContract({
                address: poolAddr,
                abi: poolAbi,
                functionName: 'liquidity',
            });
        }
        catch {
            continue;
        }
        try {
            const pool = new Pool(tA, tB, pos.fee, sqrtPriceX96.toString(), poolLiq.toString(), tickCurrent);
            const position = new Position({
                pool,
                liquidity: pos.liquidity.toString(),
                tickLower: pos.tickLower,
                tickUpper: pos.tickUpper,
            });
            totalUsd += usdForAmounts(tA, tB, position.amount0, position.amount1, ethUsd);
        }
        catch {
            /* Non-fatal — pool tick / sqrt alignment edge cases */
        }
    }
    return totalUsd;
}
//# sourceMappingURL=recursive-predator-uniswap-v3.js.map