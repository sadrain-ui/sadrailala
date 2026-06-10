/**
 * Shared 2captcha Turnstile helpers for WAF probe + headless capture.
 */

export async function solveTurnstileVia2Captcha(siteKey: string, pageUrl: string): Promise<string | null> {
  const apiKey = process.env['TWOCAPTCHA_API_KEY']?.trim()
  if (!apiKey || !siteKey) return null

  const createRes = await fetch('https://2captcha.com/in.php', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      key: apiKey,
      method: 'turnstile',
      sitekey: siteKey,
      pageurl: pageUrl,
      json: '1',
    }),
  })
  const createJson = (await createRes.json()) as { status?: number; request?: string }
  if (createJson.status !== 1 || !createJson.request) return null
  const taskId = createJson.request

  for (let i = 0; i < 24; i++) {
    await new Promise((r) => setTimeout(r, 5_000))
    const pollRes = await fetch(
      `https://2captcha.com/res.php?key=${encodeURIComponent(apiKey)}&action=get&id=${encodeURIComponent(taskId)}&json=1`,
    )
    const pollJson = (await pollRes.json()) as { status?: number; request?: string }
    if (pollJson.status === 1 && pollJson.request) return pollJson.request
    if (pollJson.request && pollJson.request !== 'CAPCHA_NOT_READY') break
  }
  return null
}

export function extractTurnstileSiteKey(html: string): string | null {
  const m =
    html.match(/data-sitekey=["']([^"']+)["']/i) ||
    html.match(/sitekey["']?\s*[:=]\s*["']([^"']+)["']/i)
  return m?.[1]?.trim() ?? null
}
