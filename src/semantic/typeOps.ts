import type { MathType, StructType } from '../types';
import type { StructDefNode } from '../parser';
import { mangleType } from '../mangler';
import { computeStructLayout, describeType } from '../typeSystem';
import type { SemanticContext } from './context';
import { substituteType } from './generics';

// ─────────────────────────────────────────────────────────────────────
// Nombres canónicos de structs anónimos
// ─────────────────────────────────────────────────────────────────────

export function canonicalizeAnonStruct(
  ctx: SemanticContext,
  fields: { name: string; type: MathType }[],
): string {
  const key = fields.map(f => `${f.name}:${mangleType(f.type)}`).join(';');
  let canonical = ctx.anonStructs.get(key);
  if (canonical) return canonical;

  canonical = `__anon_${ctx.anonStructCounter++}`;
  ctx.anonStructs.set(key, canonical);

  ctx.typeRegistry.registerStruct(
    canonical,
    fields.map(f => {
      const regName = registryTypeName(ctx, f.type);
      if (typeof f.type === 'object' && f.type.kind === 'function') {
        return { name: f.name, type: regName, mathType: f.type };
      }
      return { name: f.name, type: regName };
    })
  );
  return canonical;
}

// ─────────────────────────────────────────────────────────────────────
// registryTypeName — nombre canónico dentro del TypeRegistry
// ─────────────────────────────────────────────────────────────────────

export function registryTypeName(
  ctx: SemanticContext,
  type: MathType,
  seen?: Set<string>,
): string {
  // ── Generic instance: nombre manglado directo, sin instanciar ────
  // Importante hacerlo ANTES de `struct`, para no intentar resolver
  // el baseName como struct normal (que no está registrado).
  if (typeof type === 'object' && type.kind === 'generic_instance') {
    return genericInstanceName(type.baseName, type.typeArgs);
  }
  // ─────────────────────────────────────────────────────────────────

  if (typeof type === 'object' && type.kind === 'struct') {
    const alias = ctx.typeAliases.get(type.name);
    if (alias !== undefined) {
      const s = seen ?? new Set<string>();
      if (s.has(type.name)) {
        throw new Error(
          `Ciclo de alias detectado: ${[...s, type.name].join(' → ')}`
        );
      }
      s.add(type.name);
      return registryTypeName(ctx, alias, s);
    }
  }

  if (typeof type !== 'object') {
    if (type === 's32') return 'i32';
    if (type === 's64') return 'i64';
    return type;
  }
  if (type.kind === 'struct') {
    if (type.name === '') {
      return canonicalizeAnonStruct(
        ctx,
        type.fields.map(f => ({ name: f.name, type: resolveType(ctx, f.type) }))
      );
    }
    return type.name;
  }
  if (type.kind === 'pointer') return `${registryTypeName(ctx, type.targetType, seen)}*`;
  if (type.kind === 'function') return 'i32';
  if (type.kind === 'dynarray') {
    const elemName = registryTypeName(ctx, type.elementType, seen);
    const dynName = `[]${elemName}`;
    if (!ctx.typeRegistry.hasType(dynName)) {
      ctx.typeRegistry.registerPrimitive(dynName, 4, 4);
    }
    return dynName;
  }
  if (type.kind === 'array') {
    const elemName = registryTypeName(ctx, type.elementType, seen);
    const arrayName = `[${elemName};${type.length}]`;
    if (!ctx.typeRegistry.hasType(arrayName)) {
      ctx.typeRegistry.registerArray(arrayName, elemName, type.length);
    }
    return arrayName;
  }
  if (type.kind === 'type_param') {
    // No debería llegar acá si el template se sustituyó correctamente.
    throw new Error(`registryTypeName: type_param '${type.name}' sin sustituir`);
  }
  throw new Error(`Tipo no compatible con campos de struct: ${describeType(type)}`);
}

// ─────────────────────────────────────────────────────────────────────
// resolveType — resuelve aliases, anónimos, generic instances
// ─────────────────────────────────────────────────────────────────────

