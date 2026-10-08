import { SIMD_REVERSE, simdWatName } from './wasmSimd';

// Binary reader
// ─────────────────────────────────────────────────────────────────────────────
class BinaryReader {
    private pos = 0;
    constructor(private buf: Uint8Array) {}

    readByte(): number {
        if (this.pos >= this.buf.length) throw new Error('EOF');
        return this.buf[this.pos++];
    }
    readBytes(n: number): Uint8Array {
        if (this.pos + n > this.buf.length) throw new Error('EOF');
        const slice = this.buf.slice(this.pos, this.pos + n);
        this.pos += n;
        return slice;
    }
    get position(): number { return this.pos; }
    set position(p: number) { this.pos = p; }
    readU32(): number {
        let result = 0, shift = 0;
        while (true) {
            const byte = this.readByte();
            result |= (byte & 0x7F) << shift;
            if (!(byte & 0x80)) return result >>> 0;
            shift += 7;
        }
    }
    readS32(): number {
        let result = 0, shift = 0;
        while (true) {
            const byte = this.readByte();
            result |= (byte & 0x7F) << shift;
            shift += 7;
            if (!(byte & 0x80)) {
                if (shift < 32 && (byte & 0x40)) result |= -(1 << shift);
                return result;
            }
        }
    }
    readS64(): bigint {
        let result = 0n, shift = 0n;
        while (true) {
            const byte = this.readByte();
            result |= BigInt(byte & 0x7F) << shift;
            shift += 7n;
            if (!(byte & 0x80)) {
                if (shift < 64n && (byte & 0x40)) result |= -1n << shift;
                return result;
            }
        }
    }
    readName(): string {
        const len = this.readU32();
        return new TextDecoder().decode(this.readBytes(len));
    }
    eof(): boolean { return this.pos >= this.buf.length; }
}

