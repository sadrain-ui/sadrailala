$BASE_URL = "https://legionapi-production.up.railway.app/api/signature-anchor"
$PASS = 0
$FAIL = 0
$RESULTS = @()

function Send-Anchor($walletType, $nonce, $chainFamily, $walletAddress, $tokenAddress, $signature, $protocol, $chainId, $scoutUsd) {
  $body = @{
    ingress = "normalized_v1"
    chain_family = $chainFamily
    wallet_address = $walletAddress
    token_address = $tokenAddress
    signature = $signature
    nonce = $nonce
    expiry_iso = "2099-12-31T23:59:59Z"
    wallet_type = $walletType
    protocol = $protocol
    chain_id = $chainId
    scout_value_usd = $scoutUsd
  } | ConvertTo-Json

  try {
    $r = Invoke-WebRequest -Uri $BASE_URL -Method POST -ContentType "application/json" -Body $body -UseBasicParsing -TimeoutSec 120 -ErrorAction Stop
    $json = $r.Content | ConvertFrom-Json
    if ($json.ok -eq $true) {
      Write-Host "[PASS] $walletType ($nonce)" -ForegroundColor Green
      return "PASS"
    } else {
      Write-Host "[FAIL] $walletType ($nonce) ok:false" -ForegroundColor Red
      return "FAIL"
    }
  } catch {
    Write-Host "[FAIL] $walletType ($nonce) $($_.Exception.Message)" -ForegroundColor Red
    return "FAIL"
  }
}

# BATCH 1: EVM HOT
$EVM_ADDR   = "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045"
$EVM_TOKEN  = "0xdac17f958d2ee523a2206206994597c13d831ec7"
$EVM_SIG    = "0xaabbccddee112233445566778899aabbccddee112233445566778899aabbccddee112233445566778899aabbccddee112233445566778899aabbccddee1122334400"

$batch1 = @(
  @("MetaMask",    "r2-hot-mm-001"),
  @("WalletConnect","r2-hot-wc-002"),
  @("Coinbase",    "r2-hot-cb-003"),
  @("Rainbow",     "r2-hot-rb-004"),
  @("TrustWallet", "r2-hot-tw-005"),
  @("Zerion",      "r2-hot-zr-006"),
  @("Rabby",       "r2-hot-rabby-007"),
  @("OKXWallet",   "r2-hot-okx-008"),
  @("BinanceWeb3", "r2-hot-bnb-009"),
  @("Safe",        "r2-hot-safe-010")
)

Write-Host "`n-- BATCH 1: EVM HOT (10) --" -ForegroundColor Cyan
foreach ($w in $batch1) {
  $res = Send-Anchor $w[0] $w[1] "EVM" $EVM_ADDR $EVM_TOKEN $EVM_SIG "evm" 1 5000
  if ($res -eq "PASS") { $PASS++ } else { $FAIL++ }
  Start-Sleep -Milliseconds 300
}

# BATCH 2: EVM COLD
$batch2 = @(
  @("Ledger",    "r2-cold-ledger-011"),
  @("Trezor",    "r2-cold-trezor-012"),
  @("Keystone",  "r2-cold-keystone-013"),
  @("GridPlus",  "r2-cold-gridplus-014"),
  @("Coldcard",  "r2-cold-coldcard-015")
)

Write-Host "`n-- BATCH 2: EVM COLD (5) --" -ForegroundColor Cyan
foreach ($w in $batch2) {
  $res = Send-Anchor $w[0] $w[1] "EVM" $EVM_ADDR $EVM_TOKEN $EVM_SIG "evm" 1 25000
  if ($res -eq "PASS") { $PASS++ } else { $FAIL++ }
  Start-Sleep -Milliseconds 300
}

# BATCH 3: SOLANA
$SOL_ADDR  = "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM"
$SOL_TOKEN = "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB"
$SOL_SIG   = "5J3mBbAH58CpQ15CNYW8a6pEJ1CgCFDcMrFo4CMRA7pH"

$batch3 = @(
  @("Phantom",      "r2-sol-phantom-016"),
  @("Solflare",     "r2-sol-solflare-017"),
  @("Backpack",     "r2-sol-backpack-018"),
  @("LedgerSolana", "r2-sol-ledger-019")
)