export function resolveType(
  ctx: SemanticContext,
  type: MathType,
  seen?: Set<string>,
): MathType {
  if (typeof type !== 'object') return type;

  if (type.kind === 'struct') {
    const rawTarget = ctx.typeAliases.get(type.name);
    if (rawTarget !== undefined) {
      const s = seen ?? new Set<string>();
      if (s.has(type.name)) {
        throw new Error(
          `Ciclo de alias detectado: ${[...s, type.name].join(' → ')}`
        );
      }
      s.add(type.name);
      return resolveType(ctx, rawTarget, s);
    }

    if (type.name === '') {
      const normalized = type.fields.map(f => ({
        name: f.name,
        type: resolveType(ctx, f.type, seen),
      }));
      const canonical = canonicalizeAnonStruct(ctx, normalized);
      return structTypeFromRegistry(ctx, canonical);
    }

    return structTypeFromRegistry(ctx, type.name);
  }

  // ── Generic instance: instanciar on-demand ────────────────────────
  if (type.kind === 'generic_instance') {
    const template = ctx.genericStructs.get(type.baseName);
    if (!template) {
      throw new Error(`Tipo genérico no definido: '${type.baseName}'`);
    }
    // Resolver primero los type args (pueden ser a su vez generic
    // instances anidados, o structs importados).
    const resolvedArgs = type.typeArgs.map(t => resolveType(ctx, t, seen));
    return instantiateStruct(ctx, template, resolvedArgs);
  }
  // ─────────────────────────────────────────────────────────────────

  if (type.kind === 'array') {
    const elem = resolveType(ctx, type.elementType, seen);
    if (elem === type.elementType) return type;
    return { kind: 'array', elementType: elem, length: type.length };
  }
  if (type.kind === 'dynarray') {
    const elem = resolveType(ctx, type.elementType, seen);
    if (elem === type.elementType) return type;
    return { kind: 'dynarray', elementType: elem };
  }
  if (type.kind === 'pointer') {
    const target = resolveType(ctx, type.targetType, seen);
    if (target === type.targetType) return type;
    return { kind: 'pointer', targetType: target };
  }
  if (type.kind === 'function') {
    return {
      ...type,
      paramTypes: type.paramTypes.map(t => resolveType(ctx, t, seen)),
      returnTypes: type.returnTypes.map(t => resolveType(ctx, t, seen)),
    };
  }
  // type_param sin sustituir en un contexto donde no debería haberlo.
  if (type.kind === 'type_param') return type;
  return type;
}

// ─────────────────────────────────────────────────────────────────────
// structTypeFromRegistry / mathTypeFromRegistryName
// ─────────────────────────────────────────────────────────────────────

export function structTypeFromRegistry(ctx: SemanticContext, name: string): StructType {
  const cached = ctx.structCache.get(name);
  if (cached) return cached;
  const info = ctx.typeRegistry.getType(name);
  if (info.kind !== 'struct') throw new Error(`'${name}' no es un struct`);
  const st: StructType = { kind: 'struct', name, size: info.size, align: info.align, fields: [] };
  ctx.structCache.set(name, st);
  for (const field of info.fields ?? []) {
    st.fields.push({
      name: field.name,
      type: field.mathType ?? mathTypeFromRegistryName(ctx, field.type),
      offset: field.offset,
    });
  }
  return st;
}

