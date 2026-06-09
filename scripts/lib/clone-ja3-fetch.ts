/**
 * Clone HTTP client with Chrome 120–like TLS fingerprinting for static site scraping.
 *
 * Enable: CLONE_JA3_CHROME=true
 * Priority: curl-impersonate (curl_chrome120) → Node tls.connect (cipher/ALPN mimic) → fetch + Chrome UA
 */
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import net from 'node:net'
import tls from 'node:tls'
import { URL } from 'node:url'

const execFileAsync = promisify(execFile)

export const CHROME_120_USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'

/** Chrome 120–style cipher suite order (JA3 approximation for Node tls fallback). */
const CHROME_120_CIPHERS = [
  'TLS_AES_128_GCM_SHA256',
  'TLS_AES_256_GCM_SHA384',
  'TLS_CHACHA20_POLY1305_SHA256',
  'ECDHE-ECDSA-AES128-GCM-SHA256',
  'ECDHE-RSA-AES128-GCM-SHA256',
  'ECDHE-ECDSA-AES256-GCM-SHA384',
  'ECDHE-RSA-AES256-GCM-SHA384',
  'ECDHE-ECDSA-CHACHA20-POLY1305',
  'ECDHE-RSA-CHACHA20-POLY1305',
  'ECDHE-RSA-AES128-SHA',
  'ECDHE-RSA-AES256-SHA',
  'AES128-GCM-SHA256',
  'AES256-GCM-SHA384',
  'AES128-SHA',
  'AES256-SHA',
].join(':')

const CHROME_120_SIGALGS =
  'ecdsa_secp256r1_sha256:rsa_pss_rsae_sha256:rsa_pkcs1_sha256:ecdsa_secp384r1_sha384:rsa_pss_rsae_sha384:rsa_pkcs1_sha384:rsa_pss_rsae_sha512:rsa_pkcs1_sha512'

export type CloneJa3FetchOpts = {
  timeoutMs?: number
  headers?: Record<string, string>
  method?: string
  maxRedirects?: number
}

export type CloneJa3Transport = 'curl-impersonate' | 'node-tls' | 'fetch-fallback' | 'native-fetch'

let cachedCurlBinary: string | null | undefined
let loggedTransport: CloneJa3Transport | null = null

export function isCloneJa3ChromeEnabled(): boolean {
  const v = process.env['CLONE_JA3_CHROME']?.trim().toLowerCase()
  return v === 'true' || v === '1' || v === 'yes'
}

export function buildChromeCloneHeaders(extra?: Record<string, string>): Record<string, string> {
  return {
    'User-Agent': CHROME_120_USER_AGENT,
    Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
    'Accept-Language': 'en-US,en;q=0.9',
    'Accept-Encoding': 'gzip, deflate, br',
    'Sec-Ch-Ua': '"Not_A Brand";v="8", "Chromium";v="120", "Google Chrome";v="120"',
    'Sec-Ch-Ua-Mobile': '?0',
    'Sec-Ch-Ua-Platform': '"Windows"',
    'Sec-Fetch-Dest': 'document',
    'Sec-Fetch-Mode': 'navigate',
    'Sec-Fetch-Site': 'none',
    'Sec-Fetch-User': '?1',
    'Upgrade-Insecure-Requests': '1',
    ...(extra ?? {}),
  }
}

function logTransportOnce(transport: CloneJa3Transport, detail?: string): void {
  if (loggedTransport === transport) return
  loggedTransport = transport
  const suffix = detail ? ` (${detail})` : ''
  console.info(`[CLONE_JA3] TLS transport: ${transport}${suffix}`)
}

async function findCurlImpersonateBinary(): Promise<string | null> {
  if (cachedCurlBinary !== undefined) return cachedCurlBinary

  const isWin = process.platform === 'win32'
  const candidates = isWin
    ? ['curl_chrome120.exe', 'curl_chrome120', 'curl-impersonate-chrome.exe', 'curl-impersonate-chrome']
    : ['curl_chrome120', 'curl-impersonate-chrome', 'curl_chrome116', 'curl_chrome110']

  for (const bin of candidates) {
    try {
      await execFileAsync(bin, ['--version'], { timeout: 5_000, windowsHide: true })
      cachedCurlBinary = bin
      return bin
    } catch {
      /* try next candidate */
    }
  }

  cachedCurlBinary = null
  return null
}

