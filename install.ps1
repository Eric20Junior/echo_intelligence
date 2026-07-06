# One-line installer for Windows: downloads the latest prebuilt release (built
# by .github/workflows/package.yml from a version tag) and unzips it. No git or
# Node.js required on the machine running this script.
$ErrorActionPreference = "Stop"

# Some Windows 10 setups (and PowerShell hosts using older .NET Framework
# defaults) don't negotiate TLS 1.2 automatically, which makes the download
# below fail with "Could not create SSL/TLS secure channel" even though
# GitHub requires TLS 1.2+. Forcing it here is a no-op where it's already
# the default.
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

$Repo = "Eric20Junior/echo_intelligence"
$Dest = if ($args.Count -gt 0) { $args[0] } else { "$env:USERPROFILE\echo-intelligence" }
$Url = "https://github.com/$Repo/releases/latest/download/echo-intelligence-windows.zip"
$TmpZip = Join-Path $env:TEMP "echo-intelligence-install.zip"

Write-Host "Downloading Echo Intelligence (windows)..."
Invoke-WebRequest -Uri $Url -OutFile $TmpZip

New-Item -ItemType Directory -Force -Path $Dest | Out-Null
Write-Host "Unzipping to $Dest..."
Expand-Archive -Path $TmpZip -DestinationPath $Dest -Force
Remove-Item $TmpZip

Write-Host ""
Write-Host "Installed to $Dest"
Write-Host "Run it with: $Dest\bin\echo-intelligence.exe"
Write-Host "Then open http://localhost:8787/ in your browser."
Write-Host ""
Write-Host "Note: the app isn't code-signed. If Windows SmartScreen warns you,"
Write-Host "click 'More info' then 'Run anyway'."
