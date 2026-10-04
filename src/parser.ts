import { Lexer, Token } from './lexer';
import { createConstNode } from './constants';
import {
  MathNode, MathType, CallNode, StructLiteralNode, CallIndirectNode,
  PatternNode, MakeArrayNode,
} from './types';

// ─── Nodos ────────────────────────────────────────────────────────────────

export interface VarConstNode {
  kind: 'var_decl' | 'const_decl';
  name: string;
  type: MathType;
  initExpr: MathNode | null;
  inferred?: boolean;
  uniqueName?: string;
  isGlobal?: boolean;
  isConst?: boolean;
}

export interface ShortVarDeclNode {
  kind: 'short_var_decl'; name: string; expr: MathNode; uniqueName?: string;
}

export interface MultiDeclNode {
  kind: 'multi_decl';
  names: string[];
  expr: MathNode;
  uniqueNames?: (string | null)[];
}

export interface AssignNode { kind: 'assign'; target: MathNode; expr: MathNode; }

export interface FunctionDefNode {
  kind: 'function_def';
  name: string;
  params: { name: string; type: MathType; uniqueName?: string }[];
  returnTypes: MathType[];
  body: StatementNode[];
  mangledName?: string;
  receiver?: MathType;
}

export interface StructDefNode {
  kind: 'struct_def';
  name: string;
  fields: { name: string; type: MathType }[];
}

export interface TypeAliasNode {
  kind: 'type_alias';
  name: string;
  targetType: MathType;
}

export interface IfNode {
  kind: 'if';
  condition: MathNode;
  thenBlock: StatementNode[];
  elseBlock: StatementNode[] | IfNode | null;
}

export interface ForNode {
  kind: 'for';
  label?: string;
  init?: StatementNode | null;
  condition?: MathNode | null;
  post?: StatementNode | null;
  body: StatementNode[];
}

export interface ForInNode {
  kind: 'for_in';
  label?: string;
  varNames: string[];
  iterable: MathNode;
  body: StatementNode[];
  indexUnique?: string | null;
  valueUnique?: string | null;
  elementType?: MathType;
}

export interface SwitchCase {
  patterns: PatternNode[];
  body: StatementNode[];
}

export interface SwitchNode {
  kind: 'switch';
  expr: MathNode;
  cases: SwitchCase[];
  defaultBody: StatementNode[] | null;
  exprType?: MathType;
}

export interface RegionNode { kind: 'region'; body: StatementNode[]; }
export interface BreakNode    { kind: 'break'; label?: string; }
export interface ContinueNode { kind: 'continue'; label?: string; }
export interface ReturnNode   { kind: 'return'; values: MathNode[]; }
export interface ExpressionStmtNode { kind: 'expression_stmt'; expr: MathNode; }

export interface ImportDeclNode {
  kind: 'import_decl';
  module: string; field: string; name: string;
  params: { name: string; type: MathType }[];
  returnType: MathType | null;
}

export type StatementNode =
  | VarConstNode | ShortVarDeclNode | MultiDeclNode | AssignNode | FunctionDefNode | StructDefNode
  | TypeAliasNode
  | IfNode | ForNode | ForInNode | SwitchNode | RegionNode
  | BreakNode | ContinueNode | ReturnNode | ExpressionStmtNode | ImportDeclNode;

export interface ProgramNode { kind: 'program'; body: StatementNode[]; }

// ─── Parser ───────────────────────────────────────────────────────────────

export class Parser {
  private lexer: Lexer;
  private currentToken!: Token;
  private _noStructLiteral = 0;
  private _loopStack: { supportsContinue: boolean; label?: string }[] = [];

  constructor(lexer: Lexer) { this.lexer = lexer; this.advance(); }

  private advance(): void { this.currentToken = this.lexer.nextToken(); }

  private peekNextToken(): Token {
    const s = this.lexer.saveState();
    const c = this.currentToken;
    this.advance();
    const n = this.currentToken;
    this.currentToken = c;
    this.lexer.restoreState(s);
    return n;
  }

  private error(msg: string): never {
    throw new Error(`${msg} en línea ${this.currentToken.line}, columna ${this.currentToken.column}`);
  }

  private matchToken(type: string, value?: string): boolean {
    if (this.currentToken.type === type && (!value || this.currentToken.value === value)) {
      this.advance(); return true;
    }
    return false;
  }

  private expectToken(type: string, value?: string): string {
    const val = this.currentToken.value;
    if (this.currentToken.type !== type || (value && val !== value)) {
      this.error(`Se esperaba '${value || type}', pero se encontró '${val}'`);
    }
    this.advance(); return val;
  }

  private check(type: string, value?: string): boolean {
    return this.currentToken.type === type && (!value || this.currentToken.value === value);
  }
  private checkValue(v: string): boolean { return this.currentToken.value === v; }

  private withoutStructLiteral<T>(fn: () => T): T {
    this._noStructLiteral++;
    try { return fn(); } finally { this._noStructLiteral--; }
  }

