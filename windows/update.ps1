param(
    [Parameter(Mandatory=$true)][string]$Version,
    [string]$InstallPath,
    [int]$LauncherPid,
    [string]$PackagePath,
    [string]$ExpectedHash,
    [string]$ChecksumPath,
    [switch]$ValidateOnly
)
$ErrorActionPreference = 'Stop'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
$work = Join-Path ([IO.Path]::GetTempPath()) ("Chatiffy-stage-" + [Guid]::NewGuid().ToString('N'))
$backup = $null
$stopped = $false
try {
    if ($Version -notmatch '^\d+\.\d+\.\d+$') { throw 'Invalid stable release version.' }
    New-Item -ItemType Directory $work | Out-Null
    $name = "Chatiffy-$Version-windows-x64.zip"
    if (!$PackagePath) {
        Write-Host "Downloading Chatiffy $Version. Keep this window open."
        $base = "https://github.com/MimiClous/chatiffy/releases/download/v$Version"
        $PackagePath = Join-Path $work $name
        Invoke-WebRequest "$base/$name" -OutFile $PackagePath -UseBasicParsing -TimeoutSec 180
        # GitHub serves .sha256 as application/octet-stream. In Windows PowerShell 5.1
        # response.Content can be byte[], not text: always download and decode the file.
        $ChecksumPath = Join-Path $work "$name.sha256"
        Invoke-WebRequest "$base/$name.sha256" -OutFile $ChecksumPath -UseBasicParsing -TimeoutSec 30
    }
    if ($ChecksumPath) {
        if ((Get-Item -LiteralPath $ChecksumPath).Length -gt 4096) { throw 'Invalid release checksum file: too large.' }
        $sum = [IO.File]::ReadAllText($ChecksumPath).Trim().TrimStart([char]0xFEFF)
        $pattern = '\A(?<hash>[a-fA-F0-9]{64})[ \t]+\*?' + [regex]::Escape($name) + '\z'
        $match = [regex]::Match($sum, $pattern)
        if (!$match.Success) { throw 'Invalid release checksum file. Nothing installed.' }
        $ExpectedHash = $match.Groups['hash'].Value
    }
    if ($ExpectedHash -notmatch '^[a-fA-F0-9]{64}$' -or (Get-FileHash $PackagePath -Algorithm SHA256).Hash -ne $ExpectedHash) { throw 'SHA-256 mismatch. Nothing installed.' }
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    $archive = [IO.Compression.ZipFile]::OpenRead($PackagePath)
    try {
        foreach ($entry in $archive.Entries) {
            $target = [IO.Path]::GetFullPath((Join-Path $work $entry.FullName))
            if (!$target.StartsWith($work + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) { throw 'Unsafe ZIP entry.' }
        }
    } finally { $archive.Dispose() }
    $expanded = Join-Path $work 'expanded'
    Expand-Archive -LiteralPath $PackagePath -DestinationPath $expanded
    $source = Join-Path $expanded "Chatiffy-$Version-windows-x64"
    foreach ($file in @('Chatiffy.exe', 'runtime\node.exe', 'runtime\LICENSE', 'app\server.mjs', 'app\build\server.mjs', 'app\build\app.js', 'app\index.html', 'app\style.css', 'app\assets\fonts\Monocraft.ttf', 'update.ps1', 'VERSION.txt')) {
        if (!(Test-Path -LiteralPath (Join-Path $source $file) -PathType Leaf)) { throw "Incomplete package: $file" }
    }
    if ((Get-Content (Join-Path $source 'VERSION.txt') -First 1) -ne "Chatiffy $Version") { throw 'Package version mismatch.' }
    if ($ValidateOnly) { Write-Output 'PASS: checksum, ZIP paths, package layout and version.'; return }
    if (!$InstallPath -or $LauncherPid -le 0 -or !(Test-Path (Join-Path $InstallPath 'Chatiffy.exe'))) { throw 'Invalid installation.' }
    # A complete backup is made before shutting down the working version.
    $backup = Join-Path (Split-Path $InstallPath -Parent) ("Chatiffy-backup-" + [Guid]::NewGuid().ToString('N'))
    New-Item -ItemType Directory $backup | Out-Null
    Copy-Item -Path (Join-Path $InstallPath '*') -Destination $backup -Recurse -Force
    $probe = Join-Path $InstallPath ('.update-' + [Guid]::NewGuid().ToString('N'))
    [IO.File]::WriteAllText($probe, 'write probe'); Remove-Item -LiteralPath $probe
    Write-Host 'Archive verified. Restarting Chatiffy...'
    $launcher = Get-Process -Id $LauncherPid -ErrorAction Stop
    $quit = Start-Process (Join-Path $InstallPath 'Chatiffy.exe') -ArgumentList '--quit' -PassThru
    if (!$quit.WaitForExit(5000) -or !$launcher.WaitForExit(15000)) { throw 'Chatiffy did not exit. Close it and try again.' }
    $stopped = $true
    Start-Sleep -Milliseconds 1000
    Copy-Item -Path (Join-Path $source '*') -Destination $InstallPath -Recurse -Force
    Start-Process (Join-Path $InstallPath 'Chatiffy.exe') -WorkingDirectory $InstallPath | Out-Null
    # Setup and portable share the same verified payload. Preserve the uninstaller;
    # synchronize Installed Apps metadata only for this exact Setup directory.
    $uninstallKey = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\Chatiffy_is1'
    try {
        $registration = Get-ItemProperty -LiteralPath $uninstallKey -ErrorAction SilentlyContinue
        if ($registration -and $registration.InstallLocation -and
            [IO.Path]::GetFullPath($registration.InstallLocation).TrimEnd('\') -eq [IO.Path]::GetFullPath($InstallPath).TrimEnd('\')) {
            Set-ItemProperty -LiteralPath $uninstallKey -Name DisplayVersion -Value $Version
        }
    } catch { Write-Warning 'Updated successfully; Installed Apps version could not be refreshed.' }
    Write-Host "Updated to $Version. Backup: $backup"
} catch {
    if ($stopped -and $backup) {
        try {
            Copy-Item -Path (Join-Path $backup '*') -Destination $InstallPath -Recurse -Force
            Start-Process (Join-Path $InstallPath 'Chatiffy.exe') -WorkingDirectory $InstallPath | Out-Null
            Write-Host 'Previous version restored.'
        } catch { Write-Warning "Restore the backup manually: $backup" }
    }
    if ($ValidateOnly) { throw }
    Write-Warning $_.Exception.Message
    Read-Host 'Press Enter to close'
    exit 1
} finally {
    if (Test-Path $work) { Remove-Item -LiteralPath $work -Recurse -Force -ErrorAction SilentlyContinue }
}
