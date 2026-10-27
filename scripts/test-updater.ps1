$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
$work = Join-Path ([IO.Path]::GetTempPath()) ('Chatiffy-updater-test-' + [Guid]::NewGuid().ToString('N'))
try {
    $package = Join-Path $work 'Chatiffy-9.9.9-windows-x64'
    foreach ($name in @('Chatiffy.exe', 'runtime\node.exe', 'runtime\LICENSE', 'app\server.mjs', 'app\build\server.mjs', 'app\build\app.js', 'app\index.html', 'app\style.css', 'app\assets\fonts\Monocraft.ttf', 'update.ps1', 'VERSION.txt')) {
        $path = Join-Path $package $name
        New-Item -ItemType Directory -Path (Split-Path $path -Parent) -Force | Out-Null
        'fixture' | Set-Content $path
    }
    'Chatiffy 9.9.9' | Set-Content (Join-Path $package 'VERSION.txt')
    $zip = Join-Path $work 'valid.zip'
    Compress-Archive -Path $package -DestinationPath $zip
    $hash = (Get-FileHash $zip).Hash
    & "$root\windows\update.ps1" -Version 9.9.9 -PackagePath $zip -ExpectedHash $hash -ValidateOnly
    $sumFile = Join-Path $work 'release.sha256'
    $releaseName = 'Chatiffy-9.9.9-windows-x64.zip'
    # Exercise the same file decoding path as GitHub's binary .sha256 download.
    [IO.File]::WriteAllBytes($sumFile, [Text.Encoding]::ASCII.GetBytes("$hash  $releaseName`r`n"))
    & "$root\windows\update.ps1" -Version 9.9.9 -PackagePath $zip -ChecksumPath $sumFile -ValidateOnly
    [IO.File]::WriteAllText($sumFile, "$hash *$releaseName`n", [Text.UTF8Encoding]::new($true))
    & "$root\windows\update.ps1" -Version 9.9.9 -PackagePath $zip -ChecksumPath $sumFile -ValidateOnly
    foreach ($invalid in @("$hash  wrong.zip", '<html>download error</html>', "$hash  $releaseName`n$hash  other.zip")) {
        [IO.File]::WriteAllText($sumFile, $invalid)
        $rejected = $false
        try { & "$root\windows\update.ps1" -Version 9.9.9 -PackagePath $zip -ChecksumPath $sumFile -ValidateOnly } catch { $rejected = $true }
        if (!$rejected) { throw 'Invalid checksum file accepted.' }
    }
    $rejected = $false
    try { & "$root\windows\update.ps1" -Version 9.9.9 -PackagePath $zip -ExpectedHash ('0' * 64) -ValidateOnly } catch { $rejected = $true }
    if (!$rejected) { throw 'Wrong checksum accepted.' }
    $rejected = $false
    try { & "$root\windows\update.ps1" -Version 8.8.8 -PackagePath $zip -ExpectedHash $hash -ValidateOnly } catch { $rejected = $true }
    if (!$rejected) { throw 'Wrong package version accepted.' }
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    $unsafe = Join-Path $work 'unsafe.zip'
    $archive = [IO.Compression.ZipFile]::Open($unsafe, [IO.Compression.ZipArchiveMode]::Create)
    $archive.CreateEntry('../outside.txt') | Out-Null
    $archive.Dispose()
    $rejected = $false
    try { & "$root\windows\update.ps1" -Version 9.9.9 -PackagePath $unsafe -ExpectedHash (Get-FileHash $unsafe).Hash -ValidateOnly } catch { $rejected = $true }
    if (!$rejected) { throw 'ZIP traversal accepted.' }
    Write-Output 'PASS: updater valid archive, checksum mismatch, wrong version, ZIP traversal.'
} finally { if (Test-Path $work) { Remove-Item -LiteralPath $work -Recurse -Force } }
