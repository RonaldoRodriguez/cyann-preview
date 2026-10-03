#!/usr/bin/env bash
# run-all.sh — equivalente bash de run-all.ps1, funciona en Linux/macOS/Git-Bash.
set -u

EXAMPLES_DIR="examples"
DEMOS_DIR="demos"
LOG=/tmp/cyann_compile.log

mkdir -p "$DEMOS_DIR"

ok=0
fail=0

# ¿Tenemos wasmtime? Si no, usamos bun para ejecutar.
if command -v wasmtime >/dev/null 2>&1; then
  RUNNER="wasmtime"
else
  RUNNER="bun"
fi

echo "══════════════════════════════════════════════"
echo "  RUN-ALL — $(ls "$EXAMPLES_DIR"/*.cyn 2>/dev/null | wc -l) archivos .cyn"
echo "  Runner: $RUNNER"
echo "══════════════════════════════════════════════"
echo ""

for cyn in "$EXAMPLES_DIR"/*.cyn; do
  [ -e "$cyn" ] || continue
  name=$(basename "$cyn" .cyn)
  wasm="$DEMOS_DIR/$name.wasm"

  # Convención: los archivos *_should_fail deben fallar en compilación.
  expect_fail=0
  case "$name" in
    *_should_fail) expect_fail=1 ;;
  esac

  echo "=== $name.cyn"

  # ── 1) Compilar ─────────────────────────────────────────────────
  if ! bun src/run.ts "$cyn" "$wasm" >"$LOG" 2>&1; then
    if [ "$expect_fail" -eq 1 ]; then
      echo "  OK  rechazado en compilación (correcto)"
      ok=$((ok+1))
    else
      echo "  XX  error de compilación"
      sed -n '1,15p' "$LOG" | sed 's/^/      /'
      fail=$((fail+1))
    fi
    echo ""
    continue
  fi

  if [ "$expect_fail" -eq 1 ]; then
    echo "  XX  compiló pero debía fallar"
    fail=$((fail+1))
    echo ""
    continue
  fi

  echo "  OK  compilado"

  # ── 2) Ejecutar ─────────────────────────────────────────────────
  if [ "$RUNNER" = "wasmtime" ]; then
    output=$(wasmtime "$wasm" 2>&1) || true
    exit_code=$?
  else
    output=$(bun src/run.ts "$cyn" 2>&1) || true
    exit_code=$?
  fi

  # ── 3) Analizar marcadores ──────────────────────────────────────
  if echo "$output" | grep -q "Fallan: 0"; then
    pass=$(echo "$output" | grep -oE 'Pasan:[[:space:]]*[0-9]+' | head -1 | grep -oE '[0-9]+')
    echo "  OK  Pasan: ${pass:-?}   Fallan: 0"
    ok=$((ok+1))
  elif echo "$output" | grep -q "Fallan:"; then
    echo "  XX  tests fallaron"
    echo "$output" | tail -8 | sed 's/^/      /'
    fail=$((fail+1))
  else
    if [ "$exit_code" -eq 0 ]; then
      echo "  OK  ejecutado (sin marcadores de suite)"
      ok=$((ok+1))
    else
      echo "  XX  salida con código $exit_code sin marcadores"
      echo "$output" | tail -8 | sed 's/^/      /'
      fail=$((fail+1))
    fi
  fi

  echo ""
done

echo "══════════════════════════════════════════════"
echo "  RESUMEN"
echo "══════════════════════════════════════════════"
echo ""
echo "  Archivos OK:   $ok"
echo "  Archivos FAIL: $fail"
echo ""

if [ "$fail" -eq 0 ]; then
  echo "OK  Todos los .cyn corrieron como se esperaba."
  exit 0
else
  echo "X   Al menos un archivo no corrió como se esperaba."
  exit 1
fi