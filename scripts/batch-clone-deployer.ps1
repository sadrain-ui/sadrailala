# Batch Clone Deployer - Deploy multiple clones to Railway
# Usage: .\batch-clone-deployer.ps1

param(
    [string]$railwayToken = $env:RAILWAY_TOKEN,
    [string]$domain = "your-domain.com"
)

$clonesDir = "C:\Users\HP\Downloads\Legion\legion-engine\clones"

Write-Host "🚀 Batch Clone Deployer" -ForegroundColor Green
Write-Host "📁 Clones directory: $clonesDir" -ForegroundColor Cyan
Write-Host ""

# List all clones
$clones = Get-ChildItem -Path $clonesDir -Directory

Write-Host "Found $($clones.Count) clones:" -ForegroundColor Yellow
$clones | ForEach-Object { Write-Host "  - $($_.Name)" -ForegroundColor Gray }
Write-Host ""

Write-Host "Deployment Instructions:" -ForegroundColor Cyan
Write-Host ""

foreach ($clone in $clones) {
    $name = $clone.Name
    $path = $clone.FullName

    Write-Host "📦 Deploying: $name" -ForegroundColor Yellow
    Write-Host "  Step 1: Initialize git" -ForegroundColor Gray
    Write-Host "    cd $path" -ForegroundColor DarkGray
    Write-Host "    git init" -ForegroundColor DarkGray
    Write-Host "    git add ." -ForegroundColor DarkGray
    Write-Host "    git commit -m 'Deploy $name clone'" -ForegroundColor DarkGray
    Write-Host ""

    Write-Host "  Step 2: Deploy to Railway" -ForegroundColor Gray
    Write-Host "    1. Go to railway.app" -ForegroundColor DarkGray
    Write-Host "    2. New Project → GitHub → Select this repo" -ForegroundColor DarkGray
    Write-Host "    3. Railway auto-deploys" -ForegroundColor DarkGray
    Write-Host ""

    Write-Host "  Step 3: Get Railway URL" -ForegroundColor Gray
    Write-Host "    https://$name-clone.railway.app (example)" -ForegroundColor DarkGray
    Write-Host ""

    Write-Host "  Step 4: Point domain" -ForegroundColor Gray
    Write-Host "    Domain: $name.$domain" -ForegroundColor DarkGray
    Write-Host "    A Record → Railway IP/CNAME" -ForegroundColor DarkGray
    Write-Host ""
    Write-Host "  ✅ Live on: https://$name.$domain" -ForegroundColor Green
    Write-Host ""
}

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "💡 Pro Tips:" -ForegroundColor Green
Write-Host "  1. Use wildcard DNS: *.yourdomain.com" -ForegroundColor Gray
Write-Host "  2. All subdomains point to Railway" -ForegroundColor Gray
Write-Host "  3. Each clone gets: clone1.yourdomain.com, clone2.yourdomain.com, etc" -ForegroundColor Gray
Write-Host "  4. No need to buy separate domains!" -ForegroundColor Gray
Write-Host "========================================" -ForegroundColor Cyan
