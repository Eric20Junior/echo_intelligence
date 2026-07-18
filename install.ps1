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

# Invoke-WebRequest's default progress rendering can dump raw "Writing web
# request... Writing request stream..." text instead of a progress bar on
# some PowerShell hosts (older consoles, redirected output, etc). Stream the
# download manually instead so we can drive a real Write-Progress bar and
# still surface HTTP errors properly.
$response = $null
$responseStream = $null
$fileStream = $null
try {
    $request = [System.Net.HttpWebRequest]::Create($Url)
    $response = $request.GetResponse()
    $totalBytes = $response.ContentLength
    $responseStream = $response.GetResponseStream()
    $fileStream = [System.IO.File]::Create($TmpZip)

    $buffer = New-Object byte[] 65536
    $bytesRead = 0
    $totalRead = 0
    $lastPercent = -1

    while (($bytesRead = $responseStream.Read($buffer, 0, $buffer.Length)) -gt 0) {
        $fileStream.Write($buffer, 0, $bytesRead)
        $totalRead += $bytesRead
        if ($totalBytes -gt 0) {
            $percent = [math]::Floor(($totalRead / $totalBytes) * 100)
            if ($percent -ne $lastPercent) {
                Write-Progress -Activity "Downloading Echo Intelligence" `
                    -Status "$percent% ($([math]::Round($totalRead / 1MB, 1)) MB / $([math]::Round($totalBytes / 1MB, 1)) MB)" `
                    -PercentComplete $percent
                $lastPercent = $percent
            }
        }
    }
    Write-Progress -Activity "Downloading Echo Intelligence" -Completed
}
finally {
    if ($fileStream) { $fileStream.Dispose() }
    if ($responseStream) { $responseStream.Dispose() }
    if ($response) { $response.Dispose() }
}

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
