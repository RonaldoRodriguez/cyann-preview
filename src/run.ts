// run.ts
//
// Compila un .cyn y, si no le pasás archivo de salida, lo ejecuta con WASI.
//
// El runtime `lib/std_v2.cyn` importa `wasi_snapshot_preview1.fd_write` para
// implementar `println`, así que al ejecutar directo necesitamos proveer WASI.
// Si la instancia no está disponible, delegamos a wasmtime.

import { Lexer } from './lexer';
import { Parser } from './parser';
import { Optimizer } from './optimizer';
import { SemanticAnalyzer } from './semantic';
import { CodeGenerator } from './codegen';
import { preprocess } from './preprocessor';
import * as path from 'path';

async function compile(inputPath: string): Promise<Uint8Array> {
  const raw      = await Bun.file(inputPath).text();
  const basePath = path.dirname(path.resolve(inputPath));
  const source   = await preprocess(raw, basePath);

  const ast = new Parser(new Lexer(source)).parseProgram();
  new SemanticAnalyzer().analyzeProgram(ast);
  const opt = new Optimizer().optimizeProgram(ast);
  return new CodeGenerator(opt.body).build();
}

/**
 * Intenta cargar una clase WASI utilizable.
 *   1. Bun built-in: `import { WASI } from 'bun'` (versiones viejas).
 *   2. Node.js:      `import { WASI } from 'node:wasi'` (Bun >= 1.1).
 * Devuelve `null` si ninguna está disponible.
 *
 * El `as any` es porque `@types/bun` no declara `WASI` como export, y no
 * queremos romper `tsc`.
 */
async function loadWASI(): Promise<any | null> {
  try {
    const bun: any = await import('bun');
    if (typeof bun.WASI === 'function') return bun.WASI;
  } catch { /* ignore */ }

  try {
    const nodeWasi: any = await import('node:wasi');
    if (typeof nodeWasi.WASI === 'function') return nodeWasi.WASI;
  } catch { /* ignore */ }

  return null;
}

async function run() {
  const cliArg = process.argv[2];
  if (!cliArg) {
    console.error('Uso: bun run.ts <archivo.cyn> [salida.wasm]');
    process.exit(1);
  }

  const inputPath = path.resolve(cliArg);
  if (!(await Bun.file(inputPath).exists())) {
    console.error(`Archivo no encontrado: ${inputPath}`);
    process.exit(1);
  }

  console.log(`▶ Compilando ${inputPath}`);
  const wasmBytes = await compile(inputPath);
  console.log(`  WASM generado: ${wasmBytes.length} bytes\n`);

  // Con archivo de salida: sólo compilar.
  const outputArg = process.argv[3];
  if (outputArg) {
    await Bun.write(outputArg, wasmBytes);
    console.log(`  Escrito ${outputArg}`);
    return;
  }

  // Sin archivo de salida: ejecutar. Necesitamos WASI.
  const WASIClass = await loadWASI();
  if (!WASIClass) {
    console.error(
      'No se pudo cargar WASI (ni desde bun ni desde node:wasi).\n' +
      'Compilá a un archivo y ejecutalo con wasmtime:\n' +
      `  bun src/run.ts ${cliArg} out.wasm && wasmtime out.wasm`
    );
    process.exit(1);
  }

  const wasi = new WASIClass({ args: [], env: {} });

  // La API de Bun antigua expone los imports en `wasi.exports`.
  // La API de Node.js los expone en `wasi.wasiImport`. Probamos las dos.
  const imports = (wasi as any).wasiImport ?? (wasi as any).exports;

  const instantiated = await WebAssembly.instantiate(wasmBytes, {
    wasi_snapshot_preview1: imports,
  });

  const instance = (instantiated as any).instance ?? instantiated;
  wasi.start(instance);
}

run().catch((err: any) => {
  if (err instanceof Error) {
    console.error('Error:', err.message);
  } else {
    console.error('Error:', err);
  }
  process.exit(1);
});