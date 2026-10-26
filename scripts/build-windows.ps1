param([string]$NodePath = (Get-Command node -ErrorAction Stop).Source)
$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
$version = (Get-Content (Join-Path $root 'package.json') -Raw | ConvertFrom-Json).version
$nodeVersion = & $NodePath --version
if ($LASTEXITCODE -ne 0 -or $nodeVersion -notmatch '^v24\.') { throw 'Build requires Node.js 24 LTS (x64).' }
$arch = & $NodePath -p 'process.arch'
if ($arch -ne 'x64') { throw 'Build requires an x64 Node.js runtime.' }
$license = Join-Path (Split-Path $NodePath -Parent) 'LICENSE'
if (!(Test-Path $license)) { throw "Node LICENSE missing beside $NodePath. Use the official Node distribution." }
$out = Join-Path $root "dist\Chatiffy-$version-windows-x64"
if (Test-Path $out) { throw "Build directory already exists: $out. Move it aside before rebuilding." }
New-Item -ItemType Directory -Force "$out\runtime", "$out\app" | Out-Null
$compiler = Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'
& $compiler /nologo /target:winexe /platform:x64 /optimize+ /utf8output "/win32icon:$root\assets\chatiffy.ico" "/resource:$root\assets\chatiffy.ico,Chatiffy.Icon" "/out:$out\Chatiffy.exe" /reference:System.Windows.Forms.dll /reference:System.Drawing.dll (Join-Path $root 'windows\Chatiffy.cs')
if ($LASTEXITCODE -ne 0) { throw 'C# compilation failed.' }
Copy-Item -LiteralPath $NodePath -Destination "$out\runtime\node.exe"
foreach ($name in @('server.mjs', 'index.html', 'app.js', 'style.css')) {
    Copy-Item -LiteralPath (Join-Path $root $name) -Destination "$out\app\$name"
}
# Node redistributions must include the runtime's third-party license notices.
Copy-Item -LiteralPath (Join-Path $root 'assets') -Destination "$out\app\assets" -Recurse
Copy-Item -LiteralPath $license -Destination "$out\runtime\LICENSE"
Copy-Item -LiteralPath (Join-Path $root 'windows\README.txt') -Destination "$out\README.txt"
"Chatiffy $version`r`nNode.js $nodeVersion x64`r`n" | Set-Content "$out\VERSION.txt"
$zip = "$out.zip"
Compress-Archive -Path $out -DestinationPath $zip
$hash = (Get-FileHash $zip -Algorithm SHA256).Hash.ToLowerInvariant()
"$hash  $(Split-Path $zip -Leaf)" | Set-Content "$zip.sha256" -Encoding ascii
Write-Output $zip
