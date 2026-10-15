// src/semantic/controlFlow.ts
import type { StatementNode } from '../parser';

/**
 * Devuelve `true` si TODOS los caminos del bloque terminan en un `return`.
 *
 * Es una comprobación conservadora: puede devolver `false` aunque el
 * bloque realmente retorne siempre (por ejemplo, si el `switch` cubre
 * todos los enteros de un rango, pero el analizador no lo sabe). En esos
 * casos el usuario debe agregar un `return` explícito al final.
 *
 * Sólo reconoce como terminadores:
 *   - `return`
 *   - `if` con `else` donde ambos brazos retornan
 *   - `switch` exhaustivo (con `default`, wildcard, o ambos `bool` cubiertos)
 *   - `region` cuyo cuerpo retorna
 *
 * No sigue bucles (un `for` infinito no se considera terminador).
 */
export function allPathsReturn(stmts: StatementNode[]): boolean {
  for (const s of stmts) {
    if (s.kind === 'return') return true;

    if (s.kind === 'if' && s.elseBlock) {
      const thenR = allPathsReturn(s.thenBlock);
      const elseR = Array.isArray(s.elseBlock)
        ? allPathsReturn(s.elseBlock)
        : allPathsReturn([s.elseBlock]);
      if (thenR && elseR) return true;
    }

    if (s.kind === 'switch') {
      const casesReturn = s.cases.every(c => allPathsReturn(c.body));
      const hasWildcard = s.cases.some(c =>
        c.patterns.some(pattern => pattern.kind === 'wildcard')
      );
      const boolCases = new Set(
        s.cases.flatMap(c =>
          c.patterns.flatMap(pattern =>
            pattern.kind === 'bool' ? [pattern.value] : []
          )
        )
      );
      const isExhaustive =
        s.defaultBody !== null ||
        hasWildcard ||
        (s.exprType === 'bool' && boolCases.has(true) && boolCases.has(false));
      const defaultReturns = s.defaultBody === null ||
        allPathsReturn(s.defaultBody);
      if (isExhaustive && casesReturn && defaultReturns) return true;
    }

    if (s.kind === 'region' && allPathsReturn(s.body)) return true;
  }
  return false;
}