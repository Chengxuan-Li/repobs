# repobs Windows launcher: checks prerequisites, builds on first run, then runs `npm start`,
# which starts the loopback service, waits for its health check and opens your browser.
# Usage (from the repobs folder):  powershell -ExecutionPolicy Bypass -File scripts\start.ps1
$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath (Split-Path -Parent $PSScriptRoot)

$node = Get-Command node -ErrorAction SilentlyContinue
if (-not $node) {
  Write-Host 'Node.js 24 LTS is required: https://nodejs.org/' -ForegroundColor Red
  exit 1
}
$version = (& node --version).TrimStart('v')
$parts = $version.Split('.')
if ([int]$parts[0] -lt 24 -or ([int]$parts[0] -eq 24 -and [int]$parts[1] -lt 11)) {
  Write-Host "repobs needs Node.js 24.11 or newer; found $version." -ForegroundColor Red
  exit 1
}
if (-not (Get-Command git -ErrorAction SilentlyContinue)) {
  Write-Host 'Warning: Git for Windows was not found on PATH; repositories cannot be read until it is installed.' -ForegroundColor Yellow
}
if (-not (Test-Path -LiteralPath 'node_modules')) {
  Write-Host 'Installing dependencies (npm ci)...'
  & npm ci
  if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
}
if (-not (Test-Path -LiteralPath 'apps\server\dist\index.js') -or -not (Test-Path -LiteralPath 'apps\web\dist\index.html')) {
  Write-Host 'Building repobs (npm run build)...'
  & npm run build
  if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
}
& node scripts\start.mjs @args
exit $LASTEXITCODE
