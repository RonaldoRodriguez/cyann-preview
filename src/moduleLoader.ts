import * as path from 'node:path';
import { Lexer } from './lexer';
import { Parser } from './parser';
import {
  FunctionDefNode,
  ImportDeclNode,
  ModuleImportNode,
  ProgramNode,
  StatementNode,
} from './parser';
import { MathType } from './types';
import { preprocessWithSourceMap } from './preprocessor';
import { formatDiagnostic } from './diagnostics';
//  if (type.kind === 'type_param') return type;
interface LoadedModule {
  path: string;
  program: ProgramNode;
  imports: Array<{ declaration: ModuleImportNode; target: LoadedModule }>;
  namespaceImports: Map<string, LoadedModule>;
  id: number;
  entry: boolean;
  functionNames: Map<string, string>;
  globalNames: Map<string, string>;
  typeNames: Map<string, string>;
}

export class ModuleLoader {
  private loaded = new Map<string, LoadedModule>();
  private loading = new Set<string>();
  private order: LoadedModule[] = [];
  private entryDirectory = '';

  public async load(entryPath: string): Promise<ProgramNode> {
    this.loaded.clear();
    this.loading.clear();
    this.order = [];

    const entry = await this.loadModule(path.resolve(entryPath));
    entry.entry = true;
    this.entryDirectory = path.dirname(entry.path);
    this.initializeNamespaces();
    this.validateModuleBindings();

    const body: StatementNode[] = [];
    for (const module of this.order) {
      this.rewriteModule(module);
      body.push(...module.program.body.filter(stmt => stmt.kind !== 'module_import'));
    }
    return { kind: 'program', body };
  }

  private async loadModule(modulePath: string): Promise<LoadedModule> {
    const resolvedPath = path.normalize(path.resolve(modulePath));
    const moduleKey = process.platform === 'win32'
      ? resolvedPath.toLowerCase()
      : resolvedPath;
    if (this.loading.has(moduleKey)) {
      throw new Error(`Import circular de módulo detectado: ${resolvedPath}`);
    }
    const loaded = this.loaded.get(moduleKey);
    if (loaded) return loaded;

    this.loading.add(moduleKey);
    const file = Bun.file(resolvedPath);
    if (!(await file.exists())) {
      this.loading.delete(moduleKey);
      throw new Error(`No se encontró el módulo Cyann: ${resolvedPath}`);
    }

    try {
      const processed = await preprocessWithSourceMap(
        await file.text(),
        path.dirname(resolvedPath),
        new Set(),
        new Set(),
        resolvedPath,
      );
      const parsedProgram = new Parser(new Lexer(processed.source, processed.sourceMap)).parseProgram();
      const program = this.expandReceiverLists(parsedProgram);
      const module: LoadedModule = {
        path: resolvedPath,
        program,
        imports: [],
        namespaceImports: new Map(),
        id: -1,
        entry: false,
        functionNames: new Map(),
        globalNames: new Map(),
        typeNames: new Map(),
      };
      this.loaded.set(moduleKey, module);

      for (const stmt of program.body) {
        if (stmt.kind !== 'module_import') continue;
        const declaration = stmt as ModuleImportNode;

        // Limpiamos y normalizamos las barras invertidas para evitar errores en Windows con '..'
        const normalizedImportPath = declaration.path.replace(/\\/g, '/');
        const targetPath = path.normalize(path.resolve(path.dirname(resolvedPath), normalizedImportPath));

        let target: LoadedModule;
        try {
          target = await this.loadModule(targetPath);
        } catch (error) {
          throw this.locatedError(
            declaration,
            error instanceof Error ? error.message : String(error),
          );
        }
        module.imports.push({ declaration, target });
      }

      this.loading.delete(moduleKey);
      this.order.push(module);
      return module;
    } catch (error) {
      this.loading.delete(moduleKey);
      throw error;
    }
  }

  private expandReceiverLists(program: ProgramNode): ProgramNode {
    const body: StatementNode[] = [];
    for (const stmt of program.body) {
      if (stmt.kind !== 'function_def' || !stmt.receiverTypes) {
        body.push(stmt);
        continue;
      }
      for (const receiver of stmt.receiverTypes) {
        const specialization = structuredClone(stmt);
        specialization.receiver = receiver;
        delete specialization.receiverTypes;
        body.push(specialization);
      }
    }
    return { ...program, body };
  }

