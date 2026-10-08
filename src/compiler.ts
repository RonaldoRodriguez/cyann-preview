import { decodeModuleToWat, formatBinaryTree, parseBinaryTree } from './wasmInspector';
import { SIMD_CONST_SUBOP, SIMD_LANE, SIMD_MEMARG, SIMD_MEMARG_LANE, SIMD_NOIMM, SIMD_SHUFFLE_SUBOP, simdMaxLane, simdNaturalAlign, simdNaturalAlignLane } from './wasmSimd';

// compiler.ts
export type ValueType = 'i32' | 'i64' | 'f32' | 'f64' | 'v128' | 'funcref' | 'externref';
export const ENABLE_OPTIMIZER = true;
// ─────────────────────────────────────────────────────────────────────────────
// Opcodes
// ─────────────────────────────────────────────────────────────────────────────
const OP = {
    UNREACHABLE: 0x00, NOP: 0x01,
    BLOCK: 0x02, LOOP: 0x03, IF: 0x04, ELSE: 0x05, END: 0x0B,
    BR: 0x0C, BR_IF: 0x0D, BR_TABLE: 0x0E,
    RETURN: 0x0F, CALL: 0x10, CALL_INDIRECT: 0x11, CALL_REF: 0x14, RETURN_CALL_REF: 0x15,
    DROP: 0x1A, SELECT: 0x1B, SELECT_T: 0x1C,
    LOCAL_GET: 0x20, LOCAL_SET: 0x21, LOCAL_TEE: 0x22,
    GLOBAL_GET: 0x23, GLOBAL_SET: 0x24,
    TABLE_GET: 0x25, TABLE_SET: 0x26,
    I32_LOAD: 0x28, I64_LOAD: 0x29, F32_LOAD: 0x2A, F64_LOAD: 0x2B,
    I32_LOAD8_S: 0x2C, I32_LOAD8_U: 0x2D,
    I32_LOAD16_S: 0x2E, I32_LOAD16_U: 0x2F,
    I64_LOAD8_S: 0x30, I64_LOAD8_U: 0x31,
    I64_LOAD16_S: 0x32, I64_LOAD16_U: 0x33,
    I64_LOAD32_S: 0x34, I64_LOAD32_U: 0x35,
    I32_STORE: 0x36, I64_STORE: 0x37, F32_STORE: 0x38, F64_STORE: 0x39,
    I32_STORE8: 0x3A, I32_STORE16: 0x3B,
    I64_STORE8: 0x3C, I64_STORE16: 0x3D, I64_STORE32: 0x3E,
    MEMORY_SIZE: 0x3F, MEMORY_GROW: 0x40,
    I32_CONST: 0x41, I64_CONST: 0x42, F32_CONST: 0x43, F64_CONST: 0x44,
    I32_EQZ: 0x45, I64_EQZ: 0x50,
    I32_EQ: 0x46, I32_NE: 0x47,
    I32_LT_S: 0x48, I32_LT_U: 0x49,
    I32_GT_S: 0x4A, I32_GT_U: 0x4B,
    I32_LE_S: 0x4C, I32_LE_U: 0x4D,
    I32_GE_S: 0x4E, I32_GE_U: 0x4F,
    I64_EQ: 0x51, I64_NE: 0x52,
    I64_LT_S: 0x53, I64_LT_U: 0x54,
    I64_GT_S: 0x55, I64_GT_U: 0x56,
    I64_LE_S: 0x57, I64_LE_U: 0x58,
    I64_GE_S: 0x59, I64_GE_U: 0x5A,
    F32_EQ: 0x5B, F32_NE: 0x5C,
    F32_LT: 0x5D, F32_GT: 0x5E,
    F32_LE: 0x5F, F32_GE: 0x60,
    F64_EQ: 0x61, F64_NE: 0x62,
    F64_LT: 0x63, F64_GT: 0x64,
    F64_LE: 0x65, F64_GE: 0x66,
    I32_CLZ: 0x67, I32_CTZ: 0x68, I32_POPCNT: 0x69,
    I32_ADD: 0x6A, I32_SUB: 0x6B, I32_MUL: 0x6C,
    I32_DIV_S: 0x6D, I32_DIV_U: 0x6E,
    I32_REM_S: 0x6F, I32_REM_U: 0x70,
    I32_AND: 0x71, I32_OR: 0x72, I32_XOR: 0x73,
    I32_SHL: 0x74, I32_SHR_S: 0x75, I32_SHR_U: 0x76,
    I32_ROTL: 0x77, I32_ROTR: 0x78,
    I64_CLZ: 0x79, I64_CTZ: 0x7A, I64_POPCNT: 0x7B,
    I64_ADD: 0x7C, I64_SUB: 0x7D, I64_MUL: 0x7E,
    I64_DIV_S: 0x7F, I64_DIV_U: 0x80,
    I64_REM_S: 0x81, I64_REM_U: 0x82,
    I64_AND: 0x83, I64_OR: 0x84, I64_XOR: 0x85,
    I64_SHL: 0x86, I64_SHR_S: 0x87, I64_SHR_U: 0x88,
    I64_ROTL: 0x89, I64_ROTR: 0x8A,
    F32_ABS: 0x8B, F32_NEG: 0x8C,
    F32_CEIL: 0x8D, F32_FLOOR: 0x8E,
    F32_TRUNC: 0x8F, F32_NEAREST: 0x90,
    F32_SQRT: 0x91,
    F32_ADD: 0x92, F32_SUB: 0x93, F32_MUL: 0x94, F32_DIV: 0x95,
    F32_MIN: 0x96, F32_MAX: 0x97, F32_COPYSIGN: 0x98,
    F64_ABS: 0x99, F64_NEG: 0x9A,
    F64_CEIL: 0x9B, F64_FLOOR: 0x9C,
    F64_TRUNC: 0x9D, F64_NEAREST: 0x9E,
    F64_SQRT: 0x9F,
    F64_ADD: 0xA0, F64_SUB: 0xA1, F64_MUL: 0xA2, F64_DIV: 0xA3,
    F64_MIN: 0xA4, F64_MAX: 0xA5, F64_COPYSIGN: 0xA6,
    I32_WRAP_I64: 0xA7,
    I32_TRUNC_F32_S: 0xA8, I32_TRUNC_F32_U: 0xA9,
    I32_TRUNC_F64_S: 0xAA, I32_TRUNC_F64_U: 0xAB,
    I64_EXTEND_I32_S: 0xAC, I64_EXTEND_I32_U: 0xAD,
    I64_TRUNC_F32_S: 0xAE, I64_TRUNC_F32_U: 0xAF,
    I64_TRUNC_F64_S: 0xB0, I64_TRUNC_F64_U: 0xB1,
    F32_CONVERT_I32_S: 0xB2, F32_CONVERT_I32_U: 0xB3,
    F32_CONVERT_I64_S: 0xB4, F32_CONVERT_I64_U: 0xB5,
    F32_DEMOTE_F64: 0xB6,
    F64_CONVERT_I32_S: 0xB7, F64_CONVERT_I32_U: 0xB8,
    F64_CONVERT_I64_S: 0xB9, F64_CONVERT_I64_U: 0xBA,
    F64_PROMOTE_F32: 0xBB,
    I32_REINTERPRET_F32: 0xBC,
    I64_REINTERPRET_F64: 0xBD,
    F32_REINTERPRET_I32: 0xBE,
    F64_REINTERPRET_I64: 0xBF,
    REF_NULL: 0xD0, REF_IS_NULL: 0xD1, REF_FUNC: 0xD2,

    MISC_PREFIX: 0xFC,
    SAT_I32_TRUNC_SAT_F32_S: 0x00, SAT_I32_TRUNC_SAT_F32_U: 0x01,
    SAT_I32_TRUNC_SAT_F64_S: 0x02, SAT_I32_TRUNC_SAT_F64_U: 0x03,
    SAT_I64_TRUNC_SAT_F32_S: 0x04, SAT_I64_TRUNC_SAT_F32_U: 0x05,
    SAT_I64_TRUNC_SAT_F64_S: 0x06, SAT_I64_TRUNC_SAT_F64_U: 0x07,
    MEMORY_INIT: 0x08, DATA_DROP: 0x09, MEMORY_COPY: 0x0A, MEMORY_FILL: 0x0B,
    TABLE_INIT: 0x0C, ELEM_DROP: 0x0D, TABLE_COPY: 0x0E,
    TABLE_GROW: 0x0F, TABLE_SIZE: 0x10, TABLE_FILL: 0x11,

    SIMD_PREFIX: 0xFD,
} as const;

export const opToType: Record<number, ValueType> = {
    0x7F: 'i32', 0x7E: 'i64', 0x7D: 'f32', 0x7C: 'f64',
    0x7B: 'v128',
    0x70: 'funcref', 0x6F: 'externref',
};

// ─────────────────────────────────────────────────────────────────────────────
// SIMD opcode tables (prefix 0xFD, subopcode = LEB128)
// ─────────────────────────────────────────────────────────────────────────────
// ─────────────────────────────────────────────────────────────────────────────
// LEB128
// ─────────────────────────────────────────────────────────────────────────────
function encodeLEB128(n: number): number[] {
    if (!Number.isFinite(n) || n < 0) throw new Error(`encodeLEB128: valor inválido ${n}`);
    let bytes: number[] = [];
    let value = n >>> 0;
    do {
        let byte = value & 0x7F;
        value >>>= 7;
        if (value !== 0) byte |= 0x80;
        bytes.push(byte);
    } while (value !== 0);
    return bytes;
}

function encodeSignedLEB128(value: number | bigint): number[] {
    const bytes: number[] = [];
    if (typeof value === 'bigint') {
        let val = value;
        let more = true;
        while (more) {
            let byte = Number(val & 0x7Fn);
            val >>= 7n;
            if ((val === 0n && (byte & 0x40) === 0) || (val === -1n && (byte & 0x40) !== 0)) {
                more = false;
            } else {
                byte |= 0x80;
            }
            bytes.push(byte);
        }
    } else {
        let val = value | 0;
        let more = true;
        while (more) {
            let byte = val & 0x7F;
            val >>= 7;
            if ((val === 0 && (byte & 0x40) === 0) || (val === -1 && (byte & 0x40) !== 0)) {
                more = false;
            } else {
                byte |= 0x80;
            }
            bytes.push(byte);
        }
    }
    return bytes;
}

function encodeName(str: string): number[] {
    const bytes = new TextEncoder().encode(str);
    return [...encodeLEB128(bytes.length), ...bytes];
}

function typeToOp(t: ValueType): number {
    const map: Record<ValueType, number> = {
        i32: 0x7F, i64: 0x7E, f32: 0x7D, f64: 0x7C,
        v128: 0x7B,
        funcref: 0x70, externref: 0x6F,
    };
    if (!(t in map)) throw new Error(`Tipo no válido: ${t}`);
    return map[t];
}

function refTypeToOp(t: 'funcref' | 'externref'): number {
    return t === 'funcref' ? 0x70 : 0x6F;
}

function floatToBytes(value: number, bits: 32 | 64): number[] {
    const buf = new ArrayBuffer(bits / 8);
    const view = new DataView(buf);
    if (bits === 32) view.setFloat32(0, value, true);
    else view.setFloat64(0, value, true);
    return Array.from(new Uint8Array(buf));
}

function toI32(value: number | bigint): number {
    if (value === undefined || value === null) {
        console.error('toI32 con valor inválido:', value);
        console.trace();
        throw new Error('toI32: valor inválido');
    }
    return Number(BigInt.asIntN(32, BigInt(value)));
}

function toI64(value: number | bigint): bigint {
    if (value === undefined || value === null) {
        console.error('toI64 con valor inválido:', value);
        console.trace();
        throw new Error('toI64: valor inválido');
    }
    return BigInt.asIntN(64, BigInt(value));
}

// ─────────────────────────────────────────────────────────────────────────────
// Interfaces
// ─────────────────────────────────────────────────────────────────────────────
interface LocalEntry { index: number; type: ValueType; }
interface TypeEntry { params: number[]; results: number[]; }

type ExternalKind = 'function' | 'memory' | 'global' | 'table';
type RefType = 'funcref' | 'externref';

interface ExternalEntry {
    section: 'import' | 'export';
    name: string;
    kind: ExternalKind;
    initial?: number;
    maximum?: number;
    module?: string;
    typeIdx?: number;
    valueType?: ValueType;
    mutable?: boolean;
    index?: number | string;
    refType?: RefType;
}

interface FunctionEntry {
    name: string;
    builder: FunctionIRBuilder;
    paramTypes: ValueType[];
    returnType: ValueType[];
    typeIdx: number;
}

interface GlobalEntry {
    name: string;
    type: ValueType;
    mutable: boolean;
    initExprBytes: number[];
}

interface TableEntry { min: number; max?: number; refType: RefType; }

interface DataSegment {
    offset: number;
    data: number[];
    fromStringPool?: boolean;
}

interface CustomSection {
    name: string;
    data: number[];
    atEnd?: boolean;
}

interface ElementSegment {
    mode: number;
    tableIndex: number;
    offsetBytes: number[] | null;
    funcIndices: number[] | null;
    exprsBytes: number[][] | null;
    refType: RefType;
    elemKind: number;
}

interface PendingElement {
    mode: number;
    tableIndex: number;
    offsetBytes: number[] | null;
    funcNames: string[] | null;
    exprs: ElementExpr[] | null;
    refType: RefType;
    elemKind: number;
}

export type ElementExpr =
    | { kind: 'ref.func'; funcName: string }
    | { kind: 'ref.null'; type: RefType }
    | { kind: 'raw'; bytes: number[] };

export interface StringRef { offset: number; length: number; }

// ─────────────────────────────────────────────────────────────────────────────
// DataBuilder
// ─────────────────────────────────────────────────────────────────────────────
class DataBuilder {
    private data: number[] = [];
    private strings: Map<string, StringRef> = new Map();
    private offsets: number[] = [];

    addString(str: string): number { return this.addStringRef(str).offset; }

    addStringRef(str: string): StringRef {
        const existing = this.strings.get(str);
        if (existing) return existing;
        const bytes = new TextEncoder().encode(str);
        const offset = this.data.length;
        this.data.push(...bytes, 0);
        const ref: StringRef = { offset, length: bytes.length };
        this.strings.set(str, ref);
        this.offsets.push(offset);
        return ref;
    }

    addBytes(bytes: number[]): number {
        const offset = this.data.length;
        this.data.push(...bytes);
        this.offsets.push(offset);
        return offset;
    }

    align(alignment: number): void {
        const remainder = this.data.length % alignment;
        if (remainder !== 0) for (let i = 0; i < alignment - remainder; i++) this.data.push(0);
    }

    reserve(size: number): number {
        const offset = this.data.length;
        for (let i = 0; i < size; i++) this.data.push(0);
        return offset;
    }

    getStringOffset(str: string): number {
        const ref = this.strings.get(str);
        if (!ref) throw new Error(`String "${str}" no encontrada en DataBuilder`);
        return ref.offset;
    }

    getStringRef(str: string): StringRef {
        const ref = this.strings.get(str);
        if (!ref) throw new Error(`String "${str}" no encontrada en DataBuilder`);
        return ref;
    }

    getOffsets(): number[] { return this.offsets; }
    get length(): number { return this.data.length; }
    build(): Uint8Array { return new Uint8Array(this.data); }
}

// ─────────────────────────────────────────────────────────────────────────────
// StringPool
// ─────────────────────────────────────────────────────────────────────────────
export class StringPool {
    private data: number[] = [];
    private offsets = new Map<string, { offset: number; length: number }>();
    private baseOffset: number;

    constructor(baseOffset: number = 0) { this.baseOffset = baseOffset; }

    getBaseOffset(): number { return this.baseOffset; }

    add(str: string): { offset: number; length: number } {
        const cached = this.offsets.get(str);
        if (cached) {
            return { offset: this.baseOffset + cached.offset + 4, length: cached.length };
        }
        const bytes = new TextEncoder().encode(str);
        const internalOffset = this.data.length;
        const len = bytes.length;
        this.data.push(len & 0xFF, (len >> 8) & 0xFF, (len >> 16) & 0xFF, (len >> 24) & 0xFF);
        for (let i = 0; i < bytes.length; i++) this.data.push(bytes[i]);
        this.offsets.set(str, { offset: internalOffset, length: len });
        return { offset: this.baseOffset + internalOffset + 4, length: len };
    }

