// run.ts
//
// Compila un .cyn y lo ejecuta. El WASM resultante exporta `_start`
// y no usa imports de WASI (todo el I/O sale de `lib/std_v2.cyn`),
// así que basta con instanciar y llamar `_start`.

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

  const outputArg = process.argv[3];
  if (outputArg) {
    await Bun.write(outputArg, wasmBytes);
    console.log(`  Escrito ${outputArg}`);
    return;
  }

  // Sin segundo argumento: ejecutamos.
  const instance = await WebAssembly.instantiate(wasmBytes, {});
  const exports = instance.instance.exports as any;
  if (typeof exports._start === 'function') exports._start();
}

run().catch(err => { console.error('Error:', err); process.exit(1); });