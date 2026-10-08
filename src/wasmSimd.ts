export const SIMD_NOIMM: Record<string, number> = {
    // Shuffle / swizzle
    I8X16_SWIZZLE: 0x0E,
    // Splats
    I8X16_SPLAT: 0x0F, I16X8_SPLAT: 0x10, I32X4_SPLAT: 0x11,
    I64X2_SPLAT: 0x12, F32X4_SPLAT: 0x13, F64X2_SPLAT: 0x14,
    // Comparisons
    I8X16_EQ: 0x23, I8X16_NE: 0x24, I8X16_LT_S: 0x25, I8X16_LT_U: 0x26,
    I8X16_GT_S: 0x27, I8X16_GT_U: 0x28, I8X16_LE_S: 0x29, I8X16_LE_U: 0x2A,
    I8X16_GE_S: 0x2B, I8X16_GE_U: 0x2C,
    I16X8_EQ: 0x2D, I16X8_NE: 0x2E, I16X8_LT_S: 0x2F, I16X8_LT_U: 0x30,
    I16X8_GT_S: 0x31, I16X8_GT_U: 0x32, I16X8_LE_S: 0x33, I16X8_LE_U: 0x34,
    I16X8_GE_S: 0x35, I16X8_GE_U: 0x36,
    I32X4_EQ: 0x37, I32X4_NE: 0x38, I32X4_LT_S: 0x39, I32X4_LT_U: 0x3A,
    I32X4_GT_S: 0x3B, I32X4_GT_U: 0x3C, I32X4_LE_S: 0x3D, I32X4_LE_U: 0x3E,
    I32X4_GE_S: 0x3F, I32X4_GE_U: 0x40,
    F32X4_EQ: 0x41, F32X4_NE: 0x42, F32X4_LT: 0x43, F32X4_GT: 0x44,
    F32X4_LE: 0x45, F32X4_GE: 0x46,
    F64X2_EQ: 0x47, F64X2_NE: 0x48, F64X2_LT: 0x49, F64X2_GT: 0x4A,
    F64X2_LE: 0x4B, F64X2_GE: 0x4C,
    // v128 basics
    V128_NOT: 0x4D, V128_AND: 0x4E, V128_ANDNOT: 0x4F, V128_OR: 0x50,
    V128_XOR: 0x51, V128_BITSELECT: 0x52, V128_ANY_TRUE: 0x53,
    // i8x16
    I8X16_ABS: 0x60, I8X16_NEG: 0x61, I8X16_POPCNT: 0x62,
    I8X16_ALL_TRUE: 0x63, I8X16_BITMASK: 0x64,
    I8X16_NARROW_I16X8_S: 0x65, I8X16_NARROW_I16X8_U: 0x66,
    F32X4_CEIL: 0x67, F32X4_FLOOR: 0x68, F32X4_TRUNC: 0x69, F32X4_NEAREST: 0x6A,
    I8X16_SHL: 0x6B, I8X16_SHR_S: 0x6C, I8X16_SHR_U: 0x6D,
    I8X16_ADD: 0x6E, I8X16_ADD_SAT_S: 0x6F, I8X16_ADD_SAT_U: 0x70,
    I8X16_SUB: 0x71, I8X16_SUB_SAT_S: 0x72, I8X16_SUB_SAT_U: 0x73,
    F64X2_CEIL: 0x74, F64X2_FLOOR: 0x75,
    I8X16_MIN_S: 0x76, I8X16_MIN_U: 0x77, I8X16_MAX_S: 0x78, I8X16_MAX_U: 0x79,
    F64X2_TRUNC: 0x7A,
    I8X16_AVGR_U: 0x7B,
    I16X8_EXTADD_PAIRWISE_I8X16_S: 0x7C, I16X8_EXTADD_PAIRWISE_I8X16_U: 0x7D,
    I32X4_EXTADD_PAIRWISE_I16X8_S: 0x7E, I32X4_EXTADD_PAIRWISE_I16X8_U: 0x7F,
    // i16x8
    I16X8_ABS: 0x80, I16X8_NEG: 0x81, I16X8_Q15MULR_SAT_S: 0x82,
    I16X8_ALL_TRUE: 0x83, I16X8_BITMASK: 0x84,
    I16X8_NARROW_I32X4_S: 0x85, I16X8_NARROW_I32X4_U: 0x86,
    I16X8_EXTEND_LOW_I8X16_S: 0x87, I16X8_EXTEND_HIGH_I8X16_S: 0x88,
    I16X8_EXTEND_LOW_I8X16_U: 0x89, I16X8_EXTEND_HIGH_I8X16_U: 0x8A,
    I16X8_SHL: 0x8B, I16X8_SHR_S: 0x8C, I16X8_SHR_U: 0x8D,
    I16X8_ADD: 0x8E, I16X8_ADD_SAT_S: 0x8F, I16X8_ADD_SAT_U: 0x90,
    I16X8_SUB: 0x91, I16X8_SUB_SAT_S: 0x92, I16X8_SUB_SAT_U: 0x93,
    F64X2_NEAREST: 0x94,
    I16X8_MUL: 0x95, I16X8_MIN_S: 0x96, I16X8_MIN_U: 0x97,
    I16X8_MAX_S: 0x98, I16X8_MAX_U: 0x99,
    I16X8_AVGR_U: 0x9B,
    I16X8_EXTMUL_LOW_I8X16_S: 0x9C, I16X8_EXTMUL_HIGH_I8X16_S: 0x9D,
    I16X8_EXTMUL_LOW_I8X16_U: 0x9E, I16X8_EXTMUL_HIGH_I8X16_U: 0x9F,
    // i32x4
    I32X4_ABS: 0xA0, I32X4_NEG: 0xA1,
    I32X4_ALL_TRUE: 0xA3, I32X4_BITMASK: 0xA4,
    I32X4_EXTEND_LOW_I16X8_S: 0xA7, I32X4_EXTEND_HIGH_I16X8_S: 0xA8,
    I32X4_EXTEND_LOW_I16X8_U: 0xA9, I32X4_EXTEND_HIGH_I16X8_U: 0xAA,
    I32X4_SHL: 0xAB, I32X4_SHR_S: 0xAC, I32X4_SHR_U: 0xAD,
    I32X4_ADD: 0xAE, I32X4_SUB: 0xB1, I32X4_MUL: 0xB5,
    I32X4_MIN_S: 0xB6, I32X4_MIN_U: 0xB7, I32X4_MAX_S: 0xB8, I32X4_MAX_U: 0xB9,
    I32X4_DOT_I16X8_S: 0xBA,
    I32X4_EXTMUL_LOW_I16X8_S: 0xBC, I32X4_EXTMUL_HIGH_I16X8_S: 0xBD,
    I32X4_EXTMUL_LOW_I16X8_U: 0xBE, I32X4_EXTMUL_HIGH_I16X8_U: 0xBF,
    // i64x2
    I64X2_ABS: 0xC0, I64X2_NEG: 0xC1,
    I64X2_ALL_TRUE: 0xC3, I64X2_BITMASK: 0xC4,
    I64X2_EXTEND_LOW_I32X4_S: 0xC7, I64X2_EXTEND_HIGH_I32X4_S: 0xC8,
    I64X2_EXTEND_LOW_I32X4_U: 0xC9, I64X2_EXTEND_HIGH_I32X4_U: 0xCA,
    I64X2_SHL: 0xCB, I64X2_SHR_S: 0xCC, I64X2_SHR_U: 0xCD,
    I64X2_ADD: 0xCE, I64X2_SUB: 0xD1, I64X2_MUL: 0xD5,
    I64X2_EQ: 0xD6, I64X2_NE: 0xD7, I64X2_LT_S: 0xD8,
    I64X2_GT_S: 0xD9, I64X2_LE_S: 0xDA, I64X2_GE_S: 0xDB,
    I64X2_EXTMUL_LOW_I32X4_S: 0xDC, I64X2_EXTMUL_HIGH_I32X4_S: 0xDD,
    I64X2_EXTMUL_LOW_I32X4_U: 0xDE, I64X2_EXTMUL_HIGH_I32X4_U: 0xDF,
    // f32x4
    F32X4_ABS: 0xE0, F32X4_NEG: 0xE1, F32X4_SQRT: 0xE3,
    F32X4_ADD: 0xE4, F32X4_SUB: 0xE5, F32X4_MUL: 0xE6, F32X4_DIV: 0xE7,
    F32X4_MIN: 0xE8, F32X4_MAX: 0xE9, F32X4_PMIN: 0xEA, F32X4_PMAX: 0xEB,
    // f64x2
    F64X2_ABS: 0xEC, F64X2_NEG: 0xED, F64X2_SQRT: 0xEF,
    F64X2_ADD: 0xF0, F64X2_SUB: 0xF1, F64X2_MUL: 0xF2, F64X2_DIV: 0xF3,
    F64X2_MIN: 0xF4, F64X2_MAX: 0xF5, F64X2_PMIN: 0xF6, F64X2_PMAX: 0xF7,
    // Conversions
    I32X4_TRUNC_SAT_F32X4_S: 0xF8, I32X4_TRUNC_SAT_F32X4_U: 0xF9,
    F32X4_CONVERT_I32X4_S: 0xFA, F32X4_CONVERT_I32X4_U: 0xFB,
    I32X4_TRUNC_SAT_F64X2_S_ZERO: 0xFC, I32X4_TRUNC_SAT_F64X2_U_ZERO: 0xFD,
    F64X2_CONVERT_LOW_I32X4_S: 0xFE, F64X2_CONVERT_LOW_I32X4_U: 0xFF,
};

