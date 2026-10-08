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

interface LoadedModule {
  path: string;
  program: ProgramNode;
  imports: Array<{ declaration: ModuleImportNode; target: LoadedModule }>;
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
      const program = new Parser(new Lexer(processed.source, processed.sourceMap)).parseProgram();
      const module: LoadedModule = {
        path: resolvedPath,
        program,
        imports: [],
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
        const targetPath = path.resolve(path.dirname(resolvedPath), declaration.path);
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
        const exported = this.exportedSymbol(target, declaration.symbol);
        if (!exported) continue;
        if (exported.kind === 'function') {
          module.functionNames.set(declaration.symbol, target.functionNames.get(exported.name)!);
        } else if (exported.kind === 'global') {
          module.globalNames.set(declaration.symbol, target.globalNames.get(exported.name)!);
        } else {
          module.typeNames.set(declaration.symbol, target.typeNames.get(exported.name)!);
        }
      }
    }
  }

  private validateModuleBindings(): void {
    for (const module of this.order) {
      const ownNames = this.localTopLevelNames(module);
      const importedNames = new Set<string>();

      for (const { declaration, target } of module.imports) {
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

      for (const stmt of module.program.body) {
        if (stmt.kind === 'function_def' && stmt.exported && stmt.receiver) {
          const fn = stmt as FunctionDefNode;
          throw this.locatedError(stmt, `Los métodos todavía no pueden exportarse: '${fn.name}'`);
        }
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
  ): { kind: 'function' | 'global' | 'type'; name: string } | null {
    const fn = this.functions(module).find(
      item => item.exported && (item.exportName ?? item.name) === symbol,
    );
    if (fn) return { kind: 'function', name: fn.name };

    const global = module.program.body.find(
      (item): item is Extract<StatementNode, { kind: 'var_decl' | 'const_decl' }> =>
        (item.kind === 'var_decl' || item.kind === 'const_decl') &&
        item.exported &&
        (item.exportName ?? item.name) === symbol,
    );
    if (global) return { kind: 'global', name: global.name };

    const type = module.program.body.find(
      (item): item is Extract<StatementNode, { kind: 'struct_def' | 'type_alias' }> =>
        (item.kind === 'struct_def' || item.kind === 'type_alias') &&
        item.exported &&
        (item.exportName ?? item.name) === symbol,
    );
    if (type) return { kind: 'type', name: type.name };
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
  ): void {
    if (pattern.kind !== 'struct') return;
    pattern.structName = typeNames.get(pattern.structName) ?? pattern.structName;
    for (const field of pattern.fields) this.rewritePattern(field.pattern, typeNames);
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
        const rewritten = module.typeNames.get(type);
        return rewritten === undefined ? type : rewritten as MathType;
      }
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
            name: module.typeNames.get(type.name) ?? type.name,
            fields: type.fields.map(field => ({ ...field, type: rewriteType(field.type) })),
          };
      }
    };

    const rewriteExpr = (value: unknown): void => {
      if (Array.isArray(value)) {
        for (const item of value) rewriteExpr(item);
        return;
      }
      if (!value || typeof value !== 'object') return;
      const node = value as Record<string, unknown>;

      if (node.kind === 'variable' && typeof node.name === 'string' && !isLocal(node.name)) {
        node.name = module.functionNames.get(node.name) ??
          module.globalNames.get(node.name) ??
          node.name;
      } else if (
        (node.kind === 'call' || node.kind === 'function_ref') &&
        typeof node.name === 'string' &&
        !isLocal(node.name)
      ) {
        node.name = module.functionNames.get(node.name) ?? node.name;
      } else if (node.kind === 'struct_literal' && typeof node.structName === 'string') {
        node.structName = module.typeNames.get(node.structName) ?? node.structName;
      } else if (node.kind === 'size_of' && typeof node.identName === 'string') {
        node.identName = module.typeNames.get(node.identName) ?? node.identName;
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
            key === 'paramTypes' || key === 'returnTypes') continue;
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
                stmt.wasmExport = !!stmt.exported;
                if (stmt.exported) {
                  const publicName = stmt.exportName ?? sourceName;
                  const modulePath = path.relative(this.entryDirectory, module.path)
                    .split(path.sep)
                    .join('/');
                  stmt.wasmExportName = module.entry
                    ? publicName
                    : `${modulePath}::${publicName}`;
                }
              }
            }
            if (stmt.receiver) stmt.receiver = rewriteType(stmt.receiver);
            stmt.params.forEach(param => { param.type = rewriteType(param.type); });
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
              stmt.wasmExport = !!stmt.exported;
              if (stmt.exported) {
                const publicName = stmt.exportName ?? sourceName;
                const modulePath = path.relative(this.entryDirectory, module.path)
                  .split(path.sep)
                  .join('/');
                stmt.wasmExportName = module.entry
                  ? publicName
                  : `${modulePath}::${publicName}`;
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
            stmt.fields.forEach(field => { field.type = rewriteType(field.type); });
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
                this.rewritePattern(pattern, module.typeNames);
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