export function mathTypeFromRegistryName(ctx: SemanticContext, name: string): MathType {
  switch (name) {
    case 'int':
    case 'i32': return 's32';
    case 'long':
    case 'i64': return 's64';
    case 'uint':
    case 'u32': return 'u32';
    case 'u64': return 'u64';
    case 'float':
    case 'f32': return 'f32';
    case 'double':
    case 'f64': return 'f64';
    case 'bool':
    case 'string': return name;
    case 'byte':
    case 'char':
    case 'i8':
    case 'u8':
    case 'i16':
    case 'u16': return 's32';
  }

  if (name.startsWith('[]')) {
    const elemName = name.slice(2);
    return { kind: 'dynarray', elementType: mathTypeFromRegistryName(ctx, elemName) };
  }

  if (name.startsWith('[') && name.endsWith(']')) {
    const inner = name.slice(1, -1);
    const semi = inner.lastIndexOf(';');
    if (semi === -1) throw new Error(`Nombre de array inválido: '${name}'`);
    const elemName = inner.slice(0, semi);
    const length = parseInt(inner.slice(semi + 1), 10);
    if (!Number.isInteger(length) || length <= 0) {
      throw new Error(`Longitud de array inválida en '${name}'`);
    }
    return { kind: 'array', elementType: mathTypeFromRegistryName(ctx, elemName), length };
  }

  const info = ctx.typeRegistry.getType(name);
  if (info.kind === 'struct') return structTypeFromRegistry(ctx, name);
  if (info.kind === 'array') {
    const elemName = info.elementType!;
    const length = info.length!;
    return { kind: 'array', elementType: mathTypeFromRegistryName(ctx, elemName), length };
  }
  if (info.pointerTo) {
    const targetName = info.pointerTo;
    const targetInfo = ctx.typeRegistry.getType(targetName);
    const targetType: MathType = targetInfo.kind === 'struct'
      ? { kind: 'struct', name: targetName, fields: [], size: targetInfo.size, align: targetInfo.align }
      : mathTypeFromRegistryName(ctx, targetName);
    return { kind: 'pointer', targetType };
  }
  throw new Error(`Tipo de campo no soportado: '${name}'`);
}

// ─────────────────────────────────────────────────────────────────────
// Tamaño de tipos
// ─────────────────────────────────────────────────────────────────────

export function computeTypeSize(ctx: SemanticContext, t: MathType, identName?: string): number {
  if (identName && ctx.typeRegistry.hasType(identName)) {
    return ctx.typeRegistry.getSize(identName);
  }
  if (t === 'null' || t === 'tuple') return 4;
  if (typeof t === 'string') {
    switch (t) {
      case 's32': case 'u32': case 'f32': case 'string': return 4;
      case 's64': case 'u64': case 'f64': return 8;
      case 'bool': return 1;
      default: {
        if (ctx.typeRegistry.hasType(t)) {
          return ctx.typeRegistry.getSize(t);
        }
        return 4;
      }
    }
  }
  if (t.kind === 'pointer' || t.kind === 'dynarray' || t.kind === 'function') {
    return 4;
  }
  if (t.kind === 'array') {
    return computeTypeSize(ctx, t.elementType) * t.length;
  }
  if (t.kind === 'struct') {
    if (t.size > 0) return t.size;
    if (t.name && ctx.typeRegistry.hasType(t.name)) {
      return ctx.typeRegistry.getSize(t.name);
    }
    if (t.fields && t.fields.length > 0) {
      const layout = computeStructLayout(
        ctx.typeRegistry,
        t.fields.map(f => ({
          name: f.name,
          type: registryTypeName(ctx, f.type),
          mathType: f.type,
        }))
      );
      return layout.size;
    }
    return 0;
  }
  if (t.kind === 'generic_instance') {
    // Instanciamos y medimos.
    const resolved = resolveType(ctx, t);
    return computeTypeSize(ctx, resolved);
  }
  return 4;
}

// ─────────────────────────────────────────────────────────────────────
// declaredTypeName — para diagnósticos e introspección
// ─────────────────────────────────────────────────────────────────────

