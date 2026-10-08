import { FunctionIRBuilder, ModuleBuilder } from './compiler';
import type { AnalyzedProgram } from './semantic';
import { Optimizer } from './optimizer';
import { formatDiagnostic } from './diagnostics';
import {
  MathType, MathNode, BooleanLiteralNode, CallNode,
  FunctionRefNode, ArithmeticType, StructType,
  StructLiteralNode, StructAccessNode, ArrayLiteralNode, ArrayAccessNode,
  CallIndirectNode, VariableNode, MakeArrayNode, CastNode, BinaryNode,
  ClosureNode, CaptureAccessNode, PatternNode, SizeOfNode,
} from './types';
import {
  StatementNode, FunctionDefNode, VarConstNode, ShortVarDeclNode,
  AssignNode, IfNode, ForNode, ForInNode, ReturnNode, ExpressionStmtNode,
  ImportDeclNode, BreakNode, ContinueNode, SwitchNode, RegionNode,
  MultiDeclNode,
} from './parser';
import {
  sizeOfType, typesEqual, semanticToWasmType, maxArithmeticType,
  signedness, width, arithInfo, isArithmeticType,
} from './typeSystem';

export type CompileResult = MathType | 'void';

const HEAP_PAGES = 16;
const PAGE_SIZE  = 65536;
const LOG2_PAGE_SIZE = 16;

// ─── Layout de env de closures ──────────────────────────────────────────
//   offset 0:          índice de tabla de la función (i32)
//   offset 4 + 4*i:    captura i (i32)
// Slot de 4 bytes por captura.
// ────────────────────────────────────────────────────────────────────────

const RT_SAVE     = 'arena_save';
const RT_RESTORE  = 'arena_restore';
const RT_ALLOC    = 'arena_alloc';
const RT_PTR      = '__heap_ptr';
const RT_MEM_END  = '__mem_end';

function isInlineValue(t: MathType): boolean {
  return typeof t === 'object' && t.kind === 'array';
}
function isNullablePointerType(t: MathType): boolean {
  if (typeof t !== 'object') return false;
  return t.kind === 'pointer' || t.kind === 'struct' || t.kind === 'dynarray';
}
function getStructType(t: MathType): StructType | null {
  if (typeof t !== 'object') return null;
  if (t.kind === 'struct') return t;
  if (t.kind === 'pointer' && typeof t.targetType === 'object' && t.targetType.kind === 'struct') return t.targetType;
  return null;
}
function isArithType(t: MathType | undefined): t is ArithmeticType {
  return t !== undefined && isArithmeticType(t);
}

export function canConvertF64ToF32(value: number): boolean {
  if (!Number.isFinite(value)) return false;
  const f32 = Math.fround(value);
  return Math.abs(f32 - value) <= Math.abs(value) * 1e-7;
}

export function tryImplicitConvert(b: FunctionIRBuilder, from: MathType, to: MathType): boolean {
  if (typesEqual(from, to)) return true;
  if (from === 'null' || to === 'null') return false;
  if (typeof from !== 'string' || typeof to !== 'string') return false;
  if (from === 'string' || to === 'string' || from === 'bool' || to === 'bool') return false;
  const fi = arithInfo[from as ArithmeticType];
  const ti = arithInfo[to as ArithmeticType];
  if (!fi || !ti) return false;
  if (!fi.isFloat && !ti.isFloat) {
    if (fi.width < ti.width) {
      fi.signed ? b.i64ExtendI32S() : b.i64ExtendI32U();
      return true;
    }
    return false;
  }
  if (!fi.isFloat && ti.isFloat) {
    switch (from as ArithmeticType) {
      case 's32': b.f64ConvertI32S(); break;
      case 'u32': b.f64ConvertI32U(); break;
      case 's64': b.f64ConvertI64S(); break;
      case 'u64': b.f64ConvertI64U(); break;
    }
    if (to === 'f32') b.f32DemoteF64();
    return true;
  }
  if (from === 'f32' && to === 'f64') { b.f64PromoteF32(); return true; }
  return false;
}

export function handleImplicitConversion(
  b: FunctionIRBuilder, exprAst: MathNode, from: MathType, to: MathType
): void {
  if (typesEqual(from, to)) return;
  if ((from === 'string' && (to === 's32' || to === 'u32')) ||
      (to === 'string' && (from === 's32' || from === 'u32'))) return;

  if (from === 'null' && typeof to === 'object' &&
      (to.kind === 'pointer' || to.kind === 'struct' ||
       to.kind === 'dynarray' || to.kind === 'function')) return;

  const fromStruct = getStructType(from);
  const toStructPointer = typeof to === 'object' && to.kind === 'pointer' ? getStructType(to.targetType) : null;
  if (fromStruct && toStructPointer && fromStruct.name === toStructPointer.name) return;
  if (from === 'null' || to === 'null') throw new Error(`Type mismatch: null → ${to}`);
  if (from === 'tuple' || to === 'tuple') throw new Error('No se puede convertir una tupla');

  if (typeof from === 'object' && from.kind === 'array' &&
      typeof to === 'object' && to.kind === 'dynarray' &&
      typesEqual(from.elementType, to.elementType)) {
    const elemSize = sizeOfType(from.elementType);
    const totalBytes = elemSize * from.length;
    const src = `$promo_src_${Math.random().toString(36).slice(2, 7)}`;
    b.addLocal(src, 'i32'); b.setLocal(src);
    b.i32Const(4 + totalBytes); b.callByName(RT_ALLOC);
    const base = `$promo_base_${Math.random().toString(36).slice(2, 7)}`;
    b.addLocal(base, 'i32'); b.setLocal(base);
    b.getLocal(base); b.i32Const(from.length); b.i32Store();
    b.getLocal(base); b.i32Const(4); b.i32Add();
    b.getLocal(src); b.i32Const(totalBytes); b.callByName('memcpy');
    b.getLocal(base); b.i32Const(4); b.i32Add();
    return;
  }

  if (typeof from !== 'string' || typeof to !== 'string') throw new Error(`Type mismatch: compuesto (${typeof from === 'string' ? from : typeof from as MathType} → ${typeof to === 'string' ? to : typeof to as MathType
})`);
  if (from === 'string' || to === 'string' || from === 'bool' || to === 'bool') throw new Error(`Type mismatch: ${typeof to === 'string' ? to : typeof to as MathType
} → ${typeof to === 'string' ? to : typeof to as MathType
}`);

  if (from === 'f64' && to === 'f32') {
    if (!canConvertF64ToF32((exprAst as any).value ?? 0)) {
      throw new Error('Conversión implícita f64→f32 requiere const convertible');
    }
    b.f32DemoteF64();
    return;
  }
  if (!tryImplicitConvert(b, from, to)) throw new Error(`Type mismatch: ${from} → ${to}`);
}

export function emitLoadForType(b: FunctionIRBuilder, t: MathType, offset = 0): void {
  if (typeof t === 'object' && t.kind === 'array') {
    if (offset > 0) { b.i32Const(offset); b.i32Add(); }
    return;
  }
  if (typeof t !== 'string') { b.i32Load(offset); return; }
  switch (t) {
    case 's32': case 'u32': case 'bool': case 'string': b.i32Load(offset); break;
    case 's64': case 'u64': b.i64Load(offset); break;
    case 'f32': b.f32Load(offset); break;
    case 'f64': b.f64Load(offset); break;
    default: throw new Error(`Load no soportado para ${t}`);
  }
}
// cast entre compuestos no soportado
export function emitStoreForType(b: FunctionIRBuilder, t: MathType, offset = 0): void {
  if (typeof t === 'object' && t.kind === 'array') {
    const total = sizeOfType(t);
    const srcName = `$store_arr_src_${Math.random().toString(36).slice(2, 7)}`;
    const baseName = `$store_arr_base_${Math.random().toString(36).slice(2, 7)}`;
    b.addLocal(srcName, 'i32');
    b.addLocal(baseName, 'i32');
    b.setLocal(srcName);
    b.setLocal(baseName);
    b.getLocal(baseName);
    if (offset > 0) { b.i32Const(offset); b.i32Add(); }
    b.getLocal(srcName);
    b.i32Const(total);
    b.callByName('memcpy');
    return;
  }
  if (typeof t !== 'string') { b.i32Store(offset); return; }
  switch (t) {
    case 's32': case 'u32': case 'bool': case 'string': b.i32Store(offset); break;
    case 's64': case 'u64': b.i64Store(offset); break;
    case 'f32': b.f32Store(offset); break;
    case 'f64': b.f64Store(offset); break;
    default: throw new Error(`Store no soportado para ${t}`);
  }
}

// ─────────────────────────────────────────────────────────────────────
// ExpressionCompiler
// ─────────────────────────────────────────────────────────────────────
export class ExpressionCompiler {
  private tmp = 0;

  constructor(
    private b: FunctionIRBuilder,
    private module: ModuleBuilder,
    private envFunctions: Set<string> = new Set(),
    private zeroCaptureClosures: Set<string> = new Set(),
  ) {}

  compile(node: MathNode): CompileResult { return this.compileNode(node); }

  private compileValue(node: MathNode): MathType {
    const t = this.compileNode(node);
    if (t === 'void') throw new Error('Expresión void usada como valor');
    return t;
  }

  private fresh(prefix: string, ty: 'i32'|'i64'|'f32'|'f64' = 'i32'): string {
    const name = `$${prefix}_${this.tmp++}`;
    this.b.addLocal(name, ty);
    return name;
  }

