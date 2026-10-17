# Nularche: install the latest release from GitHub on Windows.
#   irm https://raw.githubusercontent.com/VerseOfAC92/nularche/main/scripts/install/install.ps1 | iex
# Picks the 64-bit (x64) or 32-bit (x86) installer for this PC and installs Nularche for the current user.
# It installs nothing else.
$ErrorActionPreference = "Stop"
$repo = "VerseOfAC92/nularche"
$arch = if ([Environment]::Is64BitOperatingSystem) { "x64" } else { "x86" }
Write-Host "==> Looking up the latest Nularche release ($arch)" -ForegroundColor Cyan
$release = Invoke-RestMethod "https://api.github.com/repos/$repo/releases/latest" -Headers @{ "User-Agent" = "nularche-installer" }
$asset = $release.assets | Where-Object { $_.name -like "*Windows-$arch-Setup.exe" } | Select-Object -First 1
if (-not $asset) { throw "Could not find the Windows $arch installer in the latest release." }
$setup = Join-Path $env:TEMP $asset.name
Write-Host "==> Downloading $($asset.name)" -ForegroundColor Cyan
Invoke-WebRequest $asset.browser_download_url -OutFile $setup -UseBasicParsing
Unblock-File $setup
Write-Host "==> Installing (current user, no admin rights needed)" -ForegroundColor Cyan
Start-Process -FilePath $setup -ArgumentList "/S" -Wait
Remove-Item $setup -Force
$exe = Join-Path $env:LOCALAPPDATA "Programs\Nularche\Nularche.exe"
if (Test-Path $exe) {
  Write-Host "==> Done. Starting Nularche…" -ForegroundColor Green
  Start-Process $exe
} else {
  Write-Host "==> Installed. Start Nularche from the Start menu." -ForegroundColor Green
}
