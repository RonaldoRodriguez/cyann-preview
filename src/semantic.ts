import { ProgramNode, StatementNode, FunctionDefNode, ImportDeclNode, MultiDeclNode } from './parser';
import {
  MathNode, MathType, FunctionType, StructType, StructField,
  FunctionLiteralNode, ClosureNode, CaptureAccessNode,
  CapturedVar, VariableNode, ArithmeticType, PatternNode,
  MakeArrayNode, CallNode, StructAccessNode, SizeOfNode,
} from './types';
import { mangleFunctionName, functionParamsEqual, mangleType } from './mangler';
import {
  TypeRegistry, computeStructLayout,
  typesEqual as areTypesEqual, describeType,
  isArithmeticType, isIntegerType, isAssignableType as areTypesAssignable,
  maxArithmeticType, supportsStructuralEquality,
} from './typeSystem';

const analyzedProgramBrand: unique symbol = Symbol('analyzedProgram');

export interface AnalyzedProgram extends ProgramNode {
  readonly [analyzedProgramBrand]: true;
}

// ─── Acumulador de diagnósticos ───────────────────────────────────────────
class DiagnosticBag {
  private errors: string[] = [];

  error(msg: string): void {
    this.errors.push(msg);
  }

  hasErrors(): boolean {
    return this.errors.length > 0;
  }

  getErrors(): string[] {
    return [...this.errors];
  }
}

export interface FunctionOverload { mangledName: string; type: FunctionType; }
export interface SymbolInfo {
  uniqueName: string;
  type: MathType;
  mutable: boolean;
  isGlobal: boolean;
  isFunctionDecl?: boolean;
  overloads?: FunctionOverload[];
  boxed?: boolean;
}

export class ScopeControl {
  private scopes: Map<string, SymbolInfo>[] = [];
  private counter = 0;
  private lambdaBoundaries: number[] = [];

  constructor() { this.scopes.push(new Map()); }

  isGlobal() { return this.scopes.length === 1; }
  pushScope() { this.scopes.push(new Map()); }
  popScope() {
    if (this.scopes.length <= 1) throw new Error('No se puede eliminar el ámbito global');
    this.scopes.pop();
  }

  pushLambdaBoundary(): void { this.lambdaBoundaries.push(this.scopes.length); }
  popLambdaBoundary(): void { this.lambdaBoundaries.pop(); }

  private isInsideInnermostLambda(scopeIndex: number): boolean {
    if (this.lambdaBoundaries.length === 0) return true;
    const boundary = this.lambdaBoundaries[this.lambdaBoundaries.length - 1];
    return scopeIndex >= boundary;
  }

  lookupWithBoundary(name: string): { info: SymbolInfo; isCapture: boolean } {
    for (let i = this.scopes.length - 1; i >= 0; i--) {
      const info = this.scopes[i].get(name);
      if (info) return { info, isCapture: !this.isInsideInnermostLambda(i) };
    }
    throw new Error(`Identificador no definido: '${name}'`);
  }

  declare(name: string, type: MathType, mutable: boolean, global = false, boxed = false): string {
    const target = global ? this.scopes[0] : this.scopes[this.scopes.length - 1];
    if (target.has(name)) throw new Error(`El identificador '${name}' ya está declarado en este ámbito`);
    const uniqueName = `$${name}_${this.counter++}`;
    target.set(name, { uniqueName, type, mutable, isGlobal: global, boxed });
    return uniqueName;
  }

  declareFunction(name: string, mangledName: string, fnType: FunctionType, global: boolean): void {
    const target = global ? this.scopes[0] : this.scopes[this.scopes.length - 1];
    const existing = target.get(name);
    if (existing) {
      if (!existing.isFunctionDecl) throw new Error(`'${name}' ya está declarado como variable; no se puede sobrecargar`);
      for (const ov of existing.overloads!) {
        if (functionParamsEqual(ov.type, fnType)) {
          if (ov.mangledName === mangledName) return;
          throw new Error(`Sobrecarga duplicada de '${name}'`);
        }
      }
      existing.overloads!.push({ mangledName, type: fnType });
    } else {
      target.set(name, {
        uniqueName: mangledName, type: fnType, mutable: false, isGlobal: global,
        isFunctionDecl: true, overloads: [{ mangledName, type: fnType }],
      });
    }
  }

  lookup(name: string): SymbolInfo {
    for (let i = this.scopes.length - 1; i >= 0; i--) {
      if (this.scopes[i].has(name)) return this.scopes[i].get(name)!;
    }
    throw new Error(`Identificador no definido: '${name}'`);
  }

  has(name: string): boolean {
    for (let i = this.scopes.length - 1; i >= 0; i--) if (this.scopes[i].has(name)) return true;
    return false;
  }
  checkMutable(name: string): void {
    if (!this.lookup(name).mutable) throw new Error(`No se puede reasignar un valor a una constante '${name}'`);
  }
}

interface CaptureFrame {
  captures: Map<string, CapturedVar>;
}

export class SemanticAnalyzer {
  private scopeControl: ScopeControl;
  private typeRegistry: TypeRegistry;
  private currentReturnTypes: MathType[] = [];
  private _structCache = new Map<string, StructType>();

  private currentLevel = 0;
  private slotLevels = new Map<string, number>();

  private hoistedFunctions: FunctionDefNode[] = [];
  private anonStructs = new Map<string, string>();
  private anonStructCounter = 0;
  private lambdaCounter = 0;
  private captureStack: CaptureFrame[] = [];
  private capturedNamesStack: Set<string>[] = [];
  private typeAliases = new Map<string, MathType>();

  private methodsByStruct = new Map<string, Map<string, FunctionOverload>>();
  private syntheticCounter = 0;

  private diagnostics = new DiagnosticBag();

  private error(msg: string): void {
    this.diagnostics.error(msg);
  }

  constructor() {
    this.scopeControl = new ScopeControl();
    this.typeRegistry = new TypeRegistry();
    this.registerBuiltins();
  }

  private registerBuiltins(): void {
    const s32: MathType = 's32';
    const builtins: { name: string; params: MathType[]; ret: MathType | null }[] = [
      { name: 'arena_save',    params: [],              ret: s32            },
      { name: 'arena_restore', params: [s32],           ret: null           },
      { name: 'arena_alloc',   params: [s32],           ret: s32            },
      { name: 'memcpy',        params: [s32, s32, s32], ret: null           },
      { name: 'mem_read32',    params: [s32],           ret: s32            },
      { name: 'mem_write32',   params: [s32, s32],      ret: null           },
      { name: 'mem_read8',     params: [s32],           ret: s32            },
      { name: 'mem_write8',    params: [s32, s32],      ret: null           },
      { name: 'str_len',       params: ['string'],      ret: s32            },
      { name: 'str_concat',    params: ['string', 'string'], ret: 'string'  },
      { name: 'str_eq',        params: ['string', 'string'], ret: 'bool'    },
      { name: 'str_ne',        params: ['string', 'string'], ret: 'bool'    },
    ];
    for (const b of builtins) {
      const fnType: FunctionType = {
        kind: 'function',
        paramTypes: b.params,
        returnTypes: b.ret ? [b.ret] : [],
      };
      this.scopeControl.declareFunction(b.name, b.name, fnType, true);
    }
  }

  private isHeapType(t: MathType): boolean {
    if (t === 'string') return true;
    if (typeof t !== 'object') return false;
    return t.kind === 'struct' || t.kind === 'dynarray' || t.kind === 'pointer';
  }

  private exprLevel(expr: MathNode): number {
    const t = (expr as any).type as MathType;
    if (!this.isHeapType(t)) {
      if (expr.kind !== 'closure' && expr.kind !== 'function_ref') return 0;
    }
    switch (expr.kind) {
      case 'variable': {
        const v = expr as any;
        return this.slotLevels.get(v.uniqueName) ?? 0;
      }
      case 'struct_literal':
      case 'array_literal':
      case 'make_array':
      case 'call':
      case 'call_indirect':
      case 'closure':
      case 'function_ref':
        return this.currentLevel;
      case 'binary': {
        const b = expr as any;
        if (b.op === '+' && (b.left as any).type === 'string') return this.currentLevel;
        return Math.max(this.exprLevel(b.left), this.exprLevel(b.right));
      }
      case 'cast':   return this.exprLevel((expr as any).operand);
      case 'unary':  return this.exprLevel((expr as any).operand);
      case 'struct_access': return this.exprLevel((expr as any).base);
      case 'array_access':  return this.exprLevel((expr as any).base);
      default: return 0;
    }
  }

  private checkEscape(value: MathNode, slotLevel: number, ctx: string): void {
    if (!value) return;
    const lvl = this.exprLevel(value);
    if (lvl > slotLevel) {
      this.error(
        `Escapado de región en ${ctx}: el valor proviene del nivel ${lvl}, ` +
        `pero se almacena en un slot del nivel ${slotLevel}`
      );
    }
  }

