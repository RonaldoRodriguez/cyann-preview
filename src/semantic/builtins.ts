// src/semantic/builtins.ts
import type { MathType } from '../types';
import type { ScopeControl } from './symbols';

interface BuiltinSpec {
  name: string;
  params: MathType[];
  ret: MathType | null;
}

/**
 * Declara los builtins del runtime que el codegen sabe emitir como
 * funciones nativas: arena, heap, memoria cruda y strings.
 *
 * El codegen sólo emite el cuerpo de estos helpers si detecta que se
 * usan (ver `scanBuiltins` en codegen.ts). El semantic sólo necesita
 * conocer sus firmas para que el chequeo de tipos y la resolución de
 * sobrecargas funcionen.
 */
export function registerBuiltins(scopeControl: ScopeControl): void {
  const s32: MathType = 's32';
  const pointer: MathType = { kind: 'pointer', targetType: s32 };

  const builtins: BuiltinSpec[] = [
    { name: 'arena_save',                 params: [],                     ret: pointer },
    { name: 'arena_restore',              params: [pointer],              ret: null    },
    { name: 'arena_alloc',                params: [s32],                  ret: pointer },
    { name: '__unsafe__mem_memcpy',       params: [pointer, pointer, s32], ret: null    },
    { name: '__unsafe__mem_memcpyi',      params: [s32, s32, s32],        ret: null    },
    { name: '__unsafe__mem_read16',       params: [pointer, s32],         ret: s32     },
    { name: '__unsafe__mem_read64',       params: [pointer, s32],         ret: s32     },
    { name: '__unsafe__mem_read32',       params: [pointer, s32],         ret: s32     },
    { name: '__unsafe__mem_read32i',      params: [s32, s32],             ret: s32     },
    { name: '__unsafe__mem_write32',      params: [pointer, s32, s32],    ret: null    },
    { name: '__unsafe__mem_write16',      params: [pointer, s32, s32],    ret: null    },
    { name: '__unsafe__mem_write64',      params: [pointer, s32, s32],    ret: null    },
    { name: '__unsafe__mem_write32i',     params: [s32, s32, s32],        ret: null    },
    { name: '__unsafe__mem_read8',        params: [pointer, s32],         ret: s32     },
    { name: '__unsafe__mem_write8',       params: [pointer, s32, s32],    ret: null    },
    { name: '__unsafe__mem_read8i',       params: [s32, s32],             ret: s32     },
    { name: '__unsafe__mem_write8i',      params: [s32, s32, s32],        ret: null    },
    { name: 'str_len',                    params: ['string'],             ret: s32     },
    { name: 'str_concat',                 params: ['string', 'string'],   ret: 'string'},
    { name: 'str_eq',                     params: ['string', 'string'],   ret: 'bool'  },
    { name: 'str_ne',                     params: ['string', 'string'],   ret: 'bool'  },
    { name: '__heap_grow',                params: [s32],                  ret: s32     },
    { name: 'info_heap_start_ptr',        params: [],                     ret: pointer },
    { name: 'info_heap_end_ptr',          params: [],                     ret: s32     },
  ];

  for (const b of builtins) {
    scopeControl.declareFunction(
      b.name,
      b.name,
      { kind: 'function', paramTypes: b.params, returnTypes: b.ret ? [b.ret] : [] },
      true,
    );
  }
}