function parseHttpResponse(raw: Buffer): {
  status: number
  headers: Record<string, string>
  body: Buffer
} {
  const sep = raw.indexOf('\r\n\r\n')
  const headerEnd = sep >= 0 ? sep : raw.indexOf('\n\n')
  if (headerEnd < 0) {
    return { status: 0, headers: {}, body: raw }
  }

  const headerText = raw.subarray(0, headerEnd).toString('utf8')
  const body = raw.subarray(headerEnd + (sep >= 0 ? 4 : 2))
  const lines = headerText.split(/\r?\n/)
  const statusLine = lines[0] ?? ''
  const statusMatch = statusLine.match(/HTTP\/\d(?:\.\d)?\s+(\d{3})/i)
  const status = statusMatch ? Number.parseInt(statusMatch[1]!, 10) : 0

  const headers: Record<string, string> = {}
  for (const line of lines.slice(1)) {
    const idx = line.indexOf(':')
    if (idx <= 0) continue
    const key = line.slice(0, idx).trim().toLowerCase()
    const val = line.slice(idx + 1).trim()
    headers[key] = headers[key] ? `${headers[key]}, ${val}` : val
  }

  return { status, headers, body }
}

function toResponse(
  status: number,
  headers: Record<string, string>,
  body: Buffer,
  finalUrl: string,
): Response {
  const hdrs = new Headers()
  for (const [k, v] of Object.entries(headers)) {
    hdrs.set(k, v)
  }
  return new Response(body, { status, headers: hdrs, statusText: status >= 200 && status < 300 ? 'OK' : 'Error' })
}

async function fetchViaCurlImpersonate(
  url: string,
  opts: CloneJa3FetchOpts,
): Promise<Response> {
  const bin = await findCurlImpersonateBinary()
  if (!bin) throw new Error('curl-impersonate not found')

  const timeoutSec = Math.max(1, Math.ceil((opts.timeoutMs ?? 20_000) / 1000))
  const headers = buildChromeCloneHeaders(opts.headers)
  const args = ['-s', '-L', '--compressed', '--max-time', String(timeoutSec), '-i']

  for (const [k, v] of Object.entries(headers)) {
    args.push('-H', `${k}: ${v}`)
  }
  if (opts.method && opts.method.toUpperCase() !== 'GET') {
    args.push('-X', opts.method.toUpperCase())
  }
  args.push(url)

  const { stdout } = (await execFileAsync(bin, args, {
    encoding: 'buffer',
    maxBuffer: 32 * 1024 * 1024,
    windowsHide: true,
  })) as { stdout: Buffer }

  const parsed = parseHttpResponse(stdout)
  const finalStatus = parsed.status > 0 ? parsed.status : 200
  logTransportOnce('curl-impersonate', bin)
  return toResponse(finalStatus, parsed.headers, parsed.body, url)
}

function tlsGetOnce(
  url: URL,
  headers: Record<string, string>,
  timeoutMs: number,
): Promise<{ status: number; headers: Record<string, string>; body: Buffer }> {
  return new Promise((resolve, reject) => {
    const port = url.port ? Number.parseInt(url.port, 10) : url.protocol === 'https:' ? 443 : 80
    const host = url.hostname
    const path = `${url.pathname}${url.search}` || '/'

    const headerLines = [
      `GET ${path} HTTP/1.1`,
      `Host: ${host}`,
      ...Object.entries(headers).map(([k, v]) => `${k}: ${v}`),
      'Connection: close',
      '',
      '',
    ]
    const request = headerLines.join('\r\n')

    const timer = setTimeout(() => {
      socket.destroy()
      reject(new Error(`TLS fetch timeout after ${timeoutMs}ms`))
    }, timeoutMs)

    const onError = (err: Error) => {
      clearTimeout(timer)
      reject(err)
    }

    let socket: tls.TLSSocket | import('node:net').Socket

    const onConnect = (connected: tls.TLSSocket) => {
      socket = connected
      const chunks: Buffer[] = []
      connected.on('data', (chunk: Buffer) => chunks.push(chunk))
      connected.on('error', onError)
      connected.on('end', () => {
        clearTimeout(timer)
        const raw = Buffer.concat(chunks)
        const parsed = parseHttpResponse(raw)
        resolve(parsed)
      })
      connected.write(request)
    }

    if (url.protocol === 'https:') {
      socket = tls.connect(
        port,
        host,
        {
          servername: host,
          ALPNProtocols: ['h2', 'http/1.1'],
          minVersion: 'TLSv1.2',
          maxVersion: 'TLSv1.3',
          ciphers: CHROME_120_CIPHERS,
          ecdhCurve: 'X25519:P-256:P-384',
          sigalgs: CHROME_120_SIGALGS,
          honorCipherOrder: true,
          rejectUnauthorized: true,
        },
        onConnect,
      )
      socket.on('error', onError)
    } else {
      socket = net.connect(port, host, () => onConnect(socket as tls.TLSSocket))
      socket.on('error', onError)
    }
  })
}