    getDataSegments(): { offset: number; data: Uint8Array }[] {
        if (this.data.length === 0) return [];
        return [{ offset: this.baseOffset, data: new Uint8Array(this.data) }];
    }

        /** Todas las entradas del pool, en orden de inserción. */
    getAllEntries(): Array<{ text: string; userOffset: number }> {
        const entries: Array<{ text: string; userOffset: number }> = [];
        for (const [text, { offset }] of this.offsets) {
            entries.push({ text, userOffset: this.baseOffset + offset + 4 });
        }
        return entries;
    }

    /** Vacía el pool. Se usa para re-construirlo tras DCE. */
    reset(): void {
        this.data = [];
        this.offsets.clear();
    }

    rawBytes(): Uint8Array { return new Uint8Array(this.data); }

    fromString(context: FunctionIRBuilder, text: string): void {
        const ref = this.add(text);
        context.i32DataConst(ref.offset);
    }

    connect(module: ModuleBuilder): void { module.attachStringPool(this); }
}

// ─────────────────────────────────────────────────────────────────────────────
// IR
// ─────────────────────────────────────────────────────────────────────────────
type IRInstruction =
    | { op: 'UNREACHABLE' } | { op: 'NOP' }
    | { op: 'BLOCK'; blocktype: number } | { op: 'LOOP'; blocktype: number }
    | { op: 'IF'; blocktype: number } | { op: 'ELSE' } | { op: 'END' }
    | { op: 'BR'; depth: number } | { op: 'BR_IF'; depth: number }
    | { op: 'BR_TABLE'; labels: number[]; default: number }
    | { op: 'RETURN' }
    | { op: 'CALL'; index: number }
    | { op: 'CALL_BY_NAME'; name: string }
    | { op: 'CALL_INDIRECT'; typeIdx: number }
    | { op: 'CALL_REF'; typeIdx: number }
    | { op: 'RETURN_CALL_REF'; typeIdx: number }
    | { op: 'DROP' }
    | { op: 'SELECT' }
    | { op: 'SELECT_T'; types: ValueType[] }
    | { op: 'LOCAL_GET'; index: number } | { op: 'LOCAL_SET'; index: number } | { op: 'LOCAL_TEE'; index: number }
    | { op: 'GLOBAL_GET'; index: number | string } | { op: 'GLOBAL_SET'; index: number | string }
    | { op: 'I32_CONST'; val: number } | { op: 'I64_CONST'; val: bigint | number }
    | { op: 'F32_CONST'; val: number } | { op: 'F64_CONST'; val: number }
    | { op: 'I32_DATA_CONST'; val: number }
    | { op: 'I32_CLZ' } | { op: 'I32_CTZ' } | { op: 'I32_POPCNT' }
    | { op: 'I64_CLZ' } | { op: 'I64_CTZ' } | { op: 'I64_POPCNT' }
    | { op: 'I32_ROTL' } | { op: 'I32_ROTR' } | { op: 'I64_ROTL' } | { op: 'I64_ROTR' }
    | { op: 'I32_EQZ' } | { op: 'I64_EQZ' }
    | { op: 'I32_EQ' } | { op: 'I32_NE' }
    | { op: 'I32_LT_S' } | { op: 'I32_LT_U' } | { op: 'I32_GT_S' } | { op: 'I32_GT_U' }
    | { op: 'I32_LE_S' } | { op: 'I32_LE_U' } | { op: 'I32_GE_S' } | { op: 'I32_GE_U' }
    | { op: 'I64_EQ' } | { op: 'I64_NE' }
    | { op: 'I64_LT_S' } | { op: 'I64_LT_U' } | { op: 'I64_GT_S' } | { op: 'I64_GT_U' }
    | { op: 'I64_LE_S' } | { op: 'I64_LE_U' } | { op: 'I64_GE_S' } | { op: 'I64_GE_U' }
    | { op: 'F32_EQ' } | { op: 'F32_NE' } | { op: 'F32_LT' } | { op: 'F32_GT' } | { op: 'F32_LE' } | { op: 'F32_GE' }
    | { op: 'F64_EQ' } | { op: 'F64_NE' } | { op: 'F64_LT' } | { op: 'F64_GT' } | { op: 'F64_LE' } | { op: 'F64_GE' }
    | { op: 'I32_ADD' } | { op: 'I32_SUB' } | { op: 'I32_MUL' }
    | { op: 'I32_DIV_S' } | { op: 'I32_DIV_U' } | { op: 'I32_REM_S' } | { op: 'I32_REM_U' }
    | { op: 'I32_AND' } | { op: 'I32_OR' } | { op: 'I32_XOR' }
    | { op: 'I32_SHL' } | { op: 'I32_SHR_S' } | { op: 'I32_SHR_U' }
    | { op: 'I64_ADD' } | { op: 'I64_SUB' } | { op: 'I64_MUL' }
    | { op: 'I64_DIV_S' } | { op: 'I64_DIV_U' } | { op: 'I64_REM_S' } | { op: 'I64_REM_U' }
    | { op: 'I64_AND' } | { op: 'I64_OR' } | { op: 'I64_XOR' }
    | { op: 'I64_SHL' } | { op: 'I64_SHR_S' } | { op: 'I64_SHR_U' }
    | { op: 'F32_ADD' } | { op: 'F32_SUB' } | { op: 'F32_MUL' } | { op: 'F32_DIV' }
    | { op: 'F32_MIN' } | { op: 'F32_MAX' } | { op: 'F32_COPYSIGN' }
    | { op: 'F64_ADD' } | { op: 'F64_SUB' } | { op: 'F64_MUL' } | { op: 'F64_DIV' }
    | { op: 'F64_MIN' } | { op: 'F64_MAX' } | { op: 'F64_COPYSIGN' }
    | { op: 'F32_ABS' } | { op: 'F32_NEG' } | { op: 'F32_CEIL' } | { op: 'F32_FLOOR' }
    | { op: 'F32_TRUNC' } | { op: 'F32_NEAREST' } | { op: 'F32_SQRT' }
    | { op: 'F64_ABS' } | { op: 'F64_NEG' } | { op: 'F64_CEIL' } | { op: 'F64_FLOOR' }
    | { op: 'F64_TRUNC' } | { op: 'F64_NEAREST' } | { op: 'F64_SQRT' }
    | { op: 'I32_WRAP_I64' }
    | { op: 'I32_TRUNC_F32_S' } | { op: 'I32_TRUNC_F32_U' } | { op: 'I32_TRUNC_F64_S' } | { op: 'I32_TRUNC_F64_U' }
    | { op: 'I64_TRUNC_F32_S' } | { op: 'I64_TRUNC_F32_U' } | { op: 'I64_TRUNC_F64_S' } | { op: 'I64_TRUNC_F64_U' }
    | { op: 'F32_CONVERT_I32_S' } | { op: 'F32_CONVERT_I32_U' } | { op: 'F32_CONVERT_I64_S' } | { op: 'F32_CONVERT_I64_U' }
    | { op: 'F64_CONVERT_I32_S' } | { op: 'F64_CONVERT_I32_U' } | { op: 'F64_CONVERT_I64_S' } | { op: 'F64_CONVERT_I64_U' }
    | { op: 'F32_DEMOTE_F64' } | { op: 'F64_PROMOTE_F32' }
    | { op: 'I32_REINTERPRET_F32' } | { op: 'I64_REINTERPRET_F64' }
    | { op: 'F32_REINTERPRET_I32' } | { op: 'F64_REINTERPRET_I64' }
    | { op: 'I64_EXTEND_I32_S' } | { op: 'I64_EXTEND_I32_U' }
    | { op: 'REF_NULL'; type: RefType }
    | { op: 'REF_IS_NULL' }
    | { op: 'REF_FUNC'; index: number }
    | { op: 'REF_FUNC_BY_NAME'; name: string }
    | { op: 'TABLE_GET'; tableIdx?: number }
    | { op: 'TABLE_SET'; tableIdx?: number }
    | { op: 'TABLE_GROW'; tableIdx?: number }
    | { op: 'TABLE_SIZE'; tableIdx?: number }
    | { op: 'TABLE_FILL'; tableIdx?: number }
    | { op: 'TABLE_COPY'; dstIdx: number; srcIdx: number }
    | { op: 'TABLE_INIT'; tableIdx: number; elemIdx: number }
    | { op: 'ELEM_DROP'; elemIdx: number }
    | { op: 'MEMORY_INIT'; dataIdx: number }
    | { op: 'DATA_DROP'; dataIdx: number }
    | { op: 'MEMORY_FILL' }
    | { op: 'I32_LOAD'; offset?: number; align?: number }
    | { op: 'I64_LOAD'; offset?: number; align?: number }
    | { op: 'F32_LOAD'; offset?: number; align?: number }
    | { op: 'F64_LOAD'; offset?: number; align?: number }
    | { op: 'I32_LOAD8_S'; offset?: number; align?: number }
    | { op: 'I32_LOAD8_U'; offset?: number; align?: number }
    | { op: 'I32_LOAD16_S'; offset?: number; align?: number }
    | { op: 'I32_LOAD16_U'; offset?: number; align?: number }
    | { op: 'I64_LOAD8_S'; offset?: number; align?: number }
    | { op: 'I64_LOAD8_U'; offset?: number; align?: number }
    | { op: 'I64_LOAD16_S'; offset?: number; align?: number }
    | { op: 'I64_LOAD16_U'; offset?: number; align?: number }
    | { op: 'I64_LOAD32_S'; offset?: number; align?: number }
    | { op: 'I64_LOAD32_U'; offset?: number; align?: number }
    | { op: 'I32_STORE'; offset?: number; align?: number }
    | { op: 'I64_STORE'; offset?: number; align?: number }
    | { op: 'F32_STORE'; offset?: number; align?: number }
    | { op: 'F64_STORE'; offset?: number; align?: number }
    | { op: 'I32_STORE8'; offset?: number; align?: number }
    | { op: 'I32_STORE16'; offset?: number; align?: number }
    | { op: 'I64_STORE8'; offset?: number; align?: number }
    | { op: 'I64_STORE16'; offset?: number; align?: number }
    | { op: 'I64_STORE32'; offset?: number; align?: number }
    | { op: 'MEMORY_SIZE'; memidx?: number }
    | { op: 'MEMORY_GROW'; memidx?: number }
    | { op: 'MEMORY_COPY' }
    | { op: 'I32_TRUNC_SAT_F32_S' } | { op: 'I32_TRUNC_SAT_F32_U' }
    | { op: 'I32_TRUNC_SAT_F64_S' } | { op: 'I32_TRUNC_SAT_F64_U' }
    | { op: 'I64_TRUNC_SAT_F32_S' } | { op: 'I64_TRUNC_SAT_F32_U' }
    | { op: 'I64_TRUNC_SAT_F64_S' } | { op: 'I64_TRUNC_SAT_F64_U' }
    | { op: 'FUNCTION_INDEX_BY_NAME'; name: string }
    | { op: 'ENV_ADDR_BY_NAME'; name: string }
    // ─── SIMD ────────────────────────────────────────────────────────────
    | { op: 'SIMD_NOIMM'; name: string }
    | { op: 'SIMD_MEMARG'; name: string; offset?: number; align?: number }
    | { op: 'SIMD_MEMARG_LANE'; name: string; offset?: number; align?: number; lane: number }
    | { op: 'SIMD_LANE'; name: string; lane: number }
    | { op: 'SIMD_CONST'; bytes: number[] }
    | { op: 'SIMD_SHUFFLE'; lanes: number[] };

// ─────────────────────────────────────────────────────────────────────────────
// FunctionIRBuilder
// ─────────────────────────────────────────────────────────────────────────────
class FunctionIRBuilder {
    paramTypes: ValueType[];
    returnType: ValueType[];
    instructions: IRInstruction[];
    nextLocalIdx: number;
    private localNames: Map<string, LocalEntry>;
    private localTypes: ValueType[];
    blockLabelStack: (string | null)[];
    lastInstructionWasTerminator: boolean;
    needsMemory: boolean;
    private finalized = false;
    private moduleRef: ModuleBuilder | null = null;

    constructor(
        paramTypes: ValueType[] = [],
        returnType: ValueType[] = [],
        paramNames: string[] = [],
        moduleRef?: ModuleBuilder
    ) {
        this.paramTypes = paramTypes;
        this.returnType = returnType;
        this.instructions = [];
        this.nextLocalIdx = paramTypes.length;
        this.localNames = new Map();
        this.localTypes = paramTypes.slice();
        this.blockLabelStack = [];
        this.lastInstructionWasTerminator = false;
        this.needsMemory = false;
        this.moduleRef = moduleRef ?? null;

        if (paramNames.length > 0) {
            if (paramNames.length !== paramTypes.length) {
                throw new Error(`Longitud de paramNames (${paramNames.length}) no coincide con paramTypes (${paramTypes.length})`);
            }
            for (let i = 0; i < paramNames.length; i++) this.setParamName(i, paramNames[i]);
        }
    }

    addString(text: string): void {
        this.needsMemory = true;
        if (!this.moduleRef) throw new Error('addString requiere ModuleBuilder');
        const ref = this.moduleRef.addString(text);
        this.i32DataConst(ref.offset);
    }

    functionIndexByName(name: string): void {
        this._checkNotFinalized();
        this.instructions.push({ op: 'FUNCTION_INDEX_BY_NAME', name });
        this.lastInstructionWasTerminator = false;
    }
    envAddrByName(name: string): void {
    this._checkNotFinalized();
    this.instructions.push({ op: 'ENV_ADDR_BY_NAME', name });
    this.lastInstructionWasTerminator = false;
    }
// emitirBytecode
    setParamName(index: number, name: string): void {
        if (index < 0 || index >= this.paramTypes.length) {
            throw new Error(`Índice de parámetro fuera de rango: ${index}`);
        }
        this.localNames.set(name, { index, type: this.paramTypes[index] });
    }

    addLocal(name: string, type: ValueType = 'i32'): number {
        if (this.finalized) throw new Error('No se pueden añadir locales después de finalizar');
        const idx = this.nextLocalIdx++;
        this.localNames.set(name, { index: idx, type });
        this.localTypes[idx] = type;
        return idx;
    }

    getTempLocal(slot: number = 0): number {
        const name = `__temp${slot}`;
        const entry = this.localNames.get(name);
        if (entry) return entry.index;
        return this.addLocal(name, 'i32');
    }

    getTempF64Local(): number {
        const name = '__temp_f64';
        const entry = this.localNames.get(name);
        if (entry) return entry.index;
        return this.addLocal(name, 'f64');
    }

    private _checkNotFinalized(): void {
        if (this.finalized) throw new Error('No se pueden añadir instrucciones después de finalizar');
    }

    setReturnType(...types: (ValueType | ValueType[] | null)[]): void {
        this._checkNotFinalized();
        if (types.length === 0) { this.returnType = []; return; }
        const first = types[0];
        if (types.length === 1 && first === null) { this.returnType = []; return; }
        if (types.length === 1 && Array.isArray(first)) { this.returnType = [...first]; return; }
        this.returnType = types as ValueType[];
    }

    setReturnTypes(...types: ValueType[]): void {
        this._checkNotFinalized();
        this.returnType = [...types];
    }

    private _resolveLocal(nameOrIndex: number | string): number {
        if (typeof nameOrIndex === 'number') return nameOrIndex;
        const entry = this.localNames.get(nameOrIndex);
        if (entry) return entry.index;
        throw new Error(`Variable local no definida: ${nameOrIndex}`);
    }

    getLocal(n: number | string): void { this._checkNotFinalized(); this.instructions.push({ op: 'LOCAL_GET', index: this._resolveLocal(n) }); this.lastInstructionWasTerminator = false; }
    setLocal(n: number | string): void { this._checkNotFinalized(); this.instructions.push({ op: 'LOCAL_SET', index: this._resolveLocal(n) }); this.lastInstructionWasTerminator = false; }
    teeLocal(n: number | string): void { this._checkNotFinalized(); this.instructions.push({ op: 'LOCAL_TEE', index: this._resolveLocal(n) }); this.lastInstructionWasTerminator = false; }