  private slotLevelOfTarget(target: MathNode): number {
    let root: any = target;
    while (root.kind === 'struct_access' || root.kind === 'array_access') root = root.base;
    if (root.kind !== 'variable') return 0;
    return this.slotLevels.get(root.uniqueName) ?? 0;
  }

  private allPathsReturn(stmts: StatementNode[]): boolean {
    for (const s of stmts) {
      if (s.kind === 'return') return true;

      if (s.kind === 'if' && s.elseBlock) {
        const thenR = this.allPathsReturn(s.thenBlock);
        const elseR = Array.isArray(s.elseBlock)
          ? this.allPathsReturn(s.elseBlock)
          : this.allPathsReturn([s.elseBlock]);
        if (thenR && elseR) return true;
      }

      if (s.kind === 'switch' && s.defaultBody !== null) {
        const casesReturn = s.cases.every(c => this.allPathsReturn(c.body));
        const defaultReturns = this.allPathsReturn(s.defaultBody);
        if (casesReturn && defaultReturns) return true;
      }

      if (s.kind === 'region' && this.allPathsReturn(s.body)) return true;
    }
    return false;
  }

  private currentCapturedNames(): Set<string> | null {
    return this.capturedNamesStack.length > 0
      ? this.capturedNamesStack[this.capturedNamesStack.length - 1]
      : null;
  }

  private findCapturedVars(
    fnParams: { name: string }[],
    fnBody: StatementNode[]
  ): Set<string> {
    const captured = new Set<string>();
    const scopes: Array<Map<string, number>> = [new Map()];
    let lambdaDepth = 0;

    const declare = (name: string) => { scopes[scopes.length - 1].set(name, lambdaDepth); };
    const lookup = (name: string): number | undefined => {
      for (let i = scopes.length - 1; i >= 0; i--) {
        const v = scopes[i].get(name);
        if (v !== undefined) return v;
      }
      return undefined;
    };
    const pushScope = () => scopes.push(new Map());
    const popScope = () => scopes.pop();

    pushScope();
    for (const p of fnParams) declare(p.name);

    const visitExpr = (node: any): void => {
      if (!node || typeof node !== 'object') return;
      if (Array.isArray(node)) { for (const x of node) visitExpr(x); return; }

      if (node.kind === 'variable' && typeof node.name === 'string') {
        const d = lookup(node.name);
        if (d !== undefined && d < lambdaDepth) captured.add(node.name);
        return;
      }

      if (node.kind === 'function_literal') {
        lambdaDepth++;
        pushScope();
        for (const p of node.params) declare(p.name);
        for (const s of node.body) visitStmt(s);
        popScope();
        lambdaDepth--;
        return;
      }

      for (const key of Object.keys(node)) {
        if (key === 'kind') continue;
        visitExpr(node[key]);
      }
    };

    const visitStmt = (stmt: any): void => {
      if (!stmt || typeof stmt !== 'object') return;
      switch (stmt.kind) {
        case 'var_decl':
        case 'const_decl':
          if (stmt.initExpr) visitExpr(stmt.initExpr);
          declare(stmt.name);
          return;
        case 'short_var_decl':
          visitExpr(stmt.expr);
          declare(stmt.name);
          return;
        case 'multi_decl':
          visitExpr(stmt.expr);
          for (const n of stmt.names) {
            if (n !== '_') declare(n);
          }
          return;
        case 'assign':
          visitExpr(stmt.target);
          visitExpr(stmt.expr);
          return;
        case 'function_def':
          return;
        case 'if':
          visitExpr(stmt.condition);
          pushScope();
          for (const s of stmt.thenBlock) visitStmt(s);
          popScope();
          if (stmt.elseBlock) {
            pushScope();
            if (Array.isArray(stmt.elseBlock)) { for (const s of stmt.elseBlock) visitStmt(s); }
            else visitStmt(stmt.elseBlock);
            popScope();
          }
          return;
        case 'for':
          pushScope();
          if (stmt.init) visitStmt(stmt.init);
          if (stmt.condition) visitExpr(stmt.condition);
          if (stmt.post) visitStmt(stmt.post);
          for (const s of stmt.body) visitStmt(s);
          popScope();
          return;
        case 'for_in':
          visitExpr(stmt.iterable);
          pushScope();
          for (const n of stmt.varNames) {
            if (n !== '_') declare(n);
          }
          for (const s of stmt.body) visitStmt(s);
          popScope();
          return;
        case 'switch':
          visitExpr(stmt.expr);
          for (const c of stmt.cases) {
            pushScope();
            for (const s of c.body) visitStmt(s);
            popScope();
          }
          if (stmt.defaultBody) {
            pushScope();
            for (const s of stmt.defaultBody) visitStmt(s);
            popScope();
          }
          return;
        case 'region':
          pushScope();
          for (const s of stmt.body) visitStmt(s);
          popScope();
          return;
        case 'return':
          for (const v of stmt.values) visitExpr(v);
          return;
        case 'expression_stmt':
          visitExpr(stmt.expr);
          return;
      }
    };

    for (const s of fnBody) visitStmt(s);
    popScope();

    return captured;
  }

  public analyzeProgram(program: ProgramNode): AnalyzedProgram {
    this.currentLevel = 0;
    this.hoistedFunctions = [];
    this.anonStructs.clear();
    this.anonStructCounter = 0;
    this.lambdaCounter = 0;
    this.captureStack = [];
    this.capturedNamesStack = [];
    this.methodsByStruct.clear();
    this.diagnostics = new DiagnosticBag();

    this.typeAliases.clear();
    this.collectTypeAliases(program.body);
    this.collectStructs(program.body);
    this.collectFunctions(program.body);

    for (const stmt of program.body) this.analyzeStatement(stmt);

    for (const h of this.hoistedFunctions) program.body.push(h);
    this.hoistedFunctions = [];

    if (this.diagnostics.hasErrors()) {
      const errs = this.diagnostics.getErrors();
      throw new Error(
        `Se encontraron ${errs.length} error${errs.length === 1 ? '' : 'es'}:\n` +
        errs.map((e, i) => `  ${i + 1}. ${e}`).join('\n')
      );
    }
    return Object.assign(program, { [analyzedProgramBrand]: true as const });
  }

  private collectTypeAliases(stmts: StatementNode[]): void {
    for (const s of stmts) {
      if (s.kind !== 'type_alias') continue;
      this.typeAliases.set(s.name, s.targetType);
    }
  }

  private collectStructs(stmts: StatementNode[]): void {
    for (const s of stmts) {
      if (s.kind !== 'struct_def') continue;

      this.typeRegistry.registerStruct(
        s.name,
        s.fields.map(f => {
          const regName = this.registryTypeName(f.type);
          if (typeof f.type === 'object' && f.type.kind === 'function') {
            return { name: f.name, type: regName, mathType: f.type };
          }
          return { name: f.name, type: regName };
        })
      );
      const structType = this.structTypeFromRegistry(s.name);
      this.scopeControl.declare(s.name, structType, false, true);
    }
  }

  private collectFunctions(stmts: StatementNode[]): void {
    for (const s of stmts) {
      if (s.kind !== 'function_def') continue;
      const fn = s as FunctionDefNode;

      let receiverType: StructType | null = null;
      if (fn.receiver) {
        const rt = this.resolveType(fn.receiver);
        if (typeof rt !== 'object' || rt.kind !== 'struct') {
          this.error(
            `Receiver de '${fn.name}' debe ser un struct, se obtuvo ${this.typeName(rt)}`
          );
          continue;
        }
        if (rt.name === '') {
          this.error(`Receiver de '${fn.name}' no puede ser un struct anónimo`);
          continue;
        }
        receiverType = rt;
      }

      const userParamTypes = fn.params.map(p => this.resolveType(p.type));
      const allParamTypes = receiverType
        ? [receiverType, ...userParamTypes]
        : userParamTypes;
      const returnTypes = fn.returnTypes.map(t => this.resolveType(t));
      const fnType: FunctionType = {
        kind: 'function',
        paramTypes: allParamTypes,
        returnTypes,
      };
      const mangledName = mangleFunctionName(fn.name, allParamTypes);

      if (receiverType) {
        this.registerMethod(receiverType.name, fn.name, mangledName, fnType);
      }

      this.scopeControl.declareFunction(fn.name, mangledName, fnType, true);
    }
  }

  private registerMethod(
    receiverName: string,
    methodName: string,
    mangled: string,
    type: FunctionType,
  ): void {
    let methods = this.methodsByStruct.get(receiverName);
    if (!methods) {
      methods = new Map();
      this.methodsByStruct.set(receiverName, methods);
    }
    methods.set(methodName, { mangledName: mangled, type });
  }

  private lookupMethod(
    receiverName: string,
    methodName: string,
  ): FunctionOverload | undefined {
    return this.methodsByStruct.get(receiverName)?.get(methodName);
  }

