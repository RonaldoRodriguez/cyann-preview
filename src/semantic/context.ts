import { DiagnosticBag } from './diagnostics';
import { ScopeControl } from './symbols';
import type { FunctionOverload } from './symbols';
import type { FunctionDefNode, StructDefNode } from '../parser';
import type { MathType, MathNode, StructType, CapturedVar } from '../types';
import type { SourceLocation } from '../sourceMap';
import { TypeRegistry } from '../typeSystem';

export interface CaptureFrame {
  captures: Map<string, CapturedVar>;
}

/**
 * Hook invocado cuando `instantiateStruct` materializa una instanciación
 * por primera vez. Se usa para disparar la instanciación de los métodos
 * genéricos asociados a ese struct (`[Vec<T>] func ...`).
 *
 * Lo configura `SemanticAnalyzer.analyzeProgram` para evitar un ciclo
 * de imports entre `typeOps.ts` y `analysis.ts`.
 */
export type StructInstantiatedHook = (
  ctx: SemanticContext,
  templateName: string,
  typeArgs: MathType[],
  instName: string,
) => void;

export class SemanticContext {
  // ── Infraestructura ────────────────────────────────────────────────
  readonly scopeControl = new ScopeControl();
  readonly typeRegistry = new TypeRegistry();
  readonly diagnostics = new DiagnosticBag();

  // ── Estado del análisis en curso ───────────────────────────────────
  currentReturnTypes: MathType[] = [];
  currentLevel = 0;
  currentLocation?: SourceLocation;

  readonly slotLevels = new Map<string, number>();
  readonly hoistedFunctions: FunctionDefNode[] = [];
  readonly anonStructs = new Map<string, string>();
  readonly typeAliases = new Map<string, MathType>();
  readonly structDefinitions = new Map<string, StructDefNode>();
  readonly methodsByStruct = new Map<string, Map<string, FunctionOverload>>();
  readonly structCache = new Map<string, StructType>();

  captureStack: CaptureFrame[] = [];
  capturedNamesStack: Set<string>[] = [];

  anonStructCounter = 0;
  lambdaCounter = 0;
  syntheticCounter = 0;

  // ── Generics ───────────────────────────────────────────────────────
  /** Plantillas genéricas de funciones indexadas por nombre original. */
  readonly genericFunctions = new Map<string, FunctionDefNode>();
  /** Plantillas genéricas de structs indexadas por nombre original. */
  readonly genericStructs = new Map<string, StructDefNode>();
  /**
   * Plantillas de métodos genéricos: `nombre del struct base → nombre del
   * método → template`. Ej.: `Vec → push → template de push<T>`.
   */
  readonly genericStructMethods = new Map<string, Map<string, FunctionDefNode>>();
  /** Caché de instanciaciones: `Vec<s32>::push` → mangled. */
  readonly instantiatedFunctions = new Map<string, string>();

  /** Hook de instanciación de structs (wire en analyzer.ts). */
  onStructInstantiated?: StructInstantiatedHook;

  // ── Helpers ────────────────────────────────────────────────────────
  error(msg: string): void {
    this.diagnostics.error(msg, this.currentLocation);
  }

  withLocation<T>(loc: SourceLocation | undefined, action: () => T): T {
    const prev = this.currentLocation;
    this.currentLocation = loc ?? prev;
    try {
      return action();
    } finally {
      this.currentLocation = prev;
    }
  }

  currentCapturedNames(): Set<string> | null {
    return this.capturedNamesStack.length > 0
      ? this.capturedNamesStack[this.capturedNamesStack.length - 1]
      : null;
  }
}