export const SIMD_MEMARG: Record<string, number> = {
    V128_LOAD: 0x00,
    V128_LOAD8X8_S: 0x01, V128_LOAD8X8_U: 0x02,
    V128_LOAD16X4_S: 0x03, V128_LOAD16X4_U: 0x04,
    V128_LOAD32X2_S: 0x05, V128_LOAD32X2_U: 0x06,
    V128_LOAD8_SPLAT: 0x07, V128_LOAD16_SPLAT: 0x08,
    V128_LOAD32_SPLAT: 0x09, V128_LOAD64_SPLAT: 0x0A,
    V128_STORE: 0x0B,
    V128_LOAD32_ZERO: 0x5C, V128_LOAD64_ZERO: 0x5D,
};

export const SIMD_MEMARG_LANE: Record<string, number> = {
    V128_LOAD8_LANE: 0x54, V128_LOAD16_LANE: 0x55,
    V128_LOAD32_LANE: 0x56, V128_LOAD64_LANE: 0x57,
    V128_STORE8_LANE: 0x58, V128_STORE16_LANE: 0x59,
    V128_STORE32_LANE: 0x5A, V128_STORE64_LANE: 0x5B,
};

export const SIMD_LANE: Record<string, number> = {
    I8X16_EXTRACT_LANE_S: 0x15, I8X16_EXTRACT_LANE_U: 0x16, I8X16_REPLACE_LANE: 0x17,
    I16X8_EXTRACT_LANE_S: 0x18, I16X8_EXTRACT_LANE_U: 0x19, I16X8_REPLACE_LANE: 0x1A,
    I32X4_EXTRACT_LANE: 0x1B, I32X4_REPLACE_LANE: 0x1C,
    I64X2_EXTRACT_LANE: 0x1D, I64X2_REPLACE_LANE: 0x1E,
    F32X4_EXTRACT_LANE: 0x1F, F32X4_REPLACE_LANE: 0x20,
    F64X2_EXTRACT_LANE: 0x21, F64X2_REPLACE_LANE: 0x22,
};

