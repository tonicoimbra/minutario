$ErrorActionPreference = "Stop"

$repoRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
Set-Location $repoRoot

$firefoxManifestPath = Join-Path $repoRoot "firefox\manifest.json"
$manifest = Get-Content $firefoxManifestPath -Raw | ConvertFrom-Json
$version = $manifest.version

$distRoot = Join-Path $repoRoot "dist\firefox"
$stageDir = Join-Path $distRoot "minutario-firefox"
$zipFile = Join-Path $distRoot ("minutario-firefox-v{0}.zip" -f $version)

New-Item -ItemType Directory -Path $distRoot -Force | Out-Null

if (Test-Path $stageDir) {
  Remove-Item -LiteralPath $stageDir -Recurse -Force
}
New-Item -ItemType Directory -Path $stageDir -Force | Out-Null

$itemsToPack = @(
  "content.js",
  "icons",
  "lib",
  "popup",
  "quick-access",
  "dashboard",
  "shared",
  "password-reset"
)

foreach ($item in $itemsToPack) {
  Copy-Item -Path $item -Destination $stageDir -Recurse -Force
}

Copy-Item -Path "firefox\manifest.json" -Destination (Join-Path $stageDir "manifest.json") -Force
Copy-Item -Path "firefox\background.js" -Destination (Join-Path $stageDir "background.js") -Force

if (Test-Path "firefox\shared\config.js") {
  Copy-Item -Path "firefox\shared\config.js" -Destination (Join-Path $stageDir "shared\config.js") -Force
}

if (Test-Path $zipFile) {
  Remove-Item -LiteralPath $zipFile -Force
}

Compress-Archive -Path (Join-Path $stageDir "*") -DestinationPath $zipFile -CompressionLevel Optimal

Write-Host ("Pasta Firefox criada em: {0}" -f $stageDir)
Write-Host ("Pacote Firefox criado em: {0}" -f $zipFile)
