import { ProgramNode, StatementNode, FunctionDefNode, ImportDeclNode } from './parser';
import {
  MathNode, MathType, FunctionType, StructType, TypeRegistry,
  FunctionLiteralNode, ClosureNode, CaptureAccessNode,
  CapturedVar, VariableNode, ArithmeticType, PatternNode,
  MakeArrayNode, CallNode, StructAccessNode,
} from './types';
import { mangleFunctionName, functionParamsEqual, mangleType } from './mangler';
import { arithInfo } from './typeSystem';

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
  private currentReturnType: MathType | null = null;
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

  constructor() {
    this.scopeControl = new ScopeControl();
    this.typeRegistry = new TypeRegistry();
    this.registerBuiltins();
  }

  private registerBuiltins(): void {
    const s32: MathType = 's32';
    const builtins: { name: string; params: MathType[]; ret: MathType | null }[] = [
      { name: 'arena_save',    params: [],              ret: s32 },
      { name: 'arena_restore', params: [s32],           ret: null },
      { name: 'arena_alloc',   params: [s32],           ret: s32 },
      { name: 'memcpy',        params: [s32, s32, s32], ret: null },
      { name: 'mem_read32',    params: [s32],           ret: s32 },
      { name: 'mem_write32',   params: [s32, s32],      ret: null },
      { name: 'mem_read8',     params: [s32],           ret: s32 },
      { name: 'mem_write8',    params: [s32, s32],      ret: null },
      { name: 'str_len',       params: ['string'],      ret: s32 },
      { name: 'str_concat',    params: ['string', 'string'], ret: 'string' },
      { name: 'str_eq',        params: ['string', 'string'], ret: 'bool' },
      { name: 'str_ne',        params: ['string', 'string'], ret: 'bool' },
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

  // ─── Escape analysis primitives ───────────────────────────────────

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
      throw new Error(
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

  // ─── Análisis de capturas (pre-pass) ──────────────────────────────

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
          declare(stmt.varName);
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
          if (stmt.value) visitExpr(stmt.value);
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

  // ─── Entrada ──────────────────────────────────────────────────────

  public analyzeProgram(program: ProgramNode): void {
    this.currentLevel = 0;
    this.hoistedFunctions = [];
    this.anonStructs.clear();
    this.anonStructCounter = 0;
    this.lambdaCounter = 0;
    this.captureStack = [];
    this.capturedNamesStack = [];
    this.methodsByStruct.clear();

    this.typeAliases.clear();
    this.collectTypeAliases(program.body);
    this.collectStructs(program.body);
    this.collectFunctions(program.body);

        for (const stmt of program.body) this.analyzeStatement(stmt);

    for (const h of this.hoistedFunctions) program.body.push(h);
    this.hoistedFunctions = [];
  }

  private collectTypeAliases(stmts: StatementNode[]): void {
    for (const s of stmts) {
      if (s.kind !== 'type_alias') continue;
      this.typeAliases.set(s.name, s.targetType);
    }
  } // (thunkFn as any).__analyzed = true;

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
          throw new Error(
            `Receiver de '${fn.name}' debe ser un struct, se obtuvo ${this.typeName(rt)}`
          );
        }
        if (rt.name === '') {
          throw new Error(`Receiver de '${fn.name}' no puede ser un struct anónimo`);
        }
        receiverType = rt;
      }

      const userParamTypes = fn.params.map(p => this.resolveType(p.type));
      const allParamTypes = receiverType
        ? [receiverType, ...userParamTypes]
        : userParamTypes;
      const returnTypes = fn.returnType === null
        ? []
        : [this.resolveType(fn.returnType)];
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

  // ─── Registro de métodos ──────────────────────────────────────────

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

  // ─── Statements ───────────────────────────────────────────────────

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
            throw new Error(
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

      case 'assign': {
        const targetType = this.resolveType(this.analyzeExpression(stmt.target));

        let root: any = stmt.target;
        while (root.kind === 'struct_access' || root.kind === 'array_access') {
          root = (root as any).base;
        }
        if (root.kind === 'capture_access') {
          // OK
        } else {
          if (root.kind !== 'variable') throw new Error('El destino no es modificable');
          this.scopeControl.checkMutable(root.name);
          const slotLvl = this.slotLevelOfTarget(stmt.target);
          this.checkEscape(stmt.expr, slotLvl, `asignación a '${root.name}'`);
        }

        const exprType = this.resolveType(this.analyzeExpression(stmt.expr));

        if (!this.isAssignableType(exprType, targetType)) {
          const contextualized = this.contextualizeArrayLiteral(stmt.expr, targetType);
          if (!contextualized && !(exprType === 'null' && typeof targetType !== 'string')) {
            throw new Error(
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
        if (condType !== 'bool') throw new Error('La condición del if debe ser bool');
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
          if (condType !== 'bool') throw new Error('La condición del for debe ser bool');
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
          throw new Error(`for ... in: se esperaba un array, se obtuvo ${this.typeName(iterableType)}`);
        }
        this.scopeControl.pushScope();
        const uniqueName = this.scopeControl.declare(stmt.varName, iterableType.elementType, true, false);
        (stmt as any).uniqueName = uniqueName;
        (stmt as any).elementType = iterableType.elementType;
        this.slotLevels.set(uniqueName, this.currentLevel);
        for (const s of stmt.body) this.analyzeStatement(s);
        this.scopeControl.popScope();
        break;
      }

      case 'switch': {
        const condType = this.resolveType(this.analyzeExpression(stmt.expr));
        stmt.exprType = condType;

        if (!this.isComparableType(condType)) {
          throw new Error(
            `switch: tipo no comparable (${this.typeName(condType)})`
          );
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
        const actualType = stmt.value
          ? this.resolveType(this.analyzeExpression(stmt.value))
          : null;

        if (this.currentReturnType === null) {
          if (actualType !== null) throw new Error('La función no debe retornar un valor');
        } else {
          if (actualType === null) throw new Error(`Se esperaba retornar ${this.typeName(this.currentReturnType)}`);
          if (!this.isAssignableType(actualType, this.currentReturnType)) {
            if (!(actualType === 'null' && typeof this.currentReturnType !== 'string')) {
              throw new Error(
                `Tipo de retorno incorrecto: se esperaba ${this.typeName(this.currentReturnType)}, ` +
                `se obtuvo ${this.typeName(actualType)}`
              );
            }
          }
        }

        if (stmt.value) this.checkEscape(stmt.value, 0, 'return');
        break;
      }

      case 'expression_stmt':
        this.analyzeExpression(stmt.expr);
        break;
    }
  }

  // ─── Función ──────────────────────────────────────────────────────

  private analyzeFunction(fn: FunctionDefNode): void {
    // 1. Resolver el receiver si existe.
    let receiverType: StructType | null = null;
    if (fn.receiver) {
      const rt = this.resolveType(fn.receiver);
      if (typeof rt !== 'object' || rt.kind !== 'struct') {
        throw new Error(
          `Receiver de '${fn.name}' debe ser un struct, se obtuvo ${this.typeName(rt)}`
        );
      }
      receiverType = rt;
    }

    // 2. Verificar que no haya un parámetro llamado `self`.
    if (receiverType) {
      for (const p of fn.params) {
        if (p.name === 'self') {
          throw new Error(
            `'self' está reservado como receiver en el método '${fn.name}'; ` +
            `renombrá el parámetro.`
          );
        }
      }
    }

    // 3. Calcular tipos completos (con receiver).
    const userParamTypes = fn.params.map(p => this.resolveType(p.type));
    const allParamTypes = receiverType
      ? [receiverType, ...userParamTypes]
      : userParamTypes;
    const returnTypes = fn.returnType === null
      ? []
      : [this.resolveType(fn.returnType)];
    const fnType: FunctionType = {
      kind: 'function',
      paramTypes: allParamTypes,
      returnTypes,
    };

    // 4. Mangled name.
    const sourceName = fn.name;
    const isLambda = sourceName.startsWith('__lambda_');
    const mangledName = isLambda
      ? sourceName
      : mangleFunctionName(sourceName, allParamTypes);

    // 5. Declarar en scopeControl (los métodos ya fueron declarados por collectFunctions).
    if (isLambda) {
      this.scopeControl.declareFunction(sourceName, mangledName, fnType, false);
    } else if (!receiverType) {
      this.scopeControl.declareFunction(
        sourceName, mangledName, fnType, this.scopeControl.isGlobal()
      );
    }
    (fn as any).mangledName = mangledName;

    // 6. Guardar estado.
    const prevReturn = this.currentReturnType;
    const prevLevel = this.currentLevel;
    this.currentReturnType = fn.returnType === null
      ? null
      : this.resolveType(fn.returnType);
    this.currentLevel = 0;

    this.scopeControl.pushScope();

    // 7. Prepender `self` a fn.params si es método.
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

    // 8. Analizar capturas (con self ya en params).
    const capturedNames = this.findCapturedVars(fn.params, fn.body);
    this.capturedNamesStack.push(capturedNames);

    // 9. Declarar params del usuario (saltando self).
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

    // 10. Analizar cuerpo.
    for (const stmt of fn.body) this.analyzeStatement(stmt);

    // 11. Verificar retorno en todos los caminos.
    if (fn.returnType !== null && !this.allPathsReturn(fn.body)) {
      throw new Error(
        `La función '${sourceName}' no retorna en todos los caminos ` +
        `(se esperaba ${this.typeName(this.currentReturnType!)})`
      );
    }

    // 12. Restaurar.
    this.currentReturnType = prevReturn;
    this.currentLevel = prevLevel;
    this.scopeControl.popScope();
    this.capturedNamesStack.pop();

    // 13. Renombrar al mangled final.
    fn.name = mangledName;
  }

  /** Tipos que se pueden usar como expr de un switch. */
  private isComparableType(t: MathType): boolean {
    if (this.isArithmetic(t)) return true;
    if (t === 'string' || t === 'bool') return true;
    if (typeof t === 'object') {
      if (t.kind === 'struct' || t.kind === 'pointer' || t.kind === 'dynarray' || t.kind === 'function') return true;
    }
    return false;
  }

  /** Verifica que un pattern sea válido para el tipo del switch. */
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
            throw new Error(`Patrón null no válido para tipo ${this.typeName(t)}`);
          }
          return;
        }
        if (!this.isArithmetic(t)) {
          throw new Error(
            `Patrón numérico no válido para tipo ${this.typeName(t)}`
          );
        }
        return;
      }

      case 'string':
        if (t !== 'string') {
          throw new Error(`Patrón string no válido para tipo ${this.typeName(t)}`);
        }
        return;

      case 'bool':
        if (t !== 'bool') {
          throw new Error(`Patrón bool no válido para tipo ${this.typeName(t)}`);
        }
        return;

      case 'struct': {
        if (typeof t !== 'object' || t.kind !== 'struct') {
          throw new Error(
            `Patrón struct no válido para tipo ${this.typeName(t)}`
          );
        }
        if (t.name !== pattern.structName) {
          throw new Error(
            `Patrón struct '${pattern.structName}' no coincide con '${t.name}'`
          );
        }
        const provided = new Set(pattern.fields.map(f => f.name));
        for (const fp of pattern.fields) {
          const field = t.fields.find(f => f.name === fp.name);
          if (!field) {
            throw new Error(`Campo '${fp.name}' no existe en '${t.name}'`);
          }
          this.analyzePattern(fp.pattern, field.type);
        }
        const missing = t.fields.filter(f => !provided.has(f.name)).map(f => f.name);
        if (missing.length > 0) {
          throw new Error(
            `Faltan campos en patrón '${t.name}': ${missing.join(', ')}. ` +
            `Usa '_' como wildcard para los que no te importan.`
          );
        }
        return;
      }
    }
  }

  // ─── Expresiones ──────────────────────────────────────────────────

  public analyzeExpression(node: MathNode): MathType {
    switch (node.kind) {

      case 'const': return node.type === 'null' ? 'null' : node.type;

      case 'variable': {
        const { info: symbol, isCapture } = this.scopeControl.lookupWithBoundary(node.name);

        if (symbol.isFunctionDecl) {
          const ovs = symbol.overloads!;
          if (ovs.length !== 1) {
            throw new Error(`'${node.name}' tiene ${ovs.length} sobrecargas; especifica los tipos para usarla como valor`);
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
          throw new Error("El operador '!' requiere un bool");
        }
        if (node.op === 'bitnot' && (operandType === 'f32' || operandType === 'f64')) {
          throw new Error("El operador '~' no acepta flotantes");
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
        if (this.isArithmetic(from) && this.isArithmetic(to)) return to;
        throw new Error(`cast no soportado: ${this.typeName(from)} → ${this.typeName(to)}`);
      }

      case 'make_array': {
        const n = node as MakeArrayNode;
        const resolvedType = this.resolveType(n.typeExpr);
        if (typeof resolvedType !== 'object' || resolvedType.kind !== 'dynarray') {
          throw new Error(
            `make() requiere un dynarray, se obtuvo ${this.typeName(resolvedType)}`
          );
        }
        const lenType = this.analyzeExpression(n.lengthExpr);
        if (lenType !== 's32' && lenType !== 'u32') {
          throw new Error('make() requiere longitud entera');
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
            (node as any).isSameBuiltin = true;
            return 'bool';
          }

          let common: MathType;
          if (at1 === 'null') common = at2;
          else if (at2 === 'null') common = at1;
          else if (this.typesEqual(at1, at2)) common = at1;
          else throw new Error(
            `is_same: los dos args deben ser del mismo tipo ` +
            `(${this.typeName(at1)} vs ${this.typeName(at2)})`
          );

          const isRef = typeof common === 'string'
            ? (common === 'string')
            : (common.kind === 'struct' || common.kind === 'pointer' ||
               common.kind === 'dynarray' || common.kind === 'function');
          if (!isRef) {
            throw new Error(
              `is_same requiere un tipo referencia (struct, pointer, ` +
              `dynarray, string, fn); se obtuvo ${this.typeName(common)}. ` +
              `Usa '==' para primitivos.`
            );
          }

          node.paramTypes = [common, common];
          node.type = 'bool';
          (node as any).isSameBuiltin = true;
          return 'bool';
        }
        if (node.name === 'len' && node.args.length === 1 && !this.scopeControl.has('len')) {
          const at = this.resolveType(this.analyzeExpression(node.args[0]));
          if (typeof at !== 'object' || (at.kind !== 'array' && at.kind !== 'dynarray')) {
            throw new Error(`len() requiere un array/dynarray, se obtuvo ${this.typeName(at)}`);
          }
          node.paramTypes = [at];
          node.type = 's32';
          (node as any).isLenBuiltin = true;
          return 's32';
        }

        const argTypes: MathType[] = [];
        for (const arg of node.args) argTypes.push(this.resolveType(this.analyzeExpression(arg)));

        if (!this.scopeControl.has(node.name)) throw new Error(`Identificador no definido: '${node.name}'`);
        const sym = this.scopeControl.lookup(node.name);

        if (sym.isFunctionDecl) {
          const overloads = sym.overloads!;
          let chosen: FunctionOverload | undefined;
          for (const ov of overloads) if (this.argTypesMatchExact(ov.type.paramTypes, argTypes)) { chosen = ov; break; }
          if (!chosen) for (const ov of overloads) if (this.argTypesMatchWithBridge(ov.type.paramTypes, argTypes)) { chosen = ov; break; }
          if (!chosen) {
            throw new Error(
              `Ninguna sobrecarga de '${node.name}' coincide con ` +
              `[${argTypes.map(t => this.typeName(t)).join(', ')}]`
            );
          }
          for (let i = 0; i < argTypes.length; i++) {
            const at = argTypes[i];
            const et = this.resolveType(chosen.type.paramTypes[i]);
            const bridge =
              (at === 'string' && (et === 's32' || et === 'u32')) ||
              (et === 'string' && (at === 's32' || at === 'u32'));
            if (!this.isAssignableType(at, et) && !bridge) {
              throw new Error(`Argumento ${i} de '${node.name}': se esperaba ${this.typeName(et)}, se obtuvo ${this.typeName(at)}`);
            }
          }
          node.name = chosen.mangledName;
          node.paramTypes = chosen.type.paramTypes;
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
            throw new Error(`Llamada indirecta a '${node.name}': se esperaban ${params.length} args, se recibieron ${argTypes.length}`);
          }
          for (let i = 0; i < argTypes.length; i++) {
            const at = argTypes[i]; const et = params[i];
            const bridge =
              (at === 'string' && (et === 's32' || et === 'u32')) ||
              (et === 'string' && (at === 's32' || at === 'u32'));
            if (!this.isAssignableType(at, et) && !bridge) {
              throw new Error(`Argumento ${i} de la llamada indirecta a '${node.name}': se esperaba ${this.typeName(et)}, se obtuvo ${this.typeName(at)}`);
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
        throw new Error(`'${node.name}' no es una función`);
      }

      case 'call_indirect': {
        // ── Prepass: `p.metodo(args)` → desugaring a `metodo__SP(p, args)`
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
                  throw new Error(
                    `Método '${sa.fieldName}' de '${baseType.name}': ` +
                    `se esperaban ${expected.length} argumentos, ` +
                    `se recibieron ${argTypes.length}`
                  );
                }
                for (let i = 0; i < argTypes.length; i++) {
                  if (!this.isAssignableType(argTypes[i], expected[i])) {
                    throw new Error(
                      `Argumento ${i} de '${sa.fieldName}': se esperaba ` +
                      `${this.typeName(expected[i])}, se obtuvo ${this.typeName(argTypes[i])}`
                    );
                  }
                }

                // Desugaring in-place: `p.foo(a, b)` → `foo__SP(p, a, b)`.
                const newCall: any = node;
                newCall.kind = 'call';
                newCall.name = method.mangledName;
                newCall.args = [sa.base, ...node.args];
                newCall.paramTypes = method.type.paramTypes;
                newCall.type = method.type.returnTypes[0] ?? 'void';
                return newCall.type;
              }

              throw new Error(`Campo '${sa.fieldName}' no existe en '${baseType.name}'`);
            }
            // Es un campo: caer al análisis normal de call_indirect.
          }
        }

        // ── Análisis normal.
        const calleeType = this.resolveType(this.analyzeExpression(node.callee));
        if (typeof calleeType !== 'object' || calleeType.kind !== 'function') {
          throw new Error('call_indirect: el callee no es de tipo función');
        }
        const fnType = calleeType as FunctionType;
        const params = fnType.paramTypes.map(t => this.resolveType(t));

        if (node.args.length !== params.length) {
          throw new Error(
            `Llamada indirecta: se esperaban ${params.length} argumentos, ` +
            `se recibieron ${node.args.length}`
          );
        }

        for (let i = 0; i < node.args.length; i++) {
          const at = this.resolveType(this.analyzeExpression(node.args[i]));
          const et = params[i];
          const bridge =
            (at === 'string' && (et === 's32' || et === 'u32')) ||
            (et === 'string' && (at === 's32' || at === 'u32'));
          if (!this.isAssignableType(at, et) && !bridge) {
            throw new Error(
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
        const returnTypes = fnNode.returnType
          ? [this.resolveType(fnNode.returnType)]
          : [];
        const fnType: FunctionType = { kind: 'function', paramTypes, returnTypes };

        const name = `__lambda_${this.lambdaCounter++}`;
        this.scopeControl.declareFunction(name, name, fnType, false);

        const prevReturn = this.currentReturnType;
        const prevLevel = this.currentLevel;
        this.currentReturnType = fnNode.returnType ? this.resolveType(fnNode.returnType) : null;

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

        if (fnNode.returnType !== null && !this.allPathsReturn(fnNode.body as StatementNode[])) {
          throw new Error(
            `La lambda '${name}' no retorna en todos los caminos ` +
            `(se esperaba ${this.typeName(this.currentReturnType!)})`
          );
        }

        this.currentReturnType = prevReturn;
        this.currentLevel = prevLevel;

        this.hoistedFunctions.push({
          kind: 'function_def',
          name,
          params: fnNode.params,
          returnType: fnNode.returnType,
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
        delete (node as any).returnType;
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
              throw new Error(`Campo '${field.name}' repetido en struct anónimo`);
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
          if (providedFields.has(field.name)) throw new Error(`Campo '${field.name}' repetido en '${structName}'`);
          providedFields.add(field.name);
          const expectedField = structType.fields.find(c => c.name === field.name);
          if (!expectedField) throw new Error(`Campo '${field.name}' no existe en '${structName}'`);
          const actualType = this.resolveType(this.analyzeExpression(field.value));
          if (!this.isAssignableType(actualType, expectedField.type)) {
            if (!(actualType === 'null' && typeof expectedField.type !== 'string')) {
              throw new Error(`Tipo incorrecto para '${structName}.${field.name}': se esperaba ${this.typeName(expectedField.type)}, se obtuvo ${this.typeName(actualType)}`);
            }
          }
        }
        const missing = structType.fields.filter(f => !providedFields.has(f.name)).map(f => f.name);
        if (missing.length > 0) throw new Error(`Faltan campos en '${structName}': ${missing.join(', ')}`);
        node.type = structType;
        return structType;
      }

      case 'struct_access': {
        const expressionType = this.resolveType(this.analyzeExpression(node.base));
        const baseType = typeof expressionType === 'object' && expressionType.kind === 'pointer'
          ? this.resolveType(expressionType.targetType) : expressionType;
        if (typeof baseType !== 'object' || baseType.kind !== 'struct') {
          throw new Error(
            `No se puede acceder al campo '${node.fieldName}' en un valor ` +
            `de tipo ${this.typeName(baseType)}`
          );
        }

        // Prioridad: campo primero.
        const field = baseType.fields.find(c => c.name === node.fieldName);
        if (field) {
          node.resolvedBaseType = baseType;
          node.type = this.resolveType(field.type);
          return node.type;
        }

        // Sin campo: probar como método (method value).
        if (baseType.name !== '') {
          const method = this.lookupMethod(baseType.name, node.fieldName);
          if (method) {
            return this.buildMethodValue(node, baseType, method);
          }
        }

        throw new Error(`Campo '${node.fieldName}' no existe en '${baseType.name}'`);
      }

      case 'array_literal': {
        let elemType: MathType = 's32';
        if (node.elements.length > 0) elemType = this.resolveType(this.analyzeExpression(node.elements[0]));
        for (let i = 1; i < node.elements.length; i++) {
          const t = this.resolveType(this.analyzeExpression(node.elements[i]));
          if (!this.typesEqual(t, elemType)) {
            throw new Error(`Array literal: elemento ${i} tiene tipo ${this.typeName(t)}, esperado ${this.typeName(elemType)}`);
          }
        }
        node.type = { kind: 'array', elementType: elemType, length: node.elements.length };
        return node.type;
      }

      case 'array_access': {
        const baseType = this.resolveType(this.analyzeExpression(node.base));
        if (typeof baseType !== 'object' ||
            (baseType.kind !== 'array' && baseType.kind !== 'dynarray')) {
          throw new Error('array_access sobre no-array');
        }
        this.analyzeExpression(node.index);
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
          if (root.kind !== 'variable') throw new Error(`El operando de '${increment.operator}' debe ser modificable`);
          this.scopeControl.checkMutable(root.name);
        }
        if (!this.isArithmetic(operandType)) {
          throw new Error(`El operador '${increment.operator}' requiere un tipo numérico; se obtuvo ${this.typeName(operandType)}`);
        }
        increment.type = operandType;
        return operandType;
      }

      default: return 's32';
    }
  }

  // ─── Method value ────────────────────────────────────────────────

  /**
   * Convierte `p.metodo` (sin paréntesis) en un closure que captura `p`.
   *
   * El closure usa un thunk hoisteado `__lambda_N` cuyo único propósito
   * es extraer `self` del env y llamar al método real.
   *
   * El nodo original (`struct_access`) se muta in-place a un `closure`.
   * La firma del method value es la del método SIN el parámetro `self`.
   */
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

    // `self` viene de la captura 0 del env del closure.
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
      type: returnTypes[0] ?? 'void',
    };

    const thunkBody: StatementNode[] = returnTypes.length > 0
      ? [{ kind: 'return', value: innerCall }]
      : [{ kind: 'expression_stmt', expr: innerCall }];

    const thunkFn: FunctionDefNode = {
      kind: 'function_def',
      name: thunkName,
      params: valueParams.map((t, i) => ({
        name: paramNames[i],
        type: t,
        uniqueName: paramUniqueNames[i],
      })),
      returnType: returnTypes[0] ?? null,
      body: thunkBody,
      mangledName: thunkName,
    };

    // Marcar como ya analizado. `analyzeProgram` lo va a empujar a
    // program.body sin re-analizarlo.
    this.hoistedFunctions.push(thunkFn);

    // Firma del method value (sin self).
    const valueFnType: FunctionType = {
      kind: 'function',
      paramTypes: valueParams,
      returnTypes,
    };

    // Mutar el nodo a closure.
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

  // ─── Helpers de tipos ─────────────────────────────────────────────

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
      return 'bool';
    }

    if (leftType === 'bool' && rightType === 'bool') {
      if (['&&', '||', '==', '!='].includes(op)) return 'bool';
      throw new Error(`Operador '${op}' no permitido entre booleanos`);
    }
    if (typeof leftType === 'string' && typeof rightType === 'string') {
      if (['==', '!=', '<', '<=', '>', '>='].includes(op)) return 'bool';
      return leftType;
    }
    const arithOps = new Set(['+', '-', '*', '/', '%', '&', '|', '^', '<<', '>>', '==', '!=', '<', '<=', '>', '>=']);
    if (arithOps.has(op) && this.isArithmetic(leftType) && this.isArithmetic(rightType)) {
      if (['==', '!=', '<', '<=', '>', '>='].includes(op)) return 'bool';
      return this.promoteArith(leftType, rightType);
    }
    throw new Error(`Operación '${op}' no permitida entre ${this.typeName(leftType)} y ${this.typeName(rightType)}`);
  }

  private isArithmetic(t: MathType): boolean {
    return t === 's32' || t === 'u32' || t === 's64' || t === 'u64' || t === 'f32' || t === 'f64';
  }

  private promoteArith(a: MathType, b: MathType): MathType {
    if (a === b) return a;
    const isFloat = (x: MathType) => x === 'f32' || x === 'f64';
    if (isFloat(a) || isFloat(b)) return a === 'f64' || b === 'f64' ? 'f64' : 'f32';
    const w = (x: MathType) => (x === 's64' || x === 'u64' ? 64 : 32);
    const s = (x: MathType) => x === 's32' || x === 's64';
    const width = Math.max(w(a), w(b));
    const signed = s(a) && s(b);
    return width === 32 ? (signed ? 's32' : 'u32') : (signed ? 's64' : 'u64');
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
      case 'i32': return 's32';
      case 'i64': return 's64';
      case 'u32': case 'u64': case 'f32': case 'f64': case 'bool': case 'string': return name;
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
    if (left === right) return true;
    if (typeof left !== 'object' || typeof right !== 'object') return false;
    if (left.kind === 'pointer' && right.kind === 'pointer') {
      return this.typesEqual(this.resolveType(left.targetType), this.resolveType(right.targetType));
    }
    if (left.kind === 'struct' && right.kind === 'struct') {
      if (left.name === '' && right.name === '') {
        if (left.fields.length !== right.fields.length) return false;
        for (let i = 0; i < left.fields.length; i++) {
          if (left.fields[i].name !== right.fields[i].name) return false;
          if (!this.typesEqual(left.fields[i].type, right.fields[i].type)) return false;
        }
        return true;
      }
      return left.name === right.name;
    }
    if (left.kind === 'array' && right.kind === 'array') {
      return left.length === right.length && this.typesEqual(left.elementType, right.elementType);
    }
    if (left.kind === 'dynarray' && right.kind === 'dynarray') {
      return this.typesEqual(left.elementType, right.elementType);
    }
    if (left.kind === 'function' && right.kind === 'function') {
      return left.paramTypes.length === right.paramTypes.length &&
        left.returnTypes.length === right.returnTypes.length &&
        left.paramTypes.every((t, i) => this.typesEqual(t, right.paramTypes[i])) &&
        left.returnTypes.every((t, i) => this.typesEqual(t, right.returnTypes[i]));
    }
    return false;
  }

  private typeName(type: MathType): string {
    if (typeof type === 'object') {
      if (type.kind === 'struct') {
        if (type.name === '') {
          return `struct { ${type.fields.map(f => `${f.name}: ${this.typeName(f.type)}`).join('; ')} }`;
        }
        return type.name;
      }
      if (type.kind === 'pointer') return `*${this.typeName(type.targetType)}`;
      if (type.kind === 'function') return '(fn)';
      if (type.kind === 'array') return `[${this.typeName(type.elementType)}; ${type.length}]`;
      if (type.kind === 'dynarray') return `[${this.typeName(type.elementType)}]`;
    }
    return String(type);
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
    if (this.typesEqual(source, target)) return true;

    if (typeof source === 'string' && typeof target === 'string') {
      const fi = arithInfo[source as ArithmeticType];
      const ti = arithInfo[target as ArithmeticType];
      if (fi && ti) {
        if (!fi.isFloat && !ti.isFloat && fi.width < ti.width) return true;
        if (!fi.isFloat && ti.isFloat && target === 'f64' && fi.width <= 32) return true;
        if (fi.isFloat && ti.isFloat && source === 'f32' && target === 'f64') return true;
      }
    }

    if (source === 'null' && typeof target === 'object' &&
        (target.kind === 'pointer' || target.kind === 'struct' ||
         target.kind === 'dynarray' || target.kind === 'function')) return true;

    if (typeof source === 'object' && source.kind === 'struct' &&
        typeof target === 'object' && target.kind === 'pointer') {
      return this.typesEqual(source, target.targetType);
    }
    if (typeof source === 'object' && source.kind === 'pointer' &&
        typeof target === 'object' && target.kind === 'pointer') {
      return this.typesEqual(source.targetType, target.targetType);
    }
    if (typeof source === 'object' && source.kind === 'array' &&
        typeof target === 'object' && target.kind === 'dynarray') {
      return this.isAssignableType(source.elementType, target.elementType);
    }
    return false;
  }
}

// for (const stmt of program.body) this.analyzeStatement(stmt);