/**
 * Módulo de Sistema de Tipos
 */

import { ArithmeticType, MathType, StructType } from './types';

export interface TypeInfo {
  kind: 'primitive' | 'struct' | 'array';
  size: number;
  align: number;
  fields?: { name: string; type: string; offset: number; mathType?: MathType }[];
  elementType?: string;
  length?: number;
  pointerTo?: string;
  name?: string;
}

export interface StructFieldInput {
  name: string;
  type: string;
  mathType?: MathType;
}

export interface StructFieldLayout extends StructFieldInput {
  offset: number;
}

export const arithInfo: Record<ArithmeticType, { signed: boolean; isFloat: boolean; width: number }> = {
  s32: { signed: true, isFloat: false, width: 32 },
  u32: { signed: false, isFloat: false, width: 32 },
  s64: { signed: true, isFloat: false, width: 64 },
  u64: { signed: false, isFloat: false, width: 64 },
  f32: { signed: true, isFloat: true, width: 32 },
  f64: { signed: true, isFloat: true, width: 64 },
};

export const signedness: Record<ArithmeticType, 'signed' | 'unsigned' | 'float'> =
  Object.fromEntries(
    Object.entries(arithInfo).map(([type, info]) => [
      type,
      info.isFloat ? 'float' : info.signed ? 'signed' : 'unsigned',
    ])
  ) as Record<ArithmeticType, 'signed' | 'unsigned' | 'float'>;

export const width: Record<ArithmeticType, number> = Object.fromEntries(
  Object.entries(arithInfo).map(([type, info]) => [type, info.width])
) as Record<ArithmeticType, number>;

