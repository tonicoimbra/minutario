$ErrorActionPreference = "Stop"

$repoRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
Set-Location $repoRoot

$manifest = Get-Content "manifest.json" -Raw | ConvertFrom-Json
$version = $manifest.version

$distRoot = Join-Path $repoRoot "dist"
$distChrome = Join-Path $distRoot "chrome"
$stageDir = Join-Path $distChrome "minutario"
$zipFile = Join-Path $distChrome ("minutario-chrome-v{0}.zip" -f $version)

New-Item -ItemType Directory -Path $distChrome -Force | Out-Null

if (Test-Path $stageDir) {
  Remove-Item -LiteralPath $stageDir -Recurse -Force
}
New-Item -ItemType Directory -Path $stageDir -Force | Out-Null

$itemsToPack = @(
  "manifest.json",
  "background.js",
  "content.js",
  "icons",
  "lib",
  "popup",
  "quick-access",
  "dashboard",
  "shared"
)

foreach ($item in $itemsToPack) {
  Copy-Item -Path $item -Destination $stageDir -Recurse -Force
}

if (Test-Path $zipFile) {
  Remove-Item -LiteralPath $zipFile -Force
}

Compress-Archive -Path (Join-Path $stageDir "*") -DestinationPath $zipFile -CompressionLevel Optimal
Remove-Item -LiteralPath $stageDir -Recurse -Force

Write-Host ("Pacote Chrome criado em: {0}" -f $zipFile)
