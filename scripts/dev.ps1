# repobs development mode (backend from sources with --watch + Vite dev UI). Not for everyday use.
$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath (Split-Path -Parent $PSScriptRoot)
& node scripts\dev.mjs @args
exit $LASTEXITCODE