    globalGet(n: number | string): void { this._checkNotFinalized(); this.instructions.push({ op: 'GLOBAL_GET', index: n }); this.lastInstructionWasTerminator = false; }
    globalSet(n: number | string): void { this._checkNotFinalized(); this.instructions.push({ op: 'GLOBAL_SET', index: n }); this.lastInstructionWasTerminator = false; }

    i32Const(v: number): void { this._checkNotFinalized(); this.instructions.push({ op: 'I32_CONST', val: v }); this.lastInstructionWasTerminator = false; }
    i64Const(v: bigint | number): void { this._checkNotFinalized(); this.instructions.push({ op: 'I64_CONST', val: v }); this.lastInstructionWasTerminator = false; }
    f32Const(v: number): void { this._checkNotFinalized(); this.instructions.push({ op: 'F32_CONST', val: v }); this.lastInstructionWasTerminator = false; }
    f64Const(v: number): void { this._checkNotFinalized(); this.instructions.push({ op: 'F64_CONST', val: v }); this.lastInstructionWasTerminator = false; }

    private _u(op: string): void { this._checkNotFinalized(); this.instructions.push({ op } as any); this.lastInstructionWasTerminator = false; }

    i32Clz() { this._u('I32_CLZ'); } i32Ctz() { this._u('I32_CTZ'); } i32Popcnt() { this._u('I32_POPCNT'); }
    i64Clz() { this._u('I64_CLZ'); } i64Ctz() { this._u('I64_CTZ'); } i64Popcnt() { this._u('I64_POPCNT'); }
    i32Rotl() { this._u('I32_ROTL'); } i32Rotr() { this._u('I32_ROTR'); }
    i64Rotl() { this._u('I64_ROTL'); } i64Rotr() { this._u('I64_ROTR'); }
    i32Eqz() { this._u('I32_EQZ'); } i64Eqz() { this._u('I64_EQZ'); }
    i32Eq() { this._u('I32_EQ'); } i32Ne() { this._u('I32_NE'); }
    i32LtS() { this._u('I32_LT_S'); } i32LtU() { this._u('I32_LT_U'); }
    i32GtS() { this._u('I32_GT_S'); } i32GtU() { this._u('I32_GT_U'); }
    i32LeS() { this._u('I32_LE_S'); } i32LeU() { this._u('I32_LE_U'); }
    i32GeS() { this._u('I32_GE_S'); } i32GeU() { this._u('I32_GE_U'); }
    i32Add() { this._u('I32_ADD'); } i32Sub() { this._u('I32_SUB'); } i32Mul() { this._u('I32_MUL'); }
    i32DivS() { this._u('I32_DIV_S'); } i32DivU() { this._u('I32_DIV_U'); }
    i32RemS() { this._u('I32_REM_S'); } i32RemU() { this._u('I32_REM_U'); }
    i32And() { this._u('I32_AND'); } i32Or() { this._u('I32_OR'); } i32Xor() { this._u('I32_XOR'); }
    i32Shl() { this._u('I32_SHL'); } i32ShrS() { this._u('I32_SHR_S'); } i32ShrU() { this._u('I32_SHR_U'); }
    i32DataConst(val: number): void { this._checkNotFinalized(); this.instructions.push({ op: 'I32_DATA_CONST', val }); this.lastInstructionWasTerminator = false; }

    i64Eq() { this._u('I64_EQ'); } i64Ne() { this._u('I64_NE'); }
    i64LtS() { this._u('I64_LT_S'); } i64LtU() { this._u('I64_LT_U'); }
    i64GtS() { this._u('I64_GT_S'); } i64GtU() { this._u('I64_GT_U'); }
    i64LeS() { this._u('I64_LE_S'); } i64LeU() { this._u('I64_LE_U'); }
    i64GeS() { this._u('I64_GE_S'); } i64GeU() { this._u('I64_GE_U'); }
    i64Add() { this._u('I64_ADD'); } i64Sub() { this._u('I64_SUB'); } i64Mul() { this._u('I64_MUL'); }
    i64DivS() { this._u('I64_DIV_S'); } i64DivU() { this._u('I64_DIV_U'); }
    i64RemS() { this._u('I64_REM_S'); } i64RemU() { this._u('I64_REM_U'); }
    i64And() { this._u('I64_AND'); } i64Or() { this._u('I64_OR'); } i64Xor() { this._u('I64_XOR'); }
    i64Shl() { this._u('I64_SHL'); } i64ShrS() { this._u('I64_SHR_S'); } i64ShrU() { this._u('I64_SHR_U'); }

    f32Abs() { this._u('F32_ABS'); } f32Neg() { this._u('F32_NEG'); } f32Ceil() { this._u('F32_CEIL'); }
    f32Floor() { this._u('F32_FLOOR'); } f32Trunc() { this._u('F32_TRUNC'); } f32Nearest() { this._u('F32_NEAREST'); }
    f32Sqrt() { this._u('F32_SQRT'); } f32Add() { this._u('F32_ADD'); } f32Sub() { this._u('F32_SUB'); }
    f32Mul() { this._u('F32_MUL'); } f32Div() { this._u('F32_DIV'); } f32Min() { this._u('F32_MIN'); }
    f32Max() { this._u('F32_MAX'); } f32Copysign() { this._u('F32_COPYSIGN'); }
    f32Eq() { this._u('F32_EQ'); } f32Ne() { this._u('F32_NE'); } f32Lt() { this._u('F32_LT'); }
    f32Gt() { this._u('F32_GT'); } f32Le() { this._u('F32_LE'); } f32Ge() { this._u('F32_GE'); }

    f64Abs() { this._u('F64_ABS'); } f64Neg() { this._u('F64_NEG'); } f64Ceil() { this._u('F64_CEIL'); }
    f64Floor() { this._u('F64_FLOOR'); } f64Trunc() { this._u('F64_TRUNC'); } f64Nearest() { this._u('F64_NEAREST'); }
    f64Sqrt() { this._u('F64_SQRT'); } f64Add() { this._u('F64_ADD'); } f64Sub() { this._u('F64_SUB'); }
    f64Mul() { this._u('F64_MUL'); } f64Div() { this._u('F64_DIV'); } f64Min() { this._u('F64_MIN'); }
    f64Max() { this._u('F64_MAX'); } f64Copysign() { this._u('F64_COPYSIGN'); }
    f64Eq() { this._u('F64_EQ'); } f64Ne() { this._u('F64_NE'); } f64Lt() { this._u('F64_LT'); }
    f64Gt() { this._u('F64_GT'); } f64Le() { this._u('F64_LE'); } f64Ge() { this._u('F64_GE'); }

    i32WrapI64() { this._u('I32_WRAP_I64'); }
    i32TruncF32S() { this._u('I32_TRUNC_F32_S'); } i32TruncF32U() { this._u('I32_TRUNC_F32_U'); }
    i32TruncF64S() { this._u('I32_TRUNC_F64_S'); } i32TruncF64U() { this._u('I32_TRUNC_F64_U'); }
    i64TruncF32S() { this._u('I64_TRUNC_F32_S'); } i64TruncF32U() { this._u('I64_TRUNC_F32_U'); }
    i64TruncF64S() { this._u('I64_TRUNC_F64_S'); } i64TruncF64U() { this._u('I64_TRUNC_F64_U'); }
    f32ConvertI32S() { this._u('F32_CONVERT_I32_S'); } f32ConvertI32U() { this._u('F32_CONVERT_I32_U'); }
    f32ConvertI64S() { this._u('F32_CONVERT_I64_S'); } f32ConvertI64U() { this._u('F32_CONVERT_I64_U'); }
    f64ConvertI32S() { this._u('F64_CONVERT_I32_S'); } f64ConvertI32U() { this._u('F64_CONVERT_I32_U'); }
    f64ConvertI64S() { this._u('F64_CONVERT_I64_S'); } f64ConvertI64U() { this._u('F64_CONVERT_I64_U'); }
    f32DemoteF64() { this._u('F32_DEMOTE_F64'); } f64PromoteF32() { this._u('F64_PROMOTE_F32'); }
    i32ReinterpretF32() { this._u('I32_REINTERPRET_F32'); } i64ReinterpretF64() { this._u('I64_REINTERPRET_F64'); }
    f32ReinterpretI32() { this._u('F32_REINTERPRET_I32'); } f64ReinterpretI64() { this._u('F64_REINTERPRET_I64'); }
    i64ExtendI32S() { this._u('I64_EXTEND_I32_S'); } i64ExtendI32U() { this._u('I64_EXTEND_I32_U'); }

    i32TruncSatF32S() { this._u('I32_TRUNC_SAT_F32_S'); } i32TruncSatF32U() { this._u('I32_TRUNC_SAT_F32_U'); }
    i32TruncSatF64S() { this._u('I32_TRUNC_SAT_F64_S'); } i32TruncSatF64U() { this._u('I32_TRUNC_SAT_F64_U'); }
    i64TruncSatF32S() { this._u('I64_TRUNC_SAT_F32_S'); } i64TruncSatF32U() { this._u('I64_TRUNC_SAT_F32_U'); }
    i64TruncSatF64S() { this._u('I64_TRUNC_SAT_F64_S'); } i64TruncSatF64U() { this._u('I64_TRUNC_SAT_F64_U'); }

    select() { this._u('SELECT'); }
    selectT(types: ValueType[]) { this._checkNotFinalized(); this.instructions.push({ op: 'SELECT_T', types }); this.lastInstructionWasTerminator = false; }

    refNull(type: RefType) { this._checkNotFinalized(); this.instructions.push({ op: 'REF_NULL', type }); this.lastInstructionWasTerminator = false; }
    refIsNull() { this._u('REF_IS_NULL'); }
    refFunc(index: number) { this._checkNotFinalized(); this.instructions.push({ op: 'REF_FUNC', index }); this.lastInstructionWasTerminator = false; }
    refFuncByName(name: string) { this._checkNotFinalized(); this.instructions.push({ op: 'REF_FUNC_BY_NAME', name }); this.lastInstructionWasTerminator = false; }

    tableGet(t = 0) { this._checkNotFinalized(); this.instructions.push({ op: 'TABLE_GET', tableIdx: t }); this.lastInstructionWasTerminator = false; }
    tableSet(t = 0) { this._checkNotFinalized(); this.instructions.push({ op: 'TABLE_SET', tableIdx: t }); this.lastInstructionWasTerminator = false; }
    tableGrow(t = 0) { this._checkNotFinalized(); this.instructions.push({ op: 'TABLE_GROW', tableIdx: t }); this.lastInstructionWasTerminator = false; }
    tableSize(t = 0) { this._checkNotFinalized(); this.instructions.push({ op: 'TABLE_SIZE', tableIdx: t }); this.lastInstructionWasTerminator = false; }
    tableFill(t = 0) { this._checkNotFinalized(); this.instructions.push({ op: 'TABLE_FILL', tableIdx: t }); this.lastInstructionWasTerminator = false; }
    tableCopy(dst = 0, src = 0) { this._checkNotFinalized(); this.instructions.push({ op: 'TABLE_COPY', dstIdx: dst, srcIdx: src }); this.lastInstructionWasTerminator = false; }
    tableInit(tableIdx = 0, elemIdx = 0) { this._checkNotFinalized(); this.instructions.push({ op: 'TABLE_INIT', tableIdx, elemIdx }); this.lastInstructionWasTerminator = false; }
    elemDrop(elemIdx: number) { this._checkNotFinalized(); this.instructions.push({ op: 'ELEM_DROP', elemIdx }); this.lastInstructionWasTerminator = false; }

    memoryInit(dataIdx: number) { this._checkNotFinalized(); this.needsMemory = true; this.instructions.push({ op: 'MEMORY_INIT', dataIdx }); this.lastInstructionWasTerminator = false; }
    dataDrop(dataIdx: number) { this._checkNotFinalized(); this.instructions.push({ op: 'DATA_DROP', dataIdx }); this.lastInstructionWasTerminator = false; }
    memoryFill() { this._checkNotFinalized(); this.needsMemory = true; this.instructions.push({ op: 'MEMORY_FILL' }); this.lastInstructionWasTerminator = false; }
    memoryCopy() { this._checkNotFinalized(); this.needsMemory = true; this.instructions.push({ op: 'MEMORY_COPY' }); this.lastInstructionWasTerminator = false; }

    ensureTableCapacity(tableIdx: number, indexLocal: number | string, fillRefType: RefType = 'funcref'): void {
        this._checkNotFinalized();
        const idx = this._resolveLocal(indexLocal);
        this.getLocal(idx);
        this.tableSize(tableIdx);
        this.i32GeU();
        this.if_('void');
            this.refNull(fillRefType);
            this.getLocal(idx);
            this.i32Const(1);
            this.i32Add();
            this.tableSize(tableIdx);
            this.i32Sub();
            this.tableGrow(tableIdx);
            this.drop();
        this.end();
    }

    private _memOp(op: string, offset = 0, align = 0): void {
        this._checkNotFinalized();
        this.needsMemory = true;
        this.instructions.push({ op, offset, align } as any);
        this.lastInstructionWasTerminator = false;
    }
    i32Load(o = 0, a = 0) { this._memOp('I32_LOAD', o, a); }
    i64Load(o = 0, a = 0) { this._memOp('I64_LOAD', o, a); }
    f32Load(o = 0, a = 0) { this._memOp('F32_LOAD', o, a); }
    f64Load(o = 0, a = 0) { this._memOp('F64_LOAD', o, a); }
    i32Load8S(o = 0, a = 0) { this._memOp('I32_LOAD8_S', o, a); }
    i32Load8U(o = 0, a = 0) { this._memOp('I32_LOAD8_U', o, a); }
    i32Load16S(o = 0, a = 0) { this._memOp('I32_LOAD16_S', o, a); }
    i32Load16U(o = 0, a = 0) { this._memOp('I32_LOAD16_U', o, a); }
    i64Load8S(o = 0, a = 0) { this._memOp('I64_LOAD8_S', o, a); }
    i64Load8U(o = 0, a = 0) { this._memOp('I64_LOAD8_U', o, a); }
    i64Load16S(o = 0, a = 0) { this._memOp('I64_LOAD16_S', o, a); }
    i64Load16U(o = 0, a = 0) { this._memOp('I64_LOAD16_U', o, a); }
    i64Load32S(o = 0, a = 0) { this._memOp('I64_LOAD32_S', o, a); }
    i64Load32U(o = 0, a = 0) { this._memOp('I64_LOAD32_U', o, a); }
    i32Store(o = 0, a = 0) { this._memOp('I32_STORE', o, a); }
    i64Store(o = 0, a = 0) { this._memOp('I64_STORE', o, a); }
    f32Store(o = 0, a = 0) { this._memOp('F32_STORE', o, a); }
    f64Store(o = 0, a = 0) { this._memOp('F64_STORE', o, a); }
    i32Store8(o = 0, a = 0) { this._memOp('I32_STORE8', o, a); }
    i32Store16(o = 0, a = 0) { this._memOp('I32_STORE16', o, a); }
    i64Store8(o = 0, a = 0) { this._memOp('I64_STORE8', o, a); }
    i64Store16(o = 0, a = 0) { this._memOp('I64_STORE16', o, a); }
    i64Store32(o = 0, a = 0) { this._memOp('I64_STORE32', o, a); }
    memorySize() { this._memOp('MEMORY_SIZE'); }
    memoryGrow() { this._memOp('MEMORY_GROW'); }

    call(index: number) { this._checkNotFinalized(); this.instructions.push({ op: 'CALL', index }); this.lastInstructionWasTerminator = false; }
    callByName(name: string) { this._checkNotFinalized(); this.instructions.push({ op: 'CALL_BY_NAME', name }); this.lastInstructionWasTerminator = false; }
    callIndirect(typeIdx: number) { this._checkNotFinalized(); this.instructions.push({ op: 'CALL_INDIRECT', typeIdx }); this.lastInstructionWasTerminator = false; }
    callRef(typeIdx: number) { this._checkNotFinalized(); this.instructions.push({ op: 'CALL_REF', typeIdx }); this.lastInstructionWasTerminator = false; }
    returnCallRef(typeIdx: number) { this._checkNotFinalized(); this.instructions.push({ op: 'RETURN_CALL_REF', typeIdx }); this.lastInstructionWasTerminator = true; }