  public analyzeStatement(stmt: StatementNode): void {
    switch (stmt.kind) {

      case 'import_decl': {
        const id = stmt as ImportDeclNode;
        const paramTypes = id.params.map(p => this.resolveType(p.type));
        const fnType: FunctionType = {
          kind: 'function', paramTypes,
          returnTypes: id.returnType ? [this.resolveType(id.returnType)] : [],
        };
        this.scopeControl.declareFunction(id.name, id.name, fnType, true);
        break;
      }

      case 'const_decl':
      case 'var_decl': {
        const isGlobal = this.scopeControl.isGlobal();
        const initType = stmt.initExpr
          ? this.resolveType(this.analyzeExpression(stmt.initExpr))
          : null;
        const declaredType = stmt.inferred ? null : this.resolveType(stmt.type);
        let finalType = declaredType ?? initType ?? this.resolveType(stmt.type);
        if (initType !== null && declaredType !== null &&
            !this.isAssignableType(initType, declaredType)) {
          const contextualized = stmt.initExpr !== null &&
            this.contextualizeArrayLiteral(stmt.initExpr, declaredType);
          if (contextualized) finalType = declaredType;
          else if (!(initType === 'null' && typeof declaredType === 'object')) {
            this.error(
              `Type mismatch: no se puede asignar ${this.typeName(initType)} a '${stmt.name}' ` +
              `de tipo ${this.typeName(declaredType)}`
            );
          }
        }

        stmt.type = finalType;
        const isBoxed = !isGlobal && (this.currentCapturedNames()?.has(stmt.name) ?? false);
        const uniqueName = this.scopeControl.declare(stmt.name, finalType, !stmt.isConst, isGlobal, isBoxed);
        (stmt as any).uniqueName = uniqueName;
        (stmt as any).isGlobal = isGlobal;
        if (isBoxed) (stmt as any).boxed = true;

        const slotLvl = isGlobal ? 0 : this.currentLevel;
        this.slotLevels.set(uniqueName, slotLvl);
        if (stmt.initExpr) {
          this.checkEscape(stmt.initExpr, slotLvl, `inicialización de '${stmt.name}'`);
        }
        break;
      }

      case 'short_var_decl': {
        const inferredType = this.resolveType(this.analyzeExpression(stmt.expr));
        const isBoxed = this.currentCapturedNames()?.has(stmt.name) ?? false;
        const uniqueName = this.scopeControl.declare(stmt.name, inferredType, true, false, isBoxed);
        (stmt as any).uniqueName = uniqueName;
        if (isBoxed) (stmt as any).boxed = true;
        this.slotLevels.set(uniqueName, this.currentLevel);
        this.checkEscape(stmt.expr, this.currentLevel, `:= '${stmt.name}'`);
        break;
      }
// Ninguna sobrecarga de 
      case 'multi_decl': {
        const md = stmt as MultiDeclNode;
        const firstType = this.resolveType(this.analyzeExpression(md.expr));

        const returnTypes = (md.expr as any).returnTypes as MathType[] | undefined;
        if (!returnTypes || returnTypes.length === 0) {
          this.error(
            `multi-declaración requiere una llamada con múltiples valores ` +
            `de retorno; se obtuvo un valor de tipo ${this.typeName(firstType)}`
          );
          break;
        }
        if (returnTypes.length !== md.names.length) {
          this.error(
            `multi-declaración de ${md.names.length} nombres pero ` +
            `la expresión retorna ${returnTypes.length} valores`
          );
          break;
        }

        md.uniqueNames = [];
        for (let i = 0; i < md.names.length; i++) {
          if (md.names[i] === '_') {
            md.uniqueNames.push(null);
            continue;
          }
          const uniqueName = this.scopeControl.declare(
            md.names[i], returnTypes[i], true, false, false
          );
          md.uniqueNames.push(uniqueName);
          this.slotLevels.set(uniqueName, this.currentLevel);
        }
        break;
      }

      case 'assign': {
        const targetType = this.resolveType(this.analyzeExpression(stmt.target));

        let root: any = stmt.target;
        while (root.kind === 'struct_access' || root.kind === 'array_access') {
          root = (root as any).base;
        }
        if (root.kind === 'capture_access') {
          // OK
        } else {
          if (root.kind !== 'variable') {
            this.error('El destino no es modificable');
            break;
          }
          this.scopeControl.checkMutable(root.name);
          const slotLvl = this.slotLevelOfTarget(stmt.target);
          this.checkEscape(stmt.expr, slotLvl, `asignación a '${root.name}'`);
        }

        const exprType = this.resolveType(this.analyzeExpression(stmt.expr));

        if (!this.isAssignableType(exprType, targetType)) {
          const contextualized = this.contextualizeArrayLiteral(stmt.expr, targetType);
          if (!contextualized && !(exprType === 'null' && typeof targetType !== 'string')) {
            this.error(
              `Type mismatch en asignación: no se puede asignar ${this.typeName(exprType)} ` +
              `a un destino de tipo ${this.typeName(targetType)}`
            );
          }
        }
        break;
      }

      case 'function_def':
        this.analyzeFunction(stmt as FunctionDefNode);
        break;

      case 'struct_def':
      case 'type_alias':
        break;

      case 'if': {
        const condType = this.analyzeExpression(stmt.condition);
        if (condType !== 'bool') this.error('La condición del if debe ser bool');
        this.scopeControl.pushScope();
        for (const s of stmt.thenBlock) this.analyzeStatement(s);
        this.scopeControl.popScope();
        if (stmt.elseBlock) {
          this.scopeControl.pushScope();
          if (Array.isArray(stmt.elseBlock)) for (const s of stmt.elseBlock) this.analyzeStatement(s);
          else this.analyzeStatement(stmt.elseBlock);
          this.scopeControl.popScope();
        }
        break;
      }

      case 'for': {
        this.scopeControl.pushScope();
        if (stmt.init) this.analyzeStatement(stmt.init);
        if (stmt.condition) {
          const condType = this.analyzeExpression(stmt.condition);
          if (condType !== 'bool') this.error('La condición del for debe ser bool');
        }
        if (stmt.post) this.analyzeStatement(stmt.post);
        for (const s of stmt.body) this.analyzeStatement(s);
        this.scopeControl.popScope();
        break;
      }

      case 'for_in': {
        const iterableType = this.resolveType(this.analyzeExpression(stmt.iterable));
        if (typeof iterableType !== 'object' ||
            (iterableType.kind !== 'array' && iterableType.kind !== 'dynarray')) {
          this.error(`for ... in: se esperaba un array, se obtuvo ${this.typeName(iterableType)}`);
          break;
        }

        const names = stmt.varNames;
        if (names.length < 1 || names.length > 2) {
          this.error(`for ... in: se esperan 1 o 2 variables, se recibieron ${names.length}`);
          break;
        }

        let indexName: string | null = null;
        let valueName: string;
        if (names.length === 1) {
          valueName = names[0];
        } else {
          indexName = names[0];
          valueName = names[1];
        }

        this.scopeControl.pushScope();

        let indexUnique: string | null = null;
        if (indexName !== null && indexName !== '_') {
          indexUnique = this.scopeControl.declare(indexName, 's32', true, false);
          this.slotLevels.set(indexUnique, this.currentLevel);
        }

        let valueUnique: string | null = null;
        if (valueName !== '_') {
          valueUnique = this.scopeControl.declare(valueName, iterableType.elementType, true, false);
          this.slotLevels.set(valueUnique, this.currentLevel);
        }

        (stmt as any).indexUnique = indexUnique;
        (stmt as any).valueUnique = valueUnique;
        (stmt as any).elementType = iterableType.elementType;

        for (const s of stmt.body) this.analyzeStatement(s);
        this.scopeControl.popScope();
        break;
      }

      case 'switch': {
        const condType = this.resolveType(this.analyzeExpression(stmt.expr));
        stmt.exprType = condType;

        if (!this.isComparableType(condType)) {
          this.error(`switch: tipo no comparable (${this.typeName(condType)})`);
          break;
        }

        for (const c of stmt.cases) {
          for (const pattern of c.patterns) {
            this.analyzePattern(pattern, condType);
          }
          this.scopeControl.pushScope();
          for (const s of c.body) this.analyzeStatement(s);
          this.scopeControl.popScope();
        }
        if (stmt.defaultBody) {
          this.scopeControl.pushScope();
          for (const s of stmt.defaultBody) this.analyzeStatement(s);
          this.scopeControl.popScope();
        }
        break;
      }

      case 'region': {
        this.scopeControl.pushScope();
        this.currentLevel++;
        try {
          for (const s of stmt.body) this.analyzeStatement(s);
        } finally {
          this.currentLevel--;
          this.scopeControl.popScope();
        }
        break;
      }

      case 'break':
      case 'continue':
        break;

      case 'return': {
        const actualTypes = stmt.values.map(
          v => this.resolveType(this.analyzeExpression(v))
        );
        const expected = this.currentReturnTypes;

        if (expected.length === 0) {
          if (actualTypes.length > 0) {
            this.error('La función no debe retornar valores');
          }
        } else {
          if (actualTypes.length !== expected.length) {
            this.error(
              `Se esperaban ${expected.length} valores de retorno, ` +
              `se recibieron ${actualTypes.length}`
            );
          } else {
            for (let i = 0; i < expected.length; i++) {
              if (!this.isAssignableType(actualTypes[i], expected[i])) {
                if (!(actualTypes[i] === 'null' && typeof expected[i] !== 'string')) {
                  this.error(
                    `Tipo de retorno ${i} incorrecto: se esperaba ` +
                    `${this.typeName(expected[i])}, se obtuvo ${this.typeName(actualTypes[i])}`
                  );
                }
              }
            }
          }
        }

        for (const v of stmt.values) this.checkEscape(v, 0, 'return');
        break;
      }

      case 'expression_stmt':
        this.analyzeExpression(stmt.expr);
        break;
    }
  }

