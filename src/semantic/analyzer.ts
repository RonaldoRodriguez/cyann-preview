import type { ProgramNode } from '../parser';
import { formatDiagnosticList } from '../diagnostics';
import { SemanticContext } from './context';
import { registerBuiltins } from './builtins';
import {
  collectTypeAliases, collectStructs, collectFunctions,
} from './registration';
import { analyzeStatement, analyzeFunction } from './analysis';
import { instantiateGenericMethods } from './genericMethods';

const analyzedProgramBrand: unique symbol = Symbol('analyzedProgram');

export interface AnalyzedProgram extends ProgramNode {
  readonly [analyzedProgramBrand]: true;
}

/**
 * Orquestador del análisis semántico. Crea un `SemanticContext` fresco
 * por programa (sin contaminación entre análisis) y delega toda la lógica
 * a las funciones libres de `analysis.ts` y `registration.ts`.
 *
 * También configura el hook `onStructInstantiated`, que dispara la
 * instanciación de métodos genéricos cuando un struct genérico se
 * materializa por primera vez.
 */
export class SemanticAnalyzer {
  public analyzeProgram(program: ProgramNode): AnalyzedProgram {
    const ctx = new SemanticContext();
    registerBuiltins(ctx.scopeControl);

    // Wire del hook de instanciación. Se hace acá (no en typeOps.ts)
    // para evitar un ciclo de imports: typeOps → genericMethods → analysis
    // → typeOps sería circular.
    ctx.onStructInstantiated = (c, templateName, typeArgs, instName) => {
      instantiateGenericMethods(c, templateName, typeArgs, instName, analyzeFunction);
    };

    collectTypeAliases(ctx, program.body);
    collectStructs(ctx, program.body);
    collectFunctions(ctx, program.body);

    for (const stmt of program.body) analyzeStatement(ctx, stmt);

    for (const h of ctx.hoistedFunctions) program.body.push(h);

    if (ctx.diagnostics.hasErrors()) {
      const errs = ctx.diagnostics.getErrors();
      throw new Error(formatDiagnosticList(errs));
    }
    return Object.assign(program, { [analyzedProgramBrand]: true as const });
  }
}