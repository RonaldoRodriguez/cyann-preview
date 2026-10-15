import type { FunctionDefNode } from '../parser';
import type { MathType } from '../types';
import { mangleType } from '../mangler';
import type { SemanticContext } from './context';

// ─────────────────────────────────────────────────────────────────────
// Sustitución de tipos
// ─────────────────────────────────────────────────────────────────────

/**
 * Reemplaza recursivamente cada aparición de un `type_param` por su
 * binding concreto. `bindings` mapea nombre del parámetro (`T`) → tipo.
 */
export function substituteType(
  type: MathType,
  bindings: Map<string, MathType>,
): MathType {
  if (type == null) throw new Error('substituteType: tipo undefined/null');
  if (typeof type === 'string') return type;

  switch (type.kind) {
    case 'type_param': {
      const bound = bindings.get(type.name);
      if (!bound) throw new Error(`Type param '${type.name}' sin binding`);
      return bound;
    }
    case 'pointer':
      return { kind: 'pointer', targetType: substituteType(type.targetType, bindings) };
    case 'array':
      return {
        kind: 'array',
        elementType: substituteType(type.elementType, bindings),
        length: type.length,
      };
    case 'dynarray':
      return { kind: 'dynarray', elementType: substituteType(type.elementType, bindings) };
    case 'function':
      return {
        ...type,
        paramTypes: type.paramTypes.map(t => substituteType(t, bindings)),
        returnTypes: type.returnTypes.map(t => substituteType(t, bindings)),
      };
    case 'struct':
      // Los structs nombrados no se sustituyen (no soportamos structs genéricos).
      return type;
    case 'generic_instance':
      return {
        ...type,
        typeArgs: type.typeArgs.map(t => substituteType(t, bindings)),
      };
    default:
      return type;
  }
}

// ─────────────────────────────────────────────────────────────────────
// Sustitución dentro de un AST (body de la función)
// ─────────────────────────────────────────────────────────────────────

const TYPE_FIELDS = new Set([
  'type', 'targetType', 'newType', 'oldType', 'elementType', 'typeExpr',
]);

/**
 * Campos que son arrays de MathType. OJO: `typeArgs` DEBE estar acá.
 * Sin él, si una plantilla A<T> llama a otra B<T> internamente, cuando
 * instanciás A<int> el `T` dentro del CallNode a B<T> queda sin
 * sustituir, y B recibe un type_arg espurio.
 */
const TYPE_ARRAY_FIELDS = new Set([
  'returnTypes', 'paramTypes', 'receiverTypes', 'typeArgs',
]);

/**
 * Recorre el AST mutándolo in-place: en cada campo de tipo (`type`,
 * `targetType`, `newType`, …) sustituye los `type_param` por sus bindings.
 *
 * Los campos de tipo se identifican por NOMBRE (no por valor), porque
 * `MathType` incluye strings primitivos ('s32', 'string', …) que son
 * indistinguibles de otros strings del AST.
 *
 * IMPORTANTE: campos cuyo valor es `undefined` o `null` se dejan tal cual.
 */
export function substituteTypeInNode(
  node: unknown,
  bindings: Map<string, MathType>,
): unknown {
  if (Array.isArray(node)) {
    for (let i = 0; i < node.length; i++) {
      node[i] = substituteTypeInNode(node[i], bindings);
    }
    return node;
  }
  if (!node || typeof node !== 'object') return node;

  const obj = node as Record<string, unknown>;

  for (const key of Object.keys(obj)) {
    if (key === 'kind') continue;
    const val = obj[key];

    if (TYPE_FIELDS.has(key)) {
      if (val != null) obj[key] = substituteType(val as MathType, bindings);
      continue;
    }
    if (TYPE_ARRAY_FIELDS.has(key) && Array.isArray(val)) {
      obj[key] = val.map((t) => substituteType(t as MathType, bindings));
      continue;
    }
    obj[key] = substituteTypeInNode(val, bindings);
  }
  return node;
}

// ─────────────────────────────────────────────────────────────────────
// Monomorphización
// ─────────────────────────────────────────────────────────────────────

/**
 * Dada una plantilla genérica y sus type args concretos, produce una
 * instancia monomórfica de la función (clon del body con los `type_param`
 * sustituidos) y la registra vía `analyze` (que es `analyzeFunction`).
 *
 * Cachea por `nombre<arg1,arg2,…>` para no re-instanciar. La instancia
 * queda registrada en `scopeControl` bajo el source name original
 * (`identity` o `__module_N_identity`), así que la resolución normal de
 * sobrecargas la encuentra por tipos de argumento.
 *
 * La instancia se agrega a `ctx.hoistedFunctions` para que el analyzer la
 * incorpore al `program.body` — si no, codegen nunca la compila y el
 * ModuleBuilder falla con "Función no definida: <mangled>".
 */
export function instantiateFunction(
  ctx: SemanticContext,
  template: FunctionDefNode,
  typeArgs: MathType[],
  analyze: (ctx: SemanticContext, fn: FunctionDefNode, forceGlobal: boolean) => void,
): void {
  const templateName = template.name;
  const typeParams = template.typeParams ?? [];

  if (typeArgs.length !== typeParams.length) {
    throw new Error(
      `'${templateName}' espera ${typeParams.length} type args, ` +
      `se recibieron ${typeArgs.length}`
    );
  }

  const key = `${templateName}<${typeArgs.map(mangleType).join(',')}>`;
  if (ctx.instantiatedFunctions.has(key)) return;

  const bindings = new Map<string, MathType>();
  typeParams.forEach((p, i) => bindings.set(p, typeArgs[i]));

  const params = template.params.map((p) => ({
    ...p,
    type: substituteType(p.type, bindings),
    uniqueName: undefined,
    defaultValue: p.defaultValue
      ? substituteTypeInNode(structuredClone(p.defaultValue), bindings) as any
      : undefined,
  }));

  const returnTypes = template.returnTypes.map((t) => substituteType(t, bindings));

  const body = template.body.map((s) =>
    substituteTypeInNode(structuredClone(s), bindings) as any
  );

  const instance: FunctionDefNode = {
    kind: 'function_def',
    name: templateName,
    params,
    returnTypes,
    body,
  };

  analyze(ctx, instance, /* forceGlobal */ true);

  ctx.instantiatedFunctions.set(key, instance.name);
  ctx.hoistedFunctions.push(instance);
}