  private compileNode(node: MathNode): CompileResult {
    switch (node.kind) {
      case 'const': {
        if (node.type === 'null') { this.b.i32Const(-1); return 'null'; }
        switch (node.type) {
          case 's32': case 'u32': this.b.i32Const(Number(node.value)); break;
          case 's64': case 'u64': this.b.i64Const(BigInt(node.value as any)); break;
          case 'f32': this.b.f32Const(Number(node.value)); break;
          case 'f64': this.b.f64Const(Number(node.value)); break;
        }
        return node.type;
      }
      case 'bool': this.b.i32Const((node as BooleanLiteralNode).value ? 1 : 0); return 'bool';
      case 'variable': {
        const v = node as VariableNode & { uniqueName?: string; isGlobal?: boolean; boxed?: boolean };
        if (v.isGlobal) this.b.globalGet(v.name);
        else this.b.getLocal(v.uniqueName ?? v.name);
        if (v.boxed) {
          emitLoadForType(this.b, v.type, 0);
        }
        return v.type;
      }
      case 'string': this.b.addString((node as any).value); return 'string';
      case 'interpolated_string': {
        let hasValue = false;
        for (const part of node.parts) {
          let partType: MathType;
          if (typeof part === 'string') {
            this.b.addString(part);
            partType = 'string';
          } else {
            partType = this.compileValue(part);
            if (partType === 'bool') {
              this.b.callByName('__bool_to_string');
            } else if (partType === 's32') {
              this.b.callByName('__s32_to_string');
            } else if (partType === 'u32') {
              this.b.callByName('__u32_to_string');
            } else if (partType !== 'string') {
              throw new Error(`Tipo no compatible con interpolación: ${String(partType)}`);
            }
          }
          if (hasValue) this.b.callByName('str_concat');
          hasValue = true;
        }
        if (!hasValue) this.b.addString('');
        return 'string';
      }

      case 'function_ref': {
        const r = node as FunctionRefNode;
        this.b.envAddrByName(r.name);
        return r.type;
      }

      case 'closure': {
        const c = node as ClosureNode;
        if (c.captures.length === 0 && this.zeroCaptureClosures.has(c.codeName)) {
          this.b.envAddrByName(c.codeName);
          return c.type;
        }
        const envSize = 4 * (1 + c.captures.length);
        this.b.i32Const(envSize);
        this.b.callByName(RT_ALLOC);
        const base = this.fresh('closure', 'i32');
        this.b.setLocal(base);

        this.b.getLocal(base);
        this.b.functionIndexByName(c.codeName);
        this.b.i32Store(0);

        for (let i = 0; i < c.captures.length; i++) {
          const cap = c.captures[i];
          const expr = c.captureExprs[i];

          if (cap.boxed) {
            this.b.getLocal(base);
            this.compileValue(expr);
            this.b.i32Store(4 + 4 * i);
            continue;
          }

          const boxSize = sizeOfType(cap.type);
          this.b.i32Const(boxSize);
          this.b.callByName(RT_ALLOC);
          const box = this.fresh('capbox', 'i32');
          this.b.setLocal(box);
          this.b.getLocal(box);
          const at = this.compileValue(expr);
          if (!typesEqual(at, cap.type)) {
            handleImplicitConversion(this.b, expr, at, cap.type);
          }
          emitStoreForType(this.b, cap.type, 0);

          this.b.getLocal(base);
          this.b.getLocal(box);
          this.b.i32Store(4 + 4 * i);
        }

        this.b.getLocal(base);
        return c.type;
      }

      case 'capture_access': {
        const ca = node as CaptureAccessNode;
        this.b.getLocal('__env');
        this.b.i32Load(4 + 4 * ca.captureIndex);
        emitLoadForType(this.b, ca.type, 0);
        return ca.type;
      }

      case 'call_indirect': {
        const c = node as CallIndirectNode;
        this.compileValue(c.callee);
        const clos = this.fresh('closure', 'i32');
        this.b.setLocal(clos);

        this.b.getLocal(clos);

        for (let i = 0; i < c.args.length; i++) {
          const at = this.compileValue(c.args[i]);
          if (c.hasImplicitSelf && i === 0) continue;
          const et = c.paramTypes[i];
          if (!typesEqual(at, et)) handleImplicitConversion(this.b, c.args[i], at, et);
        }

        this.b.getLocal(clos);
        this.b.i32Load(0);

        const wp: any[] = ['i32', ...c.paramTypes.map(t => semanticToWasmType(t))];
        const wr = (c.returnTypes ?? []).map(t => semanticToWasmType(t));
        const typeIdx = this.module.getTypeIndex(wp, wr);
        this.b.callIndirect(typeIdx);
        return c.returnTypes?.[0] ?? 'void';
      }
      case 'unary': {
        const ty = this.compileValue(node.operand);
        if (node.op === 'not') { this.b.i32Eqz(); return 'bool'; }
        if (node.op === 'bitnot') {
          if (ty === 's32' || ty === 'u32') { this.b.i32Const(-1); this.b.i32Xor(); }
          else if (ty === 's64' || ty === 'u64') { this.b.i64Const(-1n); this.b.i64Xor(); }
          else throw new Error(`~ no soportado para ${ty}`);
          return ty as ArithmeticType;
        }
        if (node.op === 'neg') {
          if (ty === 'f32') this.b.f32Neg();
          else if (ty === 'f64') this.b.f64Neg();
          else if (ty === 's32' || ty === 'u32') { this.b.i32Const(-1); this.b.i32Mul(); }
          else if (ty === 's64' || ty === 'u64') { this.b.i64Const(-1n); this.b.i64Mul(); }
          else throw new Error(`Negación no soportada para ${ty}`);
          return ty as ArithmeticType;
        }
        throw new Error('Unario no soportado');
      }

      case 'size_of': {
        const s = node as SizeOfNode;
        this.b.i32Const(s.value ?? 0);
        return 's32';
      }

      case 'make_array': {
        const n = node as MakeArrayNode;
        const es = sizeOfType(n.elementType!);
        const lenT = this.compileValue(n.lengthExpr);
        const lt = this.fresh('len', 'i32'); this.b.setLocal(lt);
        this.b.getLocal(lt); this.b.i32Const(es); this.b.i32Mul();
        this.b.i32Const(4); this.b.i32Add();
        this.b.callByName(RT_ALLOC);
        const base = this.fresh('makearr', 'i32'); this.b.setLocal(base);
        this.b.getLocal(base); this.b.getLocal(lt); this.b.i32Store();
        this.b.getLocal(base); this.b.i32Const(4); this.b.i32Add();
        return n.type!;
      }
      case 'binary':
        return this.compileBinary(node as BinaryNode);
      case 'cast': {
        const c = node as CastNode;
        const from = this.compileValue(c.operand);
        const to = c.newType;
        if (typesEqual(from, to)) return to;
        if ((from === 'string' && (to === 's32' || to === 'u32')) ||
            (to === 'string' && (from === 's32' || from === 'u32'))) return to;
        if ((from === 'bool' && (to === 's32' || to === 'u32')) ||
            (to === 'bool' && (from === 's32' || from === 'u32'))) return to;
        if (typeof from === 'object' && from.kind ==='struct' && (to === 's32')) return to;
        if (typeof to === 'object' && to.kind ==='struct' && (from === 's32')) return to;
        if (typeof from === 'object' && from.kind ==='dynarray' && (to === 's32')) return to;

        if (typeof from !== 'string' || typeof to !== 'string') {
          throw new Error(`cast entre compuestos no soportado (${from} → ${to})`);
        }
        this.emitConversion(from as ArithmeticType, to as ArithmeticType);
        return to;
      }

      case 'call': {
        const c = node as CallNode;

        if (c.resolvedBuiltin === 'is_same') {
          this.compileValue(c.args[0]);
          this.compileValue(c.args[1]);
          this.b.i32Eq();
          return 'bool';
        }
        if (typeof c.resolvedBuiltin === 'object' && c.resolvedBuiltin.kind === 'len') {
          const at = c.resolvedBuiltin.argumentType;
          if (at.kind === 'dynarray') {
            this.compileValue(c.args[0]);
            this.b.i32Const(4); this.b.i32Sub(); this.b.i32Load();
            return 's32';
          }
          this.b.i32Const(at.length);
          return 's32';
        }

        if (this.envFunctions.has(c.name)) {
          this.b.i32Const(0);
        }
        for (let i = 0; i < c.args.length; i++) {
          const at = this.compileValue(c.args[i]);
          const et = c.paramTypes[i];
          if (!typesEqual(at, et)) handleImplicitConversion(this.b, c.args[i], at, et);
        }
        this.b.callByName(c.name);
        return c.type;
      }
      case 'struct_literal': {
        const s = node as StructLiteralNode;
        const st = s.type as StructType;
        this.b.i32Const(st.size);
        this.b.callByName(RT_ALLOC);
        const base = this.fresh('struct', 'i32'); this.b.setLocal(base);
        for (const fv of s.fields) {
          const fd = st.fields.find(f => f.name === fv.name)!;
          this.b.getLocal(base);
          const at = this.compileValue(fv.value);
          if (!typesEqual(at, fd.type)) handleImplicitConversion(this.b, fv.value, at, fd.type);
          emitStoreForType(this.b, fd.type, fd.offset);
        }
        this.b.getLocal(base);
        return st;
    
      }
      case 'struct_access': {
        const a = node as StructAccessNode;
        const baseValueType = this.compileValue(a.base);
        const field = a.resolvedField!;
        const base = this.fresh('struct_base', 'i32'); this.b.setLocal(base);
        if (isNullablePointerType(baseValueType)) this.assertNotNullPointer(base);
        this.b.getLocal(base);
        if (isInlineValue(field.type)) { this.b.i32Const(field.offset); this.b.i32Add(); return field.type; }
        emitLoadForType(this.b, field.type, field.offset);
        return field.type;
      }
      case 'array_literal': {
        const a = node as ArrayLiteralNode;
        const arrayType = a.type;
        const elementType = arrayType.elementType;
        const elemSize = sizeOfType(elementType);
        const total = elemSize * a.elements.length;
        let data: string;
        if (arrayType.kind === 'dynarray') {
          const allocation = this.fresh('dynarr_alloc', 'i32');
          this.b.i32Const(4 + total); this.b.callByName(RT_ALLOC); this.b.setLocal(allocation);
          this.b.getLocal(allocation); this.b.i32Const(a.elements.length); this.b.i32Store();
          data = this.fresh('dynarr_data', 'i32');
          this.b.getLocal(allocation); this.b.i32Const(4); this.b.i32Add(); this.b.setLocal(data);
        } else {
          data = this.fresh('arr', 'i32');
          this.b.i32Const(total); this.b.callByName(RT_ALLOC); this.b.setLocal(data);
        }
        for (let i = 0; i < a.elements.length; i++) {
          this.b.getLocal(data);
          const at = this.compileValue(a.elements[i]);
          if (!typesEqual(at, elementType)) {
            handleImplicitConversion(this.b, a.elements[i], at, elementType);
          }
          emitStoreForType(this.b, elementType, i * elemSize);
        }
        this.b.getLocal(data);
        return arrayType;
      }
      case 'array_access': {
        const a = node as ArrayAccessNode;
        this.compileValue(a.base);
        const bt = a.arrayType!;
        const base = this.fresh('ab', 'i32'); this.b.setLocal(base);
        this.compileValue(a.index);
        const idx = this.fresh('ai', 'i32'); this.b.setLocal(idx);
        this.b.getLocal(idx); this.b.i32Const(0); this.b.i32LtS();
        this.b.if_('void'); this.b.unreachable(); this.b.end();
        this.b.getLocal(idx);
        if (bt.kind === 'dynarray') {
          this.b.getLocal(base); this.b.i32Const(4); this.b.i32Sub(); this.b.i32Load();
        } else this.b.i32Const(bt.length);
        this.b.i32GeS();
        this.b.if_('void'); this.b.unreachable(); this.b.end();
        const es = sizeOfType(bt.elementType);
        this.b.getLocal(base); this.b.getLocal(idx); this.b.i32Const(es); this.b.i32Mul(); this.b.i32Add();
        if (isInlineValue(bt.elementType)) return bt.elementType;
        emitLoadForType(this.b, bt.elementType);
        return bt.elementType;
      }

      case 'increment': return this.compileIncrement(node as any);
      default: throw new Error(`Nodo no soportado en codegen: ${(node as any).kind}`);
    }
  }