  private parseLoopBody(label?: string): StatementNode[] {
    this._loopStack.push({ supportsContinue: true, label });
    try { return this.parseBlock(); } finally { this._loopStack.pop(); }
  }

  public parseProgram(): ProgramNode {
    const body: StatementNode[] = [];
    while (this.currentToken.type !== 'EOF') body.push(this.parseStatement());
    return { kind: 'program', body };
  }

  public parseStatement(): StatementNode {
    if (this.currentToken.value === '[') {
      this.advance();
      if (this.matchToken('KEYWORD', 'host')) return this.parseImportDecl();

      if (this.currentToken.type === 'IDENTIFIER') {
        const receiver = this.parseGoTypeName();
        this.expectToken('SYMBOL', ']');
        return this.parseMethodDef(receiver);
      }

      this.error("Solo se admite [host(...)] o [Tipo] como atributo");
    }

    if (this.currentToken.value === 'var')    return this.parseVarDecl();
    if (this.currentToken.value === 'const')  return this.parseConstDecl();
    if (this.currentToken.value === 'func')   return this.parseFunctionDef();
    if (this.currentToken.value === 'type')   return this.parseTypeOrStructDef();
    if (this.currentToken.value === 'if')     return this.parseIfStatement();
    if (this.currentToken.value === 'for')    return this.parseForStatement();
    if (this.currentToken.value === 'switch') return this.parseSwitchStatement();
    if (this.currentToken.value === 'region') {
      this.advance();
      const body = this.parseBlock();
      return { kind: 'region', body };
    }
    if (this.currentToken.value === 'break')    return this.parseBreakStatement();
    if (this.currentToken.value === 'continue') return this.parseContinueStatement();
    if (this.currentToken.value === 'return')   return this.parseReturnStatement();

    if (this.currentToken.type === 'IDENTIFIER') {
      const name = this.currentToken.value;
      this.advance();

      // ¿Etiqueta de loop? `nombre: for ...`
      if (this.currentToken.value === ':') {
        const next = this.peekNextToken();
        if (next.type === 'KEYWORD' && next.value === 'for') {
          this.advance(); // consume ':'
          return this.parseForStatement(name);
        }
      }

      return this.parseStatementStartingWithIdentifier(name);
    }

    const expr = this.parseExpression();
    this.matchToken('SYMBOL', ';');
    return { kind: 'expression_stmt', expr };
  }

  private parseStatementStartingWithIdentifier(name: string): StatementNode {
    if (this.matchToken('SYMBOL', ',')) {
      const names = [name];
      do {
        names.push(this.expectToken('IDENTIFIER'));
      } while (this.matchToken('SYMBOL', ','));

      this.expectToken('SYMBOL', '=');
      const expr = this.parseExpression();
      this.matchToken('SYMBOL', ';');
      return { kind: 'multi_decl', names, expr };
    }

    if (this.currentToken.value === '(') {
      let expr: MathNode = this.parseCallAfterName(name);
      expr = this.parsePostfix(expr);
      this.matchToken('SYMBOL', ';');
      return { kind: 'expression_stmt', expr };
    }

    const variable: MathNode = { kind: 'variable', name, type: 's32' };
    const target = this.parsePostfix(variable);

    if (this.matchToken('SYMBOL', '=')) {
      const expr = this.parseExpression();
      this.matchToken('SYMBOL', ';');
      return { kind: 'assign', target, expr };
    }

    const expr = this.parseExpressionStartingWith(target);
    this.matchToken('SYMBOL', ';');
    return { kind: 'expression_stmt', expr };
  }

  private parseImportDecl(): ImportDeclNode {
    this.expectToken('SYMBOL', '(');
    const module = this.expectToken('STRING');
    this.expectToken('SYMBOL', ',');
    const field = this.expectToken('STRING');
    this.expectToken('SYMBOL', ')');
    this.expectToken('SYMBOL', ']');
    this.expectToken('KEYWORD', 'func');
    const name = this.expectToken('IDENTIFIER');

    this.expectToken('SYMBOL', '(');
    const params: { name: string; type: MathType }[] = [];
    if (this.currentToken.value !== ')') {
      for (;;) {
        const pn = this.expectToken('IDENTIFIER');
        const pt = this.parseGoTypeName();
        params.push({ name: pn, type: pt });
        if (!this.matchToken('SYMBOL', ',')) break;
      }
    }
    const closeParenLine = this.currentToken.line;
    this.expectToken('SYMBOL', ')');

    let returnType: MathType | null = null;
    if (this.currentToken.line === closeParenLine && this.isTypeStart()) {
      returnType = this.parseGoTypeName();
    }
    this.matchToken('SYMBOL', ';');
    return { kind: 'import_decl', module, field, name, params, returnType };
  }