    private _blockTypeToOp(type: ValueType | 'void' | number): number {
        if (typeof type === 'number') return type;
        if (type === 'void') return 0x40;
        return typeToOp(type);
    }

    block(type: ValueType | 'void' | number = 'void', label: string | null = null): void {
        this._checkNotFinalized();
        this.instructions.push({ op: 'BLOCK', blocktype: this._blockTypeToOp(type) });
        this.blockLabelStack.push(label);
        this.lastInstructionWasTerminator = false;
    }
    loop(type: ValueType | 'void' | number = 'void', label: string | null = null): void {
        this._checkNotFinalized();
        this.instructions.push({ op: 'LOOP', blocktype: this._blockTypeToOp(type) });
        this.blockLabelStack.push(label);
        this.lastInstructionWasTerminator = false;
    }
    if_(type: ValueType | 'void' | number = 'void', label: string | null = null): void {
        this._checkNotFinalized();
        this.instructions.push({ op: 'IF', blocktype: this._blockTypeToOp(type) });
        this.blockLabelStack.push(label);
        this.lastInstructionWasTerminator = false;
    }
    else_() { this._checkNotFinalized(); this.instructions.push({ op: 'ELSE' }); this.lastInstructionWasTerminator = false; }
    end() { this._checkNotFinalized(); this.instructions.push({ op: 'END' }); this.blockLabelStack.pop(); this.lastInstructionWasTerminator = false; }

    private _getDepthToLabel(label: string): number {
        for (let i = this.blockLabelStack.length - 1, depth = 0; i >= 0; i--, depth++) {
            if (this.blockLabelStack[i] === label) return depth;
        }
        throw new Error(`Etiqueta de bloque no encontrada: ${label}`);
    }

    brTo(label: string) { this._checkNotFinalized(); this.instructions.push({ op: 'BR', depth: this._getDepthToLabel(label) }); this.lastInstructionWasTerminator = true; }
    brIfTo(label: string) { this._checkNotFinalized(); this.instructions.push({ op: 'BR_IF', depth: this._getDepthToLabel(label) }); this.lastInstructionWasTerminator = false; }
    br(depth: number) { this._checkNotFinalized(); this.instructions.push({ op: 'BR', depth }); this.lastInstructionWasTerminator = true; }
    brIf(depth: number) { this._checkNotFinalized(); this.instructions.push({ op: 'BR_IF', depth }); this.lastInstructionWasTerminator = false; }

    br_table(targets: (number | string)[], defaultTarget: number | string): void {
        this._checkNotFinalized();
        let labels: number[];
        let defaultDepth: number;
        if (targets.length > 0 && typeof targets[0] === 'string') {
            labels = (targets as string[]).map(l => this._getDepthToLabel(l));
            defaultDepth = typeof defaultTarget === 'string' ? this._getDepthToLabel(defaultTarget) : defaultTarget;
        } else {
            labels = targets as number[];
            defaultDepth = defaultTarget as number;
        }
        this.instructions.push({ op: 'BR_TABLE', labels, default: defaultDepth });
        this.lastInstructionWasTerminator = true;
    }

    return_() { this._checkNotFinalized(); this.instructions.push({ op: 'RETURN' }); this.lastInstructionWasTerminator = true; }
    drop() { this._checkNotFinalized(); this.instructions.push({ op: 'DROP' }); this.lastInstructionWasTerminator = false; }
    unreachable() { this._checkNotFinalized(); this.instructions.push({ op: 'UNREACHABLE' }); this.lastInstructionWasTerminator = true; }
    nop() { this._checkNotFinalized(); this.instructions.push({ op: 'NOP' }); this.lastInstructionWasTerminator = false; }

    // ─── SIMD ────────────────────────────────────────────────────────────
    /** Instrucción SIMD sin immediate. */
    simd(name: keyof typeof SIMD_NOIMM): void {
        this._checkNotFinalized();
        this.instructions.push({ op: 'SIMD_NOIMM', name });
        this.lastInstructionWasTerminator = false;
    }

    /** Instrucción SIMD con memarg (loads/stores). */
    simdMem(name: keyof typeof SIMD_MEMARG, offset = 0, align = 0): void {
        this._checkNotFinalized();
        this.needsMemory = true;
        this.instructions.push({ op: 'SIMD_MEMARG', name, offset, align });
        this.lastInstructionWasTerminator = false;
    }

    /** Instrucción SIMD con memarg + lane (load8_lane, store32_lane, etc). */
    simdMemLane(name: keyof typeof SIMD_MEMARG_LANE, lane: number, offset = 0, align = 0): void {
        this._checkNotFinalized();
        const max = simdMaxLane(name);
        if (!Number.isInteger(lane) || lane < 0 || lane > max) {
            throw new Error(`simdMemLane: lane fuera de rango para ${name} (0..${max}, recibido ${lane})`);
        }
        this.needsMemory = true;
        this.instructions.push({ op: 'SIMD_MEMARG_LANE', name, offset, align, lane });
        this.lastInstructionWasTerminator = false;
    }
    /** Instrucción SIMD con laneidx. */
    simdLane(name: keyof typeof SIMD_LANE, lane: number): void {
        this._checkNotFinalized();
        const max = simdMaxLane(name);
        if (!Number.isInteger(lane) || lane < 0 || lane > max) {
            throw new Error(`simdLane: lane fuera de rango para ${name} (0..${max}, recibido ${lane})`);
        }
        this.instructions.push({ op: 'SIMD_LANE', name, lane });
        this.lastInstructionWasTerminator = false;
    }

    /** v128.const con 16 bytes literales (little-endian). */
    v128Const(bytes: number[]): void {
        if (bytes.length !== 16) throw new Error('v128.const requiere exactamente 16 bytes');
        this._checkNotFinalized();
        this.instructions.push({ op: 'SIMD_CONST', bytes: [...bytes] });
        this.lastInstructionWasTerminator = false;
    }

    /** Helper: construye v128.const con 4 i32. */
    v128ConstI32x4(a: number, b: number, c: number, d: number): void {
        const bytes: number[] = [];
        for (const v of [a, b, c, d]) {
            const buf = new ArrayBuffer(4);
            new DataView(buf).setInt32(0, v | 0, true);
            bytes.push(...new Uint8Array(buf));
        }
        this.v128Const(bytes);
    }

    /** Helper: construye v128.const con 4 f32. */
    v128ConstF32x4(a: number, b: number, c: number, d: number): void {
        const bytes: number[] = [];
        for (const v of [a, b, c, d]) {
            const buf = new ArrayBuffer(4);
            new DataView(buf).setFloat32(0, v, true);
            bytes.push(...new Uint8Array(buf));
        }
        this.v128Const(bytes);
    }

    /** Helper: construye v128.const con 2 f64. */
    v128ConstF64x2(a: number, b: number): void {
        const bytes: number[] = [];
        for (const v of [a, b]) {
            const buf = new ArrayBuffer(8);
            new DataView(buf).setFloat64(0, v, true);
            bytes.push(...new Uint8Array(buf));
        }
        this.v128Const(bytes);
    }

    /** Helper: construye v128.const con 2 i64. */
    v128ConstI64x2(a: bigint | number, b: bigint | number): void {
        const bytes: number[] = [];
        for (const v of [a, b]) {
            const buf = new ArrayBuffer(8);
            new DataView(buf).setBigInt64(0, BigInt.asIntN(64, BigInt(v)), true);
            bytes.push(...new Uint8Array(buf));
        }
        this.v128Const(bytes);
    }

    /** Helper: construye v128.const con 8 i16. */
    v128ConstI16x8(...vals: number[]): void {
        if (vals.length !== 8) throw new Error('v128ConstI16x8 requiere 8 valores');
        const bytes: number[] = [];
        for (const v of vals) {
            const buf = new ArrayBuffer(2);
            new DataView(buf).setInt16(0, v | 0, true);
            bytes.push(...new Uint8Array(buf));
        }
        this.v128Const(bytes);
    }

    /** Helper: construye v128.const con 16 i8. */
    v128ConstI8x16(...vals: number[]): void {
        if (vals.length !== 16) throw new Error('v128ConstI8x16 requiere 16 valores');
        this.v128Const(vals.map(v => v & 0xFF));
    }

    /** i8x16.shuffle: 16 lanes (0..31). */
    i8x16Shuffle(lanes: number[]): void {
        if (lanes.length !== 16) throw new Error('i8x16.shuffle requiere 16 lane indices');
        for (const l of lanes) if (l < 0 || l > 31) throw new Error(`lane fuera de rango: ${l}`);
        this._checkNotFinalized();
        this.instructions.push({ op: 'SIMD_SHUFFLE', lanes: [...lanes] });
        this.lastInstructionWasTerminator = false;
    }

    finalize(): void {
        if (this.finalized) return;
        if (this.blockLabelStack.length > 0) {
            throw new Error(`Hay ${this.blockLabelStack.length} bloque(s) sin cerrar al finalizar la función`);
        }
        this.finalized = true;
    }

    getLocals(): { count: number; type: number }[] {
        const locals: { count: number; type: number }[] = [];
        let currentType: ValueType | null = null;
        let currentCount = 0;
        for (let i = this.paramTypes.length; i < this.nextLocalIdx; i++) {
            const type = this.localTypes[i];
            if (type === undefined) continue;
            if (currentType === type) currentCount++;
            else {
                if (currentType !== null) locals.push({ count: currentCount, type: typeToOp(currentType) });
                currentType = type;
                currentCount = 1;
            }
        }
        if (currentType !== null) locals.push({ count: currentCount, type: typeToOp(currentType) });
        return locals;
    }
    /**
 * Elimina locales que nunca se leen. Los LOCAL_SET a un local muerto se
 * convierten en DROP; los LOCAL_TEE en NOP. Renumera los índices de los
 * locales vivos para compactar la tabla.
 *
 * Solo se puede llamar después de `finalize()`.
 */
pruneUnusedLocals(): void {
    if (!this.finalized) {
        throw new Error('pruneUnusedLocals: la función debe estar finalizada');
    }
    const paramCount = this.paramTypes.length;
    const instrs = this.instructions as any[];

    // 1. Recolectar locales leídos.
    const read = new Set<number>();
    for (const instr of instrs) {
        if (instr.op === 'LOCAL_GET' || instr.op === 'LOCAL_TEE') {
            read.add(instr.index);
        }
    }

    // 2. Qué índices sobreviven: params + los que se leen.
    const keep = new Set<number>();
    for (let i = 0; i < paramCount; i++) keep.add(i);
    for (const i of read) keep.add(i);

    // 3. Renumerar sin huecos.
    const remap = new Map<number, number>();
    let next = 0;
    for (let i = 0; i < this.nextLocalIdx; i++) {
        if (keep.has(i)) remap.set(i, next++);
    }

    // 4. Reescribir instrucciones.
    const newInstrs: any[] = [];
    for (const instr of instrs) {
        if (instr.op === 'LOCAL_GET' || instr.op === 'LOCAL_SET' || instr.op === 'LOCAL_TEE') {
            const mapped = remap.get(instr.index);
            if (mapped === undefined) {
                // Local muerto.
                if (instr.op === 'LOCAL_SET') {
                    newInstrs.push({ op: 'DROP' });
                } else if (instr.op === 'LOCAL_TEE') {
                    newInstrs.push({ op: 'NOP' });
                } else {
                    throw new Error('pruneUnusedLocals: LOCAL_GET de local eliminado');
                }
            } else {
                instr.index = mapped;
                newInstrs.push(instr);
            }
        } else {
            newInstrs.push(instr);
        }
    }
    this.instructions = newInstrs;

    // 5. Reconstruir la tabla de tipos de locales.
    const newTypes: ValueType[] = this.paramTypes.slice();
    for (const [oldIdx, newIdx] of remap) {
        if (oldIdx < paramCount) continue;
        newTypes[newIdx] = this.localTypes[oldIdx];
    }
    this.localTypes = newTypes;
    this.nextLocalIdx = next;
}
}

// ─────────────────────────────────────────────────────────────────────────────
// Optimizador de IR
// ─────────────────────────────────────────────────────────────────────────────
// Dos pases sobre IRInstruction[]:
//
//   1. removeDeadCode: elimina instrucciones inalcanzables tras un terminador
//      (RETURN, BR, UNREACHABLE). Trackea profundidad de bloques para saber
//      cuándo la ejecución puede retomar tras un END/ELSE.
//
//   2. peephole: elimina patrones redundantes locales.
//      - X, i32.const 0, i32.add    → X      (sumar cero)
//      - X, i32.const 1, i32.mul    → X      (multiplicar por uno)
//      - X, i32.const 0, i32.or     → X      (or con cero)
//      - X, i32.const -1, i32.and   → X      (and con todos los bits)
//      - i32.const a, i32.const b, OP → i32.const (a OP b)  (constant folding)
//      - local.set X, local.get X   → local.tee X
//      - local.get X, local.set X   → (eliminado)
//
// Los patrones con X asumen que X produce exactamente un i32 en la pila.
// Solo se aplican cuando X es una instrucción "safe producer" conocida.

const I32_SAFE_PRODUCERS = new Set<string>([
    'I32_CONST', 'I32_DATA_CONST',
    'LOCAL_GET', 'LOCAL_TEE',
    'GLOBAL_GET',
    'I32_LOAD', 'I32_LOAD8_S', 'I32_LOAD8_U',
    'I32_LOAD16_S', 'I32_LOAD16_U',
    'I32_ADD', 'I32_SUB', 'I32_MUL', 'I32_DIV_S', 'I32_DIV_U',
    'I32_REM_S', 'I32_REM_U',
    'I32_AND', 'I32_OR', 'I32_XOR',
    'I32_SHL', 'I32_SHR_S', 'I32_SHR_U', 'I32_ROTL', 'I32_ROTR',
    'I32_CLZ', 'I32_CTZ', 'I32_POPCNT', 'I32_EQZ',
    'I32_EQ', 'I32_NE', 'I32_LT_S', 'I32_LT_U',
    'I32_GT_S', 'I32_GT_U', 'I32_LE_S', 'I32_LE_U',
    'I32_GE_S', 'I32_GE_U',
    'I32_WRAP_I64',
    'I32_TRUNC_F32_S', 'I32_TRUNC_F32_U',
    'I32_TRUNC_F64_S', 'I32_TRUNC_F64_U',
    'I32_REINTERPRET_F32',
    'I32_TRUNC_SAT_F32_S', 'I32_TRUNC_SAT_F32_U',
    'I32_TRUNC_SAT_F64_S', 'I32_TRUNC_SAT_F64_U',
    'MEMORY_SIZE',
]);

// Terminadores que cortan el flujo en su nivel actual.
const IR_TERMINATORS = new Set<string>([
    'RETURN', 'UNREACHABLE', 'BR', 'BR_TABLE', 'RETURN_CALL_REF',
]);

// Opcodes que abren un nuevo nivel de bloque en el IR.
const IR_BLOCK_OPENERS = new Set<string>(['BLOCK', 'LOOP', 'IF']);

function removeDeadCode(ir: IRInstruction[]): IRInstruction[] {
    const out: IRInstruction[] = [];
    // deadStack[level]: ¿estamos en código muerto en este nivel?
    const deadStack: boolean[] = [false];
    // savedOuter[level]: estado del nivel exterior al abrir el bloque actual.
    // Necesario para saber si hay que emitir el END al cerrar.
    const savedOuter: boolean[] = [false];

    const isDead = (): boolean => deadStack[deadStack.length - 1];

    for (const instr of ir) {
        const op = instr.op;

        if (IR_BLOCK_OPENERS.has(op)) {
            const outerDead = isDead();
            savedOuter.push(outerDead);
            deadStack.push(outerDead);
            if (!outerDead) out.push(instr);
            continue;
        }

        if (op === 'ELSE') {
            // Volvemos a código vivo si el bloque externo era vivo.
            const outerDead = savedOuter[savedOuter.length - 1];
            deadStack[deadStack.length - 1] = outerDead;
            if (!outerDead) out.push(instr);
            continue;
        }

        if (op === 'END') {
            deadStack.pop();
            const wasEnteredLive = !savedOuter.pop()!;
            if (wasEnteredLive) out.push(instr);
            continue;
        }

        if (IR_TERMINATORS.has(op)) {
            if (!isDead()) {
                out.push(instr);
                deadStack[deadStack.length - 1] = true;
            }
            continue;
        }

        if (!isDead()) out.push(instr);
    }

    return out;
}

