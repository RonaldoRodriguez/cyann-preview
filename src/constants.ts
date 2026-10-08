/**
 * Módulo de Constant Folding (Plegado de Constantes) Independiente
 */

import type {
  ArithmeticType,
  LiteralInference,
  ConstNode,
  StringNode,
  BooleanLiteralNode,
  MathType,
  MathNode,
} from './types';
import {
  isArithmeticType, isIntegerType, maxArithmeticType, signedness, width,
} from './typeSystem';
export { maxArithmeticType, signedness, width } from './typeSystem';

// ─────────────────────────────────────────────
// Inferencia y creación de literales numéricos
// ─────────────────────────────────────────────

const HEX_RE = /^0[xX][0-9a-fA-F]+$/;
const BIN_RE = /^0[bB][01]+$/;
const DEC_INT_RE = /^\d+$/;
const FLOAT_RE = /^(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/;

function isValidNumericCore(s: string): boolean {
  return HEX_RE.test(s) || BIN_RE.test(s) || DEC_INT_RE.test(s) || FLOAT_RE.test(s);
}

function resolveIntType(suffix: string | null, isUnsigned: boolean): ArithmeticType {
  const is64 = suffix !== null && /[lL]/.test(suffix);
  if (is64) return isUnsigned ? 'u64' : 's64';
  if (isUnsigned) return 'u32';
  return 's32';
}

function resolveFloatType(suffix: string | null): ArithmeticType {
  if (suffix === 'f' || suffix === 'F') return 'f32';
  return 'f64';
}

function checkAndReturnInt(type: ArithmeticType, val: bigint): LiteralInference {
  const limits: Record<string, { min: bigint; max: bigint; convert: (n: bigint) => number | bigint }> = {
    s32: { min: -2147483648n, max: 2147483647n, convert: n => Number(n) | 0 },
    u32: { min: 0n, max: 4294967295n, convert: n => Number(BigInt.asUintN(32, n)) >>> 0 },
    s64: { min: -9223372036854775808n, max: 9223372036854775807n, convert: n => n },
    u64: { min: 0n, max: 18446744073709551615n, convert: n => BigInt.asUintN(64, n) },
  };

  const lim = limits[type];
  if (!lim) throw new Error(`Tipo no soportado: ${type}`);
  if (val < lim.min || val > lim.max) throw new Error(`Valor fuera de rango para ${type}: ${val}`);
  return { type, value: lim.convert(val) };
}

export function inferLiteral(raw: string): LiteralInference {
  let sign = 1n;
  let core = raw.trim();

  if (core.startsWith('+')) {
    core = core.slice(1);
  } else if (core.startsWith('-')) {
    sign = -1n;
    core = core.slice(1);
  }

  const numericPart = core.replace(/_/g, '');
  if (numericPart === '') throw new Error('Literal vacío');

  let suffix: string | null = null;
  let cleanCore = numericPart;

  if (!isValidNumericCore(numericPart)) {
    const SUFFIXES = ['ul', 'UL', 'uL', 'Ul', 'lu', 'LU', 'lU', 'Lu', 'l', 'L', 'f', 'F', 'u', 'U'];
    SUFFIXES.sort((a, b) => b.length - a.length);

    for (const s of SUFFIXES) {
      if (numericPart.endsWith(s)) {
        const potentialCore = numericPart.slice(0, -s.length);
        if (isValidNumericCore(potentialCore)) {
          suffix = s;
          cleanCore = potentialCore;
          break;
        }
      }
    }
    if (!suffix) throw new Error(`Formato numérico no válido: '${numericPart}'`);
  }

  const isHex = /^0[xX][0-9a-fA-F]+$/.test(cleanCore);
  const isBin = /^0[bB][01]+$/.test(cleanCore);
  const hasFloatSyntax = /[.eE]/.test(cleanCore);
  const isFloatCore = !isHex && !isBin && hasFloatSyntax;
  const isIntegerSuffix = suffix !== null && /[lLuU]/.test(suffix);
  const isFloatSuffix = suffix === 'f' || suffix === 'F';
  const isUnsigned = suffix !== null && /[uU]/.test(suffix);

  if (isIntegerSuffix && isFloatCore) {
    throw new Error('Literal flotante con sufijo entero');
  }

  if (isIntegerSuffix || (!isFloatSuffix && !isFloatCore)) {
    let val: bigint;
    if (isHex || isBin) {
      const digits = cleanCore.slice(2);
      val = BigInt((isHex ? '0x' : '0b') + digits);
    } else {
      val = BigInt(cleanCore);
    }
    const adjusted = sign * val;

    // ── Hex/bin SIN sufijo: semántica de patrón de bits.
    //
    // Un literal hex/bin sin sufijo no se interpreta como "número
    // con signo", sino como una secuencia de bits. Por eso
    // `0xCAFEBABE` (3405691582) es válido aunque no quepa en s32:
    // su patrón de 32 bits es `-889275714` como s32, y eso es lo
    // que se guarda. Igual que en C con `unsigned int`.
    //
    // Reglas:
    //   - Si el patrón cabe en 32 bits (con o sin signo):
    //       → s32 (con wrap, `BigInt.asIntN(32, ...)`).
    //   - Si no, pero cabe en 64 bits:
    //       → s64.
    //   - Si no cabe en 64 bits: error.
    //
    // El sufijo `u` sigue forzando u32/u64 y el `l` fuerza s64/u64,
    // exactamente como antes. Esto sólo afecta a literales hex/bin
    // sin sufijo.
    if (suffix === null && (isHex || isBin)) {
      if (adjusted >= -0x80000000n && adjusted <= 0xFFFFFFFFn) {
        return { type: 's32', value: Number(BigInt.asIntN(32, adjusted)) };
      }
      if (adjusted >= -0x8000000000000000n && adjusted <= 0xFFFFFFFFFFFFFFFFn) {
        return { type: 's64', value: BigInt.asIntN(64, adjusted) };
      }
      throw new Error(`Literal hex/bin fuera de rango 64-bit: ${adjusted}`);
    }

    const type = resolveIntType(suffix, isUnsigned);
    return checkAndReturnInt(type, adjusted);
  } else {
    if (isHex || isBin) throw new Error(`Formato flotante no compatible con ${cleanCore}`);
    const numVal = parseFloat(cleanCore);
    const type = resolveFloatType(suffix);
    const finalVal = sign === -1n ? -numVal : numVal;
    if (type === 'f32') return { type, value: Math.fround(finalVal) };
    return { type, value: finalVal };
  }
}

export function createConstNode(raw: string): ConstNode {
  const lit = inferLiteral(raw);
  return { kind: 'const', type: lit.type, value: lit.value };
}

// ─────────────────────────────────────────────
// Helpers de evaluación
// ─────────────────────────────────────────────

function promoteValue(value: number | bigint, from: ArithmeticType, to: ArithmeticType): number | bigint {
  if (from === to) return value;
  if (signedness[to] === 'float') return Number(value);
  if (signedness[from] === 'float') return value;
  if (width[to] > width[from]) return BigInt(value as number);
  return value;
}

function isComparisonOp(op: string): boolean {
  return ['==', '!=', '<', '<=', '>', '>='].includes(op);
}

function isLogicalOp(op: string): boolean {
  return op === '&&' || op === '||';
}

// ─────────────────────────────────────────────
// Evaluadores primarios de constantes
// ─────────────────────────────────────────────

function applyBinaryConst(
  op: string,
  left: ConstNode | BooleanLiteralNode,
  right: ConstNode | BooleanLiteralNode
): ConstNode | BooleanLiteralNode | null {
  if (isLogicalOp(op)) {
    if (left.kind !== 'bool' || right.kind !== 'bool') return null;
    const a = (left as BooleanLiteralNode).value;
    const b = (right as BooleanLiteralNode).value;
    if (op === '&&') return { kind: 'bool', type: 'bool', value: a && b };
    if (op === '||') return { kind: 'bool', type: 'bool', value: a || b };
    return null;
  }

  if (isComparisonOp(op)) {
    let aVal: number | bigint;
    let bVal: number | bigint;
    let resultType: ArithmeticType;

    if (left.kind === 'bool' && right.kind === 'bool') {
      aVal = (left as BooleanLiteralNode).value ? 1 : 0;
      bVal = (right as BooleanLiteralNode).value ? 1 : 0;
      resultType = 's32';
    } else if (left.kind === 'const' && right.kind === 'const') {
      const leftConst = left as ConstNode;
      const rightConst = right as ConstNode;
      resultType = maxArithmeticType(leftConst.type as ArithmeticType, rightConst.type as ArithmeticType);
      aVal = promoteValue(leftConst.value, leftConst.type as ArithmeticType, resultType);
      bVal = promoteValue(rightConst.value, rightConst.type as ArithmeticType, resultType);
    } else {
      return null;
    }

    const isFloat = signedness[resultType] === 'float';
    let result: boolean;

    if (isFloat) {
      const a = Number(aVal), b = Number(bVal);
      switch (op) {
        case '==': result = a === b; break;
        case '!=': result = a !== b; break;
        case '<':  result = a < b; break;
        case '<=': result = a <= b; break;
        case '>':  result = a > b; break;
        case '>=': result = a >= b; break;
        default: return null;
      }
    } else {
      const a = BigInt(aVal), b = BigInt(bVal);
      switch (op) {
        case '==': result = a === b; break;
        case '!=': result = a !== b; break;
        case '<':  result = a < b; break;
        case '<=': result = a <= b; break;
        case '>':  result = a > b; break;
        case '>=': result = a >= b; break;
        default: return null;
      }
    }
    return { kind: 'bool', type: 'bool', value: result };
  }

  if (left.kind !== 'const' || right.kind !== 'const') return null;

  const resultType = maxArithmeticType(left.type as ArithmeticType, right.type as ArithmeticType);
  const aValue = promoteValue(left.value, left.type as ArithmeticType, resultType);
  const bValue = promoteValue(right.value, right.type as ArithmeticType, resultType);
  const isFloat = signedness[resultType] === 'float';
  const isSigned = signedness[resultType] === 'signed';
  let result: number | bigint;

  if (isFloat) {
    const a = Number(aValue), b = Number(bValue);
    switch (op) {
      case '+': case 'add': result = a + b; break;
      case '-': case 'sub': result = a - b; break;
      case '*': case 'mul': result = a * b; break;
      case '/': case 'div': if (b === 0) return null; result = a / b; break;
      case '%': case 'rem': if (b === 0) return null; result = a % b; break;
      default: return null;
    }
  } else {
    const a = BigInt(aValue), b = BigInt(bValue);
    const w = width[resultType];
    switch (op) {
      case '+': case 'add': result = a + b; break;
      case '-': case 'sub': result = a - b; break;
      case '*': case 'mul': result = a * b; break;
      case '/': case 'div':
        if (b === 0n) return null;
        if (isSigned) result = a / b;
        else result = BigInt.asUintN(w, a) / BigInt.asUintN(w, b);
        break;
      case '%': case 'rem':
        if (b === 0n) return null;
        if (isSigned) result = a % b;
        else result = BigInt.asUintN(w, a) % BigInt.asUintN(w, b);
        break;
      case '&': result = a & b; break;
      case '|': result = a | b; break;
      case '^': result = a ^ b; break;
      case '<<': result = a << (b & BigInt(width[resultType] - 1)); break;
      case '>>':
        if (isSigned) result = a >> (b & BigInt(width[resultType] - 1));
        else result = BigInt.asUintN(width[resultType], a) >> (b & BigInt(width[resultType] - 1));
        break;
      default: return null;
    }
  }

  if (!isFloat) {
    const resultWidth = width[resultType];
    result = isSigned
      ? BigInt.asIntN(resultWidth, result as bigint)
      : BigInt.asUintN(resultWidth, result as bigint);
    if (resultWidth === 32) result = Number(result);
  }

  return { kind: 'const', type: resultType, value: result };
}

function evaluateUnaryConst(
  op: string,
  operand: ConstNode | BooleanLiteralNode
): ConstNode | BooleanLiteralNode | null {
  if (op === 'not') {
    if (operand.kind !== 'bool') return null;
    return { kind: 'bool', type: 'bool', value: !(operand as BooleanLiteralNode).value };
  }

  if (op === 'bitnot') {
    if (operand.kind !== 'const') return null;
    const c = operand as ConstNode;
    if (c.type === 'f32' || c.type === 'f64') return null;
    const val = BigInt(c.value as number | bigint);
    const w = width[c.type as ArithmeticType];
    const converted = signedness[c.type as ArithmeticType] === 'signed'
        ? BigInt.asIntN(w, ~val)
        : BigInt.asUintN(w, ~val);
    return { kind: 'const', type: c.type, value: w === 32 ? Number(converted) : converted };
  }

  if (op !== 'neg') return null;
  if (operand.kind !== 'const') return null;

  const constOperand = operand as ConstNode;
  if (constOperand.type === 'f32' || constOperand.type === 'f64') {
    return { kind: 'const', type: constOperand.type, value: -(constOperand.value as number) };
  }

  const val = BigInt(constOperand.value as number | bigint);
  const result = -val;
  const w = width[constOperand.type as ArithmeticType];
  const converted = signedness[constOperand.type as ArithmeticType] === 'signed'
      ? BigInt.asIntN(w, result)
      : BigInt.asUintN(w, result);

  return {
    kind: 'const',
    type: constOperand.type,
    value: w === 32 ? Number(converted) : converted,
  };
}

function tryFoldCast(
  operand: ConstNode | StringNode | BooleanLiteralNode,
  oldType: MathType,
  newType: MathType
): ConstNode | StringNode | BooleanLiteralNode | null {
  if (oldType === newType) return operand;

  if (oldType === 'string' && isIntegerType(newType)) {
    const strVal = (operand as StringNode).value.trim();
    if (/^[+-]?\d+$/.test(strVal)) {
      let sign = 1n;
      let digits = strVal;
      if (strVal.startsWith('+')) digits = strVal.slice(1);
      else if (strVal.startsWith('-')) { sign = -1n; digits = strVal.slice(1); }
      if (digits === '') return null;
      let val: bigint;
      try { val = BigInt(digits) * sign; } catch { return null; }
      const converted = checkAndReturnInt(newType, val);
      if (converted) return { kind: 'const', type: converted.type, value: converted.value };
    }
    return null;
  }

  if (isIntegerType(oldType) && newType === 'string') {
    const constNode = operand as ConstNode;
    let str: string;
    if (typeof constNode.value === 'bigint') str = constNode.value.toString();
    else if (Number.isInteger(constNode.value)) str = (constNode.value as number).toString();
    else return null;
    return { kind: 'string', type: 'string', value: str };
  }

  if (oldType === 'bool' && newType === 'string') {
    const boolNode = operand as BooleanLiteralNode;
    return { kind: 'string', type: 'string', value: boolNode.value ? 'true' : 'false' };
  }

  if (oldType === 'bool' && isIntegerType(newType)) {
    const boolNode = operand as BooleanLiteralNode;
    const value = boolNode.value ? 1n : 0n;
    const converted = checkAndReturnInt(newType, value);
    if (converted) return { kind: 'const', type: converted.type, value: converted.value };
    return null;
  }

  if (isArithmeticType(oldType) && isArithmeticType(newType)) {
    const from = oldType as ArithmeticType;
    const to = newType as ArithmeticType;
    const constNode = operand as ConstNode;
    const value = constNode.value;

    if (signedness[from] === 'float' && signedness[to] !== 'float') return null;

    if (signedness[from] !== 'float' && signedness[to] !== 'float') {
      let bigVal: bigint;
      if (typeof value === 'bigint') bigVal = value;
      else bigVal = BigInt(value);

      const resultWidth = width[to];
      const isSigned = signedness[to] === 'signed';
      const converted = isSigned ? BigInt.asIntN(resultWidth, bigVal) : BigInt.asUintN(resultWidth, bigVal);

      if (isSigned) {
        const min = -(2n ** BigInt(resultWidth - 1));
        const max = 2n ** BigInt(resultWidth - 1) - 1n;
        if (bigVal < min || bigVal > max) return null;
      } else {
        const max = 2n ** BigInt(resultWidth) - 1n;
        if (bigVal < 0n || bigVal > max) return null;
      }
      return { kind: 'const', type: to, value: resultWidth === 32 ? Number(converted) : converted };
    }

    if (signedness[from] !== 'float' && signedness[to] === 'float') {
      const num = typeof value === 'bigint' ? Number(value) : value as number;
      if (to === 'f32') return { kind: 'const', type: 'f32', value: Math.fround(num) };
      return { kind: 'const', type: 'f64', value: num };
    }

    if (signedness[from] === 'float' && signedness[to] === 'float') {
      const num = value as number;
      if (from === 'f32' && to === 'f64') return { kind: 'const', type: 'f64', value: num };
      if (from === 'f64' && to === 'f32') return { kind: 'const', type: 'f32', value: Math.fround(num) };
    }
  }

  return null;
}

// ─────────────────────────────────────────────
// Función Principal Exportada
// ─────────────────────────────────────────────

/**
 * Plega constantes recursivamente en un AST de expresiones (MathNode).
 * Si la subexpresión completa puede resolverse a nivel de compilación,
 * retorna un nodo hoja simplificado ('const', 'bool' o 'string').
 */
export function foldConstants(node: MathNode): MathNode {
  if (
    node.kind === 'const' ||
    node.kind === 'variable' ||
    node.kind === 'string' ||
    node.kind === 'bool' ||
    node.kind === 'function_ref'
  ) {
    return node;
  }

  if (node.kind === 'size_of') {
    if ((node as any).value !== undefined) {
      return { kind: 'const', type: 's32', value: (node as any).value };
    }
    return node;
  }

  if (node.kind === 'call_indirect') {
    return {
      ...node,
      callee: foldConstants(node.callee),
      args: node.args.map(arg => foldConstants(arg)),
    };
  }

  if (node.kind === 'cast') {
    const foldedOperand = foldConstants(node.operand);
    if (
      foldedOperand.kind === 'const' ||
      foldedOperand.kind === 'string' ||
      foldedOperand.kind === 'bool'
    ) {
      const foldedCast = tryFoldCast(foldedOperand, node.oldType, node.newType);
      if (foldedCast) return foldedCast;
    }
    return { ...node, operand: foldedOperand };
  }

  if (node.kind === 'unary') {
    const folded = foldConstants(node.operand);
    if (folded.kind === 'const' || folded.kind === 'bool') {
      const result = evaluateUnaryConst(node.op, folded);
      if (result) return result;
    }
    return { ...node, operand: folded };
  }

  if (node.kind === 'binary') {
    const left = foldConstants(node.left);
    const right = foldConstants(node.right);
    if (
      (left.kind === 'const' || left.kind === 'bool') &&
      (right.kind === 'const' || right.kind === 'bool')
    ) {
      if ((left.kind as string) !== 'string' && (right.kind as string) !== 'string') {
        const result = applyBinaryConst(
          node.op,
          left as ConstNode | BooleanLiteralNode,
          right as ConstNode | BooleanLiteralNode
        );
        if (result) return result;
      }
    }
    return { ...node, left, right };
  }

  if (node.kind === 'call') {
    return { ...node, args: node.args.map(arg => foldConstants(arg)) };
  }

  if (node.kind === 'array_literal') {
    return { ...node, elements: node.elements.map(el => foldConstants(el)) };
  }

  if (node.kind === 'array_access') {
    return {
      ...node,
      base: foldConstants(node.base),
      index: foldConstants(node.index),
    };
  }

  if (node.kind === 'struct_literal') {
    return {
      ...node,
      fields: node.fields.map(f => ({ name: f.name, value: foldConstants(f.value) })),
    };
  }

  if (node.kind === 'struct_access') {
    return { ...node, base: foldConstants(node.base) };
  }

  return node;
}