  private compileBinary(node: BinaryNode): CompileResult {
    const leftPreview  = ((node.left  as any).type) as MathType | undefined;
    const rightPreview = ((node.right as any).type) as MathType | undefined;

    if (leftPreview && rightPreview
        && typeof leftPreview === 'object' && leftPreview.kind === 'struct'
        && typeof rightPreview === 'object' && rightPreview.kind === 'struct'
        && typesEqual(leftPreview, rightPreview)
        && (node.op === '==' || node.op === '!=')) {
      this.compileStructEq(node.left, node.right, leftPreview);
      if (node.op === '!=') this.b.i32Eqz();
      return 'bool';
    }

    const sameArith =
      isArithType(leftPreview) && isArithType(rightPreview) &&
      leftPreview === rightPreview;

    const bothString = leftPreview === 'string' && rightPreview === 'string';
    const bothBool   = leftPreview === 'bool'   && rightPreview === 'bool';
    const nullCmp    = (leftPreview === 'null' || rightPreview === 'null') &&
                       (node.op === '==' || node.op === '!=');

    if (sameArith || bothString || bothBool || nullCmp) {
      return this.compileBinaryOnStack(node);
    }
    return this.compileBinaryWithTemps(node);
  }

  private compileStructEq(left: MathNode, right: MathNode, st: StructType): void {
    this.compileValue(left);
    this.compileValue(right);
    this.emitNestedStructEq(st);
  }

  public emitPatternMatchOnStack(pattern: PatternNode, type: MathType): void {
    switch (pattern.kind) {
      case 'wildcard':
        this.b.drop();
        this.b.i32Const(1);
        return;

      case 'const': {
        if (pattern.type === 'null') {
          this.b.i32Const(-1);
          this.b.i32Eq();
          return;
        }
        const litType = pattern.type as ArithmeticType;
        const litValue = pattern.value;
        switch (litType) {
          case 's32': case 'u32': this.b.i32Const(Number(litValue)); break;
          case 's64': case 'u64': this.b.i64Const(BigInt(litValue as any)); break;
          case 'f32': this.b.f32Const(Number(litValue)); break;
          case 'f64': this.b.f64Const(Number(litValue)); break;
        }
        if (!typesEqual(litType, type)) {
          if (type === 's64' || type === 'u64') {
            if (litType === 's32') this.b.i64ExtendI32S();
            else if (litType === 'u32') this.b.i64ExtendI32U();
            else throw new Error(`pattern: conversión ${litType} → ${type} no soportada`);
          } else if (type === 'f64') {
            if (litType === 's32') this.b.f64ConvertI32S();
            else if (litType === 'u32') this.b.f64ConvertI32U();
            else if (litType === 's64') this.b.f64ConvertI64S();
            else if (litType === 'u64') this.b.f64ConvertI64U();
            else if (litType === 'f32') this.b.f64PromoteF32();
          } else if (type === 'f32') {
            if (litType === 's32') this.b.f32ConvertI32S();
            else if (litType === 'u32') this.b.f32ConvertI32U();
            else if (litType === 's64') this.b.f32ConvertI64S();
            else if (litType === 'u64') this.b.f32ConvertI64U();
            else if (litType === 'f64') this.b.f32DemoteF64();
          } else if (type === 's32' || type === 'u32') {
            if (litType === 's64' || litType === 'u64') this.b.i32WrapI64();
          } else {
            throw new Error(`pattern: conversión ${litType} → ${type} no soportada`);
          }
        }
        if (type === 'f32') this.b.f32Eq();
        else if (type === 'f64') this.b.f64Eq();
        else if (type === 's64' || type === 'u64') this.b.i64Eq();
        else this.b.i32Eq();
        return;
      }

      case 'string': {
        this.b.addString(pattern.value);
        this.b.callByName('str_eq');
        return;
      }

      case 'bool': {
        this.b.i32Const(pattern.value ? 1 : 0);
        this.b.i32Eq();
        return;
      }

      case 'struct': {
        const st = type as StructType;
        const ptrLocal = this.fresh('pm_ptr', 'i32');
        this.b.setLocal(ptrLocal);
        this.b.getLocal(ptrLocal);
        this.b.i32Const(-1);
        this.b.i32Ne();
        for (const fp of pattern.fields) {
          if (fp.pattern.kind === 'wildcard') continue;
          const field = st.fields.find(f => f.name === fp.name)!;
          this.b.getLocal(ptrLocal);
          emitLoadForType(this.b, field.type, field.offset);
          this.emitPatternMatchOnStack(fp.pattern, field.type);
          this.b.i32And();
        }
        return;
      }
    }
  }
  private emitStructEqBody(ltmp: string, rtmp: string, st: StructType): void {
    let first = true;
    for (const field of st.fields) {
      const ft = field.type;
      this.b.getLocal(ltmp);
      emitLoadForType(this.b, ft, field.offset);
      this.b.getLocal(rtmp);
      emitLoadForType(this.b, ft, field.offset);
      this.emitEqForType(ft);
      if (first) first = false;
      else this.b.i32And();
    }
    if (first) this.b.i32Const(1);
  }

  private emitEqForType(t: MathType): void {
    if (t === 'string') { this.b.callByName('str_eq'); return; }
    if (t === 'f32')    { this.b.f32Eq(); return; }
    if (t === 'f64')    { this.b.f64Eq(); return; }
    if (t === 's64' || t === 'u64') { this.b.i64Eq(); return; }
    if (typeof t === 'object' && t.kind === 'struct') {
      this.emitNestedStructEq(t);
      return;
    }
    if (typeof t === 'object' && t.kind === 'array') {
      this.emitArrayEq(t.elementType, t.length);
      return;
    }
    this.b.i32Eq();
  }

  private emitNestedStructEq(st: StructType): void {
    const lp = this.fresh('ns_L', 'i32');
    const rp = this.fresh('ns_R', 'i32');
    this.b.setLocal(rp);
    this.b.setLocal(lp);

    this.b.getLocal(lp);
    this.b.getLocal(rp);
    this.b.i32Eq();
    this.b.if_('i32');
      this.b.i32Const(1);
    this.b.else_();
      this.b.getLocal(lp);
      this.b.i32Const(-1);
      this.b.i32Eq();
      this.b.if_('i32');
        this.b.i32Const(0);
      this.b.else_();
        this.b.getLocal(rp);
        this.b.i32Const(-1);
        this.b.i32Eq();
        this.b.if_('i32');
          this.b.i32Const(0);
        this.b.else_();
          this.emitStructEqBody(lp, rp, st);
        this.b.end();
      this.b.end();
    this.b.end();
  }

  private emitArrayEq(elemType: MathType, length: number): void {
    const lp = this.fresh('ae_L', 'i32');
    const rp = this.fresh('ae_R', 'i32');
    this.b.setLocal(rp);
    this.b.setLocal(lp);

    const elemSize = sizeOfType(elemType);
    let first = true;
    for (let i = 0; i < length; i++) {
      this.b.getLocal(lp);
      emitLoadForType(this.b, elemType, i * elemSize);
      this.b.getLocal(rp);
      emitLoadForType(this.b, elemType, i * elemSize);
      this.emitEqForType(elemType);
      if (first) first = false;
      else this.b.i32And();
    }
    if (first) this.b.i32Const(1);
  }

  private compileBinaryOnStack(node: BinaryNode): CompileResult {
    const lt = this.compileValue(node.left);
    const rt = this.compileValue(node.right);

    return this.compileBinaryOperands(node, lt, rt, true, () => {}, () => {});
  }

  private compileBinaryWithTemps(node: BinaryNode): CompileResult {
    const lt = this.compileValue(node.left);
    const ltmp = this.fresh('L', semanticToWasmType(lt) as any); this.b.setLocal(ltmp);
    const rt = this.compileValue(node.right);
    const rtmp = this.fresh('R', semanticToWasmType(rt) as any); this.b.setLocal(rtmp);

    return this.compileBinaryOperands(
      node,
      lt,
      rt,
      false,
      () => this.b.getLocal(ltmp),
      () => this.b.getLocal(rtmp),
    );
  }

