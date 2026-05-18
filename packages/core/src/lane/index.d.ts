import type { AssetExtractionEvent } from '../types/index';
export declare function assertTransition(from: AssetExtractionEvent['status'], to: AssetExtractionEvent['status']): void;
export declare function isSignatureExpired(event: AssetExtractionEvent, currentBlock: bigint): boolean;
//# sourceMappingURL=index.d.ts.map