  private analyzeFunction(fn: FunctionDefNode): void {
    let receiverType: StructType | null = null;
    if (fn.receiver) {
      const rt = this.resolveType(fn.receiver);
      if (typeof rt !== 'object' || rt.kind !== 'struct') {
        this.error(
          `Receiver de '${fn.name}' debe ser un struct, se obtuvo ${this.typeName(rt)}`
        );
        return;
      }
      receiverType = rt;
    }

    if (receiverType) {
      for (const p of fn.params) {
        if (p.name === 'self') {
          this.error(
            `'self' está reservado como receiver en el método '${fn.name}'; ` +
            `renombrá el parámetro.`
          );
        }
      }
    }

    const userParamTypes = fn.params.map(p => this.resolveType(p.type));
    const allParamTypes = receiverType
      ? [receiverType, ...userParamTypes]
      : userParamTypes;
    const returnTypes = fn.returnTypes.map(t => this.resolveType(t));
    const fnType: FunctionType = {
      kind: 'function',
      paramTypes: allParamTypes,
      returnTypes,
    };

    const sourceName = fn.name;
    const isLambda = sourceName.startsWith('__lambda_');
    const mangledName = isLambda
      ? sourceName
      : mangleFunctionName(sourceName, allParamTypes);

    if (isLambda) {
      this.scopeControl.declareFunction(sourceName, mangledName, fnType, false);
    } else if (!receiverType) {
      this.scopeControl.declareFunction(
        sourceName, mangledName, fnType, this.scopeControl.isGlobal()
      );
    }
    (fn as any).mangledName = mangledName;

    const prevReturn = this.currentReturnTypes;
    const prevLevel = this.currentLevel;
    this.currentReturnTypes = returnTypes;
    this.currentLevel = 0;

    this.scopeControl.pushScope();

    if (receiverType) {
      const selfUnique = this.scopeControl.declare(
        'self', receiverType, true, false, false
      );
      fn.params = [
        { name: 'self', type: receiverType, uniqueName: selfUnique },
        ...fn.params,
      ];
      this.slotLevels.set(selfUnique, 0);
    }

    const capturedNames = this.findCapturedVars(fn.params, fn.body);
    this.capturedNamesStack.push(capturedNames);

    const userParamStart = receiverType ? 1 : 0;
    for (let i = userParamStart; i < fn.params.length; i++) {
      const param = fn.params[i];
      const paramType = this.resolveType(param.type);
      const isBoxed = capturedNames.has(param.name);
      const uniqueName = this.scopeControl.declare(
        param.name, paramType, true, false, isBoxed
      );
      (param as any).uniqueName = uniqueName;
      if (isBoxed) (param as any).boxed = true;
      this.slotLevels.set(uniqueName, 0);
    }

    for (const stmt of fn.body) this.analyzeStatement(stmt);

    if (fn.returnTypes.length > 0 && !this.allPathsReturn(fn.body)) {
      this.error(
        `La función '${sourceName}' no retorna en todos los caminos ` +
        `(se esperaba${returnTypes.length > 1 ? 'n ' : ' '}` +
        `${returnTypes.map(t => this.typeName(t)).join(', ')})`
      );
    }

    this.currentReturnTypes = prevReturn;
    this.currentLevel = prevLevel;
    this.scopeControl.popScope();
    this.capturedNamesStack.pop();

    fn.name = mangledName;
  }

  private isComparableType(t: MathType): boolean {
    if (isArithmeticType(t)) return true;
    if (t === 'string' || t === 'bool') return true;
    if (typeof t === 'object') {
      if (t.kind === 'struct' || t.kind === 'pointer' || t.kind === 'dynarray' || t.kind === 'function') return true;
    }
    return false;
  }

  private analyzePattern(pattern: PatternNode, targetType: MathType): void {
    const t = this.resolveType(targetType);

    switch (pattern.kind) {
      case 'wildcard':
        return;

      case 'const': {
        if (pattern.type === 'null') {
          if (!(typeof t === 'object' &&
                (t.kind === 'pointer' || t.kind === 'struct' ||
                 t.kind === 'dynarray' || t.kind === 'function'))) {
            this.error(`Patrón null no válido para tipo ${this.typeName(t)}`);
          }
          return;
        }
        if (!isArithmeticType(t)) {
          this.error(`Patrón numérico no válido para tipo ${this.typeName(t)}`);
          return;
        }
        return;
      }

      case 'string':
        if (t !== 'string') {
          this.error(`Patrón string no válido para tipo ${this.typeName(t)}`);
        }
        return;

      case 'bool':
        if (t !== 'bool') {
          this.error(`Patrón bool no válido para tipo ${this.typeName(t)}`);
        }
        return;

      case 'struct': {
        if (typeof t !== 'object' || t.kind !== 'struct') {
          this.error(`Patrón struct no válido para tipo ${this.typeName(t)}`);
          return;
        }
        if (t.name !== pattern.structName) {
          this.error(`Patrón struct '${pattern.structName}' no coincide con '${t.name}'`);
          return;
        }
        const provided = new Set(pattern.fields.map(f => f.name));
        for (const fp of pattern.fields) {
          const field = t.fields.find(f => f.name === fp.name);
          if (!field) {
            this.error(`Campo '${fp.name}' no existe en '${t.name}'`);
            continue;
          }
          this.analyzePattern(fp.pattern, field.type);
        }
        const missing = t.fields.filter(f => !provided.has(f.name)).map(f => f.name);
        if (missing.length > 0) {
          this.error(
            `Faltan campos en patrón '${t.name}': ${missing.join(', ')}. ` +
            `Usa '_' como wildcard para los que no te importan.`
          );
        }
        return;
      }
    }
  }