  private compileBinaryOperands(
    node: BinaryNode,
    lt: MathType,
    rt: MathType,
    operandsOnStack: boolean,
    pushLeft: () => void,
    pushRight: () => void,
  ): CompileResult {
    const pushOperands = () => {
      if (operandsOnStack) return;
      pushLeft();
      pushRight();
    };

    if (lt === 'null' || rt === 'null') {
      if (node.op === '==' || node.op === '!=') {
        pushOperands();
        this.b.i32Ne();
        if (node.op === '==') this.b.i32Eqz();
        return 'bool';
      }
      throw new Error('Operación no soportada con null');
    }

    if (node.op === '&&' || node.op === '||') {
      pushOperands();
      if (node.op === '&&') this.b.i32And(); else this.b.i32Or();
      return 'bool';
    }

    if (lt === 'string' && rt === 'string') {
      pushOperands();
      if (node.op === '+') { this.b.callByName('str_concat'); return 'string'; }
      if (node.op === '==') { this.b.callByName('str_eq'); return 'bool'; }
      if (node.op === '!=') { this.b.callByName('str_ne'); return 'bool'; }
      if (node.op === '<' || node.op === '<=' || node.op === '>' || node.op === '>=') {
        this.b.callByName('str_cmp');
        this.b.i32Const(0);
        switch (node.op) {
          case '<': this.b.i32LtS(); break;
          case '<=': this.b.i32LeS(); break;
          case '>': this.b.i32GtS(); break;
          case '>=': this.b.i32GeS(); break;
        }
        return 'bool';
      }
      throw new Error(`Operación '${node.op}' no soportada entre strings`);
    }

    if (lt === 'bool' && rt === 'bool') {
      pushOperands();
      switch (node.op) {
        case '==': this.b.i32Eq(); return 'bool';
        case '!=': this.b.i32Ne(); return 'bool';
        default: throw new Error(`Operación '${node.op}' no soportada entre bools`);
      }
    }

    if (lt !== rt || !isArithType(lt)) {
      if (operandsOnStack) {
        throw new Error(`compileBinaryOnStack: tipos inesperados (${String(lt)} vs ${String(rt)})`);
      }
    }

    const leftType = lt as ArithmeticType;
    const rightType = rt as ArithmeticType;
    const resultType = maxArithmeticType(leftType, rightType);
    if (operandsOnStack) {
      if (lt !== resultType || rt !== resultType) {
        throw new Error('Operandos aritméticos sin normalizar en codegen');
      }
    } else {
      pushLeft();
      if (leftType !== resultType) this.emitConversion(leftType, resultType);
      pushRight();
      if (rightType !== resultType) this.emitConversion(rightType, resultType);
    }

    if (['==','!=','<','<=','>','>='].includes(node.op)) {
      this.emitComparison(node.op, resultType);
      return 'bool';
    }

    if (['&','|','^','<<','>>'].includes(node.op)) {
      this.emitBitwise(node.op, resultType);
      return resultType;
    }

    this.emitBinary(node.op, resultType);
    return resultType;
  }

  public compileIncrementAsStatement(node: {
    operator: '++' | '--';
    operand: MathNode;
    prefix: boolean;
    type: MathType;
  }): void {
    const operand = node.operand as any;
    const type = operand.type as ArithmeticType;

    let targetAddress: string | null = null;

    if (operand.kind === 'variable') {
      const variable = operand as VariableNode & { uniqueName?: string; isGlobal?: boolean; boxed?: boolean };
      if (variable.isGlobal) this.b.globalGet(variable.name);
      else this.b.getLocal(variable.uniqueName ?? variable.name);
      if (variable.boxed) emitLoadForType(this.b, type, 0);
    } else {
      targetAddress = this.emitIncrementAddress(operand);
      this.b.getLocal(targetAddress);
      emitLoadForType(this.b, type);
    }

    this.emitIncrementOperation(type, node.operator);

    if (operand.kind === 'variable') {
      const variable = operand as VariableNode & { uniqueName?: string; isGlobal?: boolean; boxed?: boolean };
      if (variable.boxed) {
        const tmp = this.fresh('inc_boxv', semanticToWasmType(type) as any);
        this.b.setLocal(tmp);
        if (variable.isGlobal) this.b.globalGet(variable.name);
        else this.b.getLocal(variable.uniqueName ?? variable.name);
        this.b.getLocal(tmp);
        emitStoreForType(this.b, type, 0);
      } else {
        if (variable.isGlobal) this.b.globalSet(variable.name);
        else this.b.setLocal(variable.uniqueName ?? variable.name);
      }
    } else {
      const newValue = this.fresh('inc_new', semanticToWasmType(type) as any);
      this.b.setLocal(newValue);
      this.b.getLocal(targetAddress!);
      this.b.getLocal(newValue);
      emitStoreForType(this.b, type);
    }
  }

  private compileIncrement(node: { operator: '++' | '--'; operand: MathNode; prefix: boolean; type: MathType }): MathType {
    const operand = node.operand as any;
    const type = node.type as ArithmeticType;
    const oldValue = this.fresh('inc_old', semanticToWasmType(type) as any);
    const newValue = this.fresh('inc_new', semanticToWasmType(type) as any);
    let targetAddress: string | null = null;
    if (operand.kind === 'variable') {
      const variable = operand as VariableNode & { uniqueName?: string; isGlobal?: boolean; boxed?: boolean };
      if (variable.isGlobal) this.b.globalGet(variable.name);
      else this.b.getLocal(variable.uniqueName ?? variable.name);
      if (variable.boxed) emitLoadForType(this.b, type, 0);
    } else {
      targetAddress = this.emitIncrementAddress(operand);
      this.b.getLocal(targetAddress);
      emitLoadForType(this.b, type);
    }
    this.b.setLocal(oldValue);
    this.b.getLocal(oldValue);
    this.emitIncrementOperation(type, node.operator);
    this.b.setLocal(newValue);
    if (operand.kind === 'variable') {
      const variable = operand as VariableNode & { uniqueName?: string; isGlobal?: boolean; boxed?: boolean };
      if (variable.boxed) {
        const tmp = this.fresh('inc_boxv', semanticToWasmType(type) as any);
        this.b.setLocal(tmp);
        if (variable.isGlobal) this.b.globalGet(variable.name);
        else this.b.getLocal(variable.uniqueName ?? variable.name);
        this.b.getLocal(tmp);
        emitStoreForType(this.b, type, 0);
      } else {
        this.b.getLocal(newValue);
        if (variable.isGlobal) this.b.globalSet(variable.name);
        else this.b.setLocal(variable.uniqueName ?? variable.name);
      }
    } else {
      this.b.getLocal(targetAddress!);
      this.b.getLocal(newValue);
      emitStoreForType(this.b, type);
    }
    this.b.getLocal(node.prefix ? newValue : oldValue);
    return type;
  }

  private emitIncrementOperation(type: ArithmeticType, operator: '++' | '--'): void {
    const isIncrement = operator === '++';
    switch (type) {
      case 's32': case 'u32': this.b.i32Const(1); isIncrement ? this.b.i32Add() : this.b.i32Sub(); break;
      case 's64': case 'u64': this.b.i64Const(1n); isIncrement ? this.b.i64Add() : this.b.i64Sub(); break;
      case 'f32': this.b.f32Const(1); isIncrement ? this.b.f32Add() : this.b.f32Sub(); break;
      case 'f64': this.b.f64Const(1); isIncrement ? this.b.f64Add() : this.b.f64Sub(); break;
    }
  }
// case 'cast':
  private emitIncrementAddress(target: any): string {
    const address = this.fresh('inc_addr', 'i32');

    if (target.kind === 'capture_access') {
      this.b.getLocal('__env');
      this.b.i32Load(4 + 4 * target.captureIndex);
      this.b.setLocal(address);
      return address;
    }

    if (target.kind === 'struct_access') {
      const baseValueType = target.base.type as MathType;
      const field = target.resolvedField!;
      this.compileValue(target.base);
      const base = this.fresh('inc_struct_base', 'i32'); this.b.setLocal(base);
      if (isNullablePointerType(baseValueType)) this.assertNotNullPointer(base);
      this.b.getLocal(base); this.b.i32Const(field.offset); this.b.i32Add();
      this.b.setLocal(address);
      return address;
    }
    if (target.kind === 'array_access') {
      const arrayType = target.arrayType!;
      this.compileValue(target.base);
      const base = this.fresh('inc_array_base', 'i32'); this.b.setLocal(base);
      this.compileValue(target.index);
      const index = this.fresh('inc_array_index', 'i32'); this.b.setLocal(index);
      this.b.getLocal(base); this.b.getLocal(index);
      this.b.i32Const(sizeOfType(arrayType.elementType)); this.b.i32Mul(); this.b.i32Add();
      this.b.setLocal(address);
      return address;
    }
    throw new Error(`Destino de incremento no asignable: ${target.kind}`);
  }

  private assertNotNullPointer(pointerLocal: string): void {
    this.b.getLocal(pointerLocal);
    this.b.i32Const(-1);
    this.b.i32Eq();
    this.b.if_('void'); this.b.unreachable(); this.b.end();
  }

  private emitConversion(from: ArithmeticType, to: ArithmeticType): void {
    if (from === to) return;
    const fS = signedness[from]; const tS = signedness[to];
    if (fS !== 'float' && tS !== 'float') {
      if (width[to] > width[from]) fS === 'signed' ? this.b.i64ExtendI32S() : this.b.i64ExtendI32U();
      else if (width[to] < width[from]) this.b.i32WrapI64();
      return;
    }
    if (fS !== 'float' && tS === 'float') {
      switch (from) {
        case 's32': this.b.f64ConvertI32S(); break;
        case 'u32': this.b.f64ConvertI32U(); break;
        case 's64': this.b.f64ConvertI64S(); break;
        case 'u64': this.b.f64ConvertI64U(); break;
      }
      if (to === 'f32') this.b.f32DemoteF64();
      return;
    }
    if (fS === 'float' && tS !== 'float') {
      const toSigned = signedness[to] === 'signed';
      const to32 = width[to] === 32;
      if (from === 'f32') {
        if (to32) toSigned ? this.b.i32TruncF32S() : this.b.i32TruncF32U();
        else toSigned ? this.b.i64TruncF32S() : this.b.i64TruncF32U();
      } else {
        if (to32) toSigned ? this.b.i32TruncF64S() : this.b.i32TruncF64U();
        else toSigned ? this.b.i64TruncF64S() : this.b.i64TruncF64U();
      }
      return;
    }
    if (from === 'f32' && to === 'f64') this.b.f64PromoteF32();
    else if (from === 'f64' && to === 'f32') this.b.f32DemoteF64();
  }

  private emitComparison(op: string, t: ArithmeticType): void {
    const isF = signedness[t] === 'float';
    const isS = signedness[t] === 'signed';
    const is32 = width[t] === 32;
    if (isF) {
      switch (op) {
        case '==': t === 'f32' ? this.b.f32Eq() : this.b.f64Eq(); break;
        case '!=': t === 'f32' ? this.b.f32Ne() : this.b.f64Ne(); break;
        case '<': t === 'f32' ? this.b.f32Lt() : this.b.f64Lt(); break;
        case '<=': t === 'f32' ? this.b.f32Le() : this.b.f64Le(); break;
        case '>': t === 'f32' ? this.b.f32Gt() : this.b.f64Gt(); break;
        case '>=': t === 'f32' ? this.b.f32Ge() : this.b.f64Ge(); break;
        default: throw new Error(`Comparación flotante no soportada: ${op}`);
      }
    } else if (is32) {
      const m: any = {
        '==':'i32Eq','!=':'i32Ne',
        '<': isS?'i32LtS':'i32LtU','<=': isS?'i32LeS':'i32LeU',
        '>': isS?'i32GtS':'i32GtU','>=': isS?'i32GeS':'i32GeU',
      };
      (this.b as any)[m[op]]();
    } else {
      const m: any = {
        '==':'i64Eq','!=':'i64Ne',
        '<': isS?'i64LtS':'i64LtU','<=': isS?'i64LeS':'i64LeU',
        '>': isS?'i64GtS':'i64GtU','>=': isS?'i64GeS':'i64GeU',
      };
      (this.b as any)[m[op]]();
    }
  }

