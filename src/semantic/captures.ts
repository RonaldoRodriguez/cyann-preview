// src/semantic/captures.ts
import type { StatementNode } from '../parser';

/**
 * Recorre el cuerpo de una función (o lambda) y devuelve el conjunto de
 * nombres que la función referencia pero que NO declara por sí misma, es
 * decir, las variables que necesitarán ser capturadas en el closure.
 *
 * El truco está en `lambdaDepth`: cuando entramos a una lambda anidada
 * incrementamos la profundidad. Al resolver un nombre, si su declaración
 * fue a una profundidad menor a la actual, sabemos que cruza el límite
 * de la lambda y debe capturarse.
 *
 * Es una función pura: no toca `this`, no muta nada externo.
 */
export function findCapturedVars(
  fnParams: { name: string }[],
  fnBody: StatementNode[],
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