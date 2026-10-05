$ErrorActionPreference = 'Stop'
$taskRoot = Split-Path -Parent $PSScriptRoot
$deps = Join-Path $taskRoot 'native/.deps'
New-Item -ItemType Directory -Force -Path $deps | Out-Null
function Get-PinnedFile($url, $path, $sha256) {
  if (-not (Test-Path -LiteralPath $path)) { Invoke-WebRequest -Uri $url -OutFile $path }
  if ((Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash -ne $sha256) { throw "Dependency checksum mismatch: $path" }
}
Get-PinnedFile 'https://gitlab.com/libeigen/eigen/-/archive/3.4.0/eigen-3.4.0.zip' (Join-Path $deps 'eigen.zip') 'EBA3F3D414D2F8CBA2919C78EC6DAAB08FC71BA2BA4AE502B7E5D4D99FC02CDA'
Get-PinnedFile 'https://raw.githubusercontent.com/nlohmann/json/v3.11.3/single_include/nlohmann/json.hpp' (Join-Path $deps 'json.hpp') '9BEA4C8066EF4A1C206B2BE5A36302F8926F7FDC6087AF5D20B417D0CF103EA6'
if (-not (Test-Path -LiteralPath (Join-Path $deps 'eigen-3.4.0/Eigen/Dense'))) {
  Expand-Archive -LiteralPath (Join-Path $deps 'eigen.zip') -DestinationPath $deps -Force
}
$vswhere = Join-Path ${env:ProgramFiles(x86)} 'Microsoft Visual Studio/Installer/vswhere.exe'
$vs = & $vswhere -latest -products '*' -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath
if (-not $vs) { throw 'Install Visual Studio Build Tools with C++ x64 and CMake for development.' }
$cmake = Join-Path $vs 'Common7/IDE/CommonExtensions/Microsoft/CMake/CMake/bin/cmake.exe'
$build = Join-Path $taskRoot 'native/build'
& $cmake -S (Join-Path $taskRoot 'native') -B $build -G 'Visual Studio 18 2026' -A x64
if ($LASTEXITCODE -ne 0) { throw 'Native configure failed' }
& $cmake --build $build --config Release
if ($LASTEXITCODE -ne 0) { throw 'Native build failed' }
$output = Join-Path $taskRoot 'native/bin'
New-Item -ItemType Directory -Force -Path $output | Out-Null
Copy-Item -LiteralPath (Join-Path $build 'Release/framemind-core.exe') -Destination $output
Copy-Item -LiteralPath (Join-Path $taskRoot 'native/THIRD_PARTY_NOTICES.md'),(Join-Path $deps 'eigen-3.4.0/COPYING.MPL2') -Destination $output
Copy-Item -LiteralPath (Join-Path $deps 'eigen.zip'),(Join-Path $deps 'json.hpp') -Destination $output