  private parseVarDecl(): VarConstNode | MultiDeclNode {
    this.expectToken('KEYWORD', 'var');
    const firstName = this.expectToken('IDENTIFIER');

    if (this.matchToken('SYMBOL', ',')) {
      const names = [firstName];
      do {
        names.push(this.expectToken('IDENTIFIER'));
      } while (this.matchToken('SYMBOL', ','));

      this.expectToken('SYMBOL', '=');
      const expr = this.parseExpression();
      this.matchToken('SYMBOL', ';');
      return { kind: 'multi_decl', names, expr };
    }

    const inferred = this.currentToken.value === '=';
    let type: MathType = 's32';
    if (!inferred) type = this.parseGoTypeName();
    let initExpr: MathNode | null = null;
    if (this.matchToken('SYMBOL', '=')) initExpr = this.parseExpression();
    this.matchToken('SYMBOL', ';');
    return { kind: 'var_decl', name: firstName, type, initExpr, inferred };
  }

  private parseConstDecl(): VarConstNode {
    this.expectToken('KEYWORD', 'const');
    const name = this.expectToken('IDENTIFIER');
    const inferred = this.currentToken.value === '=';
    let type: MathType = 's32';
    if (!inferred) type = this.parseGoTypeName();
    let initExpr: MathNode | null = null;
    if (this.matchToken('SYMBOL', '=')) initExpr = this.parseExpression();
    this.matchToken('SYMBOL', ';');
    return { kind: 'const_decl', name, type, initExpr, inferred, isConst: true };
  }

  private parseReturnTypes(): MathType[] {
    if (this.matchToken('SYMBOL', '(')) {
      const types: MathType[] = [];
      if (this.currentToken.value !== ')') {
        for (;;) {
          types.push(this.parseGoTypeName());
          if (!this.matchToken('SYMBOL', ',')) break;
        }
      }
      this.expectToken('SYMBOL', ')');
      return types;
    }
    if (this.isTypeStart()) return [this.parseGoTypeName()];
    return [];
  }

  private parseFunctionDef(): FunctionDefNode {
    this.expectToken('KEYWORD', 'func');
    const name = this.expectToken('IDENTIFIER');

    this.expectToken('SYMBOL', '(');
    const params: { name: string; type: MathType }[] = [];
    if (this.currentToken.value !== ')') {
      for (;;) {
        const paramName = this.expectToken('IDENTIFIER');
        const paramType = this.parseGoTypeName();
        params.push({ name: paramName, type: paramType });
        if (!this.matchToken('SYMBOL', ',')) break;
      }
    }
    const closeParenLine = this.currentToken.line;
    this.expectToken('SYMBOL', ')');

    let returnTypes: MathType[] = [];
    if (this.currentToken.line === closeParenLine) {
      returnTypes = this.parseReturnTypes();
    }
    const body = this.parseBlock();
    return { kind: 'function_def', name, params, returnTypes, body };
  }

  private parseMethodDef(receiver: MathType): FunctionDefNode {
    this.expectToken('KEYWORD', 'func');
    const name = this.expectToken('IDENTIFIER');

    this.expectToken('SYMBOL', '(');
    const params: { name: string; type: MathType }[] = [];
    if (this.currentToken.value !== ')') {
      for (;;) {
        const paramName = this.expectToken('IDENTIFIER');
        const paramType = this.parseGoTypeName();
        params.push({ name: paramName, type: paramType });
        if (!this.matchToken('SYMBOL', ',')) break;
      }
    }
    const closeParenLine = this.currentToken.line;
    this.expectToken('SYMBOL', ')');

    let returnTypes: MathType[] = [];
    if (this.currentToken.line === closeParenLine) {
      returnTypes = this.parseReturnTypes();
    }
    const body = this.parseBlock();
    return { kind: 'function_def', name, params, returnTypes, body, receiver };
  }

  private parseTypeOrStructDef(): StructDefNode | TypeAliasNode {
    this.expectToken('KEYWORD', 'type');
    const name = this.expectToken('IDENTIFIER');

    if (this.matchToken('KEYWORD', 'struct')) {
      this.expectToken('SYMBOL', '{');
      const fields: { name: string; type: MathType }[] = [];
      while (this.currentToken.value !== '}') {
        const fieldName = this.expectToken('IDENTIFIER');
        const fieldType = this.parseGoTypeName();
        fields.push({ name: fieldName, type: fieldType });
        this.matchToken('SYMBOL', ';');
      }
      this.expectToken('SYMBOL', '}');
      return { kind: 'struct_def', name, fields };
    }

    const targetType = this.parseGoTypeName();
    this.matchToken('SYMBOL', ';');
    return { kind: 'type_alias', name, targetType };
  }

  private parseIfStatement(): IfNode {
    this.expectToken('KEYWORD', 'if');
    const condition = this.withoutStructLiteral(() => this.parseExpression());
    const thenBlock = this.parseBlock();
    let elseBlock: StatementNode[] | IfNode | null = null;
    if (this.matchToken('KEYWORD', 'else')) {
      if (this.currentToken.value === 'if') elseBlock = this.parseIfStatement();
      else elseBlock = this.parseBlock();
    }
    return { kind: 'if', condition, thenBlock, elseBlock };
  }

