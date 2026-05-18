export interface GatekeeperSentinel {
    /** Approve or reject an extraction event */
    evaluateEvent(eventId: string): Promise<GatekeeperDecision>;
    /** Trigger global pause across all extraction lanes */
    globalPause(reason: string): Promise<void>;
    /** Get current war-room session status */
    getWarRoomStatus(): Promise<WarRoomStatus>;
}
export interface GatekeeperDecision {
    eventId: string;
    approved: boolean;
    reason: string;
    approvedBy: string;
    approvedAt: Date;
    policyId?: string;
}
export interface WarRoomStatus {
    activeLanes: number;
    globalPaused: boolean;
    pauseReason: string | null;
    rpcHealthSummary: Record<string, 'healthy' | 'degraded' | 'down'>;
    sentinelActivity: Record<string, 'idle' | 'running' | 'error'>;
    lastUpdated: Date;
}
//# sourceMappingURL=index.d.ts.map