  private initializeNamespaces(): void {
    this.order.forEach((module, id) => {
      module.id = id;
      const prefix = `__module_${id}_`;

      for (const stmt of module.program.body) {
        if (stmt.kind === 'function_def' && !stmt.receiver) {
          const fn = stmt as FunctionDefNode;
          if (!module.functionNames.has(fn.name)) {
            module.functionNames.set(fn.name, `${prefix}${fn.name}`);
          }
        } else if (stmt.kind === 'import_decl') {
          const imported = stmt as ImportDeclNode;
          if (!module.functionNames.has(imported.name)) {
            module.functionNames.set(imported.name, `${prefix}${imported.name}`);
          }
        } else if (stmt.kind === 'var_decl' || stmt.kind === 'const_decl') {
          if (!module.globalNames.has(stmt.name)) {
            module.globalNames.set(stmt.name, `${prefix}${stmt.name}`);
          }
        } else if (stmt.kind === 'struct_def' || stmt.kind === 'type_alias') {
          if (!module.typeNames.has(stmt.name)) {
            module.typeNames.set(stmt.name, `${prefix}${stmt.name}`);
          }
        }
      }
    });

    for (const module of this.order) {
      for (const { declaration, target } of module.imports) {
        if (declaration.alias) {
          module.namespaceImports.set(declaration.alias, target);
          continue;
        }
        if (!declaration.symbol) continue;
        const exported = this.exportedSymbol(target, declaration.symbol);
        if (!exported) continue;

        if (exported.kind === 'function') {
          module.functionNames.set(declaration.symbol, target.functionNames.get(exported.name)!);
        } else if (exported.kind === 'global') {
          module.globalNames.set(declaration.symbol, target.globalNames.get(exported.name)!);
        } else if (exported.kind === 'type') {
          module.typeNames.set(declaration.symbol, target.typeNames.get(exported.name)!);
        } else if (exported.kind === 'namespace') {
          // Registramos el namespace re-exportado en el módulo actual
          module.namespaceImports.set(declaration.symbol, exported.targetModule!);
        }
      }
    }
  }

  private validateModuleBindings(): void {
    for (const module of this.order) {
      const ownNames = this.localTopLevelNames(module);
      const importedNames = new Set<string>();
      const namespaceNames = new Set<string>();

      for (const { declaration, target } of module.imports) {
        if (declaration.alias) {
          if (ownNames.has(declaration.alias)) {
            throw this.locatedError(
              declaration,
              `El alias de módulo '${declaration.alias}' ya está declarado en ${module.path}`,
            );
          }
          if (importedNames.has(declaration.alias) || namespaceNames.has(declaration.alias)) {
            throw this.locatedError(
              declaration,
              `El nombre de importación '${declaration.alias}' se declara más de una vez en ${module.path}`,
            );
          }
          namespaceNames.add(declaration.alias);
          continue;
        }
        if (!declaration.symbol) continue;
        if (ownNames.has(declaration.symbol)) {
          throw this.locatedError(
            declaration,
            `El símbolo importado '${declaration.symbol}' ya está declarado en ${module.path}`,
          );
        }
        if (importedNames.has(declaration.symbol)) {
          throw this.locatedError(
            declaration,
            `El símbolo '${declaration.symbol}' se importa más de una vez en ${module.path}`,
          );
        }
        importedNames.add(declaration.symbol);

        if (!this.exportedSymbol(target, declaration.symbol)) {
          throw this.locatedError(
            declaration,
            `El módulo '${declaration.path}' no exporta el símbolo '${declaration.symbol}'`,
          );
        }
      }

      const duplicateTopLevelNames = new Set<string>();
      const declarations = new Map<string, string>();
      for (const stmt of module.program.body) {
        if (stmt.kind === 'function_def' && !stmt.receiver) {
          this.checkTopLevelName(declarations, duplicateTopLevelNames, stmt.name, 'función');
        } else if (stmt.kind === 'var_decl' || stmt.kind === 'const_decl') {
          this.checkTopLevelName(declarations, duplicateTopLevelNames, stmt.name, 'variable');
        } else if (stmt.kind === 'struct_def' || stmt.kind === 'type_alias') {
          this.checkTopLevelName(declarations, duplicateTopLevelNames, stmt.name, 'tipo');
        } else if (stmt.kind === 'import_decl') {
          this.checkTopLevelName(declarations, duplicateTopLevelNames, stmt.name, 'import host');
        }
      }
      if (duplicateTopLevelNames.size > 0) {
        const name = [...duplicateTopLevelNames][0];
        const duplicate = [...module.program.body].reverse().find(
          stmt =>
            (stmt.kind === 'function_def' && !stmt.receiver && stmt.name === name) ||
            ((stmt.kind === 'var_decl' || stmt.kind === 'const_decl' ||
              stmt.kind === 'struct_def' || stmt.kind === 'type_alias') && stmt.name === name) ||
            (stmt.kind === 'import_decl' && stmt.name === name),
        );
        const message = `Símbolo superior duplicado '${name}' en ${module.path}`;
        if (duplicate) throw this.locatedError(duplicate, message);
        throw new Error(message);
      }
    }
  }

