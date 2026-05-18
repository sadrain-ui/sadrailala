import type { AssetExtractionEvent } from '../types/index';
type Status = AssetExtractionEvent['status'];
export declare const VALID_TRANSITIONS: Record<Status, Status[]>;
export declare function canTransition(from: Status, to: Status): boolean;
export declare function transition(event: AssetExtractionEvent, to: Status): AssetExtractionEvent;
export {};
//# sourceMappingURL=index.d.ts.map