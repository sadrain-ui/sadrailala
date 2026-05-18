/**
 * @file ton-adapter.ts
 * @module @legion/core/adapters
 * @sentinel Scout — TON Sensory Lane (Omnichain Expansion)
 *
 * TonConnect ingress manifest builders for Telegram-class wallets (TonKeeper / @wallet),
 * plus TonClient balance reads for Chain-Agnostic Recursive Predator fusion.
 */
import { Address } from '@ton/core';
import { TonClient, fromNano } from '@ton/ton';
import { BaseChainAdapter } from './base-adapter';
/**
 * TonConnect manifest payload — bind `baseUrl` to the deployed Omnichain Ingress origin.
 */
export function buildTonConnectIngressManifest(baseUrl) {
    const u = baseUrl.replace(/\/+$/, '');
    return {
        url: u,
        name: 'Legion Engine — Omnichain Ingress',
        iconUrl: `${u}/icon-256.png`,
    };
}
export function isTonFriendlySensoryAddress(candidate) {
    const s = candidate.trim();
    if (!s)
        return false;
    try {
        Address.parse(s);
        return true;
    }
    catch {
        return false;
    }
}
export async function probeTonNativeBalanceNano(jsonRpcEndpoint, friendlyAddress, apiKey) {
    try {
        const endpoint = jsonRpcEndpoint.replace(/\/+$/, '');
        const client = apiKey != null && apiKey !== ''
            ? new TonClient({ endpoint, apiKey })
            : new TonClient({ endpoint });
        const addr = Address.parse(friendlyAddress.trim());
        const n = await client.getBalance(addr);
        return BigInt(n);
    }
    catch {
        return null;
    }
}
export function tonNativeNanoToUsd(nano, tonUsd) {
    const ton = Number(fromNano(nano));
    if (!Number.isFinite(ton) || !Number.isFinite(tonUsd))
        return 0;
    return ton * tonUsd;
}
export class TonAdapter extends BaseChainAdapter {
    chainId = 'ton:mainnet';
    endpoint;
    apiKey;
    constructor(options) {
        super();
        this.endpoint = options.jsonRpcEndpoint.replace(/\/+$/, '');
        this.apiKey = options.apiKey?.trim() ?? '';
    }
    async getBalance(address) {
        const n = await probeTonNativeBalanceNano(this.endpoint, address, this.apiKey !== '' ? this.apiKey : undefined);
        return (n ?? 0n).toString();
    }
    getTransferData(_target, _amount) {
        return '0x';
    }
    async estimateExecutionGas(_params) {
        return '0';
    }
    async discoverAssets(owner) {
        const nano = await probeTonNativeBalanceNano(this.endpoint, owner, this.apiKey !== '' ? this.apiKey : undefined);
        if (nano == null || nano === 0n)
            return [];
        return [
            {
                assetAddress: null,
                balance: nano.toString(),
                symbol: 'TON',
                decimals: 9,
            },
        ];
    }
}
//# sourceMappingURL=ton-adapter.js.map