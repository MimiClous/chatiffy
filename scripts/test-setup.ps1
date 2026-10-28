$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
$version = (Get-Content "$root\package.json" -Raw | ConvertFrom-Json).version
$setup = Join-Path $root "dist\Chatiffy-$version-windows-x64-Setup.exe"
$install = Join-Path $env:TEMP ('Chatiffy setup test ' + [Guid]::NewGuid().ToString('N'))
$key = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\Chatiffy_is1'
if (Test-Path $key) { throw 'Existing Chatiffy installation found; refusing to modify it.' }
try {
    foreach ($attempt in 1..2) {
        $process = Start-Process $setup -ArgumentList @('/VERYSILENT', '/SUPPRESSMSGBOXES', '/NORESTART', "/DIR=`"$install`"") -PassThru -Wait
        if ($process.ExitCode -ne 0) { throw "Setup failed: $($process.ExitCode)" }
        if (!(Test-Path "$install\Chatiffy.exe") -or !(Test-Path "$install\unins000.exe")) { throw 'Installed files missing.' }
        if ((Get-Content "$install\VERSION.txt" -First 1) -ne "Chatiffy $version") { throw 'Wrong installed version.' }
    }
    & "$root\scripts\test-windows.ps1" -BuildPath $install
    $process = Start-Process "$install\unins000.exe" -ArgumentList '/VERYSILENT', '/SUPPRESSMSGBOXES', '/NORESTART' -PassThru -Wait
    if ($process.ExitCode -ne 0 -or (Test-Path "$install\Chatiffy.exe")) { throw 'Uninstall failed.' }
    Write-Output 'PASS: Setup, install over existing files, packaged application, uninstall.'
} finally {
    if (Test-Path "$install\unins000.exe") { Start-Process "$install\unins000.exe" -ArgumentList '/VERYSILENT', '/SUPPRESSMSGBOXES', '/NORESTART' -Wait }
}