  private locatedError(stmt: StatementNode, message: string): Error {
    const location = stmt.sourceLocation;
    return new Error(formatDiagnostic({ message, location }));
  }

  private localTopLevelNames(module: LoadedModule): Set<string> {
    const names = new Set<string>();
    for (const stmt of module.program.body) {
      if (stmt.kind === 'function_def' && !stmt.receiver) names.add(stmt.name);
      else if (stmt.kind === 'var_decl' || stmt.kind === 'const_decl') names.add(stmt.name);
      else if (stmt.kind === 'struct_def' || stmt.kind === 'type_alias') names.add(stmt.name);
      else if (stmt.kind === 'import_decl') names.add(stmt.name);
    }
    return names;
  }

  private exportedSymbol(
    module: LoadedModule,
    symbol: string,
  ): { kind: 'function' | 'global' | 'type' | 'namespace'; name: string; targetModule?: LoadedModule } | null {
    // 1. Buscar en funciones
    const fn = this.functions(module).find(
      item => item.exported && (item.exportName ?? item.name) === symbol,
    );
    if (fn) return { kind: 'function', name: fn.name };

    // 2. Buscar en globales
    const global = module.program.body.find(
      (item): item is Extract<StatementNode, { kind: 'var_decl' | 'const_decl' }> =>
        (item.kind === 'var_decl' || item.kind === 'const_decl') &&
        item.exported === true &&
        (item.exportName ?? item.name) === symbol,
    );
    if (global) return { kind: 'global', name: global.name };

    // 3. Buscar en tipos
    const type = module.program.body.find(
      (item): item is Extract<StatementNode, { kind: 'struct_def' | 'type_alias' }> =>
        (item.kind === 'struct_def' || item.kind === 'type_alias') &&
        (item.exportName ?? item.name) === symbol,
    );
    if (type) return { kind: 'type', name: type.name };

    // 4. Buscar en namespaces re-exportados (export import ... as symbol)
    const nsImport = module.imports.find(
      item => item.declaration.alias === symbol && (item.declaration as any).exported === true,
    );
    if (nsImport) {
      return { kind: 'namespace', name: symbol, targetModule: nsImport.target };
    }

    return null;
  }

  private checkTopLevelName(
    declarations: Map<string, string>,
    duplicates: Set<string>,
    name: string,
    kind: string,
  ): void {
    const previous = declarations.get(name);
    if (previous && previous !== 'función') duplicates.add(name);
    if (previous === 'función' && kind !== 'función') duplicates.add(name);
    declarations.set(name, previous === 'función' && kind === 'función' ? 'función' : kind);
  }

  private functions(module: LoadedModule): FunctionDefNode[] {
    return module.program.body.filter(
      (stmt): stmt is FunctionDefNode =>
        stmt.kind === 'function_def' && !stmt.receiver,
    );
  }

  private rewritePattern(
    pattern: import('./types').PatternNode,
    typeNames: Map<string, string>,
    module: LoadedModule,
  ): void {
    if (pattern.kind !== 'struct') return;
    pattern.structName = typeNames.get(pattern.structName) ??
      this.resolveQualifiedName(module, pattern.structName, 'type') ??
      pattern.structName;
    for (const field of pattern.fields) this.rewritePattern(field.pattern, typeNames, module);
  }

