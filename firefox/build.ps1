$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$projectRoot = Split-Path -Parent $root
$distRoot = Join-Path $projectRoot "dist-firefox"
$stamp = Get-Date -Format "yyyyMMdd-HHmmss"
$zipPath = Join-Path $distRoot "minutario-firefox-$stamp.zip"

New-Item -ItemType Directory -Force -Path $distRoot | Out-Null

$exclude = @(
  "build.ps1",
  "README.md"
)

$items = Get-ChildItem -LiteralPath $root -Force | Where-Object {
  $exclude -notcontains $_.Name
}

if ($items.Count -eq 0) {
  throw "Nenhum arquivo encontrado para empacotar."
}

Compress-Archive -LiteralPath $items.FullName -DestinationPath $zipPath -Force

Write-Host "Pacote Firefox criado:"
Write-Host $zipPath
Write-Host ""
Write-Host "Para teste temporário no Firefox:"
Write-Host "about:debugging -> This Firefox -> Load Temporary Add-on -> selecione firefox/manifest.json"
Write-Host ""
Write-Host "Para distribuição real, envie o ZIP para assinatura no addons.mozilla.org."
