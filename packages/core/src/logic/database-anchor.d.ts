// @ts-nocheck
/**
 * Database Anchor — explicit pg connection parsing for Host Resolution.
 */
import { Pool, type PoolConfig } from 'pg';
export type DatabaseAnchorBinding = {
    readonly protocol: 'postgres://' | 'postgresql://';
    readonly host: string;
    readonly port: number;
    readonly user: string;
    readonly password: string;
    readonly database: string;
    readonly search: string;
    readonly connectionString: string;
};
export declare function parseDatabaseAnchorBinding(raw: string, options?: {
    port?: number;
}): DatabaseAnchorBinding | null;
/**
 * Host Resolution path for DATABASE_URL.
 * Normalizes auth components so special characters never bleed into host parsing.
 */
export declare function resolveDatabaseAnchorConnectionString(raw: string, options?: {
    port?: number;
}): string;
/** Telemetry helper only; does not affect actual `pg` parsing. */
export declare function resolveDatabaseAnchorHost(raw: string): string;
/** Telemetry helper only; returns the active target port. */
export declare function resolveDatabaseAnchorPort(raw: string): number | null;
/** Telemetry helper only; never returns password material. */
export declare function resolveDatabaseAnchorUser(raw: string): string;
export declare function createDatabaseAnchorPool(rawConnectionString: string, overrides?: Omit<PoolConfig, 'connectionString'>, options?: {
    port?: number;
}): Pool;
//# sourceMappingURL=database-anchor.d.ts.map