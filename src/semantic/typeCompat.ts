import type { MathNode, MathType } from '../types';
import {
  isArithmeticType, isIntegerType, maxArithmeticType, supportsStructuralEquality,
  isAssignableType as areTypesAssignable, typesEqual as areTypesEqual,
} from '../typeSystem';
import type { SemanticContext } from './context';
import { resolveType, typeName } from './typeOps';

export function argTypesMatchExact(
  ctx: SemanticContext,
  params: MathType[],
  args: MathType[],
): boolean {
  if (params.length !== args.length) return false;
  for (let i = 0; i < params.length; i++) {
    if (!isAssignableType(ctx, resolveType(ctx, args[i]), resolveType(ctx, params[i]))) return false;
  }
  return true;
}

export function argTypesMatchStrict(
  ctx: SemanticContext,
  params: MathType[],
  args: MathType[],
): boolean {
  if (params.length !== args.length) return false;
  for (let i = 0; i < params.length; i++) {
    if (!typesEqual(ctx, resolveType(ctx, args[i]), resolveType(ctx, params[i]))) return false;
  }
  return true;
}

export function argTypesMatchWithBridge(
  ctx: SemanticContext,
  params: MathType[],
  args: MathType[],
): boolean {
  if (params.length !== args.length) return false;
  for (let i = 0; i < params.length; i++) {
    const p = resolveType(ctx, params[i]);
    const a = resolveType(ctx, args[i]);
    if (isAssignableType(ctx, a, p)) continue;
    const bridge =
      (a === 'string' && (p === 's32' || p === 'u32')) ||
      (p === 'string' && (a === 's32' || a === 'u32'));
    if (!bridge) return false;
  }
  return true;
}

export function variadicArgumentsMatch(
  ctx: SemanticContext,
  params: MathType[],
  args: MathType[],
  variadic: boolean,
  matches: (param: MathType, arg: MathType) => boolean,
): boolean {
  if (!variadic) {
    if (params.length !== args.length) return false;
    return params.every((param, index) =>
      matches(resolveType(ctx, param), resolveType(ctx, args[index])));
  }
  if (params.length === 0) return false;
  const last = resolveType(ctx, params[params.length - 1]);
  if (typeof last !== 'object' || last.kind !== 'dynarray') return false;
  const fixedCount = params.length - 1;
  if (args.length < fixedCount) return false;
  if (args.length > fixedCount) {
    const variadicType = resolveType(ctx, args[fixedCount]);
    for (let i = fixedCount + 1; i < args.length; i++) {
      if (!typesEqual(ctx, variadicType, resolveType(ctx, args[i]))) return false;
    }
  }
  for (let i = 0; i < fixedCount; i++) {
    if (!matches(resolveType(ctx, params[i]), resolveType(ctx, args[i]))) return false;
  }
  for (let i = fixedCount; i < args.length; i++) {
    if (!matches(last.elementType, resolveType(ctx, args[i]))) return false;
  }
  return true;
}

export function makeVariadicArray(args: MathNode[], elementType: MathType): MathNode {
  return {
    kind: 'array_literal',
    elements: args,
    type: { kind: 'dynarray', elementType },
  };
}

export function inferBinaryType(
  ctx: SemanticContext,
  op: string,
  leftType: MathType,
  rightType: MathType,
): MathType {
  if ((leftType === 'null' || rightType === 'null') && (op === '==' || op === '!=')) return 'bool';

  const leftPointer = typeof leftType === 'object' && leftType.kind === 'pointer';
  const rightPointer = typeof rightType === 'object' && rightType.kind === 'pointer';
  const leftOffset = leftType === 's32' || leftType === 'u32';
  const rightOffset = rightType === 's32' || rightType === 'u32';
  if (leftPointer && rightOffset && (op === '+' || op === '-')) return leftType;
  if (rightPointer && leftOffset && op === '+') return rightType;
  if (leftPointer && rightPointer && (op === '==' || op === '!=')) return 'bool';

  if (typeof leftType === 'object' && leftType.kind === 'struct'
      && typeof rightType === 'object' && rightType.kind === 'struct'
      && typesEqual(ctx, leftType, rightType)
      && (op === '==' || op === '!=')) {
    if (!supportsStructuralEquality(leftType)) {
      ctx.error(
        `La comparación estructural de '${leftType.name || '(anónimo)'}' ` +
        `contiene campos cuyo tipo no es comparable`
      );
    }
    return 'bool';
  }

  if (leftType === 'bool' && rightType === 'bool') {
    if (['&&', '||', '==', '!='].includes(op)) return 'bool';
    ctx.error(`Operador '${op}' no permitido entre booleanos`);
    return 'bool';
  }
  if (leftType === 'string' && rightType === 'string') {
    if (['==', '!=', '<', '<=', '>', '>='].includes(op)) return 'bool';
    if (op === '+') return 'string';
    ctx.error(`Operador '${op}' no permitido entre ${typeName(leftType)} y ${typeName(rightType)}`);
    return 's32';
  }
  const arithOps = new Set(['+', '-', '*', '/', '%', '&', '|', '^', '<<', '>>', '==', '!=', '<', '<=', '>', '>=']);
  if (arithOps.has(op) && isArithmeticType(leftType) && isArithmeticType(rightType)) {
    if (op === '%' && (!isIntegerType(leftType) || !isIntegerType(rightType))) {
      ctx.error('El operador % requiere operandos enteros');
      return 's32';
    }
    if (['&', '|', '^', '<<', '>>'].includes(op) &&
        (!isIntegerType(leftType) || !isIntegerType(rightType))) {
      ctx.error(`El operador '${op}' requiere operandos enteros`);
      return 's32';
    }
    if (['==', '!=', '<', '<=', '>', '>='].includes(op)) return 'bool';
    return maxArithmeticType(leftType, rightType);
  }
  ctx.error(
    `Operación '${op}' no permitida entre ${typeName(leftType)} y ${typeName(rightType)}`
  );
  return 's32';
}

export function typesEqual(
  ctx: SemanticContext,
  left: MathType,
  right: MathType,
): boolean {
  return areTypesEqual(resolveType(ctx, left), resolveType(ctx, right));
}

export function isAssignableType(
  ctx: SemanticContext,
  source: MathType,
  target: MathType,
): boolean {
  return areTypesAssignable(resolveType(ctx, source), resolveType(ctx, target));
}

export function isComparableType(t: MathType): boolean {
  if (isArithmeticType(t)) return true;
  if (t === 'string' || t === 'bool') return true;
  if (typeof t === 'object') {
    if (t.kind === 'struct' || t.kind === 'pointer' || t.kind === 'dynarray' || t.kind === 'function') return true;
  }
  return false;
}

export function contextualizeArrayLiteral(
  ctx: SemanticContext,
  expr: MathNode,
  target: MathType,
): boolean {
  if (expr.kind !== 'array_literal' || typeof target !== 'object' ||
      (target.kind !== 'array' && target.kind !== 'dynarray')) return false;
  if (target.kind === 'array' && target.length !== expr.elements.length) return false;
  for (const element of expr.elements) {
    const targetElement = target.elementType;
    if (element.kind === 'array_literal' &&
        typeof targetElement === 'object' &&
        (targetElement.kind === 'array' || targetElement.kind === 'dynarray')) {
      if (!contextualizeArrayLiteral(ctx, element, targetElement)) return false;
      continue;
    }
    const actualType = resolveType(ctx, (element as any).type as MathType);
    if (!isAssignableType(ctx, actualType, targetElement)) return false;
  }
  (expr as any).type = target;
  return true;
}