  public analyzeExpression(node: MathNode): MathType {
    switch (node.kind) {

      case 'const': return node.type === 'null' ? 'null' : node.type;

      case 'variable': {
        let lookup: { info: SymbolInfo; isCapture: boolean };
        try {
          lookup = this.scopeControl.lookupWithBoundary(node.name);
        } catch (e) {
          this.error(`Identificador no definido: '${node.name}'`);
          node.type = 's32';
          return 's32';
        }
        const { info: symbol, isCapture } = lookup;

        if (symbol.isFunctionDecl) {
          const ovs = symbol.overloads!;
          if (ovs.length !== 1) {
            this.error(`'${node.name}' tiene ${ovs.length} sobrecargas; especifica los tipos para usarla como valor`);
            node.type = 's32';
            return 's32';
          }
          (node as any).kind = 'function_ref';
          (node as any).name = ovs[0].mangledName;
          (node as any).type = ovs[0].type;
          delete (node as any).isGlobal;
          delete (node as any).uniqueName;
          return ovs[0].type;
        }

        if (isCapture && !symbol.isGlobal && this.captureStack.length > 0) {
          const frame = this.captureStack[this.captureStack.length - 1];
          let cap = frame.captures.get(symbol.uniqueName);
          if (!cap) {
            cap = {
              name: node.name,
              sourceUniqueName: symbol.uniqueName,
              type: symbol.type,
              index: frame.captures.size,
              boxed: !!symbol.boxed,
            };
            frame.captures.set(symbol.uniqueName, cap);
          }
          (node as any).kind = 'capture_access';
          (node as any).captureIndex = cap.index;
          (node as any).type = cap.type;
          delete (node as any).name;
          delete (node as any).uniqueName;
          delete (node as any).isGlobal;
          return cap.type;
        }

        (node as any).uniqueName = symbol.uniqueName;
        (node as any).isGlobal = symbol.isGlobal;
        if (symbol.boxed) (node as any).boxed = true;
        node.type = symbol.type;
        return node.type;
      }

      case 'string': return 'string';
      case 'bool': return 'bool';

      case 'capture_access':
        return node.type;

      case 'unary': {
        const operandType = this.analyzeExpression(node.operand);
        if (node.op === 'not' && operandType !== 'bool') {
          this.error("El operador '!' requiere un bool");
        }
        if (node.op === 'bitnot' && !isIntegerType(operandType)) {
          this.error("El operador '~' requiere un tipo entero");
        }
        if (node.op === 'neg' && !isArithmeticType(operandType)) {
          this.error("La negación requiere un tipo numérico");
        }
        node.type = operandType;
        return operandType;
      }

      case 'binary': {
        const leftType = this.analyzeExpression(node.left);
        const rightType = this.analyzeExpression(node.right);
        const result = this.inferBinaryType(node.op, leftType, rightType);
        node.type = result;
        return result;
      }

      case 'cast': {
        const from = this.resolveType(this.analyzeExpression(node.operand));
        node.oldType = from;
        const to = this.resolveType(node.newType);
        if (this.typesEqual(from, to)) return to;
        const stringBridge =
          (from === 'string' && (to === 's32' || to === 'u32')) ||
          (to === 'string' && (from === 's32' || from === 'u32'));
        if (stringBridge) return to;
        const boolBridge =
          (from === 'bool' && (to === 's32' || to === 'u32')) ||
          (to === 'bool' && (from === 's32' || from === 'u32'));
        if (boolBridge) return to;
        if (isArithmeticType(from) && isArithmeticType(to)) return to;
        if (typeof from === 'object' && from.kind ==='struct' &&  this._structCache.has(from.name) && (to === 's32')) return to;
        if ((from === 's32') &&  typeof to === 'object' && to.kind === 'struct' && this._structCache.has(to.name)) return to; 
        //if ((from === 's32') &&  typeof to === 'object' && to.kind === 'dynarray') return to; 
        if ((to === 's32') &&  typeof from === 'object' && from.kind === 'dynarray') return to; 

        this.error(`cast no soportado: ${this.typeName(from)} → ${this.typeName(to)}`);
        return to;
      }

      case 'make_array': {
        const n = node as MakeArrayNode;
        const resolvedType = this.resolveType(n.typeExpr);
        if (typeof resolvedType !== 'object' || resolvedType.kind !== 'dynarray') {
          this.error(
            `make() requiere un dynarray, se obtuvo ${this.typeName(resolvedType)}`
          );
          return 's32';
        }
        const lenType = this.analyzeExpression(n.lengthExpr);
        if (lenType !== 's32' && lenType !== 'u32') {
          this.error('make() requiere longitud entera');
        }
        n.elementType = resolvedType.elementType;
        n.type = resolvedType;
        return resolvedType;
      }

      case 'call': {
        if (node.name === 'is_same' && node.args.length === 2 && !this.scopeControl.has('is_same')) {
          const at1 = this.resolveType(this.analyzeExpression(node.args[0]));
          const at2 = this.resolveType(this.analyzeExpression(node.args[1]));

          if (at1 === 'null' && at2 === 'null') {
            node.paramTypes = ['null', 'null'];
            node.type = 'bool';
            node.resolvedBuiltin = 'is_same';
            return 'bool';
          }

          let common: MathType;
          if (at1 === 'null') common = at2;
          else if (at2 === 'null') common = at1;
          else if (this.typesEqual(at1, at2)) common = at1;
          else {
            this.error(
              `is_same: los dos args deben ser del mismo tipo ` +
              `(${this.typeName(at1)} vs ${this.typeName(at2)})`
            );
            return 's32';
          }

          const isRef = typeof common === 'string'
            ? (common === 'string')
            : (common.kind === 'struct' || common.kind === 'pointer' ||
               common.kind === 'dynarray' || common.kind === 'function');
          if (!isRef) {
            this.error(
              `is_same requiere un tipo referencia (struct, pointer, ` +
              `dynarray, string, fn); se obtuvo ${this.typeName(common)}. ` +
              `Usa '==' para primitivos.`
            );
            return 's32';
          }

          node.paramTypes = [common, common];
          node.type = 'bool';
          node.resolvedBuiltin = 'is_same';
          return 'bool';
        }
        if (node.name === 'len' && node.args.length === 1 && !this.scopeControl.has('len')) {
          const at = this.resolveType(this.analyzeExpression(node.args[0]));
          if (typeof at !== 'object' || (at.kind !== 'array' && at.kind !== 'dynarray')) {
            this.error(`len() requiere un array/dynarray, se obtuvo ${this.typeName(at)}`);
            return 's32';
          }
          node.paramTypes = [at];
          node.type = 's32';
          node.resolvedBuiltin = { kind: 'len', argumentType: at };
          return 's32';
        }

        const argTypes: MathType[] = [];
        for (const arg of node.args) argTypes.push(this.resolveType(this.analyzeExpression(arg)));

        if (!this.scopeControl.has(node.name)) {
          this.error(`Identificador no definido: '${node.name}'`);
          return 's32';
        }
        const sym = this.scopeControl.lookup(node.name);

        if (sym.isFunctionDecl) {
          const overloads = sym.overloads!;
          let chosen: FunctionOverload | undefined;
          for (const ov of overloads) if (this.argTypesMatchExact(ov.type.paramTypes, argTypes)) { chosen = ov; break; }
          if (!chosen) for (const ov of overloads) if (this.argTypesMatchWithBridge(ov.type.paramTypes, argTypes)) { chosen = ov; break; }
          if (!chosen) {
            this.error(
              `Ninguna sobrecarga de '${node.name}' coincide con ` +
              `[${argTypes.map(t => this.typeName(t)).join(', ')}]`
            );
            return 's32';
          }
          for (let i = 0; i < argTypes.length; i++) {
            const at = argTypes[i];
            const et = this.resolveType(chosen.type.paramTypes[i]);
            const bridge =
              (at === 'string' && (et === 's32' || et === 'u32')) ||
              (et === 'string' && (at === 's32' || at === 'u32'));
            if (!this.isAssignableType(at, et) && !bridge) {
              this.error(
                `Argumento ${i} de '${node.name}': se esperaba ` +
                `${this.typeName(et)}, se obtuvo ${this.typeName(at)}`
              );
            }
          }
          node.name = chosen.mangledName;
          node.paramTypes = chosen.type.paramTypes;
          node.returnTypes = chosen.type.returnTypes;
          const returnType = chosen.type.returnTypes[0];
          if (returnType === undefined) { node.type = 'void'; return 's32'; }
          node.type = returnType;
          return returnType;
        }

        if (typeof sym.type === 'object' && sym.type.kind === 'function') {
          const calleeVar: MathNode = { kind: 'variable', name: node.name, type: 's32' };
          const calleeType = this.resolveType(this.analyzeExpression(calleeVar)) as FunctionType;
          const params = calleeType.paramTypes.map(t => this.resolveType(t));
          if (argTypes.length !== params.length) {
            this.error(
              `Llamada indirecta a '${node.name}': se esperaban ${params.length} ` +
              `args, se recibieron ${argTypes.length}`
            );
            return 's32';
          }
          for (let i = 0; i < argTypes.length; i++) {
            const at = argTypes[i]; const et = params[i];
            const bridge =
              (at === 'string' && (et === 's32' || et === 'u32')) ||
              (et === 'string' && (at === 's32' || at === 'u32'));
            if (!this.isAssignableType(at, et) && !bridge) {
              this.error(
                `Argumento ${i} de la llamada indirecta a '${node.name}': ` +
                `se esperaba ${this.typeName(et)}, se obtuvo ${this.typeName(at)}`
              );
            }
          }
          const c = node as any;
          c.kind = 'call_indirect';
          c.callee = calleeVar;
          c.paramTypes = calleeType.paramTypes;
          c.returnTypes = calleeType.returnTypes;
          const returnType = calleeType.returnTypes[0];
          delete c.name;
          if (returnType === undefined) { c.type = 'void'; return 's32'; }
          c.type = returnType;
          return returnType;
        }
        this.error(`'${node.name}' no es una función`);
        return 's32';
      }

      case 'call_indirect': {
        if (node.callee.kind === 'struct_access') {
          const sa = node.callee as StructAccessNode;
          const baseTypeRaw = this.resolveType(this.analyzeExpression(sa.base));
          const baseType = typeof baseTypeRaw === 'object' && baseTypeRaw.kind === 'pointer'
            ? this.resolveType(baseTypeRaw.targetType)
            : baseTypeRaw;

          if (typeof baseType === 'object' && baseType.kind === 'struct' && baseType.name !== '') {
            const field = baseType.fields.find(c => c.name === sa.fieldName);
            if (!field) {
              const method = this.lookupMethod(baseType.name, sa.fieldName);
              if (method) {
                const argTypes: MathType[] = [];
                for (const arg of node.args) {
                  argTypes.push(this.resolveType(this.analyzeExpression(arg)));
                }
                const expected = method.type.paramTypes.slice(1);

                if (argTypes.length !== expected.length) {
                  this.error(
                    `Método '${sa.fieldName}' de '${baseType.name}': ` +
                    `se esperaban ${expected.length} argumentos, ` +
                    `se recibieron ${argTypes.length}`
                  );
                  return 's32';
                }
                for (let i = 0; i < argTypes.length; i++) {
                  if (!this.isAssignableType(argTypes[i], expected[i])) {
                    this.error(
                      `Argumento ${i} de '${sa.fieldName}': se esperaba ` +
                      `${this.typeName(expected[i])}, se obtuvo ${this.typeName(argTypes[i])}`
                    );
                  }
                }

                const newCall: any = node;
                newCall.kind = 'call';
                newCall.name = method.mangledName;
                newCall.args = [sa.base, ...node.args];
                newCall.paramTypes = method.type.paramTypes;
                newCall.returnTypes = method.type.returnTypes;
                newCall.type = method.type.returnTypes[0] ?? 'void';
                return newCall.type;
              }

              this.error(`Campo '${sa.fieldName}' no existe en '${baseType.name}'`);
              return 's32';
            }
          }
        }

        const calleeType = this.resolveType(this.analyzeExpression(node.callee));
        if (typeof calleeType !== 'object' || calleeType.kind !== 'function') {
          this.error('call_indirect: el callee no es de tipo función');
          return 's32';
        }
        const fnType = calleeType as FunctionType;
        const params = fnType.paramTypes.map(t => this.resolveType(t));

        if (node.args.length !== params.length) {
          this.error(
            `Llamada indirecta: se esperaban ${params.length} argumentos, ` +
            `se recibieron ${node.args.length}`
          );
          return 's32';
        }

        for (let i = 0; i < node.args.length; i++) {
          const at = this.resolveType(this.analyzeExpression(node.args[i]));
          const et = params[i];
          const bridge =
            (at === 'string' && (et === 's32' || et === 'u32')) ||
            (et === 'string' && (at === 's32' || at === 'u32'));
          if (!this.isAssignableType(at, et) && !bridge) {
            this.error(
              `Argumento ${i} de la llamada indirecta: se esperaba ` +
              `${this.typeName(et)}, se obtuvo ${this.typeName(at)}`
            );
          }
        }

        node.paramTypes = fnType.paramTypes;
        node.returnTypes = fnType.returnTypes;
        const returnType = fnType.returnTypes[0];
        if (returnType === undefined) { node.type = 'void'; return 's32'; }
        node.type = returnType;
        return returnType;
      }

      case 'function_literal': {
        const fnNode = node as FunctionLiteralNode;

        const paramTypes = fnNode.params.map(p => this.resolveType(p.type));
        const returnTypes = fnNode.returnTypes
          ? fnNode.returnTypes.map(t => this.resolveType(t))
          : [];
        const fnType: FunctionType = { kind: 'function', paramTypes, returnTypes };

        const name = `__lambda_${this.lambdaCounter++}`;
        this.scopeControl.declareFunction(name, name, fnType, false);

        const prevReturn = this.currentReturnTypes;
        const prevLevel = this.currentLevel;
        this.currentReturnTypes = returnTypes;

        const frame: CaptureFrame = { captures: new Map() };
        this.captureStack.push(frame);
        this.scopeControl.pushLambdaBoundary();
        this.scopeControl.pushScope();

        for (const p of fnNode.params) {
          const uniqueName = this.scopeControl.declare(p.name, this.resolveType(p.type), true, false);
          p.uniqueName = uniqueName;
          this.slotLevels.set(uniqueName, prevLevel);
        }
        for (const s of fnNode.body) this.analyzeStatement(s as StatementNode);

        this.scopeControl.popScope();
        this.scopeControl.popLambdaBoundary();
        this.captureStack.pop();

        if (fnNode.returnTypes.length > 0 && !this.allPathsReturn(fnNode.body as StatementNode[])) {
          this.error(
            `La lambda '${name}' no retorna en todos los caminos ` +
            `(se esperaba${returnTypes.length > 1 ? 'n ' : ' '}` +
            `${returnTypes.map(t => this.typeName(t)).join(', ')})`
          );
        }

        this.currentReturnTypes = prevReturn;
        this.currentLevel = prevLevel;

        this.hoistedFunctions.push({
          kind: 'function_def',
          name,
          params: fnNode.params,
          returnTypes: fnNode.returnTypes,
          body: fnNode.body as StatementNode[],
          mangledName: name,
        });

        const captures: CapturedVar[] = [];
        for (const cap of frame.captures.values()) captures.push(cap);
        captures.sort((a, b) => a.index - b.index);

        const captureExprs: MathNode[] = captures.map(cap => ({
          kind: 'variable',
          name: cap.name,
          uniqueName: cap.sourceUniqueName,
          isGlobal: false,
          type: cap.type,
        } as VariableNode));

        (node as any).kind = 'closure';
        (node as any).codeName = name;
        (node as any).captures = captures;
        (node as any).captureExprs = captureExprs;
        (node as any).type = fnType;
        delete (node as any).params;
        delete (node as any).returnTypes;
        delete (node as any).body;

        return fnType;
      }

      case 'closure':
        return node.type;

      case 'struct_literal': {
        const structName = (node as any).structName as string;

        if (structName === '__anon') {
          const inferredFields: { name: string; type: MathType }[] = [];
          const provided = new Set<string>();
          for (const field of node.fields) {
            if (provided.has(field.name)) {
              this.error(`Campo '${field.name}' repetido en struct anónimo`);
              continue;
            }
            provided.add(field.name);
            const t = this.resolveType(this.analyzeExpression(field.value));
            inferredFields.push({ name: field.name, type: t });
          }
          const canonical = this.canonicalizeAnonStruct(inferredFields);
          (node as any).structName = canonical;
          const st = this.structTypeFromRegistry(canonical);
          node.type = st;
          return st;
        }

        const structType = this.structTypeFromRegistry(structName);
        const providedFields = new Set<string>();
        for (const field of node.fields) {
          if (providedFields.has(field.name)) {
            this.error(`Campo '${field.name}' repetido en '${structName}'`);
            continue;
          }
          providedFields.add(field.name);
          const expectedField = structType.fields.find(c => c.name === field.name);
          if (!expectedField) {
            this.error(`Campo '${field.name}' no existe en '${structName}'`);
            continue;
          }
          const actualType = this.resolveType(this.analyzeExpression(field.value));
          if (!this.isAssignableType(actualType, expectedField.type)) {
            if (!(actualType === 'null' && typeof expectedField.type !== 'string')) {
              this.error(
                `Tipo incorrecto para '${structName}.${field.name}': ` +
                `se esperaba ${this.typeName(expectedField.type)}, ` +
                `se obtuvo ${this.typeName(actualType)}`
              );
            }
          }
        }
        const missing = structType.fields.filter(f => !providedFields.has(f.name)).map(f => f.name);
        if (missing.length > 0) {
          this.error(`Faltan campos en '${structName}': ${missing.join(', ')}`);
        }
        node.type = structType;
        return structType;
      }

      case 'struct_access': {
        const expressionType = this.resolveType(this.analyzeExpression(node.base));
        const baseType = typeof expressionType === 'object' && expressionType.kind === 'pointer'
          ? this.resolveType(expressionType.targetType) : expressionType;
        if (typeof baseType !== 'object' || baseType.kind !== 'struct') {
          this.error(
            `No se puede acceder al campo '${node.fieldName}' en un valor ` +
            `de tipo ${this.typeName(baseType)}`
          );
          node.type = 's32';
          return 's32';
        }

        //console.log(baseType)

        const field = baseType.fields.find(c => c.name === node.fieldName);
        if (field) {
          node.resolvedBaseType = baseType;
          node.resolvedField = field;
          node.type = this.resolveType(field.type);
          return node.type;
        }

        if (baseType.name !== '') {
          const method = this.lookupMethod(baseType.name, node.fieldName);
          if (method) {
            return this.buildMethodValue(node, baseType, method);
          }
        }
        this.error(`Campo '${node.fieldName}' no existe en '${baseType.name}'`);
        node.type = 's32';
        return 's32';
      }

      case 'array_literal': {
        let elemType: MathType = 's32';
        if (node.elements.length > 0) elemType = this.resolveType(this.analyzeExpression(node.elements[0]));
        for (let i = 1; i < node.elements.length; i++) {
          const t = this.resolveType(this.analyzeExpression(node.elements[i]));
          if (!this.typesEqual(t, elemType)) {
            this.error(
              `Array literal: elemento ${i} tiene tipo ${this.typeName(t)}, ` +
              `esperado ${this.typeName(elemType)}`
            );
          }
        }
        node.type = { kind: 'array', elementType: elemType, length: node.elements.length };
        return node.type;
      }

      case 'array_access': {
        const baseType = this.resolveType(this.analyzeExpression(node.base));
        if (typeof baseType !== 'object' ||
            (baseType.kind !== 'array' && baseType.kind !== 'dynarray')) {
          this.error('array_access sobre no-array');
          node.type = 's32';
          return 's32';
        }
        const indexType = this.resolveType(this.analyzeExpression(node.index));
        if (indexType !== 's32' && indexType !== 'u32') {
          this.error(`El índice del array debe ser s32 o u32, se obtuvo ${this.typeName(indexType)}`);
        }
        node.arrayType = baseType;
        node.dynamic = baseType.kind === 'dynarray';
        node.type = baseType.elementType;
        return node.type;
      }

      case 'increment': {
        const increment = node as any;
        const operand = increment.operand as MathNode;
        const operandType = this.resolveType(this.analyzeExpression(operand));
        let root: any = operand;
        while (root.kind === 'struct_access' || root.kind === 'array_access') root = root.base;
        if (root.kind === 'capture_access') {
          // OK
        } else {
          if (root.kind !== 'variable') {
            this.error(`El operando de '${increment.operator}' debe ser modificable`);
            increment.type = 's32';
            return 's32';
          }
          this.scopeControl.checkMutable(root.name);
        }
        if (!isArithmeticType(operandType)) {
          this.error(
            `El operador '${increment.operator}' requiere un tipo numérico; ` +
            `se obtuvo ${this.typeName(operandType)}`
          );
          increment.type = 's32';
          return 's32';
        }
        increment.type = operandType;
        return operandType;
      }

      case 'size_of': {
        const s = node as SizeOfNode;
        let size = 0;

        if (s.identName) {
          if (this.scopeControl.has(s.identName) && !this.typeRegistry.hasType(s.identName)) {
            const sym = this.scopeControl.lookup(s.identName);
            const resolvedType = this.resolveType(sym.type);
            size = this.computeTypeSize(resolvedType);
          } else if (this.typeRegistry.hasType(s.identName)) {
            size = this.typeRegistry.getSize(s.identName);
          } else if (this.typeAliases.has(s.identName)) {
            const resolvedType = this.resolveType(this.typeAliases.get(s.identName)!);
            size = this.computeTypeSize(resolvedType);
          } else if (this.scopeControl.has(s.identName)) {
            const sym = this.scopeControl.lookup(s.identName);
            const resolvedType = this.resolveType(sym.type);
            size = this.computeTypeSize(resolvedType);
          } else {
            this.error(`Identificador o tipo no definido: '${s.identName}'`);
            node.type = 's32';
            return 's32';
          }
        } else if (s.targetType) {
          const resolvedType = this.resolveType(s.targetType);
          size = this.computeTypeSize(resolvedType, s.identName);
        } else if (s.expr) {
          const resolvedType = this.resolveType(this.analyzeExpression(s.expr));
          size = this.computeTypeSize(resolvedType);
        } else {
          this.error('size_of requiere un tipo o una expresión válida');
          node.type = 's32';
          return 's32';
        }

        s.value = size;
        s.type = 's32';

        (node as any).kind = 'const';
        (node as any).type = 's32';
        (node as any).value = size;
        return 's32';
      }

      default: return 's32';
    }
  }