 private parseForStatement(label: string | null = null): StatementNode {
    this.expectToken('KEYWORD', 'for');

    if (this.checkValue('{')) {
      const body = this.parseLoopBody(label ?? undefined);
      return { kind: 'for', label: label ?? undefined, body };
    }

    // ─── NUEVO: `for var i = 0; ...` ─────────────────────────────
    if (this.check('KEYWORD', 'var')) {
      const initStmt = this.parseVarDecl();
      return this.finishClassicFor(initStmt, label);
    }
    // ─────────────────────────────────────────────────────────────

    if (this.check('IDENTIFIER')) {
      const firstName = this.currentToken.value;
      this.advance();

      // `for i, x in xs` o `for _, x in xs`
      if (this.matchToken('SYMBOL', ',')) {
        const names = [firstName];
        do {
          names.push(this.expectToken('IDENTIFIER'));
        } while (this.matchToken('SYMBOL', ','));

        this.expectToken('KEYWORD', 'in');
        const iterable = this.withoutStructLiteral(() => this.parseExpression());
        const body = this.parseLoopBody(label ?? undefined);
        return { kind: 'for_in', label: label ?? undefined, varNames: names, iterable, body };
      }

      // `for x in xs`
      if (this.matchToken('KEYWORD', 'in')) {
        const iterable = this.withoutStructLiteral(() => this.parseExpression());
        const body = this.parseLoopBody(label ?? undefined);
        return { kind: 'for_in', label: label ?? undefined, varNames: [firstName], iterable, body };
      }

      const firstStmt = this.withoutStructLiteral(
        () => this.parseStatementStartingWithIdentifier(firstName)
      );
      return this.finishClassicFor(firstStmt, label);
    }

    if (this.checkValue(';')) return this.finishClassicFor(null, label);

    const condExpr = this.withoutStructLiteral(() => this.parseExpression());
    if (this.checkValue('{')) {
      const body = this.parseLoopBody(label ?? undefined);
      return { kind: 'for', label: label ?? undefined, condition: condExpr, body };
    }
    this.error('for: se esperaba "{" después de la condición');
  }

  private finishClassicFor(firstStmt: StatementNode | null, label: string | null = null): ForNode {
    let init: StatementNode | null = null;
    let condition: MathNode | null = null;
    let post: StatementNode | null = null;

    if (firstStmt === null) {
      this.expectToken('SYMBOL', ';');
      if (!this.checkValue(';')) condition = this.withoutStructLiteral(() => this.parseExpression());
      this.expectToken('SYMBOL', ';');
      if (!this.checkValue('{')) post = this.parseStatement();
    } else if (this.checkValue('{')) {
      if (firstStmt.kind !== 'expression_stmt') this.error('for: se esperaba ";" antes de "{"');
      condition = firstStmt.expr;
    } else {
      init = firstStmt;
      if (!this.checkValue(';')) condition = this.withoutStructLiteral(() => this.parseExpression());
      this.expectToken('SYMBOL', ';');
      if (!this.checkValue('{')) post = this.parseStatement();
    }

    const body = this.parseLoopBody(label ?? undefined);
    return { kind: 'for', label: label ?? undefined, init, condition, post, body };
  }

  private parseSwitchStatement(): SwitchNode {
    this.expectToken('KEYWORD', 'switch');
    const expr = this.withoutStructLiteral(() => this.parseExpression());
    this.expectToken('SYMBOL', '{');

    const cases: SwitchCase[] = [];
    let defaultBody: StatementNode[] | null = null;
    let seenDefault = false;

    while (!this.checkValue('}')) {
      if (this.currentToken.type === 'EOF') this.error('switch: "}" esperado');

      if (this.matchToken('KEYWORD', 'case')) {
        const patterns: PatternNode[] = [];
        for (;;) {
          const pattern = this.parsePattern();
          patterns.push(pattern);
          if (this.matchToken('SYMBOL', ',')) continue;
          break;
        }
        this.expectToken('SYMBOL', ':');
        const body = this.parseCaseBody();
        cases.push({ patterns, body });
        continue;
      }

      if (this.matchToken('KEYWORD', 'default')) {
        if (seenDefault) this.error('switch: dos "default" en el mismo switch');
        seenDefault = true;
        this.expectToken('SYMBOL', ':');
        defaultBody = this.parseCaseBody();
        continue;
      }

      this.error('switch: se esperaba "case" o "default"');
    }
    this.expectToken('SYMBOL', '}');
    return { kind: 'switch', expr, cases, defaultBody };
  }

