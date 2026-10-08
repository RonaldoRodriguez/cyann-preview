import { SourceLocation } from './sourceMap';

export interface Diagnostic {
  message: string;
  location?: SourceLocation;
}

export function formatDiagnostic(diagnostic: Diagnostic): string {
  const { location } = diagnostic;
  if (!location) return `error: ${diagnostic.message}`;
  return `${location.filePath}:${location.line}:${location.column}: error: ${diagnostic.message}`;
}

export function formatDiagnosticList(diagnostics: Diagnostic[]): string {
  const count = diagnostics.length;
  const header = `Se encontraron ${count} error${count === 1 ? '' : 'es'}:`;
  const entries = diagnostics.map(
    (diagnostic, index) => `  ${index + 1}. ${formatDiagnostic(diagnostic)}`,
  );
  return [header, ...entries].join('\n');
}
