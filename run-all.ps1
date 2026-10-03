# run-all.ps1
#
# Compila y ejecuta todos los examples/*.cyn con bun + wasmtime.
#
# Uso:
#   .\run-all.ps1                    # todos
#   .\run-all.ps1 type_alias.cyn     # uno
#   .\run-all.ps1 closures*.cyn      # glob
#
# Casos especiales (detectados por nombre):
#   escape_should_fail_*.cyn  → debe FALLAR la compilación
#   trap_*.cyn                → debe compilar y hacer TRAP en runtime
#   resto                     → debe compilar y ejecutar sin fallos

param(
  [string]$Pattern = '*.cyn'
)

$ErrorActionPreference = 'Continue'

# ─── Validar ubicación ─────────────────────────────────────────────
if (!(Test-Path 'src/run.ts')) {
  Write-Host "X  Corré este script desde el root del proyecto." -ForegroundColor Red
  Write-Host "   No se encontró 'src/run.ts' en $PWD" -ForegroundColor DarkRed
  exit 1
}

if (!(Test-Path 'demos')) {
  New-Item -ItemType Directory -Path 'demos' | Out-Null
  Write-Host "   (creado directorio demos/)" -ForegroundColor DarkGray
}

# ─── Casos especiales ──────────────────────────────────────────────
function Test-IsNegative($name) { return $name -like '*_should_fail.cyn' }
function Test-IsTrap($name)     { return $name -like 'trap_*' }

# ─── Recolectar archivos ───────────────────────────────────────────
$files = @(Get-ChildItem -Path 'examples' -Filter $Pattern -File | Sort-Object Name)
if ($files.Count -eq 0) {
  Write-Host "X  No se encontraron archivos que matcheen '$Pattern' en examples/" -ForegroundColor Red
  exit 1
}

Write-Host ""
Write-Host "══════════════════════════════════════════════" -ForegroundColor White
Write-Host "  RUN-ALL — $($files.Count) archivos .cyn" -ForegroundColor White
Write-Host "══════════════════════════════════════════════" -ForegroundColor White

$pass = 0
$fail = 0
$results = @()

foreach ($f in $files) {
  $name = $f.Name
  $base = [IO.Path]::GetFileNameWithoutExtension($f.Name)
  $src  = "examples/$name"
  $wasm = "demos/$base.wasm"

  Write-Host ""
  Write-Host "=== $name" -ForegroundColor Cyan

  # ── Caso negativo: debe FALLAR la compilación ────────────────
  if (Test-IsNegative $name) {
    $null = bun src/run.ts $src $wasm 2>&1
    if ($LASTEXITCODE -ne 0) {
      Write-Host "  OK  rechazado en compilación (correcto)" -ForegroundColor Green
      $pass++
      $results += [pscustomobject]@{ File = $name; Result = 'ok';   Note = 'rejected' }
    } else {
      Write-Host "  XX  compiló sin error (se esperaba rechazo)" -ForegroundColor Red
      $fail++
      $results += [pscustomobject]@{ File = $name; Result = 'FAIL'; Note = 'compiled unexpectedly' }
    }
    continue
  }

  # ── Compilar ─────────────────────────────────────────────────
  $compOut = bun src/run.ts $src $wasm 2>&1
  if ($LASTEXITCODE -ne 0) {
    Write-Host "  XX  error de compilación" -ForegroundColor Red
    $compOut | Select-Object -First 5 | ForEach-Object {
      Write-Host "      $_" -ForegroundColor DarkRed
    }
    $fail++
    $results += [pscustomobject]@{ File = $name; Result = 'FAIL'; Note = 'compile' }
    continue
  }
  Write-Host "  OK  compilado" -ForegroundColor Green

  # ── Ejecutar ─────────────────────────────────────────────────
  $runOut   = wasmtime $wasm 2>&1
  $exitCode = $LASTEXITCODE

  # ── Caso trap: debe fallar en runtime ────────────────────────
  if (Test-IsTrap $name) {
    if ($exitCode -ne 0) {
      Write-Host "  OK  trap en runtime (correcto)" -ForegroundColor Green
      $pass++
      $results += [pscustomobject]@{ File = $name; Result = 'ok';   Note = 'trapped' }
    } else {
      Write-Host "  XX  NO trapeó (se esperaba trap)" -ForegroundColor Red
      $fail++
      $results += [pscustomobject]@{ File = $name; Result = 'FAIL'; Note = 'no trap' }
    }
    continue
  }

  # ── Caso normal: analizar salida ─────────────────────────────
  $hasFailMarker = ($runOut -join "`n") -match 'HAY FALLOS'
  $hasOkMarker   = ($runOut -join "`n") -match 'TODO OK'
  $pasanLine     = ($runOut | Where-Object { $_ -match '^Pasan:' }) -join ' '
  $fallanLine    = ($runOut | Where-Object { $_ -match '^Fallan:' }) -join ' '

  if ($hasFailMarker) {
    Write-Host "  XX  la suite reportó fallos" -ForegroundColor Red
    $runOut | Where-Object { $_ -match 'FAIL' } | Select-Object -First 5 | ForEach-Object {
      Write-Host "      $_" -ForegroundColor DarkRed
    }
    $fail++
    $results += [pscustomobject]@{ File = $name; Result = 'FAIL'; Note = 'suite failures' }
  } elseif ($hasOkMarker) {
    Write-Host "  OK  $pasanLine   $fallanLine" -ForegroundColor Green
    $pass++
    $results += [pscustomobject]@{ File = $name; Result = 'ok';   Note = 'suite passed' }
  } elseif ($exitCode -ne 0) {
    Write-Host "  XX  salida con código $exitCode sin marcadores" -ForegroundColor Red
    $fail++
    $results += [pscustomobject]@{ File = $name; Result = 'FAIL'; Note = "exit $exitCode" }
  } else {
    Write-Host "  OK  ejecutado (sin marcadores de suite)" -ForegroundColor Green
    $pass++
    $results += [pscustomobject]@{ File = $name; Result = 'ok';   Note = 'ran' }
  }
}

# ─── Resumen ────────────────────────────────────────────────────
Write-Host ""
Write-Host "══════════════════════════════════════════════" -ForegroundColor White
Write-Host "  RESUMEN" -ForegroundColor White
Write-Host "══════════════════════════════════════════════" -ForegroundColor White
Write-Host ""

$width = ($results | ForEach-Object { $_.File.Length } | Measure-Object -Maximum).Maximum + 2
foreach ($r in $results) {
  $pad  = ' ' * ($width - $r.File.Length)
  $mark = if ($r.Result -eq 'ok') { 'OK' } else { 'XX' }
  $color = if ($r.Result -eq 'ok') { 'Green' } else { 'Red' }
  Write-Host ("  $mark $($r.File)$pad$($r.Note)") -ForegroundColor $color
}# function Test-IsNegative($name) { return $name -like 'escape_should_fail_*' }

Write-Host ""
Write-Host "  Archivos OK:   $pass / $($files.Count)" -ForegroundColor $(if ($fail -eq 0) { 'Green' } else { 'Yellow' })
if ($fail -gt 0) {
  Write-Host "  Archivos FAIL: $fail" -ForegroundColor Red
  Write-Host ""
  Write-Host "X   Al menos un archivo no corrió como se esperaba." -ForegroundColor Red
  exit 1
}
Write-Host ""
Write-Host "OK  Todos los .cyn corrieron como se esperaba." -ForegroundColor Green