function tryFoldI32Binop(a: number, b: number, op: string): number | null {
    switch (op) {
        case 'I32_ADD': return (a + b) | 0;
        case 'I32_SUB': return (a - b) | 0;
        case 'I32_MUL': return Math.imul(a, b);
        case 'I32_DIV_S': return b === 0 ? null : (a / b) | 0;
        case 'I32_DIV_U': return b === 0 ? null : ((a >>> 0) / (b >>> 0)) >>> 0;
        case 'I32_REM_S': return b === 0 ? null : (a % b) | 0;
        case 'I32_REM_U': return b === 0 ? null : ((a >>> 0) % (b >>> 0)) >>> 0;
        case 'I32_AND': return a & b;
        case 'I32_OR': return a | b;
        case 'I32_XOR': return a ^ b;
        case 'I32_SHL': return (a << (b & 31)) | 0;
        case 'I32_SHR_S': return a >> (b & 31);
        case 'I32_SHR_U': return a >>> (b & 31);
        case 'I32_ROTL': {
            const n = b & 31;
            return ((a << n) | (a >>> (32 - n))) | 0;
        }
        case 'I32_ROTR': {
            const n = b & 31;
            return ((a >>> n) | (a << (32 - n))) | 0;
        }
        case 'I32_EQ': return a === b ? 1 : 0;
        case 'I32_NE': return a !== b ? 1 : 0;
        case 'I32_LT_S': return a < b ? 1 : 0;
        case 'I32_LT_U': return ((a >>> 0) < (b >>> 0)) ? 1 : 0;
        case 'I32_GT_S': return a > b ? 1 : 0;
        case 'I32_GT_U': return ((a >>> 0) > (b >>> 0)) ? 1 : 0;
        case 'I32_LE_S': return a <= b ? 1 : 0;
        case 'I32_LE_U': return ((a >>> 0) <= (b >>> 0)) ? 1 : 0;
        case 'I32_GE_S': return a >= b ? 1 : 0;
        case 'I32_GE_U': return ((a >>> 0) >= (b >>> 0)) ? 1 : 0;
        default: return null;
    }
}

function peephole(ir: IRInstruction[]): IRInstruction[] {
    const out: IRInstruction[] = [];
    for (let i = 0; i < ir.length; i++) {
        const a = ir[i] as any;
        const b = ir[i + 1] as any;
        const c = ir[i + 2] as any;

        // X, i32.const 0, i32.add → X
        if (a && b && c
            && I32_SAFE_PRODUCERS.has(a.op)
            && b.op === 'I32_CONST' && b.val === 0
            && c.op === 'I32_ADD') {
            out.push(a); i += 2; continue;
        }

        // X, i32.const 1, i32.mul → X
        if (a && b && c
            && I32_SAFE_PRODUCERS.has(a.op)
            && b.op === 'I32_CONST' && b.val === 1
            && c.op === 'I32_MUL') {
            out.push(a); i += 2; continue;
        }

        // X, i32.const 0, i32.or → X
        if (a && b && c
            && I32_SAFE_PRODUCERS.has(a.op)
            && b.op === 'I32_CONST' && b.val === 0
            && c.op === 'I32_OR') {
            out.push(a); i += 2; continue;
        }

        // X, i32.const -1, i32.and → X
        if (a && b && c
            && I32_SAFE_PRODUCERS.has(a.op)
            && b.op === 'I32_CONST' && b.val === -1
            && c.op === 'I32_AND') {
            out.push(a); i += 2; continue;
        }

        // i32.const a, i32.const b, OP → i32.const (a OP b)
        if (a && b && c
            && (a.op === 'I32_CONST' || a.op === 'I32_DATA_CONST')
            && (b.op === 'I32_CONST' || b.op === 'I32_DATA_CONST')
            && typeof a.val === 'number' && typeof b.val === 'number') {
            const folded = tryFoldI32Binop(a.val, b.val, c.op);
            if (folded !== null) {
                out.push({ op: 'I32_CONST', val: folded } as IRInstruction);
                i += 2; continue;
            }
        }

        // local.set X, local.get X → local.tee X
        if (a && b
            && a.op === 'LOCAL_SET' && b.op === 'LOCAL_GET'
            && a.index === b.index) {
            out.push({ op: 'LOCAL_TEE', index: a.index } as IRInstruction);
            i += 1; continue;
        }

        // local.get X, local.set X → (eliminado)
        if (a && b
            && a.op === 'LOCAL_GET' && b.op === 'LOCAL_SET'
            && a.index === b.index) {
            i += 1; continue;
        }

        out.push(a);
    }
    return out;
}

function optimizeIR(ir: IRInstruction[]): IRInstruction[] {
    let cur = ir;
    for (let iter = 0; iter < 8; iter++) {
        const next = peephole(removeDeadCode(cur));
        if (next.length === cur.length) break;
        cur = next;
    }
    return cur;
}

// ─────────────────────────────────────────────────────────────────────────────
// ModuleBuilder
// ─────────────────────────────────────────────────────────────────────────────
class ModuleBuilder {
    types: TypeEntry[] = [];
    externals: ExternalEntry[] = [];
    functions: FunctionEntry[] = [];
    globals: GlobalEntry[] = [];
    tables: TableEntry[] = [];
    funcNameToIndex = new Map<string, number>();
    globalNameToIndex = new Map<string, number>();
    hasMemory = false;
    memoryInitial = 1;
    memoryMax?: number;
    dataSegments: DataSegment[] = [];
    elements: ElementSegment[] = [];
    pendingElements: PendingElement[] = [];
    funcAliasToIndex = new Map<string, number>();
    functionTableIndices = new Map<string, number>();
    customSections: CustomSection[] = [];
    startFunction: number | string | null = null;
    private lambdaCounter = 0;
    private typeNameToIdx = new Map<string, number>();
    private dynamicTableMin = 0;
    private tableAuto = false;
    private stringPool: StringPool | null = null;

    setFunctionTableIndex(funcName: string, tableIndex: number): void { this.functionTableIndices.set(funcName, tableIndex); }
    getFunctionTableIndex(funcName: string): number {
        const idx = this.functionTableIndices.get(funcName);
        if (idx === undefined) throw new Error(`Función sin índice de tabla: ${funcName}`);
        return idx;
    }

    addFunctionToTable(funcName: string, tableIndex: number, offset?: number): void {
        const actualOffset = offset ?? tableIndex;
        this.setFunctionTableIndex(funcName, actualOffset);
        this.addElementSegment(0, actualOffset, [funcName]);
    }

    setStart(funcNameOrIndex: number | string): void {
        this.startFunction = funcNameOrIndex;
    }

    addCustomSection(name: string, data: number[], atEnd = false): void {
        this.customSections.push({ name, data, atEnd });
    }

// prepareStringData
    addNameSection(
        moduleName: string | null,
        funcNames: Map<number, string>,
        localNames?: Map<number, Map<number, string>>
    ): void {
        const buf: number[] = [];

        if (moduleName !== null) {
            const sub: number[] = [...encodeName(moduleName)];
            buf.push(0x00, ...encodeLEB128(sub.length), ...sub);
        }

        if (funcNames.size > 0) {
            const sub: number[] = [...encodeLEB128(funcNames.size)];
            const entries = [...funcNames.entries()].sort((a, b) => a[0] - b[0]);
            for (const [idx, name] of entries) {
                sub.push(...encodeLEB128(idx), ...encodeName(name));
            }
            buf.push(0x01, ...encodeLEB128(sub.length), ...sub);
        }

        if (localNames && localNames.size > 0) {
            const sub: number[] = [...encodeLEB128(localNames.size)];
            const funcs = [...localNames.entries()].sort((a, b) => a[0] - b[0]);
            for (const [funcIdx, locals] of funcs) {
                sub.push(...encodeLEB128(funcIdx), ...encodeLEB128(locals.size));
                const sorted = [...locals.entries()].sort((a, b) => a[0] - b[0]);
                for (const [localIdx, name] of sorted) {
                    sub.push(...encodeLEB128(localIdx), ...encodeName(name));
                }
            }
            buf.push(0x02, ...encodeLEB128(sub.length), ...sub);
        }

        this.addCustomSection('name', buf, true);
    }

    addProducersSection(
        producers: { field: string; values: { name: string; version: string }[] }[]
    ): void {
        const buf: number[] = [...encodeLEB128(producers.length)];
        for (const p of producers) {
            buf.push(...encodeName(p.field));
            buf.push(...encodeLEB128(p.values.length));
            for (const v of p.values) {
                buf.push(...encodeName(v.name), ...encodeName(v.version));
            }
        }
        this.addCustomSection('producers', buf, true);
    }

    getStringPool(baseOffset?: number): StringPool {
        if (!this.stringPool) {
            this.stringPool = new StringPool(baseOffset ?? 0);
        } else if (baseOffset !== undefined && baseOffset !== this.stringPool.getBaseOffset()) {
            throw new Error(
                `StringPool ya tiene baseOffset=${this.stringPool.getBaseOffset()}, no se puede cambiar a ${baseOffset}`
            );
        }
        return this.stringPool;
    }
        /** Devuelve el pool actual sin crearlo si no existe. */
    getStringPoolOrNull(): StringPool | null {
        return this.stringPool;
    }

    attachStringPool(pool: StringPool): void {
        if (this.stringPool && this.stringPool !== pool) {
            throw new Error('Ya existe un StringPool asociado al módulo');
        }
        this.stringPool = pool;
    }

    ensureStringData(): void { this.prepareStringData(); }

    addString(text: string): { offset: number; length: number } {
        return this.getStringPool().add(text);
    }

    getTypeIndex(paramTypes: ValueType[], returnTypes: ValueType[]): number {
        return this._getTypeIdx(paramTypes, returnTypes);
    }

    getStaticDataSize(): number {
      return this.dataSegments.reduce(
        (max, seg) => Math.max(max, seg.offset + seg.data.length), 0
      );
    }

    getMemoryInitialPages(): number {
      return this.memoryInitial;
    }

    getStaticDataEnd(align: number = 8): number {
        let end = 0;
        for (const seg of this.dataSegments) {
            const e = seg.offset + seg.data.length;
            if (e > end) end = e;
        }
        if (this.stringPool) {
            for (const seg of this.stringPool.getDataSegments()) {
                const e = seg.offset + seg.data.length;
                if (e > end) end = e;
            }
        }
        if (align <= 1) return end;
        return (end + (align - 1)) & ~(align - 1);
    }

        private prepareStringData(): void {
        if (!this.stringPool) return;
        // Siempre filtramos los viejos segmentos del pool (por si DCE
        // vació el pool o lo reconstruyó con menos strings).
        this.dataSegments = this.dataSegments.filter(ds => !ds.fromStringPool);
        const segments = this.stringPool.getDataSegments();
        if (segments.length === 0) return;
        this.hasMemory = true;
        for (const seg of segments) {
            const newSeg: DataSegment = {
                offset: seg.offset,
                data: Array.from(seg.data),
                fromStringPool: true,
            };
            this.dataSegments.push(newSeg);
            this._updateMemoryForData(newSeg.offset, newSeg.data.length);
        }
    }

    private _getTypeIdx(paramTypes: ValueType[], returnTypes: ValueType[]): number {
        const params = paramTypes.map(typeToOp);
        const results = returnTypes.map(typeToOp);
        const key = JSON.stringify({ params, results });
        let idx = this.types.findIndex(t => JSON.stringify(t) === key);
        if (idx !== -1) return idx;
        idx = this.types.length;
        this.types.push({ params, results });
        return idx;
    }

    private hasMemoryImport(): boolean {
        return this.externals.some(e => e.section === 'import' && e.kind === 'memory');
    }
    private hasTableImport(): boolean {
        return this.externals.some(e => e.section === 'import' && e.kind === 'table');
    }

    addType(paramTypes: ValueType[], returnTypes: ValueType[]): number;
    addType(name: string, paramTypes: ValueType[], returnTypes: ValueType[]): number;
    addType(nameOrParams: string | ValueType[], paramTypesOrReturn?: ValueType[], returnTypes?: ValueType[]): number {
        if (typeof nameOrParams === 'string') {
            const name = nameOrParams;
            if (this.typeNameToIdx.has(name)) throw new Error(`El tipo con nombre "${name}" ya está definido.`);
            const idx = this._getTypeIdx(paramTypesOrReturn!, returnTypes!);
            this.typeNameToIdx.set(name, idx);
            return idx;
        }
        return this._getTypeIdx(nameOrParams as ValueType[], paramTypesOrReturn as ValueType[]);
    }

    addElementSegment(tableIndex: number, offset: number, funcNames: string[]): void {
        const offsetBytes = [OP.I32_CONST, ...encodeSignedLEB128(offset), OP.END];
        this.addElementSegmentByName(tableIndex, offsetBytes, funcNames);
    }

    addElementSegmentByName(tableIndex: number, offsetExprBytes: number[], funcNames: string[]): void {
        const offset = this._decodeOffset(offsetExprBytes);
        const requiredMin = offset + funcNames.length;
        if (requiredMin > this.dynamicTableMin) this.dynamicTableMin = requiredMin;
        if (this.tables.length === 0 && !this.hasTableImport()) this.tableAuto = true;

        const mode = tableIndex === 0 ? 0 : 2;
        this.pendingElements.push({
            mode,
            tableIndex,
            offsetBytes: offsetExprBytes,
            funcNames,
            exprs: null,
            refType: 'funcref',
            elemKind: 0x00,
        });
    }

    addPassiveElementSegment(funcNames: string[]): void {
        this.pendingElements.push({
            mode: 1, tableIndex: 0, offsetBytes: null, funcNames,
            exprs: null, refType: 'funcref', elemKind: 0x00,
        });
    }

    addDeclarativeElementSegment(funcNames: string[]): void {
        this.pendingElements.push({
            mode: 3, tableIndex: 0, offsetBytes: null, funcNames,
            exprs: null, refType: 'funcref', elemKind: 0x00,
        });
    }

    addElementSegmentExprs(
        mode: 4 | 5 | 6 | 7,
        tableIndex: number,
        offsetExprBytes: number[] | null,
        exprs: ElementExpr[],
        refType: RefType = 'funcref'
    ): void {
        const elemKind = refType === 'funcref' ? 0x00 : 0x01;

        if ((mode === 4 || mode === 6) && offsetExprBytes === null) {
            throw new Error(`Element mode ${mode} requiere offsetExprBytes`);
        }
        if ((mode === 5 || mode === 7) && offsetExprBytes !== null) {
            throw new Error(`Element mode ${mode} no acepta offsetExprBytes`);
        }
        if ((mode === 4 || mode === 5) && tableIndex !== 0) {
            throw new Error(`Element mode ${mode} implica table 0`);
        }

        if (mode === 4 || mode === 6) {
            const offset = this._decodeOffset(offsetExprBytes!);
            const requiredMin = offset + exprs.length;
            if (requiredMin > this.dynamicTableMin) this.dynamicTableMin = requiredMin;
            if (this.tables.length === 0 && !this.hasTableImport()) this.tableAuto = true;
        }

        this.pendingElements.push({
            mode, tableIndex, offsetBytes: offsetExprBytes,
            funcNames: null, exprs, refType, elemKind,
        });
    }

    addFunctionInstance(name: string, builder: FunctionIRBuilder): void {
        builder.finalize();
        const typeIdx = this._getTypeIdx(builder.paramTypes, builder.returnType);
        this.functions.push({
            name, builder,
            paramTypes: builder.paramTypes,
            returnType: builder.returnType,
            typeIdx,
        });
    }

