/**
 * Scoped JSON.stringify patch — active only during WalletConnect sessions.
 * Avoids global side effects on viem/ethers while WC relay serializes Uint8Array payloads.
 */
let origStringify = null;
let depth = 0;

export function installWcJsonPatch() {
  if (typeof JSON === 'undefined') return;
  if (!origStringify) origStringify = JSON.stringify;
  depth += 1;
  if (depth > 1) return;

  const legionReplacer = (typeof globalThis !== 'undefined' && globalThis.__LEGION_WC_JSON_REPLACER__)
    || ((key, val) => {
      if (val instanceof Uint8Array) {
        return { type: 'Buffer', data: Array.prototype.slice.call(val) };
      }
      return val;
    });

  JSON.stringify = function wcStringify(value, replacer, space) {
    const fn = typeof replacer === 'function' ? replacer : null;
    const keys = Array.isArray(replacer) ? replacer : null;
    return origStringify(value, (key, val) => {
      const normalized = legionReplacer(key, val);
      if (normalized !== val) return normalized;
      if (fn) return fn(key, val);
      if (keys && key !== '' && keys.indexOf(key) === -1) return undefined;
      return val;
    }, space);
  };
}

export function uninstallWcJsonPatch() {
  if (!origStringify || depth <= 0) return;
  depth -= 1;
  if (depth === 0) {
    JSON.stringify = origStringify;
  }
}

export function isWcJsonPatchActive() {
  return depth > 0;
}