  private emitBitwise(op: string, t: ArithmeticType): void {
    const is32 = width[t] === 32;
    const isS = signedness[t] === 'signed';
    switch (op) {
      case '&': is32 ? this.b.i32And() : this.b.i64And(); break;
      case '|': is32 ? this.b.i32Or() : this.b.i64Or(); break;
      case '^': is32 ? this.b.i32Xor() : this.b.i64Xor(); break;
      case '<<': is32 ? this.b.i32Shl() : this.b.i64Shl(); break;
      case '>>':
        if (is32) isS ? this.b.i32ShrS() : this.b.i32ShrU();
        else isS ? this.b.i64ShrS() : this.b.i64ShrU();
        break;
    }
  }

  private emitBinary(op: string, t: ArithmeticType): void {
    const isF = signedness[t] === 'float';
    const isS = signedness[t] === 'signed';
    const is32 = width[t] === 32;
    switch (op) {
      case '+': isF ? (t === 'f32' ? this.b.f32Add() : this.b.f64Add()) : (is32 ? this.b.i32Add() : this.b.i64Add()); break;
      case '-': isF ? (t === 'f32' ? this.b.f32Sub() : this.b.f64Sub()) : (is32 ? this.b.i32Sub() : this.b.i64Sub()); break;
      case '*': isF ? (t === 'f32' ? this.b.f32Mul() : this.b.f64Mul()) : (is32 ? this.b.i32Mul() : this.b.i64Mul()); break;
      case '/':
        if (isF) t === 'f32' ? this.b.f32Div() : this.b.f64Div();
        else if (is32) isS ? this.b.i32DivS() : this.b.i32DivU();
        else isS ? this.b.i64DivS() : this.b.i64DivU();
        break;
      case '%':
        if (isF) throw new Error('% no soportado en flotantes');
        if (is32) isS ? this.b.i32RemS() : this.b.i32RemU();
        else isS ? this.b.i64RemS() : this.b.i64RemU();
        break;
      default: throw new Error(`Operador no soportado: ${op}`);
    }
  }
}

// ─────────────────────────────────────────────────────────────────────
// CodeGenerator
// ─────────────────────────────────────────────────────────────────────
export class CodeGenerator {
  private modular: ModuleBuilder;
  private startBuilder: FunctionIRBuilder;
  private ctr = 0;
  private _labelStack: { breakLabel: string; continueLabel: string | null; name: string | null }[] = [];
  private _regionStack: string[] = [];
  private envFunctions: Set<string> = new Set();
  private zeroCaptureClosures: Set<string> = new Set();
  private envBaseAddr = 0;
  private envOffsets = new Map<string, number>();

  constructor(program: AnalyzedProgram) {
    const stmts = program.body;
    this.modular = new ModuleBuilder();
    this.modular.addMemory(1);
    this.modular.addExport('memory', 'memory', 0);

    for (const s of stmts) if (s.kind === 'import_decl') this.declareImport(s as ImportDeclNode);

    const {
      all: functionRefs,
      zeroCapture: zeroCaptureClosures,
    } = this.collectFunctionRefs(stmts);
    this.envFunctions = functionRefs;
    this.zeroCaptureClosures = zeroCaptureClosures;
    let slot = 0;
    for (const name of functionRefs) this.modular.addFunctionToTable(name, slot++);

    const exportNameCounts = new Map<string, number>();
    for (const stmt of stmts) {
      if (stmt.kind !== 'function_def') continue;
      const fn = stmt as FunctionDefNode;
      if (fn.wasmExport) {
        const name = fn.wasmExportName ?? fn.exportName ?? fn.name;
        exportNameCounts.set(name, (exportNameCounts.get(name) ?? 0) + 1);
      }
    }

    for (const s of stmts) {
      if (s.kind !== 'function_def') continue;
      const fn = s as FunctionDefNode;
      this.compileFunction(fn);
      if (fn.wasmExport) {
        const publicName = fn.wasmExportName ?? fn.exportName ?? fn.name;
        const exportName = exportNameCounts.get(publicName) === 1
          ? publicName
          : `${publicName}$${fn.name}`;
        this.modular.addExport(exportName, 'function', fn.name);
      }
    }

    this.startBuilder = new FunctionIRBuilder([], [], [], this.modular);

    for (const s of stmts) {
      if (s.kind === 'function_def') continue;
      if (s.kind === 'struct_def') continue;
      if (s.kind === 'type_alias') continue;
      if (s.kind === 'import_decl') continue;
      this.compileStatement(s, this.startBuilder, true);
    }
    this.startBuilder.finalize();

    const envNames = new Set<string>();
    const scanInstrs = (instrs: any[]) => {
      for (const i of instrs) {
        if (i.op === 'ENV_ADDR_BY_NAME') envNames.add(i.name);
      }
    };
    for (const fn of this.modular.functions) scanInstrs(fn.builder.instructions);
    scanInstrs(this.startBuilder.instructions);

    this.modular.ensureStringData();

    if (envNames.size > 0) {
      const base = this.modular.getStaticDataEnd(4);
      const data: number[] = [];
      let cursor = 0;
      for (const name of envNames) {
        this.envOffsets.set(name, cursor);
        data.push(0, 0, 0, 0);
        cursor += 4;
      }
      this.modular.addDataSegment(base, data);
      this.envBaseAddr = base;
    }

    const staticEnd = this.modular.getStaticDataEnd(8);

    const heapBase = staticEnd;
    const needed = heapBase + HEAP_PAGES * PAGE_SIZE;
    const initialPages = Math.max(1, Math.ceil(needed / PAGE_SIZE));
    const memEnd = initialPages * PAGE_SIZE;

    this.modular.addGlobal(RT_PTR, 'i32', true, heapBase);
    this.modular.addGlobal(RT_MEM_END, 'i32', true, memEnd);
    this.setupRuntime();

    this.modular.addFunctionInstance('_start', this.startBuilder);
    this.modular.addExport('_start', 'function', '_start');

    if (initialPages > this.modular.memoryInitial) this.modular.memoryInitial = initialPages;
  }

  public build(): Uint8Array {
    new Optimizer().optimizeModule(this.modular);
    this.resolveEnvAddresses();
    this.fillEnvData();
    return this.modular.build();
  }

  private resolveEnvAddresses(): void {
    if (this.envOffsets.size === 0) return;
    const base = this.envBaseAddr;
    const rewrite = (instrs: any[]) => instrs.map(instr => {
      if (instr.op === 'ENV_ADDR_BY_NAME') {
        const off = this.envOffsets.get(instr.name);
        if (off === undefined) throw new Error(`Env no encontrado: ${instr.name}`);
        return { op: 'I32_CONST', val: base + off };
      }
      return instr;
    });
    for (const fn of this.modular.functions) {
      fn.builder.instructions = rewrite(fn.builder.instructions);
    }
  }

  private fillEnvData(): void {
    if (this.envOffsets.size === 0) return;
    const seg = this.modular.dataSegments.find(s => s.offset === this.envBaseAddr);
    if (!seg) throw new Error('Env segment no encontrado');
    for (const [name, off] of this.envOffsets) {
      const idx = this.modular.functionTableIndices.get(name);
      if (idx === undefined) throw new Error(`Función sin índice de tabla: ${name}`);
      seg.data[off]     = idx & 0xFF;
      seg.data[off + 1] = (idx >> 8) & 0xFF;
      seg.data[off + 2] = (idx >> 16) & 0xFF;
      seg.data[off + 3] = (idx >> 24) & 0xFF;
    }
  }

  public toWat(): string { return this.modular.toWat(); }

  private collectFunctionRefs(stmts: StatementNode[]): {
    all: Set<string>;
    direct: Set<string>;
    zeroCapture: Set<string>;
  } {
    const all = new Set<string>();
    const direct = new Set<string>();
    const zeroCapture = new Set<string>();
    const seen = new WeakSet<object>();
    const visitedFns = new Set<string>();

    const fnByName = new Map<string, FunctionDefNode>();
    for (const s of stmts) {
      if (s.kind === 'function_def') fnByName.set(s.name, s as FunctionDefNode);
    }

    const visitFunctionBody = (name: string): void => {
      if (visitedFns.has(name)) return;
      visitedFns.add(name);
      const fn = fnByName.get(name);
      if (!fn) return;
      for (const s of fn.body) visit(s);
    };

    const visit = (node: any): void => {
      if (!node || typeof node !== 'object') return;
      if (seen.has(node)) return;
      seen.add(node);
      if (Array.isArray(node)) { for (const item of node) visit(item); return; }

      if (node.kind === 'function_def') return;

      if (node.kind === 'function_ref' && typeof node.name === 'string') {
        all.add(node.name);
        direct.add(node.name);
        visitFunctionBody(node.name);
        return;
      }

      if (node.kind === 'closure' && typeof node.codeName === 'string') {
        all.add(node.codeName);
        if (Array.isArray(node.captures) && node.captures.length === 0) {
          zeroCapture.add(node.codeName);
        }
        visitFunctionBody(node.codeName);
      }

      if (node.kind === 'call' && typeof node.name === 'string') {
        visitFunctionBody(node.name);
      }

      const SKIP = new Set([
        'type', 'resolvedBaseType', 'resolvedField', 'arrayType',
        'resolvedBuiltin', 'elementType', 'targetType',
        'paramTypes', 'returnTypes',
      ]);
      for (const key of Object.keys(node)) {
        if (key === 'kind') continue;
        if (SKIP.has(key)) continue;
        visit(node[key]);
      }
    };

    for (const s of stmts) {
      if (s.kind === 'function_def') continue;
      if (s.kind === 'struct_def') continue;
      if (s.kind === 'type_alias') continue;
      if (s.kind === 'import_decl') continue;
      visit(s);
    }

    return { all, direct, zeroCapture };
  }

  private declareImport(id: ImportDeclNode): void {
    const wp = id.params.map(p => semanticToWasmType(p.type));
    const wr = id.returnType ? semanticToWasmType(id.returnType) : null;
    this.modular.addFunctionImportAlias(id.module, id.field, id.name, wp, wr);
  }

