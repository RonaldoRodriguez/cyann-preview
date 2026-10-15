import type {
  StatementNode, FunctionDefNode, ImportDeclNode, MultiDeclNode,
} from '../parser';
import type {
  MathNode, MathType, FunctionType, StructType, CapturedVar, VariableNode,
  FunctionLiteralNode, PatternNode, MakeArrayNode, CallNode, StructAccessNode,
  SizeOfNode, ArenaForTypeNode,
} from '../types';
import { instantiateStruct } from './typeOps';
import type { SymbolInfo, FunctionOverload } from './symbols';
import type { SemanticContext, CaptureFrame } from './context';
import { mangleFunctionName } from '../mangler';
import { isArithmeticType, isIntegerType } from '../typeSystem';
import { findCapturedVars } from './captures';
import { allPathsReturn } from './controlFlow';
import { checkEscape, slotLevelOfTarget } from './escape';
import {
  resolveType, structTypeFromRegistry, canonicalizeAnonStruct,
  declaredTypeName, computeTypeSize, typeName,
} from './typeOps';
import {
  typesEqual, isAssignableType, isComparableType, contextualizeArrayLiteral,
  inferBinaryType, argTypesMatchExact, argTypesMatchStrict, argTypesMatchWithBridge,
  variadicArgumentsMatch, makeVariadicArray,
} from './typeCompat';
import { instantiateFunction } from './generics';
import { lookupMethod, registerMethod, isGenericReceiver } from './registration';
// case 'function_def': {
// ─────────────────────────────────────────────────────────────────────
// Statements
// ─────────────────────────────────────────────────────────────────────
export function analyzeStatement(ctx: SemanticContext, stmt: StatementNode): void {
  ctx.withLocation(stmt.sourceLocation, () => analyzeStatementAtLocation(ctx, stmt));
}
// case 'struct_literal'
function analyzeStatementAtLocation(ctx: SemanticContext, stmt: StatementNode): void {
  switch (stmt.kind) {
    case 'import_decl': {
      const id = stmt as ImportDeclNode;
      const paramTypes = id.params.map(p => resolveType(ctx, p.type));
      const fnType: FunctionType = {
        kind: 'function', paramTypes,
        returnTypes: id.returnType ? [resolveType(ctx, id.returnType)] : [],
      };
      ctx.scopeControl.declareFunction(id.name, id.name, fnType, true);
      break;
    }

    case 'module_import':
      break;

    case 'const_decl':
    case 'var_decl': {
      const isGlobal = ctx.scopeControl.isGlobal();
      const initType = stmt.initExpr
        ? resolveType(ctx, analyzeExpression(ctx, stmt.initExpr))
        : null;
      const declaredType = stmt.inferred ? null : resolveType(ctx, stmt.type);
      let finalType = declaredType ?? initType ?? resolveType(ctx, stmt.type);
      if (initType !== null && declaredType !== null &&
          !isAssignableType(ctx, initType, declaredType)) {
        const contextualized = stmt.initExpr !== null &&
          contextualizeArrayLiteral(ctx, stmt.initExpr, declaredType);
        if (contextualized) finalType = declaredType;
        else if (!(initType === 'null' && typeof declaredType === 'object')) {
          ctx.error(
            `Type mismatch: no se puede asignar ${typeName(initType)} a '${stmt.name}' ` +
            `de tipo ${typeName(declaredType)}`
          );
        }
      }

      stmt.type = finalType;
      const isBoxed = !isGlobal && (ctx.currentCapturedNames()?.has(stmt.name) ?? false);
      const uniqueName = ctx.scopeControl.declare(stmt.name, finalType, !stmt.isConst, isGlobal, isBoxed);
      (stmt as any).uniqueName = uniqueName;
      (stmt as any).isGlobal = isGlobal;
      if (isBoxed) (stmt as any).boxed = true;

      const slotLvl = isGlobal ? 0 : ctx.currentLevel;
      ctx.slotLevels.set(uniqueName, slotLvl);
      if (stmt.initExpr) {
        checkEscape(ctx, stmt.initExpr, slotLvl, `inicialización de '${stmt.name}'`);
      }
      break;
    }

    case 'short_var_decl': {
      const inferredType = resolveType(ctx, analyzeExpression(ctx, stmt.expr));
      const isBoxed = ctx.currentCapturedNames()?.has(stmt.name) ?? false;
      const uniqueName = ctx.scopeControl.declare(stmt.name, inferredType, true, false, isBoxed);
      (stmt as any).uniqueName = uniqueName;
      if (isBoxed) (stmt as any).boxed = true;
      ctx.slotLevels.set(uniqueName, ctx.currentLevel);
      checkEscape(ctx, stmt.expr, ctx.currentLevel, `:= '${stmt.name}'`);
      break;
    }

    case 'multi_decl': {
      const md = stmt as MultiDeclNode;
      const firstType = resolveType(ctx, analyzeExpression(ctx, md.expr));

      const returnTypes = (md.expr as any).returnTypes as MathType[] | undefined;
      if (!returnTypes || returnTypes.length === 0) {
        ctx.error(
          `multi-declaración requiere una llamada con múltiples valores ` +
          `de retorno; se obtuvo un valor de tipo ${typeName(firstType)}`
        );
        break;
      }
      if (returnTypes.length !== md.names.length) {
        ctx.error(
          `multi-declaración de ${md.names.length} nombres pero ` +
          `la expresión retorna ${returnTypes.length} valores`
        );
        break;
      }

      md.uniqueNames = [];
      for (let i = 0; i < md.names.length; i++) {
        if (md.names[i] === '_') {
          md.uniqueNames.push(null);
          continue;
        }
        const uniqueName = ctx.scopeControl.declare(
          md.names[i], returnTypes[i], true, false, false
        );
        md.uniqueNames.push(uniqueName);
        ctx.slotLevels.set(uniqueName, ctx.currentLevel);
      }
      break;
    }

    case 'assign': {
      let root: any = stmt.target;
      while (root.kind === 'struct_access' || root.kind === 'array_access' || root.kind === 'dereference') {
        root = root.base || root.expr;
      }

      if (root.kind !== 'variable' && root.kind !== 'capture_access') {
        ctx.error('El destino no es modificable');
        break;
      }

      if (root.kind === 'variable') {
        ctx.scopeControl.checkMutable(root.name);
        const slotLvl = slotLevelOfTarget(ctx, stmt.target);
        checkEscape(ctx, stmt.expr, slotLvl, `asignación a '${root.name}'`);
      }

      const targetType: MathType = resolveType(ctx, analyzeExpression(ctx, stmt.target));
      const exprType = resolveType(ctx, analyzeExpression(ctx, stmt.expr));

      if (!isAssignableType(ctx, exprType, targetType)) {
        const contextualized = contextualizeArrayLiteral(ctx, stmt.expr, targetType);
        if (!contextualized && !(exprType === 'null' && typeof targetType !== 'string')) {
          ctx.error(
            `Type mismatch en asignación: no se puede asignar ${typeName(exprType)} ` +
            `a un destino de tipo ${typeName(targetType)}`
          );
        }
      }

      break;
    }

        case 'function_def': {
      const fn = stmt as FunctionDefNode;
      // Skip de plantillas genéricas: ni funciones con type params propios
      // ni métodos cuyo receptor contenga type params (`[Vec<T>] func ...`).
      // Ambas se instancian on-demand cuando el struct o la función
      // concreta se materializa.
      const isTemplateMethod =
        fn.receiver != null && isGenericReceiver(fn.receiver);
      if (!isTemplateMethod && (!fn.typeParams || fn.typeParams.length === 0)) {
        analyzeFunction(ctx, fn);
      }
      break;
    }

    case 'struct_def':
    case 'type_alias':
      break;

    case 'if': {
      const condType = analyzeExpression(ctx, stmt.condition);
      if (condType !== 'bool') ctx.error('La condición del if debe ser bool');
      ctx.scopeControl.pushScope();
      for (const s of stmt.thenBlock) analyzeStatement(ctx, s);
      ctx.scopeControl.popScope();
      if (stmt.elseBlock) {
        ctx.scopeControl.pushScope();
        if (Array.isArray(stmt.elseBlock)) for (const s of stmt.elseBlock) analyzeStatement(ctx, s);
        else analyzeStatement(ctx, stmt.elseBlock);
        ctx.scopeControl.popScope();
      }
      break;
    }

    case 'for': {
      ctx.scopeControl.pushScope();
      if (stmt.init) analyzeStatement(ctx, stmt.init);
      if (stmt.condition) {
        const condType = analyzeExpression(ctx, stmt.condition);
        if (condType !== 'bool') ctx.error('La condición del for debe ser bool');
      }
      if (stmt.post) analyzeStatement(ctx, stmt.post);
      for (const s of stmt.body) analyzeStatement(ctx, s);
      ctx.scopeControl.popScope();
      break;
    }

    case 'for_in': {
      const iterableType = resolveType(ctx, analyzeExpression(ctx, stmt.iterable));
      if (typeof iterableType !== 'object' ||
          (iterableType.kind !== 'array' && iterableType.kind !== 'dynarray')) {
        ctx.error(`for ... in: se esperaba un array, se obtuvo ${typeName(iterableType)}`);
        break;
      }

      const names = stmt.varNames;
      if (names.length < 1 || names.length > 2) {
        ctx.error(`for ... in: se esperan 1 o 2 variables, se recibieron ${names.length}`);
        break;
      }

      let indexName: string | null = null;
      let valueName: string;
      if (names.length === 1) {
        valueName = names[0];
      } else {
        indexName = names[0];
        valueName = names[1];
      }

      ctx.scopeControl.pushScope();

      let indexUnique: string | null = null;
      if (indexName !== null && indexName !== '_') {
        indexUnique = ctx.scopeControl.declare(indexName, 's32', true, false);
        ctx.slotLevels.set(indexUnique, ctx.currentLevel);
      }

      let valueUnique: string | null = null;
      if (valueName !== '_') {
        valueUnique = ctx.scopeControl.declare(valueName, iterableType.elementType, true, false);
        ctx.slotLevels.set(valueUnique, ctx.currentLevel);
      }

      (stmt as any).indexUnique = indexUnique;
      (stmt as any).valueUnique = valueUnique;
      (stmt as any).elementType = iterableType.elementType;

      for (const s of stmt.body) analyzeStatement(ctx, s);
      ctx.scopeControl.popScope();
      break;
    }

    case 'switch': {
      const condType = resolveType(ctx, analyzeExpression(ctx, stmt.expr));
      stmt.exprType = condType;

      if (!isComparableType(condType)) {
        ctx.error(`switch: tipo no comparable (${typeName(condType)})`);
        break;
      }

      for (const c of stmt.cases) {
        for (const pattern of c.patterns) {
          analyzePattern(ctx, pattern, condType);
        }
        ctx.scopeControl.pushScope();
        for (const s of c.body) analyzeStatement(ctx, s);
        ctx.scopeControl.popScope();
      }
      if (stmt.defaultBody) {
        ctx.scopeControl.pushScope();
        for (const s of stmt.defaultBody) analyzeStatement(ctx, s);
        ctx.scopeControl.popScope();
      }
      break;
    }

    case 'region': {
      ctx.scopeControl.pushScope();
      ctx.currentLevel++;
      try {
        for (const s of stmt.body) analyzeStatement(ctx, s);
      } finally {
        ctx.currentLevel--;
        ctx.scopeControl.popScope();
      }
      break;
    }

    case 'break':
    case 'continue':
      break;

    case 'return': {
      const actualTypes = stmt.values.map(
        v => resolveType(ctx, analyzeExpression(ctx, v))
      );
      const expected = ctx.currentReturnTypes;
      if (expected.length === 0) {
        if (actualTypes.length > 0) {
          ctx.error(
            'La función no espera retorno de valores ' +
            actualTypes.map(e => typeName(e)).join(', ')
          );
        }
      } else {
        if (actualTypes.length !== expected.length) {
          ctx.error(
            `Se esperaban ${expected.length} valores de retorno, ` +
            `se recibieron ${actualTypes.length}`
          );
        } else {
          for (let i = 0; i < expected.length; i++) {
            if (!isAssignableType(ctx, actualTypes[i], expected[i])) {
              if (!(actualTypes[i] === 'null' && typeof expected[i] !== 'string')) {
                ctx.error(
                  `Tipo de retorno ${i} incorrecto: se esperaba ` +
                  `${typeName(expected[i])}, se obtuvo ${typeName(actualTypes[i])}`
                );
              }
            }
          }
        }
      }

      for (const v of stmt.values) checkEscape(ctx, v, 0, 'return');
      break;
    }

    case 'expression_stmt':
      analyzeExpression(ctx, stmt.expr);
      break;
  }
}