    addFunctionImportAlias(module: string, field: string, localName: string, paramTypes: ValueType[], returnType: ValueType | ValueType[] | null): number {
        const idx = this.addFunctionImport(module, field, paramTypes, returnType);
        this.funcAliasToIndex.set(localName, idx);
        return idx;
    }

    addFunctionImport(module: string, name: string, paramTypes: ValueType[], returnType: ValueType | ValueType[] | null): number {
        const returnTypes: ValueType[] = returnType
            ? (Array.isArray(returnType) ? returnType : [returnType])
            : [];
        const typeIdx = this._getTypeIdx(paramTypes, returnTypes);
        const idx = this.externals.length;
        this.externals.push({ section: 'import', name, kind: 'function', module, typeIdx });
        return idx;
    }

    addMemoryImport(module: string, name: string, initial: number, maximum?: number): number {
        const idx = this.externals.length;
        this.externals.push({ section: 'import', name, kind: 'memory', module, initial, maximum });
        this.hasMemory = true;
        if (initial > this.memoryInitial) this.memoryInitial = initial;
        if (maximum !== undefined) this.memoryMax = maximum;
        return idx;
    }

    addTableImport(
        module: string,
        name: string,
        initial: number,
        maximum?: number,
        refType: RefType = 'funcref'
    ): number {
        // Simetría con addTable: no se permite mezclar tablas locales e importadas.
        if (this.tables.length > 0) {
            throw new Error('No se puede importar tabla si ya hay una tabla local definida');
        }
        const idx = this.externals.length;
        this.externals.push({ section: 'import', name, kind: 'table', module, initial, maximum, refType });
        return idx;
    }

    addGlobalImport(module: string, name: string, type: ValueType, mutable = false): number {
        const idx = this.externals.length;
        this.externals.push({ section: 'import', name, kind: 'global', module, valueType: type, mutable });
        return idx;
    }

    addMemory(initial: number, max?: number): void {
        this.hasMemory = true;
        if (initial > this.memoryInitial) this.memoryInitial = initial;
        this.memoryMax = max;
    }

    private _updateMemoryForData(offset: number, size: number): void {
        if (this.hasMemoryImport()) return;
        const need = Math.max(1, Math.ceil((offset + size) / 65536));
        if (need > this.memoryInitial) this.memoryInitial = need;
    }

    addDataSegment(offset: number, dataBytes: number[]): void {
        this.hasMemory = true;
        this.dataSegments.push({ offset, data: dataBytes });
        this._updateMemoryForData(offset, dataBytes.length);
    }

    addStaticData(dataBuilder: DataBuilder, baseOffset: number = 0): number {
        const bytes = Array.from(dataBuilder.build());
        if (bytes.length === 0) return baseOffset;
        this.addDataSegment(baseOffset, bytes);
        return baseOffset;
    }

    addData32(offset: number, value: number): void {
        this.addDataSegment(offset, [
            value & 0xFF, (value >> 8) & 0xFF, (value >> 16) & 0xFF, (value >> 24) & 0xFF,
        ]);
    }

    addData64(offset: number, value: bigint): void {
        const bytes: number[] = [];
        let val = value;
        for (let i = 0; i < 8; i++) { bytes.push(Number(val & 0xFFn)); val >>= 8n; }
        this.addDataSegment(offset, bytes);
    }

    addDataString(offset: number, text: string): void {
        this.addDataSegment(offset, Array.from(new TextEncoder().encode(text)));
    }

addGlobal(
    name: string,
    type: ValueType,
    mutable: boolean,
    initialValue: number | bigint | null | number[] | Uint8Array
): void {
    // Guard: arrays solo son válidos para v128
    if ((Array.isArray(initialValue) || initialValue instanceof Uint8Array) && type !== 'v128') {
        throw new Error(`addGlobal: initialValue tipo array/Uint8Array solo es válido para v128 (recibido para ${type})`);
    }

    let initBytes: number[];

    if (type === 'funcref' || type === 'externref') {
        if (initialValue !== null) {
            throw new Error(`addGlobal: para tipo ${type} solo se permite initialValue = null (ref.null)`);
        }
        initBytes = [OP.REF_NULL, refTypeToOp(type), OP.END];
    } else if (type === 'v128') {
        if (initialValue === null) {
            // v128.const con 16 bytes en cero
            const zeros = new Array(16).fill(0);
            initBytes = [OP.SIMD_PREFIX, ...encodeLEB128(SIMD_CONST_SUBOP), ...zeros, OP.END];
        } else if (typeof initialValue === 'number' || typeof initialValue === 'bigint') {
            // Escalar: solo se acepta 0 (equivale a 16 bytes en cero).
            // Para valores no-cero usar Uint8Array de 16 bytes.
            if (BigInt(initialValue) !== 0n) {
                throw new Error(
                    'addGlobal: v128 con initialValue escalar solo acepta 0; ' +
                    'usa un Uint8Array/number[] de 16 bytes para valores no-cero'
                );
            }
            const zeros = new Array(16).fill(0);
            initBytes = [OP.SIMD_PREFIX, ...encodeLEB128(SIMD_CONST_SUBOP), ...zeros, OP.END];
        } else {
            // Array/Uint8Array: exactamente 16 bytes
            const arr = initialValue instanceof Uint8Array ? Array.from(initialValue) : initialValue;
            if (arr.length !== 16) {
                throw new Error(`addGlobal: v128 initialValue requiere 16 bytes (recibido ${arr.length})`);
            }
            initBytes = [OP.SIMD_PREFIX, ...encodeLEB128(SIMD_CONST_SUBOP), ...arr, OP.END];
        }
    } else if (type === 'i32') {
        if (initialValue === null) throw new Error('addGlobal: i32 no acepta initialValue = null');
        initBytes = [OP.I32_CONST, ...encodeSignedLEB128(toI32(initialValue as number | bigint)), OP.END];
    } else if (type === 'i64') {
        if (initialValue === null) throw new Error('addGlobal: i64 no acepta initialValue = null');
        initBytes = [OP.I64_CONST, ...encodeSignedLEB128(toI64(initialValue as number | bigint)), OP.END];
    } else if (type === 'f64') {
        if (initialValue === null) throw new Error('addGlobal: f64 no acepta initialValue = null');
        initBytes = [OP.F64_CONST, ...floatToBytes(Number(initialValue), 64), OP.END];
    } else if (type === 'f32') {
        if (initialValue === null) throw new Error('addGlobal: f32 no acepta initialValue = null');
        initBytes = [OP.F32_CONST, ...floatToBytes(Number(initialValue), 32), OP.END];
    } else {
        throw new Error(`Tipo de global no soportado: ${type}`);
    }
    this.globals.push({ name, type, mutable, initExprBytes: initBytes });
}
// simdLane
    addFunction(
        name: string | null,
        paramTypes: ValueType[] | string,
        returnType: ValueType | ValueType[] | null,
        buildFn?: (builder: FunctionIRBuilder) => void,
        paramNames: string[] = []
    ): FunctionIRBuilder {
        const effectiveName = name ?? `__lambda_${this.lambdaCounter++}`;
        let finalParamTypes: ValueType[];
        let finalReturnTypes: ValueType[];
        let forcedTypeIdx: number | undefined;

        if (typeof paramTypes === 'string') {
            if (returnType !== null) throw new Error(`addFunction con tipo nombrado "${paramTypes}" debe recibir returnType = null`);
            const idx = this.typeNameToIdx.get(paramTypes);
            if (idx === undefined) throw new Error(`Tipo con nombre "${paramTypes}" no definido.`);
            const t = this.types[idx];
            finalParamTypes = t.params.map(op => opToType[op]);
            finalReturnTypes = t.results.map(op => opToType[op]);
            forcedTypeIdx = idx;
        } else {
            finalParamTypes = paramTypes;
            finalReturnTypes = returnType
                ? (Array.isArray(returnType) ? returnType : [returnType])
                : [];
        }

        const builder = new FunctionIRBuilder(finalParamTypes, finalReturnTypes, paramNames, this);
        if (buildFn) buildFn(builder);
        builder.finalize();

        const actualReturnTypes = builder.returnType;
        const typeIdx = forcedTypeIdx ?? this._getTypeIdx(finalParamTypes, actualReturnTypes);

        if (forcedTypeIdx !== undefined) {
            const expected = this.types[forcedTypeIdx].results.map(op => opToType[op]);
            if (JSON.stringify(expected) !== JSON.stringify(actualReturnTypes)) {
                throw new Error(
                    `El retorno inferido de "${effectiveName}" no coincide con el tipo nombrado. ` +
                    `Esperado: [${expected.join(', ')}], actual: [${actualReturnTypes.join(', ')}].`
                );
            }
        }

        this.functions.push({ name: effectiveName, builder, paramTypes: finalParamTypes, returnType: actualReturnTypes, typeIdx });
        return builder;
    }

    addExport(name: string, kind: ExternalKind, indexOrName: number | string): void {
        this.externals.push({ section: 'export', name, kind, index: indexOrName });
    }

    addTable(minSize: number, maxSize?: number, refType: RefType = 'funcref'): number {
        if (this.hasTableImport()) {
            throw new Error('No se puede definir tabla local si ya hay una importada');
        }
        const idx = this.tables.length;
        this.tables.push({ min: minSize, max: maxSize, refType });
        this.tableAuto = false;
        return idx;
    }

    private _decodeOffset(offsetBytes: number[]): number {
        if (offsetBytes.length < 2) throw new Error('Offset muy corto para i32.const');
        if (offsetBytes[0] !== OP.I32_CONST) throw new Error('Offset debe comenzar con i32.const');
        let pos = 1;
        let result = 0;
        let shift = 0;
        while (pos < offsetBytes.length) {
            const byte = offsetBytes[pos++];
            result |= (byte & 0x7F) << shift;
            if (!(byte & 0x80)) break;
            shift += 7;
        }
        if (offsetBytes[offsetBytes.length - 1] !== OP.END) throw new Error('Offset debe terminar con END');
        return result >>> 0;
    }

