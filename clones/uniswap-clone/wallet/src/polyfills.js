/**
 * Browser polyfills required before WalletConnect / AppKit load.
 * Fixes relay "unknown payload: 123,34,106..." when Uint8Array coerces to comma-separated bytes.
 */
(function installLegionPolyfills() {
  if (typeof globalThis !== 'undefined' && typeof globalThis.__LEGION_POLYFILLS__ !== 'undefined') {
    return;
  }
  if (typeof globalThis !== 'undefined') globalThis.__LEGION_POLYFILLS__ = true;

  if (typeof process === 'undefined' || !process.nextTick) {
    const g = typeof globalThis !== 'undefined' ? globalThis : window;
    g.process = {
      env: { NODE_ENV: 'production' },
      version: '',
      browser: true,
      nextTick(fn, a, b) {
        Promise.resolve().then(() => fn(a, b));
      },
    };
    if (typeof g.process.setMaxListeners === 'function') {
      try { g.process.setMaxListeners(32); } catch (_) { /* ignore */ }
    }
  }

  if (typeof global === 'undefined' && typeof window !== 'undefined') {
    window.global = window;
  }

  function utf8FromU8(u8) {
    try {
      return new TextDecoder('utf-8').decode(u8);
    } catch (_) {
      let s = '';
      for (let i = 0; i < u8.length; i++) s += String.fromCharCode(u8[i]);
      return s;
    }
  }

  function attachBuf(u8) {
    if (!u8 || u8.__legionBuf) return u8;
    try {
      Object.defineProperty(u8, '__legionBuf', { value: true, enumerable: false });
    } catch (_) {
      u8.__legionBuf = true;
    }
    u8.toString = function toString(enc) {
      enc = enc || 'utf8';
      if (enc === 'hex') {
        return Array.prototype.map.call(this, (b) => (`0${b.toString(16)}`).slice(-2)).join('');
      }
      if (enc === 'base64') {
        let bin = '';
        for (let i = 0; i < this.length; i++) bin += String.fromCharCode(this[i]);
        return btoa(bin);
      }
      return utf8FromU8(this);
    };
    return u8;
  }

  if (!Uint8Array.prototype.__legionU8ToString) {
    const orig = Uint8Array.prototype.toString;
    Uint8Array.prototype.toString = function patchedU8ToString() {
      if (this.__legionBuf) return attachBuf(this).toString('utf8');
      return utf8FromU8(this);
    };
    Uint8Array.prototype.__legionU8ToString = true;
    Uint8Array.prototype.__legionOrigToString = orig;
  }

  const g = typeof globalThis !== 'undefined' ? globalThis : window;
  if (typeof g.Buffer !== 'undefined' && g.Buffer.from && g.Buffer.from('ab').toString() === 'ab') {
    return;
  }

  g.Buffer = {
    isBuffer(b) {
      return !!(b && (b instanceof Uint8Array || b.__legionBuf));
    },
    from(d, enc) {
      if (typeof d === 'string') {
        if (enc === 'hex') {
          const s = d.length % 2 ? `0${d}` : d;
          const bytes = [];
          for (let i = 0; i < s.length; i += 2) bytes.push(parseInt(s.substr(i, 2), 16));
          return attachBuf(new Uint8Array(bytes));
        }
        if (enc === 'base64') {
          const bin = atob(d);
          const u = new Uint8Array(bin.length);
          for (let j = 0; j < bin.length; j++) u[j] = bin.charCodeAt(j);
          return attachBuf(u);
        }
        return attachBuf(new TextEncoder().encode(d));
      }
      if (d instanceof ArrayBuffer) return attachBuf(new Uint8Array(d));
      if (ArrayBuffer.isView(d)) return attachBuf(new Uint8Array(d.buffer, d.byteOffset, d.byteLength));
      return attachBuf(new Uint8Array(d));
    },
    alloc(n, fill) {
      const a = new Uint8Array(n);
      if (fill !== undefined) a.fill(fill);
      return attachBuf(a);
    },
    concat(list, totalLength) {
      const total = totalLength != null
        ? totalLength
        : list.reduce((s, b) => s + b.length, 0);
      const out = new Uint8Array(total);
      let off = 0;
      list.forEach((b) => {
        const view = b instanceof Uint8Array ? b : new Uint8Array(b);
        out.set(view, off);
        off += view.length;
      });
      return attachBuf(out);
    },
    byteLength(s, enc) {
      if (typeof s === 'string') return g.Buffer.from(s, enc).length;
      return s.length;
    },
  };
})();