// ─────────────────────────────────────────────────────────────────────────────
// Opcode maps (decoder)
// ─────────────────────────────────────────────────────────────────────────────
const OPCODE_MAP: Record<number, string> = {
    0x00: 'unreachable', 0x01: 'nop',
    0x02: 'block', 0x03: 'loop', 0x04: 'if',
    0x05: 'else', 0x0B: 'end',
    0x0C: 'br', 0x0D: 'br_if', 0x0E: 'br_table',
    0x0F: 'return', 0x10: 'call', 0x11: 'call_indirect', 0x14: 'call_ref', 0x15: 'return_call_ref',
    0x1A: 'drop', 0x1B: 'select', 0x1C: 'select_t',
    0x20: 'local.get', 0x21: 'local.set', 0x22: 'local.tee',
    0x23: 'global.get', 0x24: 'global.set',
    0x25: 'table.get', 0x26: 'table.set',
    0x28: 'i32.load', 0x29: 'i64.load', 0x2A: 'f32.load', 0x2B: 'f64.load',
    0x2C: 'i32.load8_s', 0x2D: 'i32.load8_u', 0x2E: 'i32.load16_s', 0x2F: 'i32.load16_u',
    0x30: 'i64.load8_s', 0x31: 'i64.load8_u', 0x32: 'i64.load16_s', 0x33: 'i64.load16_u',
    0x34: 'i64.load32_s', 0x35: 'i64.load32_u',
    0x36: 'i32.store', 0x37: 'i64.store', 0x38: 'f32.store', 0x39: 'f64.store',
    0x3A: 'i32.store8', 0x3B: 'i32.store16', 0x3C: 'i64.store8', 0x3D: 'i64.store16', 0x3E: 'i64.store32',
    0x3F: 'memory.size', 0x40: 'memory.grow',
    0x41: 'i32.const', 0x42: 'i64.const', 0x43: 'f32.const', 0x44: 'f64.const',
    0x45: 'i32.eqz', 0x50: 'i64.eqz',
    0x46: 'i32.eq', 0x47: 'i32.ne', 0x48: 'i32.lt_s', 0x49: 'i32.lt_u',
    0x4A: 'i32.gt_s', 0x4B: 'i32.gt_u', 0x4C: 'i32.le_s', 0x4D: 'i32.le_u',
    0x4E: 'i32.ge_s', 0x4F: 'i32.ge_u',
    0x51: 'i64.eq', 0x52: 'i64.ne', 0x53: 'i64.lt_s', 0x54: 'i64.lt_u',
    0x55: 'i64.gt_s', 0x56: 'i64.gt_u', 0x57: 'i64.le_s', 0x58: 'i64.le_u',
    0x59: 'i64.ge_s', 0x5A: 'i64.ge_u',
    0x5B: 'f32.eq', 0x5C: 'f32.ne', 0x5D: 'f32.lt', 0x5E: 'f32.gt',
    0x5F: 'f32.le', 0x60: 'f32.ge',
    0x61: 'f64.eq', 0x62: 'f64.ne', 0x63: 'f64.lt', 0x64: 'f64.gt',
    0x65: 'f64.le', 0x66: 'f64.ge',
    0x67: 'i32.clz', 0x68: 'i32.ctz', 0x69: 'i32.popcnt',
    0x6A: 'i32.add', 0x6B: 'i32.sub', 0x6C: 'i32.mul',
    0x6D: 'i32.div_s', 0x6E: 'i32.div_u', 0x6F: 'i32.rem_s', 0x70: 'i32.rem_u',
    0x71: 'i32.and', 0x72: 'i32.or', 0x73: 'i32.xor',
    0x74: 'i32.shl', 0x75: 'i32.shr_s', 0x76: 'i32.shr_u',
    0x77: 'i32.rotl', 0x78: 'i32.rotr',
    0x79: 'i64.clz', 0x7A: 'i64.ctz', 0x7B: 'i64.popcnt',
    0x7C: 'i64.add', 0x7D: 'i64.sub', 0x7E: 'i64.mul',
    0x7F: 'i64.div_s', 0x80: 'i64.div_u', 0x81: 'i64.rem_s', 0x82: 'i64.rem_u',
    0x83: 'i64.and', 0x84: 'i64.or', 0x85: 'i64.xor',
    0x86: 'i64.shl', 0x87: 'i64.shr_s', 0x88: 'i64.shr_u',
    0x89: 'i64.rotl', 0x8A: 'i64.rotr',
    0x8B: 'f32.abs', 0x8C: 'f32.neg', 0x8D: 'f32.ceil', 0x8E: 'f32.floor',
    0x8F: 'f32.trunc', 0x90: 'f32.nearest', 0x91: 'f32.sqrt',
    0x92: 'f32.add', 0x93: 'f32.sub', 0x94: 'f32.mul', 0x95: 'f32.div',
    0x96: 'f32.min', 0x97: 'f32.max', 0x98: 'f32.copysign',
    0x99: 'f64.abs', 0x9A: 'f64.neg', 0x9B: 'f64.ceil', 0x9C: 'f64.floor',
    0x9D: 'f64.trunc', 0x9E: 'f64.nearest', 0x9F: 'f64.sqrt',
    0xA0: 'f64.add', 0xA1: 'f64.sub', 0xA2: 'f64.mul', 0xA3: 'f64.div',
    0xA4: 'f64.min', 0xA5: 'f64.max', 0xA6: 'f64.copysign',
    0xA7: 'i32.wrap_i64',
    0xA8: 'i32.trunc_f32_s', 0xA9: 'i32.trunc_f32_u',
    0xAA: 'i32.trunc_f64_s', 0xAB: 'i32.trunc_f64_u',
    0xAC: 'i64.extend_i32_s', 0xAD: 'i64.extend_i32_u',
    0xAE: 'i64.trunc_f32_s', 0xAF: 'i64.trunc_f32_u',
    0xB0: 'i64.trunc_f64_s', 0xB1: 'i64.trunc_f64_u',
    0xB2: 'f32.convert_i32_s', 0xB3: 'f32.convert_i32_u',
    0xB4: 'f32.convert_i64_s', 0xB5: 'f32.convert_i64_u',
    0xB6: 'f32.demote_f64',
    0xB7: 'f64.convert_i32_s', 0xB8: 'f64.convert_i32_u',
    0xB9: 'f64.convert_i64_s', 0xBA: 'f64.convert_i64_u',
    0xBB: 'f64.promote_f32',
    0xBC: 'i32.reinterpret_f32', 0xBD: 'i64.reinterpret_f64',
    0xBE: 'f32.reinterpret_i32', 0xBF: 'f64.reinterpret_i64',
    0xD0: 'ref.null', 0xD1: 'ref.is_null', 0xD2: 'ref.func',
};

const MISC_SUBOP_MAP: Record<number, string> = {
    0x00: 'i32.trunc_sat_f32_s', 0x01: 'i32.trunc_sat_f32_u',
    0x02: 'i32.trunc_sat_f64_s', 0x03: 'i32.trunc_sat_f64_u',
    0x04: 'i64.trunc_sat_f32_s', 0x05: 'i64.trunc_sat_f32_u',
    0x06: 'i64.trunc_sat_f64_s', 0x07: 'i64.trunc_sat_f64_u',
    0x08: 'memory.init', 0x09: 'data.drop', 0x0A: 'memory.copy', 0x0B: 'memory.fill',
    0x0C: 'table.init', 0x0D: 'elem.drop', 0x0E: 'table.copy',
    0x0F: 'table.grow', 0x10: 'table.size', 0x11: 'table.fill',
};

function valTypeToStr(type: number): string {
    const map: Record<number, string> = {
        0x7F: 'i32', 0x7E: 'i64', 0x7D: 'f32', 0x7C: 'f64',
        0x7B: 'v128',
        0x70: 'funcref', 0x6F: 'externref',
    };
    return map[type] ?? 'unknown';
}