    build(): Uint8Array {
        this.prepareStringData();
        this.elements = [];

        const importEntries = this.externals.filter(e => e.section === 'import');
        const exportEntries = this.externals.filter(e => e.section === 'export');
        const importFuncCount = importEntries.filter(e => e.kind === 'function').length;
        const importGlobalCount = importEntries.filter(e => e.kind === 'global').length;

        const extToFuncIdx = new Map<number, number>();
        {
            let funcIdx = 0;
            for (let i = 0; i < this.externals.length; i++) {
                const e = this.externals[i];
                if (e.section === 'import' && e.kind === 'function') extToFuncIdx.set(i, funcIdx++);
            }
        }

        this.funcNameToIndex.clear();
        for (const [alias, extIdx] of this.funcAliasToIndex) {
            const wasmIdx = extToFuncIdx.get(extIdx);
            if (wasmIdx === undefined) throw new Error(`Alias '${alias}': no apunta a una función importada`);
            const existing = this.funcNameToIndex.get(alias);
            if (existing !== undefined && existing !== wasmIdx) {
                throw new Error(`Nombre de función duplicado: ${alias} (${existing} vs ${wasmIdx})`);
            }
            this.funcNameToIndex.set(alias, wasmIdx);
        }
        for (let i = 0; i < this.functions.length; i++) {
            const name = this.functions[i].name;
            if (this.funcNameToIndex.has(name)) throw new Error(`Nombre de función duplicado con import: ${name}`);
            this.funcNameToIndex.set(name, importFuncCount + i);
        }

        this.globalNameToIndex.clear();
        let globalImportIdx = 0;
        for (const imp of importEntries) {
            if (imp.kind === 'global') {
                if (this.globalNameToIndex.has(imp.name)) throw new Error(`Global duplicada: ${imp.name}`);
                this.globalNameToIndex.set(imp.name, globalImportIdx++);
            }
        }
        for (let i = 0; i < this.globals.length; i++) {
            const name = this.globals[i].name;
            if (this.globalNameToIndex.has(name)) throw new Error(`Global duplicada: ${name}`);
            this.globalNameToIndex.set(name, importGlobalCount + i);
        }

        const resolvedExports = exportEntries.map(exp => {
            let index: number | undefined;
            if (exp.kind === 'memory') index = 0;
            else if (exp.kind === 'table') {
                if (typeof exp.index === 'string') throw new Error(`Export '${exp.name}': tablas no tienen nombre; usa índice numérico`);
                index = exp.index;
            } else if (typeof exp.index === 'string') {
                if (exp.kind === 'function') index = this.funcNameToIndex.get(exp.index);
                else if (exp.kind === 'global') index = this.globalNameToIndex.get(exp.index);
                if (index === undefined) throw new Error(`Export '${exp.name}': nombre no encontrado`);
            } else {
                index = exp.index;
            }
            return { name: exp.name, kind: exp.kind, index: index! };
        });

        for (const fn of this.functions) {
            fn.builder.instructions = fn.builder.instructions.map(instr => {
                if (instr.op === 'CALL_BY_NAME') {
                    const absIdx = this.funcNameToIndex.get(instr.name);
                    if (absIdx === undefined) throw new Error(`Función no definida: ${instr.name}`);
                    return { op: 'CALL' as const, index: absIdx };
                }
                if (instr.op === 'REF_FUNC_BY_NAME') {
                    const absIdx = this.funcNameToIndex.get(instr.name);
                    if (absIdx === undefined) throw new Error(`Función no definida: ${instr.name}`);
                    return { op: 'REF_FUNC' as const, index: absIdx };
                }
                if (instr.op === 'FUNCTION_INDEX_BY_NAME') {
                    const tableIdx = this.functionTableIndices.get(instr.name);
                    if (tableIdx === undefined) throw new Error(`Función sin índice de tabla: ${instr.name}`);
                    return { op: 'I32_CONST' as const, val: tableIdx };
                }
                return instr;
            }) as IRInstruction[];
        }
        for (const fn of this.functions) {
            fn.builder.instructions = fn.builder.instructions.map(instr => {
                if ((instr.op === 'GLOBAL_GET' || instr.op === 'GLOBAL_SET') && typeof instr.index === 'string') {
                    const absIdx = this.globalNameToIndex.get(instr.index);
                    if (absIdx === undefined) throw new Error(`Global no definida: ${instr.index}`);
                    return { op: instr.op, index: absIdx } as IRInstruction;
                }
                return instr;
            });
        }
        // ── Optimización del IR ─────────────────────────────────────────
        // Se hace después de resolver todos los nombres simbólicos
        // (CALL_BY_NAME, GLOBAL_GET/SET con nombre) y antes de emitir bytecode.
        if (ENABLE_OPTIMIZER) {
            for (const fn of this.functions) {
                fn.builder.instructions = optimizeIR(fn.builder.instructions);
                fn.builder.pruneUnusedLocals();
                fn.builder.instructions = optimizeIR(fn.builder.instructions);
            }
        }

        const hasMemoryImport = this.hasMemoryImport();
        if (!this.hasMemory && !hasMemoryImport) {
            for (const fn of this.functions) {
                if (fn.builder.needsMemory) { this.addMemory(1); break; }
            }
        }

        const hasTableImport = this.hasTableImport();

        if (this.pendingElements.length > 0) {
            const needsActiveTable = this.pendingElements.some(p =>
                p.mode === 0 || p.mode === 2 || p.mode === 4 || p.mode === 6
            );

            if (this.tableAuto && this.tables.length === 0 && !hasTableImport) {
                this.tables.push({ min: this.dynamicTableMin, max: undefined, refType: 'funcref' });
            } else if (needsActiveTable && this.tables.length === 0 && !hasTableImport) {
                throw new Error('Se agregaron elementos de tabla activos sin definir una tabla');
            }

            for (const seg of this.pendingElements) {
                const resolvedFuncIdx = seg.funcNames
                    ? seg.funcNames.map(name => {
                        const idx = this.funcNameToIndex.get(name);
                        if (idx === undefined) throw new Error(`Función no encontrada: ${name}`);
                        return idx;
                      })
                    : null;

                const resolvedExprBytes = seg.exprs
                    ? seg.exprs.map(e => this._encodeElementExpr(e))
                    : null;

                this.elements.push({
                    mode: seg.mode,
                    tableIndex: seg.tableIndex,
                    offsetBytes: seg.offsetBytes,
                    funcIndices: resolvedFuncIdx,
                    exprsBytes: resolvedExprBytes,
                    refType: seg.refType,
                    elemKind: seg.elemKind,
                });
            }
        }

        const codeEntries: { size: number; body: number[] }[] = [];
        for (const fn of this.functions) {
            const bytecode = emitirBytecode(fn.builder.instructions);
            bytecode.push(OP.END);
            const locals = fn.builder.getLocals();
            const body: number[] = [];
            body.push(...encodeLEB128(locals.length));
            for (const loc of locals) {
                body.push(...encodeLEB128(loc.count));
                body.push(loc.type);
            }
            body.push(...bytecode);
            codeEntries.push({ size: body.length, body });
        }

        const sections: { id: number; bytes: number[] }[] = [];

        if (this.types.length) {
            const buf: number[] = [...encodeLEB128(this.types.length)];
            for (const t of this.types) {
                buf.push(0x60);
                buf.push(...encodeLEB128(t.params.length), ...t.params);
                buf.push(...encodeLEB128(t.results.length), ...t.results);
            }
            sections.push({ id: 1, bytes: buf });
        }

        if (importEntries.length) {
            const buf: number[] = [...encodeLEB128(importEntries.length)];
            for (const imp of importEntries) {
                buf.push(...encodeName(imp.module!), ...encodeName(imp.name));
                if (imp.kind === 'function') {
                    buf.push(0x00, ...encodeLEB128(imp.typeIdx!));
                } else if (imp.kind === 'table') {
                    const refOp = refTypeToOp(imp.refType ?? 'funcref');
                    buf.push(0x01, refOp);
                    const flags = (imp.maximum !== undefined) ? 0x01 : 0x00;
                    buf.push(flags, ...encodeLEB128(imp.initial!));
                    if (imp.maximum !== undefined) buf.push(...encodeLEB128(imp.maximum));
                } else if (imp.kind === 'memory') {
                    buf.push(0x02);
                    const flags = (imp.maximum !== undefined) ? 0x01 : 0x00;
                    buf.push(flags, ...encodeLEB128(imp.initial!));
                    if (imp.maximum !== undefined) buf.push(...encodeLEB128(imp.maximum));
                } else if (imp.kind === 'global') {
                    buf.push(0x03, typeToOp(imp.valueType!), imp.mutable ? 0x01 : 0x00);
                }
            }
            sections.push({ id: 2, bytes: buf });
        }

        if (this.functions.length) {
            const buf: number[] = [...encodeLEB128(this.functions.length)];
            for (const fn of this.functions) buf.push(...encodeLEB128(fn.typeIdx));
            sections.push({ id: 3, bytes: buf });
        }

        if (this.tables.length > 0) {
            const buf: number[] = [...encodeLEB128(this.tables.length)];
            for (const t of this.tables) {
                buf.push(refTypeToOp(t.refType));
                const flags = (t.max !== undefined) ? 0x01 : 0x00;
                buf.push(flags, ...encodeLEB128(t.min));
                if (t.max !== undefined) buf.push(...encodeLEB128(t.max));
            }
            sections.push({ id: 4, bytes: buf });
        }

        if (this.hasMemory && !hasMemoryImport) {
            const flags = (this.memoryMax !== undefined) ? 0x01 : 0x00;
            const memBytes: number[] = [1, flags, ...encodeLEB128(this.memoryInitial)];
            if (this.memoryMax !== undefined) memBytes.push(...encodeLEB128(this.memoryMax));
            sections.push({ id: 5, bytes: memBytes });
        }

        if (this.globals.length) {
            const buf: number[] = [...encodeLEB128(this.globals.length)];
            for (const g of this.globals) {
                buf.push(typeToOp(g.type), g.mutable ? 0x01 : 0x00, ...g.initExprBytes);
            }
            sections.push({ id: 6, bytes: buf });
        }

        if (resolvedExports.length) {
            const buf: number[] = [...encodeLEB128(resolvedExports.length)];
            for (const exp of resolvedExports) {
                buf.push(...encodeName(exp.name));
                if (exp.kind === 'function') buf.push(0x00);
                else if (exp.kind === 'table') buf.push(0x01);
                else if (exp.kind === 'memory') buf.push(0x02);
                else if (exp.kind === 'global') buf.push(0x03);
                buf.push(...encodeLEB128(exp.index));
            }
            sections.push({ id: 7, bytes: buf });
        }

        if (this.startFunction !== null) {
            let startIdx: number;
            if (typeof this.startFunction === 'string') {
                const idx = this.funcNameToIndex.get(this.startFunction);
                if (idx === undefined) throw new Error(`Start: función no encontrada: ${this.startFunction}`);
                startIdx = idx;
            } else {
                startIdx = this.startFunction;
            }
            sections.push({ id: 8, bytes: [...encodeLEB128(startIdx)] });
        }

        if (this.elements.length > 0) {
            const buf: number[] = [...encodeLEB128(this.elements.length)];
            for (const seg of this.elements) {
                buf.push(...encodeLEB128(seg.mode));
                switch (seg.mode) {
                    case 0:
                        buf.push(...seg.offsetBytes!);
                        buf.push(...encodeLEB128(seg.funcIndices!.length));
                        for (const fi of seg.funcIndices!) buf.push(...encodeLEB128(fi));
                        break;
                    case 1:
                        buf.push(seg.elemKind);
                        buf.push(...encodeLEB128(seg.funcIndices!.length));
                        for (const fi of seg.funcIndices!) buf.push(...encodeLEB128(fi));
                        break;
                    case 2:
                        buf.push(...encodeLEB128(seg.tableIndex));
                        buf.push(...seg.offsetBytes!);
                        buf.push(seg.elemKind);
                        buf.push(...encodeLEB128(seg.funcIndices!.length));
                        for (const fi of seg.funcIndices!) buf.push(...encodeLEB128(fi));
                        break;
                    case 3:
                        buf.push(seg.elemKind);
                        buf.push(...encodeLEB128(seg.funcIndices!.length));
                        for (const fi of seg.funcIndices!) buf.push(...encodeLEB128(fi));
                        break;
                    case 4:
                        buf.push(...seg.offsetBytes!);
                        buf.push(...encodeLEB128(seg.exprsBytes!.length));
                        for (const expr of seg.exprsBytes!) buf.push(...expr);
                        break;
                    case 5:
                        buf.push(refTypeToOp(seg.refType));
                        buf.push(...encodeLEB128(seg.exprsBytes!.length));
                        for (const expr of seg.exprsBytes!) buf.push(...expr);
                        break;
                    case 6:
                        buf.push(...encodeLEB128(seg.tableIndex));
                        buf.push(...seg.offsetBytes!);
                        buf.push(refTypeToOp(seg.refType));
                        buf.push(...encodeLEB128(seg.exprsBytes!.length));
                        for (const expr of seg.exprsBytes!) buf.push(...expr);
                        break;
                    case 7:
                        buf.push(refTypeToOp(seg.refType));
                        buf.push(...encodeLEB128(seg.exprsBytes!.length));
                        for (const expr of seg.exprsBytes!) buf.push(...expr);
                        break;
                    default:
                        throw new Error(`Element mode ${seg.mode} no soportado`);
                }
            }
            sections.push({ id: 9, bytes: buf });
        }

        if (this.functions.length) {
            const buf: number[] = [...encodeLEB128(this.functions.length)];
            for (const entry of codeEntries) {
                buf.push(...encodeLEB128(entry.size), ...entry.body);
            }
            sections.push({ id: 10, bytes: buf });
        }

        if (this.dataSegments.length > 0) {
            const buf: number[] = [...encodeLEB128(this.dataSegments.length)];
            for (const seg of this.dataSegments) {
                buf.push(0x00);
                buf.push(OP.I32_CONST, ...encodeSignedLEB128(seg.offset), OP.END);
                buf.push(...encodeLEB128(seg.data.length), ...seg.data);
            }
            sections.push({ id: 11, bytes: buf });
        }

        const header = [0x00, 0x61, 0x73, 0x6D, 0x01, 0x00, 0x00, 0x00];
        const binary: number[] = [...header];

        const customSectionsBefore = this.customSections.filter(cs => !cs.atEnd);
        const customSectionsAfter = this.customSections.filter(cs => cs.atEnd);

        for (const cs of customSectionsBefore) {
            const content = [...encodeName(cs.name), ...cs.data];
            binary.push(0, ...encodeLEB128(content.length), ...content);
        }

        sections.sort((a, b) => a.id - b.id);
        for (const { id, bytes } of sections) {
            binary.push(id, ...encodeLEB128(bytes.length), ...bytes);
        }

        for (const cs of customSectionsAfter) {
            const content = [...encodeName(cs.name), ...cs.data];
            binary.push(0, ...encodeLEB128(content.length), ...content);
        }

        return new Uint8Array(binary);
    }

    private _encodeElementExpr(e: ElementExpr): number[] {
        switch (e.kind) {
            case 'ref.func': {
                const idx = this.funcNameToIndex.get(e.funcName);
                if (idx === undefined) throw new Error(`Element expr: función no encontrada: ${e.funcName}`);
                return [OP.REF_FUNC, ...encodeLEB128(idx), OP.END];
            }
            case 'ref.null':
                return [OP.REF_NULL, refTypeToOp(e.type), OP.END];
            case 'raw':
                return [...e.bytes];
            default: {
                const _exhaustive: never = e;
                throw new Error(`ElementExpr desconocido: ${JSON.stringify(_exhaustive)}`);
            }
        }
    }

    toWat(): string { return decodeModuleToWat(this.build()); }
    toBinaryTree(): string { return formatBinaryTree(parseBinaryTree(this.build())); }
}

// ─────────────────────────────────────────────────────────────────────────────
// emitirBytecode
// ─────────────────────────────────────────────────────────────────────────────
function naturalAlign(op: string): number {
    switch (op) {
        case 'I32_LOAD': case 'I32_STORE':
        case 'F32_LOAD': case 'F32_STORE':
        case 'I64_LOAD32_S': case 'I64_LOAD32_U': case 'I64_STORE32':
            return 2;
        case 'I64_LOAD': case 'I64_STORE':
        case 'F64_LOAD': case 'F64_STORE':
            return 3;
        case 'I32_LOAD16_S': case 'I32_LOAD16_U': case 'I32_STORE16':
        case 'I64_LOAD16_S': case 'I64_LOAD16_U': case 'I64_STORE16':
            return 1;
        default:
            return 0;
    }
}

