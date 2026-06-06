# CAPTCHA automation awareness — security training only

**Target reference:** https://example.com  
**Generated:** 2026-06-03T23:26:57.904Z

> **Purpose:** Help developers understand how third-party CAPTCHA solving services (e.g. [2captcha](https://2captcha.com)) work, why attackers use them, and what defenses reduce automated abuse.  
> **This document is educational only.** Nothing in this mirror bundle calls 2captcha or any solver API.

---

## What problem do CAPTCHAs solve?

CAPTCHAs (reCAPTCHA, Cloudflare Turnstile, hCaptcha, etc.) distinguish **likely humans** from **automated clients**. Sites use them to:

- Block credential stuffing and spam sign-ups
- Protect high-value actions (login, checkout, wallet connect)
- Rate-limit scripted abuse without blocking all anonymous traffic

CAPTCHAs are not perfect. They trade **friction for humans** against **cost for attackers**.

---

## How human-solver services work (2captcha model)

Services like 2captcha do **not** break cryptography. They outsource the puzzle to humans or specialized workers:

1. **Submit** — Your script sends the CAPTCHA type, site key, and page URL to the solver API (`in.php`).
2. **Queue** — The service returns a task ID. Workers solve the challenge out-of-band.
3. **Poll** — Your script polls `res.php` until status is ready (often 5–30+ seconds).
4. **Inject** — You paste the returned token into the form field or callback the widget expects.

Common CAPTCHA types supported by these APIs:

| Type | What you send | What you get back |
|------|----------------|-------------------|
| reCAPTCHA v2/v3 | `sitekey`, `pageurl` | Token string for `g-recaptcha-response` |
| Cloudflare Turnstile | `sitekey`, `pageurl` | Turnstile response token |
| hCaptcha | `sitekey`, `pageurl` | hCaptcha response token |
| Image CAPTCHA | Base64 image | Plaintext answer |

Pricing is per solve (fractions of a cent to a few cents). Attackers scale cost linearly with volume.

---

## Sample integration pattern (illustrative — not wired in this mirror)

The snippet below shows the **typical async poll loop** developers see in solver integrations.  
**Do not run this against production sites you do not own.** Replace placeholders only in authorized staging labs.

```typescript
/**
 * EDUCATIONAL EXAMPLE ONLY — not executed by the mirror generator.
 * Demonstrates the 2captcha Turnstile flow (submit → poll → token).
 */
async function solveTurnstileEducationalExample(
  apiKey: string,
  siteKey: string,
  pageUrl: string,
): Promise<string> {
  // Step 1: Create task
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
  const createJson = (await createRes.json()) as { status: number; request: string }
  if (createJson.status !== 1) {
    throw new Error(createJson.request || 'solver create failed')
  }
  const taskId = createJson.request

  // Step 2: Poll until ready (real integrations often wait 5–15s between polls)
  for (let attempt = 0; attempt < 24; attempt++) {
    await new Promise((r) => setTimeout(r, 5000))
    const pollUrl =
      'https://2captcha.com/res.php?' +
      new URLSearchParams({
        key: apiKey,
        action: 'get',
        id: taskId,
        json: '1',
      })
    const pollRes = await fetch(pollUrl)
    const pollJson = (await pollRes.json()) as { status: number; request: string }
    if (pollJson.status === 1) return pollJson.request // token
    if (pollJson.request !== 'CAPCHA_NOT_READY') {
      throw new Error(pollJson.request || 'poll failed')
    }
  }
  throw new Error('solver timeout')
}

// Step 3: Submit token with your form (conceptual)
// document.querySelector('[name="cf-turnstile-response"]').value = token
// form.submit()
```

**Why this is fragile for attackers:**

- **Latency** — Poll loops add 10–60s per attempt; bad for real-time flows.
- **Cost** — High-volume abuse gets expensive; still cheaper than manual QA for some threat actors.
- **Detection** — Solver IP ranges, token reuse, missing browser signals, and anomaly scoring can flag solves.
- **Site-specific wiring** — Each integration needs the correct widget type, action names, and POST fields.
- **Policy / legal** — Using solver APIs against third-party sites violates most ToS and may be unlawful.

---

## Automation challenges defenders should understand

When designing auth and anti-abuse controls, assume motivated actors **can** obtain tokens via:

- Human farms and click workers
- Solver APIs (2captcha, Anti-Captcha, CapSolver, etc.)
- Browser automation with real profiles (harder but not impossible)

CAPTCHA alone is **one layer**, not a complete defense. Combine with:

- **Risk scoring** — Device fingerprint, velocity, geo, ASN, headless signals
- **Server-side validation** — Verify tokens with the provider's siteverify endpoint; check action/score thresholds
- **Step-up auth** — MFA, email magic links, or hardware keys for sensitive actions
- **Rate limits & lockouts** — Per IP, account, and global budgets
- **Turnstile / v3 scores** — Prefer invisible or scored challenges; block low scores server-side
- **Monitoring** — Alert on solve latency patterns, repeated failures, and token validation errors

---

## Relation to this mirror bundle

This QA mirror (`https://example.com`) is a **reverse proxy for routing/latency tests**. The `--captcha-demo` flag adds **this README only**.

- No `TWOCAPTCHA_API_KEY` is read or stored here.
- No solver client is injected into nginx or docker-compose.
- For clone-mode Turnstile helpers (separate flag `--solve-captcha` on static clones), see the main generator docs — still authorized staging only.

---

## Further reading (internal)

- OWASP: Automated Threats to Web Applications
- Cloudflare Turnstile docs — server-side token validation
- Google reCAPTCHA admin — score thresholds and action names

**Authorized use:** Internal security awareness training on systems your team operates.