  private computeTypeSize(t: MathType, identName?: string): number {
    if (identName && this.typeRegistry.hasType(identName)) {
      return this.typeRegistry.getSize(identName);
    }
    if (t === 'null' || t === 'tuple') return 4;
    if (typeof t === 'string') {
      switch (t) {
        case 's32': case 'u32': case 'f32': case 'string': return 4;
        case 's64': case 'u64': case 'f64': return 8;
        case 'bool': return 1;
        default: {
          if (this.typeRegistry.hasType(t)) {
            return this.typeRegistry.getSize(t);
          }
          return 4;
        }
      }
    }
    if (t.kind === 'pointer' || t.kind === 'dynarray' || t.kind === 'function') {
      return 4;
    }
    if (t.kind === 'array') {
      return this.computeTypeSize(t.elementType) * t.length;
    }
    if (t.kind === 'struct') {
      if (t.size > 0) return t.size;
      if (t.name && this.typeRegistry.hasType(t.name)) {
        return this.typeRegistry.getSize(t.name);
      }
      if (t.fields && t.fields.length > 0) {
        const layout = computeStructLayout(
          this.typeRegistry,
          t.fields.map(f => ({
            name: f.name,
            type: this.registryTypeName(f.type),
            mathType: f.type,
          }))
        );
        return layout.size;
      }
      return 0;
    }
    return 4;
  }