export function maxArithmeticType(a: ArithmeticType, b: ArithmeticType): ArithmeticType {
  if (!arithInfo[a] || !arithInfo[b]) {
    throw new Error(
      `Se esperaban tipos aritméticos, se recibió (${String(a)}, ${String(b)})`
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

export function isArithmeticType(type: MathType): type is ArithmeticType {
  return typeof type === 'string' && Object.hasOwn(arithInfo, type);
}

export function isIntegerType(type: MathType): type is Exclude<ArithmeticType, 'f32' | 'f64'> {
  return type === 's32' || type === 'u32' || type === 's64' || type === 'u64';
}
// Global no definida
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
  if (a === b) return true;
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
      if (a.name !== '' || b.name !== '') return a.name === b.name;
      return a.fields.length === b.fields.length &&
        a.fields.every((field, index) =>
          field.name === b.fields[index].name &&
          typesEqual(field.type, b.fields[index].type)
        );
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

export function isAssignableType(source: MathType, target: MathType): boolean {
  if (typesEqual(source, target)) return true;

  if (isArithmeticType(source) && isArithmeticType(target)) {
    const from = arithInfo[source];
    const to = arithInfo[target];
    if (!from.isFloat && !to.isFloat && from.width < to.width) return true;
    if (!from.isFloat && to.isFloat && target === 'f64' && from.width <= 32) return true;
    if (from.isFloat && to.isFloat && source === 'f32' && target === 'f64') return true;
  }

  if (source === 'null' && typeof target === 'object' &&
      (target.kind === 'pointer' || target.kind === 'struct' ||
       target.kind === 'dynarray' || target.kind === 'function')) return true;

  if (typeof source === 'object' && source.kind === 'struct' &&
      typeof target === 'object' && target.kind === 'pointer') {
    return typesEqual(source, target.targetType);
  }
  if (typeof source === 'object' && source.kind === 'pointer' &&
      typeof target === 'object' && target.kind === 'pointer') {
    return typesEqual(source.targetType, target.targetType);
  }
  if (typeof source === 'object' && source.kind === 'array' &&
      typeof target === 'object' && target.kind === 'dynarray') {
    return isAssignableType(source.elementType, target.elementType);
  }
  return false;
}

export function describeType(type: MathType): string {
  if (typeof type !== 'object') return String(type);
  switch (type.kind) {
    case 'struct':
      return type.name === ''
        ? `struct { ${type.fields.map(field => `${field.name}: ${describeType(field.type)}`).join('; ')} }`
        : type.name;
    case 'pointer':
      return `*${describeType(type.targetType)}`;
    case 'function':
      return '(fn)';
    case 'array':
      return `[${describeType(type.elementType)}; ${type.length}]`;
    case 'dynarray':
      return `[${describeType(type.elementType)}]`;
  }
}

export function supportsStructuralEquality(type: StructType): boolean {
  const active = new Set<StructType>();

  const isComparable = (fieldType: MathType): boolean => {
    if (typeof fieldType !== 'object') return true;
    if (fieldType.kind === 'pointer') return true;
    if (fieldType.kind === 'array') {
      return fieldType.length <= 256 && isComparable(fieldType.elementType);
    }
    if (fieldType.kind !== 'struct' || active.has(fieldType)) return false;

    active.add(fieldType);
    const comparable = fieldType.fields.every(field => isComparable(field.type));
    active.delete(fieldType);
    return comparable;
  };

  active.add(type);
  const comparable = type.fields.every(field => isComparable(field.type));
  active.delete(type);
  return comparable;
}

function fieldSize(info: TypeInfo): number {
  return info.kind === 'struct' ? 4 : info.size;
}

function fieldAlign(info: TypeInfo): number {
  return info.kind === 'struct' ? 4 : info.align;
}

export function computeStructLayout(
  registry: TypeRegistry,
  fields: StructFieldInput[],
  selfName?: string
): { size: number; align: number; fields: StructFieldLayout[] } {
  let offset = 0;
  let maxAlign = 1;
  const fieldLayouts: StructFieldLayout[] = [];

  for (const field of fields) {
    let align: number;
    let size: number;

    if (selfName !== undefined && field.type === selfName) {
      align = 4;
      size = 4;
    } else {
      const info = registry.getType(field.type);
      align = fieldAlign(info);
      size = fieldSize(info);
    }

    offset = Math.ceil(offset / align) * align;
    fieldLayouts.push({
      name: field.name,
      type: field.type,
      offset,
      mathType: field.mathType,
    });
    offset += size;
    if (align > maxAlign) maxAlign = align;
  }

  const size = Math.max(1, Math.ceil(offset / maxAlign) * maxAlign);
  return { size, align: maxAlign, fields: fieldLayouts };
}

export class TypeRegistry {
  private types = new Map<string, TypeInfo>();

  constructor() {
    this.registerPrimitive('void', 0, 1);
    this.registerPrimitive('i32', 4, 4);
    this.registerPrimitive('i64', 8, 8);
    this.registerPrimitive('f32', 4, 4);
    this.registerPrimitive('f64', 8, 8);
    this.registerPrimitive('byte', 1, 1);
    this.registerPrimitive('int', 4, 4);
    this.registerPrimitive('long', 8, 8);
    this.registerPrimitive('float', 4, 4);
    this.registerPrimitive('double', 8, 8);
    this.registerPrimitive('bool', 1, 1);
    this.registerPrimitive('char', 1, 1);
    this.registerPrimitive('i8', 1, 1);
    this.registerPrimitive('u8', 1, 1);
    this.registerPrimitive('i16', 2, 2);
    this.registerPrimitive('u16', 2, 2);
    this.registerPrimitive('u32', 4, 4);
    this.registerPrimitive('u64', 8, 8);
    this.registerPrimitive('int8_t', 1, 1);
    this.registerPrimitive('uint8_t', 1, 1);
    this.registerPrimitive('int16_t', 2, 2);
    this.registerPrimitive('uint16_t', 2, 2);
    this.registerPrimitive('int32_t', 4, 4);
    this.registerPrimitive('uint32_t', 4, 4);
    this.registerPrimitive('int64_t', 8, 8);
    this.registerPrimitive('uint64_t', 8, 8);
    this.registerPrimitive('size_t', 4, 4);
    this.registerPrimitive('ssize_t', 4, 4);
    this.registerPrimitive('intptr_t', 4, 4);
    this.registerPrimitive('uintptr_t', 4, 4);
    this.registerPrimitive('usize', 4, 4);
    this.registerPrimitive('isize', 4, 4);
    this.registerPrimitive('uintptr', 4, 4);
    this.registerPrimitive('string', 4, 4);
  }

  registerPrimitive(name: string, size: number, align: number): void {
    if (this.types.has(name)) throw new Error(`El tipo '${name}' ya está registrado`);
    this.types.set(name, { kind: 'primitive', size, align, name });
  }

  registerStruct(name: string, fields: StructFieldInput[]): void {
    if (this.types.has(name)) throw new Error(`El tipo '${name}' ya está registrado`);
    const layout = computeStructLayout(this, fields, name);
    this.types.set(name, {
      kind: 'struct',
      size: layout.size,
      align: layout.align,
      fields: layout.fields,
      name,
    });
  }

  registerArray(name: string, elementType: string, length: number): void {
    if (this.types.has(name)) throw new Error(`El tipo '${name}' ya está registrado`);
    const elemInfo = this.getType(elementType);
    this.types.set(name, {
      kind: 'array',
      size: elemInfo.size * length,
      align: elemInfo.align,
      elementType,
      length,
      name,
    });
  }

  getType(name: string): TypeInfo {
    if (name.endsWith('*')) {
      const pointerTo = name.slice(0, -1);
      return { kind: 'primitive', size: 4, align: 4, pointerTo, name };
    }
    const info = this.types.get(name);
    if (!info) throw new Error(`Tipo no registrado: ${name}`);
    return info;
  }

  hasType(name: string): boolean {
    if (name.endsWith('*')) return true;
    return this.types.has(name);
  }

  getFieldType(structName: string, fieldName: string): TypeInfo {
    const structInfo = this.getType(structName);
    if (structInfo.kind !== 'struct') throw new Error(`'${structName}' no es un struct`);
    const field = structInfo.fields?.find(f => f.name === fieldName);
    if (!field) throw new Error(`Campo '${fieldName}' no encontrado en '${structName}'`);
    return this.getType(field.type);
  }

  resolvePath(structName: string, path: string[]): TypeInfo {
    let currentTypeName = structName;
    const visited = new Set<string>();

    for (const fieldName of path) {
      const fieldType = this.getFieldType(currentTypeName, fieldName);
      if (fieldType.pointerTo) currentTypeName = fieldType.pointerTo;
      else if (fieldType.kind === 'struct') currentTypeName = fieldType.name!;
      else return fieldType;

      if (visited.has(currentTypeName)) {
        throw new Error(`Ciclo detectado en ruta: ${currentTypeName}`);
      }
      visited.add(currentTypeName);
    }

    return this.getType(currentTypeName);
  }

  visitStruct(
    structName: string,
    visitor: (field: StructFieldLayout, depth: number) => void,
    depth = 0,
    visited = new Set<string>()
  ): void {
    const structInfo = this.getType(structName);
    if (structInfo.kind !== 'struct' || visited.has(structName)) return;
    visited.add(structName);

    for (const field of structInfo.fields ?? []) {
      visitor(field, depth);
      const fieldType = this.getType(field.type);
      if (fieldType.kind === 'struct') {
        this.visitStruct(field.type, visitor, depth + 1, visited);
      } else if (fieldType.pointerTo) {
        this.visitStruct(fieldType.pointerTo, visitor, depth + 1, visited);
      }
    }
  }

  getSize(name: string): number {
    return this.getType(name).size;
  }

  getAlign(name: string): number {
    return this.getType(name).align;
  }

  toJSON(): Record<string, TypeInfo> {
    return Object.fromEntries(this.types);
  }
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
      throw new Error(`Tipo semántico no soportado: ${typeof semType === 'string' ? semType : typeof semType as MathType
}`);
  }
}

// Tipo no registrado