/**
 * Optimizer sobre el AST. Aplica constant folding a cada expresión
 * y recorre recursivamente todos los statements, incluidos los nuevos
 * `for_in`, `switch`, `region` y `multi_decl`.
 */

import { ProgramNode, StatementNode, IfNode } from './parser';
import { foldConstants } from './constants';

export class Optimizer {
  public optimizeProgram(program: ProgramNode): ProgramNode {
    return {
      kind: 'program',
      body: program.body.map(stmt => this.optimizeStatement(stmt))
    };
  }
// Error: cast entre compuestos no soportado
  public optimizeStatement(stmt: StatementNode): StatementNode {
    switch (stmt.kind) {
      case 'var_decl':
      case 'const_decl':
        return {
          ...stmt,
          initExpr: stmt.initExpr ? foldConstants(stmt.initExpr) : null
        };

      case 'short_var_decl':
        return {
          ...stmt,
          expr: foldConstants(stmt.expr)
        };

      case 'multi_decl':
        return {
          ...stmt,
          expr: foldConstants(stmt.expr)
        };

      case 'assign':
        return {
          ...stmt,
          expr: foldConstants(stmt.expr)
        };

      case 'expression_stmt':
        return {
          ...stmt,
          expr: foldConstants(stmt.expr)
        };

      case 'return':
        return {
          ...stmt,
          values: stmt.values.map(v => foldConstants(v))
        };

      case 'if':
        return {
          ...stmt,
          condition: foldConstants(stmt.condition),
          thenBlock: stmt.thenBlock.map(s => this.optimizeStatement(s)),
          elseBlock: Array.isArray(stmt.elseBlock)
            ? stmt.elseBlock.map(s => this.optimizeStatement(s))
            : (stmt.elseBlock
                ? (this.optimizeStatement(stmt.elseBlock) as IfNode)
                : null)
        };

      case 'for':
        return {
          ...stmt,
          init: stmt.init ? this.optimizeStatement(stmt.init) : null,
          condition: stmt.condition ? foldConstants(stmt.condition) : null,
          post: stmt.post ? this.optimizeStatement(stmt.post) : null,
          body: stmt.body.map(s => this.optimizeStatement(s))
        };

      case 'for_in':
        return {
          ...stmt,
          iterable: foldConstants(stmt.iterable),
          body: stmt.body.map(s => this.optimizeStatement(s))
        };

      case 'switch':
        return {
          ...stmt,
          expr: foldConstants(stmt.expr),
          cases: stmt.cases.map(c => ({
            patterns: c.patterns,
            body: c.body.map(s => this.optimizeStatement(s))
          })),
          defaultBody: stmt.defaultBody
            ? stmt.defaultBody.map(s => this.optimizeStatement(s))
            : null
        };

      case 'region':
        return {
          ...stmt,
          body: stmt.body.map(s => this.optimizeStatement(s))
        };

      case 'function_def':
        return {
          ...stmt,
          body: stmt.body.map(s => this.optimizeStatement(s))
        };

      case 'break':
      case 'continue':
      case 'import_decl':
      case 'struct_def':
      default:
        return stmt;
    }
  }
}