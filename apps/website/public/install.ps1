# Rippopotamus installer for Windows (x64).
#
#   irm https://rippopotamus.vercel.app/install.ps1 | iex
#
# Downloads the latest installer, verifies its SHA256 checksum, and unblocks
# it (strips the mark-of-the-web) so SmartScreen doesn't flag the unsigned
# build, then runs it.
$ErrorActionPreference = "Stop"

$repo  = "Hellodebasishsahu/Rippopotamus"
$base  = "https://github.com/$repo/releases/latest/download"
$asset = "Rippopotamus-windows-x64-setup.exe"
$out   = Join-Path $env:TEMP $asset

Write-Host "-> Downloading the latest Rippopotamus..."
Invoke-WebRequest -Uri "$base/$asset" -OutFile $out

Write-Host "-> Verifying checksum..."
$sums = (Invoke-WebRequest -Uri "$base/SHA256SUMS" -UseBasicParsing).Content
$expected = ($sums -split "`n" | Where-Object { $_ -match [regex]::Escape($asset) } | Select-Object -First 1) -split "\s+" | Select-Object -First 1
if (-not $expected) { throw "No checksum found for $asset. Aborting." }
$actual = (Get-FileHash -Path $out -Algorithm SHA256).Hash.ToLower()
if ($actual -ne $expected.ToLower()) {
  throw "Checksum verification FAILED (expected $expected, got $actual). The download may be corrupt or tampered with."
}

Write-Host "-> Unblocking the installer..."
Unblock-File -Path $out

Write-Host "-> Launching the installer..."
Start-Process -FilePath $out -Wait
Write-Host "Done."