  private buildMethodValue(
    node: StructAccessNode,
    receiverType: StructType,
    method: FunctionOverload,
  ): MathType {
    const fullFnType = method.type;
    const valueParams = fullFnType.paramTypes.slice(1);
    const returnTypes = fullFnType.returnTypes;

    const thunkName = `__lambda_${this.lambdaCounter++}`;
    const baseExpr = node.base;

    const selfRef: CaptureAccessNode = {
      kind: 'capture_access',
      captureIndex: 0,
      type: receiverType,
    };

    const paramNames = valueParams.map((_, i) => `a${i}`);
    const paramUniqueNames = paramNames.map(
      n => `$${n}_${this.syntheticCounter++}`
    );

    const paramRefs: MathNode[] = paramNames.map((n, i) => ({
      kind: 'variable',
      name: n,
      uniqueName: paramUniqueNames[i],
      isGlobal: false,
      type: valueParams[i],
    } as VariableNode));

    const innerCall: CallNode = {
      kind: 'call',
      name: method.mangledName,
      args: [selfRef, ...paramRefs],
      paramTypes: fullFnType.paramTypes,
      returnTypes: fullFnType.returnTypes,
      type: returnTypes[0] ?? 'void',
    };

    const thunkBody: StatementNode[] = returnTypes.length > 0
      ? [{ kind: 'return', values: [innerCall] }]
      : [{ kind: 'expression_stmt', expr: innerCall }];

    const thunkFn: FunctionDefNode = {
      kind: 'function_def',
      name: thunkName,
      params: valueParams.map((t, i) => ({
        name: paramNames[i],
        type: t,
        uniqueName: paramUniqueNames[i],
      })),
      returnTypes: returnTypes,
      body: thunkBody,
      mangledName: thunkName,
    };

    this.hoistedFunctions.push(thunkFn);

    const valueFnType: FunctionType = {
      kind: 'function',
      paramTypes: valueParams,
      returnTypes,
    };

    (node as any).kind = 'closure';
    (node as any).codeName = thunkName;
    (node as any).captures = [{
      name: 'self',
      sourceUniqueName: 'method_value_self',
      type: receiverType,
      index: 0,
    }];
    (node as any).captureExprs = [baseExpr];
    (node as any).type = valueFnType;

    delete (node as any).fieldName;
    delete (node as any).resolvedBaseType;

    return valueFnType;
  }

  private canonicalizeAnonStruct(fields: { name: string; type: MathType }[]): string {
    const key = fields.map(f => `${f.name}:${mangleType(f.type)}`).join(';');
    let canonical = this.anonStructs.get(key);
    if (canonical) return canonical;

    canonical = `__anon_${this.anonStructCounter++}`;
    this.anonStructs.set(key, canonical);

    this.typeRegistry.registerStruct(
      canonical,
      fields.map(f => {
        const regName = this.registryTypeName(f.type);
        if (typeof f.type === 'object' && f.type.kind === 'function') {
          return { name: f.name, type: regName, mathType: f.type };
        }
        return { name: f.name, type: regName };
      })
    );
    return canonical;
  }

  private argTypesMatchExact(params: MathType[], args: MathType[]): boolean {
    if (params.length !== args.length) return false;
    for (let i = 0; i < params.length; i++) {
      if (!this.isAssignableType(this.resolveType(args[i]), this.resolveType(params[i]))) return false;
    }
    return true;
  }

  private argTypesMatchWithBridge(params: MathType[], args: MathType[]): boolean {
    if (params.length !== args.length) return false;
    for (let i = 0; i < params.length; i++) {
      const p = this.resolveType(params[i]);
      const a = this.resolveType(args[i]);
      if (this.isAssignableType(a, p)) continue;
      const bridge =
        (a === 'string' && (p === 's32' || p === 'u32')) ||
        (p === 'string' && (a === 's32' || a === 'u32'));
      if (!bridge) return false;
    }
    return true;
  }

