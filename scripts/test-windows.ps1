param([string]$BuildPath)
$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
$version = (Get-Content "$root\package.json" -Raw | ConvertFrom-Json).version
if (!$BuildPath) { $BuildPath = "$root\dist\Chatiffy-$version-windows-x64" }
$exe = Join-Path $BuildPath 'Chatiffy.exe'
$launcher = $null
$listener = $null
function Wait-Until([scriptblock]$Condition, [string]$Message) {
    $deadline = [DateTime]::UtcNow.AddSeconds(20)
    do {
        if (& $Condition) { return }
        Start-Sleep -Milliseconds 100
    } while ([DateTime]::UtcNow -lt $deadline)
    throw $Message
}
function Health {
    try { return Invoke-RestMethod http://127.0.0.1:8080/api/health -TimeoutSec 1 } catch { return $null }
}
function Assert([bool]$Value, [string]$Message) { if (!$Value) { throw $Message } }
# Never interfere with an existing desktop instance or another service.
$existing = $null
if ([Threading.Mutex]::TryOpenExisting('Local\Chatiffy.Desktop', [ref]$existing)) {
    $existing.Dispose(); throw 'Quit the running Chatiffy instance before testing.'
}
$probe = [Net.Sockets.TcpListener]::new([Net.IPAddress]::Loopback, 8080)
$probe.Start(); $probe.Stop()
try {
    $launcher = Start-Process -FilePath $exe -WindowStyle Hidden -PassThru
    Wait-Until { (Health).ok -eq $true } 'Packaged server did not become healthy.'
    Assert ((Health).service -eq 'Chatiffy') 'Wrong service.'
    foreach ($path in @('/', '/overlay', '/app.js', '/style.css')) {
        $response = Invoke-WebRequest "http://127.0.0.1:8080$path" -UseBasicParsing
        Assert ($response.StatusCode -eq 200) "Asset failed: $path"
    }
    $server = Get-CimInstance Win32_Process -Filter "ParentProcessId = $($launcher.Id)" | Where-Object Name -eq 'node.exe'
    Assert ($null -ne $server) 'Bundled Node child not found.'
    $serverProcess = Get-Process -Id $server.ProcessId
    $duplicate = Start-Process -FilePath $exe -WindowStyle Hidden -PassThru
    Assert ($duplicate.WaitForExit(5000)) 'Duplicate launcher did not exit.'
    Assert (!(Get-Process -Id $launcher.Id).HasExited) 'Duplicate launch stopped the original.'
    $before = $serverProcess.TotalProcessorTime.TotalMilliseconds + $launcher.TotalProcessorTime.TotalMilliseconds
    Start-Sleep -Seconds 3
    $serverProcess.Refresh(); $launcher.Refresh()
    $after = $serverProcess.TotalProcessorTime.TotalMilliseconds + $launcher.TotalProcessorTime.TotalMilliseconds
    Write-Output ('Idle working set: tray={0:N1} MiB, server={1:N1} MiB; CPU time over 3s={2:N0} ms' -f ($launcher.WorkingSet64 / 1MB), ($serverProcess.WorkingSet64 / 1MB), ($after - $before))
    $quit = Start-Process -FilePath $exe -ArgumentList '--quit' -WindowStyle Hidden -PassThru
    Assert ($quit.WaitForExit(5000)) 'Quit command stalled.'
    Assert ($launcher.WaitForExit(10000)) 'Launcher did not exit.'
    Wait-Until { !(Get-Process -Id $server.ProcessId -ErrorAction SilentlyContinue) } 'Server survived normal exit.'
    $launcher.Dispose(); $launcher = $null

    $launcher = Start-Process -FilePath $exe -WindowStyle Hidden -PassThru
    Wait-Until { (Health).ok -eq $true } 'Relaunch failed.'
    $server = Get-CimInstance Win32_Process -Filter "ParentProcessId = $($launcher.Id)" | Where-Object Name -eq 'node.exe'
    $launcher.Kill(); $launcher.WaitForExit()
    Wait-Until { !(Get-Process -Id $server.ProcessId -ErrorAction SilentlyContinue) } 'Server survived launcher crash.'
    $launcher.Dispose(); $launcher = $null

    $listener = [Net.Sockets.TcpListener]::new([Net.IPAddress]::Loopback, 8080)
    $listener.Start()
    $launcher = Start-Process -FilePath $exe -WindowStyle Hidden -PassThru
    Start-Sleep -Seconds 2
    Assert (!$launcher.HasExited) 'Port conflict crashed the tray.'
    Assert ($listener.Server.IsBound) 'Port conflict stopped the existing listener.'
    $quit = Start-Process -FilePath $exe -ArgumentList '--quit' -WindowStyle Hidden -PassThru
    Assert ($quit.WaitForExit(5000)) 'Quit command failed after port conflict.'
    Assert ($launcher.WaitForExit(10000)) 'Tray did not exit after port conflict.'
    Write-Output 'PASS: assets, health, single instance, normal exit, crash cleanup, relaunch, port conflict.'
} finally {
    if ($launcher) { if (!$launcher.HasExited) { $launcher.Kill(); $launcher.WaitForExit() }; $launcher.Dispose() }
    if ($listener) { $listener.Stop() }
}
