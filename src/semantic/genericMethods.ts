import type { FunctionDefNode } from '../parser';
import type { MathType, StructType } from '../types';
import type { SemanticContext } from './context';
import { substituteType, substituteTypeInNode } from './generics';
import { structTypeFromRegistry } from './typeOps';

/**
 * Instancia todos los métodos genéricos declarados sobre `Vec<T>` cuando
 * `Vec<int>` (o cualquier instanciación) se materializa por primera vez.
 *
 * Los templates están en `ctx.genericStructMethods[baseName][methodName]`.
 * Acá se sustituyen los type params por sus bindings concretos y se
 * registran como métodos normales, del mismo modo que `instantiateFunction`
 * hace con las funciones genéricas top-level.
 *
 * Requiere que el struct ya esté registrado en el `TypeRegistry` (lo está,
 * porque este hook se dispara desde `instantiateStruct` después del
 * `registerStruct`).
 */
export function instantiateGenericMethods(
  ctx: SemanticContext,
  templateName: string,
  typeArgs: MathType[],
  instName: string,
  analyze: (ctx: SemanticContext, fn: FunctionDefNode, forceGlobal: boolean) => void,
): void {
  const methods = ctx.genericStructMethods.get(templateName);
  if (!methods || methods.size === 0) return;

  // Reconstruimos el StructType concreto (con fields resueltos). Necesario
  // porque los métodos van a hacer `self.campo` en su body.
  const receiverType: StructType = structTypeFromRegistry(ctx, instName);

  for (const [methodName, template] of methods) {
    const cacheKey = `${instName}::${methodName}`;
    if (ctx.instantiatedFunctions.has(cacheKey)) continue;

    // Type params del receptor en orden. Solo soportamos el caso donde
    // el receptor es exactamente `Vec<T1, T2, …>` con todos sus type args
    // siendo type params. Mezclas parciales (`Vec<int, T>`) no están soportadas.
    const receiverParams = extractReceiverTypeParams(template.receiver);
    if (receiverParams.length !== typeArgs.length) {
      throw new Error(
        `'${templateName}.${methodName}' tiene ${receiverParams.length} type params ` +
        `en el receptor pero '${templateName}' se instanció con ${typeArgs.length} type args`
      );
    }

    const bindings = new Map<string, MathType>();
    receiverParams.forEach((p, i) => bindings.set(p, typeArgs[i]));

    const params = template.params.map(p => ({
      ...p,
      type: substituteType(p.type, bindings),
      uniqueName: undefined,
      defaultValue: p.defaultValue
        ? substituteTypeInNode(structuredClone(p.defaultValue), bindings) as any
        : undefined,
    }));

    const returnTypes = template.returnTypes.map(t => substituteType(t, bindings));

    const body = template.body.map(s =>
      substituteTypeInNode(structuredClone(s), bindings) as any
    );

    const instance: FunctionDefNode = {
      kind: 'function_def',
      name: template.name,
      receiver: receiverType,
      params,
      returnTypes,
      body,
    };

    analyze(ctx, instance, /* forceGlobal */ true);
    ctx.instantiatedFunctions.set(cacheKey, instance.name);
    ctx.hoistedFunctions.push(instance);
  }
}

/**
 * Devuelve los nombres de los type params en orden, si el receptor es
 * exactamente `Vec<T1, T2, …>` con TODOS sus type args siendo type params.
 * Si algún type arg es concreto (`Vec<int, T>`), devuelve `[]` — el caso
 * queda fuera del MVP.
 */
function extractReceiverTypeParams(receiver: MathType | undefined): string[] {
  if (!receiver) return [];
  if (typeof receiver !== 'object' || receiver.kind !== 'generic_instance') return [];
  const out: string[] = [];
  for (const arg of receiver.typeArgs) {
    if (typeof arg !== 'object' || arg.kind !== 'type_param') return [];
    out.push(arg.name);
  }
  return out;
}
