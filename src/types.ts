// types.ts

export type ValueType = 'i32' | 'i64' | 'f32' | 'f64' | 'string' | 'array' | 'struct' | 'void' | 'u32' | 'u64' | 'funcref' | 'externref';
export type WasmType = 'i32' | 'i64' | 'u32' | 'u64' | 'f32' | 'f64';

export type ArithmeticType = 's32' | 'u32' | 's64' | 'u64' | 'f32' | 'f64';

export interface LiteralInference {
  type: ArithmeticType;
  value: number | bigint;
}

export interface ArrayType {
  kind: 'array';
  elementType: MathType;
  length: number;
}

export interface DynArrayType {
  kind: 'dynarray';
  elementType: MathType;
}

export interface PointerType {
  kind: 'pointer';
  targetType: MathType;
}

export interface StructField {
  name: string;
  type: MathType;
  offset: number;
}

export interface StructType {
  kind: 'struct';
  name: string;
  fields: StructField[];
  size: number;
  align: number;
}

export interface FunctionType {
  kind: 'function';
  paramTypes: MathType[];
  returnTypes: MathType[];
}

export type MathType = ArithmeticType | 'string' | 'bool' | 'null' | 'tuple' | ArrayType | DynArrayType | PointerType | StructType | FunctionType;

// ─────────────────────────────────────────────
// Nodos AST (expresiones)
// ─────────────────────────────────────────────

export interface ConstNode {
  kind: 'const';
  type: ArithmeticType | 'null';
  value: number | bigint;
}

export interface VariableNode {
  kind: 'variable';
  name: string;
  type: MathType;
  uniqueName?: string;
  isGlobal?: boolean;
  /**
   * Si true, el local contiene un puntero a box (no el valor).
   * El codegen dereferencia con un load adicional tras el getLocal.
   */
  boxed?: boolean;
}

export interface StringNode {
  kind: 'string';
  type: 'string';
  value: string;
}

export interface BooleanLiteralNode {
  kind: 'bool';
  type: 'bool';
  value: boolean;
}

export interface UnaryNode {
  kind: 'unary';
  op: 'neg' | 'not' | 'bitnot';
  operand: MathNode;
  type?: MathType;
}

export interface BinaryNode {
  kind: 'binary';
  op: '+' | '-' | '*' | '/' | '%' | 'add' | 'sub' | 'mul' | 'div' | 'rem' |
      '==' | '!=' | '<' | '<=' | '>' | '>=' | '&&' | '||' |
      '&' | '|' | '^' | '<<' | '>>';
  left: MathNode;
  right: MathNode;
  type?: MathType;
}

export interface CastNode {
  kind: 'cast';
  operator: 'as';
  oldType: MathType;
  newType: MathType;
  operand: MathNode;
}

export interface CallNode {
  kind: 'call';
  name: string;
  args: MathNode[];
  type: MathType | 'void';
  paramTypes: MathType[];
  returnTypes?: MathType[];
  importedFrom?: string;
}

export interface FunctionRefNode {
  kind: 'function_ref';
  name: string;
  type: FunctionType;
}

export interface CallIndirectNode {
  kind: 'call_indirect';
  callee: MathNode;
  args: MathNode[];
  type: MathType | 'void';
  paramTypes: MathType[];
  returnTypes?: MathType[];
  hasImplicitSelf?: boolean;
}

export interface ArrayLiteralNode {
  kind: 'array_literal';
  elements: MathNode[];
  type: ArrayType | DynArrayType;
}

export interface ArrayAccessNode {
  kind: 'array_access';
  base: MathNode;
  index: MathNode;
  type: MathType;
  dynamic?: boolean;
}

export interface StructLiteralNode {
  kind: 'struct_literal';
  structName: string;
  fields: { name: string; value: MathNode }[];
  type: StructType;
}

export interface StructAccessNode {
  kind: 'struct_access';
  base: MathNode;
  fieldName: string;
  type: MathType;
  resolvedBaseType?: StructType;
}

