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
  variadic?: boolean;
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
  boxed?: boolean;
}

export interface StringNode {
  kind: 'string';
  type: 'string';
  value: string;
}

export interface InterpolatedStringNode {
  kind: 'interpolated_string';
  parts: Array<string | MathNode>;
  type: 'string';
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
  variadic?: boolean;
  importedFrom?: string;
  resolvedBuiltin?: 'is_same' | { kind: 'len'; argumentType: ArrayType | DynArrayType };
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
  variadic?: boolean;
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
  arrayType?: ArrayType | DynArrayType;
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
  resolvedField?: StructField;
}

export interface IncrementNode {
  kind: 'increment';
  operator: '++' | '--';
  operand: MathNode;
  prefix: boolean;
  type: MathType;
}

export interface FunctionLiteralNode {
  kind: 'function_literal';
  params: { name: string; type: MathType; uniqueName?: string }[];
  returnTypes: MathType[];
  body: any[];
}

export interface CapturedVar {
  name: string;
  sourceUniqueName: string;
  type: MathType;
  index: number;
  boxed?: boolean;
}

export interface ClosureNode {
  kind: 'closure';
  codeName: string;
  captures: CapturedVar[];
  captureExprs: MathNode[];
  type: FunctionType;
}

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

export interface SizeOfNode {
  kind: 'size_of';
  targetType?: MathType;
  expr?: MathNode;
  identName?: string;
  value?: number;
  type: MathType;
}

export type MathNode =
  | ConstNode
  | VariableNode
  | UnaryNode
  | BinaryNode
  | StringNode
  | InterpolatedStringNode
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
  | CaptureAccessNode
  | SizeOfNode;

export interface MakeArrayNode {
  kind: 'make_array';
  typeExpr: MathType;
  lengthExpr: MathNode;
  elementType?: MathType;
  type?: DynArrayType;
}