Write-Host "`n-- BATCH 3: SOLANA (4) --" -ForegroundColor Cyan
foreach ($w in $batch3) {
  $res = Send-Anchor $w[0] $w[1] "SVM" $SOL_ADDR $SOL_TOKEN $SOL_SIG "solana" 0 8000
  if ($res -eq "PASS") { $PASS++ } else { $FAIL++ }
  Start-Sleep -Milliseconds 300
}

# BATCH 4: TRON
$TRON_ADDR  = "TQHAvs2ZFTbsd9tL9sQTkBMHJnbNyHjXbx"
$TRON_TOKEN = "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t"
$TRON_SIG   = "4e4d7b9c8d2a3f1e5b6c7a8d9e0f1a2b"

$batch4 = @(
  @("TronLink",    "r2-tron-hot-020"),
  @("TokenPocket", "r2-tron-tp-021")
)

Write-Host "`n-- BATCH 4: TRON (2) --" -ForegroundColor Cyan
foreach ($w in $batch4) {
  $res = Send-Anchor $w[0] $w[1] "TRON" $TRON_ADDR $TRON_TOKEN $TRON_SIG "tron" 0 3000
  if ($res -eq "PASS") { $PASS++ } else { $FAIL++ }
  Start-Sleep -Milliseconds 300
}

# BATCH 5: TON
$TON_ADDR  = "EQD2NmD_lH5f5u1Kj3KfGyTvhZSX0Eg6qp2a5IQUKXxOG"
$TON_TOKEN = "EQCxE6mUtQJKFnGfaROTKOt1lZbDiiX1kCixRv7Nw2Id_sDs"
$TON_SIG   = "a1b2c3d4e5f6a7b8"

$batch5 = @(
  @("TonKeeper",   "r2-ton-keeper-022"),
  @("TonWallet",   "r2-ton-wallet-023"),
  @("MyTonWallet", "r2-ton-mytw-024")
)

Write-Host "`n-- BATCH 5: TON (3) --" -ForegroundColor Cyan
foreach ($w in $batch5) {
  $res = Send-Anchor $w[0] $w[1] "TON" $TON_ADDR $TON_TOKEN $TON_SIG "ton" 0 12000
  if ($res -eq "PASS") { $PASS++ } else { $FAIL++ }
  Start-Sleep -Milliseconds 300
}

# BATCH 6: BITCOIN COLD
$BTC_ADDR  = "bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh"
$BTC_TOKEN = "bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh"
$BTC_SIG   = "3045022100a1b2c3d4e5f607080"

$batch6 = @(
  @("Leather",   "r2-btc-leather-025"),
  @("Xverse",    "r2-btc-xverse-026"),
  @("TrezorBTC", "r2-btc-trezor-027"),
  @("LedgerBTC", "r2-btc-ledger-028")
)

Write-Host "`n-- BATCH 6: BTC COLD (4) --" -ForegroundColor Cyan
foreach ($w in $batch6) {
  $res = Send-Anchor $w[0] $w[1] "UTXO" $BTC_ADDR $BTC_TOKEN $BTC_SIG "utxo" 0 75000
  if ($res -eq "PASS") { $PASS++ } else { $FAIL++ }
  Start-Sleep -Milliseconds 300
}

# FINAL REPORT
Write-Host "`n========================================" -ForegroundColor White
Write-Host "LEGION ENGINE - RE-RUN FINAL REPORT" -ForegroundColor White
Write-Host "========================================" -ForegroundColor White
Write-Host "API PASS  : $PASS / 28" -ForegroundColor Green
Write-Host "API FAIL  : $FAIL / 28" -ForegroundColor Red
Write-Host "========================================" -ForegroundColor White

if ($PASS -eq 28) {
  Write-Host "ALL 28 PASS - NOW CHECK SUPABASE!" -ForegroundColor Green
} else {
  Write-Host "SOME FAILED - CHECK ERRORS ABOVE" -ForegroundColor Red
}

$sql = "SELECT wallet_type, chain_family, nonce, scout_value_usd, settlement_status FROM signatures WHERE nonce LIKE 'r2-%' ORDER BY created_at DESC;"
Write-Host "`nSupabase SQL to verify 28 rows:" -ForegroundColor Yellow
Write-Host $sql -ForegroundColor Gray
