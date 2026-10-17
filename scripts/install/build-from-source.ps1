# Nularche: clone, build and install from source on Windows (PowerShell).
#   git clone https://github.com/VerseOfAC92/nularche.git; cd nularche; .\scripts\install\build-from-source.ps1
# Needs git and Node.js 24+ (with npm). It does not install them for you.
$ErrorActionPreference = "Stop"
Set-Location (Join-Path $PSScriptRoot "..\..")
if (-not (Get-Command node -ErrorAction SilentlyContinue)) { throw "Node.js 24 or newer is required: https://nodejs.org" }
if ([int](node -p "process.versions.node.split('.')[0]") -lt 24) { throw "Node.js 24 or newer is required (found $(node -v))." }
Write-Host "==> Installing dependencies (npm ci)" -ForegroundColor Cyan
npm ci; if ($LASTEXITCODE) { exit $LASTEXITCODE }
Write-Host "==> Running tests" -ForegroundColor Cyan
npm test; if ($LASTEXITCODE) { exit $LASTEXITCODE }
Write-Host "==> Building the desktop app" -ForegroundColor Cyan
npm run build:desktop; if ($LASTEXITCODE) { exit $LASTEXITCODE }
$arch = if ([Environment]::Is64BitOperatingSystem) { "x64" } else { "ia32" }
node scripts/dist-win.ts --only $arch; if ($LASTEXITCODE) { exit $LASTEXITCODE }
$label = if ($arch -eq "x64") { "x64" } else { "x86" }
$setup = Get-ChildItem "release\Nularche-*-Windows-$label-Setup.exe" | Select-Object -First 1
Write-Host "==> Installing $($setup.Name)" -ForegroundColor Cyan
Start-Process -FilePath $setup.FullName -ArgumentList "/S" -Wait
Write-Host "==> Done. Start Nularche from the Start menu." -ForegroundColor Green
