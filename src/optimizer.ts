import type { StatementNode, IfNode } from './parser';
import { foldConstants } from './constants';
import type { AnalyzedProgram } from './semantic';
import type { ModuleBuilder } from './compiler';

interface FunctionWithBuilder {
  name: string;
  builder: { instructions: Array<{ op: string; name?: string; val?: number }> };
}

export class Optimizer {
  public optimizeProgram(program: AnalyzedProgram): AnalyzedProgram {
    return {
      ...program,
      kind: 'program',
      body: program.body.map(stmt => this.optimizeStatement(stmt)),
    };
  }

  public optimizeStatement(stmt: StatementNode): StatementNode {
    switch (stmt.kind) {
      case 'var_decl':
      case 'const_decl':
        return {
          ...stmt,
          initExpr: stmt.initExpr ? foldConstants(stmt.initExpr) : null,
        };

      case 'short_var_decl':
      case 'multi_decl':
      case 'assign':
      case 'expression_stmt':
        return { ...stmt, expr: foldConstants(stmt.expr) };

      case 'return':
        return { ...stmt, values: stmt.values.map(value => foldConstants(value)) };

      case 'if':
        return {
          ...stmt,
          condition: foldConstants(stmt.condition),
          thenBlock: stmt.thenBlock.map(child => this.optimizeStatement(child)),
          elseBlock: Array.isArray(stmt.elseBlock)
            ? stmt.elseBlock.map(child => this.optimizeStatement(child))
            : stmt.elseBlock
              ? this.optimizeStatement(stmt.elseBlock) as IfNode
              : null,
        };

      case 'for':
        return {
          ...stmt,
          init: stmt.init ? this.optimizeStatement(stmt.init) : null,
          condition: stmt.condition ? foldConstants(stmt.condition) : null,
          post: stmt.post ? this.optimizeStatement(stmt.post) : null,
          body: stmt.body.map(child => this.optimizeStatement(child)),
        };

      case 'for_in':
        return {
          ...stmt,
          iterable: foldConstants(stmt.iterable),
          body: stmt.body.map(child => this.optimizeStatement(child)),
        };

      case 'switch':
        return {
          ...stmt,
          expr: foldConstants(stmt.expr),
          cases: stmt.cases.map(item => ({
            patterns: item.patterns,
            body: item.body.map(child => this.optimizeStatement(child)),
          })),
          defaultBody: stmt.defaultBody
            ? stmt.defaultBody.map(child => this.optimizeStatement(child))
            : null,
        };

      case 'region':
      case 'function_def':
        return {
          ...stmt,
          body: stmt.body.map(child => this.optimizeStatement(child)),
        };

      case 'break':
      case 'continue':
      case 'import_decl':
      case 'struct_def':
      case 'type_alias':
        return stmt;
    }
  }

  public optimizeModule(module: ModuleBuilder): void {
    const liveFunctionNames = this.eliminateDeadFunctions(module);
    this.eliminateDeadImports(module, liveFunctionNames);
    this.eliminateDeadStrings(module);
  }

  private eliminateDeadFunctions(module: ModuleBuilder): Set<string> {
    const roots = new Set<string>(['_start']);

    for (const external of module.externals) {
      if (external.section === 'export' && external.kind === 'function' &&
          typeof external.index === 'string') {
        roots.add(external.index);
      }
    }
    for (const name of module.functionTableIndices.keys()) roots.add(name);
    for (const segment of module.pendingElements) {
      if (segment.funcNames) {
        for (const name of segment.funcNames) roots.add(name);
      }
    }

    const reachable = new Set<string>();
    const liveCallNames = new Set<string>();
    const functions = new Map(
      module.functions.map(fn => [fn.name, fn as unknown as FunctionWithBuilder])
    );
    const worklist = [...roots];

    while (worklist.length > 0) {
      const name = worklist.pop()!;
      if (reachable.has(name)) continue;
      reachable.add(name);
      liveCallNames.add(name);

      const fn = functions.get(name);
      if (!fn) continue;
      for (const instruction of fn.builder.instructions) {
        if (
          (instruction.op === 'CALL_BY_NAME' ||
            instruction.op === 'REF_FUNC_BY_NAME' ||
            instruction.op === 'FUNCTION_INDEX_BY_NAME') &&
          instruction.name
        ) {
          worklist.push(instruction.name);
        }
      }
    }

    module.functions = module.functions.filter(fn => reachable.has(fn.name));
    return liveCallNames;
  }

  private eliminateDeadImports(
    module: ModuleBuilder,
    liveCallNames: Set<string>,
  ): void {
    const keepIndexes = new Set<number>();
    for (let index = 0; index < module.externals.length; index++) {
      const external = module.externals[index];
      if (external.section === 'export') {
        keepIndexes.add(index);
        continue;
      }
      if (external.section !== 'import' || external.kind !== 'function') {
        if (external.section === 'import') keepIndexes.add(index);
        continue;
      }
      for (const [alias, externalIndex] of module.funcAliasToIndex) {
        if (externalIndex === index && liveCallNames.has(alias)) {
          keepIndexes.add(index);
          break;
        }
      }
    }

    const remappedIndexes = new Map<number, number>();
    const externals: typeof module.externals = [];
    for (let index = 0; index < module.externals.length; index++) {
      if (!keepIndexes.has(index)) continue;
      remappedIndexes.set(index, externals.length);
      externals.push(module.externals[index]);
    }
    module.externals = externals;

    const aliases = new Map<string, number>();
    for (const [alias, oldIndex] of module.funcAliasToIndex) {
      const newIndex = remappedIndexes.get(oldIndex);
      if (newIndex !== undefined) aliases.set(alias, newIndex);
    }
    module.funcAliasToIndex = aliases;
  }

  private eliminateDeadStrings(module: ModuleBuilder): void {
    const pool = module.getStringPoolOrNull();
    if (!pool) return;

    const usedOffsets = new Set<number>();
    for (const fn of module.functions) {
      for (const instruction of (fn as unknown as FunctionWithBuilder).builder.instructions) {
        if (instruction.op === 'I32_DATA_CONST' && instruction.val !== undefined) {
          usedOffsets.add(instruction.val);
        }
      }
    }

    const entries = pool.getAllEntries();
    const keptEntries = entries.filter(entry => usedOffsets.has(entry.userOffset));
    if (keptEntries.length === entries.length) return;

    const remappedOffsets = new Map<number, number>();
    pool.reset();
    for (const entry of keptEntries) {
      remappedOffsets.set(entry.userOffset, pool.add(entry.text).offset);
    }

    for (const fn of module.functions) {
      for (const instruction of (fn as unknown as FunctionWithBuilder).builder.instructions) {
        if (instruction.op !== 'I32_DATA_CONST' || instruction.val === undefined) continue;
        const offset = remappedOffsets.get(instruction.val);
        if (offset !== undefined) instruction.val = offset;
      }
    }
  }
}
