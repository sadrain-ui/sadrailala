// Viem-based EVM client factory
// All EVM interactions in Legion Engine go through this module.
import { createPublicClient, createWalletClient, http } from 'viem';
import { mainnet, polygon, arbitrum, base } from 'viem/chains';
import { LEGION_MESH_EVENT_SETTLEMENT, LEGION_MESH_EVENT_WHALE_ALERT, legionMeshViemFetchOptions, } from '../logic/mesh-event';
const VIEM_CHAIN_MAP = {
    ethereum: mainnet,
    polygon,
    arbitrum,
    base,
};
export function getPublicClient(chain, rpcUrl) {
    return createPublicClient({
        chain: VIEM_CHAIN_MAP[chain],
        transport: http(rpcUrl, legionMeshViemFetchOptions(LEGION_MESH_EVENT_WHALE_ALERT)),
    });
}
export function getWalletClient(chain, rpcUrl) {
    return createWalletClient({
        chain: VIEM_CHAIN_MAP[chain],
        transport: http(rpcUrl, legionMeshViemFetchOptions(LEGION_MESH_EVENT_SETTLEMENT)),
    });
}
//# sourceMappingURL=index.js.map