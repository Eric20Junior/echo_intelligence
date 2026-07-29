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

$Exe = Join-Path $Dest "bin\echo-intelligence.exe"
# Shipped with the frontend's static export, so it's present in every install.
# Only 16x16/32x32 though, and it matters more here than elsewhere: the SEA
# executable is a copied node.exe, so without this the shortcut would show the
# Node.js logo. Worth replacing with a proper multi-resolution icon eventually.
$Icon = Join-Path $Dest "public\favicon.ico"

# Desktop + Start-menu shortcuts, so the operator double-clicks an icon instead
# of typing a path into a terminal (the whole point of this being installable at
# all). Wrapped in try/catch because $ErrorActionPreference is "Stop" up top and
# a missing shortcut is cosmetic — it must never fail an otherwise-good install.
#
# The shortcut targets the .exe directly, so launching it shows a console window.
# That's deliberate: the window is the operator's stop button ("close it to
# quit") and the only place startup errors are visible. The app opens the
# operator page in their browser by itself once it's up (lib/open-browser.js).
$ShortcutMade = $false
try {
    $shell = New-Object -ComObject WScript.Shell
    # GetFolderPath rather than "$env:USERPROFILE\Desktop" — it resolves a
    # OneDrive-redirected Desktop, which is the default on plenty of machines.
    foreach ($dir in @([Environment]::GetFolderPath("Desktop"), [Environment]::GetFolderPath("Programs"))) {
        if (-not $dir -or -not (Test-Path $dir)) { continue }
        $lnk = $shell.CreateShortcut((Join-Path $dir "Echo Intelligence.lnk"))
        $lnk.TargetPath = $Exe
        $lnk.WorkingDirectory = Join-Path $Dest "bin"
        $lnk.Description = "Live scripture detection for church services"
        if (Test-Path $Icon) { $lnk.IconLocation = $Icon }
        $lnk.Save()
        $ShortcutMade = $true
    }
}
catch {
    Write-Host "(Couldn't create shortcuts: $($_.Exception.Message))"
}

Write-Host ""
Write-Host "Installed to $Dest"
if ($ShortcutMade) {
    Write-Host "Start it from the 'Echo Intelligence' icon on your desktop or Start menu."
    Write-Host "It opens the operator page in your browser automatically."
    Write-Host "(Or run it directly: $Exe)"
} else {
    Write-Host "Run it with: $Exe"
    Write-Host "It opens the operator page in your browser automatically."
}
Write-Host ""
Write-Host "Note: the app isn't code-signed. If Windows SmartScreen warns you,"
Write-Host "click 'More info' then 'Run anyway'."