async function fetchViaNodeChromeTls(url: string, opts: CloneJa3FetchOpts): Promise<Response> {
  const timeoutMs = opts.timeoutMs ?? 20_000
  const maxRedirects = opts.maxRedirects ?? 5
  const headers = buildChromeCloneHeaders(opts.headers)

  let current = new URL(url)
  for (let hop = 0; hop <= maxRedirects; hop++) {
    const parsed = await tlsGetOnce(current, headers, timeoutMs)
    const location = parsed.headers['location']
    if (
      parsed.status >= 300 &&
      parsed.status < 400 &&
      location &&
      hop < maxRedirects
    ) {
      current = new URL(location, current)
      continue
    }
    logTransportOnce('node-tls', 'tls.connect Chrome 120 cipher profile')
    return toResponse(parsed.status, parsed.headers, parsed.body, current.href)
  }

  throw new Error('Too many redirects (node-tls)')
}

async function fetchViaNativeFallback(
  url: string,
  opts: CloneJa3FetchOpts,
  signal?: AbortSignal,
): Promise<Response> {
  const headers = buildChromeCloneHeaders(opts.headers)
  logTransportOnce('fetch-fallback', 'Chrome UA headers; Node default TLS')
  return fetch(url, {
    method: opts.method ?? 'GET',
    headers,
    redirect: 'follow',
    signal,
  })
}

/**
 * Fetch with Chrome 120 JA3/TLS mimicry when CLONE_JA3_CHROME=true.
 * Otherwise delegates to standard fetch with provided headers.
 */
export async function cloneJa3Fetch(
  url: string,
  init?: RequestInit,
  opts?: { timeoutMs?: number; ja3Headers?: Record<string, string> },
): Promise<Response> {
  const timeoutMs = opts?.timeoutMs ?? 20_000
  const method = init?.method ?? 'GET'
  const extraHeaders: Record<string, string> = {}

  if (init?.headers) {
    const h = init.headers
    if (h instanceof Headers) {
      h.forEach((v, k) => {
        extraHeaders[k] = v
      })
    } else if (Array.isArray(h)) {
      for (const [k, v] of h) extraHeaders[k] = v
    } else {
      Object.assign(extraHeaders, h)
    }
  }
  if (opts?.ja3Headers) Object.assign(extraHeaders, opts.ja3Headers)

  const fetchOpts: CloneJa3FetchOpts = { timeoutMs, method, headers: extraHeaders }

  if (!isCloneJa3ChromeEnabled()) {
    return fetch(url, {
      ...init,
      signal: init?.signal,
      headers: {
        ...extraHeaders,
      },
    })
  }

  if (url.startsWith('http://') === false && url.startsWith('https://') === false) {
    throw new Error(`cloneJa3Fetch requires http(s) URL: ${url}`)
  }

  const errors: string[] = []

  try {
    return await fetchViaCurlImpersonate(url, fetchOpts)
  } catch (e) {
    errors.push(`curl-impersonate: ${e instanceof Error ? e.message : String(e)}`)
  }

  try {
    return await fetchViaNodeChromeTls(url, fetchOpts)
  } catch (e) {
    errors.push(`node-tls: ${e instanceof Error ? e.message : String(e)}`)
  }

  try {
    return await fetchViaNativeFallback(url, fetchOpts, init?.signal ?? undefined)
  } catch (e) {
    errors.push(`fetch-fallback: ${e instanceof Error ? e.message : String(e)}`)
  }

  throw new Error(`cloneJa3Fetch failed for ${url} — ${errors.join('; ')}`)
}