export interface IncrementNode {
  kind: 'increment';
  operator: '++' | '--';
  operand: MathNode;
  prefix: boolean;
  type: MathType;
}

/**
 * Función anónima en el AST (producida por el parser). El semantic
 * analyzer la reemplaza in-place por un `ClosureNode` tras analizar
 * el cuerpo y detectar las capturas.
 */
export interface FunctionLiteralNode {
  kind: 'function_literal';
  params: { name: string; type: MathType; uniqueName?: string }[];
  returnType: MathType | null;
  body: any[];
}

/**
 * Captura de una variable del scope envolvente dentro de un env
 * de closure. Se almacena en el objeto env a `8 + 8*index`.
 */
export interface CapturedVar {
  /** Nombre de la variable en el scope exterior (para debug). */
  name: string;
  /** uniqueName de la variable exterior (referencia al slot real). */
  sourceUniqueName: string;
  type: MathType;
  index: number;
  /**
   * Si true, el local del outer ya es un pointer a box: el env
   * reusa ese pointer en vez de allocar un box nuevo. Necesario
   * para que mutaciones desde el lambda se reflejen en el outer.
   */
  boxed?: boolean;
}

/**
 * Expresión que crea un closure: reserva un env en el heap, guarda
 * el `code_idx` (índice de tabla de la función hoisteada) y copia
 * las capturas. El resultado es un i32 — puntero al env.
 */
export interface ClosureNode {
  kind: 'closure';
  codeName: string;
  captures: CapturedVar[];
  captureExprs: MathNode[];
  type: FunctionType;
}

/**
 * Acceso a una captura desde dentro del cuerpo del lambda. El codegen
 * lo traduce a `local.get __env; i32.load(8 + 8*index); load(type, 0)`.
 */
export interface CaptureAccessNode {
  kind: 'capture_access';
  captureIndex: number;
  type: MathType;
}

// ─────────────────────────────────────────────
// Patterns para switch
// ─────────────────────────────────────────────

export type PatternNode =
  | { kind: 'wildcard' }
  | { kind: 'const'; type: ArithmeticType | 'null'; value: number | bigint }
  | { kind: 'string'; value: string }
  | { kind: 'bool'; value: boolean }
  | { kind: 'struct'; structName: string; fields: { name: string; pattern: PatternNode }[] };

export type MathNode =
  | ConstNode
  | VariableNode
  | UnaryNode
  | BinaryNode
  | StringNode
  | CastNode
  | BooleanLiteralNode
  | CallNode
  | FunctionRefNode
  | CallIndirectNode
  | ArrayLiteralNode
  | ArrayAccessNode
  | StructLiteralNode
  | StructAccessNode
  | MakeArrayNode
  | IncrementNode
  | FunctionLiteralNode
  | ClosureNode
  | CaptureAccessNode;

// ─────────────────────────────────────────────
// TypeRegistry
// ─────────────────────────────────────────────

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

export interface MakeArrayNode {
  kind: 'make_array';
  /** Sintaxis del tipo, sin resolver (puede ser un alias). */
  typeExpr: MathType;
  lengthExpr: MathNode;
  /** Rellenados por el semantic analyzer. */
  elementType?: MathType;
  type?: DynArrayType;
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
    if (name.endsWith('*')) return true;  // pointer ad-hoc
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

      if (fieldType.pointerTo) {
        currentTypeName = fieldType.pointerTo;
      } else if (fieldType.kind === 'struct') {
        currentTypeName = fieldType.name!;
      } else {
        return fieldType;
      }

      if (visited.has(currentTypeName)) throw new Error(`Ciclo detectado en ruta: ${currentTypeName}`);
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
    if (structInfo.kind !== 'struct') return;

    if (visited.has(structName)) return;
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
    const result: Record<string, TypeInfo> = {};
    for (const [key, value] of this.types.entries()) {
      result[key] = value;
    }
    return result;
  }
}