// if (isLambda) {
//    ctx.scopeControl.declareFunction(sourceName, mangledName, fnType, false);

// ─────────────────────────────────────────────────────────────────────
// Functions
// ─────────────────────────────────────────────────────────────────────
export function analyzeFunction(
  ctx: SemanticContext,
  fn: FunctionDefNode,
  forceGlobal = false,
): void {
  let receiverType: StructType | null = null;
  if (fn.receiver) {
    const rt = resolveType(ctx, fn.receiver);
    if (typeof rt !== 'object' || rt.kind !== 'struct') {
      ctx.error(
        `Receiver de '${fn.name}' debe ser un struct, se obtuvo ${typeName(rt)}`
      );
      return;
    }
    receiverType = rt;
  }

  if (receiverType) {
    for (const p of fn.params) {
      if (p.name === 'self') {
        ctx.error(
          `'self' está reservado como receiver en el método '${fn.name}'; ` +
          `renombrá el parámetro.`
        );
      }
    }
  }

  const parameterNames = new Set(fn.params.map(param => param.name));
  for (const param of fn.params) {
    if (!param.defaultValue) continue;
    if (referencesAnyParameter(param.defaultValue, parameterNames)) {
      ctx.error(
        `El valor por defecto de '${param.name}' no puede depender de parámetros de la función`,
      );
    }
    const checkedDefault = structuredClone(param.defaultValue);
    const defaultType = resolveType(ctx, analyzeExpression(ctx, checkedDefault));
    const paramType = resolveType(ctx, param.type);
    const bridge =
      (defaultType === 'string' && (paramType === 's32' || paramType === 'u32')) ||
      (paramType === 'string' && (defaultType === 's32' || defaultType === 'u32'));
    if (!isAssignableType(ctx, defaultType, paramType) && !bridge) {
      ctx.error(
        `Valor por defecto de '${param.name}': se esperaba ${typeName(paramType)}, ` +
        `se obtuvo ${typeName(defaultType)}`,
      );
    }
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

  const sourceName = fn.name;
  const isLambda = sourceName.startsWith('__lambda_');
  const mangledName = isLambda
    ? sourceName
    : mangleFunctionName(sourceName, allParamTypes, fnType.variadic);
  const defaultArgs = fn.params.flatMap(
    param => param.defaultValue ? [param.defaultValue] : [],
  );

    if (isLambda) {
    ctx.scopeControl.declareFunction(sourceName, mangledName, fnType, false);
  } else if (!receiverType) {
    ctx.scopeControl.declareFunction(
      sourceName, mangledName, fnType, forceGlobal || ctx.scopeControl.isGlobal(), defaultArgs,
    );
  } else if (forceGlobal) {
    // Método instanciado a partir de un template `[Vec<T>] func …`.
    // A diferencia de un método declarado directamente (que ya pasó por
    // `collectFunctions`), acá tenemos que registrarlo manualmente tanto
    // en scopeControl como en `methodsByStruct` para que se encuentre
    // cuando el caller haga `v.metodo()`.
    ctx.scopeControl.declareFunction(sourceName, mangledName, fnType, true, defaultArgs);
    registerMethod(ctx, receiverType.name, sourceName, mangledName, fnType, defaultArgs);
  }
  (fn as any).mangledName = mangledName;

  const prevReturn = ctx.currentReturnTypes;
  const prevLevel = ctx.currentLevel;
  ctx.currentReturnTypes = returnTypes;
  ctx.currentLevel = 0;

  ctx.scopeControl.pushScope();

  if (receiverType) {
    const selfUnique = ctx.scopeControl.declare(
      'self', receiverType, true, false, false
    );
    fn.params = [
      { name: 'self', type: receiverType, uniqueName: selfUnique },
      ...fn.params,
    ];
    ctx.slotLevels.set(selfUnique, 0);
  }

  const capturedNames = findCapturedVars(fn.params, fn.body);
  ctx.capturedNamesStack.push(capturedNames);

  const userParamStart = receiverType ? 1 : 0;
  for (let i = userParamStart; i < fn.params.length; i++) {
    const param = fn.params[i];
    const resolvedParamType = resolveType(ctx, param.type);
    const paramType = param.variadic
      ? { kind: 'dynarray' as const, elementType: resolvedParamType }
      : resolvedParamType;
    const isBoxed = capturedNames.has(param.name);
    const uniqueName = ctx.scopeControl.declare(
      param.name, paramType, true, false, isBoxed
    );
    (param as any).uniqueName = uniqueName;
    if (isBoxed) (param as any).boxed = true;
    ctx.slotLevels.set(uniqueName, 0);
  }

  for (const stmt of fn.body) analyzeStatement(ctx, stmt);

  if (fn.returnTypes.length > 0 && !allPathsReturn(fn.body)) {
    ctx.error(
      `La función '${sourceName}' no retorna en todos los caminos ` +
      `(se esperaba${returnTypes.length > 1 ? 'n ' : ' '}` +
      `${returnTypes.map(t => typeName(t)).join(', ')})`
    );
  }

  ctx.currentReturnTypes = prevReturn;
  ctx.currentLevel = prevLevel;
  ctx.scopeControl.popScope();
  ctx.capturedNamesStack.pop();

  fn.name = mangledName;
}

function referencesAnyParameter(value: unknown, parameterNames: Set<string>): boolean {
  if (Array.isArray(value)) {
    return value.some(item => referencesAnyParameter(item, parameterNames));
  }
  if (!value || typeof value !== 'object') return false;
  const node = value as Record<string, unknown>;
  if (
    node.kind === 'variable' &&
    typeof node.name === 'string' &&
    parameterNames.has(node.name)
  ) return true;
  return Object.values(node).some(child => referencesAnyParameter(child, parameterNames));
}

// ─────────────────────────────────────────────────────────────────────
// Switch patterns
// ─────────────────────────────────────────────────────────────────────
function analyzePattern(ctx: SemanticContext, pattern: PatternNode, targetType: MathType): void {
  const t = resolveType(ctx, targetType);

  switch (pattern.kind) {
    case 'wildcard':
      return;

    case 'const': {
      if (pattern.type === 'null') {
        if (!(typeof t === 'object' &&
              (t.kind === 'pointer' || t.kind === 'struct' ||
               t.kind === 'dynarray' || t.kind === 'function'))) {
          ctx.error(`Patrón null no válido para tipo ${typeName(t)}`);
        }
        return;
      }
      if (!isArithmeticType(t)) {
        ctx.error(`Patrón numérico no válido para tipo ${typeName(t)}`);
        return;
      }
      return;
    }

    case 'string':
      if (t !== 'string') {
        ctx.error(`Patrón string no válido para tipo ${typeName(t)}`);
      }
      return;

    case 'bool':
      if (t !== 'bool') {
        ctx.error(`Patrón bool no válido para tipo ${typeName(t)}`);
      }
      return;

    case 'struct': {
      if (typeof t !== 'object' || t.kind !== 'struct') {
        ctx.error(`Patrón struct no válido para tipo ${typeName(t)}`);
        return;
      }
      if (t.name !== pattern.structName) {
        ctx.error(`Patrón struct '${pattern.structName}' no coincide con '${t.name}'`);
        return;
      }
      const provided = new Set(pattern.fields.map(f => f.name));
      for (const fp of pattern.fields) {
        const field = t.fields.find(f => f.name === fp.name);
        if (!field) {
          ctx.error(`Campo '${fp.name}' no existe en '${t.name}'`);
          continue;
        }
        analyzePattern(ctx, fp.pattern, field.type);
      }
      const missing = t.fields.filter(f => !provided.has(f.name)).map(f => f.name);
      if (missing.length > 0) {
        ctx.error(
          `Faltan campos en patrón '${t.name}': ${missing.join(', ')}. ` +
          `Usa '_' como wildcard para los que no te importan.`
        );
      }
      return;
    }
  }
}

// ─────────────────────────────────────────────────────────────────────
// Expressions
// ─────────────────────────────────────────────────────────────────────
export function analyzeExpression(ctx: SemanticContext, node: MathNode): MathType {
  switch (node.kind) {
    case 'const': return node.type === 'null' ? 'null' : node.type;

    case 'variable': {
      let lookup: { info: SymbolInfo; isCapture: boolean };
      try {
        lookup = ctx.scopeControl.lookupWithBoundary(node.name);
      } catch (e) {
        ctx.error(`Identificador no definido: '${node.name}'`);
        node.type = 's32';
        return 's32';
      }
      const { info: symbol, isCapture } = lookup;

      if (symbol.isFunctionDecl) {
        const ovs = symbol.overloads!;
        if (ovs.length !== 1) {
          ctx.error(`'${node.name}' tiene ${ovs.length} sobrecargas; especifica los tipos para usarla como valor`);
          node.type = 's32';
          return 's32';
        }
        (node as any).kind = 'function_ref';
        (node as any).name = ovs[0].mangledName;
        (node as any).type = ovs[0].type;
        delete (node as any).isGlobal;
        delete (node as any).uniqueName;
        return ovs[0].type;
      }

      if (isCapture && !symbol.isGlobal && ctx.captureStack.length > 0) {
        const frame = ctx.captureStack[ctx.captureStack.length - 1];
        let cap = frame.captures.get(symbol.uniqueName);
        if (!cap) {
          cap = {
            name: node.name,
            sourceUniqueName: symbol.uniqueName,
            type: symbol.type,
            index: frame.captures.size,
            boxed: !!symbol.boxed,
          };
          frame.captures.set(symbol.uniqueName, cap);
        }
        (node as any).kind = 'capture_access';
        (node as any).captureIndex = cap.index;
        (node as any).type = cap.type;
        delete (node as any).name;
        delete (node as any).uniqueName;
        delete (node as any).isGlobal;
        return cap.type;
      }

      (node as any).uniqueName = symbol.uniqueName;
      (node as any).isGlobal = symbol.isGlobal;
      if (symbol.boxed) (node as any).boxed = true;
      node.type = symbol.type;
      return node.type;
    }

    case 'string': return 'string';
    case 'bool': return 'bool';

    case 'capture_access':
      return node.type;

    case 'unary': {
      const operandType = analyzeExpression(ctx, node.operand);
      if (node.op === 'not' && operandType !== 'bool') {
        ctx.error("El operador '!' requiere un bool");
      }
      if (node.op === 'bitnot' && !isIntegerType(operandType)) {
        ctx.error("El operador '~' requiere un tipo entero");
      }
      if (node.op === 'neg' && !isArithmeticType(operandType)) {
        ctx.error("La negación requiere un tipo numérico");
      }
      node.type = operandType;
      return operandType;
    }

    case 'binary': {
      const leftType = analyzeExpression(ctx, node.left);
      const rightType = analyzeExpression(ctx, node.right);
      const result = inferBinaryType(ctx, node.op, leftType, rightType);
      node.type = result;
      return result;
    }

    case 'interpolated_string': {
      for (const part of node.parts) {
        if (typeof part === 'string') continue;
        const partType = resolveType(ctx, analyzeExpression(ctx, part));

        const isPointer = (typeof partType === 'object' && partType !== null && partType.kind === 'pointer') ||
                          (typeof partType === 'string' && partType.endsWith('*'));

        if ('type' in part && part.type === 'void') {
          ctx.error('No se puede interpolar una expresión sin valor');
        } else if (
          partType !== 'string' &&
          partType !== 'bool' &&
          partType !== 's32' &&
          partType !== 'u32' &&
          !isPointer
        ) {
          ctx.error(
            `Tipo no compatible con interpolación: ${typeName(partType)}. ` +
            'Se admiten string, bool, int/s32, u32 y punteros.',
          );
        }
      }
      node.type = 'string';
      return 'string';
    }

    case 'cast': {
      const from = resolveType(ctx, analyzeExpression(ctx, node.operand));
      node.oldType = from;
      const to = resolveType(ctx, node.newType);
      if (typesEqual(ctx, from, to)) return to;
      const stringBridge =
        (from === 'string' && (to === 's32' || to === 'u32')) ||
        (to === 'string' && (from === 's32' || from === 'u32')) ||
        (from === 'string' && typeof to === 'object' && to.kind === 'pointer') ||
        (to === 'string' && typeof from === 'object' && from.kind === 'pointer');
      if (stringBridge) return to;
      const boolBridge =
        (from === 'bool' && (to === 's32' || to === 'u32')) ||
        (to === 'bool' && (from === 's32' || from === 'u32'));
      if (boolBridge) return to;
      if (isArithmeticType(from) && isArithmeticType(to)) return to;

      const fromPointer = typeof from === 'object' && from.kind === 'pointer';
      const toPointer = typeof to === 'object' && to.kind === 'pointer';
      const fromStruct = typeof from === 'object' && from.kind === 'struct';
      const toStruct = typeof to === 'object' && to.kind === 'struct';

      if (fromPointer && (toPointer || toStruct || isIntegerType(to))) return to;
      if (toPointer && (fromPointer || fromStruct || isIntegerType(from))) return to;

      if (typeof from === 'object' && from.kind === 'struct' && ctx.structCache.has(from.name) && (to === 's32')) return to;
      if ((from === 's32') && typeof to === 'object' && to.kind === 'struct' && ctx.structCache.has(to.name)) return to;
      if ((to === 's32') && typeof from === 'object' && from.kind === 'dynarray') return to;

      ctx.error(`cast no soportado: ${typeName(from)} → ${typeName(to)}`);
      return to;
    }

    case 'make_array': {
      const n = node as MakeArrayNode;
      const resolvedType = resolveType(ctx, n.typeExpr);
      if (typeof resolvedType !== 'object' || resolvedType.kind !== 'dynarray') {
        ctx.error(
          `make() requiere un dynarray, se obtuvo ${typeName(resolvedType)}`
        );
        return 's32';
      }
      const lenType = analyzeExpression(ctx, n.lengthExpr);
      if (lenType !== 's32' && lenType !== 'u32') {
        ctx.error('make() requiere longitud entera');
      }
      n.elementType = resolvedType.elementType;
      n.type = resolvedType;
      return resolvedType;
    }

    case 'call': {
      // ── NUEVO: instanciación genérica `foo<int>(x)` ────────────────
      if (node.typeArgs && node.typeArgs.length > 0) {
        const template = ctx.genericFunctions.get(node.name);
        if (!template) {
          ctx.error(`'${node.name}' no es una función genérica`);
          return 's32';
        }
        instantiateFunction(ctx, template, node.typeArgs, analyzeFunction);
        delete node.typeArgs;
        // No tocamos node.name: el overload de la instancia queda
        // registrado bajo el source name, y la resolución de abajo lo
        // encuentra por tipos de argumento.
      }
      // ───────────────────────────────────────────────────────────────

      if (node.name === 'is_same' && node.args.length === 2 && !ctx.scopeControl.has('is_same')) {
        const at1 = resolveType(ctx, analyzeExpression(ctx, node.args[0]));
        const at2 = resolveType(ctx, analyzeExpression(ctx, node.args[1]));

        if (at1 === 'null' && at2 === 'null') {
          node.paramTypes = ['null', 'null'];
          node.type = 'bool';
          node.resolvedBuiltin = 'is_same';
          return 'bool';
        }

        let common: MathType;
        if (at1 === 'null') common = at2;
        else if (at2 === 'null') common = at1;
        else if (typesEqual(ctx, at1, at2)) common = at1;
        else {
          ctx.error(
            `is_same: los dos args deben ser del mismo tipo ` +
            `(${typeName(at1)} vs ${typeName(at2)})`
          );
          return 's32';
        }

        const isRef = typeof common === 'string'
          ? (common === 'string')
          : (common.kind === 'struct' || common.kind === 'pointer' ||
             common.kind === 'dynarray' || common.kind === 'function');
        if (!isRef) {
          ctx.error(
            `is_same requiere un tipo referencia (struct, pointer, ` +
            `dynarray, string, fn); se obtuvo ${typeName(common)}. ` +
            `Usa '==' para primitivos.`
          );
          return 's32';
        }

        node.paramTypes = [common, common];
        node.type = 'bool';
        node.resolvedBuiltin = 'is_same';
        return 'bool';
      }
      if (node.name === 'key_values' && !ctx.scopeControl.has('key_values')) {
        const argument = node.args[0];
        if (node.args.length !== 1 || argument.kind !== 'variable') {
          ctx.error('key_values() espera un tipo struct o una variable struct');
          return 's32';
        }

        let declaredType: MathType;
        if (ctx.scopeControl.has(argument.name)) {
          declaredType = resolveType(ctx, analyzeExpression(ctx, argument));
        } else if (ctx.typeAliases.has(argument.name) || ctx.structDefinitions.has(argument.name)) {
          declaredType = ctx.typeAliases.get(argument.name) ??
            ({ kind: 'struct', name: argument.name, fields: [], size: 0, align: 1 } as StructType);
          declaredType = resolveType(ctx, declaredType);
        } else {
          ctx.error(
            `key_values(): '${argument.name}' no es un tipo struct ni una variable struct`
          );
          return 's32';
        }

        if (typeof declaredType !== 'object' || declaredType.kind !== 'struct') {
          ctx.error(
            `key_values(): '${argument.name}' no es un tipo struct ni una variable struct`
          );
          return 's32';
        }

        const definition = ctx.structDefinitions.get(declaredType.name);
        if (!definition) {
          ctx.error(`key_values(): no se encontró la definición de '${argument.name}'`);
          return 's32';
        }

        node.resolvedBuiltin = {
          kind: 'key_values',
          fields: definition.fields.map(field => ({
            name: field.name,
            typeName: field.declaredTypeName ?? declaredTypeName(field.type),
          })),
        };
        node.paramTypes = [];
        node.type = {
          kind: 'dynarray',
          elementType: {
            kind: 'dynarray',
            elementType: 'string',
          },
        };
        return node.type;
      }
      if (node.name === 'len' && node.args.length === 1 && !ctx.scopeControl.has('len')) {
        const at = resolveType(ctx, analyzeExpression(ctx, node.args[0]));
        if (typeof at !== 'object' || (at.kind !== 'array' && at.kind !== 'dynarray')) {
          ctx.error(`len() requiere un array/dynarray, se obtuvo ${typeName(at)}`);
          return 's32';
        }
        node.paramTypes = [at];
        node.type = 's32';
        node.resolvedBuiltin = { kind: 'len', argumentType: at };
        return 's32';
      }

      const argTypes: MathType[] = [];
      for (const arg of node.args) argTypes.push(resolveType(ctx, analyzeExpression(ctx, arg)));

      if (!ctx.scopeControl.has(node.name)) {
        ctx.error(`Identificador no definido: '${node.name}'`);
        return 's32';
      }
      const sym = ctx.scopeControl.lookup(node.name);

      if (sym.isFunctionDecl) {
        const overloads = sym.overloads!;
        let chosen: FunctionOverload | undefined;
        const exactArity = overloads.filter(
          ov => !ov.type.variadic &&
            ov.type.paramTypes.length === argTypes.length &&
            argTypesMatchExact(ctx, ov.type.paramTypes, argTypes),
        );
        const bridgedArity = exactArity.length > 0
          ? []
          : overloads.filter(
            ov => !ov.type.variadic &&
              ov.type.paramTypes.length === argTypes.length &&
              argTypesMatchWithBridge(ctx, ov.type.paramTypes, argTypes),
          );
        if (exactArity.length > 0) chosen = exactArity[0];
        else if (bridgedArity.length > 0) chosen = bridgedArity[0];

        let optionalMatches: FunctionOverload[] = [];
        if (!chosen) {
          optionalMatches = overloads.filter(ov => {
            if (ov.type.variadic) return false;
            const requiredCount = ov.type.paramTypes.length - ov.defaultArgs.length;
            return argTypes.length >= requiredCount &&
              argTypes.length < ov.type.paramTypes.length &&
              argTypesMatchStrict(ctx, ov.type.paramTypes.slice(0, argTypes.length), argTypes);
          });
          if (optionalMatches.length === 0) {
            optionalMatches = overloads.filter(ov => {
              if (ov.type.variadic) return false;
              const requiredCount = ov.type.paramTypes.length - ov.defaultArgs.length;
              return argTypes.length >= requiredCount &&
                argTypes.length < ov.type.paramTypes.length &&
                argTypesMatchExact(ctx, ov.type.paramTypes.slice(0, argTypes.length), argTypes);
            });
          }
          if (optionalMatches.length === 0) {
            optionalMatches = overloads.filter(ov => {
              if (ov.type.variadic) return false;
              const requiredCount = ov.type.paramTypes.length - ov.defaultArgs.length;
              return argTypes.length >= requiredCount &&
                argTypes.length < ov.type.paramTypes.length &&
                argTypesMatchWithBridge(ctx, ov.type.paramTypes.slice(0, argTypes.length), argTypes);
            });
          }
          if (optionalMatches.length === 1) chosen = optionalMatches[0];
        }
        if (!chosen && optionalMatches.length > 1) {
          ctx.error(`Llamada ambigua a '${node.name}': varias sobrecargas aceptan esos argumentos`);
          return 's32';
        }
        if (!chosen) {
          const variadicMatches = (
            matcher: (params: MathType[], args: MathType[]) => boolean,
          ): FunctionOverload[] => overloads.filter(ov =>
            variadicArgumentsMatch(
              ctx,
              ov.type.paramTypes,
              argTypes,
              ov.type.variadic === true,
              (param, arg) => matcher([param], [arg]),
            ),
          );
          let matches = variadicMatches((params, args) => argTypesMatchStrict(ctx, params, args));
          if (matches.length === 0) {
            matches = variadicMatches((params, args) => argTypesMatchExact(ctx, params, args));
          }
          if (matches.length === 0) {
            matches = variadicMatches((params, args) => argTypesMatchWithBridge(ctx, params, args));
          }
          if (matches.length === 1) chosen = matches[0];
          else if (matches.length > 1) {
            ctx.error(`Llamada ambigua a '${node.name}': varias sobrecargas variádicas aceptan esos argumentos`);
            return 's32';
          }
        }
        if (!chosen) {
          ctx.error(
            `Ninguna sobrecarga de '${node.name}' coincide con ` +
            `[${argTypes.map(t => typeName(t)).join(', ')}]`
          );
          return 's32';
        }
        const missingCount = chosen.type.variadic
          ? 0
          : chosen.type.paramTypes.length - argTypes.length;
        if (missingCount > 0) {
          const defaults = chosen.defaultArgs.slice(-missingCount);
          for (const defaultValue of defaults) {
            const argument = structuredClone(defaultValue);
            node.args.push(argument);
            argTypes.push(resolveType(ctx, analyzeExpression(ctx, argument)));
          }
        }
        const fixedCount = chosen.type.variadic
          ? chosen.type.paramTypes.length - 1
          : argTypes.length;
        for (let i = 0; i < argTypes.length; i++) {
          const at = argTypes[i];
          const paramIndex = i < fixedCount ? i : chosen.type.paramTypes.length - 1;
          const declaredType = resolveType(ctx, chosen.type.paramTypes[paramIndex]);
          const et = i < fixedCount || !chosen.type.variadic
            ? declaredType
            : (declaredType as Extract<MathType, { kind: 'dynarray' }>).elementType;
          const bridge =
            (at === 'string' && (et === 's32' || et === 'u32')) ||
            (et === 'string' && (at === 's32' || at === 'u32'));
          if (!isAssignableType(ctx, at, et) && !bridge) {
            ctx.error(
              `Argumento ${i} de '${node.name}': se esperaba ` +
              `${typeName(et)}, se obtuvo ${typeName(at)}`
            );
          }
        }
        if (chosen.type.variadic) {
          const fixedArgs = node.args.slice(0, fixedCount);
          const variadicArgs = node.args.slice(fixedCount);
          const finalType = resolveType(
            ctx,
            chosen.type.paramTypes[chosen.type.paramTypes.length - 1],
          ) as Extract<MathType, { kind: 'dynarray' }>;
          node.args = [...fixedArgs, makeVariadicArray(variadicArgs, finalType.elementType)];
        }
        node.name = chosen.mangledName;
        node.paramTypes = chosen.type.paramTypes;
        node.variadic = chosen.type.variadic;
        node.returnTypes = chosen.type.returnTypes;
        const returnType = chosen.type.returnTypes[0];
        if (returnType === undefined) { node.type = 'void'; return 's32'; }
        node.type = returnType;
        return returnType;
      }

      if (typeof sym.type === 'object' && sym.type.kind === 'function') {
        const calleeVar: MathNode = { kind: 'variable', name: node.name, type: 's32' };
        const calleeType = resolveType(ctx, analyzeExpression(ctx, calleeVar)) as FunctionType;
        const params = calleeType.paramTypes.map(t => resolveType(ctx, t));
        if (!variadicArgumentsMatch(
          ctx,
          params,
          argTypes,
          calleeType.variadic === true,
          (param, arg) => {
            const bridge =
              (arg === 'string' && (param === 's32' || param === 'u32')) ||
              (param === 'string' && (arg === 's32' || arg === 'u32'));
            return isAssignableType(ctx, arg, param) || bridge;
          },
        )) {
          ctx.error(
            `Llamada indirecta a '${node.name}': la cantidad o los tipos de argumentos ` +
            `no coinciden con la firma ` +
            `[${params.map(t => typeName(t)).join(', ')}]` +
            `${calleeType.variadic ? ' (variádica)' : ''}; ` +
            `se recibieron ${argTypes.length} argumentos`
          );
          return 's32';
        }
        for (let i = 0; i < argTypes.length; i++) {
          const fixedCount = calleeType.variadic ? params.length - 1 : params.length;
          const param = i < fixedCount ? params[i] : params[params.length - 1];
          const et = i < fixedCount || !calleeType.variadic
            ? param
            : (param as Extract<MathType, { kind: 'dynarray' }>).elementType;
          const at = argTypes[i];
          const bridge =
            (at === 'string' && (et === 's32' || et === 'u32')) ||
            (et === 'string' && (at === 's32' || at === 'u32'));
          if (!isAssignableType(ctx, at, et) && !bridge) {
            ctx.error(
              `Argumento ${i} de la llamada indirecta a '${node.name}': ` +
              `se esperaba ${typeName(et)}, se obtuvo ${typeName(at)}`
            );
          }
        }
        if (calleeType.variadic) {
          const fixedCount = params.length - 1;
          const dynarray = params[params.length - 1] as Extract<MathType, { kind: 'dynarray' }>;
          node.args = [
            ...node.args.slice(0, fixedCount),
            makeVariadicArray(node.args.slice(fixedCount), dynarray.elementType),
          ];
        }
        const c = node as any;
        c.kind = 'call_indirect';
        c.callee = calleeVar;
        c.paramTypes = calleeType.paramTypes;
        c.returnTypes = calleeType.returnTypes;
        c.variadic = calleeType.variadic;
        const returnType = calleeType.returnTypes[0];
        delete c.name;
        if (returnType === undefined) { c.type = 'void'; return 's32'; }
        c.type = returnType;
        return returnType;
      }
      ctx.error(`'${node.name}' no es una función`);
      return 's32';
    }

    case 'dereference': {
      const ptrType = resolveType(ctx, analyzeExpression(ctx, node.expr));

      if (typeof ptrType !== 'object' || ptrType.kind !== 'pointer') {
        ctx.error(`No se puede desreferenciar una expresión que no es un puntero (tipo recibido: ${typeName(ptrType)})`);
        node.type = 's32';
        return 's32';
      }

      node.type = ptrType.targetType;
      return ptrType.targetType;
    }

    case 'call_indirect': {
      if (node.callee.kind === 'struct_access') {
        const sa = node.callee as StructAccessNode;
        const baseTypeRaw = resolveType(ctx, analyzeExpression(ctx, sa.base));
        const baseType = typeof baseTypeRaw === 'object' && baseTypeRaw.kind === 'pointer'
          ? resolveType(ctx, baseTypeRaw.targetType)
          : baseTypeRaw;

        if (typeof baseType === 'object' && baseType.kind === 'struct' && baseType.name !== '') {
          const field = baseType.fields.find(c => c.name === sa.fieldName);
          if (!field) {
            const method = lookupMethod(ctx, baseType.name, sa.fieldName);
            if (method) {
              const argTypes: MathType[] = [];
              for (const arg of node.args) {
                argTypes.push(resolveType(ctx, analyzeExpression(ctx, arg)));
              }
              const expected = method.type.paramTypes.slice(1);
              const fixedCount = method.type.variadic ? expected.length - 1 : expected.length;
              const requiredCount = fixedCount - method.defaultArgs.length;
              const argumentMatches = (param: MathType, arg: MathType): boolean => {
                const bridge =
                  (arg === 'string' && (param === 's32' || param === 'u32')) ||
                  (param === 'string' && (arg === 's32' || arg === 'u32'));
                return isAssignableType(ctx, arg, param) || bridge;
              };
              const matchesArguments = method.type.variadic
                ? variadicArgumentsMatch(ctx, expected, argTypes, true, argumentMatches)
                : argTypes.length >= requiredCount &&
                  argTypes.length <= expected.length &&
                  expected.slice(0, argTypes.length).every((param, index) =>
                    argumentMatches(param, argTypes[index]));
              if (!matchesArguments ||
                  (!method.type.variadic && argTypes.length > expected.length) ||
                  argTypes.length < requiredCount) {
                ctx.error(
                  `Método '${sa.fieldName}' de '${baseType.name}': ` +
                  (method.type.variadic
                    ? `se esperaban al menos ${requiredCount} argumentos, `
                    : `se esperaban entre ${requiredCount} y ${expected.length} argumentos, `) +
                  `se recibieron ${argTypes.length}`
                );
                return 's32';
              }
              const missingCount = method.type.variadic
                ? 0
                : expected.length - argTypes.length;
              if (missingCount > 0) {
                for (const defaultValue of method.defaultArgs.slice(-missingCount)) {
                  const argument = structuredClone(defaultValue);
                  node.args.push(argument);
                  argTypes.push(resolveType(ctx, analyzeExpression(ctx, argument)));
                }
              }
              for (let i = 0; i < argTypes.length; i++) {
                const declaredType = expected[i < fixedCount ? i : expected.length - 1];
                const expectedType = i < fixedCount || !method.type.variadic
                  ? declaredType
                  : (declaredType as Extract<MathType, { kind: 'dynarray' }>).elementType;
                const bridge =
                  (argTypes[i] === 'string' && (expectedType === 's32' || expectedType === 'u32')) ||
                  (expectedType === 'string' && (argTypes[i] === 's32' || argTypes[i] === 'u32'));
                if (!isAssignableType(ctx, argTypes[i], expectedType) && !bridge) {
                  ctx.error(
                    `Argumento ${i} de '${sa.fieldName}': se esperaba ` +
                    `${typeName(expectedType)}, se obtuvo ${typeName(argTypes[i])}`
                  );
                }
              }

              let methodArgs = [...node.args];
              if (method.type.variadic) {
                const lastType = expected[expected.length - 1] as Extract<MathType, { kind: 'dynarray' }>;
                methodArgs = [
                  ...node.args.slice(0, fixedCount),
                  makeVariadicArray(node.args.slice(fixedCount), lastType.elementType),
                ];
              }
              const newCall: any = node;
              newCall.kind = 'call';
              newCall.name = method.mangledName;
              newCall.args = [sa.base, ...methodArgs];
              newCall.paramTypes = [baseTypeRaw, ...method.type.paramTypes.slice(1)];
              newCall.returnTypes = method.type.returnTypes;
              newCall.variadic = method.type.variadic;
              newCall.type = method.type.returnTypes[0] ?? 'void';
              return newCall.type;
            }

            ctx.error(`Campo '${sa.fieldName}' no existe en '${baseType.name}'`);
            return 's32';
          }
        }
      }

      const calleeType = resolveType(ctx, analyzeExpression(ctx, node.callee));
      if (typeof calleeType !== 'object' || calleeType.kind !== 'function') {
        ctx.error('call_indirect: el callee no es de tipo función');
        return 's32';
      }
      const fnType = calleeType as FunctionType;
      const params = fnType.paramTypes.map(t => resolveType(ctx, t));
      const argTypes = node.args.map(arg => resolveType(ctx, analyzeExpression(ctx, arg)));
      const matchesArguments = variadicArgumentsMatch(
        ctx,
        params,
        argTypes,
        fnType.variadic === true,
        (param, arg) => {
          const bridge =
            (arg === 'string' && (param === 's32' || param === 'u32')) ||
            (param === 'string' && (arg === 's32' || arg === 'u32'));
          return isAssignableType(ctx, arg, param) || bridge;
        },
      );
      if (!matchesArguments) {
        ctx.error(
          `Llamada indirecta: cantidad o tipos de argumentos incompatibles con ` +
          `la firma [${params.map(t => typeName(t)).join(', ')}]` +
          `${fnType.variadic ? ' (variádica)' : ''}; ` +
          `se recibieron ${node.args.length}`
        );
        return 's32';
      }

      const fixedCount = fnType.variadic ? params.length - 1 : params.length;
      for (let i = 0; i < argTypes.length; i++) {
        const declaredType = params[i < fixedCount ? i : params.length - 1];
        const et = i < fixedCount || !fnType.variadic
          ? declaredType
          : (declaredType as Extract<MathType, { kind: 'dynarray' }>).elementType;
        const at = argTypes[i];
        const bridge =
          (at === 'string' && (et === 's32' || et === 'u32')) ||
          (et === 'string' && (at === 's32' || at === 'u32'));
        if (!isAssignableType(ctx, at, et) && !bridge) {
          ctx.error(
            `Argumento ${i} de la llamada indirecta: se esperaba ` +
            `${typeName(et)}, se obtuvo ${typeName(at)}`
          );
        }
      }

      if (fnType.variadic) {
        const dynarray = params[params.length - 1] as Extract<MathType, { kind: 'dynarray' }>;
        node.args = [
          ...node.args.slice(0, fixedCount),
          makeVariadicArray(node.args.slice(fixedCount), dynarray.elementType),
        ];
      }
      node.paramTypes = fnType.paramTypes;
      node.returnTypes = fnType.returnTypes;
      node.variadic = fnType.variadic;
      const returnType = fnType.returnTypes[0];
      if (returnType === undefined) { node.type = 'void'; return 's32'; }
      node.type = returnType;
      return returnType;
    }

    case 'function_literal': {
      const fnNode = node as FunctionLiteralNode;

      const paramTypes = fnNode.params.map(p => {
        const type = resolveType(ctx, p.type);
        return p.variadic ? { kind: 'dynarray' as const, elementType: type } : type;
      });
      const returnTypes = fnNode.returnTypes
        ? fnNode.returnTypes.map(t => resolveType(ctx, t))
        : [];
      const fnType: FunctionType = {
        kind: 'function',
        paramTypes,
        returnTypes,
        variadic: fnNode.params.some(param => param.variadic),
      };

      const name = `__lambda_${ctx.lambdaCounter++}`;
      ctx.scopeControl.declareFunction(name, name, fnType, false);

      const prevReturn = ctx.currentReturnTypes;
      const prevLevel = ctx.currentLevel;
      ctx.currentReturnTypes = returnTypes;

      const frame: CaptureFrame = { captures: new Map() };
      ctx.captureStack.push(frame);
      ctx.scopeControl.pushLambdaBoundary();
      ctx.scopeControl.pushScope();

      for (const p of fnNode.params) {
        const paramType = resolveType(ctx, p.type);
        const declaredType = p.variadic
          ? { kind: 'dynarray' as const, elementType: paramType }
          : paramType;
        const uniqueName = ctx.scopeControl.declare(p.name, declaredType, true, false);
        p.uniqueName = uniqueName;
        ctx.slotLevels.set(uniqueName, prevLevel);
      }
      for (const s of fnNode.body) analyzeStatement(ctx, s as StatementNode);

      ctx.scopeControl.popScope();
      ctx.scopeControl.popLambdaBoundary();
      ctx.captureStack.pop();

      if (fnNode.returnTypes.length > 0 && !allPathsReturn(fnNode.body as StatementNode[])) {
        ctx.error(
          `La lambda '${name}' no retorna en todos los caminos ` +
          `(se esperaba${returnTypes.length > 1 ? 'n ' : ' '}` +
          `${returnTypes.map(t => typeName(t)).join(', ')})`
        );
      }

      ctx.currentReturnTypes = prevReturn;
      ctx.currentLevel = prevLevel;

      ctx.hoistedFunctions.push({
        kind: 'function_def',
        name,
        params: fnNode.params,
        returnTypes: fnNode.returnTypes,
        body: fnNode.body as StatementNode[],
        mangledName: name,
      });

      const captures: CapturedVar[] = [];
      for (const cap of frame.captures.values()) captures.push(cap);
      captures.sort((a, b) => a.index - b.index);

      const captureExprs: MathNode[] = captures.map(cap => ({
        kind: 'variable',
        name: cap.name,
        uniqueName: cap.sourceUniqueName,
        isGlobal: false,
        type: cap.type,
      } as VariableNode));

      (node as any).kind = 'closure';
      (node as any).codeName = name;
      (node as any).captures = captures;
      (node as any).captureExprs = captureExprs;
      (node as any).type = fnType;
      delete (node as any).params;
      delete (node as any).returnTypes;
      delete (node as any).body;

      return fnType;
    }

    case 'closure':
      return node.type;

    case 'struct_literal': {
      const structName = (node as any).structName as string;
      const typeArgs = (node as any).typeArgs as MathType[] | undefined;

      if (structName === '__anon') {
        const inferredFields: { name: string; type: MathType }[] = [];
        const provided = new Set<string>();
        for (const field of node.fields) {
          if (provided.has(field.name)) {
            ctx.error(`Campo '${field.name}' repetido en struct anónimo`);
            continue;
          }
          provided.add(field.name);
          const t = resolveType(ctx, analyzeExpression(ctx, field.value));
          inferredFields.push({ name: field.name, type: t });
        }
        const canonical = canonicalizeAnonStruct(ctx, inferredFields);
        (node as any).structName = canonical;
        const st = structTypeFromRegistry(ctx, canonical);
        node.type = st;
        return st;
      }

      // ── Struct genérico: instanciar antes de validar campos ─────
      let structType: StructType;
      if (typeArgs && typeArgs.length > 0) {
        const template = ctx.genericStructs.get(structName);
        if (!template) {
          ctx.error(`'${structName}' no es un struct genérico`);
          node.type = { kind: 'struct', name: structName, fields: [], size: 0, align: 1 };
          return node.type;
        }
        const resolvedArgs = typeArgs.map(t => resolveType(ctx, t));
        structType = instantiateStruct(ctx, template, resolvedArgs);
      } else {
        structType = structTypeFromRegistry(ctx, structName);
      }
      // ─────────────────────────────────────────────────────────────

      const providedFields = new Set<string>();
      for (const field of node.fields) {
        if (providedFields.has(field.name)) {
          ctx.error(`Campo '${field.name}' repetido en '${structName}'`);
          continue;
        }
        providedFields.add(field.name);
        const expectedField = structType.fields.find(c => c.name === field.name);
        if (!expectedField) {
          ctx.error(`Campo '${field.name}' no existe en '${structName}'`);
          continue;
        }
        const actualType = resolveType(ctx, analyzeExpression(ctx, field.value));
        if (!isAssignableType(ctx, actualType, expectedField.type)) {
          if (!(actualType === 'null' && typeof expectedField.type !== 'string')) {
            ctx.error(
              `Tipo incorrecto para '${structName}.${field.name}': ` +
              `se esperaba ${typeName(expectedField.type)}, ` +
              `se obtuvo ${typeName(actualType)}`
            );
          }
        }
      }
      const missing = structType.fields.filter(f => !providedFields.has(f.name)).map(f => f.name);
      if (missing.length > 0) {
        ctx.error(`Faltan campos en '${structName}': ${missing.join(', ')}`);
      }
      node.type = structType;
      return structType;
    }

    case 'struct_access': {
      const expressionType = resolveType(ctx, analyzeExpression(ctx, node.base));
      const baseType = typeof expressionType === 'object' && expressionType.kind === 'pointer'
        ? resolveType(ctx, expressionType.targetType) : expressionType;
      if (typeof baseType !== 'object' || baseType.kind !== 'struct') {
        ctx.error(
          `No se puede acceder al campo '${node.fieldName}' en un valor ` +
          `de tipo ${typeName(baseType)}`
        );
        node.type = 's32';
        return 's32';
      }

      const field = baseType.fields.find(c => c.name === node.fieldName);
      if (field) {
        node.resolvedBaseType = baseType;
        node.resolvedField = field;
        node.type = resolveType(ctx, field.type);
        return node.type;
      }

      if (baseType.name !== '') {
        const method = lookupMethod(ctx, baseType.name, node.fieldName);
        if (method) {
          return buildMethodValue(ctx, node, baseType, method);
        }
      }
      ctx.error(`Campo '${node.fieldName}' no existe en '${baseType.name}'`);
      node.type = 's32';
      return 's32';
    }

    case 'array_literal': {
      let elemType: MathType = 's32';
      if (node.elements.length > 0) elemType = resolveType(ctx, analyzeExpression(ctx, node.elements[0]));
      for (let i = 1; i < node.elements.length; i++) {
        const t = resolveType(ctx, analyzeExpression(ctx, node.elements[i]));
        if (!typesEqual(ctx, t, elemType)) {
          ctx.error(
            `Array literal: elemento ${i} tiene tipo ${typeName(t)}, ` +
            `esperado ${typeName(elemType)}`
          );
        }
      }
      node.type = { kind: 'array', elementType: elemType, length: node.elements.length };
      return node.type;
    }

    case 'array_access': {
      const baseType = resolveType(ctx, analyzeExpression(ctx, node.base));
      if (typeof baseType !== 'object' ||
          (baseType.kind !== 'array' && baseType.kind !== 'dynarray')) {
        ctx.error('array_access sobre no-array');
        node.type = 's32';
        return 's32';
      }
      const indexType = resolveType(ctx, analyzeExpression(ctx, node.index));
      if (indexType !== 's32' && indexType !== 'u32') {
        ctx.error(`El índice del array debe ser s32 o u32, se obtuvo ${typeName(indexType)}`);
      }
      node.arrayType = baseType;
      node.dynamic = baseType.kind === 'dynarray';
      node.type = baseType.elementType;
      return node.type;
    }

    case 'increment': {
      const increment = node as any;
      const operand = increment.operand as MathNode;
      const operandType = resolveType(ctx, analyzeExpression(ctx, operand));
      let root: any = operand;
      while (root.kind === 'struct_access' || root.kind === 'array_access') root = root.base;
      if (root.kind === 'capture_access') {
        // OK
      } else {
        if (root.kind !== 'variable') {
          ctx.error(`El operando de '${increment.operator}' debe ser modificable`);
          increment.type = 's32';
          return 's32';
        }
        ctx.scopeControl.checkMutable(root.name);
      }
      if (!isArithmeticType(operandType)) {
        ctx.error(
          `El operador '${increment.operator}' requiere un tipo numérico; ` +
          `se obtuvo ${typeName(operandType)}`
        );
        increment.type = 's32';
        return 's32';
      }
      increment.type = operandType;
      return operandType;
    }

    case 'size_of': {
      const s = node as SizeOfNode;
      let size = 0;

      if (s.identName) {
        if (ctx.scopeControl.has(s.identName) && !ctx.typeRegistry.hasType(s.identName)) {
          const sym = ctx.scopeControl.lookup(s.identName);
          const resolvedType = resolveType(ctx, sym.type);
          size = computeTypeSize(ctx, resolvedType);
        } else if (ctx.typeRegistry.hasType(s.identName)) {
          size = ctx.typeRegistry.getSize(s.identName);
        } else if (ctx.typeAliases.has(s.identName)) {
          const resolvedType = resolveType(ctx, ctx.typeAliases.get(s.identName)!);
          size = computeTypeSize(ctx, resolvedType);
        } else if (ctx.scopeControl.has(s.identName)) {
          const sym = ctx.scopeControl.lookup(s.identName);
          const resolvedType = resolveType(ctx, sym.type);
          size = computeTypeSize(ctx, resolvedType);
        } else {
          ctx.error(`Identificador o tipo no definido: '${s.identName}'`);
          node.type = 's32';
          return 's32';
        }
      } else if (s.targetType) {
        const resolvedType = resolveType(ctx, s.targetType);
        size = computeTypeSize(ctx, resolvedType, s.identName);
      } else if (s.expr) {
        const resolvedType = resolveType(ctx, analyzeExpression(ctx, s.expr));
        size = computeTypeSize(ctx, resolvedType);
      } else {
        ctx.error('size_of requiere un tipo o una expresión válida');
        node.type = 's32';
        return 's32';
      }

      s.value = size;
      s.type = 's32';

      (node as any).kind = 'const';
      (node as any).type = 's32';
      (node as any).value = size;
      return 's32';
    }

    case 'arena_for_type': {
      const allocation = node as ArenaForTypeNode;
      const targetType = resolveType(ctx, allocation.targetType);
      allocation.targetType = targetType;
      allocation.type = { kind: 'pointer', targetType };
      return allocation.type;
    }

    default: return 's32';
  }
}

// ─────────────────────────────────────────────────────────────────────
// Method values (self → closure)
// ─────────────────────────────────────────────────────────────────────
function buildMethodValue(
  ctx: SemanticContext,
  node: StructAccessNode,
  receiverType: StructType,
  method: FunctionOverload,
): MathType {
  const fullFnType = method.type;
  const valueParams = fullFnType.paramTypes.slice(1);
  const returnTypes = fullFnType.returnTypes;

  const thunkName = `__lambda_${ctx.lambdaCounter++}`;
  const baseExpr = node.base;

  const selfRef = {
    kind: 'capture_access' as const,
    captureIndex: 0,
    type: receiverType,
  };

  const paramNames = valueParams.map((_, i) => `a${i}`);
  const paramUniqueNames = paramNames.map(
    n => `$${n}_${ctx.syntheticCounter++}`
  );

  const paramRefs: MathNode[] = paramNames.map((n, i) => ({
    kind: 'variable',
    name: n,
    uniqueName: paramUniqueNames[i],
    isGlobal: false,
    type: valueParams[i],
  } as VariableNode));

  const innerCall: CallNode = {
    kind: 'call',
    name: method.mangledName,
    args: [selfRef, ...paramRefs],
    paramTypes: fullFnType.paramTypes,
    returnTypes: fullFnType.returnTypes,
    type: returnTypes[0] ?? 'void',
  };

  const thunkBody: StatementNode[] = returnTypes.length > 0
    ? [{ kind: 'return', values: [innerCall] }]
    : [{ kind: 'expression_stmt', expr: innerCall }];

  const thunkFn: FunctionDefNode = {
    kind: 'function_def',
    name: thunkName,
    params: valueParams.map((t, i) => ({
      name: paramNames[i],
      type: t,
      uniqueName: paramUniqueNames[i],
    })),
    returnTypes: returnTypes,
    body: thunkBody,
    mangledName: thunkName,
  };

  ctx.hoistedFunctions.push(thunkFn);

  const valueFnType: FunctionType = {
    kind: 'function',
    paramTypes: valueParams,
    returnTypes,
    variadic: fullFnType.variadic,
  };

  (node as any).kind = 'closure';
  (node as any).codeName = thunkName;
  (node as any).captures = [{
    name: 'self',
    sourceUniqueName: 'method_value_self',
    type: receiverType,
    index: 0,
  }];
  (node as any).captureExprs = [baseExpr];
  (node as any).type = valueFnType;

  delete (node as any).fieldName;
  delete (node as any).resolvedBaseType;

  return valueFnType;
}