// Subopcodes con immediate especial
export const SIMD_CONST_SUBOP = 0x0C;
export const SIMD_SHUFFLE_SUBOP = 0x0D;

// ─── Reverse lookup para el decoder (se construye una sola vez) ─────────────
export type SimdEntry =
    | { name: string; kind: 'noimm' }
    | { name: string; kind: 'memarg'; naturalAlign: number }
    | { name: string; kind: 'memarg_lane'; naturalAlign: number }
    | { name: string; kind: 'lane' }
    | { kind: 'const' }
    | { kind: 'shuffle' };

export const SIMD_REVERSE: Map<number, SimdEntry> = (() => {
    const m = new Map<number, SimdEntry>();
    for (const [name, v] of Object.entries(SIMD_NOIMM)) m.set(v, { name, kind: 'noimm' });
    for (const [name, v] of Object.entries(SIMD_MEMARG)) {
        m.set(v, { name, kind: 'memarg', naturalAlign: simdNaturalAlign(name) });
    }
    for (const [name, v] of Object.entries(SIMD_MEMARG_LANE)) {
        m.set(v, { name, kind: 'memarg_lane', naturalAlign: simdNaturalAlignLane(name) });
    }
    for (const [name, v] of Object.entries(SIMD_LANE)) m.set(v, { name, kind: 'lane' });
    m.set(SIMD_CONST_SUBOP, { kind: 'const' });
    m.set(SIMD_SHUFFLE_SUBOP, { kind: 'shuffle' });
    return m;
})();

