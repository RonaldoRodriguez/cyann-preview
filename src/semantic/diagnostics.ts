// src/semantic/diagnostics.ts
import type { SourceLocation } from '../sourceMap';
import type { Diagnostic } from '../diagnostics';

/**
 * Acumulador de errores semánticos. Permite seguir analizando después de
 * un error para reportar múltiples problemas de una sola pasada, en lugar
 * de abortar en el primero.
 */
export class DiagnosticBag {
  private errors: Diagnostic[] = [];

  error(msg: string, location?: SourceLocation): void {
    this.errors.push({ message: msg, location });
  }

  hasErrors(): boolean {
    return this.errors.length > 0;
  }

  getErrors(): Diagnostic[] {
    return [...this.errors];
  }
}