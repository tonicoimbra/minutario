$ErrorActionPreference = "Stop"

$vcvars = "C:\Program Files (x86)\Microsoft Visual Studio\2022\BuildTools\VC\Auxiliary\Build\vcvarsall.bat"
if (-not (Test-Path $vcvars)) {
    Write-Error "vcvarsall.bat nao encontrado em $vcvars. Instale o Visual Studio Build Tools com o workload VCTools."
    exit 1
}

$output = cmd /c "`"$vcvars`" x64 >nul 2>&1 && set" 2>&1
foreach ($line in $output) {
    if ($line -match '^([^=]+)=(.*)$') {
        Set-Item -Path "env:$($Matches[1])" -Value $Matches[2]
    }
}

$cargoBin = Join-Path $env:USERPROFILE ".cargo\bin"
$env:Path = "$cargoBin;$env:Path"

if (-not (Get-Command cargo -ErrorAction SilentlyContinue)) {
    Write-Error "cargo nao encontrado. Instale o Rust via rustup."
    exit 1
}

Write-Host "Cargo: $(cargo --version)" -ForegroundColor Cyan
Write-Host "MSVC link: $(Get-Command link.exe | Select-Object -ExpandProperty Source)" -ForegroundColor Cyan
Write-Host ""

npm run tauri build