  private parsePattern(): PatternNode {
    const tok = this.currentToken;

    if (tok.type === 'IDENTIFIER' && tok.value === '_') {
      this.advance();
      return { kind: 'wildcard' };
    }

    if (this.matchToken('KEYWORD', 'null')) {
      return { kind: 'const', type: 'null', value: -1 };
    }

    if (this.matchToken('NUMBER')) {
      const cn = createConstNode(tok.value);
      return { kind: 'const', type: cn.type, value: cn.value };
    }

    if (this.matchToken('STRING')) {
      return { kind: 'string', value: tok.value };
    }

    if (this.matchToken('BOOLEAN')) {
      return { kind: 'bool', value: tok.value === 'true' };
    }

    if (tok.type === 'IDENTIFIER') {
      this.advance();
      const structName = tok.value;
      if (this.currentToken.value !== '{') {
        this.error(
          `Patrón no válido: identificador '${structName}' sin '{'. ` +
          `¿Quisiste escribir '_' como wildcard?`
        );
      }
      this.expectToken('SYMBOL', '{');
      const fields: { name: string; pattern: PatternNode }[] = [];
      if ((this.currentToken.value as string) !== '}') {
        do {
          const fieldName = this.expectToken('IDENTIFIER');
          this.expectToken('SYMBOL', ':');
          const fieldPattern = this.parsePattern();
          fields.push({ name: fieldName, pattern: fieldPattern });
        } while (this.matchToken('SYMBOL', ',') && (this.currentToken.value as string) !== '}');
      }
      this.expectToken('SYMBOL', '}');
      return { kind: 'struct', structName, fields };
    }

    this.error(`Patrón no válido: '${tok.value}'`);
  }

  private parseCaseBody(): StatementNode[] {
    const stmts: StatementNode[] = [];
    while (
      !this.checkValue('}') &&
      !this.check('KEYWORD', 'case') &&
      !this.check('KEYWORD', 'default') &&
      this.currentToken.type !== 'EOF'
    ) stmts.push(this.parseStatement());
    return stmts;
  }

  private parseBreakStatement(): BreakNode {
    this.expectToken('KEYWORD', 'break');
    let label: string | undefined = undefined;
    if (this.currentToken.type === 'IDENTIFIER') {
      label = this.currentToken.value;
      this.advance();
    }
    if (label !== undefined) {
      if (!this._loopStack.some(l => l.label === label)) {
        this.error(`break: etiqueta '${label}' no encontrada`);
      }
    } else {
      if (this._loopStack.length === 0) this.error('break fuera de un bucle');
    }
    this.matchToken('SYMBOL', ';');
    return { kind: 'break', label };
  }

  private parseContinueStatement(): ContinueNode {
    this.expectToken('KEYWORD', 'continue');
    let label: string | undefined = undefined;
    if (this.currentToken.type === 'IDENTIFIER') {
      label = this.currentToken.value;
      this.advance();
    }
    if (label !== undefined) {
      if (!this._loopStack.some(l => l.label === label && l.supportsContinue)) {
        this.error(`continue: etiqueta '${label}' no encontrada`);
      }
    } else {
      if (!this._loopStack.some(l => l.supportsContinue)) this.error('continue fuera de un bucle');
    }
    this.matchToken('SYMBOL', ';');
    return { kind: 'continue', label };
  }

  private parseReturnStatement(): ReturnNode {
    this.expectToken('KEYWORD', 'return');
    const values: MathNode[] = [];
    if (
      this.currentToken.value !== '}' &&
      this.currentToken.type !== 'EOF' &&
      this.currentToken.value !== ';'
    ) {
      for (;;) {
        values.push(this.parseExpression());
        if (!this.matchToken('SYMBOL', ',')) break;
      }
    }
    this.matchToken('SYMBOL', ';');
    return { kind: 'return', values };
  }

  private parseBlock(): StatementNode[] {
    this.expectToken('SYMBOL', '{');
    const statements: StatementNode[] = [];
    while (this.currentToken.value !== '}' && this.currentToken.type !== 'EOF') {
      statements.push(this.parseStatement());
    }
    this.expectToken('SYMBOL', '}');
    return statements;
  }

  private isTypeStart(): boolean {
    const value = this.currentToken.value;
    return this.currentToken.type === 'IDENTIFIER' ||
      value === 'fn' || value === 'func' || value === '*' || value === '[' ||
      value === 'struct';
  }

