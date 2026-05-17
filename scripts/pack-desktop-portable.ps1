$ErrorActionPreference = "Stop"

$repoRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
$desktopDir = Join-Path $repoRoot "minutario-desktop"
$tauriDir = Join-Path $desktopDir "src-tauri"
$distRoot = Join-Path $repoRoot "dist\desktop-portable"

$tauriConf = Get-Content (Join-Path $tauriDir "tauri.conf.json") -Raw | ConvertFrom-Json
$version = $tauriConf.version

$releaseExe = Join-Path $tauriDir "target\release\minutario-desktop.exe"
$fixedRuntimeDir = Join-Path $desktopDir "webview2-fixed"
$fixedRuntimeExe = Join-Path $fixedRuntimeDir "msedgewebview2.exe"

if (-not (Test-Path $fixedRuntimeExe)) {
  Write-Error "WebView2 Runtime fixo nao encontrado em '$fixedRuntimeDir'. Baixe o pacote 'Fixed Version Runtime', extraia e deixe o msedgewebview2.exe dentro dessa pasta."
  exit 1
}

Write-Host "Build desktop portable v$version..." -ForegroundColor Cyan
Set-Location $desktopDir
npm run tauri build
if ($LASTEXITCODE -ne 0) {
  Write-Error "Falha no build do Tauri."
  exit $LASTEXITCODE
}

if (-not (Test-Path $releaseExe)) {
  Write-Error "Executavel nao encontrado em $releaseExe"
  exit 1
}

$packageDir = Join-Path $distRoot ("minutario-desktop-portable-v{0}" -f $version)
$zipPath = "$packageDir.zip"

if (Test-Path $packageDir) { Remove-Item -Recurse -Force $packageDir }
if (Test-Path $zipPath) { Remove-Item -Force $zipPath }

New-Item -ItemType Directory -Path $packageDir -Force | Out-Null

Copy-Item -LiteralPath $releaseExe -Destination (Join-Path $packageDir "minutario-desktop.exe") -Force
Copy-Item -Recurse -LiteralPath $fixedRuntimeDir -Destination (Join-Path $packageDir "webview2-fixed") -Force

Compress-Archive -Path (Join-Path $packageDir "*") -DestinationPath $zipPath -CompressionLevel Optimal -Force

Set-Location $repoRoot
Write-Host "Portable pronto:" -ForegroundColor Green
Write-Host "Pasta: $packageDir" -ForegroundColor Green
Write-Host "Zip:   $zipPath" -ForegroundColor Green
