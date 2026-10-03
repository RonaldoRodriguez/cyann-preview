/**
 * Módulo de DCE (Dead Code Elimination).
 *
 * Corre antes de que ModuleBuilder.build() resuelva los nombres
 * simbólicos (CALL_BY_NAME, REF_FUNC_BY_NAME). Elimina:
 *   - Funciones locales no alcanzables desde `_start`, exports,
 *     tabla de funciones, o element segments.
 *   - Imports de función cuyos alias no sobreviven al walk.
 *   - Strings del pool no referenciadas por ninguna función viva.
 *
 * Garantías:
 *   - Los exports de función se preservan (son roots).
 *   - `_start` es root incondicional.
 *   - Cualquier función en `functionTableIndices` es root (la tabla
 *     la puede invocar vía call_indirect).
 *   - Cualquier función referenciada por un `PendingElement` es root.
 *
 * Limitación conocida: si `_start` no está en el módulo (raro), no
 * se elimina nada porque `_start` está hardcodeado como root.
 */

import { ModuleBuilder } from './compiler';

interface WithBuilder {
  builder: { instructions: Array<{ op: string; name?: string }> };
}

export function eliminateDeadFunctions(module: ModuleBuilder): Set<string> {
  const roots = new Set<string>();
  roots.add('_start');

  for (const exp of module.externals) {
    if (exp.section === 'export' && exp.kind === 'function') {
      if (typeof exp.index === 'string') roots.add(exp.index);
    }
  }
  for (const name of module.functionTableIndices.keys()) roots.add(name);
  for (const seg of module.pendingElements) {
    if (seg.funcNames) for (const n of seg.funcNames) roots.add(n);
  }

  const reachable = new Set<string>();
  const liveCallNames = new Set<string>();
  const fnByName = new Map(module.functions.map(f => [f.name, f]));
  const worklist: string[] = [...roots];

  while (worklist.length > 0) {
    const name = worklist.pop()!;
    if (reachable.has(name)) continue;
    reachable.add(name);
    liveCallNames.add(name);

    const fn = fnByName.get(name);
    if (!fn) continue;

    const builder = (fn as unknown as WithBuilder).builder;
    for (const instr of builder.instructions) {
      if (instr.op === 'CALL_BY_NAME' && instr.name)            worklist.push(instr.name);
      if (instr.op === 'REF_FUNC_BY_NAME' && instr.name)        worklist.push(instr.name);
      if (instr.op === 'FUNCTION_INDEX_BY_NAME' && instr.name)  worklist.push(instr.name);
    }
  }

  const before = module.functions.length;
  module.functions = module.functions.filter(f => reachable.has(f.name));
  const removed = before - module.functions.length;
  if (removed > 0) {
    // Descomenta esta línea para ver cuántas se eliminan en cada build.
    // console.error(`DCE: ${removed} función(es) eliminada(s) de ${before}`);
  }
  return liveCallNames;
}

export function eliminateDeadImports(
  module: ModuleBuilder,
  liveCallNames: Set<string>
): void {
  const keepIdx = new Set<number>();
  for (let i = 0; i < module.externals.length; i++) {
    const e = module.externals[i];
    if (e.section === 'export') {
      keepIdx.add(i);
      continue;
    }
    if (e.section !== 'import') continue;
    if (e.kind !== 'function') {
      keepIdx.add(i);
      continue;
    }
    for (const [alias, extIdx] of module.funcAliasToIndex) {
      if (extIdx === i && liveCallNames.has(alias)) {
        keepIdx.add(i);
        break;
      }
    }
  }

  const remap = new Map<number, number>();
  const newExternals: typeof module.externals = [];

  for (let i = 0; i < module.externals.length; i++) {
    if (keepIdx.has(i)) {
      remap.set(i, newExternals.length);
      newExternals.push(module.externals[i]);
    }
  }

  module.externals = newExternals;

  const newAlias = new Map<string, number>();
  for (const [alias, oldIdx] of module.funcAliasToIndex) {
    const newIdx = remap.get(oldIdx);
    if (newIdx !== undefined) newAlias.set(alias, newIdx);
  }
  module.funcAliasToIndex = newAlias;
}

/**
 * Elimina strings del pool que no son referenciadas por ninguna
 * función viva. Reconstruye el pool en orden de inserción y
 * reescribe los `I32_DATA_CONST` con los nuevos offsets.
 *
 * Debe correr **después** de `eliminateDeadFunctions`, para que
 * `module.functions` sólo contenga funciones vivas.
 */
export function eliminateDeadStrings(module: ModuleBuilder): void {
  const pool = module.getStringPoolOrNull();
  if (!pool) return;

  // 1. Recolectar offsets usados por funciones vivas.
  const usedOffsets = new Set<number>();
  for (const fn of module.functions) {
    for (const instr of fn.builder.instructions) {
      if ((instr as any).op === 'I32_DATA_CONST') {
        usedOffsets.add((instr as any).val as number);
      }
    }
  }

  // 2. Filtrar entradas del pool.
  const entries = pool.getAllEntries();
  const kept = entries.filter(e => usedOffsets.has(e.userOffset));
  if (kept.length === entries.length) return; // nada que podar

  // 3. Reconstruir pool y computar remapeo.
  const oldToNew = new Map<number, number>();
  pool.reset();
  for (const e of kept) {
    const ref = pool.add(e.text);
    oldToNew.set(e.userOffset, ref.offset);
  }

  // 4. Reescribir I32_DATA_CONST en todas las funciones vivas.
  for (const fn of module.functions) {
    for (const instr of fn.builder.instructions) {
      if ((instr as any).op === 'I32_DATA_CONST') {
        const newVal = oldToNew.get((instr as any).val as number);
        if (newVal !== undefined) {
          (instr as any).val = newVal;
        }
      }
    }
  }
}