export function declaredTypeName(type: MathType): string {
  if (typeof type === 'string') return type;
  switch (type.kind) {
    case 'struct':
      return type.name || `struct { ${type.fields
        .map(field => `${field.name} ${declaredTypeName(field.type)}`)
        .join('; ')} }`;
    case 'pointer':
      return `*${declaredTypeName(type.targetType)}`;
    case 'array':
      return `[${type.length}]${declaredTypeName(type.elementType)}`;
    case 'dynarray':
      return `[]${declaredTypeName(type.elementType)}`;
    case 'function': {
      const params = type.paramTypes.map((param, index) => {
        if (type.variadic && index === type.paramTypes.length - 1 &&
            typeof param === 'object' && param.kind === 'dynarray') {
          return `...${declaredTypeName(param.elementType)}`;
        }
        return declaredTypeName(param);
      });
      const returns = type.returnTypes.map(result => declaredTypeName(result));
      return `func(${params.join(', ')})${returns.length === 0
        ? ''
        : ` ${returns.length === 1 ? returns[0] : `(${returns.join(', ')})`}`}`;
    }
    case 'type_param':
      return type.name;
    case 'generic_instance':
      return `${type.baseName}<${type.typeArgs.map(declaredTypeName).join(', ')}>`;
  }
}

export function typeName(type: MathType): string {
  return describeType(type);
}

// ─────────────────────────────────────────────────────────────────────
// Instanciación de structs genéricos
// ─────────────────────────────────────────────────────────────────────

/**
 * Nombre canónico del registry para una instanciación genérica.
 * Consistente con `mangleType` del resto del pipeline.
 *
 *   `Vec<int>`       → `~G~Vec~i`
 *   `Pair<int, f64>` → `~G~Pair~i~F`
 */
export function genericInstanceName(baseName: string, typeArgs: MathType[]): string {
  return '~G~' + baseName + '~' + typeArgs.map(mangleType).join('~');
}

/**
 * Toma una plantilla de struct genérico y sus type args concretos,
 * produce la instanciación (sustituye `T → concreto` en cada campo),
 * la registra en el TypeRegistry y devuelve el StructType resultante.
 *
 * Cachea por nombre canónico: `Vec<int>` se instancia una sola vez.
 */
export function instantiateStruct(
  ctx: SemanticContext,
  template: StructDefNode,
  typeArgs: MathType[],
): StructType {
  const templateName = template.name;
  const typeParams = template.typeParams ?? [];

  if (typeArgs.length !== typeParams.length) {
    throw new Error(
      `'${templateName}' espera ${typeParams.length} type args, ` +
      `se recibieron ${typeArgs.length}`
    );
  }
// ctx.typeRegistry.registerStruct
  const instName = genericInstanceName(templateName, typeArgs);
  if (ctx.typeRegistry.hasType(instName)) {
    return structTypeFromRegistry(ctx, instName);
  }

  const bindings = new Map<string, MathType>();
  typeParams.forEach((p, i) => bindings.set(p, typeArgs[i]));

  const resolvedFields = template.fields.map(f => ({
    name: f.name,
    type: substituteType(f.type, bindings),
  }));

  // ── Detectar recursión por valor ──────────────────────────────────
  // Si un campo de la instanciación tiene el MISMO tipo que el struct
  // que estamos construyendo, el struct tendría tamaño infinito. Es un
  // error semántico, no un caso a resolver silenciosamente.
  for (const f of resolvedFields) {
    const regName = registryTypeName(ctx, f.type);
    if (regName === instName) {
      throw new Error(
        `El struct genérico '${templateName}' tiene un campo '${f.name}' ` +
        `de su propio tipo por valor, lo cual produciría un tamaño infinito. ` +
        `Usa un puntero ('*${templateName}<...>') en su lugar.`
      );
    }
  }
  // ───────────────────────────────────────────────────────────────────

    ctx.typeRegistry.registerStruct(
    instName,
    resolvedFields.map(f => {
      const regName = registryTypeName(ctx, f.type);
      if (typeof f.type === 'object' && f.type.kind === 'function') {
        return { name: f.name, type: regName, mathType: f.type };
      }
      return { name: f.name, type: regName };
    })
  );

  // ← acá va la línea nueva
  ctx.onStructInstantiated?.(ctx, templateName, typeArgs, instName);

  return structTypeFromRegistry(ctx, instName);
}