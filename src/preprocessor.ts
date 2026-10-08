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
import {
  createSourceSegment,
  locationInSource,
  SourceMap,
  SourceSegment,
  sourceLineStarts,
} from './sourceMap';
import { formatDiagnostic } from './diagnostics';

export interface PreprocessedSource {
  source: string;
  sourceMap: SourceMap;
}

export async function preprocess(
  source: string,
  basePath: string,
  seen: Set<string> = new Set(),
  inProgress: Set<string> = new Set(),
): Promise<string> {
  return (await preprocessWithSourceMap(source, basePath, seen, inProgress)).source;
}

export async function preprocessWithSourceMap(
  source: string,
  basePath: string,
  seen: Set<string> = new Set(),
  inProgress: Set<string> = new Set(),
  sourcePath?: string,
): Promise<PreprocessedSource> {
  const rootPath = sourcePath ? path.resolve(sourcePath) : path.resolve(basePath, '<source>');
  const state = {
    text: '',
    segments: [] as SourceSegment[],
    sourceLines: new Map<string, number[]>(),
  };
  const canonicalRoot = process.platform === 'win32' ? rootPath.toLowerCase() : rootPath;
  if (inProgress.has(canonicalRoot)) {
    throw new Error(`@include circular detectado: "${rootPath}" (resuelve a ${rootPath})`);
  }
  inProgress.add(canonicalRoot);
  try {
    await expandSource(source, rootPath, path.resolve(basePath), seen, inProgress, state);
  } finally {
    inProgress.delete(canonicalRoot);
  }
  return {
    source: state.text,
    sourceMap: new SourceMap(
      state.segments,
      locationInSource(source, rootPath, source.length),
    ),
  };
}

interface ExpansionState {
  text: string;
  segments: SourceSegment[];
  sourceLines: Map<string, number[]>;
}

async function expandSource(
  source: string,
  filePath: string,
  basePath: string,
  seen: Set<string>,
  inProgress: Set<string>,
  output: ExpansionState,
): Promise<void> {
  const combinedRe = /(\/\*[\s\S]*?\*\/|\/\/.*)|(@include\s*\(\s*"([^"]+)"\s*\))/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = combinedRe.exec(source)) !== null) {
    appendSource(source, filePath, lastIndex, match.index, output);

    if (match[1]) {
      appendSource(source, filePath, match.index, combinedRe.lastIndex, output);
    } else if (match[2]) {
      const includePath = match[3];
      const fullPath = path.resolve(basePath, includePath);
      const canonicalPath = process.platform === 'win32' ? fullPath.toLowerCase() : fullPath;
      const includeLocation = locationInSource(source, filePath, match.index);
      const formatIncludeError = (message: string) =>
        formatDiagnostic({ message, location: includeLocation });

      if (inProgress.has(canonicalPath)) {
        throw new Error(
          formatIncludeError(`@include circular detectado: "${includePath}" ` +
          `(resuelve a ${fullPath})`
          )
        );
      }

      if (!seen.has(canonicalPath)) {
        inProgress.add(canonicalPath);
        const file = Bun.file(fullPath);
        if (!(await file.exists())) {
          throw new Error(
            formatIncludeError(`@include: no se encontró el archivo "${includePath}" ` +
            `(resuelve a ${fullPath})`
            )
          );
        }
        const content = await file.text();
        await expandSource(
          content,
          fullPath,
          path.dirname(fullPath),
          seen,
          inProgress,
          output,
        );
        inProgress.delete(canonicalPath);
        seen.add(canonicalPath);
      }
    }

    lastIndex = combinedRe.lastIndex;
  }

  appendSource(source, filePath, lastIndex, source.length, output);
}

function appendSource(
  source: string,
  filePath: string,
  start: number,
  end: number,
  output: ExpansionState,
): void {
  if (end <= start) return;
  const generatedStart = output.text.length;
  const chunk = source.slice(start, end);
  output.text += chunk;
  let lineStarts = output.sourceLines.get(filePath);
  if (!lineStarts) {
    lineStarts = sourceLineStarts(source);
    output.sourceLines.set(filePath, lineStarts);
  }
  output.segments.push(
    createSourceSegment(generatedStart, generatedStart + chunk.length, start, lineStarts, filePath),
  );
}