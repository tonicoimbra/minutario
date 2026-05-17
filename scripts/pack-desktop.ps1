$ErrorActionPreference = "Stop"

$repoRoot  = Resolve-Path (Join-Path $PSScriptRoot "..")
$desktopDir = Join-Path $repoRoot "minutario-desktop"
$tauriDir   = Join-Path $desktopDir "src-tauri"
$distDest   = Join-Path $repoRoot "dist\desktop"

New-Item -ItemType Directory -Path $distDest -Force | Out-Null

$tauriConf = Get-Content (Join-Path $tauriDir "tauri.conf.json") -Raw | ConvertFrom-Json
$version   = $tauriConf.version

Write-Host "Build desktop v$version..." -ForegroundColor Cyan

Set-Location $desktopDir

$cargoBin = Join-Path $env:USERPROFILE ".cargo\bin"
$env:Path = "$cargoBin;$env:Path"

if (-not (Get-Command cargo -ErrorAction SilentlyContinue)) {
  Write-Error "cargo nao encontrado. Instale o Rust via rustup: https://rustup.rs"
  exit 1
}

npm run tauri build

$bundleRoot = Join-Path $tauriDir "target\release\bundle"

$installers = @()

$nsisDir = Join-Path $bundleRoot "nsis"
if (Test-Path $nsisDir) {
  $installers += Get-ChildItem -Path $nsisDir -Filter "*.exe" -File
}

$msiDir = Join-Path $bundleRoot "msi"
if (Test-Path $msiDir) {
  $installers += Get-ChildItem -Path $msiDir -Filter "*.msi" -File
}

if ($installers.Count -eq 0) {
  Write-Warning "Nenhum instalador encontrado em $bundleRoot"
  exit 1
}

foreach ($installer in $installers) {
  $ext  = $installer.Extension.ToLower().TrimStart(".")
  $suffix = if ($ext -eq "exe") { "setup" } else { $ext }
  $dest = Join-Path $distDest ("minutario-desktop-v{0}-{1}.{2}" -f $version, $suffix, $ext)
  Copy-Item -LiteralPath $installer.FullName -Destination $dest -Force
  Write-Host "Copiado: $dest" -ForegroundColor Green
}

Set-Location $repoRoot
Write-Host ""
Write-Host "Desktop pronto em: $distDest" -ForegroundColor Green
