$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
$version = (Get-Content "$root\package.json" -Raw | ConvertFrom-Json).version
$package = Join-Path $root "dist\Chatiffy-$version-windows-x64"
$compiler = Join-Path ${env:ProgramFiles(x86)} 'Inno Setup 6\ISCC.exe'
if (!(Test-Path $compiler)) { throw 'Install Inno Setup 6 before building Setup.' }
if (!(Test-Path "$package\Chatiffy.exe")) { throw 'Build the portable package first.' }
& $compiler "/DAppVersion=$version" "/DPackageDir=$package" "$root\windows\setup.iss"
if ($LASTEXITCODE -ne 0) { throw 'Setup compilation failed.' }
$setup = Join-Path $root "dist\Chatiffy-$version-windows-x64-Setup.exe"
$hash = (Get-FileHash $setup -Algorithm SHA256).Hash.ToLowerInvariant()
"$hash  $(Split-Path $setup -Leaf)" | Set-Content "$setup.sha256" -Encoding ascii