  private parseGoTypeName(): MathType {
    if (this.matchToken('SYMBOL', '*')) {
      return { kind: 'pointer', targetType: this.parseGoTypeName() };
    }

    if (this.matchToken('SYMBOL', '[')) {
      if (this.matchToken('SYMBOL', ']')) {
        const elementType = this.parseGoTypeName();
        return { kind: 'dynarray', elementType };
      }

      const rawLength = this.expectToken('NUMBER');
      const length = Number(rawLength);

      if (!Number.isInteger(length) || length <= 0) {
        this.error(`Longitud de array inválida: '${rawLength}'`);
      }

      this.expectToken('SYMBOL', ']');
      const elementType = this.parseGoTypeName();
      return { kind: 'array', elementType, length };
    }

    if (!this.isTypeStart()) {
      this.error(`Se esperaba un tipo, se encontró '${this.currentToken.value}'`);
    }

    const typeName = this.currentToken.value;
    const typeLine = this.currentToken.line;
    this.advance();

    let type: MathType;

    if (typeName === 'fn' || typeName === 'func') {
      this.expectToken('SYMBOL', '(');

      const paramTypes: MathType[] = [];
      if (this.currentToken.value !== ')') {
        do {
          paramTypes.push(this.parseGoTypeName());
        } while (this.matchToken('SYMBOL', ','));
      }

      this.expectToken('SYMBOL', ')');

      const returnTypes = this.isTypeStart()
        ? [this.parseGoTypeName()]
        : [];

      type = { kind: 'function', paramTypes, returnTypes };
    } else if (typeName === 'struct') {
      this.expectToken('SYMBOL', '{');
      const fields: { name: string; type: MathType }[] = [];
      while (this.currentToken.value !== '}') {
        const fieldName = this.expectToken('IDENTIFIER');
        this.expectToken('SYMBOL', ':');
        const fieldType = this.parseGoTypeName();
        fields.push({ name: fieldName, type: fieldType });
        this.matchToken('SYMBOL', ';');
      }
      this.expectToken('SYMBOL', '}');
      type = {
        kind: 'struct',
        name: '',
        fields: fields.map(f => ({ name: f.name, type: f.type, offset: 0 })),
        size: 0,
        align: 1,
      };
    } else {
      switch (typeName) {
        case 'int':
        case 'i32':
        case 'int32':
        case 'int32_t': type = 's32'; break;
        case 'int64':
        case 'int64_t':
        case 'long': type = 's64'; break;
        case 'uint':
        case 'u32':
        case 'uint32':
        case 'uint32_t': type = 'u32'; break;
        case 'uint64':
        case 'uint64_t':
        case 'u64': type = 'u64'; break;
        case 'float':
        case 'f32': type = 'f32'; break;
        case 'float64':
        case 'double':
        case 'f64': type = 'f64'; break;
        case 'bool': type = 'bool'; break;
        case 'string': type = 'string'; break;
        case 'byte':
        case 'char':
        case 'i8':
        case 'u8':
        case 'int8_t':
        case 'uint8_t': type = 's32'; break;
        case 'i16':
        case 'u16':
        case 'int16_t':
        case 'uint16_t': type = 's32'; break;
        case 'size_t':
        case 'ssize_t':
        case 'intptr_t':
        case 'uintptr_t':
        case 'usize':
        case 'isize':
        case 'uintptr': type = 'u32'; break;
        default:
          type = { kind: 'struct', name: typeName, fields: [], size: 0, align: 1 };
      }
    }

    return this.parseArraySuffix(type, typeLine);
  }

  private parseArraySuffix(elementType: MathType, typeLine: number): MathType {
    let type = elementType;

    while (this.currentToken.value === '[' && this.currentToken.line === typeLine) {
      this.advance();

      if (this.matchToken('SYMBOL', ']')) {
        type = { kind: 'dynarray', elementType: type };
        continue;
      }

      const rawLength = this.expectToken('NUMBER');
      const length = Number(rawLength);

      if (!Number.isInteger(length) || length <= 0) {
        this.error(`Longitud de array inválida: '${rawLength}'`);
      }

      this.expectToken('SYMBOL', ']');
      type = { kind: 'array', elementType: type, length };
    }

    return type;
  }

  public parseExpression(): MathNode { return this.parseLogicalOr(); }

  private parseExpressionStartingWith(leftNode: MathNode): MathNode {
    return this.parseBinaryRHS(0, leftNode);
  }

  private parseBinaryRHS(minPrecedence: number, left: MathNode): MathNode {
    const precedence: Record<string, number> = {
      '||': 1, '&&': 2, '|': 3, '^': 4, '&': 5,
      '==': 6, '!=': 6, '<': 7, '<=': 7, '>': 7, '>=': 7,
      '<<': 8, '>>': 8, '+': 9, '-': 9, '*': 10, '/': 10, '%': 10,
    };
    let result = left;
    while (true) {
      const op = this.currentToken.value;
      const opPrecedence = precedence[op];
      if (opPrecedence === undefined || opPrecedence < minPrecedence) return result;
      this.advance();
      let right = this.parseUnary();
      const nextPrecedence = precedence[this.currentToken.value];
      if (nextPrecedence !== undefined && nextPrecedence > opPrecedence) {
        right = this.parseBinaryRHS(opPrecedence + 1, right);
      }
      result = { kind: 'binary', op: op as any, left: result, right };
    }
  }

