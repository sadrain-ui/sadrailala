/**
 * @file remote-sync.ts
 * @module @legion/core/config
 *
 * DynamicConfigResolver — Remote Config Sync from `engine_config` (Supabase PostgREST).
 * Stale-While-Revalidate: serve cached entries for up to 60s; background refresh on expiry.
 * Requires SUPABASE_URL (or NEXT_PUBLIC_SUPABASE_URL) + SUPABASE_SERVICE_ROLE_KEY on execution nodes.
 */
/**
 * Remote Config Sync — single key read with 60s Stale-While-Revalidate cache.
 */
export declare function getRemoteConfigValue(keyName: string): Promise<string | undefined>;
/** Invalidate cache entry (e.g. after Hot-Swapping writes). */
export declare function invalidateRemoteConfigCache(keyName?: string): void;
/** True for empty, template, or placeholder values (e.g. Alchemy URLs ending in `/YOUR_KEY`). */
export declare function isUnusableConfigValue(value: string | undefined): boolean;
/**
 * Hybrid Layer Logic — Remote Config Sync row first, then `process.env[keyName]` so the engine
 * remains operational when a key is absent from Supabase.
 *
 * `const finalValue = dbValue ?? process.env[keyName]` (plus optional legacy `envFallback` chain).
 */
export declare function resolveConfigPrioritized(keyName: string, envFallback?: string): Promise<string | undefined>;
/** Batch fetch — Hybrid Layer Logic applied per key (Remote Config Sync union env). */
export declare function getRemoteConfigBatch(keyNames: readonly string[]): Promise<Record<string, string>>;
//# sourceMappingURL=remote-sync.d.ts.map