  private setupRuntime(): void {
    const m = this.modular;
    const ALIGN = 8;
    const MASK = ALIGN - 1;
    const NEGMASK = (~MASK) | 0;

    m.addFunction(RT_SAVE, [], 'i32', (b) => {
      b.globalGet(RT_PTR);
    });
    m.addFunction(RT_RESTORE, ['i32'], null, (b) => {
      b.getLocal('mark');
      b.globalSet(RT_PTR);
    }, ['mark']);


    m.addFunction(RT_ALLOC, ['i32'], 'i32', (b) => {
      const aligned = b.addLocal('$aligned', 'i32');
      const end     = b.addLocal('$end', 'i32');
      const pages   = b.addLocal('$pages', 'i32');
      const oldSize = b.addLocal('$old_size', 'i32');


      b.globalGet(RT_PTR);
      b.i32Const(MASK);
      b.i32Add();
      b.i32Const(NEGMASK);
      b.i32And();
      b.setLocal(aligned);

      b.getLocal(aligned);
      b.getLocal('size');
      b.i32Add();
      b.setLocal(end);

      b.getLocal(end);
      b.globalGet(RT_MEM_END);
      b.i32GtU();
      b.if_('void');
        b.getLocal(end);
        b.globalGet(RT_MEM_END);
        b.i32Sub();
        b.i32Const(PAGE_SIZE - 1);
        b.i32Add();
        b.i32Const(LOG2_PAGE_SIZE);
        b.i32ShrU();
        b.setLocal(pages);

        b.getLocal(pages);
        b.memoryGrow();
        b.setLocal(oldSize);

        b.getLocal(oldSize);
        b.i32Const(-1);
        b.i32Eq();
        b.if_('void'); b.unreachable(); b.end();

        b.getLocal(oldSize);
        b.getLocal(pages);
        b.i32Add();
        b.i32Const(LOG2_PAGE_SIZE);
        b.i32Shl();
        b.globalSet(RT_MEM_END);
      b.end();

      b.getLocal(end);
      b.globalSet(RT_PTR);

      b.getLocal(aligned);
    }, ['size']);

    m.addFunction('memcpy', ['i32', 'i32', 'i32'], null, (b) => {
      b.getLocal('dst');
      b.getLocal('src');
      b.getLocal('n');
      b.memoryCopy();
    }, ['dst', 'src', 'n']);

    m.addFunction('mem_read32', ['i32'], 'i32', (b) => { b.getLocal('addr'); b.i32Load(); }, ['addr']);
    m.addFunction('mem_write32', ['i32', 'i32'], null, (b) => {
      b.getLocal('addr'); b.getLocal('v'); b.i32Store();
    }, ['addr', 'v']);
    m.addFunction('mem_read8', ['i32'], 'i32', (b) => { b.getLocal('addr'); b.i32Load8U(); }, ['addr']);
    m.addFunction('mem_write8', ['i32', 'i32'], null, (b) => {
      b.getLocal('addr'); b.getLocal('v'); b.i32Store8();
    }, ['addr', 'v']);

    m.addFunction('str_len', ['i32'], 'i32', (b) => {
      b.getLocal('s'); b.i32Const(4); b.i32Sub(); b.i32Load();
    }, ['s']);

    m.addFunction('__bool_to_string', ['i32'], 'i32', (b) => {
      b.getLocal('value');
      b.if_('i32');
        b.addString('true');
      b.else_();
        b.addString('false');
      b.end();
    }, ['value']);

    const addIntegerToString = (name: string, unsigned: boolean): void => {
      m.addFunction(name, ['i32'], 'i32', (b) => {
        b.addLocal('negative', 'i32');
        b.addLocal('scratch', 'i32');
        b.addLocal('index', 'i32');
        b.addLocal('length', 'i32');
        b.addLocal('result', 'i32');

        if (unsigned) {
          b.i32Const(0); b.setLocal('negative');
        } else {
          b.getLocal('value'); b.i32Const(0); b.i32LtS(); b.setLocal('negative');
          b.getLocal('value'); b.i32Const(0); b.i32GtS();
          b.if_('void');
            b.i32Const(0); b.getLocal('value'); b.i32Sub(); b.setLocal('value');
          b.end();
        }

        b.i32Const(16); b.callByName(RT_ALLOC); b.setLocal('scratch');
        b.i32Const(15); b.setLocal('index');
        b.getLocal('value'); b.i32Eqz();
        b.if_('void');
          b.getLocal('scratch'); b.getLocal('index'); b.i32Add();
          b.i32Const(48); b.i32Store8();
          b.getLocal('index'); b.i32Const(1); b.i32Sub(); b.setLocal('index');
        b.else_();
          b.block('void', 'int_to_string_done');
          b.loop('void', 'int_to_string_loop');
            b.getLocal('value');
            b.i32Eqz();
            b.brIfTo('int_to_string_done');
            b.getLocal('scratch'); b.getLocal('index'); b.i32Add();
            if (unsigned) {
              b.getLocal('value'); b.i32Const(10); b.i32RemU();
            } else {
              b.i32Const(0); b.getLocal('value');
              b.i32Const(10); b.i32RemS();
              b.i32Sub();
            }
            b.i32Const(48); b.i32Add(); b.i32Store8();
            b.getLocal('value');
            b.i32Const(10);
            if (unsigned) b.i32DivU(); else b.i32DivS();
            b.setLocal('value');
            b.getLocal('index'); b.i32Const(1); b.i32Sub(); b.setLocal('index');
            b.brTo('int_to_string_loop');
          b.end();
          b.end();
        b.end();

        if (!unsigned) {
          b.getLocal('negative');
          b.if_('void');
            b.getLocal('scratch'); b.getLocal('index'); b.i32Add();
            b.i32Const(45); b.i32Store8();
            b.getLocal('index'); b.i32Const(1); b.i32Sub(); b.setLocal('index');
          b.end();
        }
        b.i32Const(15); b.getLocal('index'); b.i32Sub(); b.setLocal('length');
        b.getLocal('length'); b.i32Const(4); b.i32Add();
        b.callByName(RT_ALLOC); b.setLocal('result');
        b.getLocal('result'); b.getLocal('length'); b.i32Store();
        b.getLocal('result'); b.i32Const(4); b.i32Add();
        b.getLocal('scratch'); b.getLocal('index'); b.i32Const(1); b.i32Add(); b.i32Add();
        b.getLocal('length'); b.callByName('memcpy');
        b.getLocal('result'); b.i32Const(4); b.i32Add();
      }, ['value']);
    };
    addIntegerToString('__s32_to_string', false);
    addIntegerToString('__u32_to_string', true);

    m.addFunction('str_eq', ['i32', 'i32'], 'i32', (b) => {
      b.addLocal('len_a', 'i32'); b.addLocal('i', 'i32');
      b.getLocal('a'); b.i32Const(4); b.i32Sub(); b.i32Load(); b.setLocal('len_a');
      b.getLocal('len_a');
      b.getLocal('b'); b.i32Const(4); b.i32Sub(); b.i32Load();
      b.i32Ne();
      b.if_('void'); b.i32Const(0); b.return_(); b.end();
      b.i32Const(0); b.setLocal('i');
      b.block('void', 'str_eq_done');
      b.loop('void', 'str_eq_loop');
        b.getLocal('i'); b.getLocal('len_a'); b.i32GeS(); b.brIfTo('str_eq_done');
        b.getLocal('a'); b.getLocal('i'); b.i32Add(); b.i32Load8U();
        b.getLocal('b'); b.getLocal('i'); b.i32Add(); b.i32Load8U();
        b.i32Ne();
        b.if_('void'); b.i32Const(0); b.return_(); b.end();
        b.getLocal('i'); b.i32Const(1); b.i32Add(); b.setLocal('i');
        b.brTo('str_eq_loop');
      b.end(); b.end();
      b.i32Const(1);
    }, ['a', 'b']);

    m.addFunction('str_ne', ['i32', 'i32'], 'i32', (b) => {
      b.getLocal('a'); b.getLocal('b'); b.callByName('str_eq'); b.i32Eqz();
    }, ['a', 'b']);

    m.addFunction('str_cmp', ['i32', 'i32'], 'i32', (b) => {
      b.addLocal('len_a', 'i32'); b.addLocal('len_b', 'i32');
      b.addLocal('min_len', 'i32'); b.addLocal('i', 'i32');
      b.addLocal('ca', 'i32'); b.addLocal('cb', 'i32');
      b.getLocal('a'); b.i32Const(4); b.i32Sub(); b.i32Load(); b.setLocal('len_a');
      b.getLocal('b'); b.i32Const(4); b.i32Sub(); b.i32Load(); b.setLocal('len_b');
      b.getLocal('len_a'); b.getLocal('len_b'); b.i32LtS();
      b.if_('void'); b.getLocal('len_a'); b.setLocal('min_len');
      b.else_(); b.getLocal('len_b'); b.setLocal('min_len'); b.end();
      b.i32Const(0); b.setLocal('i');
      b.block('void', 'str_cmp_done');
      b.loop('void', 'str_cmp_loop');
        b.getLocal('i'); b.getLocal('min_len'); b.i32GeS(); b.brIfTo('str_cmp_done');
        b.getLocal('a'); b.getLocal('i'); b.i32Add(); b.i32Load8U(); b.setLocal('ca');
        b.getLocal('b'); b.getLocal('i'); b.i32Add(); b.i32Load8U(); b.setLocal('cb');
        b.getLocal('ca'); b.getLocal('cb'); b.i32Ne();
        b.if_('void'); b.getLocal('ca'); b.getLocal('cb'); b.i32Sub(); b.return_(); b.end();
        b.getLocal('i'); b.i32Const(1); b.i32Add(); b.setLocal('i');
        b.brTo('str_cmp_loop');
      b.end(); b.end();
      b.getLocal('len_a'); b.getLocal('len_b'); b.i32Sub();
    }, ['a', 'b']);

    m.addFunction('str_concat', ['i32', 'i32'], 'i32', (b) => {
      // len_a: i32
      // len_b: i32
      // buf: i32
      // len_a = *(a - 4)
      // len_b = *(b - 4)
      // buf = alloc((len_a + len_b) + 4)
      b.addLocal('len_a', 'i32'); b.addLocal('len_b', 'i32'); b.addLocal('buf', 'i32');
      b.getLocal('a'); b.i32Const(4); b.i32Sub(); b.i32Load(); b.setLocal('len_a');
      b.getLocal('b'); b.i32Const(4); b.i32Sub(); b.i32Load(); b.setLocal('len_b');
      b.getLocal('len_a'); b.getLocal('len_b'); b.i32Add(); b.i32Const(4); b.i32Add();
      b.callByName(RT_ALLOC); b.setLocal('buf');
      b.getLocal('buf');
      b.getLocal('len_a'); b.getLocal('len_b'); b.i32Add(); b.i32Store();
      b.getLocal('buf'); b.i32Const(4); b.i32Add();
      b.getLocal('a'); b.getLocal('len_a'); b.callByName('memcpy');
      b.getLocal('buf'); b.i32Const(4); b.i32Add(); b.getLocal('len_a'); b.i32Add();
      b.getLocal('b'); b.getLocal('len_b'); b.callByName('memcpy');
      b.getLocal('buf'); b.i32Const(4); b.i32Add();
    }, ['a', 'b']);
  }