  private parseLogicalOr(): MathNode {
    let left = this.parseLogicalAnd();
    while (this.matchToken('SYMBOL', '||')) {
      const right = this.parseLogicalAnd();
      left = { kind: 'binary', op: '||', left, right };
    }
    return left;
  }
  private parseLogicalAnd(): MathNode {
    let left = this.parseBitwiseOr();
    while (this.matchToken('SYMBOL', '&&')) {
      const right = this.parseBitwiseOr();
      left = { kind: 'binary', op: '&&', left, right };
    }
    return left;
  }
  private parseBitwiseOr(): MathNode {
    let left = this.parseBitwiseXor();
    while (this.matchToken('SYMBOL', '|') && this.currentToken.value !== '|') {
      const right = this.parseBitwiseXor();
      left = { kind: 'binary', op: '|', left, right };
    }
    return left;
  }
  private parseBitwiseXor(): MathNode {
    let left = this.parseBitwiseAnd();
    while (this.matchToken('SYMBOL', '^')) {
      const right = this.parseBitwiseAnd();
      left = { kind: 'binary', op: '^', left, right };
    }
    return left;
  }
  private parseBitwiseAnd(): MathNode {
    let left = this.parseEquality();
    while (this.matchToken('SYMBOL', '&') && this.currentToken.value !== '&') {
      const right = this.parseEquality();
      left = { kind: 'binary', op: '&', left, right };
    }
    return left;
  }
  private parseEquality(): MathNode {
    let left = this.parseRelational();
    while (this.currentToken.value === '==' || this.currentToken.value === '!=') {
      const op = this.currentToken.value as '==' | '!=';
      this.advance();
      const right = this.parseRelational();
      left = { kind: 'binary', op, left, right };
    }
    return left;
  }
  private parseRelational(): MathNode {
    let left = this.parseShift();
    while (['<', '<=', '>', '>='].includes(this.currentToken.value)) {
      const op = this.currentToken.value as '<' | '<=' | '>' | '>=';
      this.advance();
      const right = this.parseShift();
      left = { kind: 'binary', op, left, right };
    }
    return left;
  }
  private parseShift(): MathNode {
    let left = this.parseAdditive();
    while (this.currentToken.value === '<<' || this.currentToken.value === '>>') {
      const op = this.currentToken.value as '<<' | '>>';
      this.advance();
      const right = this.parseAdditive();
      left = { kind: 'binary', op, left, right };
    }
    return left;
  }
  private parseAdditive(): MathNode {
    let left = this.parseMultiplicative();
    while (this.currentToken.value === '+' || this.currentToken.value === '-') {
      const op = this.currentToken.value as '+' | '-';
      this.advance();
      const right = this.parseMultiplicative();
      left = { kind: 'binary', op, left, right };
    }
    return left;
  }
  private parseMultiplicative(): MathNode {
    let left = this.parseUnary();
    while (['*', '/', '%'].includes(this.currentToken.value)) {
      const op = this.currentToken.value as '*' | '/' | '%';
      this.advance();
      const right = this.parseUnary();
      left = { kind: 'binary', op, left, right };
    }
    return left;
  }

  private parseUnary(): MathNode {
    if (this.matchToken('SYMBOL', '++')) return { kind: 'increment', operator: '++', operand: this.parseUnary(), prefix: true, type: 's32' };
    if (this.matchToken('SYMBOL', '--')) return { kind: 'increment', operator: '--', operand: this.parseUnary(), prefix: true, type: 's32' };
    if (this.matchToken('SYMBOL', '!')) return { kind: 'unary', op: 'not', operand: this.parseUnary() };
    if (this.matchToken('SYMBOL', '-')) return { kind: 'unary', op: 'neg', operand: this.parseUnary() };
    if (this.matchToken('SYMBOL', '~')) return { kind: 'unary', op: 'bitnot', operand: this.parseUnary() };
    return this.parsePrimary();
  }

