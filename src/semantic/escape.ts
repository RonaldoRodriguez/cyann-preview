import type { MathNode, MathType } from '../types';
import type { SemanticContext } from './context';

export function isHeapType(t: MathType): boolean {
  if (t === 'string') return true;
  if (typeof t !== 'object') return false;
  return t.kind === 'struct' || t.kind === 'dynarray' || t.kind === 'pointer';
}

export function exprLevel(ctx: SemanticContext, expr: MathNode): number {
  const t = (expr as any).type as MathType;
  if (!isHeapType(t)) {
    if (expr.kind !== 'closure' && expr.kind !== 'function_ref') return 0;
  }
  switch (expr.kind) {
    case 'variable': {
      const v = expr as any;
      return ctx.slotLevels.get(v.uniqueName) ?? 0;
    }
    case 'struct_literal':
    case 'array_literal':
    case 'make_array':
    case 'call':
    case 'call_indirect':
    case 'closure':
    case 'function_ref':
      return ctx.currentLevel;
    case 'interpolated_string':
      return ctx.currentLevel;
    case 'binary': {
      const b = expr as any;
      if (b.op === '+' && (b.left as any).type === 'string') return ctx.currentLevel;
      return Math.max(exprLevel(ctx, b.left), exprLevel(ctx, b.right));
    }
    case 'cast':   return exprLevel(ctx, (expr as any).operand);
    case 'unary':  return exprLevel(ctx, (expr as any).operand);
    case 'struct_access': return exprLevel(ctx, (expr as any).base);
    case 'array_access':  return exprLevel(ctx, (expr as any).base);
    default: return 0;
  }
}

export function checkEscape(
  ctx: SemanticContext,
  value: MathNode,
  slotLevel: number,
  where: string,
): void {
  if (!value) return;
  const lvl = exprLevel(ctx, value);
  if (lvl > slotLevel) {
    ctx.error(
      `Escapado de región en ${where}: el valor proviene del nivel ${lvl}, ` +
      `pero se almacena en un slot del nivel ${slotLevel}`
    );
  }
}

export function slotLevelOfTarget(ctx: SemanticContext, target: MathNode): number {
  let root: any = target;
  while (root.kind === 'struct_access' || root.kind === 'array_access') root = root.base;
  if (root.kind !== 'variable') return 0;
  return ctx.slotLevels.get(root.uniqueName) ?? 0;
}