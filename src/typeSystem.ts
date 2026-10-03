/**
 * Módulo de Sistema de Tipos
 */

import { ArithmeticType, MathType } from './types';

export const signedness: Record<ArithmeticType, 'signed' | 'unsigned' | 'float'> = {
  s32: 'signed',
  u32: 'unsigned',
  s64: 'signed',
  u64: 'unsigned',
  f32: 'float',
  f64: 'float',
};

export const width: Record<ArithmeticType, number> = {
  s32: 32,
  u32: 32,
  s64: 64,
  u64: 64,
  f32: 32,
  f64: 64,
};

export const arithInfo: Record<ArithmeticType, { signed: boolean; isFloat: boolean; width: number }> = {
  s32: { signed: true, isFloat: false, width: 32 },
  u32: { signed: false, isFloat: false, width: 32 },
  s64: { signed: true, isFloat: false, width: 64 },
  u64: { signed: false, isFloat: false, width: 64 },
  f32: { signed: true, isFloat: true, width: 32 },
  f64: { signed: true, isFloat: true, width: 64 },
};

export function maxArithmeticType(a: ArithmeticType, b: ArithmeticType): ArithmeticType {
  if (!arithInfo[a] || !arithInfo[b]) {
    throw new Error(
      `maxArithmeticType: se esperaban tipos aritméticos, se recibió (${String(a)}, ${String(b)})`
    );
  }

  if (a === b) return a;

  if (signedness[a] === 'float' || signedness[b] === 'float') {
    if (a === 'f64' || b === 'f64') return 'f64';
    return 'f32';
  }

  const aSigned = signedness[a] === 'signed';
  const bSigned = signedness[b] === 'signed';
  const resultWidth = Math.max(width[a], width[b]);
  const resultSigned = aSigned && bSigned;

  return resultWidth === 32 ? (resultSigned ? 's32' : 'u32') : (resultSigned ? 's64' : 'u64');
}

export function sizeOfType(t: MathType): number {
  if (t === 'null') return 4;
  if (t === 'tuple') return 4;
  if (typeof t === 'string') {
    switch (t) {
      case 's32': case 'u32': case 'bool': case 'string': return 4;
      case 's64': case 'u64': return 8;
      case 'f32': return 4;
      case 'f64': return 8;
      default: return 4;
    }
  } else if (t.kind === 'array') {
    return sizeOfType(t.elementType) * t.length;
  } else if (t.kind === 'dynarray') {
    return 4;
  } else if (t.kind === 'pointer') {
    return 4;
  } else if (t.kind === 'struct') {
    return 4;
  } else if (t.kind === 'function') {
    return 4;
  }
  return 4;
}

export function alignOfType(t: MathType): number {
  if (t === 'null') return 4;
  if (t === 'tuple') return 4;
  if (typeof t === 'string') {
    switch (t) {
      case 's32': case 'u32': case 'bool': case 'string': return 4;
      case 's64': case 'u64': return 8;
      case 'f32': return 4;
      case 'f64': return 8;
      default: return 4;
    }
  } else if (t.kind === 'array') {
    return alignOfType(t.elementType);
  } else if (t.kind === 'dynarray') {
    return 4;
  } else if (t.kind === 'pointer') {
    return 4;
  } else if (t.kind === 'struct') {
    return t.align;
  } else if (t.kind === 'function') {
    return 4;
  }
  return 4;
}

export function typesEqual(a: MathType, b: MathType): boolean {
  if (!a || !b) return false;

  if (a === 'tuple' || b === 'tuple') return false;
  if (a === 'null' || b === 'null') {
    const isComposite = (t: MathType) => (typeof t !== 'string') || t === 'null';
    return isComposite(a) && isComposite(b);
  }

  if (typeof a === 'string' && typeof b === 'string') {
    return a === b;
  }

  if (typeof a !== 'string' && typeof b !== 'string') {
    if (a.kind === 'array' && b.kind === 'array') {
      return typesEqual(a.elementType, b.elementType) && a.length === b.length;
    }
    if (a.kind === 'dynarray' && b.kind === 'dynarray') {
      return typesEqual(a.elementType, b.elementType);
    }
    if (a.kind === 'pointer' && b.kind === 'pointer') {
      // Narrowing explícito: targetType puede ser 'string' (MathType string variant).
      if (typeof a.targetType === 'object' && typeof b.targetType === 'object' &&
          a.targetType.kind === 'struct' && b.targetType.kind === 'struct') {
        return a.targetType.name === b.targetType.name;
      }
      return typesEqual(a.targetType, b.targetType);
    }
    if (a.kind === 'struct' && b.kind === 'struct') {
      return a.name === b.name;
    }
    if (a.kind === 'function' && b.kind === 'function') {
      if (a.paramTypes.length !== b.paramTypes.length) return false;
      for (let i = 0; i < a.paramTypes.length; i++) {
        if (!typesEqual(a.paramTypes[i], b.paramTypes[i])) return false;
      }
      if (a.returnTypes.length !== b.returnTypes.length) return false;
      for (let i = 0; i < a.returnTypes.length; i++) {
        if (!typesEqual(a.returnTypes[i], b.returnTypes[i])) return false;
      }
      return true;
    }
  }
  return false;
}

export function semanticToWasmType(semType: MathType): 'i32' | 'i64' | 'f32' | 'f64' {
  if (semType === 'null') return 'i32';
  if (semType === 'tuple') throw new Error('No se puede convertir una tupla a tipo WASM');
  if (typeof semType !== 'string') {
    if (semType.kind === 'function') return 'i32';
    if (semType.kind === 'array' || semType.kind === 'dynarray' ||
      semType.kind === 'pointer' || semType.kind === 'struct') return 'i32';
  }

  switch (semType) {
    case 's32':
    case 'u32':
    case 'bool':
    case 'string':
      return 'i32';
    case 's64':
    case 'u64':
      return 'i64';
    case 'f32':
      return 'f32';
    case 'f64':
      return 'f64';
    default:
      throw new Error(`Tipo semántico no soportado: ${semType}`);
  }
}