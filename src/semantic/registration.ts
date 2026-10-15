import type { StatementNode, FunctionDefNode } from '../parser';
import type { MathNode, MathType, FunctionType, StructType } from '../types';
import { mangleFunctionName } from '../mangler';
import type { SemanticContext } from './context';
import type { FunctionOverload } from './symbols';
import {
  resolveType, registryTypeName, structTypeFromRegistry, typeName,
} from './typeOps';

export function collectTypeAliases(ctx: SemanticContext, stmts: StatementNode[]): void {
  for (const s of stmts) {
    if (s.kind !== 'type_alias') continue;
    ctx.typeAliases.set(s.name, s.targetType);
  }
}

export function collectStructs(ctx: SemanticContext, stmts: StatementNode[]): void {
  for (const s of stmts) {
    if (s.kind !== 'struct_def') continue;

    // Struct genérico → plantilla, no registrar todavía.
    if (s.typeParams && s.typeParams.length > 0) {
      ctx.genericStructs.set(s.name, s);
      continue;
    }
// export function isGenericReceiver(receiver: MathType): boolean {
    ctx.withLocation(s.sourceLocation, () => {
      ctx.structDefinitions.set(s.name, s);
      ctx.typeRegistry.registerStruct(
        s.name,
        s.fields.map(f => {
          const regName = registryTypeName(ctx, f.type);
          if (typeof f.type === 'object' && f.type.kind === 'function') {
            return { name: f.name, type: regName, mathType: f.type };
          }
          return { name: f.name, type: regName };
        })
      );
      const structType = structTypeFromRegistry(ctx, s.name);
      ctx.scopeControl.declare(s.name, structType, false, true);
    });
  }
}

export function collectFunctions(ctx: SemanticContext, stmts: StatementNode[]): void {
  for (const s of stmts) {
    if (s.kind !== 'function_def') continue;
    const fn = s as FunctionDefNode;

    // ── Método genérico sobre struct genérico: `[Vec<T>] func ...` ────
    // Se guarda como plantilla y se instancia cuando el struct concreto
    // se materialice. La detección va antes de `resolveType`, porque el
    // receptor contiene un type_param sin resolver.
    if (fn.receiver && isGenericReceiver(fn.receiver)) {
      const baseName = (fn.receiver as { kind: 'generic_instance'; baseName: string }).baseName;
      let methods = ctx.genericStructMethods.get(baseName);
      if (!methods) {
        methods = new Map();
        ctx.genericStructMethods.set(baseName, methods);
      }
      methods.set(fn.name, fn);
      continue;
    }
    // ─────────────────────────────────────────────────────────────────

    // Función genérica top-level → plantilla.
    if (fn.typeParams && fn.typeParams.length > 0) {
      ctx.genericFunctions.set(fn.name, fn);
      continue;
    }

    ctx.withLocation(s.sourceLocation, () => {
      let receiverType: StructType | null = null;
      if (fn.receiver) {
        const rt = resolveType(ctx, fn.receiver);
        if (typeof rt !== 'object' || rt.kind !== 'struct') {
          ctx.error(
            `Receiver de '${fn.name}' debe ser un struct, se obtuvo ${typeName(rt)}`
          );
          return;
        }
        if (rt.name === '') {
          ctx.error(`Receiver de '${fn.name}' no puede ser un struct anónimo`);
          return;
        }
        receiverType = rt;
      }

      const userParamTypes = fn.params.map(p => {
        const type = resolveType(ctx, p.type);
        return p.variadic ? { kind: 'dynarray' as const, elementType: type } : type;
      });
      const allParamTypes = receiverType
        ? [receiverType, ...userParamTypes]
        : userParamTypes;
      const returnTypes = fn.returnTypes.map(t => resolveType(ctx, t));
      const fnType: FunctionType = {
        kind: 'function',
        paramTypes: allParamTypes,
        returnTypes,
        variadic: fn.params.some(param => param.variadic),
      };
      const mangledName = mangleFunctionName(fn.name, allParamTypes, fnType.variadic);
      const defaultArgs = fn.params.flatMap(
        param => param.defaultValue ? [param.defaultValue] : [],
      );

      if (receiverType) {
        registerMethod(ctx, receiverType.name, fn.name, mangledName, fnType, defaultArgs);
      }

      ctx.scopeControl.declareFunction(fn.name, mangledName, fnType, true, defaultArgs);
    });
  }
}

/**
 * Un receptor es "genérico" si es una `generic_instance` cuyos type args
 * son todos type params (`Vec<T>` o `Vec<T, U>`). Mezclas parciales como
 * `Vec<int, T>` no se consideran template (no soportadas en MVP).
 */
export function isGenericReceiver(receiver: MathType): boolean {
  if (typeof receiver !== 'object' || receiver.kind !== 'generic_instance') return false;
  if (receiver.typeArgs.length === 0) return false;
  return receiver.typeArgs.every(
    arg => typeof arg === 'object' && arg.kind === 'type_param'
  );
}

export function registerMethod(
  ctx: SemanticContext,
  receiverName: string,
  methodName: string,
  mangled: string,
  type: FunctionType,
  defaultArgs: MathNode[],
): void {
  let methods = ctx.methodsByStruct.get(receiverName);
  if (!methods) {
    methods = new Map();
    ctx.methodsByStruct.set(receiverName, methods);
  }
  methods.set(methodName, { mangledName: mangled, type, defaultArgs });
}

export function lookupMethod(
  ctx: SemanticContext,
  receiverName: string,
  methodName: string,
): FunctionOverload | undefined {
  return ctx.methodsByStruct.get(receiverName)?.get(methodName);
}