  public compileStatement(stmt: StatementNode, b: FunctionIRBuilder, topLevel = false): void {
    try {
      this.compileStatementContents(stmt, b, topLevel);
    } catch (error) {
      const location = stmt.sourceLocation;
      if (!(error instanceof Error) || !location) throw error;
      const existingPrefix = `${location.filePath}:${location.line}:${location.column}: error:`;
      if (error.message.includes(existingPrefix)) throw error;
      throw new Error(formatDiagnostic({ message: error.message, location }));
    }
  }

  private compileStatementContents(
    stmt: StatementNode,
    b: FunctionIRBuilder,
    topLevel: boolean,
  ): void {
    const ec = new ExpressionCompiler(
      b, this.modular, this.envFunctions, this.zeroCaptureClosures
    );

    switch (stmt.kind) {
      case 'function_def': this.compileFunction(stmt as FunctionDefNode); break;
      case 'import_decl':
      case 'module_import':
      case 'struct_def':
      case 'type_alias':
        break;

      case 'const_decl':
      case 'var_decl': {
        const v = stmt as VarConstNode;
        if (topLevel && (v as any).isGlobal) {
          const wt = semanticToWasmType(v.type);
          let init: number | bigint | null = null;
          let deferred = false;
          if (!v.initExpr) {
            init = isNullablePointerType(v.type) ? -1 : (wt === 'i64' ? 0n : 0);
          } else if (v.initExpr.kind === 'const' || v.initExpr.kind === 'bool') {
            init = (v.initExpr as any).value;
            if (typeof init === 'boolean') init = init ? 1 : 0;
          } else {
            init = (wt === 'i64') ? 0n : 0;
            deferred = true;
          }
          this.modular.addGlobal(v.name, wt, true, init);
          if (v.wasmExport) {
            this.modular.addExport(v.wasmExportName ?? v.exportName ?? v.name, 'global', v.name);
          }
          if (deferred) {
            const t = ec.compile(v.initExpr!);
            if (t === 'void') throw new Error(`Global '${v.name}' inicializada con void`);
            if (!typesEqual(t, v.type)) handleImplicitConversion(b, v.initExpr!, t, v.type);
            b.globalSet(v.name);
          }
          break;
        }

        const unique = (v as any).uniqueName ?? v.name;
        if ((v as any).boxed) {
          b.addLocal(unique, 'i32');
          b.i32Const(sizeOfType(v.type));
          b.callByName(RT_ALLOC);
          b.setLocal(unique);
          if (v.initExpr) {
            const t = ec.compile(v.initExpr);
            if (t === 'void') throw new Error(`No se puede inicializar '${v.name}' con void`);
            if (!typesEqual(t, v.type)) handleImplicitConversion(b, v.initExpr, t, v.type);
          } else {
            this.emitZero(b, v.type);
          }
          const tmp = `$box_init_${this.ctr++}`;
          b.addLocal(tmp, semanticToWasmType(v.type) as any);
          b.setLocal(tmp);
          b.getLocal(unique);
          b.getLocal(tmp);
          emitStoreForType(b, v.type, 0);
        } else {
          b.addLocal(unique, semanticToWasmType(v.type));
          if (v.initExpr) {
            const t = ec.compile(v.initExpr);
            if (t === 'void') throw new Error(`No se puede inicializar '${v.name}' con void`);
            if (!typesEqual(t, v.type)) handleImplicitConversion(b, v.initExpr, t, v.type);
          } else this.emitZero(b, v.type);
          b.setLocal(unique);
        }
        break;
      }

      case 'short_var_decl': {
        const v = stmt as ShortVarDeclNode;
        const unique = (v as any).uniqueName ?? v.name;

        if ((v as any).boxed) {
          const t = ec.compile(v.expr);
          if (t === 'void') throw new Error('No se puede inferir var desde void');
          const tmp = `$box_init_${this.ctr++}`;
          b.addLocal(tmp, semanticToWasmType(t) as any);
          b.setLocal(tmp);
          b.addLocal(unique, 'i32');
          b.i32Const(sizeOfType(t));
          b.callByName(RT_ALLOC);
          b.setLocal(unique);
          b.getLocal(unique);
          b.getLocal(tmp);
          emitStoreForType(b, t, 0);
        } else {
          const t = ec.compile(v.expr);
          if (t === 'void') throw new Error('No se puede inferir var desde void');
          b.addLocal(unique, semanticToWasmType(t));
          b.setLocal(unique);
        }
        break;
      }

      case 'multi_decl': {
        const md = stmt as MultiDeclNode;
        const returnTypes = (md.expr as CallNode | CallIndirectNode).returnTypes!;
        const uniqueNames = md.uniqueNames!;

        for (let i = 0; i < uniqueNames.length; i++) {
          const un = uniqueNames[i];
          if (un !== null) {
            b.addLocal(un, semanticToWasmType(returnTypes[i]));
          }
        }

        ec.compile(md.expr);

        for (let i = uniqueNames.length - 1; i >= 0; i--) {
          const un = uniqueNames[i];
          if (un === null) {
            b.drop();
          } else {
            b.setLocal(un);
          }
        }
        break;
      }

      case 'assign': this.compileAssignment(stmt as AssignNode, b, ec); break;

      case 'return': {
        const r = stmt as ReturnNode;
        for (const v of r.values) ec.compile(v);

        for (let i = this._regionStack.length - 1; i >= 0; i--) {
          b.getLocal(this._regionStack[i]);
          b.callByName(RT_RESTORE);
        }
        b.return_();
        break;
      }

      case 'expression_stmt': {
        const e = stmt as ExpressionStmtNode;
        if (e.expr.kind === 'increment') {
          ec.compileIncrementAsStatement(e.expr as any);
          break;
        }
        const t = ec.compile(e.expr);
        if (t !== 'void') b.drop();
        break;
      }

      case 'if': {
        const i = stmt as IfNode;
        ec.compile(i.condition);
        b.if_('void');
        for (const s of i.thenBlock) this.compileStatement(s, b);
        if (i.elseBlock) {
          b.else_();
          if (Array.isArray(i.elseBlock)) for (const s of i.elseBlock) this.compileStatement(s, b);
          else this.compileStatement(i.elseBlock, b);
        }
        b.end();
        break;
      }

      case 'for': {
        const f = stmt as ForNode;
        if (f.init) this.compileStatement(f.init, b);
        const exitLabel = `$for_exit_${this.ctr}`;
        const topLabel = `$for_top_${this.ctr}`;
        const contLabel = `$for_cont_${this.ctr}`;
        this.ctr++;
        b.block('void', exitLabel);
        b.loop('void', topLabel);
        if (f.condition) {
          ec.compile(f.condition);
          b.i32Eqz();
          b.brIfTo(exitLabel);
        }
        b.block('void', contLabel);
        this._labelStack.push({ breakLabel: exitLabel, continueLabel: contLabel, name: f.label ?? null });
        for (const s of f.body) this.compileStatement(s, b);
        this._labelStack.pop();
        b.end();
        if (f.post) this.compileStatement(f.post, b);
        b.brTo(topLabel);
        b.end(); b.end();
        break;
      }

      case 'for_in': {
        const fi = stmt as ForInNode;
        const iterableType = (fi.iterable as any).type as MathType;
        const arrayType = iterableType as Extract<MathType, { kind: 'array' | 'dynarray' }>;

        const arrTemp = `$forin_arr_${this.ctr++}`;
        b.addLocal(arrTemp, 'i32');
        ec.compile(fi.iterable);
        b.setLocal(arrTemp);

        const lenTemp = `$forin_len_${this.ctr++}`;
        b.addLocal(lenTemp, 'i32');
        if (arrayType.kind === 'dynarray') {
          b.getLocal(arrTemp); b.i32Const(4); b.i32Sub(); b.i32Load(); b.setLocal(lenTemp);
        } else {
          b.i32Const(arrayType.length); b.setLocal(lenTemp);
        }

        const idxTemp = `$forin_idx_${this.ctr++}`;
        b.addLocal(idxTemp, 'i32');
        b.i32Const(0); b.setLocal(idxTemp);

        const indexUnique = (fi as any).indexUnique as string | null | undefined;
        const valueUnique = (fi as any).valueUnique as string | null | undefined;
        const elemType = arrayType.elementType;

        if (indexUnique != null) b.addLocal(indexUnique, 'i32');
        if (valueUnique != null) b.addLocal(valueUnique, semanticToWasmType(elemType) as any);

        const exitLabel = `$forin_exit_${this.ctr}`;
        const topLabel = `$forin_top_${this.ctr}`;
        const contLabel = `$forin_cont_${this.ctr}`;
        this.ctr++;

        b.block('void', exitLabel);
        b.loop('void', topLabel);

        b.getLocal(idxTemp); b.getLocal(lenTemp); b.i32GeS(); b.brIfTo(exitLabel);

        if (indexUnique != null) {
          b.getLocal(idxTemp);
          b.setLocal(indexUnique);
        }

        if (valueUnique != null) {
          const es = sizeOfType(elemType);
          b.getLocal(arrTemp); b.getLocal(idxTemp); b.i32Const(es); b.i32Mul(); b.i32Add();
          if (isInlineValue(elemType)) b.setLocal(valueUnique);
          else { emitLoadForType(b, elemType); b.setLocal(valueUnique); }
        }

        b.block('void', contLabel);
        this._labelStack.push({ breakLabel: exitLabel, continueLabel: contLabel, name: fi.label ?? null });
        for (const s of fi.body) this.compileStatement(s, b);
        this._labelStack.pop();
        b.end();

        b.getLocal(idxTemp); b.i32Const(1); b.i32Add(); b.setLocal(idxTemp);
        b.brTo(topLabel);
        b.end(); b.end();
        break;
      }

      case 'switch': {
        const s = stmt as SwitchNode;
        const exprType = s.exprType!;

        if (s.cases.length === 0) {
          if (s.defaultBody) for (const st of s.defaultBody) this.compileStatement(st, b);
          break;
        }

        const tmp = `$switch_${this.ctr++}`;
        b.addLocal(tmp, semanticToWasmType(exprType) as any);
        ec.compile(s.expr);
        b.setLocal(tmp);

        let depth = 0;
        for (let i = 0; i < s.cases.length; i++) {
          const c = s.cases[i];
          if (i > 0) b.else_();
          for (let j = 0; j < c.patterns.length; j++) {
            b.getLocal(tmp);
            ec.emitPatternMatchOnStack(c.patterns[j], exprType);
            if (j > 0) b.i32Or();
          }
          b.if_('void');
          depth++;
          for (const st of c.body) this.compileStatement(st, b);
        }

        if (s.defaultBody) {
          b.else_();
          for (const st of s.defaultBody) this.compileStatement(st, b);
        }

        for (let i = 0; i < depth; i++) b.end();
        break;
      }

      case 'region': {
        const r = stmt as RegionNode;
        const mark = `$region_mark_${this.ctr++}`;
        b.addLocal(mark, 'i32');
        b.callByName(RT_SAVE);
        b.setLocal(mark);
        this._regionStack.push(mark);
        try {
          for (const s of r.body) this.compileStatement(s, b);
        } finally {
          this._regionStack.pop();
        }
        b.getLocal(mark);
        b.callByName(RT_RESTORE);
        break;
      }

      case 'break': {
        const bk = stmt as BreakNode;
        const name = bk.label ?? null;
        let ctx: { breakLabel: string; continueLabel: string | null; name: string | null } | null = null;

        if (name !== null) {
          for (let i = this._labelStack.length - 1; i >= 0; i--) {
            if (this._labelStack[i].name === name) { ctx = this._labelStack[i]; break; }
          }
          if (!ctx) throw new Error(`break: etiqueta '${name}' no encontrada`);
        } else {
          ctx = this._labelStack[this._labelStack.length - 1] ?? null;
          if (!ctx) throw new Error('break fuera de bucle');
        }

        b.brTo(ctx.breakLabel);
        break;
      }

      case 'continue': {
        const ct = stmt as ContinueNode;
        const name = ct.label ?? null;
        let ctx: { breakLabel: string; continueLabel: string | null; name: string | null } | null = null;

        if (name !== null) {
          for (let i = this._labelStack.length - 1; i >= 0; i--) {
            const e = this._labelStack[i];
            if (e.name === name && e.continueLabel) { ctx = e; break; }
          }
          if (!ctx) throw new Error(`continue: etiqueta '${name}' no encontrada`);
        } else {
          for (let i = this._labelStack.length - 1; i >= 0; i--) {
            if (this._labelStack[i].continueLabel) { ctx = this._labelStack[i]; break; }
          }
          if (!ctx) throw new Error('continue fuera de bucle');
        }

        b.brTo(ctx.continueLabel!);
        break;
      }

      default: throw new Error(`Sentencia no soportada en codegen: ${(stmt as any).kind}`);
    }
  }