  private parsePrimary(): MathNode {
    const token = this.currentToken;
    let node: MathNode;

    if (this.matchToken('SYMBOL', '[')) {
      const elements: MathNode[] = [];
      if (this.currentToken.value !== ']') {
        for (;;) {
          elements.push(this.parseExpression());
          if (!this.matchToken('SYMBOL', ',')) break;
        }
      }
      this.expectToken('SYMBOL', ']');
      const firstType = elements.length > 0
        ? ((elements[0] as any).type ?? 's32')
        : 's32';
      node = {
        kind: 'array_literal', elements,
        type: { kind: 'array', elementType: firstType, length: elements.length },
      } as any;
    }
    else if (this.matchToken('KEYWORD', 'make')) {
      this.expectToken('SYMBOL', '(');
      const typeExpr = this.parseGoTypeName();
      this.expectToken('SYMBOL', ',');
      const lengthExpr = this.parseExpression();
      this.expectToken('SYMBOL', ')');
      node = { kind: 'make_array', typeExpr, lengthExpr } as MakeArrayNode;
    }
    else if (this.matchToken('KEYWORD', 'func')) {
      this.expectToken('SYMBOL', '(');
      const params: { name: string; type: MathType }[] = [];
      if (this.currentToken.value !== ')') {
        for (;;) {
          const pn = this.expectToken('IDENTIFIER');
          const pt = this.parseGoTypeName();
          params.push({ name: pn, type: pt });
          if (!this.matchToken('SYMBOL', ',')) break;
        }
      }
      const closeParenLine = this.currentToken.line;
      this.expectToken('SYMBOL', ')');

      let returnTypes: MathType[] = [];
      if (this.currentToken.line === closeParenLine) {
        returnTypes = this.parseReturnTypes();
      }
      const body = this.parseBlock();
      node = { kind: 'function_literal', params, returnTypes, body } as any;
    }
    else if (this.matchToken('KEYWORD', 'struct')) {
      this.expectToken('SYMBOL', '{');
      const fields: { name: string; value: MathNode }[] = [];
      if (this.currentToken.value !== '}') {
        for (;;) {
          const fieldName = this.expectToken('IDENTIFIER');
          this.expectToken('SYMBOL', ':');
          const value = this.parseExpression();
          fields.push({ name: fieldName, value });
          if (!this.matchToken('SYMBOL', ',')) break;
        }
      }
      this.expectToken('SYMBOL', '}');
      node = {
        kind: 'struct_literal',
        structName: '__anon',
        fields,
        type: { kind: 'struct', name: '', fields: [], size: 0, align: 1 },
      } as any;
    }
    else if (this.matchToken('NUMBER')) node = createConstNode(token.value);
    else if (this.matchToken('STRING')) node = { kind: 'string', type: 'string', value: token.value };
    else if (this.matchToken('BOOLEAN')) node = { kind: 'bool', type: 'bool', value: token.value === 'true' };
    else if (this.matchToken('KEYWORD', 'null')) node = { kind: 'const', type: 'null', value: -1 };
    else if (this.matchToken('SYMBOL', '(')) {
      const savedNoStruct = this._noStructLiteral;
      this._noStructLiteral = 0;
      try {
        node = this.parseExpression();
      } finally {
        this._noStructLiteral = savedNoStruct;
      }
      this.expectToken('SYMBOL', ')');
    }
    else if (this.matchToken('IDENTIFIER')) {
      if (this.currentToken.value === '(') node = this.parseCallAfterName(token.value);
      else if (this.currentToken.value === '{' && this._noStructLiteral === 0) node = this.parseStructCallAfterName(token.value);
      else node = { kind: 'variable', name: token.value, type: 's32' };
    }
    else this.error(`Expresión no válida: '${token.value}'`);

    node = this.parsePostfix(node);

    while (this.matchToken('KEYWORD', 'as')) {
      const targetType = this.parseGoTypeName();
      node = { kind: 'cast', operator: 'as', oldType: (node as any).type, newType: targetType, operand: node } as any;
    }
    return node;
  }

  private parseCallAfterName(name: string): CallNode {
    this.expectToken('SYMBOL', '(');
    const args: MathNode[] = [];
    if (this.currentToken.value !== ')') {
      do { args.push(this.parseExpression()); }
      while (this.matchToken('SYMBOL', ',') && !this.matchToken('EOF'));
    }
    this.expectToken('SYMBOL', ')');
    return { kind: 'call', name, args, paramTypes: args.map(() => 's32'), type: 's32' };
  }

  private parseStructCallAfterName(name: string): StructLiteralNode {
    this.expectToken('SYMBOL', '{');
    const fields: { name: string; value: MathNode }[] = [];
    if ((this.currentToken.value as string) !== '}') {
      do {
        const fieldName = this.expectToken('IDENTIFIER');
        this.expectToken('SYMBOL', ':');
        const value = this.parseExpression();
        fields.push({ name: fieldName, value });
      } while (this.matchToken('SYMBOL', ',') && (this.currentToken.value as string) !== '}');
    }
    this.expectToken('SYMBOL', '}');
    return {
      kind: 'struct_literal', structName: name, fields,
      type: { kind: 'struct', name, fields: [], size: 0, align: 1 },
    };
  }

  private parsePostfix(base: MathNode): MathNode {
    let expr = base;
    while (true) {
      const value = this.currentToken.value;
      if (value === '++' || value === '--') {
        this.advance();
        expr = { kind: 'increment', operator: value, operand: expr, prefix: false, type: 's32' };
        continue;
      }
      if (this.matchToken('SYMBOL', '.')) {
        const fieldName = this.expectToken('IDENTIFIER');
        expr = { kind: 'struct_access', base: expr, fieldName, type: 's32' };
        continue;
      }
      if (this.currentToken.value === '[') {
        const afterBracket = this.peekNextToken();
        const isAttribute = afterBracket.type === 'KEYWORD' && afterBracket.value === 'host';
        if (!isAttribute) {
          this.advance();
          const index = this.parseExpression();
          this.expectToken('SYMBOL', ']');
          expr = { kind: 'array_access', base: expr, index, type: 's32' } as MathNode;
          continue;
        }
        break;
      }
      if (this.matchToken('SYMBOL', '(')) {
        const args: MathNode[] = [];
        if (this.currentToken.value !== ')') {
          do { args.push(this.parseExpression()); } while (this.matchToken('SYMBOL', ','));
        }
        this.expectToken('SYMBOL', ')');
        expr = {
          kind: 'call_indirect', callee: expr, args, type: 's32',
          paramTypes: args.map(() => 's32'),
        } as CallIndirectNode;
        continue;
      }
      break;
    }
    return expr;
  }
}

// private parseForStatement(label: string | null = null): StatementNode {