function emitirBytecode(ir: IRInstruction[]): number[] {
    const bytes: number[] = [];
    for (const instr of ir) {
        switch (instr.op) {
            case 'UNREACHABLE': bytes.push(OP.UNREACHABLE); break;
            case 'NOP': bytes.push(OP.NOP); break;
            case 'BLOCK': case 'LOOP': case 'IF': {
                const op = instr.op === 'BLOCK' ? OP.BLOCK : instr.op === 'LOOP' ? OP.LOOP : OP.IF;
                bytes.push(op);
                const bt = instr.blocktype;
                if (bt === 0x40 || bt === 0x7F || bt === 0x7E || bt === 0x7D || bt === 0x7C || bt === 0x7B || bt === 0x70 || bt === 0x6F) {
                    bytes.push(bt);
                } else {
                    bytes.push(...encodeSignedLEB128(bt));
                }
                break;
            }
            case 'ELSE': bytes.push(OP.ELSE); break;
            case 'END': bytes.push(OP.END); break;
            case 'BR': bytes.push(OP.BR, ...encodeLEB128(instr.depth)); break;
            case 'BR_IF': bytes.push(OP.BR_IF, ...encodeLEB128(instr.depth)); break;
            case 'BR_TABLE':
                bytes.push(OP.BR_TABLE);
                bytes.push(...encodeLEB128(instr.labels.length));
                for (const label of instr.labels) bytes.push(...encodeLEB128(label));
                bytes.push(...encodeLEB128(instr.default));
                break;
            case 'RETURN': bytes.push(OP.RETURN); break;
            case 'CALL': bytes.push(OP.CALL, ...encodeLEB128(instr.index)); break;
            case 'CALL_INDIRECT': bytes.push(OP.CALL_INDIRECT, ...encodeLEB128(instr.typeIdx), 0x00); break;
            case 'CALL_REF': bytes.push(OP.CALL_REF, ...encodeLEB128(instr.typeIdx)); break;
            case 'RETURN_CALL_REF': bytes.push(OP.RETURN_CALL_REF, ...encodeLEB128(instr.typeIdx)); break;
            case 'DROP': bytes.push(OP.DROP); break;
            case 'SELECT': bytes.push(OP.SELECT); break;
            case 'SELECT_T': {
                bytes.push(OP.SELECT_T, ...encodeLEB128(instr.types.length));
                for (const t of instr.types) bytes.push(typeToOp(t));
                break;
            }
            case 'LOCAL_GET': bytes.push(OP.LOCAL_GET, ...encodeLEB128(instr.index)); break;
            case 'LOCAL_SET': bytes.push(OP.LOCAL_SET, ...encodeLEB128(instr.index)); break;
            case 'LOCAL_TEE': bytes.push(OP.LOCAL_TEE, ...encodeLEB128(instr.index)); break;
            case 'GLOBAL_GET': bytes.push(OP.GLOBAL_GET, ...encodeLEB128(instr.index as number)); break;
            case 'GLOBAL_SET': bytes.push(OP.GLOBAL_SET, ...encodeLEB128(instr.index as number)); break;
            case 'TABLE_GET': bytes.push(OP.TABLE_GET, ...encodeLEB128(instr.tableIdx ?? 0)); break;
            case 'TABLE_SET': bytes.push(OP.TABLE_SET, ...encodeLEB128(instr.tableIdx ?? 0)); break;
            case 'TABLE_GROW': bytes.push(OP.MISC_PREFIX, OP.TABLE_GROW, ...encodeLEB128(instr.tableIdx ?? 0)); break;
            case 'TABLE_SIZE': bytes.push(OP.MISC_PREFIX, OP.TABLE_SIZE, ...encodeLEB128(instr.tableIdx ?? 0)); break;
            case 'TABLE_FILL': bytes.push(OP.MISC_PREFIX, OP.TABLE_FILL, ...encodeLEB128(instr.tableIdx ?? 0)); break;
            case 'TABLE_COPY': bytes.push(OP.MISC_PREFIX, OP.TABLE_COPY, ...encodeLEB128(instr.dstIdx), ...encodeLEB128(instr.srcIdx)); break;
            case 'TABLE_INIT': bytes.push(OP.MISC_PREFIX, OP.TABLE_INIT, ...encodeLEB128(instr.tableIdx), ...encodeLEB128(instr.elemIdx)); break;
            case 'ELEM_DROP': bytes.push(OP.MISC_PREFIX, OP.ELEM_DROP, ...encodeLEB128(instr.elemIdx)); break;
            case 'MEMORY_INIT': bytes.push(OP.MISC_PREFIX, OP.MEMORY_INIT, ...encodeLEB128(instr.dataIdx), 0x00); break;
            case 'DATA_DROP': bytes.push(OP.MISC_PREFIX, OP.DATA_DROP, ...encodeLEB128(instr.dataIdx)); break;
            case 'MEMORY_FILL': bytes.push(OP.MISC_PREFIX, OP.MEMORY_FILL, 0x00); break;
            case 'MEMORY_COPY': bytes.push(OP.MISC_PREFIX, OP.MEMORY_COPY, 0x00, 0x00); break;

            // ─── SIMD ────────────────────────────────────────────────────
            case 'SIMD_NOIMM': {
                const sub = SIMD_NOIMM[instr.name];
                if (sub === undefined) throw new Error(`SIMD_NOIMM desconocido: ${instr.name}`);
                bytes.push(OP.SIMD_PREFIX, ...encodeLEB128(sub));
                break;
            }
            case 'SIMD_MEMARG': {
                const sub = SIMD_MEMARG[instr.name];
                if (sub === undefined) throw new Error(`SIMD_MEMARG desconocido: ${instr.name}`);
                const align = ((instr.align !== undefined && instr.align !== 0) ? instr.align : simdNaturalAlign(instr.name));
                bytes.push(OP.SIMD_PREFIX, ...encodeLEB128(sub),
                           ...encodeLEB128(align),
                           ...encodeLEB128(instr.offset ?? 0));
                break;
            }
            case 'SIMD_MEMARG_LANE': {
                const sub = SIMD_MEMARG_LANE[instr.name];
                if (sub === undefined) throw new Error(`SIMD_MEMARG_LANE desconocido: ${instr.name}`);
                const align = ((instr.align !== undefined && instr.align !== 0) ? instr.align : simdNaturalAlignLane(instr.name));
                bytes.push(OP.SIMD_PREFIX, ...encodeLEB128(sub),
                           ...encodeLEB128(align),
                           ...encodeLEB128(instr.offset ?? 0),
                           instr.lane);
                break;
            }
            case 'SIMD_LANE': {
                const sub = SIMD_LANE[instr.name];
                if (sub === undefined) throw new Error(`SIMD_LANE desconocido: ${instr.name}`);
                bytes.push(OP.SIMD_PREFIX, ...encodeLEB128(sub), instr.lane);
                break;
            }
            case 'SIMD_CONST':
                bytes.push(OP.SIMD_PREFIX, ...encodeLEB128(SIMD_CONST_SUBOP), ...instr.bytes);
                break;
            case 'SIMD_SHUFFLE':
                bytes.push(OP.SIMD_PREFIX, ...encodeLEB128(SIMD_SHUFFLE_SUBOP), ...instr.lanes);
                break;

            case 'I32_LOAD': case 'I64_LOAD': case 'F32_LOAD': case 'F64_LOAD':
            case 'I32_LOAD8_S': case 'I32_LOAD8_U': case 'I32_LOAD16_S': case 'I32_LOAD16_U':
            case 'I64_LOAD8_S': case 'I64_LOAD8_U': case 'I64_LOAD16_S': case 'I64_LOAD16_U':
            case 'I64_LOAD32_S': case 'I64_LOAD32_U':
            case 'I32_STORE': case 'I64_STORE': case 'F32_STORE': case 'F64_STORE':
            case 'I32_STORE8': case 'I32_STORE16':
            case 'I64_STORE8': case 'I64_STORE16': case 'I64_STORE32': {
                const opName = instr.op as string;
                const opcode = (OP as any)[opName] as number;
                const align = ((instr as any).align !== undefined && (instr as any).align !== 0)
                    ? (instr as any).align
                    : naturalAlign(opName);
                bytes.push(opcode, ...encodeLEB128(align), ...encodeLEB128((instr as any).offset ?? 0));
                break;
            }

            case 'MEMORY_SIZE': bytes.push(OP.MEMORY_SIZE, 0x00); break;
            case 'MEMORY_GROW': bytes.push(OP.MEMORY_GROW, 0x00); break;
            case 'FUNCTION_INDEX_BY_NAME':
                throw new Error('FUNCTION_INDEX_BY_NAME debe ser resuelto antes de emitir bytecode');
            case 'ENV_ADDR_BY_NAME':
                throw new Error('ENV_ADDR_BY_NAME debe ser resuelto antes de emitir bytecode');
            case 'I32_CONST': bytes.push(OP.I32_CONST, ...encodeSignedLEB128(toI32(instr.val))); break;
            case 'I64_CONST': bytes.push(OP.I64_CONST, ...encodeSignedLEB128(toI64(instr.val))); break;
            case 'F32_CONST': bytes.push(OP.F32_CONST, ...floatToBytes(instr.val, 32)); break;
            case 'F64_CONST': bytes.push(OP.F64_CONST, ...floatToBytes(instr.val, 64)); break;
            case 'I32_DATA_CONST': bytes.push(OP.I32_CONST, ...encodeSignedLEB128(toI32(instr.val))); break;

            case 'I32_CLZ': bytes.push(OP.I32_CLZ); break;
            case 'I32_CTZ': bytes.push(OP.I32_CTZ); break;
            case 'I32_POPCNT': bytes.push(OP.I32_POPCNT); break;
            case 'I64_CLZ': bytes.push(OP.I64_CLZ); break;
            case 'I64_CTZ': bytes.push(OP.I64_CTZ); break;
            case 'I64_POPCNT': bytes.push(OP.I64_POPCNT); break;
            case 'I32_ROTL': bytes.push(OP.I32_ROTL); break;
            case 'I32_ROTR': bytes.push(OP.I32_ROTR); break;
            case 'I64_ROTL': bytes.push(OP.I64_ROTL); break;
            case 'I64_ROTR': bytes.push(OP.I64_ROTR); break;
            case 'I32_EQZ': bytes.push(OP.I32_EQZ); break;
            case 'I64_EQZ': bytes.push(OP.I64_EQZ); break;
            case 'I32_EQ': bytes.push(OP.I32_EQ); break;
            case 'I32_NE': bytes.push(OP.I32_NE); break;
            case 'I32_LT_S': bytes.push(OP.I32_LT_S); break;
            case 'I32_LT_U': bytes.push(OP.I32_LT_U); break;
            case 'I32_GT_S': bytes.push(OP.I32_GT_S); break;
            case 'I32_GT_U': bytes.push(OP.I32_GT_U); break;
            case 'I32_LE_S': bytes.push(OP.I32_LE_S); break;
            case 'I32_LE_U': bytes.push(OP.I32_LE_U); break;
            case 'I32_GE_S': bytes.push(OP.I32_GE_S); break;
            case 'I32_GE_U': bytes.push(OP.I32_GE_U); break;
            case 'I32_ADD': bytes.push(OP.I32_ADD); break;
            case 'I32_SUB': bytes.push(OP.I32_SUB); break;
            case 'I32_MUL': bytes.push(OP.I32_MUL); break;
            case 'I32_DIV_S': bytes.push(OP.I32_DIV_S); break;
            case 'I32_DIV_U': bytes.push(OP.I32_DIV_U); break;
            case 'I32_REM_S': bytes.push(OP.I32_REM_S); break;
            case 'I32_REM_U': bytes.push(OP.I32_REM_U); break;
            case 'I32_AND': bytes.push(OP.I32_AND); break;
            case 'I32_OR': bytes.push(OP.I32_OR); break;
            case 'I32_XOR': bytes.push(OP.I32_XOR); break;
            case 'I32_SHL': bytes.push(OP.I32_SHL); break;
            case 'I32_SHR_S': bytes.push(OP.I32_SHR_S); break;
            case 'I32_SHR_U': bytes.push(OP.I32_SHR_U); break;
            case 'I64_EQ': bytes.push(OP.I64_EQ); break;
            case 'I64_NE': bytes.push(OP.I64_NE); break;
            case 'I64_LT_S': bytes.push(OP.I64_LT_S); break;
            case 'I64_LT_U': bytes.push(OP.I64_LT_U); break;
            case 'I64_GT_S': bytes.push(OP.I64_GT_S); break;
            case 'I64_GT_U': bytes.push(OP.I64_GT_U); break;
            case 'I64_LE_S': bytes.push(OP.I64_LE_S); break;
            case 'I64_LE_U': bytes.push(OP.I64_LE_U); break;
            case 'I64_GE_S': bytes.push(OP.I64_GE_S); break;
            case 'I64_GE_U': bytes.push(OP.I64_GE_U); break;
            case 'I64_ADD': bytes.push(OP.I64_ADD); break;
            case 'I64_SUB': bytes.push(OP.I64_SUB); break;
            case 'I64_MUL': bytes.push(OP.I64_MUL); break;
            case 'I64_DIV_S': bytes.push(OP.I64_DIV_S); break;
            case 'I64_DIV_U': bytes.push(OP.I64_DIV_U); break;
            case 'I64_REM_S': bytes.push(OP.I64_REM_S); break;
            case 'I64_REM_U': bytes.push(OP.I64_REM_U); break;
            case 'I64_AND': bytes.push(OP.I64_AND); break;
            case 'I64_OR': bytes.push(OP.I64_OR); break;
            case 'I64_XOR': bytes.push(OP.I64_XOR); break;
            case 'I64_SHL': bytes.push(OP.I64_SHL); break;
            case 'I64_SHR_S': bytes.push(OP.I64_SHR_S); break;
            case 'I64_SHR_U': bytes.push(OP.I64_SHR_U); break;

            case 'F32_ABS': bytes.push(OP.F32_ABS); break;
            case 'F32_NEG': bytes.push(OP.F32_NEG); break;
            case 'F32_CEIL': bytes.push(OP.F32_CEIL); break;
            case 'F32_FLOOR': bytes.push(OP.F32_FLOOR); break;
            case 'F32_TRUNC': bytes.push(OP.F32_TRUNC); break;
            case 'F32_NEAREST': bytes.push(OP.F32_NEAREST); break;
            case 'F32_SQRT': bytes.push(OP.F32_SQRT); break;
            case 'F32_ADD': bytes.push(OP.F32_ADD); break;
            case 'F32_SUB': bytes.push(OP.F32_SUB); break;
            case 'F32_MUL': bytes.push(OP.F32_MUL); break;
            case 'F32_DIV': bytes.push(OP.F32_DIV); break;
            case 'F32_MIN': bytes.push(OP.F32_MIN); break;
            case 'F32_MAX': bytes.push(OP.F32_MAX); break;
            case 'F32_COPYSIGN': bytes.push(OP.F32_COPYSIGN); break;
            case 'F32_EQ': bytes.push(OP.F32_EQ); break;
            case 'F32_NE': bytes.push(OP.F32_NE); break;
            case 'F32_LT': bytes.push(OP.F32_LT); break;
            case 'F32_GT': bytes.push(OP.F32_GT); break;
            case 'F32_LE': bytes.push(OP.F32_LE); break;
            case 'F32_GE': bytes.push(OP.F32_GE); break;

            case 'F64_ABS': bytes.push(OP.F64_ABS); break;
            case 'F64_NEG': bytes.push(OP.F64_NEG); break;
            case 'F64_CEIL': bytes.push(OP.F64_CEIL); break;
            case 'F64_FLOOR': bytes.push(OP.F64_FLOOR); break;
            case 'F64_TRUNC': bytes.push(OP.F64_TRUNC); break;
            case 'F64_NEAREST': bytes.push(OP.F64_NEAREST); break;
            case 'F64_SQRT': bytes.push(OP.F64_SQRT); break;
            case 'F64_ADD': bytes.push(OP.F64_ADD); break;
            case 'F64_SUB': bytes.push(OP.F64_SUB); break;
            case 'F64_MUL': bytes.push(OP.F64_MUL); break;
            case 'F64_DIV': bytes.push(OP.F64_DIV); break;
            case 'F64_MIN': bytes.push(OP.F64_MIN); break;
            case 'F64_MAX': bytes.push(OP.F64_MAX); break;
            case 'F64_COPYSIGN': bytes.push(OP.F64_COPYSIGN); break;
            case 'F64_EQ': bytes.push(OP.F64_EQ); break;
            case 'F64_NE': bytes.push(OP.F64_NE); break;
            case 'F64_LT': bytes.push(OP.F64_LT); break;
            case 'F64_GT': bytes.push(OP.F64_GT); break;
            case 'F64_LE': bytes.push(OP.F64_LE); break;
            case 'F64_GE': bytes.push(OP.F64_GE); break;

            case 'I32_WRAP_I64': bytes.push(OP.I32_WRAP_I64); break;
            case 'I32_TRUNC_F32_S': bytes.push(OP.I32_TRUNC_F32_S); break;
            case 'I32_TRUNC_F32_U': bytes.push(OP.I32_TRUNC_F32_U); break;
            case 'I32_TRUNC_F64_S': bytes.push(OP.I32_TRUNC_F64_S); break;
            case 'I32_TRUNC_F64_U': bytes.push(OP.I32_TRUNC_F64_U); break;
            case 'I64_TRUNC_F32_S': bytes.push(OP.I64_TRUNC_F32_S); break;
            case 'I64_TRUNC_F32_U': bytes.push(OP.I64_TRUNC_F32_U); break;
            case 'I64_TRUNC_F64_S': bytes.push(OP.I64_TRUNC_F64_S); break;
            case 'I64_TRUNC_F64_U': bytes.push(OP.I64_TRUNC_F64_U); break;
            case 'F32_CONVERT_I32_S': bytes.push(OP.F32_CONVERT_I32_S); break;
            case 'F32_CONVERT_I32_U': bytes.push(OP.F32_CONVERT_I32_U); break;
            case 'F32_CONVERT_I64_S': bytes.push(OP.F32_CONVERT_I64_S); break;
            case 'F32_CONVERT_I64_U': bytes.push(OP.F32_CONVERT_I64_U); break;
            case 'F64_CONVERT_I32_S': bytes.push(OP.F64_CONVERT_I32_S); break;
            case 'F64_CONVERT_I32_U': bytes.push(OP.F64_CONVERT_I32_U); break;
            case 'F64_CONVERT_I64_S': bytes.push(OP.F64_CONVERT_I64_S); break;
            case 'F64_CONVERT_I64_U': bytes.push(OP.F64_CONVERT_I64_U); break;
            case 'F32_DEMOTE_F64': bytes.push(OP.F32_DEMOTE_F64); break;
            case 'F64_PROMOTE_F32': bytes.push(OP.F64_PROMOTE_F32); break;
            case 'I32_REINTERPRET_F32': bytes.push(OP.I32_REINTERPRET_F32); break;
            case 'I64_REINTERPRET_F64': bytes.push(OP.I64_REINTERPRET_F64); break;
            case 'F32_REINTERPRET_I32': bytes.push(OP.F32_REINTERPRET_I32); break;
            case 'F64_REINTERPRET_I64': bytes.push(OP.F64_REINTERPRET_I64); break;
            case 'I64_EXTEND_I32_S': bytes.push(OP.I64_EXTEND_I32_S); break;
            case 'I64_EXTEND_I32_U': bytes.push(OP.I64_EXTEND_I32_U); break;

            case 'I32_TRUNC_SAT_F32_S': bytes.push(OP.MISC_PREFIX, OP.SAT_I32_TRUNC_SAT_F32_S); break;
            case 'I32_TRUNC_SAT_F32_U': bytes.push(OP.MISC_PREFIX, OP.SAT_I32_TRUNC_SAT_F32_U); break;
            case 'I32_TRUNC_SAT_F64_S': bytes.push(OP.MISC_PREFIX, OP.SAT_I32_TRUNC_SAT_F64_S); break;
            case 'I32_TRUNC_SAT_F64_U': bytes.push(OP.MISC_PREFIX, OP.SAT_I32_TRUNC_SAT_F64_U); break;
            case 'I64_TRUNC_SAT_F32_S': bytes.push(OP.MISC_PREFIX, OP.SAT_I64_TRUNC_SAT_F32_S); break;
            case 'I64_TRUNC_SAT_F32_U': bytes.push(OP.MISC_PREFIX, OP.SAT_I64_TRUNC_SAT_F32_U); break;
            case 'I64_TRUNC_SAT_F64_S': bytes.push(OP.MISC_PREFIX, OP.SAT_I64_TRUNC_SAT_F64_S); break;
            case 'I64_TRUNC_SAT_F64_U': bytes.push(OP.MISC_PREFIX, OP.SAT_I64_TRUNC_SAT_F64_U); break;

            case 'REF_NULL': bytes.push(OP.REF_NULL, refTypeToOp(instr.type)); break;
            case 'REF_IS_NULL': bytes.push(OP.REF_IS_NULL); break;
            case 'REF_FUNC': bytes.push(OP.REF_FUNC, ...encodeLEB128(instr.index)); break;

            case 'CALL_BY_NAME':
            case 'REF_FUNC_BY_NAME':
                throw new Error(`${instr.op} debe ser resuelto antes de emitir bytecode`);
            default:
                throw new Error(`Opcode IR desconocido: ${(instr as any).op}`);
        }
    }
    return bytes;
}

export { ModuleBuilder, OP, DataBuilder, FunctionIRBuilder, encodeLEB128, encodeSignedLEB128 };