  private inferBinaryType(op: string, leftType: MathType, rightType: MathType): MathType {
    if ((leftType === 'null' || rightType === 'null') && (op === '==' || op === '!=')) return 'bool';

    if (typeof leftType === 'object' && leftType.kind === 'struct'
        && typeof rightType === 'object' && rightType.kind === 'struct'
        && this.typesEqual(leftType, rightType)
        && (op === '==' || op === '!=')) {
      if (!supportsStructuralEquality(leftType)) {
        this.error(
          `La comparación estructural de '${leftType.name || '(anónimo)'}' ` +
          `contiene campos cuyo tipo no es comparable`
        );
      }
      return 'bool';
    }

    if (leftType === 'bool' && rightType === 'bool') {
      if (['&&', '||', '==', '!='].includes(op)) return 'bool';
      this.error(`Operador '${op}' no permitido entre booleanos`);
      return 'bool';
    }
    if (leftType === 'string' && rightType === 'string') {
      if (['==', '!=', '<', '<=', '>', '>='].includes(op)) return 'bool';
      if (leftType === 'string' && op === '+') return 'string';
      this.error(`Operador '${op}' no permitido entre ${this.typeName(leftType)} y ${this.typeName(rightType)}`);
      return 's32';
    }
    const arithOps = new Set(['+', '-', '*', '/', '%', '&', '|', '^', '<<', '>>', '==', '!=', '<', '<=', '>', '>=']);
    if (arithOps.has(op) && isArithmeticType(leftType) && isArithmeticType(rightType)) {
      if (op === '%' && (!isIntegerType(leftType) || !isIntegerType(rightType))) {
        this.error('El operador % requiere operandos enteros');
        return 's32';
      }
      if (['&', '|', '^', '<<', '>>'].includes(op) &&
          (!isIntegerType(leftType) || !isIntegerType(rightType))) {
        this.error(`El operador '${op}' requiere operandos enteros`);
        return 's32';
      }
      if (['==', '!=', '<', '<=', '>', '>='].includes(op)) return 'bool';
      return maxArithmeticType(leftType, rightType);
    }
    this.error(
      `Operación '${op}' no permitida entre ${this.typeName(leftType)} y ${this.typeName(rightType)}`
    );
    return 's32';
  }

  private registryTypeName(type: MathType, seen?: Set<string>): string {
    if (typeof type === 'object' && type.kind === 'struct') {
      const alias = this.typeAliases.get(type.name);
      if (alias !== undefined) {
        const s = seen ?? new Set<string>();
        if (s.has(type.name)) {
          throw new Error(
            `Ciclo de alias detectado: ${[...s, type.name].join(' → ')}`
          );
        }
        s.add(type.name);
        return this.registryTypeName(alias, s);
      }
    }

    if (typeof type !== 'object') {
      if (type === 's32') return 'i32';
      if (type === 's64') return 'i64';
      return type;
    }
    if (type.kind === 'struct') {
      if (type.name === '') {
        return this.canonicalizeAnonStruct(
          type.fields.map(f => ({ name: f.name, type: this.resolveType(f.type) }))
        );
      }
      return type.name;
    }
    if (type.kind === 'pointer') return `${this.registryTypeName(type.targetType, seen)}*`;
    if (type.kind === 'function') return 'i32';
    if (type.kind === 'dynarray') {
      const elemName = this.registryTypeName(type.elementType, seen);
      const dynName = `[]${elemName}`;
      if (!this.typeRegistry.hasType(dynName)) {
        this.typeRegistry.registerPrimitive(dynName, 4, 4);
      }
      return dynName;
    }
    if (type.kind === 'array') {
      const elemName = this.registryTypeName(type.elementType, seen);
      const arrayName = `[${elemName};${type.length}]`;
      if (!this.typeRegistry.hasType(arrayName)) {
        this.typeRegistry.registerArray(arrayName, elemName, type.length);
      }
      return arrayName;
    }
    throw new Error(`Tipo no compatible con campos de struct: ${this.typeName(type)}`);
  }

  private resolveType(type: MathType, seen?: Set<string>): MathType {
    if (typeof type !== 'object') return type;

    if (type.kind === 'struct') {
      const rawTarget = this.typeAliases.get(type.name);
      if (rawTarget !== undefined) {
        const s = seen ?? new Set<string>();
        if (s.has(type.name)) {
          throw new Error(
            `Ciclo de alias detectado: ${[...s, type.name].join(' → ')}`
          );
        }
        s.add(type.name);
        return this.resolveType(rawTarget, s);
      }

      if (type.name === '') {
        const normalized = type.fields.map(f => ({
          name: f.name,
          type: this.resolveType(f.type, seen),
        }));
        const canonical = this.canonicalizeAnonStruct(normalized);
        return this.structTypeFromRegistry(canonical);
      }

      return this.structTypeFromRegistry(type.name);
    }

    if (type.kind === 'array') {
      const elem = this.resolveType(type.elementType, seen);
      if (elem === type.elementType) return type;
      return { kind: 'array', elementType: elem, length: type.length };
    }
    if (type.kind === 'dynarray') {
      const elem = this.resolveType(type.elementType, seen);
      if (elem === type.elementType) return type;
      return { kind: 'dynarray', elementType: elem };
    }
    if (type.kind === 'pointer') {
      const target = this.resolveType(type.targetType, seen);
      if (target === type.targetType) return type;
      return { kind: 'pointer', targetType: target };
    }
    if (type.kind === 'function') {
      return {
        kind: 'function',
        paramTypes: type.paramTypes.map(t => this.resolveType(t, seen)),
        returnTypes: type.returnTypes.map(t => this.resolveType(t, seen)),
      };
    }
    return type;
  }

  private structTypeFromRegistry(name: string): StructType {
    const cached = this._structCache.get(name);
    if (cached) return cached;
    const info = this.typeRegistry.getType(name);
    if (info.kind !== 'struct') throw new Error(`'${name}' no es un struct`);
    const st: StructType = { kind: 'struct', name, size: info.size, align: info.align, fields: [] };
    this._structCache.set(name, st);
    for (const field of info.fields ?? []) {
      st.fields.push({
        name: field.name,
        type: field.mathType ?? this.mathTypeFromRegistryName(field.type),
        offset: field.offset,
      });
    }
    return st;
  }

  private mathTypeFromRegistryName(name: string): MathType {
    switch (name) {
      case 'int':
      case 'i32': return 's32';
      case 'long':
      case 'i64': return 's64';
      case 'uint':
      case 'u32': return 'u32';
      case 'u64': return 'u64';
      case 'float':
      case 'f32': return 'f32';
      case 'double':
      case 'f64': return 'f64';
      case 'bool':
      case 'string': return name;
      case 'byte':
      case 'char':
      case 'i8':
      case 'u8':
      case 'i16':
      case 'u16': return 's32';
    }

    if (name.startsWith('[]')) {
      const elemName = name.slice(2);
      return { kind: 'dynarray', elementType: this.mathTypeFromRegistryName(elemName) };
    }

    if (name.startsWith('[') && name.endsWith(']')) {
      const inner = name.slice(1, -1);
      const semi = inner.lastIndexOf(';');
      if (semi === -1) throw new Error(`Nombre de array inválido: '${name}'`);
      const elemName = inner.slice(0, semi);
      const length = parseInt(inner.slice(semi + 1), 10);
      if (!Number.isInteger(length) || length <= 0) {
        throw new Error(`Longitud de array inválida en '${name}'`);
      }
      return { kind: 'array', elementType: this.mathTypeFromRegistryName(elemName), length };
    }

    const info = this.typeRegistry.getType(name);
    if (info.kind === 'struct') return this.structTypeFromRegistry(name);
    if (info.kind === 'array') {
      const elemName = info.elementType!;
      const length = info.length!;
      return { kind: 'array', elementType: this.mathTypeFromRegistryName(elemName), length };
    }
    if (info.pointerTo) {
      const targetName = info.pointerTo;
      const targetInfo = this.typeRegistry.getType(targetName);
      const targetType: MathType = targetInfo.kind === 'struct'
        ? { kind: 'struct', name: targetName, fields: [], size: targetInfo.size, align: targetInfo.align }
        : this.mathTypeFromRegistryName(targetName);
      return { kind: 'pointer', targetType };
    }
    throw new Error(`Tipo de campo no soportado: '${name}'`);
  }

  private typesEqual(left: MathType, right: MathType): boolean {
    return areTypesEqual(this.resolveType(left), this.resolveType(right));
  }

  private typeName(type: MathType): string {
    return describeType(type);
  }

  private contextualizeArrayLiteral(expr: MathNode, target: MathType): boolean {
    if (expr.kind !== 'array_literal' || typeof target !== 'object' ||
        (target.kind !== 'array' && target.kind !== 'dynarray')) return false;
    if (target.kind === 'array' && target.length !== expr.elements.length) return false;
    for (const element of expr.elements) {
      const targetElement = target.elementType;
      if (element.kind === 'array_literal' &&
          typeof targetElement === 'object' &&
          (targetElement.kind === 'array' || targetElement.kind === 'dynarray')) {
        if (!this.contextualizeArrayLiteral(element, targetElement)) return false;
        continue;
      }
      const actualType = this.resolveType((element as any).type as MathType);
      if (!this.isAssignableType(actualType, targetElement)) return false;
    }
    (expr as any).type = target;
    return true;
  }

  private isAssignableType(source: MathType, target: MathType): boolean {
    return areTypesAssignable(this.resolveType(source), this.resolveType(target));
  }
}
