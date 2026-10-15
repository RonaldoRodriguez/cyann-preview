// src/semantic/symbols.ts
import type { MathType, FunctionType, MathNode } from '../types';
import { functionParamsEqual } from '../mangler';

export interface FunctionOverload {
  mangledName: string;
  type: FunctionType;
  defaultArgs: MathNode[];
}

export interface SymbolInfo {
  uniqueName: string;
  type: MathType;
  mutable: boolean;
  isGlobal: boolean;
  isFunctionDecl?: boolean;
  overloads?: FunctionOverload[];
  boxed?: boolean;
}

/**
 * Pila de ámbitos léxicos. Mantiene la correspondencia nombre→símbolo y
 * lleva la cuenta de los "lambda boundaries" para saber cuándo un nombre
 * resuelto viene de un ámbito externo (y por lo tanto debe capturarse).
 */
export class ScopeControl {
  private scopes: Map<string, SymbolInfo>[] = [];
  private counter = 0;
  private lambdaBoundaries: number[] = [];

  constructor() { this.scopes.push(new Map()); }

  isGlobal() { return this.scopes.length === 1; }
  pushScope() { this.scopes.push(new Map()); }
  popScope() {
    if (this.scopes.length <= 1) throw new Error('No se puede eliminar el ámbito global');
    this.scopes.pop();
  }

  pushLambdaBoundary(): void { this.lambdaBoundaries.push(this.scopes.length); }
  popLambdaBoundary(): void { this.lambdaBoundaries.pop(); }

  private isInsideInnermostLambda(scopeIndex: number): boolean {
    if (this.lambdaBoundaries.length === 0) return true;
    const boundary = this.lambdaBoundaries[this.lambdaBoundaries.length - 1];
    return scopeIndex >= boundary;
  }

  lookupWithBoundary(name: string): { info: SymbolInfo; isCapture: boolean } {
    for (let i = this.scopes.length - 1; i >= 0; i--) {
      const info = this.scopes[i].get(name);
      if (info) return { info, isCapture: !this.isInsideInnermostLambda(i) };
    }
    throw new Error(`Identificador no definido: '${name}'`);
  }

  declare(name: string, type: MathType, mutable: boolean, global = false, boxed = false): string {
    const target = global ? this.scopes[0] : this.scopes[this.scopes.length - 1];
    if (target.has(name)) throw new Error(`El identificador '${name}' ya está declarado en este ámbito`);
    const uniqueName = `$${name}_${this.counter++}`;
    target.set(name, { uniqueName, type, mutable, isGlobal: global, boxed });
    return uniqueName;
  }

  declareFunction(
    name: string,
    mangledName: string,
    fnType: FunctionType,
    global: boolean,
    defaultArgs: MathNode[] = [],
  ): void {
    const target = global ? this.scopes[0] : this.scopes[this.scopes.length - 1];
    const existing = target.get(name);
    if (existing) {
      if (!existing.isFunctionDecl) throw new Error(`'${name}' ya está declarado como variable; no se puede sobrecargar`);
      for (const ov of existing.overloads!) {
        if (functionParamsEqual(ov.type, fnType)) {
          if (ov.mangledName === mangledName) {
            if (defaultArgs.length > 0) ov.defaultArgs = defaultArgs;
            return;
          }
          throw new Error(`Sobrecarga duplicada de '${name}'`);
        }
      }
      existing.overloads!.push({ mangledName, type: fnType, defaultArgs });
    } else {
      target.set(name, {
        uniqueName: mangledName, type: fnType, mutable: false, isGlobal: global,
        isFunctionDecl: true, overloads: [{ mangledName, type: fnType, defaultArgs }],
      });
    }
  }

  lookup(name: string): SymbolInfo {
    for (let i = this.scopes.length - 1; i >= 0; i--) {
      if (this.scopes[i].has(name)) return this.scopes[i].get(name)!;
    }
    throw new Error(`Identificador no definido: '${name}'`);
  }

  has(name: string): boolean {
    for (let i = this.scopes.length - 1; i >= 0; i--) if (this.scopes[i].has(name)) return true;
    return false;
  }

  checkMutable(name: string): void {
    if (!this.lookup(name).mutable) throw new Error(`No se puede reasignar un valor a una constante '${name}'`);
  }
}