  private resolveQualifiedName(
    module: LoadedModule,
    name: string,
    kind?: 'function' | 'global' | 'type',
  ): string | undefined {
    const parts = name.split('::');
    if (parts.length < 2 || parts.some(part => part.length === 0)) return undefined;
    let target = module.namespaceImports.get(parts[0]);
    if (!target) return undefined;
    for (const alias of parts.slice(1, -1)) {
      const exposed = target.imports.some(
        item => item.declaration.alias === alias && item.declaration.exported,
      );
      if (!exposed) return undefined;
      const nested = target.namespaceImports.get(alias);
      if (!nested) return undefined;
      target = nested;
    }
    const exported = this.exportedSymbol(target, parts[parts.length - 1]);
    if (!exported || (kind && exported.kind !== kind)) return undefined;
    if (exported.kind === 'function') {
      return target.functionNames.get(exported.name) ?? exported.name;
    }
    if (exported.kind === 'global') {
      return target.globalNames.get(exported.name) ?? exported.name;
    }
    return target.typeNames.get(exported.name) ?? exported.name;
  }

  private rewriteModule(module: LoadedModule): void {
    const scopes: Array<Set<string>> = [new Set()];
    const isLocal = (name: string): boolean => scopes.some(scope => scope.has(name));
    const declareLocal = (name: string): void => {
      if (name !== '_') scopes[scopes.length - 1].add(name);
    };
    const pushScope = (): void => { scopes.push(new Set()); };
    const popScope = (): void => { scopes.pop(); };

    const rewriteType = (type: MathType): MathType => {
      if (typeof type === 'string') {
        const rewritten = module.typeNames.get(type) ??
          this.resolveQualifiedName(module, type, 'type');
        return rewritten === undefined ? type : rewritten as MathType;
      }
      // ── Type params y generic instances no se reescriben ─────────
      // Un `T` de una plantilla genérica es local a la plantilla: no
      // está en `module.typeNames` y no debe ser reescrito. Si lo
      // dejamos caer por el switch sin case, la función retorna
      // undefined y rompe toda la plantilla.
        if (type.kind === 'type_param') return type;
        if (type.kind === 'generic_instance') {
          return {
            ...type,
            baseName: module.typeNames.get(type.baseName) ??
              this.resolveQualifiedName(module, type.baseName, 'type') ??
              type.baseName,
            typeArgs: type.typeArgs.map(rewriteType),
          };
        }
      // ─────────────────────────────────────────────────────────────
      switch (type.kind) {
        case 'array':
        case 'dynarray':
          return { ...type, elementType: rewriteType(type.elementType) } as MathType;
        case 'pointer':
          return { ...type, targetType: rewriteType(type.targetType) };
        case 'function':
          return {
            ...type,
            paramTypes: type.paramTypes.map(rewriteType),
            returnTypes: type.returnTypes.map(rewriteType),
          };
        case 'struct':
          return {
            ...type,
            name: module.typeNames.get(type.name) ??
              this.resolveQualifiedName(module, type.name, 'type') ??
              type.name,
            fields: type.fields.map(field => ({ ...field, type: rewriteType(field.type) })),
          };
        default: {
          const _exhaustive: never = type;
          throw new Error(`rewriteType: tipo no soportado: ${JSON.stringify(_exhaustive)}`);
        }
      }
    };

    const rewriteExpr = (value: unknown): void => {
      if (Array.isArray(value)) {
        for (const item of value) rewriteExpr(item);
        return;
      }
      if (!value || typeof value !== 'object') return;
      const node = value as Record<string, unknown>;

      // ── NUEVO: reescribir typeArgs explícitamente ────────────────
      // `typeArgs` es un array de MathType. Sin este tratamiento, un
      // type arg que sea `{kind:'struct', name:'MyStruct'}` NO vería
      // su `name` resuelto al prefijo `__module_N_MyStruct`, y la
      // plantilla no podría instanciarse con ese tipo. Los type args
      // primitivos (strings) son no-op.
      if (Array.isArray(node.typeArgs)) {
        node.typeArgs = (node.typeArgs as MathType[]).map(rewriteType);
      }
      // ─────────────────────────────────────────────────────────────

      if (
        node.kind === 'call' &&
        node.name === 'key_values' &&
        Array.isArray(node.args) &&
        node.args[0] &&
        typeof node.args[0] === 'object' &&
        (node.args[0] as Record<string, unknown>).kind === 'variable'
      ) {
        const typeArgument = node.args[0] as Record<string, unknown>;
        if (typeof typeArgument.name === 'string') {
          typeArgument.name = module.typeNames.get(typeArgument.name) ??
            this.resolveQualifiedName(module, typeArgument.name, 'type') ??
            typeArgument.name;
        }
      }

      if (node.kind === 'variable' && typeof node.name === 'string' && !isLocal(node.name)) {
        node.name = this.resolveQualifiedName(module, node.name, 'function') ??
          this.resolveQualifiedName(module, node.name, 'global') ??
          module.functionNames.get(node.name) ?? module.globalNames.get(node.name) ??
          node.name;
      } else if (
        (node.kind === 'call' || node.kind === 'function_ref') &&
        typeof node.name === 'string' &&
        !isLocal(node.name)
      ) {
        const functionName = this.resolveQualifiedName(module, node.name, 'function') ??
          module.functionNames.get(node.name);
        const globalName = node.kind === 'call'
          ? this.resolveQualifiedName(module, node.name, 'global') ??
            module.globalNames.get(node.name)
          : undefined;
        node.name = functionName ?? globalName ?? node.name;
      } else if (node.kind === 'struct_literal' && typeof node.structName === 'string') {
        node.structName = module.typeNames.get(node.structName) ??
          this.resolveQualifiedName(module, node.structName, 'type') ??
          node.structName;
      } else if (node.kind === 'size_of' && typeof node.identName === 'string') {
        const resolvedType = module.typeNames.get(node.identName) ??
          this.resolveQualifiedName(module, node.identName, 'type') ??
          this.resolveQualifiedName(module, node.identName, 'global') ??
          module.globalNames.get(node.identName);

        if (resolvedType) {
          node.identName = resolvedType;
        } else if (node.identName.includes('::')) {
          const parts = node.identName.split('::');
          const targetAlias = parts[0];
          const targetTypeName = parts[parts.length - 1];
          const targetModule = module.namespaceImports.get(targetAlias);
          if (targetModule) {
            const exp = this.exportedSymbol(targetModule, targetTypeName);
            if (exp && exp.kind === 'type') {
              node.identName = targetModule.typeNames.get(exp.name) ?? exp.name;
            }
          }
        }
      } else if (node.kind === 'function_literal') {
        for (const param of node.params as Array<{ name: string; type: MathType }>) {
          param.type = rewriteType(param.type);
        }
        (node.returnTypes as MathType[]).forEach((type, index, types) => {
          types[index] = rewriteType(type);
        });
        pushScope();
        for (const param of node.params as Array<{ name: string }>) declareLocal(param.name);
        rewriteStatements(node.body as StatementNode[], false);
        popScope();
        return;
      }

      if (typeof node.type === 'string' || (node.type && typeof node.type === 'object')) {
        node.type = rewriteType(node.type as MathType);
      }
      for (const key of ['targetType', 'elementType', 'typeExpr']) {
        const type = node[key];
        if (type && typeof type === 'object' || typeof type === 'string') {
          node[key] = rewriteType(type as MathType);
        }
      }
      for (const key of ['paramTypes', 'returnTypes']) {
        const types = node[key];
        if (Array.isArray(types)) node[key] = (types as MathType[]).map(rewriteType);
      }
      for (const [key, child] of Object.entries(node)) {
        if (key === 'kind' || key === 'type' || key === 'targetType' ||
            key === 'elementType' || key === 'typeExpr' ||
            key === 'paramTypes' || key === 'returnTypes' ||
            key === 'typeArgs') continue;  // ← typeArgs ya se manejó arriba
        rewriteExpr(child);
      }
    };

    const rewriteStatements = (statements: StatementNode[], topLevel: boolean): void => {
      for (const stmt of statements) {
        switch (stmt.kind) {
          case 'function_def': {
            if (topLevel) {
              if (!stmt.receiver) {
                const sourceName = stmt.name;
                stmt.name = module.functionNames.get(sourceName) ?? sourceName;

                // ── Sólo el módulo de entrada expone sus símbolos al exterior ──
                // Las librerías (std.cyn, heap.cyn, …) usan `export` sólo para
                // que otros módulos puedan importarlas en tiempo de compilación;
                // esos símbolos NO deben aparecer en la tabla de exports del .wasm.
                stmt.wasmExport = !!stmt.exported && module.entry;
                if (stmt.wasmExport) {
                  stmt.wasmExportName = stmt.exportName ?? sourceName;
                } else {
                  stmt.wasmExportName = undefined;
                }
              }
            }
            if (stmt.receiver) stmt.receiver = rewriteType(stmt.receiver);
            stmt.params.forEach(param => {
              param.type = rewriteType(param.type);
              if (param.defaultValue) rewriteExpr(param.defaultValue);
            });
            stmt.returnTypes = stmt.returnTypes.map(rewriteType);
            pushScope();
            for (const param of stmt.params) declareLocal(param.name);
            rewriteStatements(stmt.body, false);
            popScope();
            break;
          }
          case 'import_decl':
            stmt.name = module.functionNames.get(stmt.name) ?? stmt.name;
            stmt.params.forEach(param => { param.type = rewriteType(param.type); });
            if (stmt.returnType) stmt.returnType = rewriteType(stmt.returnType);
            break;
          case 'var_decl':
          case 'const_decl':
            stmt.type = rewriteType(stmt.type);
            if (stmt.initExpr) rewriteExpr(stmt.initExpr);
            if (topLevel) {
              const sourceName = stmt.name;
              stmt.name = module.globalNames.get(sourceName) ?? sourceName;

              // Mismo criterio que con funciones: sólo el entry exporta al .wasm.
              stmt.wasmExport = !!stmt.exported && module.entry;
              if (stmt.wasmExport) {
                stmt.wasmExportName = stmt.exportName ?? sourceName;
              } else {
                stmt.wasmExportName = undefined;
              }
            } else {
              declareLocal(stmt.name);
            }
            break;
          case 'short_var_decl':
            rewriteExpr(stmt.expr);
            declareLocal(stmt.name);
            break;
          case 'multi_decl':
            rewriteExpr(stmt.expr);
            stmt.names.forEach(declareLocal);
            break;
          case 'assign':
            rewriteExpr(stmt.target);
            rewriteExpr(stmt.expr);
            break;
          case 'struct_def':
            stmt.name = module.typeNames.get(stmt.name) ?? stmt.name;
            stmt.fields = stmt.fields.map(field => ({ ...field, type: rewriteType(field.type) }));
            break;
          case 'type_alias':
            stmt.name = module.typeNames.get(stmt.name) ?? stmt.name;
            stmt.targetType = rewriteType(stmt.targetType);
            break;
          case 'if':
            rewriteExpr(stmt.condition);
            pushScope();
            rewriteStatements(stmt.thenBlock, false);
            popScope();
            if (Array.isArray(stmt.elseBlock)) {
              pushScope();
              rewriteStatements(stmt.elseBlock, false);
              popScope();
            } else if (stmt.elseBlock) {
              rewriteStatements([stmt.elseBlock], false);
            }
            break;
          case 'for':
            pushScope();
            if (stmt.init) rewriteStatements([stmt.init], false);
            if (stmt.condition) rewriteExpr(stmt.condition);
            if (stmt.post) rewriteStatements([stmt.post], false);
            rewriteStatements(stmt.body, false);
            popScope();
            break;
          case 'for_in':
            rewriteExpr(stmt.iterable);
            pushScope();
            stmt.varNames.forEach(declareLocal);
            rewriteStatements(stmt.body, false);
            popScope();
            break;
          case 'switch':
            rewriteExpr(stmt.expr);
            stmt.cases.forEach(item => {
              item.patterns.forEach(pattern => {
                this.rewritePattern(pattern, module.typeNames, module);
              });
              pushScope();
              rewriteStatements(item.body, false);
              popScope();
            });
            if (stmt.defaultBody) {
              pushScope();
              rewriteStatements(stmt.defaultBody, false);
              popScope();
            }
            break;
          case 'region':
            pushScope();
            rewriteStatements(stmt.body, false);
            popScope();
            break;
          case 'return':
            stmt.values.forEach(rewriteExpr);
            break;
          case 'expression_stmt':
            rewriteExpr(stmt.expr);
            break;
          case 'module_import':
          case 'break':
          case 'continue':
            break;
        }
      }
    };

    rewriteStatements(module.program.body, true);
  }
}