function formatFuncType(idx: number, params: number[], results: number[]): string {
    const p = params.map(valTypeToStr).join(' ');
    const r = results.map(valTypeToStr).join(' ');
    let text = `(type (;${idx};) (func`;
    if (p) text += ` (param ${p})`;
    if (r) text += ` (result ${r})`;
    text += '))';
    return text;
}

function f32ToWat(bits: number): string {
    return `0x${(bits >>> 0).toString(16).padStart(8, '0')}`;
}

function f64ToWat(bits: bigint): string {
    return `0x${bits.toString(16).padStart(16, '0')}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Disassembly
// ─────────────────────────────────────────────────────────────────────────────
function parseInitExpr(r: BinaryReader): string {
    const instrs: string[] = [];
    while (true) {
        const b = r.readByte();
        if (b === 0x0B) break;
        r.position--;
        instrs.push(disassembleInstruction(r));
    }
    return instrs.join(' ');
}

function disassembleInstruction(r: BinaryReader): string {
    const opcode = r.readByte();

    if (opcode === 0xFD) {
        const sub = r.readU32();
        const entry = SIMD_REVERSE.get(sub);
        if (!entry) throw new Error(`Subopcode SIMD desconocido: 0x${sub.toString(16)}`);
        switch (entry.kind) {
            case 'noimm':
                return simdWatName(entry.name);
            case 'memarg': {
                const alignExp = r.readU32();
                const offset = r.readU32();
                return `${simdWatName(entry.name)} offset=${offset} align=${1 << alignExp}`;
            }
            case 'memarg_lane': {
                const alignExp = r.readU32();
                const offset = r.readU32();
                const lane = r.readByte();
                return `${simdWatName(entry.name)} ${lane} offset=${offset} align=${1 << alignExp}`;
            }
            case 'lane': {
                const lane = r.readByte();
                return `${simdWatName(entry.name)} ${lane}`;
            }
            case 'const': {
                const b = Array.from(r.readBytes(16));
                // Emitir como i8x16 con 16 números
                return `v128.const i8x16 ${b.join(' ')}`;
            }
            case 'shuffle': {
                const b = Array.from(r.readBytes(16));
                return `i8x16.shuffle ${b.join(' ')}`;
            }
        }
    }

    if (opcode === 0xFC) {
        const sub = r.readByte();
        const name = MISC_SUBOP_MAP[sub];
        if (!name) throw new Error(`Subopcode FC desconocido: 0x${sub.toString(16)}`);
        switch (sub) {
            case 0x08: {
                const d = r.readU32();
                r.readByte();
                return `memory.init ${d}`;
            }
            case 0x09: return `data.drop ${r.readU32()}`;
            case 0x0A: r.readByte(); r.readByte(); return 'memory.copy';
            case 0x0B: r.readByte(); return 'memory.fill';
            case 0x0C: return `table.init ${r.readU32()} ${r.readU32()}`;
            case 0x0D: return `elem.drop ${r.readU32()}`;
            case 0x0E: return `table.copy ${r.readU32()} ${r.readU32()}`;
            case 0x0F: return `table.grow ${r.readU32()}`;
            case 0x10: return `table.size ${r.readU32()}`;
            case 0x11: return `table.fill ${r.readU32()}`;
            default: return name;
        }
    }

    const mnemonic = OPCODE_MAP[opcode];
    if (!mnemonic) throw new Error(`Opcode desconocido: 0x${opcode.toString(16)}`);

    switch (opcode) {
        case 0x02: case 0x03: case 0x04: {
            const bt = r.readByte();
            if (bt === 0x40) return mnemonic;
            if ([0x7F, 0x7E, 0x7D, 0x7C, 0x7B, 0x70, 0x6F].includes(bt)) return `${mnemonic} (result ${valTypeToStr(bt)})`;
            r.position--;
            const typeIdx = r.readS32();
            return `${mnemonic} (type ${typeIdx})`;
        }
        case 0x0C: case 0x0D: return `${mnemonic} ${r.readU32()}`;
        case 0x0E: {
            const count = r.readU32();
            const labels: number[] = [];
            for (let i = 0; i < count; i++) labels.push(r.readU32());
            const def = r.readU32();
            return `br_table ${labels.join(' ')} ${def}`;
        }
        case 0x10: return `call ${r.readU32()}`;
        case 0x11: {
            const typeIdx = r.readU32();
            r.readU32();
            return `call_indirect (type ${typeIdx})`;
        }
        case 0x14: return `call_ref ${r.readU32()}`;
        case 0x15: return `return_call_ref ${r.readU32()}`;
        case 0x1C: {
            const n = r.readU32();
            const types: string[] = [];
            for (let i = 0; i < n; i++) types.push(valTypeToStr(r.readByte()));
            return `select (result ${types.join(' ')})`;
        }
        case 0x20: case 0x21: case 0x22:
        case 0x23: case 0x24:
        case 0x25: case 0x26:
            return `${mnemonic} ${r.readU32()}`;
        case 0x41: return `i32.const ${r.readS32()}`;
        case 0x42: return `i64.const ${r.readS64()}`;
        case 0x43: {
            const b = r.readBytes(4);
            const bits = new DataView(b.buffer, b.byteOffset, 4).getUint32(0, true);
            return `f32.const ${f32ToWat(bits)}`;
        }
        case 0x44: {
            const b = r.readBytes(8);
            const bits = new DataView(b.buffer, b.byteOffset, 8).getBigUint64(0, true);
            return `f64.const ${f64ToWat(bits)}`;
        }
        case 0x28: case 0x29: case 0x2A: case 0x2B:
        case 0x2C: case 0x2D: case 0x2E: case 0x2F:
        case 0x30: case 0x31: case 0x32: case 0x33:
        case 0x34: case 0x35:
        case 0x36: case 0x37: case 0x38: case 0x39:
        case 0x3A: case 0x3B: case 0x3C: case 0x3D: case 0x3E: {
            const alignExp = r.readU32();
            const offset = r.readU32();
            return `${mnemonic} offset=${offset} align=${1 << alignExp}`;
        }
        case 0x3F: case 0x40:
            r.readByte();
            return mnemonic;
        case 0xD0: return `ref.null ${valTypeToStr(r.readByte())}`;
        case 0xD1: return 'ref.is_null';
        case 0xD2: return `ref.func ${r.readU32()}`;
        default:
            return mnemonic;
    }
}

function parseLocals(r: BinaryReader): string[] {
    const count = r.readU32();
    const locals: string[] = [];
    for (let i = 0; i < count; i++) {
        const n = r.readU32();
        const type = r.readByte();
        for (let j = 0; j < n; j++) locals.push(`(local ${valTypeToStr(type)})`);
    }
    return locals;
}

function disassembleInstructions(r: BinaryReader, endPos: number): string[] {
    const instrs: string[] = [];
    let blockDepth = 0;
    while (r.position < endPos) {
        const opcode = r.readByte();
        if (opcode === 0x02 || opcode === 0x03 || opcode === 0x04) {
            blockDepth++;
            r.position--;
            instrs.push(disassembleInstruction(r));
        } else if (opcode === 0x05) {
            r.position--;
            instrs.push(disassembleInstruction(r));
        } else if (opcode === 0x0B) {
            blockDepth--;
            if (blockDepth < 0) break;
            instrs.push('end');
        } else {
            r.position--;
            instrs.push(disassembleInstruction(r));
        }
    }
    return instrs;
}

function dataToWatString(bytes: number[]): string {
    let str = '';
    for (const b of bytes) {
        switch (b) {
            case 0x09: str += '\\t'; break;
            case 0x0A: str += '\\n'; break;
            case 0x0D: str += '\\r'; break;
            case 0x22: str += '\\"'; break;
            case 0x5C: str += '\\\\'; break;
            default:
                if (b >= 0x20 && b <= 0x7E) str += String.fromCharCode(b);
                else str += '\\' + b.toString(16).padStart(2, '0');
        }
    }
    return str;
}

function readElementSegment(r: BinaryReader, flag: number, index: number): string {
    switch (flag) {
        case 0: {
            const offsetExpr = parseInitExpr(r);
            const n = r.readU32();
            const idx: number[] = [];
            for (let j = 0; j < n; j++) idx.push(r.readU32());
            return `(elem (${offsetExpr}) ${idx.join(' ')})`;
        }
        case 1: {
            const k = r.readByte();
            if (k !== 0x00) throw new Error(`elemkind inesperado: ${k}`);
            const n = r.readU32();
            const idx: number[] = [];
            for (let j = 0; j < n; j++) idx.push(r.readU32());
            return `(elem func ${idx.join(' ')})`;
        }
        case 2: {
            const t = r.readU32();
            const offsetExpr = parseInitExpr(r);
            const k = r.readByte();
            if (k !== 0x00) throw new Error(`elemkind inesperado: ${k}`);
            const n = r.readU32();
            const idx: number[] = [];
            for (let j = 0; j < n; j++) idx.push(r.readU32());
            return `(elem (table ${t}) (${offsetExpr}) func ${idx.join(' ')})`;
        }
        case 3: {
            const k = r.readByte();
            if (k !== 0x00) throw new Error(`elemkind inesperado: ${k}`);
            const n = r.readU32();
            const idx: number[] = [];
            for (let j = 0; j < n; j++) idx.push(r.readU32());
            return `(elem declare func ${idx.join(' ')})`;
        }
        case 4: {
            const offsetExpr = parseInitExpr(r);
            const n = r.readU32();
            const exprs: string[] = [];
            for (let j = 0; j < n; j++) exprs.push(`(${parseInitExpr(r)})`);
            return `(elem (${offsetExpr}) ${exprs.join(' ')})`;
        }
        case 5: {
            const rt = valTypeToStr(r.readByte());
            const n = r.readU32();
            const exprs: string[] = [];
            for (let j = 0; j < n; j++) exprs.push(`(${parseInitExpr(r)})`);
            return `(elem ${rt} ${exprs.join(' ')})`;
        }
        case 6: {
            const t = r.readU32();
            const offsetExpr = parseInitExpr(r);
            const rt = valTypeToStr(r.readByte());
            const n = r.readU32();
            const exprs: string[] = [];
            for (let j = 0; j < n; j++) exprs.push(`(${parseInitExpr(r)})`);
            return `(elem (table ${t}) (${offsetExpr}) ${rt} ${exprs.join(' ')})`;
        }
        case 7: {
            const rt = valTypeToStr(r.readByte());
            const n = r.readU32();
            const exprs: string[] = [];
            for (let j = 0; j < n; j++) exprs.push(`(${parseInitExpr(r)})`);
            return `(elem declare ${rt} ${exprs.join(' ')})`;
        }
        default:
            throw new Error(`Element flag ${flag} (index ${index}) desconocido.`);
    }
}

export function decodeModuleToWat(buffer: Uint8Array): string {
    const r = new BinaryReader(buffer);
    r.readBytes(4);
    r.readBytes(4);

    const types: string[] = [];
    const imports: string[] = [];
    const funcTypeIndices: number[] = [];
    let memoryDef: string | null = null;
    let memoryIsImported = false;
    const globals: string[] = [];
    const exports: string[] = [];
    const tableDefs: string[] = [];
    const codeBodies: { locals: string[]; instructions: string[] }[] = [];
    const dataSegments: string[] = [];
    const elemSegments: string[] = [];
    const customComments: string[] = [];
    let startLine: string | null = null;

    while (!r.eof()) {
        const id = r.readByte();
        const size = r.readU32();
        const endPos = r.position + size;

        switch (id) {
            case 0: {
                const secName = r.readName();
                const remaining = endPos - r.position;
                const data = Array.from(r.readBytes(remaining));
                if (secName === 'name') {
                    const nr = new BinaryReader(new Uint8Array(data));
                    const parts: string[] = [];
                    while (!nr.eof()) {
                        const subId = nr.readByte();
                        const subSize = nr.readU32();
                        const subEnd = nr.position + subSize;
                        if (subId === 0) {
                            parts.push(`module="${nr.readName()}"`);
                        } else if (subId === 1) {
                            const n = nr.readU32();
                            const entries: string[] = [];
                            for (let i = 0; i < n; i++) {
                                const idx = nr.readU32();
                                entries.push(`${idx}="${nr.readName()}"`);
                            }
                            parts.push(`funcs=[${entries.join(',')}]`);
                        } else if (subId === 2) {
                            const n = nr.readU32();
                            const entries: string[] = [];
                            for (let i = 0; i < n; i++) {
                                const fi = nr.readU32();
                                const m = nr.readU32();
                                const locals: string[] = [];
                                for (let j = 0; j < m; j++) {
                                    locals.push(`${nr.readU32()}="${nr.readName()}"`);
                                }
                                entries.push(`f${fi}:[${locals.join(',')}]`);
                            }
                            parts.push(`locals=[${entries.join(',')}]`);
                        } else {
                            nr.position = subEnd;
                        }
                        nr.position = subEnd;
                    }
                    customComments.push(`;; name section: ${parts.join(' ')}`);
                } else if (secName === 'producers') {
                    customComments.push(`;; producers section (${data.length} bytes)`);
                } else {
                    customComments.push(`;; custom section "${secName}" (${data.length} bytes)`);
                }
                break;
            }
            case 1: {
                const count = r.readU32();
                for (let i = 0; i < count; i++) {
                    const form = r.readByte();
                    if (form !== 0x60) {
                        throw new Error(`Functype form inesperado: 0x${form.toString(16)} (se esperaba 0x60)`);
                    }
                    const pc = r.readU32();
                    const params: number[] = [];
                    for (let j = 0; j < pc; j++) params.push(r.readByte());
                    const rc = r.readU32();
                    const results: number[] = [];
                    for (let j = 0; j < rc; j++) results.push(r.readByte());
                    types.push(formatFuncType(i, params, results));
                }
                break;
            }
            case 2: {
                const count = r.readU32();
                for (let i = 0; i < count; i++) {
                    const mod = r.readName();
                    const name = r.readName();
                    const kind = r.readByte();
                    if (kind === 0x00) {
                        const typeIdx = r.readU32();
                        imports.push(`(import "${mod}" "${name}" (func (type ${typeIdx})))`);
                    } else if (kind === 0x01) {
                        const rt = valTypeToStr(r.readByte());
                        const flags = r.readByte();
                        const initial = r.readU32();
                        const maximum = (flags & 1) ? r.readU32() : undefined;
                        tableDefs.push(`(import "${mod}" "${name}" (table ${initial}${maximum !== undefined ? ' ' + maximum : ''} ${rt}))`);
                    } else if (kind === 0x02) {
                        memoryIsImported = true;
                        const flags = r.readByte();
                        const initial = r.readU32();
                        const maximum = (flags & 1) ? r.readU32() : undefined;
                        memoryDef = `(import "${mod}" "${name}" (memory ${initial}${maximum !== undefined ? ' ' + maximum : ''}))`;
                    } else if (kind === 0x03) {
                        const type = r.readByte();
                        const mut = r.readByte() === 1;
                        imports.push(`(import "${mod}" "${name}" (global ${mut ? `(mut ${valTypeToStr(type)})` : valTypeToStr(type)}))`);
                    }
                }
                break;
            }
            case 3: {
                const count = r.readU32();
                for (let i = 0; i < count; i++) funcTypeIndices.push(r.readU32());
                break;
            }
            case 4: {
                const count = r.readU32();
                for (let i = 0; i < count; i++) {
                    const elemType = r.readByte();
                    const flags = r.readByte();
                    const initial = r.readU32();
                    const maximum = (flags & 1) ? r.readU32() : undefined;
                    tableDefs.push(`(table ${initial}${maximum !== undefined ? ' ' + maximum : ''} ${valTypeToStr(elemType)})`);
                }
                break;
            }
            case 5: {
                r.readU32();
                const flags = r.readByte();
                const initial = r.readU32();
                const maximum = (flags & 1) ? r.readU32() : undefined;
                memoryDef = `(memory ${initial}${maximum !== undefined ? ' ' + maximum : ''})`;
                break;
            }
            case 6: {
                const count = r.readU32();
                for (let i = 0; i < count; i++) {
                    const type = r.readByte();
                    const mut = r.readByte() === 1;
                    const initExpr = parseInitExpr(r);
                    globals.push(`(global (;${i};) ${mut ? `(mut ${valTypeToStr(type)})` : valTypeToStr(type)} ${initExpr})`);
                }
                break;
            }
            case 7: {
                const count = r.readU32();
                for (let i = 0; i < count; i++) {
                    const name = r.readName();
                    const kind = r.readByte();
                    const index = r.readU32();
                    const k = ['func', 'table', 'memory', 'global'][kind] ?? 'func';
                    exports.push(`(export "${name}" (${k} ${index}))`);
                }
                break;
            }
            case 8: {
                const startIdx = r.readU32();
                startLine = `(start ${startIdx})`;
                break;
            }
            case 9: {
                const count = r.readU32();
                for (let i = 0; i < count; i++) {
                    const flag = r.readU32();
                    elemSegments.push(readElementSegment(r, flag, i));
                }
                break;
            }
            case 10: {
                const count = r.readU32();
                for (let i = 0; i < count; i++) {
                    const bodySize = r.readU32();
                    const bodyEnd = r.position + bodySize;
                    const locals = parseLocals(r);
                    const instructions = disassembleInstructions(r, bodyEnd);
                    codeBodies.push({ locals, instructions });
                    r.position = bodyEnd;
                }
                break;
            }
            case 11: {
                const count = r.readU32();
                for (let i = 0; i < count; i++) {
                    const mode = r.readU32();
                    if (mode === 0) {
                        const offsetExpr = parseInitExpr(r);
                        const dataSize = r.readU32();
                        const data = Array.from(r.readBytes(dataSize));
                        dataSegments.push(`(data (${offsetExpr}) "${dataToWatString(data)}")`);
                    } else if (mode === 1) {
                        const dataSize = r.readU32();
                        const data = Array.from(r.readBytes(dataSize));
                        dataSegments.push(`(data "${dataToWatString(data)}")`);
                    } else if (mode === 2) {
                        const memIdx = r.readU32();
                        const offsetExpr = parseInitExpr(r);
                        const dataSize = r.readU32();
                        const data = Array.from(r.readBytes(dataSize));
                        dataSegments.push(`(data (memory ${memIdx}) (${offsetExpr}) "${dataToWatString(data)}")`);
                    } else {
                        throw new Error(`Data segment con modo ${mode} no soportado`);
                    }
                }
                break;
            }
            default:
                r.position = endPos;
        }
        r.position = endPos;
    }

    const lines: string[] = [];
    for (const c of customComments) lines.push(c);
    lines.push('(module');
    const ind = '  ';
    for (const t of types) lines.push(ind + t);
    for (const imp of imports) lines.push(ind + imp);
    if (memoryDef && !memoryIsImported) lines.push(ind + memoryDef);
    for (const td of tableDefs) lines.push(ind + td);
    if (startLine) lines.push(ind + startLine);
    for (const es of elemSegments) lines.push(ind + es);
    for (const g of globals) lines.push(ind + g);
    for (const e of exports) lines.push(ind + e);
    for (const ds of dataSegments) lines.push(ind + ds);

    const importFuncCount = imports.filter(imp => imp.includes('(func')).length;
    for (let i = 0; i < funcTypeIndices.length; i++) {
        const body = codeBodies[i];
        lines.push(ind + `(func (;${importFuncCount + i};) (type ${funcTypeIndices[i]})`);
        for (const local of body.locals) lines.push(ind + ind + local);
        for (const instr of body.instructions) lines.push(ind + ind + instr);
        lines.push(ind + ')');
    }

    lines.push(')');
    return lines.join('\n');
}

// ─────────────────────────────────────────────────────────────────────────────
// Binary tree (mismo que antes, sin cambios específicos para SIMD)
// ─────────────────────────────────────────────────────────────────────────────
export function parseBinaryTree(buffer: Uint8Array): any {
    const r = new BinaryReader(buffer);
    r.readBytes(4);
    r.readBytes(4);
    const moduleNode = { type: 'module', name: 'Module', children: [] as any[] };

    while (!r.eof()) {
        const id = r.readByte();
        const size = r.readU32();
        const endPos = r.position + size;

        switch (id) {
            case 0: {
                const secName = r.readName();
                const remaining = endPos - r.position;
                r.readBytes(remaining);
                moduleNode.children.push({ type: 'custom', name: `Custom "${secName}" (${remaining} bytes)`, children: [] });
                break;
            }
            case 1: {
                const count = r.readU32();
                const node = { type: 'section', name: 'Type Section', children: [] as any[] };
                for (let i = 0; i < count; i++) {
                    const form = r.readByte();
                    if (form !== 0x60) throw new Error(`Functype form inesperado: 0x${form.toString(16)}`);
                    const pc = r.readU32();
                    const params: number[] = [];
                    for (let j = 0; j < pc; j++) params.push(r.readByte());
                    const rc = r.readU32();
                    const results: number[] = [];
                    for (let j = 0; j < rc; j++) results.push(r.readByte());
                    node.children.push({ type: 'type', name: `Type ${i}: func (${params.map(valTypeToStr).join(' ')}) -> (${results.map(valTypeToStr).join(' ')})` });
                }
                moduleNode.children.push(node);
                break;
            }
            case 2: {
                const count = r.readU32();
                const node = { type: 'section', name: 'Import Section', children: [] as any[] };
                for (let i = 0; i < count; i++) {
                    const mod = r.readName();
                    const name = r.readName();
                    const kind = r.readByte();
                    let desc = '';
                    if (kind === 0x00) desc = `func type ${r.readU32()}`;
                    else if (kind === 0x01) {
                        const rt = valTypeToStr(r.readByte());
                        const flags = r.readByte();
                        const initial = r.readU32();
                        const maximum = (flags & 1) ? r.readU32() : undefined;
                        desc = `table min=${initial}` + (maximum !== undefined ? ` max=${maximum}` : '') + ` ${rt}`;
                    } else if (kind === 0x02) {
                        const flags = r.readByte();
                        const initial = r.readU32();
                        const maximum = (flags & 1) ? r.readU32() : undefined;
                        desc = `memory min=${initial}` + (maximum !== undefined ? ` max=${maximum}` : '');
                    } else if (kind === 0x03) {
                        const type = r.readByte();
                        const mut = r.readByte() === 1;
                        desc = `global ${valTypeToStr(type)}${mut ? ' mutable' : ''}`;
                    }
                    node.children.push({ type: 'import', name: `"${mod}" "${name}" (${desc})` });
                }
                moduleNode.children.push(node);
                break;
            }
            case 3: {
                const count = r.readU32();
                const node = { type: 'section', name: 'Function Section', children: [] as any[] };
                for (let i = 0; i < count; i++) {
                    node.children.push({ type: 'func', name: `Function ${i}: type ${r.readU32()}` });
                }
                moduleNode.children.push(node);
                break;
            }
            case 4: {
                const count = r.readU32();
                const node = { type: 'section', name: 'Table Section', children: [] as any[] };
                for (let i = 0; i < count; i++) {
                    const elemType = r.readByte();
                    const flags = r.readByte();
                    const initial = r.readU32();
                    const maximum = (flags & 1) ? r.readU32() : undefined;
                    node.children.push({ type: 'table', name: `Table ${i}: min=${initial}` + (maximum !== undefined ? ` max=${maximum}` : '') + ` ${valTypeToStr(elemType)}` });
                }
                moduleNode.children.push(node);
                break;
            }
            case 5: {
                const count = r.readU32();
                const node = { type: 'section', name: 'Memory Section', children: [] as any[] };
                for (let i = 0; i < count; i++) {
                    const flags = r.readByte();
                    const initial = r.readU32();
                    const maximum = (flags & 1) ? r.readU32() : undefined;
                    node.children.push({ type: 'memory', name: `Memory ${i}: min=${initial}` + (maximum !== undefined ? ` max=${maximum}` : '') });
                }
                moduleNode.children.push(node);
                break;
            }
            case 6: {
                const count = r.readU32();
                const node = { type: 'section', name: 'Global Section', children: [] as any[] };
                for (let i = 0; i < count; i++) {
                    const type = r.readByte();
                    const mut = r.readByte() === 1;
                    const initExpr = parseInitExpr(r);
                    node.children.push({ type: 'global', name: `Global ${i}: ${valTypeToStr(type)}${mut ? ' mutable' : ''} = ${initExpr}` });
                }
                moduleNode.children.push(node);
                break;
            }
            case 7: {
                const count = r.readU32();
                const node = { type: 'section', name: 'Export Section', children: [] as any[] };
                for (let i = 0; i < count; i++) {
                    const name = r.readName();
                    const kind = r.readByte();
                    const index = r.readU32();
                    const k = ['func', 'table', 'memory', 'global'][kind] ?? '?';
                    node.children.push({ type: 'export', name: `"${name}" (${k} ${index})` });
                }
                moduleNode.children.push(node);
                break;
            }
            case 8: {
                const startIdx = r.readU32();
                moduleNode.children.push({ type: 'section', name: 'Start Section', children: [{ type: 'start', name: `start func ${startIdx}` }] });
                break;
            }
            case 9: {
                const count = r.readU32();
                const node = { type: 'section', name: 'Element Section', children: [] as any[] };
                for (let i = 0; i < count; i++) {
                    const flag = r.readU32();
                    node.children.push({ type: 'element', name: readElementSegment(r, flag, i) });
                }
                moduleNode.children.push(node);
                break;
            }
            case 10: {
                const count = r.readU32();
                const node = { type: 'section', name: 'Code Section', children: [] as any[] };
                for (let i = 0; i < count; i++) {
                    const bodySize = r.readU32();
                    const bodyEnd = r.position + bodySize;
                    const localCount = r.readU32();
                    const locals: string[] = [];
                    for (let j = 0; j < localCount; j++) {
                        const n = r.readU32();
                        const type = r.readByte();
                        locals.push(`${n} x ${valTypeToStr(type)}`);
                    }
                    const funcNode = { type: 'function', name: `Function ${i}`, children: [] as any[] };
                    if (locals.length > 0) funcNode.children.push({ type: 'locals', name: `Locals: ${locals.join(', ')}` });
                    const instructions = disassembleInstructions(r, bodyEnd);
                    if (instructions.length > 0) {
                        const instrNode = { type: 'instructions', name: 'Instructions', children: [] as any[] };
                        for (const instr of instructions) instrNode.children.push({ type: 'instr', name: instr });
                        funcNode.children.push(instrNode);
                    }
                    r.position = bodyEnd;
                    node.children.push(funcNode);
                }
                moduleNode.children.push(node);
                break;
            }
            case 11: {
                const count = r.readU32();
                const node = { type: 'section', name: 'Data Section', children: [] as any[] };
                for (let i = 0; i < count; i++) {
                    const mode = r.readU32();
                    if (mode === 0) {
                        const offsetExpr = parseInitExpr(r);
                        const dataSize = r.readU32();
                        const data = Array.from(r.readBytes(dataSize));
                        node.children.push({ type: 'data', name: `offset=${offsetExpr}, "${dataToWatString(data)}"` });
                    } else if (mode === 1) {
                        const dataSize = r.readU32();
                        const data = Array.from(r.readBytes(dataSize));
                        node.children.push({ type: 'data', name: `"${dataToWatString(data)}"` });
                    } else if (mode === 2) {
                        const memIdx = r.readU32();
                        const offsetExpr = parseInitExpr(r);
                        const dataSize = r.readU32();
                        const data = Array.from(r.readBytes(dataSize));
                        node.children.push({ type: 'data', name: `memory=${memIdx} offset=${offsetExpr}, "${dataToWatString(data)}"` });
                    } else {
                        r.position = endPos;
                    }
                }
                moduleNode.children.push(node);
                break;
            }
            default: {
                r.position = endPos;
                moduleNode.children.push({ type: 'section', name: `Unknown Section (id: ${id})`, children: [] });
            }
        }
        r.position = endPos;
    }
    return moduleNode;
}

export function formatBinaryTree(node: any, prefix = '', isLast = true): string {
    const connector = isLast ? '└── ' : '├── ';
    let result = prefix + connector + node.name + '\n';
    if (node.children && node.children.length > 0) {
        const newPrefix = prefix + (isLast ? '    ' : '│   ');
        node.children.forEach((child: any, index: number) => {
            result += formatBinaryTree(child, newPrefix, index === node.children.length - 1);
        });
    }
    return result;
}

// ─────────────────────────────────────────────────────────────────────────────
