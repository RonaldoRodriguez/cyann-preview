// mangler.ts
import { MathType, FunctionType } from './types';
import { typesEqual } from './typeSystem';

export function mangleType(t: MathType): string {
  if (typeof t === 'string') {
    switch (t) {
      case 's32':    return 'i';
      case 'u32':    return 'u';
      case 's64':    return 'I';
      case 'u64':    return 'U';
      case 'f32':    return 'f';
      case 'f64':    return 'F';
      case 'bool':   return 'b';
      case 'string': return 's';
      case 'null':   return 'n';
      case 'tuple':  return 'T';
      default: {
        const _exhaustive: never = t;
        throw new Error(`mangleType: string type no reconocido: ${String(_exhaustive)}`);
      }
    }
  }
  switch (t.kind) {
    case 'array':    return 'A' + mangleType(t.elementType) + '.' + t.length;
    case 'dynarray': return 'D' + mangleType(t.elementType);
    case 'struct': {
      if (t.name === '') {
        const fieldCodes = t.fields
          .map(f => `${f.name}:${mangleType(f.type)}`)
          .join(';');
        return 'S{' + fieldCodes + '}';
      }
      return 'S' + t.name;
    }
    case 'pointer':  return 'P' + mangleType(t.targetType);
    case 'function': {
      const params  = t.paramTypes.map(mangleType).join('.');
      const returns = t.returnTypes.map(mangleType).join('.');
      return 'F' + params + '~' + returns;
    }
    default: {
      const _exhaustive: never = t;
      throw new Error(`mangleType: kind no reconocido: ${JSON.stringify(_exhaustive)}`);
    }
  }
}

export function mangleFunctionName(name: string, paramTypes: MathType[]): string {
  if (paramTypes.length === 0) return `${name}__v`;
  return `${name}__${paramTypes.map(mangleType).join('_')}`;
}

export function functionParamsEqual(a: FunctionType, b: FunctionType): boolean {
  if (a.paramTypes.length !== b.paramTypes.length) return false;
  for (let i = 0; i < a.paramTypes.length; i++) {
    if (!typesEqual(a.paramTypes[i], b.paramTypes[i])) return false;
  }
  return true;
}