/**
 * Módulo Preprocesador
 *
 * Procesa inclusiones de archivos (@include) resolviendo rutas relativas
 * al archivo que las escribe.
 *
 * Reglas:
 *   - Un archivo ya incluido se IGNORA silenciosamente (como `#pragma once`).
 *   - Un archivo que ya está en la ruta actual de expansión es un CICLO real → error.
 */

import * as path from 'path';

export async function preprocess(
  source: string,
  basePath: string,
  /** Archivos ya expandidos en cualquier punto del árbol. Dedupe. */
  seen: Set<string> = new Set(),
  /** Archivos en la ruta actual de expansión. Detección de ciclos. */
  inProgress: Set<string> = new Set(),
): Promise<string> {
  const combinedRe = /(\/\*[\s\S]*?\*\/|\/\/.*)|(@include\s*\(\s*"([^"]+)"\s*\))/g;
  let result = '';
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = combinedRe.exec(source)) !== null) {
    result += source.slice(lastIndex, match.index);

    if (match[1]) {
      // Comentario: preservar tal cual.
      result += match[0];
    } else if (match[2]) {
      const includePath = match[3];
      const fullPath = path.resolve(basePath, includePath);

      // ── Ciclo real: ya estamos expandiendo este archivo arriba en la pila.
      if (inProgress.has(fullPath)) {
        throw new Error(
          `@include circular detectado: "${includePath}" ` +
          `(resuelve a ${fullPath})`
        );
      }

      // ── Ya incluido antes: dedupe silencioso.
      if (seen.has(fullPath)) {
        // Nada que emitir. Opcional: log de debug.
        // console.error(`@include: omitiendo "${includePath}" (ya incluido)`);
            } else {
        // ── Primera vez: expandir.
        inProgress.add(fullPath);
        const file = Bun.file(fullPath);
        if (!(await file.exists())) {
          throw new Error(
            `@include: no se encontró el archivo "${includePath}" ` +
            `(resuelve a ${fullPath})`
          );
        }
        const content = await file.text();
        const expanded = await preprocess(
          content,
          path.dirname(fullPath),
          seen,
          inProgress,
        );
        inProgress.delete(fullPath);
        seen.add(fullPath);
        result += expanded;
      }
    }

    lastIndex = combinedRe.lastIndex;
  }

  result += source.slice(lastIndex);
  return result;
}