export function simdNaturalAlign(name: string): number {
    // Splats y zeros: tamaño del lane extraído
    if (name.endsWith('_LOAD8_SPLAT')) return 0;
    if (name.endsWith('_LOAD16_SPLAT')) return 1;
    if (name.endsWith('_LOAD32_SPLAT')) return 2;
    if (name.endsWith('_LOAD64_SPLAT')) return 3;
    if (name.endsWith('_LOAD32_ZERO')) return 2;
    if (name.endsWith('_LOAD64_ZERO')) return 3;

    // Load-and-extend: leen 8 bytes (8×i8, 4×i16 o 2×i32)
    if (name.includes('_LOAD8X8_') || name.includes('_LOAD16X4_') || name.includes('_LOAD32X2_')) {
        return 3;
    }

    // V128_LOAD y V128_STORE leen/escriben 16 bytes
    return 4;
}

export function simdNaturalAlignLane(name: string): number {
    if (name.includes('8_LANE')) return 0;
    if (name.includes('16_LANE')) return 1;
    if (name.includes('32_LANE')) return 2;
    if (name.includes('64_LANE')) return 3;
    return 0;
}

/**
 * Devuelve el índice máximo de lane válido para un opcode SIMD con laneidx.
 * i8x16 → 15, i16x8 → 7, i32x4/f32x4 → 3, i64x2/f64x2 → 1.
 */
export function simdMaxLane(name: string): number {
    // Ops por familia de tipo
    if (name.startsWith('I8X16_')) return 15;
    if (name.startsWith('I16X8_')) return 7;
    if (name.startsWith('I32X4_') || name.startsWith('F32X4_')) return 3;
    if (name.startsWith('I64X2_') || name.startsWith('F64X2_')) return 1;
    // Ops de load/store con laneidx
    if (name.endsWith('8_LANE')) return 15;
    if (name.endsWith('16_LANE')) return 7;
    if (name.endsWith('32_LANE')) return 3;
    if (name.endsWith('64_LANE')) return 1;
    return 255; // fallback conservador (uint8)
}

// ─── Helper: formatea un nombre de opcode SIMD a WAT ───────────────────────
export function simdWatName(name: string): string {
    const idx = name.indexOf('_');
    if (idx === -1) return name.toLowerCase();
    return name.slice(0, idx).toLowerCase() + '.' + name.slice(idx + 1).toLowerCase();
}