  private compileAssignment(a: AssignNode, b: FunctionIRBuilder, ec: ExpressionCompiler): void {
    if (a.target.kind === 'variable') {
      const v = a.target as VariableNode & { uniqueName?: string; isGlobal?: boolean; boxed?: boolean };
      const t = ec.compile(a.expr);
      if (t === 'void') throw new Error('No se puede asignar void');
      if (!typesEqual(t, v.type)) handleImplicitConversion(b, a.expr, t, v.type);

      if (v.boxed) {
        const tmp = `$asg_box_${this.ctr++}`;
        b.addLocal(tmp, semanticToWasmType(v.type) as any);
        b.setLocal(tmp);
        if (v.isGlobal) b.globalGet(v.name);
        else b.getLocal(v.uniqueName ?? v.name);
        b.getLocal(tmp);
        emitStoreForType(b, v.type, 0);
        return;
      }

      if (v.isGlobal) b.globalSet(v.name);
      else b.setLocal(v.uniqueName ?? v.name);
      return;
    }

    if (a.target.kind === 'capture_access') {
      const ca = a.target as CaptureAccessNode;
      const t = ec.compile(a.expr);
      if (t === 'void') throw new Error('No se puede asignar void');
      if (!typesEqual(t, ca.type)) handleImplicitConversion(b, a.expr, t, ca.type);
      const vtmp = `$asg_v_${this.ctr++}`;
      b.addLocal(vtmp, semanticToWasmType(ca.type) as any);
      b.setLocal(vtmp);
      b.getLocal('__env');
      b.i32Load(4 + 4 * ca.captureIndex);
      b.getLocal(vtmp);
      emitStoreForType(b, ca.type, 0);
      return;
    }

    const { addrLocal, targetType } = this.resolveLValueAddr(a.target, b, ec);
    const vt = ec.compile(a.expr);
    if (vt === 'void') throw new Error('No se puede asignar void');
    if (!typesEqual(vt, targetType)) handleImplicitConversion(b, a.expr, vt, targetType);
    const vtmp = `$asg_v_${this.ctr++}`;
    b.addLocal(vtmp, semanticToWasmType(targetType) as any);
    b.setLocal(vtmp);
    b.getLocal(addrLocal);
    b.getLocal(vtmp);
    emitStoreForType(b, targetType);
  }

  private resolveLValueAddr(target: MathNode, b: FunctionIRBuilder, ec: ExpressionCompiler): { addrLocal: string; targetType: MathType } {
    if (target.kind === 'variable') {
      const v = target as VariableNode & { uniqueName?: string; isGlobal?: boolean; boxed?: boolean };
      const addr = `$addr_${this.ctr++}`;
      b.addLocal(addr, 'i32');
      if (v.isGlobal) b.globalGet(v.name); else b.getLocal(v.uniqueName ?? v.name);
      b.setLocal(addr);
      return { addrLocal: addr, targetType: v.type };
    }
    if (target.kind === 'struct_access') {
      const sa = target as StructAccessNode;
      const baseValueType = (sa.base as any).type as MathType;
      const field = sa.resolvedField!;
      const baseAddr = `$addr_${this.ctr++}`;
      b.addLocal(baseAddr, 'i32');
      ec.compile(sa.base);
      b.setLocal(baseAddr);
      if (isNullablePointerType(baseValueType)) {
        b.getLocal(baseAddr); b.i32Const(-1); b.i32Eq();
        b.if_('void'); b.unreachable(); b.end();
      }
      const addr = `$addr_${this.ctr++}`;
      b.addLocal(addr, 'i32');
      b.getLocal(baseAddr); b.i32Const(field.offset); b.i32Add(); b.setLocal(addr);
      return { addrLocal: addr, targetType: field.type };
    }
    if (target.kind === 'array_access') {
      const aa = target as ArrayAccessNode;
      const bt = aa.arrayType!;
      const { addrLocal: baseAddr } = this.resolveLValueAddr(aa.base, b, ec);
      const idx = `$idx_${this.ctr++}`;
      b.addLocal(idx, 'i32');
      ec.compile(aa.index);
      b.setLocal(idx);
      const addr = `$addr_${this.ctr++}`;
      b.addLocal(addr, 'i32');
      b.getLocal(baseAddr); b.getLocal(idx); b.i32Const(sizeOfType(bt.elementType)); b.i32Mul(); b.i32Add();
      b.setLocal(addr);
      return { addrLocal: addr, targetType: bt.elementType };
    }
    if (target.kind === 'capture_access') {
      const addr = `$addr_${this.ctr++}`;
      b.addLocal(addr, 'i32');
      ec.compile(target);
      b.setLocal(addr);
      return { addrLocal: addr, targetType: target.type };
    }
    throw new Error(`LValue no soportado: ${target.kind}`);
  }

  public compileFunction(fn: FunctionDefNode): void {
    const isLambda = fn.name.startsWith('__lambda_');
    const needsEnv = isLambda || this.envFunctions.has(fn.name);

    const parameterType = (param: FunctionDefNode['params'][number]): MathType =>
      param.variadic
        ? { kind: 'dynarray', elementType: param.type }
        : param.type;
    const userParamWasm = fn.params.map(p => semanticToWasmType(parameterType(p)));
    const paramWasm: any[] = needsEnv ? ['i32', ...userParamWasm] : userParamWasm;

    const userParamNames = fn.params.map(p => (p as any).uniqueName ?? p.name);
    const paramNames = needsEnv ? ['__env', ...userParamNames] : userParamNames;

    const returnWasm = fn.returnTypes.map(t => semanticToWasmType(t));
    const wasmName = fn.name;

    const prevRegionStack = this._regionStack;
    this._regionStack = [];

    try {
      this.modular.addFunction(
        wasmName, paramWasm, returnWasm,
        (fb: FunctionIRBuilder) => {
          for (let i = 0; i < paramNames.length; i++) fb.setParamName(i, paramNames[i]);

          for (const p of fn.params) {
            if ((p as any).boxed) {
              const uniqueName = (p as any).uniqueName ?? p.name;
              const type = parameterType(p);
              fb.i32Const(sizeOfType(type));
              fb.callByName(RT_ALLOC);
              const tmp = `$box_param_${uniqueName}`;
              fb.addLocal(tmp, 'i32');
              fb.setLocal(tmp);
              fb.getLocal(tmp);
              fb.getLocal(uniqueName);
              emitStoreForType(fb, type, 0);
              fb.getLocal(tmp);
              fb.setLocal(uniqueName);
            }
          }

          for (const s of fn.body) this.compileStatement(s, fb);

          if (returnWasm.length > 0) {
            fb.unreachable();
          }
        },
        paramNames
      );
    } finally {
      this._regionStack = prevRegionStack;
    }
  }

  private emitZero(b: FunctionIRBuilder, t: MathType): void {
    if (typeof t !== 'string') {
      b.i32Const(isNullablePointerType(t) ? -1 : 0);
      return;
    }
    switch (t) {
      case 's32': case 'u32': case 'bool': case 'string': b.i32Const(0); break;
      case 's64': case 'u64': b.i64Const(0n); break;
      case 'f32': b.f32Const(0); break;
      case 'f64': b.f64Const(0); break;
      default: b.i32Const(0);
    }
  }
}
