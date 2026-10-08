// run.ts
//
// Compila un .cyn y, si no le pasás archivo de salida, lo ejecuta con WASI.
//
// La biblioteca `examples/lib/std.cyn` importa `wasi_snapshot_preview1.fd_write` para
// implementar `println`, así que al ejecutar directo necesitamos proveer WASI.
// Si la instancia no está disponible, delegamos a wasmtime.

import { Optimizer } from './optimizer';
import { SemanticAnalyzer } from './semantic';
import { CodeGenerator } from './codegen';
import { ModuleLoader } from './moduleLoader';
import * as path from 'node:path';

type WasiModule = typeof import('node:wasi');
type WasiOptions = ConstructorParameters<WasiModule['WASI']>[0];
type WasiImports = Parameters<typeof WebAssembly.instantiate>[1];

type WasiRuntime = InstanceType<WasiModule['WASI']> & {
  exports?: WasiImports;
};

type WasiConstructor = new (options: WasiOptions) => WasiRuntime;

async function compile(inputPath: string): Promise<Uint8Array> {
  const ast = await new ModuleLoader().load(inputPath);
  const analyzed = new SemanticAnalyzer().analyzeProgram(ast);
  const optimized = new Optimizer().optimizeProgram(analyzed);
  return new CodeGenerator(optimized).build();
}

/**
 * Intenta cargar una clase WASI utilizable.
 *   1. Bun built-in: `import { WASI } from 'bun'` (versiones viejas).
 *   2. Node.js:      `import { WASI } from 'node:wasi'` (Bun >= 1.1).
 * Devuelve los errores de carga si ninguna está disponible, para que el CLI
 * pueda mostrar por qué no se pudo usar WASI.
 */
async function loadWASI(): Promise<{ constructor: WasiConstructor | null; errors: string[] }> {
  const errors: string[] = [];

  try {
    const bun = await import('bun') as unknown as { WASI?: WasiConstructor };
    if (typeof bun.WASI === 'function') return { constructor: bun.WASI, errors };
    errors.push('bun no exporta WASI');
  } catch (error: unknown) {
    errors.push(`bun: ${errorMessage(error)}`);
  }

  try {
    const nodeWasi = await import('node:wasi');
    if (typeof nodeWasi.WASI === 'function') return { constructor: nodeWasi.WASI, errors };
    errors.push('node:wasi no exporta WASI');
  } catch (error: unknown) {
    errors.push(`node:wasi: ${errorMessage(error)}`);
  }

  return { constructor: null, errors };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
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
  const { constructor: WASIClass, errors } = await loadWASI();
  if (!WASIClass) {
    console.error(
      'No se pudo cargar WASI (ni desde bun ni desde node:wasi).\n' +
      `${errors.join('\n')}\n` +
      'Compilá a un archivo y ejecutalo con wasmtime:\n' +
      `  bun src/run.ts ${cliArg} out.wasm && wasmtime out.wasm`
    );
    process.exit(1);
  }

  const wasi = new WASIClass({ args: [], env: {}, version: 'preview1' });

  // La API de Bun antigua expone los imports en `wasi.exports`.
  // La API de Node.js los expone en `wasi.wasiImport`. Probamos las dos.
  const imports = wasi.wasiImport ?? wasi.exports;
  if (!imports) {
    throw new Error('La implementación WASI cargada no expone wasiImport ni exports');
  }

  const instantiated = await WebAssembly.instantiate(wasmBytes, {
    wasi_snapshot_preview1: imports,
  });

  const instance = instantiated instanceof WebAssembly.Instance
    ? instantiated
    : instantiated.instance;
  wasi.start(instance);
}

run().catch((error: unknown) => {
  console.error('Error:', errorMessage(error));
  process.exit(1);
});
