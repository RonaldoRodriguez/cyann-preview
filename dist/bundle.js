// src/lexer.ts
class Lexer {
  source;
  index = 0;
  line = 1;
  column = 1;
  constructor(source) {
    this.source = source;
  }
  getPosition() {
    return { line: this.line, column: this.column, index: this.index };
  }
  saveState() {
    return { index: this.index, line: this.line, column: this.column };
  }
  restoreState(s) {
    this.index = s.index;
    this.line = s.line;
    this.column = s.column;
  }
  isEOF() {
    return this.index >= this.source.length;
  }
  peekChar() {
    return this.source[this.index] || "";
  }
  nextChar() {
    const ch = this.source[this.index++];
    if (ch === `
`) {
      this.line++;
      this.column = 1;
    } else {
      this.column++;
    }
    return ch;
  }
  skipTrivia() {
    while (!this.isEOF()) {
      const ch = this.peekChar();
      if (/\s/.test(ch)) {
        this.nextChar();
        continue;
      }
      if (ch === "/" && this.source[this.index + 1] === "/") {
        while (!this.isEOF() && this.peekChar() !== `
`)
          this.nextChar();
        continue;
      }
      if (ch === "/" && this.source[this.index + 1] === "*") {
        this.index += 2;
        while (!this.isEOF() && !(this.peekChar() === "*" && this.source[this.index + 1] === "/"))
          this.nextChar();
        if (!this.isEOF())
          this.index += 2;
        continue;
      }
      break;
    }
  }
  nextToken() {
    this.skipTrivia();
    if (this.isEOF())
      return { type: "EOF", value: "", line: this.line, column: this.column };
    const startLine = this.line, startColumn = this.column;
    const ch = this.peekChar();
    if (ch === '"' || ch === "'") {
      const quote = this.nextChar();
      let val = "";
      while (!this.isEOF() && this.peekChar() !== quote) {
        if (this.peekChar() === "\\") {
          this.nextChar();
          const esc = this.nextChar();
          switch (esc) {
            case "n":
              val += `
`;
              break;
            case "t":
              val += "\t";
              break;
            case "r":
              val += "\r";
              break;
            case "0":
              val += "\x00";
              break;
            default:
              val += esc;
              break;
          }
        } else
          val += this.nextChar();
      }
      if (this.peekChar() === quote)
        this.nextChar();
      return { type: "STRING", value: val, line: startLine, column: startColumn };
    }
    if (/\d/.test(ch)) {
      let raw = this.nextChar();
      while (!this.isEOF() && /[0-9a-fA-F._xXbBuUlLfL]/.test(this.peekChar()))
        raw += this.nextChar();
      return { type: "NUMBER", value: raw, line: startLine, column: startColumn };
    }
    if (/[a-zA-Z_$]/.test(ch)) {
      let id = "";
      while (!this.isEOF() && /[a-zA-Z0-9_$]/.test(this.peekChar()))
        id += this.nextChar();
      if (id === "true" || id === "false")
        return { type: "BOOLEAN", value: id, line: startLine, column: startColumn };
      const keywords = [
        "func",
        "var",
        "const",
        "type",
        "struct",
        "if",
        "else",
        "switch",
        "case",
        "default",
        "for",
        "in",
        "break",
        "continue",
        "return",
        "as",
        "make",
        "null",
        "host",
        "region"
      ];
      if (keywords.includes(id))
        return { type: "KEYWORD", value: id, line: startLine, column: startColumn };
      return { type: "IDENTIFIER", value: id, line: startLine, column: startColumn };
    }
    const twoChar = this.source.slice(this.index, this.index + 2);
    const doubleOps = ["==", "!=", "<=", ">=", "&&", "||", "<<", ">>", "->", ":="];
    if (doubleOps.includes(twoChar)) {
      this.nextChar();
      this.nextChar();
      return { type: "SYMBOL", value: twoChar, line: startLine, column: startColumn };
    }
    for (const op of ["++", "--"]) {
      if (this.source.startsWith(op, this.index)) {
        this.nextChar();
        this.nextChar();
        return { type: "SYMBOL", value: op, line: startLine, column: startColumn };
      }
    }
    return { type: "SYMBOL", value: this.nextChar(), line: startLine, column: startColumn };
  }
}

// src/constants.ts
var signedness = {
  s32: "signed",
  u32: "unsigned",
  s64: "signed",
  u64: "unsigned",
  f32: "float",
  f64: "float"
};
var width = {
  s32: 32,
  u32: 32,
  s64: 64,
  u64: 64,
  f32: 32,
  f64: 64
};
function maxArithmeticType(a, b) {
  if (a === b)
    return a;
  if (signedness[a] === "float" || signedness[b] === "float") {
    if (a === "f64" || b === "f64")
      return "f64";
    return "f32";
  }
  const aSigned = signedness[a] === "signed";
  const bSigned = signedness[b] === "signed";
  const resultWidth = Math.max(width[a], width[b]);
  const resultSigned = aSigned && bSigned;
  return resultWidth === 32 ? resultSigned ? "s32" : "u32" : resultSigned ? "s64" : "u64";
}
var HEX_RE = /^0[xX][0-9a-fA-F]+$/;
var BIN_RE = /^0[bB][01]+$/;
var DEC_INT_RE = /^\d+$/;
var FLOAT_RE = /^(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/;
function isValidNumericCore(s) {
  return HEX_RE.test(s) || BIN_RE.test(s) || DEC_INT_RE.test(s) || FLOAT_RE.test(s);
}
function resolveIntType(suffix, isUnsigned) {
  const is64 = suffix !== null && /[lL]/.test(suffix);
  if (is64)
    return isUnsigned ? "u64" : "s64";
  if (isUnsigned)
    return "u32";
  return "s32";
}
function resolveFloatType(suffix) {
  if (suffix === "f" || suffix === "F")
    return "f32";
  return "f64";
}
function checkAndReturnInt(type, val) {
  const limits = {
    s32: { min: -2147483648n, max: 2147483647n, convert: (n) => Number(n) | 0 },
    u32: { min: 0n, max: 4294967295n, convert: (n) => Number(BigInt.asUintN(32, n)) >>> 0 },
    s64: { min: -9223372036854775808n, max: 9223372036854775807n, convert: (n) => n },
    u64: { min: 0n, max: 18446744073709551615n, convert: (n) => BigInt.asUintN(64, n) }
  };
  const lim = limits[type];
  if (!lim)
    throw new Error(`Tipo no soportado: ${type}`);
  if (val < lim.min || val > lim.max)
    throw new Error(`Valor fuera de rango para ${type}: ${val}`);
  return { type, value: lim.convert(val) };
}
function inferLiteral(raw) {
  let sign = 1n;
  let core = raw.trim();
  if (core.startsWith("+")) {
    core = core.slice(1);
  } else if (core.startsWith("-")) {
    sign = -1n;
    core = core.slice(1);
  }
  const numericPart = core.replace(/_/g, "");
  if (numericPart === "")
    throw new Error("Literal vacío");
  let suffix = null;
  let cleanCore = numericPart;
  if (!isValidNumericCore(numericPart)) {
    const SUFFIXES = ["ul", "UL", "uL", "Ul", "lu", "LU", "lU", "Lu", "l", "L", "f", "F", "u", "U"];
    SUFFIXES.sort((a, b) => b.length - a.length);
    for (const s of SUFFIXES) {
      if (numericPart.endsWith(s)) {
        const potentialCore = numericPart.slice(0, -s.length);
        if (isValidNumericCore(potentialCore)) {
          suffix = s;
          cleanCore = potentialCore;
          break;
        }
      }
    }
    if (!suffix)
      throw new Error(`Formato numérico no válido: '${numericPart}'`);
  }
  const isHex = /^0[xX][0-9a-fA-F]+$/.test(cleanCore);
  const isBin = /^0[bB][01]+$/.test(cleanCore);
  const hasFloatSyntax = /[.eE]/.test(cleanCore);
  const isFloatCore = !isHex && !isBin && hasFloatSyntax;
  const isIntegerSuffix = suffix !== null && /[lLuU]/.test(suffix);
  const isFloatSuffix = suffix === "f" || suffix === "F";
  const isUnsigned = suffix !== null && /[uU]/.test(suffix);
  if (isIntegerSuffix && isFloatCore) {
    throw new Error("Literal flotante con sufijo entero");
  }
  if (isIntegerSuffix || !isFloatSuffix && !isFloatCore) {
    let val;
    if (isHex || isBin) {
      const digits = cleanCore.slice(2);
      val = BigInt((isHex ? "0x" : "0b") + digits);
    } else {
      val = BigInt(cleanCore);
    }
    const adjusted = sign * val;
    if (suffix === null && (isHex || isBin)) {
      if (adjusted >= -0x80000000n && adjusted <= 0xFFFFFFFFn) {
        return { type: "s32", value: Number(BigInt.asIntN(32, adjusted)) };
      }
      if (adjusted >= -0x8000000000000000n && adjusted <= 0xFFFFFFFFFFFFFFFFn) {
        return { type: "s64", value: BigInt.asIntN(64, adjusted) };
      }
      throw new Error(`Literal hex/bin fuera de rango 64-bit: ${adjusted}`);
    }
    const type = resolveIntType(suffix, isUnsigned);
    return checkAndReturnInt(type, adjusted);
  } else {
    if (isHex || isBin)
      throw new Error(`Formato flotante no compatible con ${cleanCore}`);
    const numVal = parseFloat(cleanCore);
    const type = resolveFloatType(suffix);
    const finalVal = sign === -1n ? -numVal : numVal;
    if (type === "f32")
      return { type, value: Math.fround(finalVal) };
    return { type, value: finalVal };
  }
}
function createConstNode(raw) {
  const lit = inferLiteral(raw);
  return { kind: "const", type: lit.type, value: lit.value };
}
function promoteValue(value, from, to) {
  if (from === to)
    return value;
  if (signedness[to] === "float")
    return Number(value);
  if (signedness[from] === "float")
    return value;
  if (width[to] > width[from])
    return BigInt(value);
  return value;
}
function isComparisonOp(op) {
  return ["==", "!=", "<", "<=", ">", ">="].includes(op);
}
function isLogicalOp(op) {
  return op === "&&" || op === "||";
}
function isIntegerType(t) {
  return t === "s32" || t === "u32" || t === "s64" || t === "u64";
}
function isArithmeticType(t) {
  return typeof t === "string" && t !== "string" && t !== "bool" && t !== "null" && t !== "tuple";
}
function applyBinaryConst(op, left, right) {
  if (isLogicalOp(op)) {
    if (left.kind !== "bool" || right.kind !== "bool")
      return null;
    const a = left.value;
    const b = right.value;
    if (op === "&&")
      return { kind: "bool", type: "bool", value: a && b };
    if (op === "||")
      return { kind: "bool", type: "bool", value: a || b };
    return null;
  }
  if (isComparisonOp(op)) {
    let aVal;
    let bVal;
    let resultType;
    if (left.kind === "bool" && right.kind === "bool") {
      aVal = left.value ? 1 : 0;
      bVal = right.value ? 1 : 0;
      resultType = "s32";
    } else if (left.kind === "const" && right.kind === "const") {
      const leftConst = left;
      const rightConst = right;
      resultType = maxArithmeticType(leftConst.type, rightConst.type);
      aVal = promoteValue(leftConst.value, leftConst.type, resultType);
      bVal = promoteValue(rightConst.value, rightConst.type, resultType);
    } else {
      return null;
    }
    const isFloat = signedness[resultType] === "float";
    let result;
    if (isFloat) {
      const a = Number(aVal), b = Number(bVal);
      switch (op) {
        case "==":
          result = a === b;
          break;
        case "!=":
          result = a !== b;
          break;
        case "<":
          result = a < b;
          break;
        case "<=":
          result = a <= b;
          break;
        case ">":
          result = a > b;
          break;
        case ">=":
          result = a >= b;
          break;
        default:
          return null;
      }
    } else {
      const a = BigInt(aVal), b = BigInt(bVal);
      switch (op) {
        case "==":
          result = a === b;
          break;
        case "!=":
          result = a !== b;
          break;
        case "<":
          result = a < b;
          break;
        case "<=":
          result = a <= b;
          break;
        case ">":
          result = a > b;
          break;
        case ">=":
          result = a >= b;
          break;
        default:
          return null;
      }
    }
    return { kind: "bool", type: "bool", value: result };
  }
  if (left.kind !== "const" || right.kind !== "const")
    return null;
  const resultType = maxArithmeticType(left.type, right.type);
  const aValue = promoteValue(left.value, left.type, resultType);
  const bValue = promoteValue(right.value, right.type, resultType);
  const isFloat = signedness[resultType] === "float";
  const isSigned = signedness[resultType] === "signed";
  let result;
  if (isFloat) {
    const a = Number(aValue), b = Number(bValue);
    switch (op) {
      case "+":
      case "add":
        result = a + b;
        break;
      case "-":
      case "sub":
        result = a - b;
        break;
      case "*":
      case "mul":
        result = a * b;
        break;
      case "/":
      case "div":
        if (b === 0)
          return null;
        result = a / b;
        break;
      case "%":
      case "rem":
        if (b === 0)
          return null;
        result = a % b;
        break;
      default:
        return null;
    }
  } else {
    const a = BigInt(aValue), b = BigInt(bValue);
    const w = width[resultType];
    switch (op) {
      case "+":
      case "add":
        result = a + b;
        break;
      case "-":
      case "sub":
        result = a - b;
        break;
      case "*":
      case "mul":
        result = a * b;
        break;
      case "/":
      case "div":
        if (b === 0n)
          return null;
        if (isSigned)
          result = a / b;
        else
          result = BigInt.asUintN(w, a) / BigInt.asUintN(w, b);
        break;
      case "%":
      case "rem":
        if (b === 0n)
          return null;
        if (isSigned)
          result = a % b;
        else
          result = BigInt.asUintN(w, a) % BigInt.asUintN(w, b);
        break;
      case "&":
        result = a & b;
        break;
      case "|":
        result = a | b;
        break;
      case "^":
        result = a ^ b;
        break;
      case "<<":
        result = a << (b & BigInt(width[resultType] - 1));
        break;
      case ">>":
        if (isSigned)
          result = a >> (b & BigInt(width[resultType] - 1));
        else
          result = BigInt.asUintN(width[resultType], a) >> (b & BigInt(width[resultType] - 1));
        break;
      default:
        return null;
    }
  }
  if (!isFloat) {
    const resultWidth = width[resultType];
    result = isSigned ? BigInt.asIntN(resultWidth, result) : BigInt.asUintN(resultWidth, result);
    if (resultWidth === 32)
      result = Number(result);
  }
  return { kind: "const", type: resultType, value: result };
}
function evaluateUnaryConst(op, operand) {
  if (op === "not") {
    if (operand.kind !== "bool")
      return null;
    return { kind: "bool", type: "bool", value: !operand.value };
  }
  if (op === "bitnot") {
    if (operand.kind !== "const")
      return null;
    const c = operand;
    if (c.type === "f32" || c.type === "f64")
      return null;
    const val = BigInt(c.value);
    const w = width[c.type];
    const converted = signedness[c.type] === "signed" ? BigInt.asIntN(w, ~val) : BigInt.asUintN(w, ~val);
    return { kind: "const", type: c.type, value: w === 32 ? Number(converted) : converted };
  }
  if (op !== "neg")
    return null;
  if (operand.kind !== "const")
    return null;
  const constOperand = operand;
  if (constOperand.type === "f32" || constOperand.type === "f64") {
    return { kind: "const", type: constOperand.type, value: -constOperand.value };
  }
  const val = BigInt(constOperand.value);
  const result = -val;
  const w = width[constOperand.type];
  const converted = signedness[constOperand.type] === "signed" ? BigInt.asIntN(w, result) : BigInt.asUintN(w, result);
  return {
    kind: "const",
    type: constOperand.type,
    value: w === 32 ? Number(converted) : converted
  };
}
function tryFoldCast(operand, oldType, newType) {
  if (oldType === newType)
    return operand;
  if (oldType === "string" && isIntegerType(newType)) {
    const strVal = operand.value.trim();
    if (/^[+-]?\d+$/.test(strVal)) {
      let sign = 1n;
      let digits = strVal;
      if (strVal.startsWith("+"))
        digits = strVal.slice(1);
      else if (strVal.startsWith("-")) {
        sign = -1n;
        digits = strVal.slice(1);
      }
      if (digits === "")
        return null;
      let val;
      try {
        val = BigInt(digits) * sign;
      } catch {
        return null;
      }
      const converted = checkAndReturnInt(newType, val);
      if (converted)
        return { kind: "const", type: converted.type, value: converted.value };
    }
    return null;
  }
  if (isIntegerType(oldType) && newType === "string") {
    const constNode = operand;
    let str;
    if (typeof constNode.value === "bigint")
      str = constNode.value.toString();
    else if (Number.isInteger(constNode.value))
      str = constNode.value.toString();
    else
      return null;
    return { kind: "string", type: "string", value: str };
  }
  if (oldType === "bool" && newType === "string") {
    const boolNode = operand;
    return { kind: "string", type: "string", value: boolNode.value ? "true" : "false" };
  }
  if (oldType === "bool" && isIntegerType(newType)) {
    const boolNode = operand;
    const value = boolNode.value ? 1n : 0n;
    const converted = checkAndReturnInt(newType, value);
    if (converted)
      return { kind: "const", type: converted.type, value: converted.value };
    return null;
  }
  if (isArithmeticType(oldType) && isArithmeticType(newType)) {
    const from = oldType;
    const to = newType;
    const constNode = operand;
    const value = constNode.value;
    if (signedness[from] === "float" && signedness[to] !== "float")
      return null;
    if (signedness[from] !== "float" && signedness[to] !== "float") {
      let bigVal;
      if (typeof value === "bigint")
        bigVal = value;
      else
        bigVal = BigInt(value);
      const resultWidth = width[to];
      const isSigned = signedness[to] === "signed";
      const converted = isSigned ? BigInt.asIntN(resultWidth, bigVal) : BigInt.asUintN(resultWidth, bigVal);
      if (isSigned) {
        const min = -(2n ** BigInt(resultWidth - 1));
        const max = 2n ** BigInt(resultWidth - 1) - 1n;
        if (bigVal < min || bigVal > max)
          return null;
      } else {
        const max = 2n ** BigInt(resultWidth) - 1n;
        if (bigVal < 0n || bigVal > max)
          return null;
      }
      return { kind: "const", type: to, value: resultWidth === 32 ? Number(converted) : converted };
    }
    if (signedness[from] !== "float" && signedness[to] === "float") {
      const num = typeof value === "bigint" ? Number(value) : value;
      if (to === "f32")
        return { kind: "const", type: "f32", value: Math.fround(num) };
      return { kind: "const", type: "f64", value: num };
    }
    if (signedness[from] === "float" && signedness[to] === "float") {
      const num = value;
      if (from === "f32" && to === "f64")
        return { kind: "const", type: "f64", value: num };
      if (from === "f64" && to === "f32")
        return { kind: "const", type: "f32", value: Math.fround(num) };
    }
  }
  return null;
}
function foldConstants(node) {
  if (node.kind === "const" || node.kind === "variable" || node.kind === "string" || node.kind === "bool" || node.kind === "function_ref") {
    return node;
  }
  if (node.kind === "call_indirect") {
    return {
      ...node,
      callee: foldConstants(node.callee),
      args: node.args.map((arg) => foldConstants(arg))
    };
  }
  if (node.kind === "cast") {
    const foldedOperand = foldConstants(node.operand);
    if (foldedOperand.kind === "const" || foldedOperand.kind === "string" || foldedOperand.kind === "bool") {
      const foldedCast = tryFoldCast(foldedOperand, node.oldType, node.newType);
      if (foldedCast)
        return foldedCast;
    }
    return { ...node, operand: foldedOperand };
  }
  if (node.kind === "unary") {
    const folded = foldConstants(node.operand);
    if (folded.kind === "const" || folded.kind === "bool") {
      const result = evaluateUnaryConst(node.op, folded);
      if (result)
        return result;
    }
    return { ...node, operand: folded };
  }
  if (node.kind === "binary") {
    const left = foldConstants(node.left);
    const right = foldConstants(node.right);
    if ((left.kind === "const" || left.kind === "bool") && (right.kind === "const" || right.kind === "bool")) {
      if (left.kind !== "string" && right.kind !== "string") {
        const result = applyBinaryConst(node.op, left, right);
        if (result)
          return result;
      }
    }
    return { ...node, left, right };
  }
  if (node.kind === "call") {
    return { ...node, args: node.args.map((arg) => foldConstants(arg)) };
  }
  if (node.kind === "array_literal") {
    return { ...node, elements: node.elements.map((el) => foldConstants(el)) };
  }
  if (node.kind === "array_access") {
    return {
      ...node,
      base: foldConstants(node.base),
      index: foldConstants(node.index)
    };
  }
  if (node.kind === "struct_literal") {
    return {
      ...node,
      fields: node.fields.map((f) => ({ name: f.name, value: foldConstants(f.value) }))
    };
  }
  if (node.kind === "struct_access") {
    return { ...node, base: foldConstants(node.base) };
  }
  return node;
}

// src/parser.ts
class Parser {
  lexer;
  currentToken;
  _noStructLiteral = 0;
  _loopStack = [];
  constructor(lexer) {
    this.lexer = lexer;
    this.advance();
  }
  advance() {
    this.currentToken = this.lexer.nextToken();
  }
  peekNextToken() {
    const s = this.lexer.saveState();
    const c = this.currentToken;
    this.advance();
    const n = this.currentToken;
    this.currentToken = c;
    this.lexer.restoreState(s);
    return n;
  }
  error(msg) {
    throw new Error(`${msg} en línea ${this.currentToken.line}, columna ${this.currentToken.column}`);
  }
  matchToken(type, value) {
    if (this.currentToken.type === type && (!value || this.currentToken.value === value)) {
      this.advance();
      return true;
    }
    return false;
  }
  expectToken(type, value) {
    const val = this.currentToken.value;
    if (this.currentToken.type !== type || value && val !== value) {
      this.error(`Se esperaba '${value || type}', pero se encontró '${val}'`);
    }
    this.advance();
    return val;
  }
  check(type, value) {
    return this.currentToken.type === type && (!value || this.currentToken.value === value);
  }
  checkValue(v) {
    return this.currentToken.value === v;
  }
  withoutStructLiteral(fn) {
    this._noStructLiteral++;
    try {
      return fn();
    } finally {
      this._noStructLiteral--;
    }
  }
  parseLoopBody(label) {
    this._loopStack.push({ supportsContinue: true, label });
    try {
      return this.parseBlock();
    } finally {
      this._loopStack.pop();
    }
  }
  parseProgram() {
    const body = [];
    while (this.currentToken.type !== "EOF")
      body.push(this.parseStatement());
    return { kind: "program", body };
  }
  parseStatement() {
    if (this.currentToken.value === "[") {
      this.advance();
      if (this.matchToken("KEYWORD", "host"))
        return this.parseImportDecl();
      if (this.currentToken.type === "IDENTIFIER") {
        const receiver = this.parseGoTypeName();
        this.expectToken("SYMBOL", "]");
        return this.parseMethodDef(receiver);
      }
      this.error("Solo se admite [host(...)] o [Tipo] como atributo");
    }
    if (this.currentToken.value === "var")
      return this.parseVarDecl();
    if (this.currentToken.value === "const")
      return this.parseConstDecl();
    if (this.currentToken.value === "func")
      return this.parseFunctionDef();
    if (this.currentToken.value === "type")
      return this.parseTypeOrStructDef();
    if (this.currentToken.value === "if")
      return this.parseIfStatement();
    if (this.currentToken.value === "for")
      return this.parseForStatement();
    if (this.currentToken.value === "switch")
      return this.parseSwitchStatement();
    if (this.currentToken.value === "region") {
      this.advance();
      const body = this.parseBlock();
      return { kind: "region", body };
    }
    if (this.currentToken.value === "break")
      return this.parseBreakStatement();
    if (this.currentToken.value === "continue")
      return this.parseContinueStatement();
    if (this.currentToken.value === "return")
      return this.parseReturnStatement();
    if (this.currentToken.type === "IDENTIFIER") {
      const name = this.currentToken.value;
      this.advance();
      if (this.currentToken.value === ":") {
        const next = this.peekNextToken();
        if (next.type === "KEYWORD" && next.value === "for") {
          this.advance();
          return this.parseForStatement(name);
        }
      }
      return this.parseStatementStartingWithIdentifier(name);
    }
    const expr = this.parseExpression();
    this.matchToken("SYMBOL", ";");
    return { kind: "expression_stmt", expr };
  }
  parseStatementStartingWithIdentifier(name) {
    if (this.matchToken("SYMBOL", ",")) {
      const names = [name];
      do {
        names.push(this.expectToken("IDENTIFIER"));
      } while (this.matchToken("SYMBOL", ","));
      this.expectToken("SYMBOL", "=");
      const expr = this.parseExpression();
      this.matchToken("SYMBOL", ";");
      return { kind: "multi_decl", names, expr };
    }
    if (this.currentToken.value === "(") {
      let expr = this.parseCallAfterName(name);
      expr = this.parsePostfix(expr);
      this.matchToken("SYMBOL", ";");
      return { kind: "expression_stmt", expr };
    }
    const variable = { kind: "variable", name, type: "s32" };
    const target = this.parsePostfix(variable);
    if (this.matchToken("SYMBOL", "=")) {
      const expr = this.parseExpression();
      this.matchToken("SYMBOL", ";");
      return { kind: "assign", target, expr };
    }
    const expr = this.parseExpressionStartingWith(target);
    this.matchToken("SYMBOL", ";");
    return { kind: "expression_stmt", expr };
  }
  parseImportDecl() {
    this.expectToken("SYMBOL", "(");
    const module = this.expectToken("STRING");
    this.expectToken("SYMBOL", ",");
    const field = this.expectToken("STRING");
    this.expectToken("SYMBOL", ")");
    this.expectToken("SYMBOL", "]");
    this.expectToken("KEYWORD", "func");
    const name = this.expectToken("IDENTIFIER");
    this.expectToken("SYMBOL", "(");
    const params = [];
    if (this.currentToken.value !== ")") {
      for (;; ) {
        const pn = this.expectToken("IDENTIFIER");
        const pt = this.parseGoTypeName();
        params.push({ name: pn, type: pt });
        if (!this.matchToken("SYMBOL", ","))
          break;
      }
    }
    const closeParenLine = this.currentToken.line;
    this.expectToken("SYMBOL", ")");
    let returnType = null;
    if (this.currentToken.line === closeParenLine && this.isTypeStart()) {
      returnType = this.parseGoTypeName();
    }
    this.matchToken("SYMBOL", ";");
    return { kind: "import_decl", module, field, name, params, returnType };
  }
  parseVarDecl() {
    this.expectToken("KEYWORD", "var");
    const firstName = this.expectToken("IDENTIFIER");
    if (this.matchToken("SYMBOL", ",")) {
      const names = [firstName];
      do {
        names.push(this.expectToken("IDENTIFIER"));
      } while (this.matchToken("SYMBOL", ","));
      this.expectToken("SYMBOL", "=");
      const expr = this.parseExpression();
      this.matchToken("SYMBOL", ";");
      return { kind: "multi_decl", names, expr };
    }
    const inferred = this.currentToken.value === "=";
    let type = "s32";
    if (!inferred)
      type = this.parseGoTypeName();
    let initExpr = null;
    if (this.matchToken("SYMBOL", "="))
      initExpr = this.parseExpression();
    this.matchToken("SYMBOL", ";");
    return { kind: "var_decl", name: firstName, type, initExpr, inferred };
  }
  parseConstDecl() {
    this.expectToken("KEYWORD", "const");
    const name = this.expectToken("IDENTIFIER");
    const inferred = this.currentToken.value === "=";
    let type = "s32";
    if (!inferred)
      type = this.parseGoTypeName();
    let initExpr = null;
    if (this.matchToken("SYMBOL", "="))
      initExpr = this.parseExpression();
    this.matchToken("SYMBOL", ";");
    return { kind: "const_decl", name, type, initExpr, inferred, isConst: true };
  }
  parseReturnTypes() {
    if (this.matchToken("SYMBOL", "(")) {
      const types = [];
      if (this.currentToken.value !== ")") {
        for (;; ) {
          types.push(this.parseGoTypeName());
          if (!this.matchToken("SYMBOL", ","))
            break;
        }
      }
      this.expectToken("SYMBOL", ")");
      return types;
    }
    if (this.isTypeStart())
      return [this.parseGoTypeName()];
    return [];
  }
  parseFunctionDef() {
    this.expectToken("KEYWORD", "func");
    const name = this.expectToken("IDENTIFIER");
    this.expectToken("SYMBOL", "(");
    const params = [];
    if (this.currentToken.value !== ")") {
      for (;; ) {
        const paramName = this.expectToken("IDENTIFIER");
        const paramType = this.parseGoTypeName();
        params.push({ name: paramName, type: paramType });
        if (!this.matchToken("SYMBOL", ","))
          break;
      }
    }
    const closeParenLine = this.currentToken.line;
    this.expectToken("SYMBOL", ")");
    let returnTypes = [];
    if (this.currentToken.line === closeParenLine) {
      returnTypes = this.parseReturnTypes();
    }
    const body = this.parseBlock();
    return { kind: "function_def", name, params, returnTypes, body };
  }
  parseMethodDef(receiver) {
    this.expectToken("KEYWORD", "func");
    const name = this.expectToken("IDENTIFIER");
    this.expectToken("SYMBOL", "(");
    const params = [];
    if (this.currentToken.value !== ")") {
      for (;; ) {
        const paramName = this.expectToken("IDENTIFIER");
        const paramType = this.parseGoTypeName();
        params.push({ name: paramName, type: paramType });
        if (!this.matchToken("SYMBOL", ","))
          break;
      }
    }
    const closeParenLine = this.currentToken.line;
    this.expectToken("SYMBOL", ")");
    let returnTypes = [];
    if (this.currentToken.line === closeParenLine) {
      returnTypes = this.parseReturnTypes();
    }
    const body = this.parseBlock();
    return { kind: "function_def", name, params, returnTypes, body, receiver };
  }
  parseTypeOrStructDef() {
    this.expectToken("KEYWORD", "type");
    const name = this.expectToken("IDENTIFIER");
    if (this.matchToken("KEYWORD", "struct")) {
      this.expectToken("SYMBOL", "{");
      const fields = [];
      while (this.currentToken.value !== "}") {
        const fieldName = this.expectToken("IDENTIFIER");
        const fieldType = this.parseGoTypeName();
        fields.push({ name: fieldName, type: fieldType });
        this.matchToken("SYMBOL", ";");
      }
      this.expectToken("SYMBOL", "}");
      return { kind: "struct_def", name, fields };
    }
    const targetType = this.parseGoTypeName();
    this.matchToken("SYMBOL", ";");
    return { kind: "type_alias", name, targetType };
  }
  parseIfStatement() {
    this.expectToken("KEYWORD", "if");
    const condition = this.withoutStructLiteral(() => this.parseExpression());
    const thenBlock = this.parseBlock();
    let elseBlock = null;
    if (this.matchToken("KEYWORD", "else")) {
      if (this.currentToken.value === "if")
        elseBlock = this.parseIfStatement();
      else
        elseBlock = this.parseBlock();
    }
    return { kind: "if", condition, thenBlock, elseBlock };
  }
  parseForStatement(label = null) {
    this.expectToken("KEYWORD", "for");
    if (this.checkValue("{")) {
      const body = this.parseLoopBody(label ?? undefined);
      return { kind: "for", label: label ?? undefined, body };
    }
    if (this.check("KEYWORD", "var")) {
      const initStmt = this.parseVarDecl();
      return this.finishClassicFor(initStmt, label);
    }
    if (this.check("IDENTIFIER")) {
      const firstName = this.currentToken.value;
      this.advance();
      if (this.matchToken("SYMBOL", ",")) {
        const names = [firstName];
        do {
          names.push(this.expectToken("IDENTIFIER"));
        } while (this.matchToken("SYMBOL", ","));
        this.expectToken("KEYWORD", "in");
        const iterable = this.withoutStructLiteral(() => this.parseExpression());
        const body = this.parseLoopBody(label ?? undefined);
        return { kind: "for_in", label: label ?? undefined, varNames: names, iterable, body };
      }
      if (this.matchToken("KEYWORD", "in")) {
        const iterable = this.withoutStructLiteral(() => this.parseExpression());
        const body = this.parseLoopBody(label ?? undefined);
        return { kind: "for_in", label: label ?? undefined, varNames: [firstName], iterable, body };
      }
      const firstStmt = this.withoutStructLiteral(() => this.parseStatementStartingWithIdentifier(firstName));
      return this.finishClassicFor(firstStmt, label);
    }
    if (this.checkValue(";"))
      return this.finishClassicFor(null, label);
    const condExpr = this.withoutStructLiteral(() => this.parseExpression());
    if (this.checkValue("{")) {
      const body = this.parseLoopBody(label ?? undefined);
      return { kind: "for", label: label ?? undefined, condition: condExpr, body };
    }
    this.error('for: se esperaba "{" después de la condición');
  }
  finishClassicFor(firstStmt, label = null) {
    let init = null;
    let condition = null;
    let post = null;
    if (firstStmt === null) {
      this.expectToken("SYMBOL", ";");
      if (!this.checkValue(";"))
        condition = this.withoutStructLiteral(() => this.parseExpression());
      this.expectToken("SYMBOL", ";");
      if (!this.checkValue("{"))
        post = this.parseStatement();
    } else if (this.checkValue("{")) {
      if (firstStmt.kind !== "expression_stmt")
        this.error('for: se esperaba ";" antes de "{"');
      condition = firstStmt.expr;
    } else {
      init = firstStmt;
      if (!this.checkValue(";"))
        condition = this.withoutStructLiteral(() => this.parseExpression());
      this.expectToken("SYMBOL", ";");
      if (!this.checkValue("{"))
        post = this.parseStatement();
    }
    const body = this.parseLoopBody(label ?? undefined);
    return { kind: "for", label: label ?? undefined, init, condition, post, body };
  }
  parseSwitchStatement() {
    this.expectToken("KEYWORD", "switch");
    const expr = this.withoutStructLiteral(() => this.parseExpression());
    this.expectToken("SYMBOL", "{");
    const cases = [];
    let defaultBody = null;
    let seenDefault = false;
    while (!this.checkValue("}")) {
      if (this.currentToken.type === "EOF")
        this.error('switch: "}" esperado');
      if (this.matchToken("KEYWORD", "case")) {
        const patterns = [];
        for (;; ) {
          const pattern = this.parsePattern();
          patterns.push(pattern);
          if (this.matchToken("SYMBOL", ","))
            continue;
          break;
        }
        this.expectToken("SYMBOL", ":");
        const body = this.parseCaseBody();
        cases.push({ patterns, body });
        continue;
      }
      if (this.matchToken("KEYWORD", "default")) {
        if (seenDefault)
          this.error('switch: dos "default" en el mismo switch');
        seenDefault = true;
        this.expectToken("SYMBOL", ":");
        defaultBody = this.parseCaseBody();
        continue;
      }
      this.error('switch: se esperaba "case" o "default"');
    }
    this.expectToken("SYMBOL", "}");
    return { kind: "switch", expr, cases, defaultBody };
  }
  parsePattern() {
    const tok = this.currentToken;
    if (tok.type === "IDENTIFIER" && tok.value === "_") {
      this.advance();
      return { kind: "wildcard" };
    }
    if (this.matchToken("KEYWORD", "null")) {
      return { kind: "const", type: "null", value: -1 };
    }
    if (this.matchToken("NUMBER")) {
      const cn = createConstNode(tok.value);
      return { kind: "const", type: cn.type, value: cn.value };
    }
    if (this.matchToken("STRING")) {
      return { kind: "string", value: tok.value };
    }
    if (this.matchToken("BOOLEAN")) {
      return { kind: "bool", value: tok.value === "true" };
    }
    if (tok.type === "IDENTIFIER") {
      this.advance();
      const structName = tok.value;
      if (this.currentToken.value !== "{") {
        this.error(`Patrón no válido: identificador '${structName}' sin '{'. ` + `¿Quisiste escribir '_' como wildcard?`);
      }
      this.expectToken("SYMBOL", "{");
      const fields = [];
      if (this.currentToken.value !== "}") {
        do {
          const fieldName = this.expectToken("IDENTIFIER");
          this.expectToken("SYMBOL", ":");
          const fieldPattern = this.parsePattern();
          fields.push({ name: fieldName, pattern: fieldPattern });
        } while (this.matchToken("SYMBOL", ",") && this.currentToken.value !== "}");
      }
      this.expectToken("SYMBOL", "}");
      return { kind: "struct", structName, fields };
    }
    this.error(`Patrón no válido: '${tok.value}'`);
  }
  parseCaseBody() {
    const stmts = [];
    while (!this.checkValue("}") && !this.check("KEYWORD", "case") && !this.check("KEYWORD", "default") && this.currentToken.type !== "EOF")
      stmts.push(this.parseStatement());
    return stmts;
  }
  parseBreakStatement() {
    this.expectToken("KEYWORD", "break");
    let label = undefined;
    if (this.currentToken.type === "IDENTIFIER") {
      label = this.currentToken.value;
      this.advance();
    }
    if (label !== undefined) {
      if (!this._loopStack.some((l) => l.label === label)) {
        this.error(`break: etiqueta '${label}' no encontrada`);
      }
    } else {
      if (this._loopStack.length === 0)
        this.error("break fuera de un bucle");
    }
    this.matchToken("SYMBOL", ";");
    return { kind: "break", label };
  }
  parseContinueStatement() {
    this.expectToken("KEYWORD", "continue");
    let label = undefined;
    if (this.currentToken.type === "IDENTIFIER") {
      label = this.currentToken.value;
      this.advance();
    }
    if (label !== undefined) {
      if (!this._loopStack.some((l) => l.label === label && l.supportsContinue)) {
        this.error(`continue: etiqueta '${label}' no encontrada`);
      }
    } else {
      if (!this._loopStack.some((l) => l.supportsContinue))
        this.error("continue fuera de un bucle");
    }
    this.matchToken("SYMBOL", ";");
    return { kind: "continue", label };
  }
  parseReturnStatement() {
    this.expectToken("KEYWORD", "return");
    const values = [];
    if (this.currentToken.value !== "}" && this.currentToken.type !== "EOF" && this.currentToken.value !== ";") {
      for (;; ) {
        values.push(this.parseExpression());
        if (!this.matchToken("SYMBOL", ","))
          break;
      }
    }
    this.matchToken("SYMBOL", ";");
    return { kind: "return", values };
  }
  parseBlock() {
    this.expectToken("SYMBOL", "{");
    const statements = [];
    while (this.currentToken.value !== "}" && this.currentToken.type !== "EOF") {
      statements.push(this.parseStatement());
    }
    this.expectToken("SYMBOL", "}");
    return statements;
  }
  isTypeStart() {
    const value = this.currentToken.value;
    return this.currentToken.type === "IDENTIFIER" || value === "fn" || value === "func" || value === "*" || value === "[" || value === "struct";
  }
  parseGoTypeName() {
    if (this.matchToken("SYMBOL", "*")) {
      return { kind: "pointer", targetType: this.parseGoTypeName() };
    }
    if (this.matchToken("SYMBOL", "[")) {
      if (this.matchToken("SYMBOL", "]")) {
        const elementType = this.parseGoTypeName();
        return { kind: "dynarray", elementType };
      }
      const rawLength = this.expectToken("NUMBER");
      const length = Number(rawLength);
      if (!Number.isInteger(length) || length <= 0) {
        this.error(`Longitud de array inválida: '${rawLength}'`);
      }
      this.expectToken("SYMBOL", "]");
      const elementType = this.parseGoTypeName();
      return { kind: "array", elementType, length };
    }
    if (!this.isTypeStart()) {
      this.error(`Se esperaba un tipo, se encontró '${this.currentToken.value}'`);
    }
    const typeName = this.currentToken.value;
    const typeLine = this.currentToken.line;
    this.advance();
    let type;
    if (typeName === "fn" || typeName === "func") {
      this.expectToken("SYMBOL", "(");
      const paramTypes = [];
      if (this.currentToken.value !== ")") {
        do {
          paramTypes.push(this.parseGoTypeName());
        } while (this.matchToken("SYMBOL", ","));
      }
      this.expectToken("SYMBOL", ")");
      const returnTypes = this.isTypeStart() ? [this.parseGoTypeName()] : [];
      type = { kind: "function", paramTypes, returnTypes };
    } else if (typeName === "struct") {
      this.expectToken("SYMBOL", "{");
      const fields = [];
      while (this.currentToken.value !== "}") {
        const fieldName = this.expectToken("IDENTIFIER");
        this.expectToken("SYMBOL", ":");
        const fieldType = this.parseGoTypeName();
        fields.push({ name: fieldName, type: fieldType });
        this.matchToken("SYMBOL", ";");
      }
      this.expectToken("SYMBOL", "}");
      type = {
        kind: "struct",
        name: "",
        fields: fields.map((f) => ({ name: f.name, type: f.type, offset: 0 })),
        size: 0,
        align: 1
      };
    } else {
      switch (typeName) {
        case "int":
        case "i32":
        case "int32":
        case "int32_t":
          type = "s32";
          break;
        case "int64":
        case "int64_t":
        case "long":
          type = "s64";
          break;
        case "uint":
        case "u32":
        case "uint32":
        case "uint32_t":
          type = "u32";
          break;
        case "uint64":
        case "uint64_t":
        case "u64":
          type = "u64";
          break;
        case "float":
        case "f32":
          type = "f32";
          break;
        case "float64":
        case "double":
        case "f64":
          type = "f64";
          break;
        case "bool":
          type = "bool";
          break;
        case "string":
          type = "string";
          break;
        case "byte":
        case "char":
        case "i8":
        case "u8":
        case "int8_t":
        case "uint8_t":
          type = "s32";
          break;
        case "i16":
        case "u16":
        case "int16_t":
        case "uint16_t":
          type = "s32";
          break;
        case "size_t":
        case "ssize_t":
        case "intptr_t":
        case "uintptr_t":
        case "usize":
        case "isize":
        case "uintptr":
          type = "u32";
          break;
        default:
          type = { kind: "struct", name: typeName, fields: [], size: 0, align: 1 };
      }
    }
    return this.parseArraySuffix(type, typeLine);
  }
  parseArraySuffix(elementType, typeLine) {
    let type = elementType;
    while (this.currentToken.value === "[" && this.currentToken.line === typeLine) {
      this.advance();
      if (this.matchToken("SYMBOL", "]")) {
        type = { kind: "dynarray", elementType: type };
        continue;
      }
      const rawLength = this.expectToken("NUMBER");
      const length = Number(rawLength);
      if (!Number.isInteger(length) || length <= 0) {
        this.error(`Longitud de array inválida: '${rawLength}'`);
      }
      this.expectToken("SYMBOL", "]");
      type = { kind: "array", elementType: type, length };
    }
    return type;
  }
  parseExpression() {
    return this.parseLogicalOr();
  }
  parseExpressionStartingWith(leftNode) {
    return this.parseBinaryRHS(0, leftNode);
  }
  parseBinaryRHS(minPrecedence, left) {
    const precedence = {
      "||": 1,
      "&&": 2,
      "|": 3,
      "^": 4,
      "&": 5,
      "==": 6,
      "!=": 6,
      "<": 7,
      "<=": 7,
      ">": 7,
      ">=": 7,
      "<<": 8,
      ">>": 8,
      "+": 9,
      "-": 9,
      "*": 10,
      "/": 10,
      "%": 10
    };
    let result = left;
    while (true) {
      const op = this.currentToken.value;
      const opPrecedence = precedence[op];
      if (opPrecedence === undefined || opPrecedence < minPrecedence)
        return result;
      this.advance();
      let right = this.parseUnary();
      const nextPrecedence = precedence[this.currentToken.value];
      if (nextPrecedence !== undefined && nextPrecedence > opPrecedence) {
        right = this.parseBinaryRHS(opPrecedence + 1, right);
      }
      result = { kind: "binary", op, left: result, right };
    }
  }
  parseLogicalOr() {
    let left = this.parseLogicalAnd();
    while (this.matchToken("SYMBOL", "||")) {
      const right = this.parseLogicalAnd();
      left = { kind: "binary", op: "||", left, right };
    }
    return left;
  }
  parseLogicalAnd() {
    let left = this.parseBitwiseOr();
    while (this.matchToken("SYMBOL", "&&")) {
      const right = this.parseBitwiseOr();
      left = { kind: "binary", op: "&&", left, right };
    }
    return left;
  }
  parseBitwiseOr() {
    let left = this.parseBitwiseXor();
    while (this.matchToken("SYMBOL", "|") && this.currentToken.value !== "|") {
      const right = this.parseBitwiseXor();
      left = { kind: "binary", op: "|", left, right };
    }
    return left;
  }
  parseBitwiseXor() {
    let left = this.parseBitwiseAnd();
    while (this.matchToken("SYMBOL", "^")) {
      const right = this.parseBitwiseAnd();
      left = { kind: "binary", op: "^", left, right };
    }
    return left;
  }
  parseBitwiseAnd() {
    let left = this.parseEquality();
    while (this.matchToken("SYMBOL", "&") && this.currentToken.value !== "&") {
      const right = this.parseEquality();
      left = { kind: "binary", op: "&", left, right };
    }
    return left;
  }
  parseEquality() {
    let left = this.parseRelational();
    while (this.currentToken.value === "==" || this.currentToken.value === "!=") {
      const op = this.currentToken.value;
      this.advance();
      const right = this.parseRelational();
      left = { kind: "binary", op, left, right };
    }
    return left;
  }
  parseRelational() {
    let left = this.parseShift();
    while (["<", "<=", ">", ">="].includes(this.currentToken.value)) {
      const op = this.currentToken.value;
      this.advance();
      const right = this.parseShift();
      left = { kind: "binary", op, left, right };
    }
    return left;
  }
  parseShift() {
    let left = this.parseAdditive();
    while (this.currentToken.value === "<<" || this.currentToken.value === ">>") {
      const op = this.currentToken.value;
      this.advance();
      const right = this.parseAdditive();
      left = { kind: "binary", op, left, right };
    }
    return left;
  }
  parseAdditive() {
    let left = this.parseMultiplicative();
    while (this.currentToken.value === "+" || this.currentToken.value === "-") {
      const op = this.currentToken.value;
      this.advance();
      const right = this.parseMultiplicative();
      left = { kind: "binary", op, left, right };
    }
    return left;
  }
  parseMultiplicative() {
    let left = this.parseUnary();
    while (["*", "/", "%"].includes(this.currentToken.value)) {
      const op = this.currentToken.value;
      this.advance();
      const right = this.parseUnary();
      left = { kind: "binary", op, left, right };
    }
    return left;
  }
  parseUnary() {
    if (this.matchToken("SYMBOL", "++"))
      return { kind: "increment", operator: "++", operand: this.parseUnary(), prefix: true, type: "s32" };
    if (this.matchToken("SYMBOL", "--"))
      return { kind: "increment", operator: "--", operand: this.parseUnary(), prefix: true, type: "s32" };
    if (this.matchToken("SYMBOL", "!"))
      return { kind: "unary", op: "not", operand: this.parseUnary() };
    if (this.matchToken("SYMBOL", "-"))
      return { kind: "unary", op: "neg", operand: this.parseUnary() };
    if (this.matchToken("SYMBOL", "~"))
      return { kind: "unary", op: "bitnot", operand: this.parseUnary() };
    return this.parsePrimary();
  }
  parsePrimary() {
    const token = this.currentToken;
    let node;
    if (this.matchToken("SYMBOL", "[")) {
      const elements = [];
      if (this.currentToken.value !== "]") {
        for (;; ) {
          elements.push(this.parseExpression());
          if (!this.matchToken("SYMBOL", ","))
            break;
        }
      }
      this.expectToken("SYMBOL", "]");
      const firstType = elements.length > 0 ? elements[0].type ?? "s32" : "s32";
      node = {
        kind: "array_literal",
        elements,
        type: { kind: "array", elementType: firstType, length: elements.length }
      };
    } else if (this.matchToken("KEYWORD", "make")) {
      this.expectToken("SYMBOL", "(");
      const typeExpr = this.parseGoTypeName();
      this.expectToken("SYMBOL", ",");
      const lengthExpr = this.parseExpression();
      this.expectToken("SYMBOL", ")");
      node = { kind: "make_array", typeExpr, lengthExpr };
    } else if (this.matchToken("KEYWORD", "func")) {
      this.expectToken("SYMBOL", "(");
      const params = [];
      if (this.currentToken.value !== ")") {
        for (;; ) {
          const pn = this.expectToken("IDENTIFIER");
          const pt = this.parseGoTypeName();
          params.push({ name: pn, type: pt });
          if (!this.matchToken("SYMBOL", ","))
            break;
        }
      }
      const closeParenLine = this.currentToken.line;
      this.expectToken("SYMBOL", ")");
      let returnTypes = [];
      if (this.currentToken.line === closeParenLine) {
        returnTypes = this.parseReturnTypes();
      }
      const body = this.parseBlock();
      node = { kind: "function_literal", params, returnTypes, body };
    } else if (this.matchToken("KEYWORD", "struct")) {
      this.expectToken("SYMBOL", "{");
      const fields = [];
      if (this.currentToken.value !== "}") {
        for (;; ) {
          const fieldName = this.expectToken("IDENTIFIER");
          this.expectToken("SYMBOL", ":");
          const value = this.parseExpression();
          fields.push({ name: fieldName, value });
          if (!this.matchToken("SYMBOL", ","))
            break;
        }
      }
      this.expectToken("SYMBOL", "}");
      node = {
        kind: "struct_literal",
        structName: "__anon",
        fields,
        type: { kind: "struct", name: "", fields: [], size: 0, align: 1 }
      };
    } else if (this.matchToken("NUMBER"))
      node = createConstNode(token.value);
    else if (this.matchToken("STRING"))
      node = { kind: "string", type: "string", value: token.value };
    else if (this.matchToken("BOOLEAN"))
      node = { kind: "bool", type: "bool", value: token.value === "true" };
    else if (this.matchToken("KEYWORD", "null"))
      node = { kind: "const", type: "null", value: -1 };
    else if (this.matchToken("SYMBOL", "(")) {
      const savedNoStruct = this._noStructLiteral;
      this._noStructLiteral = 0;
      try {
        node = this.parseExpression();
      } finally {
        this._noStructLiteral = savedNoStruct;
      }
      this.expectToken("SYMBOL", ")");
    } else if (this.matchToken("IDENTIFIER")) {
      if (this.currentToken.value === "(")
        node = this.parseCallAfterName(token.value);
      else if (this.currentToken.value === "{" && this._noStructLiteral === 0)
        node = this.parseStructCallAfterName(token.value);
      else
        node = { kind: "variable", name: token.value, type: "s32" };
    } else
      this.error(`Expresión no válida: '${token.value}'`);
    node = this.parsePostfix(node);
    while (this.matchToken("KEYWORD", "as")) {
      const targetType = this.parseGoTypeName();
      node = { kind: "cast", operator: "as", oldType: node.type, newType: targetType, operand: node };
    }
    return node;
  }
  parseCallAfterName(name) {
    this.expectToken("SYMBOL", "(");
    const args = [];
    if (this.currentToken.value !== ")") {
      do {
        args.push(this.parseExpression());
      } while (this.matchToken("SYMBOL", ",") && !this.matchToken("EOF"));
    }
    this.expectToken("SYMBOL", ")");
    return { kind: "call", name, args, paramTypes: args.map(() => "s32"), type: "s32" };
  }
  parseStructCallAfterName(name) {
    this.expectToken("SYMBOL", "{");
    const fields = [];
    if (this.currentToken.value !== "}") {
      do {
        const fieldName = this.expectToken("IDENTIFIER");
        this.expectToken("SYMBOL", ":");
        const value = this.parseExpression();
        fields.push({ name: fieldName, value });
      } while (this.matchToken("SYMBOL", ",") && this.currentToken.value !== "}");
    }
    this.expectToken("SYMBOL", "}");
    return {
      kind: "struct_literal",
      structName: name,
      fields,
      type: { kind: "struct", name, fields: [], size: 0, align: 1 }
    };
  }
  parsePostfix(base) {
    let expr = base;
    while (true) {
      const value = this.currentToken.value;
      if (value === "++" || value === "--") {
        this.advance();
        expr = { kind: "increment", operator: value, operand: expr, prefix: false, type: "s32" };
        continue;
      }
      if (this.matchToken("SYMBOL", ".")) {
        const fieldName = this.expectToken("IDENTIFIER");
        expr = { kind: "struct_access", base: expr, fieldName, type: "s32" };
        continue;
      }
      if (this.currentToken.value === "[") {
        const afterBracket = this.peekNextToken();
        const isAttribute = afterBracket.type === "KEYWORD" && afterBracket.value === "host";
        if (!isAttribute) {
          this.advance();
          const index = this.parseExpression();
          this.expectToken("SYMBOL", "]");
          expr = { kind: "array_access", base: expr, index, type: "s32" };
          continue;
        }
        break;
      }
      if (this.matchToken("SYMBOL", "(")) {
        const args = [];
        if (this.currentToken.value !== ")") {
          do {
            args.push(this.parseExpression());
          } while (this.matchToken("SYMBOL", ","));
        }
        this.expectToken("SYMBOL", ")");
        expr = {
          kind: "call_indirect",
          callee: expr,
          args,
          type: "s32",
          paramTypes: args.map(() => "s32")
        };
        continue;
      }
      break;
    }
    return expr;
  }
}

// src/optimizer.ts
class Optimizer {
  optimizeProgram(program) {
    return {
      kind: "program",
      body: program.body.map((stmt) => this.optimizeStatement(stmt))
    };
  }
  optimizeStatement(stmt) {
    switch (stmt.kind) {
      case "var_decl":
      case "const_decl":
        return {
          ...stmt,
          initExpr: stmt.initExpr ? foldConstants(stmt.initExpr) : null
        };
      case "short_var_decl":
        return {
          ...stmt,
          expr: foldConstants(stmt.expr)
        };
      case "multi_decl":
        return {
          ...stmt,
          expr: foldConstants(stmt.expr)
        };
      case "assign":
        return {
          ...stmt,
          expr: foldConstants(stmt.expr)
        };
      case "expression_stmt":
        return {
          ...stmt,
          expr: foldConstants(stmt.expr)
        };
      case "return":
        return {
          ...stmt,
          values: stmt.values.map((v) => foldConstants(v))
        };
      case "if":
        return {
          ...stmt,
          condition: foldConstants(stmt.condition),
          thenBlock: stmt.thenBlock.map((s) => this.optimizeStatement(s)),
          elseBlock: Array.isArray(stmt.elseBlock) ? stmt.elseBlock.map((s) => this.optimizeStatement(s)) : stmt.elseBlock ? this.optimizeStatement(stmt.elseBlock) : null
        };
      case "for":
        return {
          ...stmt,
          init: stmt.init ? this.optimizeStatement(stmt.init) : null,
          condition: stmt.condition ? foldConstants(stmt.condition) : null,
          post: stmt.post ? this.optimizeStatement(stmt.post) : null,
          body: stmt.body.map((s) => this.optimizeStatement(s))
        };
      case "for_in":
        return {
          ...stmt,
          iterable: foldConstants(stmt.iterable),
          body: stmt.body.map((s) => this.optimizeStatement(s))
        };
      case "switch":
        return {
          ...stmt,
          expr: foldConstants(stmt.expr),
          cases: stmt.cases.map((c) => ({
            patterns: c.patterns,
            body: c.body.map((s) => this.optimizeStatement(s))
          })),
          defaultBody: stmt.defaultBody ? stmt.defaultBody.map((s) => this.optimizeStatement(s)) : null
        };
      case "region":
        return {
          ...stmt,
          body: stmt.body.map((s) => this.optimizeStatement(s))
        };
      case "function_def":
        return {
          ...stmt,
          body: stmt.body.map((s) => this.optimizeStatement(s))
        };
      case "break":
      case "continue":
      case "import_decl":
      case "struct_def":
      default:
        return stmt;
    }
  }
}

// src/types.ts
function fieldSize(info) {
  return info.kind === "struct" ? 4 : info.size;
}
function fieldAlign(info) {
  return info.kind === "struct" ? 4 : info.align;
}
function computeStructLayout(registry, fields, selfName) {
  let offset = 0;
  let maxAlign = 1;
  const fieldLayouts = [];
  for (const field of fields) {
    let align;
    let size;
    if (selfName !== undefined && field.type === selfName) {
      align = 4;
      size = 4;
    } else {
      const info = registry.getType(field.type);
      align = fieldAlign(info);
      size = fieldSize(info);
    }
    offset = Math.ceil(offset / align) * align;
    fieldLayouts.push({
      name: field.name,
      type: field.type,
      offset,
      mathType: field.mathType
    });
    offset += size;
    if (align > maxAlign)
      maxAlign = align;
  }
  const size = Math.max(1, Math.ceil(offset / maxAlign) * maxAlign);
  return { size, align: maxAlign, fields: fieldLayouts };
}

class TypeRegistry {
  types = new Map;
  constructor() {
    this.registerPrimitive("void", 0, 1);
    this.registerPrimitive("i32", 4, 4);
    this.registerPrimitive("i64", 8, 8);
    this.registerPrimitive("f32", 4, 4);
    this.registerPrimitive("f64", 8, 8);
    this.registerPrimitive("byte", 1, 1);
    this.registerPrimitive("int", 4, 4);
    this.registerPrimitive("long", 8, 8);
    this.registerPrimitive("float", 4, 4);
    this.registerPrimitive("double", 8, 8);
    this.registerPrimitive("bool", 1, 1);
    this.registerPrimitive("char", 1, 1);
    this.registerPrimitive("i8", 1, 1);
    this.registerPrimitive("u8", 1, 1);
    this.registerPrimitive("i16", 2, 2);
    this.registerPrimitive("u16", 2, 2);
    this.registerPrimitive("u32", 4, 4);
    this.registerPrimitive("u64", 8, 8);
    this.registerPrimitive("int8_t", 1, 1);
    this.registerPrimitive("uint8_t", 1, 1);
    this.registerPrimitive("int16_t", 2, 2);
    this.registerPrimitive("uint16_t", 2, 2);
    this.registerPrimitive("int32_t", 4, 4);
    this.registerPrimitive("uint32_t", 4, 4);
    this.registerPrimitive("int64_t", 8, 8);
    this.registerPrimitive("uint64_t", 8, 8);
    this.registerPrimitive("size_t", 4, 4);
    this.registerPrimitive("ssize_t", 4, 4);
    this.registerPrimitive("intptr_t", 4, 4);
    this.registerPrimitive("uintptr_t", 4, 4);
    this.registerPrimitive("usize", 4, 4);
    this.registerPrimitive("isize", 4, 4);
    this.registerPrimitive("uintptr", 4, 4);
    this.registerPrimitive("string", 4, 4);
  }
  registerPrimitive(name, size, align) {
    if (this.types.has(name))
      throw new Error(`El tipo '${name}' ya está registrado`);
    this.types.set(name, { kind: "primitive", size, align, name });
  }
  registerStruct(name, fields) {
    if (this.types.has(name))
      throw new Error(`El tipo '${name}' ya está registrado`);
    const layout = computeStructLayout(this, fields, name);
    this.types.set(name, {
      kind: "struct",
      size: layout.size,
      align: layout.align,
      fields: layout.fields,
      name
    });
  }
  registerArray(name, elementType, length) {
    if (this.types.has(name))
      throw new Error(`El tipo '${name}' ya está registrado`);
    const elemInfo = this.getType(elementType);
    this.types.set(name, {
      kind: "array",
      size: elemInfo.size * length,
      align: elemInfo.align,
      elementType,
      length,
      name
    });
  }
  getType(name) {
    if (name.endsWith("*")) {
      const pointerTo = name.slice(0, -1);
      return { kind: "primitive", size: 4, align: 4, pointerTo, name };
    }
    const info = this.types.get(name);
    if (!info)
      throw new Error(`Tipo no registrado: ${name}`);
    return info;
  }
  hasType(name) {
    if (name.endsWith("*"))
      return true;
    return this.types.has(name);
  }
  getFieldType(structName, fieldName) {
    const structInfo = this.getType(structName);
    if (structInfo.kind !== "struct")
      throw new Error(`'${structName}' no es un struct`);
    const field = structInfo.fields?.find((f) => f.name === fieldName);
    if (!field)
      throw new Error(`Campo '${fieldName}' no encontrado en '${structName}'`);
    return this.getType(field.type);
  }
  resolvePath(structName, path) {
    let currentTypeName = structName;
    const visited = new Set;
    for (const fieldName of path) {
      const fieldType = this.getFieldType(currentTypeName, fieldName);
      if (fieldType.pointerTo) {
        currentTypeName = fieldType.pointerTo;
      } else if (fieldType.kind === "struct") {
        currentTypeName = fieldType.name;
      } else {
        return fieldType;
      }
      if (visited.has(currentTypeName))
        throw new Error(`Ciclo detectado en ruta: ${currentTypeName}`);
      visited.add(currentTypeName);
    }
    return this.getType(currentTypeName);
  }
  visitStruct(structName, visitor, depth = 0, visited = new Set) {
    const structInfo = this.getType(structName);
    if (structInfo.kind !== "struct")
      return;
    if (visited.has(structName))
      return;
    visited.add(structName);
    for (const field of structInfo.fields ?? []) {
      visitor(field, depth);
      const fieldType = this.getType(field.type);
      if (fieldType.kind === "struct") {
        this.visitStruct(field.type, visitor, depth + 1, visited);
      } else if (fieldType.pointerTo) {
        this.visitStruct(fieldType.pointerTo, visitor, depth + 1, visited);
      }
    }
  }
  getSize(name) {
    return this.getType(name).size;
  }
  getAlign(name) {
    return this.getType(name).align;
  }
  toJSON() {
    const result = {};
    for (const [key, value] of this.types.entries()) {
      result[key] = value;
    }
    return result;
  }
}

// src/mangler.ts
function mangleType(t) {
  if (typeof t === "string") {
    switch (t) {
      case "s32":
        return "i";
      case "u32":
        return "u";
      case "s64":
        return "I";
      case "u64":
        return "U";
      case "f32":
        return "f";
      case "f64":
        return "F";
      case "bool":
        return "b";
      case "string":
        return "s";
      case "null":
        return "n";
      case "tuple":
        return "T";
      default: {
        const _exhaustive = t;
        throw new Error(`mangleType: string type no reconocido: ${String(_exhaustive)}`);
      }
    }
  }
  switch (t.kind) {
    case "array":
      return "A" + mangleType(t.elementType) + "." + t.length;
    case "dynarray":
      return "D" + mangleType(t.elementType);
    case "struct": {
      if (t.name === "") {
        const fieldCodes = t.fields.map((f) => `${f.name}:${mangleType(f.type)}`).join(";");
        return "S{" + fieldCodes + "}";
      }
      return "S" + t.name;
    }
    case "pointer":
      return "P" + mangleType(t.targetType);
    case "function": {
      const params = t.paramTypes.map(mangleType).join(".");
      const returns = t.returnTypes.map(mangleType).join(".");
      return "F" + params + "~" + returns;
    }
    default: {
      const _exhaustive = t;
      throw new Error(`mangleType: kind no reconocido: ${JSON.stringify(_exhaustive)}`);
    }
  }
}
function mangleFunctionName(name, paramTypes) {
  if (paramTypes.length === 0)
    return `${name}__v`;
  return `${name}__${paramTypes.map(mangleType).join("_")}`;
}
function functionParamsEqual(a, b) {
  if (a.paramTypes.length !== b.paramTypes.length)
    return false;
  for (let i = 0;i < a.paramTypes.length; i++) {
    if (!mathTypesEqual(a.paramTypes[i], b.paramTypes[i]))
      return false;
  }
  return true;
}
function mathTypesEqual(a, b) {
  if (a === b)
    return true;
  if (typeof a === "object" && typeof b === "object") {
    if (a.kind === "struct" && b.kind === "struct") {
      if (a.name === "" && b.name === "") {
        if (a.fields.length !== b.fields.length)
          return false;
        for (let i = 0;i < a.fields.length; i++) {
          if (a.fields[i].name !== b.fields[i].name)
            return false;
          if (!mathTypesEqual(a.fields[i].type, b.fields[i].type))
            return false;
        }
        return true;
      }
      return a.name === b.name;
    }
    if (a.kind === "array" && b.kind === "array") {
      return a.length === b.length && mathTypesEqual(a.elementType, b.elementType);
    }
    if (a.kind === "dynarray" && b.kind === "dynarray") {
      return mathTypesEqual(a.elementType, b.elementType);
    }
    if (a.kind === "pointer" && b.kind === "pointer") {
      return mathTypesEqual(a.targetType, b.targetType);
    }
    if (a.kind === "function" && b.kind === "function") {
      if (a.paramTypes.length !== b.paramTypes.length)
        return false;
      for (let i = 0;i < a.paramTypes.length; i++) {
        if (!mathTypesEqual(a.paramTypes[i], b.paramTypes[i]))
          return false;
      }
      if (a.returnTypes.length !== b.returnTypes.length)
        return false;
      for (let i = 0;i < a.returnTypes.length; i++) {
        if (!mathTypesEqual(a.returnTypes[i], b.returnTypes[i]))
          return false;
      }
      return true;
    }
  }
  return false;
}

// src/typeSystem.ts
var signedness2 = {
  s32: "signed",
  u32: "unsigned",
  s64: "signed",
  u64: "unsigned",
  f32: "float",
  f64: "float"
};
var width2 = {
  s32: 32,
  u32: 32,
  s64: 64,
  u64: 64,
  f32: 32,
  f64: 64
};
var arithInfo = {
  s32: { signed: true, isFloat: false, width: 32 },
  u32: { signed: false, isFloat: false, width: 32 },
  s64: { signed: true, isFloat: false, width: 64 },
  u64: { signed: false, isFloat: false, width: 64 },
  f32: { signed: true, isFloat: true, width: 32 },
  f64: { signed: true, isFloat: true, width: 64 }
};
function maxArithmeticType2(a, b) {
  if (!arithInfo[a] || !arithInfo[b]) {
    throw new Error(`maxArithmeticType: se esperaban tipos aritméticos, se recibió (${String(a)}, ${String(b)})`);
  }
  if (a === b)
    return a;
  if (signedness2[a] === "float" || signedness2[b] === "float") {
    if (a === "f64" || b === "f64")
      return "f64";
    return "f32";
  }
  const aSigned = signedness2[a] === "signed";
  const bSigned = signedness2[b] === "signed";
  const resultWidth = Math.max(width2[a], width2[b]);
  const resultSigned = aSigned && bSigned;
  return resultWidth === 32 ? resultSigned ? "s32" : "u32" : resultSigned ? "s64" : "u64";
}
function sizeOfType(t) {
  if (t === "null")
    return 4;
  if (t === "tuple")
    return 4;
  if (typeof t === "string") {
    switch (t) {
      case "s32":
      case "u32":
      case "bool":
      case "string":
        return 4;
      case "s64":
      case "u64":
        return 8;
      case "f32":
        return 4;
      case "f64":
        return 8;
      default:
        return 4;
    }
  } else if (t.kind === "array") {
    return sizeOfType(t.elementType) * t.length;
  } else if (t.kind === "dynarray") {
    return 4;
  } else if (t.kind === "pointer") {
    return 4;
  } else if (t.kind === "struct") {
    return 4;
  } else if (t.kind === "function") {
    return 4;
  }
  return 4;
}
function typesEqual(a, b) {
  if (!a || !b)
    return false;
  if (a === "tuple" || b === "tuple")
    return false;
  if (a === "null" || b === "null") {
    const isComposite = (t) => typeof t !== "string" || t === "null";
    return isComposite(a) && isComposite(b);
  }
  if (typeof a === "string" && typeof b === "string") {
    return a === b;
  }
  if (typeof a !== "string" && typeof b !== "string") {
    if (a.kind === "array" && b.kind === "array") {
      return typesEqual(a.elementType, b.elementType) && a.length === b.length;
    }
    if (a.kind === "dynarray" && b.kind === "dynarray") {
      return typesEqual(a.elementType, b.elementType);
    }
    if (a.kind === "pointer" && b.kind === "pointer") {
      if (typeof a.targetType === "object" && typeof b.targetType === "object" && a.targetType.kind === "struct" && b.targetType.kind === "struct") {
        return a.targetType.name === b.targetType.name;
      }
      return typesEqual(a.targetType, b.targetType);
    }
    if (a.kind === "struct" && b.kind === "struct") {
      return a.name === b.name;
    }
    if (a.kind === "function" && b.kind === "function") {
      if (a.paramTypes.length !== b.paramTypes.length)
        return false;
      for (let i = 0;i < a.paramTypes.length; i++) {
        if (!typesEqual(a.paramTypes[i], b.paramTypes[i]))
          return false;
      }
      if (a.returnTypes.length !== b.returnTypes.length)
        return false;
      for (let i = 0;i < a.returnTypes.length; i++) {
        if (!typesEqual(a.returnTypes[i], b.returnTypes[i]))
          return false;
      }
      return true;
    }
  }
  return false;
}
function semanticToWasmType(semType) {
  if (semType === "null")
    return "i32";
  if (semType === "tuple")
    throw new Error("No se puede convertir una tupla a tipo WASM");
  if (typeof semType !== "string") {
    if (semType.kind === "function")
      return "i32";
    if (semType.kind === "array" || semType.kind === "dynarray" || semType.kind === "pointer" || semType.kind === "struct")
      return "i32";
  }
  switch (semType) {
    case "s32":
    case "u32":
    case "bool":
    case "string":
      return "i32";
    case "s64":
    case "u64":
      return "i64";
    case "f32":
      return "f32";
    case "f64":
      return "f64";
    default:
      throw new Error(`Tipo semántico no soportado: ${semType}`);
  }
}

// src/semantic.ts
class DiagnosticBag {
  errors = [];
  error(msg) {
    this.errors.push(msg);
  }
  hasErrors() {
    return this.errors.length > 0;
  }
  getErrors() {
    return [...this.errors];
  }
}

class ScopeControl {
  scopes = [];
  counter = 0;
  lambdaBoundaries = [];
  constructor() {
    this.scopes.push(new Map);
  }
  isGlobal() {
    return this.scopes.length === 1;
  }
  pushScope() {
    this.scopes.push(new Map);
  }
  popScope() {
    if (this.scopes.length <= 1)
      throw new Error("No se puede eliminar el ámbito global");
    this.scopes.pop();
  }
  pushLambdaBoundary() {
    this.lambdaBoundaries.push(this.scopes.length);
  }
  popLambdaBoundary() {
    this.lambdaBoundaries.pop();
  }
  isInsideInnermostLambda(scopeIndex) {
    if (this.lambdaBoundaries.length === 0)
      return true;
    const boundary = this.lambdaBoundaries[this.lambdaBoundaries.length - 1];
    return scopeIndex >= boundary;
  }
  lookupWithBoundary(name) {
    for (let i = this.scopes.length - 1;i >= 0; i--) {
      const info = this.scopes[i].get(name);
      if (info)
        return { info, isCapture: !this.isInsideInnermostLambda(i) };
    }
    throw new Error(`Identificador no definido: '${name}'`);
  }
  declare(name, type, mutable, global = false, boxed = false) {
    const target = global ? this.scopes[0] : this.scopes[this.scopes.length - 1];
    if (target.has(name))
      throw new Error(`El identificador '${name}' ya está declarado en este ámbito`);
    const uniqueName = `$${name}_${this.counter++}`;
    target.set(name, { uniqueName, type, mutable, isGlobal: global, boxed });
    return uniqueName;
  }
  declareFunction(name, mangledName, fnType, global) {
    const target = global ? this.scopes[0] : this.scopes[this.scopes.length - 1];
    const existing = target.get(name);
    if (existing) {
      if (!existing.isFunctionDecl)
        throw new Error(`'${name}' ya está declarado como variable; no se puede sobrecargar`);
      for (const ov of existing.overloads) {
        if (functionParamsEqual(ov.type, fnType)) {
          if (ov.mangledName === mangledName)
            return;
          throw new Error(`Sobrecarga duplicada de '${name}'`);
        }
      }
      existing.overloads.push({ mangledName, type: fnType });
    } else {
      target.set(name, {
        uniqueName: mangledName,
        type: fnType,
        mutable: false,
        isGlobal: global,
        isFunctionDecl: true,
        overloads: [{ mangledName, type: fnType }]
      });
    }
  }
  lookup(name) {
    for (let i = this.scopes.length - 1;i >= 0; i--) {
      if (this.scopes[i].has(name))
        return this.scopes[i].get(name);
    }
    throw new Error(`Identificador no definido: '${name}'`);
  }
  has(name) {
    for (let i = this.scopes.length - 1;i >= 0; i--)
      if (this.scopes[i].has(name))
        return true;
    return false;
  }
  checkMutable(name) {
    if (!this.lookup(name).mutable)
      throw new Error(`No se puede reasignar un valor a una constante '${name}'`);
  }
}

class SemanticAnalyzer {
  scopeControl;
  typeRegistry;
  currentReturnTypes = [];
  _structCache = new Map;
  currentLevel = 0;
  slotLevels = new Map;
  hoistedFunctions = [];
  anonStructs = new Map;
  anonStructCounter = 0;
  lambdaCounter = 0;
  captureStack = [];
  capturedNamesStack = [];
  typeAliases = new Map;
  methodsByStruct = new Map;
  syntheticCounter = 0;
  diagnostics = new DiagnosticBag;
  error(msg) {
    this.diagnostics.error(msg);
  }
  constructor() {
    this.scopeControl = new ScopeControl;
    this.typeRegistry = new TypeRegistry;
    this.registerBuiltins();
  }
  registerBuiltins() {
    const s32 = "s32";
    const builtins = [
      { name: "arena_save", params: [], ret: s32 },
      { name: "arena_restore", params: [s32], ret: null },
      { name: "arena_alloc", params: [s32], ret: s32 },
      { name: "memcpy", params: [s32, s32, s32], ret: null },
      { name: "mem_read32", params: [s32], ret: s32 },
      { name: "mem_write32", params: [s32, s32], ret: null },
      { name: "mem_read8", params: [s32], ret: s32 },
      { name: "mem_write8", params: [s32, s32], ret: null },
      { name: "str_len", params: ["string"], ret: s32 },
      { name: "str_concat", params: ["string", "string"], ret: "string" },
      { name: "str_eq", params: ["string", "string"], ret: "bool" },
      { name: "str_ne", params: ["string", "string"], ret: "bool" }
    ];
    for (const b of builtins) {
      const fnType = {
        kind: "function",
        paramTypes: b.params,
        returnTypes: b.ret ? [b.ret] : []
      };
      this.scopeControl.declareFunction(b.name, b.name, fnType, true);
    }
  }
  isHeapType(t) {
    if (t === "string")
      return true;
    if (typeof t !== "object")
      return false;
    return t.kind === "struct" || t.kind === "dynarray" || t.kind === "pointer";
  }
  exprLevel(expr) {
    const t = expr.type;
    if (!this.isHeapType(t)) {
      if (expr.kind !== "closure" && expr.kind !== "function_ref")
        return 0;
    }
    switch (expr.kind) {
      case "variable": {
        const v = expr;
        return this.slotLevels.get(v.uniqueName) ?? 0;
      }
      case "struct_literal":
      case "array_literal":
      case "make_array":
      case "call":
      case "call_indirect":
      case "closure":
      case "function_ref":
        return this.currentLevel;
      case "binary": {
        const b = expr;
        if (b.op === "+" && b.left.type === "string")
          return this.currentLevel;
        return Math.max(this.exprLevel(b.left), this.exprLevel(b.right));
      }
      case "cast":
        return this.exprLevel(expr.operand);
      case "unary":
        return this.exprLevel(expr.operand);
      case "struct_access":
        return this.exprLevel(expr.base);
      case "array_access":
        return this.exprLevel(expr.base);
      default:
        return 0;
    }
  }
  checkEscape(value, slotLevel, ctx) {
    if (!value)
      return;
    const lvl = this.exprLevel(value);
    if (lvl > slotLevel) {
      this.error(`Escapado de región en ${ctx}: el valor proviene del nivel ${lvl}, ` + `pero se almacena en un slot del nivel ${slotLevel}`);
    }
  }
  slotLevelOfTarget(target) {
    let root = target;
    while (root.kind === "struct_access" || root.kind === "array_access")
      root = root.base;
    if (root.kind !== "variable")
      return 0;
    return this.slotLevels.get(root.uniqueName) ?? 0;
  }
  allPathsReturn(stmts) {
    for (const s of stmts) {
      if (s.kind === "return")
        return true;
      if (s.kind === "if" && s.elseBlock) {
        const thenR = this.allPathsReturn(s.thenBlock);
        const elseR = Array.isArray(s.elseBlock) ? this.allPathsReturn(s.elseBlock) : this.allPathsReturn([s.elseBlock]);
        if (thenR && elseR)
          return true;
      }
      if (s.kind === "switch" && s.defaultBody !== null) {
        const casesReturn = s.cases.every((c) => this.allPathsReturn(c.body));
        const defaultReturns = this.allPathsReturn(s.defaultBody);
        if (casesReturn && defaultReturns)
          return true;
      }
      if (s.kind === "region" && this.allPathsReturn(s.body))
        return true;
    }
    return false;
  }
  currentCapturedNames() {
    return this.capturedNamesStack.length > 0 ? this.capturedNamesStack[this.capturedNamesStack.length - 1] : null;
  }
  findCapturedVars(fnParams, fnBody) {
    const captured = new Set;
    const scopes = [new Map];
    let lambdaDepth = 0;
    const declare = (name) => {
      scopes[scopes.length - 1].set(name, lambdaDepth);
    };
    const lookup = (name) => {
      for (let i = scopes.length - 1;i >= 0; i--) {
        const v = scopes[i].get(name);
        if (v !== undefined)
          return v;
      }
      return;
    };
    const pushScope = () => scopes.push(new Map);
    const popScope = () => scopes.pop();
    pushScope();
    for (const p of fnParams)
      declare(p.name);
    const visitExpr = (node) => {
      if (!node || typeof node !== "object")
        return;
      if (Array.isArray(node)) {
        for (const x of node)
          visitExpr(x);
        return;
      }
      if (node.kind === "variable" && typeof node.name === "string") {
        const d = lookup(node.name);
        if (d !== undefined && d < lambdaDepth)
          captured.add(node.name);
        return;
      }
      if (node.kind === "function_literal") {
        lambdaDepth++;
        pushScope();
        for (const p of node.params)
          declare(p.name);
        for (const s of node.body)
          visitStmt(s);
        popScope();
        lambdaDepth--;
        return;
      }
      for (const key of Object.keys(node)) {
        if (key === "kind")
          continue;
        visitExpr(node[key]);
      }
    };
    const visitStmt = (stmt) => {
      if (!stmt || typeof stmt !== "object")
        return;
      switch (stmt.kind) {
        case "var_decl":
        case "const_decl":
          if (stmt.initExpr)
            visitExpr(stmt.initExpr);
          declare(stmt.name);
          return;
        case "short_var_decl":
          visitExpr(stmt.expr);
          declare(stmt.name);
          return;
        case "multi_decl":
          visitExpr(stmt.expr);
          for (const n of stmt.names) {
            if (n !== "_")
              declare(n);
          }
          return;
        case "assign":
          visitExpr(stmt.target);
          visitExpr(stmt.expr);
          return;
        case "function_def":
          return;
        case "if":
          visitExpr(stmt.condition);
          pushScope();
          for (const s of stmt.thenBlock)
            visitStmt(s);
          popScope();
          if (stmt.elseBlock) {
            pushScope();
            if (Array.isArray(stmt.elseBlock)) {
              for (const s of stmt.elseBlock)
                visitStmt(s);
            } else
              visitStmt(stmt.elseBlock);
            popScope();
          }
          return;
        case "for":
          pushScope();
          if (stmt.init)
            visitStmt(stmt.init);
          if (stmt.condition)
            visitExpr(stmt.condition);
          if (stmt.post)
            visitStmt(stmt.post);
          for (const s of stmt.body)
            visitStmt(s);
          popScope();
          return;
        case "for_in":
          visitExpr(stmt.iterable);
          pushScope();
          for (const n of stmt.varNames) {
            if (n !== "_")
              declare(n);
          }
          for (const s of stmt.body)
            visitStmt(s);
          popScope();
          return;
        case "switch":
          visitExpr(stmt.expr);
          for (const c of stmt.cases) {
            pushScope();
            for (const s of c.body)
              visitStmt(s);
            popScope();
          }
          if (stmt.defaultBody) {
            pushScope();
            for (const s of stmt.defaultBody)
              visitStmt(s);
            popScope();
          }
          return;
        case "region":
          pushScope();
          for (const s of stmt.body)
            visitStmt(s);
          popScope();
          return;
        case "return":
          for (const v of stmt.values)
            visitExpr(v);
          return;
        case "expression_stmt":
          visitExpr(stmt.expr);
          return;
      }
    };
    for (const s of fnBody)
      visitStmt(s);
    popScope();
    return captured;
  }
  analyzeProgram(program) {
    this.currentLevel = 0;
    this.hoistedFunctions = [];
    this.anonStructs.clear();
    this.anonStructCounter = 0;
    this.lambdaCounter = 0;
    this.captureStack = [];
    this.capturedNamesStack = [];
    this.methodsByStruct.clear();
    this.diagnostics = new DiagnosticBag;
    this.typeAliases.clear();
    this.collectTypeAliases(program.body);
    this.collectStructs(program.body);
    this.collectFunctions(program.body);
    for (const stmt of program.body)
      this.analyzeStatement(stmt);
    for (const h of this.hoistedFunctions)
      program.body.push(h);
    this.hoistedFunctions = [];
    if (this.diagnostics.hasErrors()) {
      const errs = this.diagnostics.getErrors();
      throw new Error(`Se encontraron ${errs.length} error${errs.length === 1 ? "" : "es"}:
` + errs.map((e, i) => `  ${i + 1}. ${e}`).join(`
`));
    }
  }
  collectTypeAliases(stmts) {
    for (const s of stmts) {
      if (s.kind !== "type_alias")
        continue;
      this.typeAliases.set(s.name, s.targetType);
    }
  }
  collectStructs(stmts) {
    for (const s of stmts) {
      if (s.kind !== "struct_def")
        continue;
      this.typeRegistry.registerStruct(s.name, s.fields.map((f) => {
        const regName = this.registryTypeName(f.type);
        if (typeof f.type === "object" && f.type.kind === "function") {
          return { name: f.name, type: regName, mathType: f.type };
        }
        return { name: f.name, type: regName };
      }));
      const structType = this.structTypeFromRegistry(s.name);
      this.scopeControl.declare(s.name, structType, false, true);
    }
  }
  collectFunctions(stmts) {
    for (const s of stmts) {
      if (s.kind !== "function_def")
        continue;
      const fn = s;
      let receiverType = null;
      if (fn.receiver) {
        const rt = this.resolveType(fn.receiver);
        if (typeof rt !== "object" || rt.kind !== "struct") {
          this.error(`Receiver de '${fn.name}' debe ser un struct, se obtuvo ${this.typeName(rt)}`);
          continue;
        }
        if (rt.name === "") {
          this.error(`Receiver de '${fn.name}' no puede ser un struct anónimo`);
          continue;
        }
        receiverType = rt;
      }
      const userParamTypes = fn.params.map((p) => this.resolveType(p.type));
      const allParamTypes = receiverType ? [receiverType, ...userParamTypes] : userParamTypes;
      const returnTypes = fn.returnTypes.map((t) => this.resolveType(t));
      const fnType = {
        kind: "function",
        paramTypes: allParamTypes,
        returnTypes
      };
      const mangledName = mangleFunctionName(fn.name, allParamTypes);
      if (receiverType) {
        this.registerMethod(receiverType.name, fn.name, mangledName, fnType);
      }
      this.scopeControl.declareFunction(fn.name, mangledName, fnType, true);
    }
  }
  registerMethod(receiverName, methodName, mangled, type) {
    let methods = this.methodsByStruct.get(receiverName);
    if (!methods) {
      methods = new Map;
      this.methodsByStruct.set(receiverName, methods);
    }
    methods.set(methodName, { mangledName: mangled, type });
  }
  lookupMethod(receiverName, methodName) {
    return this.methodsByStruct.get(receiverName)?.get(methodName);
  }
  analyzeStatement(stmt) {
    switch (stmt.kind) {
      case "import_decl": {
        const id = stmt;
        const paramTypes = id.params.map((p) => this.resolveType(p.type));
        const fnType = {
          kind: "function",
          paramTypes,
          returnTypes: id.returnType ? [this.resolveType(id.returnType)] : []
        };
        this.scopeControl.declareFunction(id.name, id.name, fnType, true);
        break;
      }
      case "const_decl":
      case "var_decl": {
        const isGlobal = this.scopeControl.isGlobal();
        const initType = stmt.initExpr ? this.resolveType(this.analyzeExpression(stmt.initExpr)) : null;
        const declaredType = stmt.inferred ? null : this.resolveType(stmt.type);
        let finalType = declaredType ?? initType ?? this.resolveType(stmt.type);
        if (initType !== null && declaredType !== null && !this.isAssignableType(initType, declaredType)) {
          const contextualized = stmt.initExpr !== null && this.contextualizeArrayLiteral(stmt.initExpr, declaredType);
          if (contextualized)
            finalType = declaredType;
          else if (!(initType === "null" && typeof declaredType === "object")) {
            this.error(`Type mismatch: no se puede asignar ${this.typeName(initType)} a '${stmt.name}' ` + `de tipo ${this.typeName(declaredType)}`);
          }
        }
        stmt.type = finalType;
        const isBoxed = !isGlobal && (this.currentCapturedNames()?.has(stmt.name) ?? false);
        const uniqueName = this.scopeControl.declare(stmt.name, finalType, !stmt.isConst, isGlobal, isBoxed);
        stmt.uniqueName = uniqueName;
        stmt.isGlobal = isGlobal;
        if (isBoxed)
          stmt.boxed = true;
        const slotLvl = isGlobal ? 0 : this.currentLevel;
        this.slotLevels.set(uniqueName, slotLvl);
        if (stmt.initExpr) {
          this.checkEscape(stmt.initExpr, slotLvl, `inicialización de '${stmt.name}'`);
        }
        break;
      }
      case "short_var_decl": {
        const inferredType = this.resolveType(this.analyzeExpression(stmt.expr));
        const isBoxed = this.currentCapturedNames()?.has(stmt.name) ?? false;
        const uniqueName = this.scopeControl.declare(stmt.name, inferredType, true, false, isBoxed);
        stmt.uniqueName = uniqueName;
        if (isBoxed)
          stmt.boxed = true;
        this.slotLevels.set(uniqueName, this.currentLevel);
        this.checkEscape(stmt.expr, this.currentLevel, `:= '${stmt.name}'`);
        break;
      }
      case "multi_decl": {
        const md = stmt;
        const firstType = this.resolveType(this.analyzeExpression(md.expr));
        const returnTypes = md.expr.returnTypes;
        if (!returnTypes || returnTypes.length === 0) {
          this.error(`multi-declaración requiere una llamada con múltiples valores ` + `de retorno; se obtuvo un valor de tipo ${this.typeName(firstType)}`);
          break;
        }
        if (returnTypes.length !== md.names.length) {
          this.error(`multi-declaración de ${md.names.length} nombres pero ` + `la expresión retorna ${returnTypes.length} valores`);
          break;
        }
        md.uniqueNames = [];
        for (let i = 0;i < md.names.length; i++) {
          if (md.names[i] === "_") {
            md.uniqueNames.push(null);
            continue;
          }
          const uniqueName = this.scopeControl.declare(md.names[i], returnTypes[i], true, false, false);
          md.uniqueNames.push(uniqueName);
          this.slotLevels.set(uniqueName, this.currentLevel);
        }
        break;
      }
      case "assign": {
        const targetType = this.resolveType(this.analyzeExpression(stmt.target));
        let root = stmt.target;
        while (root.kind === "struct_access" || root.kind === "array_access") {
          root = root.base;
        }
        if (root.kind === "capture_access") {} else {
          if (root.kind !== "variable") {
            this.error("El destino no es modificable");
            break;
          }
          this.scopeControl.checkMutable(root.name);
          const slotLvl = this.slotLevelOfTarget(stmt.target);
          this.checkEscape(stmt.expr, slotLvl, `asignación a '${root.name}'`);
        }
        const exprType = this.resolveType(this.analyzeExpression(stmt.expr));
        if (!this.isAssignableType(exprType, targetType)) {
          const contextualized = this.contextualizeArrayLiteral(stmt.expr, targetType);
          if (!contextualized && !(exprType === "null" && typeof targetType !== "string")) {
            this.error(`Type mismatch en asignación: no se puede asignar ${this.typeName(exprType)} ` + `a un destino de tipo ${this.typeName(targetType)}`);
          }
        }
        break;
      }
      case "function_def":
        this.analyzeFunction(stmt);
        break;
      case "struct_def":
      case "type_alias":
        break;
      case "if": {
        const condType = this.analyzeExpression(stmt.condition);
        if (condType !== "bool")
          this.error("La condición del if debe ser bool");
        this.scopeControl.pushScope();
        for (const s of stmt.thenBlock)
          this.analyzeStatement(s);
        this.scopeControl.popScope();
        if (stmt.elseBlock) {
          this.scopeControl.pushScope();
          if (Array.isArray(stmt.elseBlock))
            for (const s of stmt.elseBlock)
              this.analyzeStatement(s);
          else
            this.analyzeStatement(stmt.elseBlock);
          this.scopeControl.popScope();
        }
        break;
      }
      case "for": {
        this.scopeControl.pushScope();
        if (stmt.init)
          this.analyzeStatement(stmt.init);
        if (stmt.condition) {
          const condType = this.analyzeExpression(stmt.condition);
          if (condType !== "bool")
            this.error("La condición del for debe ser bool");
        }
        if (stmt.post)
          this.analyzeStatement(stmt.post);
        for (const s of stmt.body)
          this.analyzeStatement(s);
        this.scopeControl.popScope();
        break;
      }
      case "for_in": {
        const iterableType = this.resolveType(this.analyzeExpression(stmt.iterable));
        if (typeof iterableType !== "object" || iterableType.kind !== "array" && iterableType.kind !== "dynarray") {
          this.error(`for ... in: se esperaba un array, se obtuvo ${this.typeName(iterableType)}`);
          break;
        }
        const names = stmt.varNames;
        if (names.length < 1 || names.length > 2) {
          this.error(`for ... in: se esperan 1 o 2 variables, se recibieron ${names.length}`);
          break;
        }
        let indexName = null;
        let valueName;
        if (names.length === 1) {
          valueName = names[0];
        } else {
          indexName = names[0];
          valueName = names[1];
        }
        this.scopeControl.pushScope();
        let indexUnique = null;
        if (indexName !== null && indexName !== "_") {
          indexUnique = this.scopeControl.declare(indexName, "s32", true, false);
          this.slotLevels.set(indexUnique, this.currentLevel);
        }
        let valueUnique = null;
        if (valueName !== "_") {
          valueUnique = this.scopeControl.declare(valueName, iterableType.elementType, true, false);
          this.slotLevels.set(valueUnique, this.currentLevel);
        }
        stmt.indexUnique = indexUnique;
        stmt.valueUnique = valueUnique;
        stmt.elementType = iterableType.elementType;
        for (const s of stmt.body)
          this.analyzeStatement(s);
        this.scopeControl.popScope();
        break;
      }
      case "switch": {
        const condType = this.resolveType(this.analyzeExpression(stmt.expr));
        stmt.exprType = condType;
        if (!this.isComparableType(condType)) {
          this.error(`switch: tipo no comparable (${this.typeName(condType)})`);
          break;
        }
        for (const c of stmt.cases) {
          for (const pattern of c.patterns) {
            this.analyzePattern(pattern, condType);
          }
          this.scopeControl.pushScope();
          for (const s of c.body)
            this.analyzeStatement(s);
          this.scopeControl.popScope();
        }
        if (stmt.defaultBody) {
          this.scopeControl.pushScope();
          for (const s of stmt.defaultBody)
            this.analyzeStatement(s);
          this.scopeControl.popScope();
        }
        break;
      }
      case "region": {
        this.scopeControl.pushScope();
        this.currentLevel++;
        try {
          for (const s of stmt.body)
            this.analyzeStatement(s);
        } finally {
          this.currentLevel--;
          this.scopeControl.popScope();
        }
        break;
      }
      case "break":
      case "continue":
        break;
      case "return": {
        const actualTypes = stmt.values.map((v) => this.resolveType(this.analyzeExpression(v)));
        const expected = this.currentReturnTypes;
        if (expected.length === 0) {
          if (actualTypes.length > 0) {
            this.error("La función no debe retornar valores");
          }
        } else {
          if (actualTypes.length !== expected.length) {
            this.error(`Se esperaban ${expected.length} valores de retorno, ` + `se recibieron ${actualTypes.length}`);
          } else {
            for (let i = 0;i < expected.length; i++) {
              if (!this.isAssignableType(actualTypes[i], expected[i])) {
                if (!(actualTypes[i] === "null" && typeof expected[i] !== "string")) {
                  this.error(`Tipo de retorno ${i} incorrecto: se esperaba ` + `${this.typeName(expected[i])}, se obtuvo ${this.typeName(actualTypes[i])}`);
                }
              }
            }
          }
        }
        for (const v of stmt.values)
          this.checkEscape(v, 0, "return");
        break;
      }
      case "expression_stmt":
        this.analyzeExpression(stmt.expr);
        break;
    }
  }
  analyzeFunction(fn) {
    let receiverType = null;
    if (fn.receiver) {
      const rt = this.resolveType(fn.receiver);
      if (typeof rt !== "object" || rt.kind !== "struct") {
        this.error(`Receiver de '${fn.name}' debe ser un struct, se obtuvo ${this.typeName(rt)}`);
        return;
      }
      receiverType = rt;
    }
    if (receiverType) {
      for (const p of fn.params) {
        if (p.name === "self") {
          this.error(`'self' está reservado como receiver en el método '${fn.name}'; ` + `renombrá el parámetro.`);
        }
      }
    }
    const userParamTypes = fn.params.map((p) => this.resolveType(p.type));
    const allParamTypes = receiverType ? [receiverType, ...userParamTypes] : userParamTypes;
    const returnTypes = fn.returnTypes.map((t) => this.resolveType(t));
    const fnType = {
      kind: "function",
      paramTypes: allParamTypes,
      returnTypes
    };
    const sourceName = fn.name;
    const isLambda = sourceName.startsWith("__lambda_");
    const mangledName = isLambda ? sourceName : mangleFunctionName(sourceName, allParamTypes);
    if (isLambda) {
      this.scopeControl.declareFunction(sourceName, mangledName, fnType, false);
    } else if (!receiverType) {
      this.scopeControl.declareFunction(sourceName, mangledName, fnType, this.scopeControl.isGlobal());
    }
    fn.mangledName = mangledName;
    const prevReturn = this.currentReturnTypes;
    const prevLevel = this.currentLevel;
    this.currentReturnTypes = returnTypes;
    this.currentLevel = 0;
    this.scopeControl.pushScope();
    if (receiverType) {
      const selfUnique = this.scopeControl.declare("self", receiverType, true, false, false);
      fn.params = [
        { name: "self", type: receiverType, uniqueName: selfUnique },
        ...fn.params
      ];
      this.slotLevels.set(selfUnique, 0);
    }
    const capturedNames = this.findCapturedVars(fn.params, fn.body);
    this.capturedNamesStack.push(capturedNames);
    const userParamStart = receiverType ? 1 : 0;
    for (let i = userParamStart;i < fn.params.length; i++) {
      const param = fn.params[i];
      const paramType = this.resolveType(param.type);
      const isBoxed = capturedNames.has(param.name);
      const uniqueName = this.scopeControl.declare(param.name, paramType, true, false, isBoxed);
      param.uniqueName = uniqueName;
      if (isBoxed)
        param.boxed = true;
      this.slotLevels.set(uniqueName, 0);
    }
    for (const stmt of fn.body)
      this.analyzeStatement(stmt);
    if (fn.returnTypes.length > 0 && !this.allPathsReturn(fn.body)) {
      this.error(`La función '${sourceName}' no retorna en todos los caminos ` + `(se esperaba${returnTypes.length > 1 ? "n " : " "}` + `${returnTypes.map((t) => this.typeName(t)).join(", ")})`);
    }
    this.currentReturnTypes = prevReturn;
    this.currentLevel = prevLevel;
    this.scopeControl.popScope();
    this.capturedNamesStack.pop();
    fn.name = mangledName;
  }
  isComparableType(t) {
    if (this.isArithmetic(t))
      return true;
    if (t === "string" || t === "bool")
      return true;
    if (typeof t === "object") {
      if (t.kind === "struct" || t.kind === "pointer" || t.kind === "dynarray" || t.kind === "function")
        return true;
    }
    return false;
  }
  analyzePattern(pattern, targetType) {
    const t = this.resolveType(targetType);
    switch (pattern.kind) {
      case "wildcard":
        return;
      case "const": {
        if (pattern.type === "null") {
          if (!(typeof t === "object" && (t.kind === "pointer" || t.kind === "struct" || t.kind === "dynarray" || t.kind === "function"))) {
            this.error(`Patrón null no válido para tipo ${this.typeName(t)}`);
          }
          return;
        }
        if (!this.isArithmetic(t)) {
          this.error(`Patrón numérico no válido para tipo ${this.typeName(t)}`);
          return;
        }
        return;
      }
      case "string":
        if (t !== "string") {
          this.error(`Patrón string no válido para tipo ${this.typeName(t)}`);
        }
        return;
      case "bool":
        if (t !== "bool") {
          this.error(`Patrón bool no válido para tipo ${this.typeName(t)}`);
        }
        return;
      case "struct": {
        if (typeof t !== "object" || t.kind !== "struct") {
          this.error(`Patrón struct no válido para tipo ${this.typeName(t)}`);
          return;
        }
        if (t.name !== pattern.structName) {
          this.error(`Patrón struct '${pattern.structName}' no coincide con '${t.name}'`);
          return;
        }
        const provided = new Set(pattern.fields.map((f) => f.name));
        for (const fp of pattern.fields) {
          const field = t.fields.find((f) => f.name === fp.name);
          if (!field) {
            this.error(`Campo '${fp.name}' no existe en '${t.name}'`);
            continue;
          }
          this.analyzePattern(fp.pattern, field.type);
        }
        const missing = t.fields.filter((f) => !provided.has(f.name)).map((f) => f.name);
        if (missing.length > 0) {
          this.error(`Faltan campos en patrón '${t.name}': ${missing.join(", ")}. ` + `Usa '_' como wildcard para los que no te importan.`);
        }
        return;
      }
    }
  }
  analyzeExpression(node) {
    switch (node.kind) {
      case "const":
        return node.type === "null" ? "null" : node.type;
      case "variable": {
        let lookup;
        try {
          lookup = this.scopeControl.lookupWithBoundary(node.name);
        } catch (e) {
          this.error(`Identificador no definido: '${node.name}'`);
          node.type = "s32";
          return "s32";
        }
        const { info: symbol, isCapture } = lookup;
        if (symbol.isFunctionDecl) {
          const ovs = symbol.overloads;
          if (ovs.length !== 1) {
            this.error(`'${node.name}' tiene ${ovs.length} sobrecargas; especifica los tipos para usarla como valor`);
            node.type = "s32";
            return "s32";
          }
          node.kind = "function_ref";
          node.name = ovs[0].mangledName;
          node.type = ovs[0].type;
          delete node.isGlobal;
          delete node.uniqueName;
          return ovs[0].type;
        }
        if (isCapture && !symbol.isGlobal && this.captureStack.length > 0) {
          const frame = this.captureStack[this.captureStack.length - 1];
          let cap = frame.captures.get(symbol.uniqueName);
          if (!cap) {
            cap = {
              name: node.name,
              sourceUniqueName: symbol.uniqueName,
              type: symbol.type,
              index: frame.captures.size,
              boxed: !!symbol.boxed
            };
            frame.captures.set(symbol.uniqueName, cap);
          }
          node.kind = "capture_access";
          node.captureIndex = cap.index;
          node.type = cap.type;
          delete node.name;
          delete node.uniqueName;
          delete node.isGlobal;
          return cap.type;
        }
        node.uniqueName = symbol.uniqueName;
        node.isGlobal = symbol.isGlobal;
        if (symbol.boxed)
          node.boxed = true;
        node.type = symbol.type;
        return node.type;
      }
      case "string":
        return "string";
      case "bool":
        return "bool";
      case "capture_access":
        return node.type;
      case "unary": {
        const operandType = this.analyzeExpression(node.operand);
        if (node.op === "not" && operandType !== "bool") {
          this.error("El operador '!' requiere un bool");
        }
        if (node.op === "bitnot" && (operandType === "f32" || operandType === "f64")) {
          this.error("El operador '~' no acepta flotantes");
        }
        node.type = operandType;
        return operandType;
      }
      case "binary": {
        const leftType = this.analyzeExpression(node.left);
        const rightType = this.analyzeExpression(node.right);
        const result = this.inferBinaryType(node.op, leftType, rightType);
        node.type = result;
        return result;
      }
      case "cast": {
        const from = this.resolveType(this.analyzeExpression(node.operand));
        node.oldType = from;
        const to = this.resolveType(node.newType);
        if (this.typesEqual(from, to))
          return to;
        const stringBridge = from === "string" && (to === "s32" || to === "u32") || to === "string" && (from === "s32" || from === "u32");
        if (stringBridge)
          return to;
        const boolBridge = from === "bool" && (to === "s32" || to === "u32") || to === "bool" && (from === "s32" || from === "u32");
        if (boolBridge)
          return to;
        if (this.isArithmetic(from) && this.isArithmetic(to))
          return to;
        this.error(`cast no soportado: ${this.typeName(from)} → ${this.typeName(to)}`);
        return to;
      }
      case "make_array": {
        const n = node;
        const resolvedType = this.resolveType(n.typeExpr);
        if (typeof resolvedType !== "object" || resolvedType.kind !== "dynarray") {
          this.error(`make() requiere un dynarray, se obtuvo ${this.typeName(resolvedType)}`);
          return "s32";
        }
        const lenType = this.analyzeExpression(n.lengthExpr);
        if (lenType !== "s32" && lenType !== "u32") {
          this.error("make() requiere longitud entera");
        }
        n.elementType = resolvedType.elementType;
        n.type = resolvedType;
        return resolvedType;
      }
      case "call": {
        if (node.name === "is_same" && node.args.length === 2 && !this.scopeControl.has("is_same")) {
          const at1 = this.resolveType(this.analyzeExpression(node.args[0]));
          const at2 = this.resolveType(this.analyzeExpression(node.args[1]));
          if (at1 === "null" && at2 === "null") {
            node.paramTypes = ["null", "null"];
            node.type = "bool";
            node.isSameBuiltin = true;
            return "bool";
          }
          let common;
          if (at1 === "null")
            common = at2;
          else if (at2 === "null")
            common = at1;
          else if (this.typesEqual(at1, at2))
            common = at1;
          else {
            this.error(`is_same: los dos args deben ser del mismo tipo ` + `(${this.typeName(at1)} vs ${this.typeName(at2)})`);
            return "s32";
          }
          const isRef = typeof common === "string" ? common === "string" : common.kind === "struct" || common.kind === "pointer" || common.kind === "dynarray" || common.kind === "function";
          if (!isRef) {
            this.error(`is_same requiere un tipo referencia (struct, pointer, ` + `dynarray, string, fn); se obtuvo ${this.typeName(common)}. ` + `Usa '==' para primitivos.`);
            return "s32";
          }
          node.paramTypes = [common, common];
          node.type = "bool";
          node.isSameBuiltin = true;
          return "bool";
        }
        if (node.name === "len" && node.args.length === 1 && !this.scopeControl.has("len")) {
          const at = this.resolveType(this.analyzeExpression(node.args[0]));
          if (typeof at !== "object" || at.kind !== "array" && at.kind !== "dynarray") {
            this.error(`len() requiere un array/dynarray, se obtuvo ${this.typeName(at)}`);
            return "s32";
          }
          node.paramTypes = [at];
          node.type = "s32";
          node.isLenBuiltin = true;
          return "s32";
        }
        const argTypes = [];
        for (const arg of node.args)
          argTypes.push(this.resolveType(this.analyzeExpression(arg)));
        if (!this.scopeControl.has(node.name)) {
          this.error(`Identificador no definido: '${node.name}'`);
          return "s32";
        }
        const sym = this.scopeControl.lookup(node.name);
        if (sym.isFunctionDecl) {
          const overloads = sym.overloads;
          let chosen;
          for (const ov of overloads)
            if (this.argTypesMatchExact(ov.type.paramTypes, argTypes)) {
              chosen = ov;
              break;
            }
          if (!chosen) {
            for (const ov of overloads)
              if (this.argTypesMatchWithBridge(ov.type.paramTypes, argTypes)) {
                chosen = ov;
                break;
              }
          }
          if (!chosen) {
            this.error(`Ninguna sobrecarga de '${node.name}' coincide con ` + `[${argTypes.map((t) => this.typeName(t)).join(", ")}]`);
            return "s32";
          }
          for (let i = 0;i < argTypes.length; i++) {
            const at = argTypes[i];
            const et = this.resolveType(chosen.type.paramTypes[i]);
            const bridge = at === "string" && (et === "s32" || et === "u32") || et === "string" && (at === "s32" || at === "u32");
            if (!this.isAssignableType(at, et) && !bridge) {
              this.error(`Argumento ${i} de '${node.name}': se esperaba ` + `${this.typeName(et)}, se obtuvo ${this.typeName(at)}`);
            }
          }
          node.name = chosen.mangledName;
          node.paramTypes = chosen.type.paramTypes;
          node.returnTypes = chosen.type.returnTypes;
          const returnType = chosen.type.returnTypes[0];
          if (returnType === undefined) {
            node.type = "void";
            return "s32";
          }
          node.type = returnType;
          return returnType;
        }
        if (typeof sym.type === "object" && sym.type.kind === "function") {
          const calleeVar = { kind: "variable", name: node.name, type: "s32" };
          const calleeType = this.resolveType(this.analyzeExpression(calleeVar));
          const params = calleeType.paramTypes.map((t) => this.resolveType(t));
          if (argTypes.length !== params.length) {
            this.error(`Llamada indirecta a '${node.name}': se esperaban ${params.length} ` + `args, se recibieron ${argTypes.length}`);
            return "s32";
          }
          for (let i = 0;i < argTypes.length; i++) {
            const at = argTypes[i];
            const et = params[i];
            const bridge = at === "string" && (et === "s32" || et === "u32") || et === "string" && (at === "s32" || at === "u32");
            if (!this.isAssignableType(at, et) && !bridge) {
              this.error(`Argumento ${i} de la llamada indirecta a '${node.name}': ` + `se esperaba ${this.typeName(et)}, se obtuvo ${this.typeName(at)}`);
            }
          }
          const c = node;
          c.kind = "call_indirect";
          c.callee = calleeVar;
          c.paramTypes = calleeType.paramTypes;
          c.returnTypes = calleeType.returnTypes;
          const returnType = calleeType.returnTypes[0];
          delete c.name;
          if (returnType === undefined) {
            c.type = "void";
            return "s32";
          }
          c.type = returnType;
          return returnType;
        }
        this.error(`'${node.name}' no es una función`);
        return "s32";
      }
      case "call_indirect": {
        if (node.callee.kind === "struct_access") {
          const sa = node.callee;
          const baseTypeRaw = this.resolveType(this.analyzeExpression(sa.base));
          const baseType = typeof baseTypeRaw === "object" && baseTypeRaw.kind === "pointer" ? this.resolveType(baseTypeRaw.targetType) : baseTypeRaw;
          if (typeof baseType === "object" && baseType.kind === "struct" && baseType.name !== "") {
            const field = baseType.fields.find((c) => c.name === sa.fieldName);
            if (!field) {
              const method = this.lookupMethod(baseType.name, sa.fieldName);
              if (method) {
                const argTypes = [];
                for (const arg of node.args) {
                  argTypes.push(this.resolveType(this.analyzeExpression(arg)));
                }
                const expected = method.type.paramTypes.slice(1);
                if (argTypes.length !== expected.length) {
                  this.error(`Método '${sa.fieldName}' de '${baseType.name}': ` + `se esperaban ${expected.length} argumentos, ` + `se recibieron ${argTypes.length}`);
                  return "s32";
                }
                for (let i = 0;i < argTypes.length; i++) {
                  if (!this.isAssignableType(argTypes[i], expected[i])) {
                    this.error(`Argumento ${i} de '${sa.fieldName}': se esperaba ` + `${this.typeName(expected[i])}, se obtuvo ${this.typeName(argTypes[i])}`);
                  }
                }
                const newCall = node;
                newCall.kind = "call";
                newCall.name = method.mangledName;
                newCall.args = [sa.base, ...node.args];
                newCall.paramTypes = method.type.paramTypes;
                newCall.returnTypes = method.type.returnTypes;
                newCall.type = method.type.returnTypes[0] ?? "void";
                return newCall.type;
              }
              this.error(`Campo '${sa.fieldName}' no existe en '${baseType.name}'`);
              return "s32";
            }
          }
        }
        const calleeType = this.resolveType(this.analyzeExpression(node.callee));
        if (typeof calleeType !== "object" || calleeType.kind !== "function") {
          this.error("call_indirect: el callee no es de tipo función");
          return "s32";
        }
        const fnType = calleeType;
        const params = fnType.paramTypes.map((t) => this.resolveType(t));
        if (node.args.length !== params.length) {
          this.error(`Llamada indirecta: se esperaban ${params.length} argumentos, ` + `se recibieron ${node.args.length}`);
          return "s32";
        }
        for (let i = 0;i < node.args.length; i++) {
          const at = this.resolveType(this.analyzeExpression(node.args[i]));
          const et = params[i];
          const bridge = at === "string" && (et === "s32" || et === "u32") || et === "string" && (at === "s32" || at === "u32");
          if (!this.isAssignableType(at, et) && !bridge) {
            this.error(`Argumento ${i} de la llamada indirecta: se esperaba ` + `${this.typeName(et)}, se obtuvo ${this.typeName(at)}`);
          }
        }
        node.paramTypes = fnType.paramTypes;
        node.returnTypes = fnType.returnTypes;
        const returnType = fnType.returnTypes[0];
        if (returnType === undefined) {
          node.type = "void";
          return "s32";
        }
        node.type = returnType;
        return returnType;
      }
      case "function_literal": {
        const fnNode = node;
        const paramTypes = fnNode.params.map((p) => this.resolveType(p.type));
        const returnTypes = fnNode.returnTypes ? fnNode.returnTypes.map((t) => this.resolveType(t)) : [];
        const fnType = { kind: "function", paramTypes, returnTypes };
        const name = `__lambda_${this.lambdaCounter++}`;
        this.scopeControl.declareFunction(name, name, fnType, false);
        const prevReturn = this.currentReturnTypes;
        const prevLevel = this.currentLevel;
        this.currentReturnTypes = returnTypes;
        const frame = { captures: new Map };
        this.captureStack.push(frame);
        this.scopeControl.pushLambdaBoundary();
        this.scopeControl.pushScope();
        for (const p of fnNode.params) {
          const uniqueName = this.scopeControl.declare(p.name, this.resolveType(p.type), true, false);
          p.uniqueName = uniqueName;
          this.slotLevels.set(uniqueName, prevLevel);
        }
        for (const s of fnNode.body)
          this.analyzeStatement(s);
        this.scopeControl.popScope();
        this.scopeControl.popLambdaBoundary();
        this.captureStack.pop();
        if (fnNode.returnTypes.length > 0 && !this.allPathsReturn(fnNode.body)) {
          this.error(`La lambda '${name}' no retorna en todos los caminos ` + `(se esperaba${returnTypes.length > 1 ? "n " : " "}` + `${returnTypes.map((t) => this.typeName(t)).join(", ")})`);
        }
        this.currentReturnTypes = prevReturn;
        this.currentLevel = prevLevel;
        this.hoistedFunctions.push({
          kind: "function_def",
          name,
          params: fnNode.params,
          returnTypes: fnNode.returnTypes,
          body: fnNode.body,
          mangledName: name
        });
        const captures = [];
        for (const cap of frame.captures.values())
          captures.push(cap);
        captures.sort((a, b) => a.index - b.index);
        const captureExprs = captures.map((cap) => ({
          kind: "variable",
          name: cap.name,
          uniqueName: cap.sourceUniqueName,
          isGlobal: false,
          type: cap.type
        }));
        node.kind = "closure";
        node.codeName = name;
        node.captures = captures;
        node.captureExprs = captureExprs;
        node.type = fnType;
        delete node.params;
        delete node.returnTypes;
        delete node.body;
        return fnType;
      }
      case "closure":
        return node.type;
      case "struct_literal": {
        const structName = node.structName;
        if (structName === "__anon") {
          const inferredFields = [];
          const provided = new Set;
          for (const field of node.fields) {
            if (provided.has(field.name)) {
              this.error(`Campo '${field.name}' repetido en struct anónimo`);
              continue;
            }
            provided.add(field.name);
            const t = this.resolveType(this.analyzeExpression(field.value));
            inferredFields.push({ name: field.name, type: t });
          }
          const canonical = this.canonicalizeAnonStruct(inferredFields);
          node.structName = canonical;
          const st = this.structTypeFromRegistry(canonical);
          node.type = st;
          return st;
        }
        const structType = this.structTypeFromRegistry(structName);
        const providedFields = new Set;
        for (const field of node.fields) {
          if (providedFields.has(field.name)) {
            this.error(`Campo '${field.name}' repetido en '${structName}'`);
            continue;
          }
          providedFields.add(field.name);
          const expectedField = structType.fields.find((c) => c.name === field.name);
          if (!expectedField) {
            this.error(`Campo '${field.name}' no existe en '${structName}'`);
            continue;
          }
          const actualType = this.resolveType(this.analyzeExpression(field.value));
          if (!this.isAssignableType(actualType, expectedField.type)) {
            if (!(actualType === "null" && typeof expectedField.type !== "string")) {
              this.error(`Tipo incorrecto para '${structName}.${field.name}': ` + `se esperaba ${this.typeName(expectedField.type)}, ` + `se obtuvo ${this.typeName(actualType)}`);
            }
          }
        }
        const missing = structType.fields.filter((f) => !providedFields.has(f.name)).map((f) => f.name);
        if (missing.length > 0) {
          this.error(`Faltan campos en '${structName}': ${missing.join(", ")}`);
        }
        node.type = structType;
        return structType;
      }
      case "struct_access": {
        const expressionType = this.resolveType(this.analyzeExpression(node.base));
        const baseType = typeof expressionType === "object" && expressionType.kind === "pointer" ? this.resolveType(expressionType.targetType) : expressionType;
        if (typeof baseType !== "object" || baseType.kind !== "struct") {
          this.error(`No se puede acceder al campo '${node.fieldName}' en un valor ` + `de tipo ${this.typeName(baseType)}`);
          node.type = "s32";
          return "s32";
        }
        const field = baseType.fields.find((c) => c.name === node.fieldName);
        if (field) {
          node.resolvedBaseType = baseType;
          node.type = this.resolveType(field.type);
          return node.type;
        }
        if (baseType.name !== "") {
          const method = this.lookupMethod(baseType.name, node.fieldName);
          if (method) {
            return this.buildMethodValue(node, baseType, method);
          }
        }
        this.error(`Campo '${node.fieldName}' no existe en '${baseType.name}'`);
        node.type = "s32";
        return "s32";
      }
      case "array_literal": {
        let elemType = "s32";
        if (node.elements.length > 0)
          elemType = this.resolveType(this.analyzeExpression(node.elements[0]));
        for (let i = 1;i < node.elements.length; i++) {
          const t = this.resolveType(this.analyzeExpression(node.elements[i]));
          if (!this.typesEqual(t, elemType)) {
            this.error(`Array literal: elemento ${i} tiene tipo ${this.typeName(t)}, ` + `esperado ${this.typeName(elemType)}`);
          }
        }
        node.type = { kind: "array", elementType: elemType, length: node.elements.length };
        return node.type;
      }
      case "array_access": {
        const baseType = this.resolveType(this.analyzeExpression(node.base));
        if (typeof baseType !== "object" || baseType.kind !== "array" && baseType.kind !== "dynarray") {
          this.error("array_access sobre no-array");
          node.type = "s32";
          return "s32";
        }
        this.analyzeExpression(node.index);
        node.type = baseType.elementType;
        return node.type;
      }
      case "increment": {
        const increment = node;
        const operand = increment.operand;
        const operandType = this.resolveType(this.analyzeExpression(operand));
        let root = operand;
        while (root.kind === "struct_access" || root.kind === "array_access")
          root = root.base;
        if (root.kind === "capture_access") {} else {
          if (root.kind !== "variable") {
            this.error(`El operando de '${increment.operator}' debe ser modificable`);
            increment.type = "s32";
            return "s32";
          }
          this.scopeControl.checkMutable(root.name);
        }
        if (!this.isArithmetic(operandType)) {
          this.error(`El operador '${increment.operator}' requiere un tipo numérico; ` + `se obtuvo ${this.typeName(operandType)}`);
          increment.type = "s32";
          return "s32";
        }
        increment.type = operandType;
        return operandType;
      }
      default:
        return "s32";
    }
  }
  buildMethodValue(node, receiverType, method) {
    const fullFnType = method.type;
    const valueParams = fullFnType.paramTypes.slice(1);
    const returnTypes = fullFnType.returnTypes;
    const thunkName = `__lambda_${this.lambdaCounter++}`;
    const baseExpr = node.base;
    const selfRef = {
      kind: "capture_access",
      captureIndex: 0,
      type: receiverType
    };
    const paramNames = valueParams.map((_, i) => `a${i}`);
    const paramUniqueNames = paramNames.map((n) => `$${n}_${this.syntheticCounter++}`);
    const paramRefs = paramNames.map((n, i) => ({
      kind: "variable",
      name: n,
      uniqueName: paramUniqueNames[i],
      isGlobal: false,
      type: valueParams[i]
    }));
    const innerCall = {
      kind: "call",
      name: method.mangledName,
      args: [selfRef, ...paramRefs],
      paramTypes: fullFnType.paramTypes,
      returnTypes: fullFnType.returnTypes,
      type: returnTypes[0] ?? "void"
    };
    const thunkBody = returnTypes.length > 0 ? [{ kind: "return", values: [innerCall] }] : [{ kind: "expression_stmt", expr: innerCall }];
    const thunkFn = {
      kind: "function_def",
      name: thunkName,
      params: valueParams.map((t, i) => ({
        name: paramNames[i],
        type: t,
        uniqueName: paramUniqueNames[i]
      })),
      returnTypes,
      body: thunkBody,
      mangledName: thunkName
    };
    this.hoistedFunctions.push(thunkFn);
    const valueFnType = {
      kind: "function",
      paramTypes: valueParams,
      returnTypes
    };
    node.kind = "closure";
    node.codeName = thunkName;
    node.captures = [{
      name: "self",
      sourceUniqueName: "method_value_self",
      type: receiverType,
      index: 0
    }];
    node.captureExprs = [baseExpr];
    node.type = valueFnType;
    delete node.fieldName;
    delete node.resolvedBaseType;
    return valueFnType;
  }
  canonicalizeAnonStruct(fields) {
    const key = fields.map((f) => `${f.name}:${mangleType(f.type)}`).join(";");
    let canonical = this.anonStructs.get(key);
    if (canonical)
      return canonical;
    canonical = `__anon_${this.anonStructCounter++}`;
    this.anonStructs.set(key, canonical);
    this.typeRegistry.registerStruct(canonical, fields.map((f) => {
      const regName = this.registryTypeName(f.type);
      if (typeof f.type === "object" && f.type.kind === "function") {
        return { name: f.name, type: regName, mathType: f.type };
      }
      return { name: f.name, type: regName };
    }));
    return canonical;
  }
  argTypesMatchExact(params, args) {
    if (params.length !== args.length)
      return false;
    for (let i = 0;i < params.length; i++) {
      if (!this.isAssignableType(this.resolveType(args[i]), this.resolveType(params[i])))
        return false;
    }
    return true;
  }
  argTypesMatchWithBridge(params, args) {
    if (params.length !== args.length)
      return false;
    for (let i = 0;i < params.length; i++) {
      const p = this.resolveType(params[i]);
      const a = this.resolveType(args[i]);
      if (this.isAssignableType(a, p))
        continue;
      const bridge = a === "string" && (p === "s32" || p === "u32") || p === "string" && (a === "s32" || a === "u32");
      if (!bridge)
        return false;
    }
    return true;
  }
  inferBinaryType(op, leftType, rightType) {
    if ((leftType === "null" || rightType === "null") && (op === "==" || op === "!="))
      return "bool";
    if (typeof leftType === "object" && leftType.kind === "struct" && typeof rightType === "object" && rightType.kind === "struct" && this.typesEqual(leftType, rightType) && (op === "==" || op === "!=")) {
      return "bool";
    }
    if (leftType === "bool" && rightType === "bool") {
      if (["&&", "||", "==", "!="].includes(op))
        return "bool";
      this.error(`Operador '${op}' no permitido entre booleanos`);
      return "bool";
    }
    if (typeof leftType === "string" && typeof rightType === "string") {
      if (["==", "!=", "<", "<=", ">", ">="].includes(op))
        return "bool";
      return leftType;
    }
    const arithOps = new Set(["+", "-", "*", "/", "%", "&", "|", "^", "<<", ">>", "==", "!=", "<", "<=", ">", ">="]);
    if (arithOps.has(op) && this.isArithmetic(leftType) && this.isArithmetic(rightType)) {
      if (["==", "!=", "<", "<=", ">", ">="].includes(op))
        return "bool";
      return this.promoteArith(leftType, rightType);
    }
    this.error(`Operación '${op}' no permitida entre ${this.typeName(leftType)} y ${this.typeName(rightType)}`);
    return "s32";
  }
  isArithmetic(t) {
    return t === "s32" || t === "u32" || t === "s64" || t === "u64" || t === "f32" || t === "f64";
  }
  promoteArith(a, b) {
    if (a === b)
      return a;
    const isFloat = (x) => x === "f32" || x === "f64";
    if (isFloat(a) || isFloat(b))
      return a === "f64" || b === "f64" ? "f64" : "f32";
    const w = (x) => x === "s64" || x === "u64" ? 64 : 32;
    const s = (x) => x === "s32" || x === "s64";
    const width = Math.max(w(a), w(b));
    const signed = s(a) && s(b);
    return width === 32 ? signed ? "s32" : "u32" : signed ? "s64" : "u64";
  }
  registryTypeName(type, seen) {
    if (typeof type === "object" && type.kind === "struct") {
      const alias = this.typeAliases.get(type.name);
      if (alias !== undefined) {
        const s = seen ?? new Set;
        if (s.has(type.name)) {
          throw new Error(`Ciclo de alias detectado: ${[...s, type.name].join(" → ")}`);
        }
        s.add(type.name);
        return this.registryTypeName(alias, s);
      }
    }
    if (typeof type !== "object") {
      if (type === "s32")
        return "i32";
      if (type === "s64")
        return "i64";
      return type;
    }
    if (type.kind === "struct") {
      if (type.name === "") {
        return this.canonicalizeAnonStruct(type.fields.map((f) => ({ name: f.name, type: this.resolveType(f.type) })));
      }
      return type.name;
    }
    if (type.kind === "pointer")
      return `${this.registryTypeName(type.targetType, seen)}*`;
    if (type.kind === "function")
      return "i32";
    if (type.kind === "dynarray") {
      const elemName = this.registryTypeName(type.elementType, seen);
      const dynName = `[]${elemName}`;
      if (!this.typeRegistry.hasType(dynName)) {
        this.typeRegistry.registerPrimitive(dynName, 4, 4);
      }
      return dynName;
    }
    if (type.kind === "array") {
      const elemName = this.registryTypeName(type.elementType, seen);
      const arrayName = `[${elemName};${type.length}]`;
      if (!this.typeRegistry.hasType(arrayName)) {
        this.typeRegistry.registerArray(arrayName, elemName, type.length);
      }
      return arrayName;
    }
    throw new Error(`Tipo no compatible con campos de struct: ${this.typeName(type)}`);
  }
  resolveType(type, seen) {
    if (typeof type !== "object")
      return type;
    if (type.kind === "struct") {
      const rawTarget = this.typeAliases.get(type.name);
      if (rawTarget !== undefined) {
        const s = seen ?? new Set;
        if (s.has(type.name)) {
          throw new Error(`Ciclo de alias detectado: ${[...s, type.name].join(" → ")}`);
        }
        s.add(type.name);
        return this.resolveType(rawTarget, s);
      }
      if (type.name === "") {
        const normalized = type.fields.map((f) => ({
          name: f.name,
          type: this.resolveType(f.type, seen)
        }));
        const canonical = this.canonicalizeAnonStruct(normalized);
        return this.structTypeFromRegistry(canonical);
      }
      return this.structTypeFromRegistry(type.name);
    }
    if (type.kind === "array") {
      const elem = this.resolveType(type.elementType, seen);
      if (elem === type.elementType)
        return type;
      return { kind: "array", elementType: elem, length: type.length };
    }
    if (type.kind === "dynarray") {
      const elem = this.resolveType(type.elementType, seen);
      if (elem === type.elementType)
        return type;
      return { kind: "dynarray", elementType: elem };
    }
    if (type.kind === "pointer") {
      const target = this.resolveType(type.targetType, seen);
      if (target === type.targetType)
        return type;
      return { kind: "pointer", targetType: target };
    }
    if (type.kind === "function") {
      return {
        kind: "function",
        paramTypes: type.paramTypes.map((t) => this.resolveType(t, seen)),
        returnTypes: type.returnTypes.map((t) => this.resolveType(t, seen))
      };
    }
    return type;
  }
  structTypeFromRegistry(name) {
    const cached = this._structCache.get(name);
    if (cached)
      return cached;
    const info = this.typeRegistry.getType(name);
    if (info.kind !== "struct")
      throw new Error(`'${name}' no es un struct`);
    const st = { kind: "struct", name, size: info.size, align: info.align, fields: [] };
    this._structCache.set(name, st);
    for (const field of info.fields ?? []) {
      st.fields.push({
        name: field.name,
        type: field.mathType ?? this.mathTypeFromRegistryName(field.type),
        offset: field.offset
      });
    }
    return st;
  }
  mathTypeFromRegistryName(name) {
    switch (name) {
      case "i32":
        return "s32";
      case "i64":
        return "s64";
      case "u32":
      case "u64":
      case "f32":
      case "f64":
      case "bool":
      case "string":
        return name;
    }
    if (name.startsWith("[]")) {
      const elemName = name.slice(2);
      return { kind: "dynarray", elementType: this.mathTypeFromRegistryName(elemName) };
    }
    if (name.startsWith("[") && name.endsWith("]")) {
      const inner = name.slice(1, -1);
      const semi = inner.lastIndexOf(";");
      if (semi === -1)
        throw new Error(`Nombre de array inválido: '${name}'`);
      const elemName = inner.slice(0, semi);
      const length = parseInt(inner.slice(semi + 1), 10);
      if (!Number.isInteger(length) || length <= 0) {
        throw new Error(`Longitud de array inválida en '${name}'`);
      }
      return { kind: "array", elementType: this.mathTypeFromRegistryName(elemName), length };
    }
    const info = this.typeRegistry.getType(name);
    if (info.kind === "struct")
      return this.structTypeFromRegistry(name);
    if (info.kind === "array") {
      const elemName = info.elementType;
      const length = info.length;
      return { kind: "array", elementType: this.mathTypeFromRegistryName(elemName), length };
    }
    if (info.pointerTo) {
      const targetName = info.pointerTo;
      const targetInfo = this.typeRegistry.getType(targetName);
      const targetType = targetInfo.kind === "struct" ? { kind: "struct", name: targetName, fields: [], size: targetInfo.size, align: targetInfo.align } : this.mathTypeFromRegistryName(targetName);
      return { kind: "pointer", targetType };
    }
    throw new Error(`Tipo de campo no soportado: '${name}'`);
  }
  typesEqual(left, right) {
    if (left === right)
      return true;
    if (typeof left !== "object" || typeof right !== "object")
      return false;
    if (left.kind === "pointer" && right.kind === "pointer") {
      return this.typesEqual(this.resolveType(left.targetType), this.resolveType(right.targetType));
    }
    if (left.kind === "struct" && right.kind === "struct") {
      if (left.name === "" && right.name === "") {
        if (left.fields.length !== right.fields.length)
          return false;
        for (let i = 0;i < left.fields.length; i++) {
          if (left.fields[i].name !== right.fields[i].name)
            return false;
          if (!this.typesEqual(left.fields[i].type, right.fields[i].type))
            return false;
        }
        return true;
      }
      return left.name === right.name;
    }
    if (left.kind === "array" && right.kind === "array") {
      return left.length === right.length && this.typesEqual(left.elementType, right.elementType);
    }
    if (left.kind === "dynarray" && right.kind === "dynarray") {
      return this.typesEqual(left.elementType, right.elementType);
    }
    if (left.kind === "function" && right.kind === "function") {
      return left.paramTypes.length === right.paramTypes.length && left.returnTypes.length === right.returnTypes.length && left.paramTypes.every((t, i) => this.typesEqual(t, right.paramTypes[i])) && left.returnTypes.every((t, i) => this.typesEqual(t, right.returnTypes[i]));
    }
    return false;
  }
  typeName(type) {
    if (typeof type === "object") {
      if (type.kind === "struct") {
        if (type.name === "") {
          return `struct { ${type.fields.map((f) => `${f.name}: ${this.typeName(f.type)}`).join("; ")} }`;
        }
        return type.name;
      }
      if (type.kind === "pointer")
        return `*${this.typeName(type.targetType)}`;
      if (type.kind === "function")
        return "(fn)";
      if (type.kind === "array")
        return `[${this.typeName(type.elementType)}; ${type.length}]`;
      if (type.kind === "dynarray")
        return `[${this.typeName(type.elementType)}]`;
    }
    return String(type);
  }
  contextualizeArrayLiteral(expr, target) {
    if (expr.kind !== "array_literal" || typeof target !== "object" || target.kind !== "array" && target.kind !== "dynarray")
      return false;
    if (target.kind === "array" && target.length !== expr.elements.length)
      return false;
    for (const element of expr.elements) {
      const targetElement = target.elementType;
      if (element.kind === "array_literal" && typeof targetElement === "object" && (targetElement.kind === "array" || targetElement.kind === "dynarray")) {
        if (!this.contextualizeArrayLiteral(element, targetElement))
          return false;
        continue;
      }
      const actualType = this.resolveType(element.type);
      if (!this.isAssignableType(actualType, targetElement))
        return false;
    }
    expr.type = target;
    return true;
  }
  isAssignableType(source, target) {
    if (this.typesEqual(source, target))
      return true;
    if (typeof source === "string" && typeof target === "string") {
      const fi = arithInfo[source];
      const ti = arithInfo[target];
      if (fi && ti) {
        if (!fi.isFloat && !ti.isFloat && fi.width < ti.width)
          return true;
        if (!fi.isFloat && ti.isFloat && target === "f64" && fi.width <= 32)
          return true;
        if (fi.isFloat && ti.isFloat && source === "f32" && target === "f64")
          return true;
      }
    }
    if (source === "null" && typeof target === "object" && (target.kind === "pointer" || target.kind === "struct" || target.kind === "dynarray" || target.kind === "function"))
      return true;
    if (typeof source === "object" && source.kind === "struct" && typeof target === "object" && target.kind === "pointer") {
      return this.typesEqual(source, target.targetType);
    }
    if (typeof source === "object" && source.kind === "pointer" && typeof target === "object" && target.kind === "pointer") {
      return this.typesEqual(source.targetType, target.targetType);
    }
    if (typeof source === "object" && source.kind === "array" && typeof target === "object" && target.kind === "dynarray") {
      return this.isAssignableType(source.elementType, target.elementType);
    }
    return false;
  }
}

// src/compiler.ts
var ENABLE_OPTIMIZER = true;
var OP = {
  UNREACHABLE: 0,
  NOP: 1,
  BLOCK: 2,
  LOOP: 3,
  IF: 4,
  ELSE: 5,
  END: 11,
  BR: 12,
  BR_IF: 13,
  BR_TABLE: 14,
  RETURN: 15,
  CALL: 16,
  CALL_INDIRECT: 17,
  CALL_REF: 20,
  RETURN_CALL_REF: 21,
  DROP: 26,
  SELECT: 27,
  SELECT_T: 28,
  LOCAL_GET: 32,
  LOCAL_SET: 33,
  LOCAL_TEE: 34,
  GLOBAL_GET: 35,
  GLOBAL_SET: 36,
  TABLE_GET: 37,
  TABLE_SET: 38,
  I32_LOAD: 40,
  I64_LOAD: 41,
  F32_LOAD: 42,
  F64_LOAD: 43,
  I32_LOAD8_S: 44,
  I32_LOAD8_U: 45,
  I32_LOAD16_S: 46,
  I32_LOAD16_U: 47,
  I64_LOAD8_S: 48,
  I64_LOAD8_U: 49,
  I64_LOAD16_S: 50,
  I64_LOAD16_U: 51,
  I64_LOAD32_S: 52,
  I64_LOAD32_U: 53,
  I32_STORE: 54,
  I64_STORE: 55,
  F32_STORE: 56,
  F64_STORE: 57,
  I32_STORE8: 58,
  I32_STORE16: 59,
  I64_STORE8: 60,
  I64_STORE16: 61,
  I64_STORE32: 62,
  MEMORY_SIZE: 63,
  MEMORY_GROW: 64,
  I32_CONST: 65,
  I64_CONST: 66,
  F32_CONST: 67,
  F64_CONST: 68,
  I32_EQZ: 69,
  I64_EQZ: 80,
  I32_EQ: 70,
  I32_NE: 71,
  I32_LT_S: 72,
  I32_LT_U: 73,
  I32_GT_S: 74,
  I32_GT_U: 75,
  I32_LE_S: 76,
  I32_LE_U: 77,
  I32_GE_S: 78,
  I32_GE_U: 79,
  I64_EQ: 81,
  I64_NE: 82,
  I64_LT_S: 83,
  I64_LT_U: 84,
  I64_GT_S: 85,
  I64_GT_U: 86,
  I64_LE_S: 87,
  I64_LE_U: 88,
  I64_GE_S: 89,
  I64_GE_U: 90,
  F32_EQ: 91,
  F32_NE: 92,
  F32_LT: 93,
  F32_GT: 94,
  F32_LE: 95,
  F32_GE: 96,
  F64_EQ: 97,
  F64_NE: 98,
  F64_LT: 99,
  F64_GT: 100,
  F64_LE: 101,
  F64_GE: 102,
  I32_CLZ: 103,
  I32_CTZ: 104,
  I32_POPCNT: 105,
  I32_ADD: 106,
  I32_SUB: 107,
  I32_MUL: 108,
  I32_DIV_S: 109,
  I32_DIV_U: 110,
  I32_REM_S: 111,
  I32_REM_U: 112,
  I32_AND: 113,
  I32_OR: 114,
  I32_XOR: 115,
  I32_SHL: 116,
  I32_SHR_S: 117,
  I32_SHR_U: 118,
  I32_ROTL: 119,
  I32_ROTR: 120,
  I64_CLZ: 121,
  I64_CTZ: 122,
  I64_POPCNT: 123,
  I64_ADD: 124,
  I64_SUB: 125,
  I64_MUL: 126,
  I64_DIV_S: 127,
  I64_DIV_U: 128,
  I64_REM_S: 129,
  I64_REM_U: 130,
  I64_AND: 131,
  I64_OR: 132,
  I64_XOR: 133,
  I64_SHL: 134,
  I64_SHR_S: 135,
  I64_SHR_U: 136,
  I64_ROTL: 137,
  I64_ROTR: 138,
  F32_ABS: 139,
  F32_NEG: 140,
  F32_CEIL: 141,
  F32_FLOOR: 142,
  F32_TRUNC: 143,
  F32_NEAREST: 144,
  F32_SQRT: 145,
  F32_ADD: 146,
  F32_SUB: 147,
  F32_MUL: 148,
  F32_DIV: 149,
  F32_MIN: 150,
  F32_MAX: 151,
  F32_COPYSIGN: 152,
  F64_ABS: 153,
  F64_NEG: 154,
  F64_CEIL: 155,
  F64_FLOOR: 156,
  F64_TRUNC: 157,
  F64_NEAREST: 158,
  F64_SQRT: 159,
  F64_ADD: 160,
  F64_SUB: 161,
  F64_MUL: 162,
  F64_DIV: 163,
  F64_MIN: 164,
  F64_MAX: 165,
  F64_COPYSIGN: 166,
  I32_WRAP_I64: 167,
  I32_TRUNC_F32_S: 168,
  I32_TRUNC_F32_U: 169,
  I32_TRUNC_F64_S: 170,
  I32_TRUNC_F64_U: 171,
  I64_EXTEND_I32_S: 172,
  I64_EXTEND_I32_U: 173,
  I64_TRUNC_F32_S: 174,
  I64_TRUNC_F32_U: 175,
  I64_TRUNC_F64_S: 176,
  I64_TRUNC_F64_U: 177,
  F32_CONVERT_I32_S: 178,
  F32_CONVERT_I32_U: 179,
  F32_CONVERT_I64_S: 180,
  F32_CONVERT_I64_U: 181,
  F32_DEMOTE_F64: 182,
  F64_CONVERT_I32_S: 183,
  F64_CONVERT_I32_U: 184,
  F64_CONVERT_I64_S: 185,
  F64_CONVERT_I64_U: 186,
  F64_PROMOTE_F32: 187,
  I32_REINTERPRET_F32: 188,
  I64_REINTERPRET_F64: 189,
  F32_REINTERPRET_I32: 190,
  F64_REINTERPRET_I64: 191,
  REF_NULL: 208,
  REF_IS_NULL: 209,
  REF_FUNC: 210,
  MISC_PREFIX: 252,
  SAT_I32_TRUNC_SAT_F32_S: 0,
  SAT_I32_TRUNC_SAT_F32_U: 1,
  SAT_I32_TRUNC_SAT_F64_S: 2,
  SAT_I32_TRUNC_SAT_F64_U: 3,
  SAT_I64_TRUNC_SAT_F32_S: 4,
  SAT_I64_TRUNC_SAT_F32_U: 5,
  SAT_I64_TRUNC_SAT_F64_S: 6,
  SAT_I64_TRUNC_SAT_F64_U: 7,
  MEMORY_INIT: 8,
  DATA_DROP: 9,
  MEMORY_COPY: 10,
  MEMORY_FILL: 11,
  TABLE_INIT: 12,
  ELEM_DROP: 13,
  TABLE_COPY: 14,
  TABLE_GROW: 15,
  TABLE_SIZE: 16,
  TABLE_FILL: 17,
  SIMD_PREFIX: 253
};
var opToType = {
  127: "i32",
  126: "i64",
  125: "f32",
  124: "f64",
  123: "v128",
  112: "funcref",
  111: "externref"
};
var SIMD_NOIMM = {
  I8X16_SWIZZLE: 14,
  I8X16_SPLAT: 15,
  I16X8_SPLAT: 16,
  I32X4_SPLAT: 17,
  I64X2_SPLAT: 18,
  F32X4_SPLAT: 19,
  F64X2_SPLAT: 20,
  I8X16_EQ: 35,
  I8X16_NE: 36,
  I8X16_LT_S: 37,
  I8X16_LT_U: 38,
  I8X16_GT_S: 39,
  I8X16_GT_U: 40,
  I8X16_LE_S: 41,
  I8X16_LE_U: 42,
  I8X16_GE_S: 43,
  I8X16_GE_U: 44,
  I16X8_EQ: 45,
  I16X8_NE: 46,
  I16X8_LT_S: 47,
  I16X8_LT_U: 48,
  I16X8_GT_S: 49,
  I16X8_GT_U: 50,
  I16X8_LE_S: 51,
  I16X8_LE_U: 52,
  I16X8_GE_S: 53,
  I16X8_GE_U: 54,
  I32X4_EQ: 55,
  I32X4_NE: 56,
  I32X4_LT_S: 57,
  I32X4_LT_U: 58,
  I32X4_GT_S: 59,
  I32X4_GT_U: 60,
  I32X4_LE_S: 61,
  I32X4_LE_U: 62,
  I32X4_GE_S: 63,
  I32X4_GE_U: 64,
  F32X4_EQ: 65,
  F32X4_NE: 66,
  F32X4_LT: 67,
  F32X4_GT: 68,
  F32X4_LE: 69,
  F32X4_GE: 70,
  F64X2_EQ: 71,
  F64X2_NE: 72,
  F64X2_LT: 73,
  F64X2_GT: 74,
  F64X2_LE: 75,
  F64X2_GE: 76,
  V128_NOT: 77,
  V128_AND: 78,
  V128_ANDNOT: 79,
  V128_OR: 80,
  V128_XOR: 81,
  V128_BITSELECT: 82,
  V128_ANY_TRUE: 83,
  I8X16_ABS: 96,
  I8X16_NEG: 97,
  I8X16_POPCNT: 98,
  I8X16_ALL_TRUE: 99,
  I8X16_BITMASK: 100,
  I8X16_NARROW_I16X8_S: 101,
  I8X16_NARROW_I16X8_U: 102,
  F32X4_CEIL: 103,
  F32X4_FLOOR: 104,
  F32X4_TRUNC: 105,
  F32X4_NEAREST: 106,
  I8X16_SHL: 107,
  I8X16_SHR_S: 108,
  I8X16_SHR_U: 109,
  I8X16_ADD: 110,
  I8X16_ADD_SAT_S: 111,
  I8X16_ADD_SAT_U: 112,
  I8X16_SUB: 113,
  I8X16_SUB_SAT_S: 114,
  I8X16_SUB_SAT_U: 115,
  F64X2_CEIL: 116,
  F64X2_FLOOR: 117,
  I8X16_MIN_S: 118,
  I8X16_MIN_U: 119,
  I8X16_MAX_S: 120,
  I8X16_MAX_U: 121,
  F64X2_TRUNC: 122,
  I8X16_AVGR_U: 123,
  I16X8_EXTADD_PAIRWISE_I8X16_S: 124,
  I16X8_EXTADD_PAIRWISE_I8X16_U: 125,
  I32X4_EXTADD_PAIRWISE_I16X8_S: 126,
  I32X4_EXTADD_PAIRWISE_I16X8_U: 127,
  I16X8_ABS: 128,
  I16X8_NEG: 129,
  I16X8_Q15MULR_SAT_S: 130,
  I16X8_ALL_TRUE: 131,
  I16X8_BITMASK: 132,
  I16X8_NARROW_I32X4_S: 133,
  I16X8_NARROW_I32X4_U: 134,
  I16X8_EXTEND_LOW_I8X16_S: 135,
  I16X8_EXTEND_HIGH_I8X16_S: 136,
  I16X8_EXTEND_LOW_I8X16_U: 137,
  I16X8_EXTEND_HIGH_I8X16_U: 138,
  I16X8_SHL: 139,
  I16X8_SHR_S: 140,
  I16X8_SHR_U: 141,
  I16X8_ADD: 142,
  I16X8_ADD_SAT_S: 143,
  I16X8_ADD_SAT_U: 144,
  I16X8_SUB: 145,
  I16X8_SUB_SAT_S: 146,
  I16X8_SUB_SAT_U: 147,
  F64X2_NEAREST: 148,
  I16X8_MUL: 149,
  I16X8_MIN_S: 150,
  I16X8_MIN_U: 151,
  I16X8_MAX_S: 152,
  I16X8_MAX_U: 153,
  I16X8_AVGR_U: 155,
  I16X8_EXTMUL_LOW_I8X16_S: 156,
  I16X8_EXTMUL_HIGH_I8X16_S: 157,
  I16X8_EXTMUL_LOW_I8X16_U: 158,
  I16X8_EXTMUL_HIGH_I8X16_U: 159,
  I32X4_ABS: 160,
  I32X4_NEG: 161,
  I32X4_ALL_TRUE: 163,
  I32X4_BITMASK: 164,
  I32X4_EXTEND_LOW_I16X8_S: 167,
  I32X4_EXTEND_HIGH_I16X8_S: 168,
  I32X4_EXTEND_LOW_I16X8_U: 169,
  I32X4_EXTEND_HIGH_I16X8_U: 170,
  I32X4_SHL: 171,
  I32X4_SHR_S: 172,
  I32X4_SHR_U: 173,
  I32X4_ADD: 174,
  I32X4_SUB: 177,
  I32X4_MUL: 181,
  I32X4_MIN_S: 182,
  I32X4_MIN_U: 183,
  I32X4_MAX_S: 184,
  I32X4_MAX_U: 185,
  I32X4_DOT_I16X8_S: 186,
  I32X4_EXTMUL_LOW_I16X8_S: 188,
  I32X4_EXTMUL_HIGH_I16X8_S: 189,
  I32X4_EXTMUL_LOW_I16X8_U: 190,
  I32X4_EXTMUL_HIGH_I16X8_U: 191,
  I64X2_ABS: 192,
  I64X2_NEG: 193,
  I64X2_ALL_TRUE: 195,
  I64X2_BITMASK: 196,
  I64X2_EXTEND_LOW_I32X4_S: 199,
  I64X2_EXTEND_HIGH_I32X4_S: 200,
  I64X2_EXTEND_LOW_I32X4_U: 201,
  I64X2_EXTEND_HIGH_I32X4_U: 202,
  I64X2_SHL: 203,
  I64X2_SHR_S: 204,
  I64X2_SHR_U: 205,
  I64X2_ADD: 206,
  I64X2_SUB: 209,
  I64X2_MUL: 213,
  I64X2_EQ: 214,
  I64X2_NE: 215,
  I64X2_LT_S: 216,
  I64X2_GT_S: 217,
  I64X2_LE_S: 218,
  I64X2_GE_S: 219,
  I64X2_EXTMUL_LOW_I32X4_S: 220,
  I64X2_EXTMUL_HIGH_I32X4_S: 221,
  I64X2_EXTMUL_LOW_I32X4_U: 222,
  I64X2_EXTMUL_HIGH_I32X4_U: 223,
  F32X4_ABS: 224,
  F32X4_NEG: 225,
  F32X4_SQRT: 227,
  F32X4_ADD: 228,
  F32X4_SUB: 229,
  F32X4_MUL: 230,
  F32X4_DIV: 231,
  F32X4_MIN: 232,
  F32X4_MAX: 233,
  F32X4_PMIN: 234,
  F32X4_PMAX: 235,
  F64X2_ABS: 236,
  F64X2_NEG: 237,
  F64X2_SQRT: 239,
  F64X2_ADD: 240,
  F64X2_SUB: 241,
  F64X2_MUL: 242,
  F64X2_DIV: 243,
  F64X2_MIN: 244,
  F64X2_MAX: 245,
  F64X2_PMIN: 246,
  F64X2_PMAX: 247,
  I32X4_TRUNC_SAT_F32X4_S: 248,
  I32X4_TRUNC_SAT_F32X4_U: 249,
  F32X4_CONVERT_I32X4_S: 250,
  F32X4_CONVERT_I32X4_U: 251,
  I32X4_TRUNC_SAT_F64X2_S_ZERO: 252,
  I32X4_TRUNC_SAT_F64X2_U_ZERO: 253,
  F64X2_CONVERT_LOW_I32X4_S: 254,
  F64X2_CONVERT_LOW_I32X4_U: 255
};
var SIMD_MEMARG = {
  V128_LOAD: 0,
  V128_LOAD8X8_S: 1,
  V128_LOAD8X8_U: 2,
  V128_LOAD16X4_S: 3,
  V128_LOAD16X4_U: 4,
  V128_LOAD32X2_S: 5,
  V128_LOAD32X2_U: 6,
  V128_LOAD8_SPLAT: 7,
  V128_LOAD16_SPLAT: 8,
  V128_LOAD32_SPLAT: 9,
  V128_LOAD64_SPLAT: 10,
  V128_STORE: 11,
  V128_LOAD32_ZERO: 92,
  V128_LOAD64_ZERO: 93
};
var SIMD_MEMARG_LANE = {
  V128_LOAD8_LANE: 84,
  V128_LOAD16_LANE: 85,
  V128_LOAD32_LANE: 86,
  V128_LOAD64_LANE: 87,
  V128_STORE8_LANE: 88,
  V128_STORE16_LANE: 89,
  V128_STORE32_LANE: 90,
  V128_STORE64_LANE: 91
};
var SIMD_LANE = {
  I8X16_EXTRACT_LANE_S: 21,
  I8X16_EXTRACT_LANE_U: 22,
  I8X16_REPLACE_LANE: 23,
  I16X8_EXTRACT_LANE_S: 24,
  I16X8_EXTRACT_LANE_U: 25,
  I16X8_REPLACE_LANE: 26,
  I32X4_EXTRACT_LANE: 27,
  I32X4_REPLACE_LANE: 28,
  I64X2_EXTRACT_LANE: 29,
  I64X2_REPLACE_LANE: 30,
  F32X4_EXTRACT_LANE: 31,
  F32X4_REPLACE_LANE: 32,
  F64X2_EXTRACT_LANE: 33,
  F64X2_REPLACE_LANE: 34
};
var SIMD_CONST_SUBOP = 12;
var SIMD_SHUFFLE_SUBOP = 13;
var SIMD_REVERSE = (() => {
  const m = new Map;
  for (const [name, v] of Object.entries(SIMD_NOIMM))
    m.set(v, { name, kind: "noimm" });
  for (const [name, v] of Object.entries(SIMD_MEMARG)) {
    m.set(v, { name, kind: "memarg", naturalAlign: simdNaturalAlign(name) });
  }
  for (const [name, v] of Object.entries(SIMD_MEMARG_LANE)) {
    m.set(v, { name, kind: "memarg_lane", naturalAlign: simdNaturalAlignLane(name) });
  }
  for (const [name, v] of Object.entries(SIMD_LANE))
    m.set(v, { name, kind: "lane" });
  m.set(SIMD_CONST_SUBOP, { kind: "const" });
  m.set(SIMD_SHUFFLE_SUBOP, { kind: "shuffle" });
  return m;
})();
function simdNaturalAlign(name) {
  if (name.endsWith("_LOAD8_SPLAT"))
    return 0;
  if (name.endsWith("_LOAD16_SPLAT"))
    return 1;
  if (name.endsWith("_LOAD32_SPLAT"))
    return 2;
  if (name.endsWith("_LOAD64_SPLAT"))
    return 3;
  if (name.endsWith("_LOAD32_ZERO"))
    return 2;
  if (name.endsWith("_LOAD64_ZERO"))
    return 3;
  if (name.includes("_LOAD8X8_") || name.includes("_LOAD16X4_") || name.includes("_LOAD32X2_")) {
    return 3;
  }
  return 4;
}
function simdNaturalAlignLane(name) {
  if (name.includes("8_LANE"))
    return 0;
  if (name.includes("16_LANE"))
    return 1;
  if (name.includes("32_LANE"))
    return 2;
  if (name.includes("64_LANE"))
    return 3;
  return 0;
}
function simdMaxLane(name) {
  if (name.startsWith("I8X16_"))
    return 15;
  if (name.startsWith("I16X8_"))
    return 7;
  if (name.startsWith("I32X4_") || name.startsWith("F32X4_"))
    return 3;
  if (name.startsWith("I64X2_") || name.startsWith("F64X2_"))
    return 1;
  if (name.endsWith("8_LANE"))
    return 15;
  if (name.endsWith("16_LANE"))
    return 7;
  if (name.endsWith("32_LANE"))
    return 3;
  if (name.endsWith("64_LANE"))
    return 1;
  return 255;
}
function simdWatName(name) {
  const idx = name.indexOf("_");
  if (idx === -1)
    return name.toLowerCase();
  return name.slice(0, idx).toLowerCase() + "." + name.slice(idx + 1).toLowerCase();
}
function encodeLEB128(n) {
  if (!Number.isFinite(n) || n < 0)
    throw new Error(`encodeLEB128: valor inválido ${n}`);
  let bytes = [];
  let value = n >>> 0;
  do {
    let byte = value & 127;
    value >>>= 7;
    if (value !== 0)
      byte |= 128;
    bytes.push(byte);
  } while (value !== 0);
  return bytes;
}
function encodeSignedLEB128(value) {
  const bytes = [];
  if (typeof value === "bigint") {
    let val = value;
    let more = true;
    while (more) {
      let byte = Number(val & 0x7Fn);
      val >>= 7n;
      if (val === 0n && (byte & 64) === 0 || val === -1n && (byte & 64) !== 0) {
        more = false;
      } else {
        byte |= 128;
      }
      bytes.push(byte);
    }
  } else {
    let val = value | 0;
    let more = true;
    while (more) {
      let byte = val & 127;
      val >>= 7;
      if (val === 0 && (byte & 64) === 0 || val === -1 && (byte & 64) !== 0) {
        more = false;
      } else {
        byte |= 128;
      }
      bytes.push(byte);
    }
  }
  return bytes;
}
function encodeName(str) {
  const bytes = new TextEncoder().encode(str);
  return [...encodeLEB128(bytes.length), ...bytes];
}
function typeToOp(t) {
  const map = {
    i32: 127,
    i64: 126,
    f32: 125,
    f64: 124,
    v128: 123,
    funcref: 112,
    externref: 111
  };
  if (!(t in map))
    throw new Error(`Tipo no válido: ${t}`);
  return map[t];
}
function refTypeToOp(t) {
  return t === "funcref" ? 112 : 111;
}
function floatToBytes(value, bits) {
  const buf = new ArrayBuffer(bits / 8);
  const view = new DataView(buf);
  if (bits === 32)
    view.setFloat32(0, value, true);
  else
    view.setFloat64(0, value, true);
  return Array.from(new Uint8Array(buf));
}
function toI32(value) {
  if (value === undefined || value === null) {
    console.error("toI32 con valor inválido:", value);
    console.trace();
    throw new Error("toI32: valor inválido");
  }
  return Number(BigInt.asIntN(32, BigInt(value)));
}
function toI64(value) {
  if (value === undefined || value === null) {
    console.error("toI64 con valor inválido:", value);
    console.trace();
    throw new Error("toI64: valor inválido");
  }
  return BigInt.asIntN(64, BigInt(value));
}
class StringPool {
  data = [];
  offsets = new Map;
  baseOffset;
  constructor(baseOffset = 0) {
    this.baseOffset = baseOffset;
  }
  getBaseOffset() {
    return this.baseOffset;
  }
  add(str) {
    const cached = this.offsets.get(str);
    if (cached) {
      return { offset: this.baseOffset + cached.offset + 4, length: cached.length };
    }
    const bytes = new TextEncoder().encode(str);
    const internalOffset = this.data.length;
    const len = bytes.length;
    this.data.push(len & 255, len >> 8 & 255, len >> 16 & 255, len >> 24 & 255);
    for (let i = 0;i < bytes.length; i++)
      this.data.push(bytes[i]);
    this.offsets.set(str, { offset: internalOffset, length: len });
    return { offset: this.baseOffset + internalOffset + 4, length: len };
  }
  getDataSegments() {
    if (this.data.length === 0)
      return [];
    return [{ offset: this.baseOffset, data: new Uint8Array(this.data) }];
  }
  getAllEntries() {
    const entries = [];
    for (const [text, { offset }] of this.offsets) {
      entries.push({ text, userOffset: this.baseOffset + offset + 4 });
    }
    return entries;
  }
  reset() {
    this.data = [];
    this.offsets.clear();
  }
  rawBytes() {
    return new Uint8Array(this.data);
  }
  fromString(context, text) {
    const ref = this.add(text);
    context.i32DataConst(ref.offset);
  }
  connect(module) {
    module.attachStringPool(this);
  }
}

class FunctionIRBuilder {
  paramTypes;
  returnType;
  instructions;
  nextLocalIdx;
  localNames;
  localTypes;
  blockLabelStack;
  lastInstructionWasTerminator;
  needsMemory;
  finalized = false;
  moduleRef = null;
  constructor(paramTypes = [], returnType = [], paramNames = [], moduleRef) {
    this.paramTypes = paramTypes;
    this.returnType = returnType;
    this.instructions = [];
    this.nextLocalIdx = paramTypes.length;
    this.localNames = new Map;
    this.localTypes = paramTypes.slice();
    this.blockLabelStack = [];
    this.lastInstructionWasTerminator = false;
    this.needsMemory = false;
    this.moduleRef = moduleRef ?? null;
    if (paramNames.length > 0) {
      if (paramNames.length !== paramTypes.length) {
        throw new Error(`Longitud de paramNames (${paramNames.length}) no coincide con paramTypes (${paramTypes.length})`);
      }
      for (let i = 0;i < paramNames.length; i++)
        this.setParamName(i, paramNames[i]);
    }
  }
  addString(text) {
    this.needsMemory = true;
    if (!this.moduleRef)
      throw new Error("addString requiere ModuleBuilder");
    const ref = this.moduleRef.addString(text);
    this.i32DataConst(ref.offset);
  }
  functionIndexByName(name) {
    this._checkNotFinalized();
    this.instructions.push({ op: "FUNCTION_INDEX_BY_NAME", name });
    this.lastInstructionWasTerminator = false;
  }
  envAddrByName(name) {
    this._checkNotFinalized();
    this.instructions.push({ op: "ENV_ADDR_BY_NAME", name });
    this.lastInstructionWasTerminator = false;
  }
  setParamName(index, name) {
    if (index < 0 || index >= this.paramTypes.length) {
      throw new Error(`Índice de parámetro fuera de rango: ${index}`);
    }
    this.localNames.set(name, { index, type: this.paramTypes[index] });
  }
  addLocal(name, type = "i32") {
    if (this.finalized)
      throw new Error("No se pueden añadir locales después de finalizar");
    const idx = this.nextLocalIdx++;
    this.localNames.set(name, { index: idx, type });
    this.localTypes[idx] = type;
    return idx;
  }
  getTempLocal(slot = 0) {
    const name = `__temp${slot}`;
    const entry = this.localNames.get(name);
    if (entry)
      return entry.index;
    return this.addLocal(name, "i32");
  }
  getTempF64Local() {
    const name = "__temp_f64";
    const entry = this.localNames.get(name);
    if (entry)
      return entry.index;
    return this.addLocal(name, "f64");
  }
  _checkNotFinalized() {
    if (this.finalized)
      throw new Error("No se pueden añadir instrucciones después de finalizar");
  }
  setReturnType(...types) {
    this._checkNotFinalized();
    if (types.length === 0) {
      this.returnType = [];
      return;
    }
    const first = types[0];
    if (types.length === 1 && first === null) {
      this.returnType = [];
      return;
    }
    if (types.length === 1 && Array.isArray(first)) {
      this.returnType = [...first];
      return;
    }
    this.returnType = types;
  }
  setReturnTypes(...types) {
    this._checkNotFinalized();
    this.returnType = [...types];
  }
  _resolveLocal(nameOrIndex) {
    if (typeof nameOrIndex === "number")
      return nameOrIndex;
    const entry = this.localNames.get(nameOrIndex);
    if (entry)
      return entry.index;
    throw new Error(`Variable local no definida: ${nameOrIndex}`);
  }
  getLocal(n) {
    this._checkNotFinalized();
    this.instructions.push({ op: "LOCAL_GET", index: this._resolveLocal(n) });
    this.lastInstructionWasTerminator = false;
  }
  setLocal(n) {
    this._checkNotFinalized();
    this.instructions.push({ op: "LOCAL_SET", index: this._resolveLocal(n) });
    this.lastInstructionWasTerminator = false;
  }
  teeLocal(n) {
    this._checkNotFinalized();
    this.instructions.push({ op: "LOCAL_TEE", index: this._resolveLocal(n) });
    this.lastInstructionWasTerminator = false;
  }
  globalGet(n) {
    this._checkNotFinalized();
    this.instructions.push({ op: "GLOBAL_GET", index: n });
    this.lastInstructionWasTerminator = false;
  }
  globalSet(n) {
    this._checkNotFinalized();
    this.instructions.push({ op: "GLOBAL_SET", index: n });
    this.lastInstructionWasTerminator = false;
  }
  i32Const(v) {
    this._checkNotFinalized();
    this.instructions.push({ op: "I32_CONST", val: v });
    this.lastInstructionWasTerminator = false;
  }
  i64Const(v) {
    this._checkNotFinalized();
    this.instructions.push({ op: "I64_CONST", val: v });
    this.lastInstructionWasTerminator = false;
  }
  f32Const(v) {
    this._checkNotFinalized();
    this.instructions.push({ op: "F32_CONST", val: v });
    this.lastInstructionWasTerminator = false;
  }
  f64Const(v) {
    this._checkNotFinalized();
    this.instructions.push({ op: "F64_CONST", val: v });
    this.lastInstructionWasTerminator = false;
  }
  _u(op) {
    this._checkNotFinalized();
    this.instructions.push({ op });
    this.lastInstructionWasTerminator = false;
  }
  i32Clz() {
    this._u("I32_CLZ");
  }
  i32Ctz() {
    this._u("I32_CTZ");
  }
  i32Popcnt() {
    this._u("I32_POPCNT");
  }
  i64Clz() {
    this._u("I64_CLZ");
  }
  i64Ctz() {
    this._u("I64_CTZ");
  }
  i64Popcnt() {
    this._u("I64_POPCNT");
  }
  i32Rotl() {
    this._u("I32_ROTL");
  }
  i32Rotr() {
    this._u("I32_ROTR");
  }
  i64Rotl() {
    this._u("I64_ROTL");
  }
  i64Rotr() {
    this._u("I64_ROTR");
  }
  i32Eqz() {
    this._u("I32_EQZ");
  }
  i64Eqz() {
    this._u("I64_EQZ");
  }
  i32Eq() {
    this._u("I32_EQ");
  }
  i32Ne() {
    this._u("I32_NE");
  }
  i32LtS() {
    this._u("I32_LT_S");
  }
  i32LtU() {
    this._u("I32_LT_U");
  }
  i32GtS() {
    this._u("I32_GT_S");
  }
  i32GtU() {
    this._u("I32_GT_U");
  }
  i32LeS() {
    this._u("I32_LE_S");
  }
  i32LeU() {
    this._u("I32_LE_U");
  }
  i32GeS() {
    this._u("I32_GE_S");
  }
  i32GeU() {
    this._u("I32_GE_U");
  }
  i32Add() {
    this._u("I32_ADD");
  }
  i32Sub() {
    this._u("I32_SUB");
  }
  i32Mul() {
    this._u("I32_MUL");
  }
  i32DivS() {
    this._u("I32_DIV_S");
  }
  i32DivU() {
    this._u("I32_DIV_U");
  }
  i32RemS() {
    this._u("I32_REM_S");
  }
  i32RemU() {
    this._u("I32_REM_U");
  }
  i32And() {
    this._u("I32_AND");
  }
  i32Or() {
    this._u("I32_OR");
  }
  i32Xor() {
    this._u("I32_XOR");
  }
  i32Shl() {
    this._u("I32_SHL");
  }
  i32ShrS() {
    this._u("I32_SHR_S");
  }
  i32ShrU() {
    this._u("I32_SHR_U");
  }
  i32DataConst(val) {
    this._checkNotFinalized();
    this.instructions.push({ op: "I32_DATA_CONST", val });
    this.lastInstructionWasTerminator = false;
  }
  i64Eq() {
    this._u("I64_EQ");
  }
  i64Ne() {
    this._u("I64_NE");
  }
  i64LtS() {
    this._u("I64_LT_S");
  }
  i64LtU() {
    this._u("I64_LT_U");
  }
  i64GtS() {
    this._u("I64_GT_S");
  }
  i64GtU() {
    this._u("I64_GT_U");
  }
  i64LeS() {
    this._u("I64_LE_S");
  }
  i64LeU() {
    this._u("I64_LE_U");
  }
  i64GeS() {
    this._u("I64_GE_S");
  }
  i64GeU() {
    this._u("I64_GE_U");
  }
  i64Add() {
    this._u("I64_ADD");
  }
  i64Sub() {
    this._u("I64_SUB");
  }
  i64Mul() {
    this._u("I64_MUL");
  }
  i64DivS() {
    this._u("I64_DIV_S");
  }
  i64DivU() {
    this._u("I64_DIV_U");
  }
  i64RemS() {
    this._u("I64_REM_S");
  }
  i64RemU() {
    this._u("I64_REM_U");
  }
  i64And() {
    this._u("I64_AND");
  }
  i64Or() {
    this._u("I64_OR");
  }
  i64Xor() {
    this._u("I64_XOR");
  }
  i64Shl() {
    this._u("I64_SHL");
  }
  i64ShrS() {
    this._u("I64_SHR_S");
  }
  i64ShrU() {
    this._u("I64_SHR_U");
  }
  f32Abs() {
    this._u("F32_ABS");
  }
  f32Neg() {
    this._u("F32_NEG");
  }
  f32Ceil() {
    this._u("F32_CEIL");
  }
  f32Floor() {
    this._u("F32_FLOOR");
  }
  f32Trunc() {
    this._u("F32_TRUNC");
  }
  f32Nearest() {
    this._u("F32_NEAREST");
  }
  f32Sqrt() {
    this._u("F32_SQRT");
  }
  f32Add() {
    this._u("F32_ADD");
  }
  f32Sub() {
    this._u("F32_SUB");
  }
  f32Mul() {
    this._u("F32_MUL");
  }
  f32Div() {
    this._u("F32_DIV");
  }
  f32Min() {
    this._u("F32_MIN");
  }
  f32Max() {
    this._u("F32_MAX");
  }
  f32Copysign() {
    this._u("F32_COPYSIGN");
  }
  f32Eq() {
    this._u("F32_EQ");
  }
  f32Ne() {
    this._u("F32_NE");
  }
  f32Lt() {
    this._u("F32_LT");
  }
  f32Gt() {
    this._u("F32_GT");
  }
  f32Le() {
    this._u("F32_LE");
  }
  f32Ge() {
    this._u("F32_GE");
  }
  f64Abs() {
    this._u("F64_ABS");
  }
  f64Neg() {
    this._u("F64_NEG");
  }
  f64Ceil() {
    this._u("F64_CEIL");
  }
  f64Floor() {
    this._u("F64_FLOOR");
  }
  f64Trunc() {
    this._u("F64_TRUNC");
  }
  f64Nearest() {
    this._u("F64_NEAREST");
  }
  f64Sqrt() {
    this._u("F64_SQRT");
  }
  f64Add() {
    this._u("F64_ADD");
  }
  f64Sub() {
    this._u("F64_SUB");
  }
  f64Mul() {
    this._u("F64_MUL");
  }
  f64Div() {
    this._u("F64_DIV");
  }
  f64Min() {
    this._u("F64_MIN");
  }
  f64Max() {
    this._u("F64_MAX");
  }
  f64Copysign() {
    this._u("F64_COPYSIGN");
  }
  f64Eq() {
    this._u("F64_EQ");
  }
  f64Ne() {
    this._u("F64_NE");
  }
  f64Lt() {
    this._u("F64_LT");
  }
  f64Gt() {
    this._u("F64_GT");
  }
  f64Le() {
    this._u("F64_LE");
  }
  f64Ge() {
    this._u("F64_GE");
  }
  i32WrapI64() {
    this._u("I32_WRAP_I64");
  }
  i32TruncF32S() {
    this._u("I32_TRUNC_F32_S");
  }
  i32TruncF32U() {
    this._u("I32_TRUNC_F32_U");
  }
  i32TruncF64S() {
    this._u("I32_TRUNC_F64_S");
  }
  i32TruncF64U() {
    this._u("I32_TRUNC_F64_U");
  }
  i64TruncF32S() {
    this._u("I64_TRUNC_F32_S");
  }
  i64TruncF32U() {
    this._u("I64_TRUNC_F32_U");
  }
  i64TruncF64S() {
    this._u("I64_TRUNC_F64_S");
  }
  i64TruncF64U() {
    this._u("I64_TRUNC_F64_U");
  }
  f32ConvertI32S() {
    this._u("F32_CONVERT_I32_S");
  }
  f32ConvertI32U() {
    this._u("F32_CONVERT_I32_U");
  }
  f32ConvertI64S() {
    this._u("F32_CONVERT_I64_S");
  }
  f32ConvertI64U() {
    this._u("F32_CONVERT_I64_U");
  }
  f64ConvertI32S() {
    this._u("F64_CONVERT_I32_S");
  }
  f64ConvertI32U() {
    this._u("F64_CONVERT_I32_U");
  }
  f64ConvertI64S() {
    this._u("F64_CONVERT_I64_S");
  }
  f64ConvertI64U() {
    this._u("F64_CONVERT_I64_U");
  }
  f32DemoteF64() {
    this._u("F32_DEMOTE_F64");
  }
  f64PromoteF32() {
    this._u("F64_PROMOTE_F32");
  }
  i32ReinterpretF32() {
    this._u("I32_REINTERPRET_F32");
  }
  i64ReinterpretF64() {
    this._u("I64_REINTERPRET_F64");
  }
  f32ReinterpretI32() {
    this._u("F32_REINTERPRET_I32");
  }
  f64ReinterpretI64() {
    this._u("F64_REINTERPRET_I64");
  }
  i64ExtendI32S() {
    this._u("I64_EXTEND_I32_S");
  }
  i64ExtendI32U() {
    this._u("I64_EXTEND_I32_U");
  }
  i32TruncSatF32S() {
    this._u("I32_TRUNC_SAT_F32_S");
  }
  i32TruncSatF32U() {
    this._u("I32_TRUNC_SAT_F32_U");
  }
  i32TruncSatF64S() {
    this._u("I32_TRUNC_SAT_F64_S");
  }
  i32TruncSatF64U() {
    this._u("I32_TRUNC_SAT_F64_U");
  }
  i64TruncSatF32S() {
    this._u("I64_TRUNC_SAT_F32_S");
  }
  i64TruncSatF32U() {
    this._u("I64_TRUNC_SAT_F32_U");
  }
  i64TruncSatF64S() {
    this._u("I64_TRUNC_SAT_F64_S");
  }
  i64TruncSatF64U() {
    this._u("I64_TRUNC_SAT_F64_U");
  }
  select() {
    this._u("SELECT");
  }
  selectT(types) {
    this._checkNotFinalized();
    this.instructions.push({ op: "SELECT_T", types });
    this.lastInstructionWasTerminator = false;
  }
  refNull(type) {
    this._checkNotFinalized();
    this.instructions.push({ op: "REF_NULL", type });
    this.lastInstructionWasTerminator = false;
  }
  refIsNull() {
    this._u("REF_IS_NULL");
  }
  refFunc(index) {
    this._checkNotFinalized();
    this.instructions.push({ op: "REF_FUNC", index });
    this.lastInstructionWasTerminator = false;
  }
  refFuncByName(name) {
    this._checkNotFinalized();
    this.instructions.push({ op: "REF_FUNC_BY_NAME", name });
    this.lastInstructionWasTerminator = false;
  }
  tableGet(t = 0) {
    this._checkNotFinalized();
    this.instructions.push({ op: "TABLE_GET", tableIdx: t });
    this.lastInstructionWasTerminator = false;
  }
  tableSet(t = 0) {
    this._checkNotFinalized();
    this.instructions.push({ op: "TABLE_SET", tableIdx: t });
    this.lastInstructionWasTerminator = false;
  }
  tableGrow(t = 0) {
    this._checkNotFinalized();
    this.instructions.push({ op: "TABLE_GROW", tableIdx: t });
    this.lastInstructionWasTerminator = false;
  }
  tableSize(t = 0) {
    this._checkNotFinalized();
    this.instructions.push({ op: "TABLE_SIZE", tableIdx: t });
    this.lastInstructionWasTerminator = false;
  }
  tableFill(t = 0) {
    this._checkNotFinalized();
    this.instructions.push({ op: "TABLE_FILL", tableIdx: t });
    this.lastInstructionWasTerminator = false;
  }
  tableCopy(dst = 0, src = 0) {
    this._checkNotFinalized();
    this.instructions.push({ op: "TABLE_COPY", dstIdx: dst, srcIdx: src });
    this.lastInstructionWasTerminator = false;
  }
  tableInit(tableIdx = 0, elemIdx = 0) {
    this._checkNotFinalized();
    this.instructions.push({ op: "TABLE_INIT", tableIdx, elemIdx });
    this.lastInstructionWasTerminator = false;
  }
  elemDrop(elemIdx) {
    this._checkNotFinalized();
    this.instructions.push({ op: "ELEM_DROP", elemIdx });
    this.lastInstructionWasTerminator = false;
  }
  memoryInit(dataIdx) {
    this._checkNotFinalized();
    this.needsMemory = true;
    this.instructions.push({ op: "MEMORY_INIT", dataIdx });
    this.lastInstructionWasTerminator = false;
  }
  dataDrop(dataIdx) {
    this._checkNotFinalized();
    this.instructions.push({ op: "DATA_DROP", dataIdx });
    this.lastInstructionWasTerminator = false;
  }
  memoryFill() {
    this._checkNotFinalized();
    this.needsMemory = true;
    this.instructions.push({ op: "MEMORY_FILL" });
    this.lastInstructionWasTerminator = false;
  }
  memoryCopy() {
    this._checkNotFinalized();
    this.needsMemory = true;
    this.instructions.push({ op: "MEMORY_COPY" });
    this.lastInstructionWasTerminator = false;
  }
  ensureTableCapacity(tableIdx, indexLocal, fillRefType = "funcref") {
    this._checkNotFinalized();
    const idx = this._resolveLocal(indexLocal);
    this.getLocal(idx);
    this.tableSize(tableIdx);
    this.i32GeU();
    this.if_("void");
    this.refNull(fillRefType);
    this.getLocal(idx);
    this.i32Const(1);
    this.i32Add();
    this.tableSize(tableIdx);
    this.i32Sub();
    this.tableGrow(tableIdx);
    this.drop();
    this.end();
  }
  _memOp(op, offset = 0, align = 0) {
    this._checkNotFinalized();
    this.needsMemory = true;
    this.instructions.push({ op, offset, align });
    this.lastInstructionWasTerminator = false;
  }
  i32Load(o = 0, a = 0) {
    this._memOp("I32_LOAD", o, a);
  }
  i64Load(o = 0, a = 0) {
    this._memOp("I64_LOAD", o, a);
  }
  f32Load(o = 0, a = 0) {
    this._memOp("F32_LOAD", o, a);
  }
  f64Load(o = 0, a = 0) {
    this._memOp("F64_LOAD", o, a);
  }
  i32Load8S(o = 0, a = 0) {
    this._memOp("I32_LOAD8_S", o, a);
  }
  i32Load8U(o = 0, a = 0) {
    this._memOp("I32_LOAD8_U", o, a);
  }
  i32Load16S(o = 0, a = 0) {
    this._memOp("I32_LOAD16_S", o, a);
  }
  i32Load16U(o = 0, a = 0) {
    this._memOp("I32_LOAD16_U", o, a);
  }
  i64Load8S(o = 0, a = 0) {
    this._memOp("I64_LOAD8_S", o, a);
  }
  i64Load8U(o = 0, a = 0) {
    this._memOp("I64_LOAD8_U", o, a);
  }
  i64Load16S(o = 0, a = 0) {
    this._memOp("I64_LOAD16_S", o, a);
  }
  i64Load16U(o = 0, a = 0) {
    this._memOp("I64_LOAD16_U", o, a);
  }
  i64Load32S(o = 0, a = 0) {
    this._memOp("I64_LOAD32_S", o, a);
  }
  i64Load32U(o = 0, a = 0) {
    this._memOp("I64_LOAD32_U", o, a);
  }
  i32Store(o = 0, a = 0) {
    this._memOp("I32_STORE", o, a);
  }
  i64Store(o = 0, a = 0) {
    this._memOp("I64_STORE", o, a);
  }
  f32Store(o = 0, a = 0) {
    this._memOp("F32_STORE", o, a);
  }
  f64Store(o = 0, a = 0) {
    this._memOp("F64_STORE", o, a);
  }
  i32Store8(o = 0, a = 0) {
    this._memOp("I32_STORE8", o, a);
  }
  i32Store16(o = 0, a = 0) {
    this._memOp("I32_STORE16", o, a);
  }
  i64Store8(o = 0, a = 0) {
    this._memOp("I64_STORE8", o, a);
  }
  i64Store16(o = 0, a = 0) {
    this._memOp("I64_STORE16", o, a);
  }
  i64Store32(o = 0, a = 0) {
    this._memOp("I64_STORE32", o, a);
  }
  memorySize() {
    this._memOp("MEMORY_SIZE");
  }
  memoryGrow() {
    this._memOp("MEMORY_GROW");
  }
  call(index) {
    this._checkNotFinalized();
    this.instructions.push({ op: "CALL", index });
    this.lastInstructionWasTerminator = false;
  }
  callByName(name) {
    this._checkNotFinalized();
    this.instructions.push({ op: "CALL_BY_NAME", name });
    this.lastInstructionWasTerminator = false;
  }
  callIndirect(typeIdx) {
    this._checkNotFinalized();
    this.instructions.push({ op: "CALL_INDIRECT", typeIdx });
    this.lastInstructionWasTerminator = false;
  }
  callRef(typeIdx) {
    this._checkNotFinalized();
    this.instructions.push({ op: "CALL_REF", typeIdx });
    this.lastInstructionWasTerminator = false;
  }
  returnCallRef(typeIdx) {
    this._checkNotFinalized();
    this.instructions.push({ op: "RETURN_CALL_REF", typeIdx });
    this.lastInstructionWasTerminator = true;
  }
  _blockTypeToOp(type) {
    if (typeof type === "number")
      return type;
    if (type === "void")
      return 64;
    return typeToOp(type);
  }
  block(type = "void", label = null) {
    this._checkNotFinalized();
    this.instructions.push({ op: "BLOCK", blocktype: this._blockTypeToOp(type) });
    this.blockLabelStack.push(label);
    this.lastInstructionWasTerminator = false;
  }
  loop(type = "void", label = null) {
    this._checkNotFinalized();
    this.instructions.push({ op: "LOOP", blocktype: this._blockTypeToOp(type) });
    this.blockLabelStack.push(label);
    this.lastInstructionWasTerminator = false;
  }
  if_(type = "void", label = null) {
    this._checkNotFinalized();
    this.instructions.push({ op: "IF", blocktype: this._blockTypeToOp(type) });
    this.blockLabelStack.push(label);
    this.lastInstructionWasTerminator = false;
  }
  else_() {
    this._checkNotFinalized();
    this.instructions.push({ op: "ELSE" });
    this.lastInstructionWasTerminator = false;
  }
  end() {
    this._checkNotFinalized();
    this.instructions.push({ op: "END" });
    this.blockLabelStack.pop();
    this.lastInstructionWasTerminator = false;
  }
  _getDepthToLabel(label) {
    for (let i = this.blockLabelStack.length - 1, depth = 0;i >= 0; i--, depth++) {
      if (this.blockLabelStack[i] === label)
        return depth;
    }
    throw new Error(`Etiqueta de bloque no encontrada: ${label}`);
  }
  brTo(label) {
    this._checkNotFinalized();
    this.instructions.push({ op: "BR", depth: this._getDepthToLabel(label) });
    this.lastInstructionWasTerminator = true;
  }
  brIfTo(label) {
    this._checkNotFinalized();
    this.instructions.push({ op: "BR_IF", depth: this._getDepthToLabel(label) });
    this.lastInstructionWasTerminator = false;
  }
  br(depth) {
    this._checkNotFinalized();
    this.instructions.push({ op: "BR", depth });
    this.lastInstructionWasTerminator = true;
  }
  brIf(depth) {
    this._checkNotFinalized();
    this.instructions.push({ op: "BR_IF", depth });
    this.lastInstructionWasTerminator = false;
  }
  br_table(targets, defaultTarget) {
    this._checkNotFinalized();
    let labels;
    let defaultDepth;
    if (targets.length > 0 && typeof targets[0] === "string") {
      labels = targets.map((l) => this._getDepthToLabel(l));
      defaultDepth = typeof defaultTarget === "string" ? this._getDepthToLabel(defaultTarget) : defaultTarget;
    } else {
      labels = targets;
      defaultDepth = defaultTarget;
    }
    this.instructions.push({ op: "BR_TABLE", labels, default: defaultDepth });
    this.lastInstructionWasTerminator = true;
  }
  return_() {
    this._checkNotFinalized();
    this.instructions.push({ op: "RETURN" });
    this.lastInstructionWasTerminator = true;
  }
  drop() {
    this._checkNotFinalized();
    this.instructions.push({ op: "DROP" });
    this.lastInstructionWasTerminator = false;
  }
  unreachable() {
    this._checkNotFinalized();
    this.instructions.push({ op: "UNREACHABLE" });
    this.lastInstructionWasTerminator = true;
  }
  nop() {
    this._checkNotFinalized();
    this.instructions.push({ op: "NOP" });
    this.lastInstructionWasTerminator = false;
  }
  simd(name) {
    this._checkNotFinalized();
    this.instructions.push({ op: "SIMD_NOIMM", name });
    this.lastInstructionWasTerminator = false;
  }
  simdMem(name, offset = 0, align = 0) {
    this._checkNotFinalized();
    this.needsMemory = true;
    this.instructions.push({ op: "SIMD_MEMARG", name, offset, align });
    this.lastInstructionWasTerminator = false;
  }
  simdMemLane(name, lane, offset = 0, align = 0) {
    this._checkNotFinalized();
    const max = simdMaxLane(name);
    if (!Number.isInteger(lane) || lane < 0 || lane > max) {
      throw new Error(`simdMemLane: lane fuera de rango para ${name} (0..${max}, recibido ${lane})`);
    }
    this.needsMemory = true;
    this.instructions.push({ op: "SIMD_MEMARG_LANE", name, offset, align, lane });
    this.lastInstructionWasTerminator = false;
  }
  simdLane(name, lane) {
    this._checkNotFinalized();
    const max = simdMaxLane(name);
    if (!Number.isInteger(lane) || lane < 0 || lane > max) {
      throw new Error(`simdLane: lane fuera de rango para ${name} (0..${max}, recibido ${lane})`);
    }
    this.instructions.push({ op: "SIMD_LANE", name, lane });
    this.lastInstructionWasTerminator = false;
  }
  v128Const(bytes) {
    if (bytes.length !== 16)
      throw new Error("v128.const requiere exactamente 16 bytes");
    this._checkNotFinalized();
    this.instructions.push({ op: "SIMD_CONST", bytes: [...bytes] });
    this.lastInstructionWasTerminator = false;
  }
  v128ConstI32x4(a, b, c, d) {
    const bytes = [];
    for (const v of [a, b, c, d]) {
      const buf = new ArrayBuffer(4);
      new DataView(buf).setInt32(0, v | 0, true);
      bytes.push(...new Uint8Array(buf));
    }
    this.v128Const(bytes);
  }
  v128ConstF32x4(a, b, c, d) {
    const bytes = [];
    for (const v of [a, b, c, d]) {
      const buf = new ArrayBuffer(4);
      new DataView(buf).setFloat32(0, v, true);
      bytes.push(...new Uint8Array(buf));
    }
    this.v128Const(bytes);
  }
  v128ConstF64x2(a, b) {
    const bytes = [];
    for (const v of [a, b]) {
      const buf = new ArrayBuffer(8);
      new DataView(buf).setFloat64(0, v, true);
      bytes.push(...new Uint8Array(buf));
    }
    this.v128Const(bytes);
  }
  v128ConstI64x2(a, b) {
    const bytes = [];
    for (const v of [a, b]) {
      const buf = new ArrayBuffer(8);
      new DataView(buf).setBigInt64(0, BigInt.asIntN(64, BigInt(v)), true);
      bytes.push(...new Uint8Array(buf));
    }
    this.v128Const(bytes);
  }
  v128ConstI16x8(...vals) {
    if (vals.length !== 8)
      throw new Error("v128ConstI16x8 requiere 8 valores");
    const bytes = [];
    for (const v of vals) {
      const buf = new ArrayBuffer(2);
      new DataView(buf).setInt16(0, v | 0, true);
      bytes.push(...new Uint8Array(buf));
    }
    this.v128Const(bytes);
  }
  v128ConstI8x16(...vals) {
    if (vals.length !== 16)
      throw new Error("v128ConstI8x16 requiere 16 valores");
    this.v128Const(vals.map((v) => v & 255));
  }
  i8x16Shuffle(lanes) {
    if (lanes.length !== 16)
      throw new Error("i8x16.shuffle requiere 16 lane indices");
    for (const l of lanes)
      if (l < 0 || l > 31)
        throw new Error(`lane fuera de rango: ${l}`);
    this._checkNotFinalized();
    this.instructions.push({ op: "SIMD_SHUFFLE", lanes: [...lanes] });
    this.lastInstructionWasTerminator = false;
  }
  finalize() {
    if (this.finalized)
      return;
    if (this.blockLabelStack.length > 0) {
      throw new Error(`Hay ${this.blockLabelStack.length} bloque(s) sin cerrar al finalizar la función`);
    }
    this.finalized = true;
  }
  getLocals() {
    const locals = [];
    let currentType = null;
    let currentCount = 0;
    for (let i = this.paramTypes.length;i < this.nextLocalIdx; i++) {
      const type = this.localTypes[i];
      if (type === undefined)
        continue;
      if (currentType === type)
        currentCount++;
      else {
        if (currentType !== null)
          locals.push({ count: currentCount, type: typeToOp(currentType) });
        currentType = type;
        currentCount = 1;
      }
    }
    if (currentType !== null)
      locals.push({ count: currentCount, type: typeToOp(currentType) });
    return locals;
  }
  pruneUnusedLocals() {
    if (!this.finalized) {
      throw new Error("pruneUnusedLocals: la función debe estar finalizada");
    }
    const paramCount = this.paramTypes.length;
    const instrs = this.instructions;
    const read = new Set;
    for (const instr of instrs) {
      if (instr.op === "LOCAL_GET" || instr.op === "LOCAL_TEE") {
        read.add(instr.index);
      }
    }
    const keep = new Set;
    for (let i = 0;i < paramCount; i++)
      keep.add(i);
    for (const i of read)
      keep.add(i);
    const remap = new Map;
    let next = 0;
    for (let i = 0;i < this.nextLocalIdx; i++) {
      if (keep.has(i))
        remap.set(i, next++);
    }
    const newInstrs = [];
    for (const instr of instrs) {
      if (instr.op === "LOCAL_GET" || instr.op === "LOCAL_SET" || instr.op === "LOCAL_TEE") {
        const mapped = remap.get(instr.index);
        if (mapped === undefined) {
          if (instr.op === "LOCAL_SET") {
            newInstrs.push({ op: "DROP" });
          } else if (instr.op === "LOCAL_TEE") {
            newInstrs.push({ op: "NOP" });
          } else {
            throw new Error("pruneUnusedLocals: LOCAL_GET de local eliminado");
          }
        } else {
          instr.index = mapped;
          newInstrs.push(instr);
        }
      } else {
        newInstrs.push(instr);
      }
    }
    this.instructions = newInstrs;
    const newTypes = this.paramTypes.slice();
    for (const [oldIdx, newIdx] of remap) {
      if (oldIdx < paramCount)
        continue;
      newTypes[newIdx] = this.localTypes[oldIdx];
    }
    this.localTypes = newTypes;
    this.nextLocalIdx = next;
  }
}
var I32_SAFE_PRODUCERS = new Set([
  "I32_CONST",
  "I32_DATA_CONST",
  "LOCAL_GET",
  "LOCAL_TEE",
  "GLOBAL_GET",
  "I32_LOAD",
  "I32_LOAD8_S",
  "I32_LOAD8_U",
  "I32_LOAD16_S",
  "I32_LOAD16_U",
  "I32_ADD",
  "I32_SUB",
  "I32_MUL",
  "I32_DIV_S",
  "I32_DIV_U",
  "I32_REM_S",
  "I32_REM_U",
  "I32_AND",
  "I32_OR",
  "I32_XOR",
  "I32_SHL",
  "I32_SHR_S",
  "I32_SHR_U",
  "I32_ROTL",
  "I32_ROTR",
  "I32_CLZ",
  "I32_CTZ",
  "I32_POPCNT",
  "I32_EQZ",
  "I32_EQ",
  "I32_NE",
  "I32_LT_S",
  "I32_LT_U",
  "I32_GT_S",
  "I32_GT_U",
  "I32_LE_S",
  "I32_LE_U",
  "I32_GE_S",
  "I32_GE_U",
  "I32_WRAP_I64",
  "I32_TRUNC_F32_S",
  "I32_TRUNC_F32_U",
  "I32_TRUNC_F64_S",
  "I32_TRUNC_F64_U",
  "I32_REINTERPRET_F32",
  "I32_TRUNC_SAT_F32_S",
  "I32_TRUNC_SAT_F32_U",
  "I32_TRUNC_SAT_F64_S",
  "I32_TRUNC_SAT_F64_U",
  "MEMORY_SIZE"
]);
var IR_TERMINATORS = new Set([
  "RETURN",
  "UNREACHABLE",
  "BR",
  "BR_TABLE",
  "RETURN_CALL_REF"
]);
var IR_BLOCK_OPENERS = new Set(["BLOCK", "LOOP", "IF"]);
function removeDeadCode(ir) {
  const out = [];
  const deadStack = [false];
  const savedOuter = [false];
  const isDead = () => deadStack[deadStack.length - 1];
  for (const instr of ir) {
    const op = instr.op;
    if (IR_BLOCK_OPENERS.has(op)) {
      const outerDead = isDead();
      savedOuter.push(outerDead);
      deadStack.push(outerDead);
      if (!outerDead)
        out.push(instr);
      continue;
    }
    if (op === "ELSE") {
      const outerDead = savedOuter[savedOuter.length - 1];
      deadStack[deadStack.length - 1] = outerDead;
      if (!outerDead)
        out.push(instr);
      continue;
    }
    if (op === "END") {
      deadStack.pop();
      const wasEnteredLive = !savedOuter.pop();
      if (wasEnteredLive)
        out.push(instr);
      continue;
    }
    if (IR_TERMINATORS.has(op)) {
      if (!isDead()) {
        out.push(instr);
        deadStack[deadStack.length - 1] = true;
      }
      continue;
    }
    if (!isDead())
      out.push(instr);
  }
  return out;
}
function tryFoldI32Binop(a, b, op) {
  switch (op) {
    case "I32_ADD":
      return a + b | 0;
    case "I32_SUB":
      return a - b | 0;
    case "I32_MUL":
      return Math.imul(a, b);
    case "I32_DIV_S":
      return b === 0 ? null : a / b | 0;
    case "I32_DIV_U":
      return b === 0 ? null : (a >>> 0) / (b >>> 0) >>> 0;
    case "I32_REM_S":
      return b === 0 ? null : a % b | 0;
    case "I32_REM_U":
      return b === 0 ? null : (a >>> 0) % (b >>> 0) >>> 0;
    case "I32_AND":
      return a & b;
    case "I32_OR":
      return a | b;
    case "I32_XOR":
      return a ^ b;
    case "I32_SHL":
      return a << (b & 31) | 0;
    case "I32_SHR_S":
      return a >> (b & 31);
    case "I32_SHR_U":
      return a >>> (b & 31);
    case "I32_ROTL": {
      const n = b & 31;
      return a << n | a >>> 32 - n | 0;
    }
    case "I32_ROTR": {
      const n = b & 31;
      return a >>> n | a << 32 - n | 0;
    }
    case "I32_EQ":
      return a === b ? 1 : 0;
    case "I32_NE":
      return a !== b ? 1 : 0;
    case "I32_LT_S":
      return a < b ? 1 : 0;
    case "I32_LT_U":
      return a >>> 0 < b >>> 0 ? 1 : 0;
    case "I32_GT_S":
      return a > b ? 1 : 0;
    case "I32_GT_U":
      return a >>> 0 > b >>> 0 ? 1 : 0;
    case "I32_LE_S":
      return a <= b ? 1 : 0;
    case "I32_LE_U":
      return a >>> 0 <= b >>> 0 ? 1 : 0;
    case "I32_GE_S":
      return a >= b ? 1 : 0;
    case "I32_GE_U":
      return a >>> 0 >= b >>> 0 ? 1 : 0;
    default:
      return null;
  }
}
function peephole(ir) {
  const out = [];
  for (let i = 0;i < ir.length; i++) {
    const a = ir[i];
    const b = ir[i + 1];
    const c = ir[i + 2];
    if (a && b && c && I32_SAFE_PRODUCERS.has(a.op) && b.op === "I32_CONST" && b.val === 0 && c.op === "I32_ADD") {
      out.push(a);
      i += 2;
      continue;
    }
    if (a && b && c && I32_SAFE_PRODUCERS.has(a.op) && b.op === "I32_CONST" && b.val === 1 && c.op === "I32_MUL") {
      out.push(a);
      i += 2;
      continue;
    }
    if (a && b && c && I32_SAFE_PRODUCERS.has(a.op) && b.op === "I32_CONST" && b.val === 0 && c.op === "I32_OR") {
      out.push(a);
      i += 2;
      continue;
    }
    if (a && b && c && I32_SAFE_PRODUCERS.has(a.op) && b.op === "I32_CONST" && b.val === -1 && c.op === "I32_AND") {
      out.push(a);
      i += 2;
      continue;
    }
    if (a && b && c && (a.op === "I32_CONST" || a.op === "I32_DATA_CONST") && (b.op === "I32_CONST" || b.op === "I32_DATA_CONST") && typeof a.val === "number" && typeof b.val === "number") {
      const folded = tryFoldI32Binop(a.val, b.val, c.op);
      if (folded !== null) {
        out.push({ op: "I32_CONST", val: folded });
        i += 2;
        continue;
      }
    }
    if (a && b && a.op === "LOCAL_SET" && b.op === "LOCAL_GET" && a.index === b.index) {
      out.push({ op: "LOCAL_TEE", index: a.index });
      i += 1;
      continue;
    }
    if (a && b && a.op === "LOCAL_GET" && b.op === "LOCAL_SET" && a.index === b.index) {
      i += 1;
      continue;
    }
    out.push(a);
  }
  return out;
}
function optimizeIR(ir) {
  let cur = ir;
  for (let iter = 0;iter < 8; iter++) {
    const next = peephole(removeDeadCode(cur));
    if (next.length === cur.length)
      break;
    cur = next;
  }
  return cur;
}

class ModuleBuilder {
  types = [];
  externals = [];
  functions = [];
  globals = [];
  tables = [];
  funcNameToIndex = new Map;
  globalNameToIndex = new Map;
  hasMemory = false;
  memoryInitial = 1;
  memoryMax;
  dataSegments = [];
  elements = [];
  pendingElements = [];
  funcAliasToIndex = new Map;
  functionTableIndices = new Map;
  customSections = [];
  startFunction = null;
  lambdaCounter = 0;
  typeNameToIdx = new Map;
  dynamicTableMin = 0;
  tableAuto = false;
  stringPool = null;
  setFunctionTableIndex(funcName, tableIndex) {
    this.functionTableIndices.set(funcName, tableIndex);
  }
  getFunctionTableIndex(funcName) {
    const idx = this.functionTableIndices.get(funcName);
    if (idx === undefined)
      throw new Error(`Función sin índice de tabla: ${funcName}`);
    return idx;
  }
  addFunctionToTable(funcName, tableIndex, offset) {
    const actualOffset = offset ?? tableIndex;
    this.setFunctionTableIndex(funcName, actualOffset);
    this.addElementSegment(0, actualOffset, [funcName]);
  }
  setStart(funcNameOrIndex) {
    this.startFunction = funcNameOrIndex;
  }
  addCustomSection(name, data, atEnd = false) {
    this.customSections.push({ name, data, atEnd });
  }
  addNameSection(moduleName, funcNames, localNames) {
    const buf = [];
    if (moduleName !== null) {
      const sub = [...encodeName(moduleName)];
      buf.push(0, ...encodeLEB128(sub.length), ...sub);
    }
    if (funcNames.size > 0) {
      const sub = [...encodeLEB128(funcNames.size)];
      const entries = [...funcNames.entries()].sort((a, b) => a[0] - b[0]);
      for (const [idx, name] of entries) {
        sub.push(...encodeLEB128(idx), ...encodeName(name));
      }
      buf.push(1, ...encodeLEB128(sub.length), ...sub);
    }
    if (localNames && localNames.size > 0) {
      const sub = [...encodeLEB128(localNames.size)];
      const funcs = [...localNames.entries()].sort((a, b) => a[0] - b[0]);
      for (const [funcIdx, locals] of funcs) {
        sub.push(...encodeLEB128(funcIdx), ...encodeLEB128(locals.size));
        const sorted = [...locals.entries()].sort((a, b) => a[0] - b[0]);
        for (const [localIdx, name] of sorted) {
          sub.push(...encodeLEB128(localIdx), ...encodeName(name));
        }
      }
      buf.push(2, ...encodeLEB128(sub.length), ...sub);
    }
    this.addCustomSection("name", buf, true);
  }
  addProducersSection(producers) {
    const buf = [...encodeLEB128(producers.length)];
    for (const p of producers) {
      buf.push(...encodeName(p.field));
      buf.push(...encodeLEB128(p.values.length));
      for (const v of p.values) {
        buf.push(...encodeName(v.name), ...encodeName(v.version));
      }
    }
    this.addCustomSection("producers", buf, true);
  }
  getStringPool(baseOffset) {
    if (!this.stringPool) {
      this.stringPool = new StringPool(baseOffset ?? 0);
    } else if (baseOffset !== undefined && baseOffset !== this.stringPool.getBaseOffset()) {
      throw new Error(`StringPool ya tiene baseOffset=${this.stringPool.getBaseOffset()}, no se puede cambiar a ${baseOffset}`);
    }
    return this.stringPool;
  }
  getStringPoolOrNull() {
    return this.stringPool;
  }
  attachStringPool(pool) {
    if (this.stringPool && this.stringPool !== pool) {
      throw new Error("Ya existe un StringPool asociado al módulo");
    }
    this.stringPool = pool;
  }
  ensureStringData() {
    this.prepareStringData();
  }
  addString(text) {
    return this.getStringPool().add(text);
  }
  getTypeIndex(paramTypes, returnTypes) {
    return this._getTypeIdx(paramTypes, returnTypes);
  }
  getStaticDataSize() {
    return this.dataSegments.reduce((max, seg) => Math.max(max, seg.offset + seg.data.length), 0);
  }
  getMemoryInitialPages() {
    return this.memoryInitial;
  }
  getStaticDataEnd(align = 8) {
    let end = 0;
    for (const seg of this.dataSegments) {
      const e = seg.offset + seg.data.length;
      if (e > end)
        end = e;
    }
    if (this.stringPool) {
      for (const seg of this.stringPool.getDataSegments()) {
        const e = seg.offset + seg.data.length;
        if (e > end)
          end = e;
      }
    }
    if (align <= 1)
      return end;
    return end + (align - 1) & ~(align - 1);
  }
  prepareStringData() {
    if (!this.stringPool)
      return;
    this.dataSegments = this.dataSegments.filter((ds) => !ds.fromStringPool);
    const segments = this.stringPool.getDataSegments();
    if (segments.length === 0)
      return;
    this.hasMemory = true;
    for (const seg of segments) {
      const newSeg = {
        offset: seg.offset,
        data: Array.from(seg.data),
        fromStringPool: true
      };
      this.dataSegments.push(newSeg);
      this._updateMemoryForData(newSeg.offset, newSeg.data.length);
    }
  }
  _getTypeIdx(paramTypes, returnTypes) {
    const params = paramTypes.map(typeToOp);
    const results = returnTypes.map(typeToOp);
    const key = JSON.stringify({ params, results });
    let idx = this.types.findIndex((t) => JSON.stringify(t) === key);
    if (idx !== -1)
      return idx;
    idx = this.types.length;
    this.types.push({ params, results });
    return idx;
  }
  hasMemoryImport() {
    return this.externals.some((e) => e.section === "import" && e.kind === "memory");
  }
  hasTableImport() {
    return this.externals.some((e) => e.section === "import" && e.kind === "table");
  }
  addType(nameOrParams, paramTypesOrReturn, returnTypes) {
    if (typeof nameOrParams === "string") {
      const name = nameOrParams;
      if (this.typeNameToIdx.has(name))
        throw new Error(`El tipo con nombre "${name}" ya está definido.`);
      const idx = this._getTypeIdx(paramTypesOrReturn, returnTypes);
      this.typeNameToIdx.set(name, idx);
      return idx;
    }
    return this._getTypeIdx(nameOrParams, paramTypesOrReturn);
  }
  addElementSegment(tableIndex, offset, funcNames) {
    const offsetBytes = [OP.I32_CONST, ...encodeSignedLEB128(offset), OP.END];
    this.addElementSegmentByName(tableIndex, offsetBytes, funcNames);
  }
  addElementSegmentByName(tableIndex, offsetExprBytes, funcNames) {
    const offset = this._decodeOffset(offsetExprBytes);
    const requiredMin = offset + funcNames.length;
    if (requiredMin > this.dynamicTableMin)
      this.dynamicTableMin = requiredMin;
    if (this.tables.length === 0 && !this.hasTableImport())
      this.tableAuto = true;
    const mode = tableIndex === 0 ? 0 : 2;
    this.pendingElements.push({
      mode,
      tableIndex,
      offsetBytes: offsetExprBytes,
      funcNames,
      exprs: null,
      refType: "funcref",
      elemKind: 0
    });
  }
  addPassiveElementSegment(funcNames) {
    this.pendingElements.push({
      mode: 1,
      tableIndex: 0,
      offsetBytes: null,
      funcNames,
      exprs: null,
      refType: "funcref",
      elemKind: 0
    });
  }
  addDeclarativeElementSegment(funcNames) {
    this.pendingElements.push({
      mode: 3,
      tableIndex: 0,
      offsetBytes: null,
      funcNames,
      exprs: null,
      refType: "funcref",
      elemKind: 0
    });
  }
  addElementSegmentExprs(mode, tableIndex, offsetExprBytes, exprs, refType = "funcref") {
    const elemKind = refType === "funcref" ? 0 : 1;
    if ((mode === 4 || mode === 6) && offsetExprBytes === null) {
      throw new Error(`Element mode ${mode} requiere offsetExprBytes`);
    }
    if ((mode === 5 || mode === 7) && offsetExprBytes !== null) {
      throw new Error(`Element mode ${mode} no acepta offsetExprBytes`);
    }
    if ((mode === 4 || mode === 5) && tableIndex !== 0) {
      throw new Error(`Element mode ${mode} implica table 0`);
    }
    if (mode === 4 || mode === 6) {
      const offset = this._decodeOffset(offsetExprBytes);
      const requiredMin = offset + exprs.length;
      if (requiredMin > this.dynamicTableMin)
        this.dynamicTableMin = requiredMin;
      if (this.tables.length === 0 && !this.hasTableImport())
        this.tableAuto = true;
    }
    this.pendingElements.push({
      mode,
      tableIndex,
      offsetBytes: offsetExprBytes,
      funcNames: null,
      exprs,
      refType,
      elemKind
    });
  }
  addFunctionInstance(name, builder) {
    builder.finalize();
    const typeIdx = this._getTypeIdx(builder.paramTypes, builder.returnType);
    this.functions.push({
      name,
      builder,
      paramTypes: builder.paramTypes,
      returnType: builder.returnType,
      typeIdx
    });
  }
  addFunctionImportAlias(module, field, localName, paramTypes, returnType) {
    const idx = this.addFunctionImport(module, field, paramTypes, returnType);
    this.funcAliasToIndex.set(localName, idx);
    return idx;
  }
  addFunctionImport(module, name, paramTypes, returnType) {
    const returnTypes = returnType ? Array.isArray(returnType) ? returnType : [returnType] : [];
    const typeIdx = this._getTypeIdx(paramTypes, returnTypes);
    const idx = this.externals.length;
    this.externals.push({ section: "import", name, kind: "function", module, typeIdx });
    return idx;
  }
  addMemoryImport(module, name, initial, maximum) {
    const idx = this.externals.length;
    this.externals.push({ section: "import", name, kind: "memory", module, initial, maximum });
    this.hasMemory = true;
    if (initial > this.memoryInitial)
      this.memoryInitial = initial;
    if (maximum !== undefined)
      this.memoryMax = maximum;
    return idx;
  }
  addTableImport(module, name, initial, maximum, refType = "funcref") {
    if (this.tables.length > 0) {
      throw new Error("No se puede importar tabla si ya hay una tabla local definida");
    }
    const idx = this.externals.length;
    this.externals.push({ section: "import", name, kind: "table", module, initial, maximum, refType });
    return idx;
  }
  addGlobalImport(module, name, type, mutable = false) {
    const idx = this.externals.length;
    this.externals.push({ section: "import", name, kind: "global", module, valueType: type, mutable });
    return idx;
  }
  addMemory(initial, max) {
    this.hasMemory = true;
    if (initial > this.memoryInitial)
      this.memoryInitial = initial;
    this.memoryMax = max;
  }
  _updateMemoryForData(offset, size) {
    if (this.hasMemoryImport())
      return;
    const need = Math.max(1, Math.ceil((offset + size) / 65536));
    if (need > this.memoryInitial)
      this.memoryInitial = need;
  }
  addDataSegment(offset, dataBytes) {
    this.hasMemory = true;
    this.dataSegments.push({ offset, data: dataBytes });
    this._updateMemoryForData(offset, dataBytes.length);
  }
  addStaticData(dataBuilder, baseOffset = 0) {
    const bytes = Array.from(dataBuilder.build());
    if (bytes.length === 0)
      return baseOffset;
    this.addDataSegment(baseOffset, bytes);
    return baseOffset;
  }
  addData32(offset, value) {
    this.addDataSegment(offset, [
      value & 255,
      value >> 8 & 255,
      value >> 16 & 255,
      value >> 24 & 255
    ]);
  }
  addData64(offset, value) {
    const bytes = [];
    let val = value;
    for (let i = 0;i < 8; i++) {
      bytes.push(Number(val & 0xFFn));
      val >>= 8n;
    }
    this.addDataSegment(offset, bytes);
  }
  addDataString(offset, text) {
    this.addDataSegment(offset, Array.from(new TextEncoder().encode(text)));
  }
  addGlobal(name, type, mutable, initialValue) {
    if ((Array.isArray(initialValue) || initialValue instanceof Uint8Array) && type !== "v128") {
      throw new Error(`addGlobal: initialValue tipo array/Uint8Array solo es válido para v128 (recibido para ${type})`);
    }
    let initBytes;
    if (type === "funcref" || type === "externref") {
      if (initialValue !== null) {
        throw new Error(`addGlobal: para tipo ${type} solo se permite initialValue = null (ref.null)`);
      }
      initBytes = [OP.REF_NULL, refTypeToOp(type), OP.END];
    } else if (type === "v128") {
      if (initialValue === null) {
        const zeros = new Array(16).fill(0);
        initBytes = [OP.SIMD_PREFIX, ...encodeLEB128(SIMD_CONST_SUBOP), ...zeros, OP.END];
      } else if (typeof initialValue === "number" || typeof initialValue === "bigint") {
        if (BigInt(initialValue) !== 0n) {
          throw new Error("addGlobal: v128 con initialValue escalar solo acepta 0; " + "usa un Uint8Array/number[] de 16 bytes para valores no-cero");
        }
        const zeros = new Array(16).fill(0);
        initBytes = [OP.SIMD_PREFIX, ...encodeLEB128(SIMD_CONST_SUBOP), ...zeros, OP.END];
      } else {
        const arr = initialValue instanceof Uint8Array ? Array.from(initialValue) : initialValue;
        if (arr.length !== 16) {
          throw new Error(`addGlobal: v128 initialValue requiere 16 bytes (recibido ${arr.length})`);
        }
        initBytes = [OP.SIMD_PREFIX, ...encodeLEB128(SIMD_CONST_SUBOP), ...arr, OP.END];
      }
    } else if (type === "i32") {
      if (initialValue === null)
        throw new Error("addGlobal: i32 no acepta initialValue = null");
      initBytes = [OP.I32_CONST, ...encodeSignedLEB128(toI32(initialValue)), OP.END];
    } else if (type === "i64") {
      if (initialValue === null)
        throw new Error("addGlobal: i64 no acepta initialValue = null");
      initBytes = [OP.I64_CONST, ...encodeSignedLEB128(toI64(initialValue)), OP.END];
    } else if (type === "f64") {
      if (initialValue === null)
        throw new Error("addGlobal: f64 no acepta initialValue = null");
      initBytes = [OP.F64_CONST, ...floatToBytes(Number(initialValue), 64), OP.END];
    } else if (type === "f32") {
      if (initialValue === null)
        throw new Error("addGlobal: f32 no acepta initialValue = null");
      initBytes = [OP.F32_CONST, ...floatToBytes(Number(initialValue), 32), OP.END];
    } else {
      throw new Error(`Tipo de global no soportado: ${type}`);
    }
    this.globals.push({ name, type, mutable, initExprBytes: initBytes });
  }
  addFunction(name, paramTypes, returnType, buildFn, paramNames = []) {
    const effectiveName = name ?? `__lambda_${this.lambdaCounter++}`;
    let finalParamTypes;
    let finalReturnTypes;
    let forcedTypeIdx;
    if (typeof paramTypes === "string") {
      if (returnType !== null)
        throw new Error(`addFunction con tipo nombrado "${paramTypes}" debe recibir returnType = null`);
      const idx = this.typeNameToIdx.get(paramTypes);
      if (idx === undefined)
        throw new Error(`Tipo con nombre "${paramTypes}" no definido.`);
      const t = this.types[idx];
      finalParamTypes = t.params.map((op) => opToType[op]);
      finalReturnTypes = t.results.map((op) => opToType[op]);
      forcedTypeIdx = idx;
    } else {
      finalParamTypes = paramTypes;
      finalReturnTypes = returnType ? Array.isArray(returnType) ? returnType : [returnType] : [];
    }
    const builder = new FunctionIRBuilder(finalParamTypes, finalReturnTypes, paramNames, this);
    if (buildFn)
      buildFn(builder);
    builder.finalize();
    const actualReturnTypes = builder.returnType;
    const typeIdx = forcedTypeIdx ?? this._getTypeIdx(finalParamTypes, actualReturnTypes);
    if (forcedTypeIdx !== undefined) {
      const expected = this.types[forcedTypeIdx].results.map((op) => opToType[op]);
      if (JSON.stringify(expected) !== JSON.stringify(actualReturnTypes)) {
        throw new Error(`El retorno inferido de "${effectiveName}" no coincide con el tipo nombrado. ` + `Esperado: [${expected.join(", ")}], actual: [${actualReturnTypes.join(", ")}].`);
      }
    }
    this.functions.push({ name: effectiveName, builder, paramTypes: finalParamTypes, returnType: actualReturnTypes, typeIdx });
    return builder;
  }
  addExport(name, kind, indexOrName) {
    this.externals.push({ section: "export", name, kind, index: indexOrName });
  }
  addTable(minSize, maxSize, refType = "funcref") {
    if (this.hasTableImport()) {
      throw new Error("No se puede definir tabla local si ya hay una importada");
    }
    const idx = this.tables.length;
    this.tables.push({ min: minSize, max: maxSize, refType });
    this.tableAuto = false;
    return idx;
  }
  _decodeOffset(offsetBytes) {
    if (offsetBytes.length < 2)
      throw new Error("Offset muy corto para i32.const");
    if (offsetBytes[0] !== OP.I32_CONST)
      throw new Error("Offset debe comenzar con i32.const");
    let pos = 1;
    let result = 0;
    let shift = 0;
    while (pos < offsetBytes.length) {
      const byte = offsetBytes[pos++];
      result |= (byte & 127) << shift;
      if (!(byte & 128))
        break;
      shift += 7;
    }
    if (offsetBytes[offsetBytes.length - 1] !== OP.END)
      throw new Error("Offset debe terminar con END");
    return result >>> 0;
  }
  build() {
    this.prepareStringData();
    this.elements = [];
    const importEntries = this.externals.filter((e) => e.section === "import");
    const exportEntries = this.externals.filter((e) => e.section === "export");
    const importFuncCount = importEntries.filter((e) => e.kind === "function").length;
    const importGlobalCount = importEntries.filter((e) => e.kind === "global").length;
    const extToFuncIdx = new Map;
    {
      let funcIdx = 0;
      for (let i = 0;i < this.externals.length; i++) {
        const e = this.externals[i];
        if (e.section === "import" && e.kind === "function")
          extToFuncIdx.set(i, funcIdx++);
      }
    }
    this.funcNameToIndex.clear();
    for (const [alias, extIdx] of this.funcAliasToIndex) {
      const wasmIdx = extToFuncIdx.get(extIdx);
      if (wasmIdx === undefined)
        throw new Error(`Alias '${alias}': no apunta a una función importada`);
      const existing = this.funcNameToIndex.get(alias);
      if (existing !== undefined && existing !== wasmIdx) {
        throw new Error(`Nombre de función duplicado: ${alias} (${existing} vs ${wasmIdx})`);
      }
      this.funcNameToIndex.set(alias, wasmIdx);
    }
    for (let i = 0;i < this.functions.length; i++) {
      const name = this.functions[i].name;
      if (this.funcNameToIndex.has(name))
        throw new Error(`Nombre de función duplicado con import: ${name}`);
      this.funcNameToIndex.set(name, importFuncCount + i);
    }
    this.globalNameToIndex.clear();
    let globalImportIdx = 0;
    for (const imp of importEntries) {
      if (imp.kind === "global") {
        if (this.globalNameToIndex.has(imp.name))
          throw new Error(`Global duplicada: ${imp.name}`);
        this.globalNameToIndex.set(imp.name, globalImportIdx++);
      }
    }
    for (let i = 0;i < this.globals.length; i++) {
      const name = this.globals[i].name;
      if (this.globalNameToIndex.has(name))
        throw new Error(`Global duplicada: ${name}`);
      this.globalNameToIndex.set(name, importGlobalCount + i);
    }
    const resolvedExports = exportEntries.map((exp) => {
      let index;
      if (exp.kind === "memory")
        index = 0;
      else if (exp.kind === "table") {
        if (typeof exp.index === "string")
          throw new Error(`Export '${exp.name}': tablas no tienen nombre; usa índice numérico`);
        index = exp.index;
      } else if (typeof exp.index === "string") {
        if (exp.kind === "function")
          index = this.funcNameToIndex.get(exp.index);
        else if (exp.kind === "global")
          index = this.globalNameToIndex.get(exp.index);
        if (index === undefined)
          throw new Error(`Export '${exp.name}': nombre no encontrado`);
      } else {
        index = exp.index;
      }
      return { name: exp.name, kind: exp.kind, index };
    });
    for (const fn of this.functions) {
      fn.builder.instructions = fn.builder.instructions.map((instr) => {
        if (instr.op === "CALL_BY_NAME") {
          const absIdx = this.funcNameToIndex.get(instr.name);
          if (absIdx === undefined)
            throw new Error(`Función no definida: ${instr.name}`);
          return { op: "CALL", index: absIdx };
        }
        if (instr.op === "REF_FUNC_BY_NAME") {
          const absIdx = this.funcNameToIndex.get(instr.name);
          if (absIdx === undefined)
            throw new Error(`Función no definida: ${instr.name}`);
          return { op: "REF_FUNC", index: absIdx };
        }
        if (instr.op === "FUNCTION_INDEX_BY_NAME") {
          const tableIdx = this.functionTableIndices.get(instr.name);
          if (tableIdx === undefined)
            throw new Error(`Función sin índice de tabla: ${instr.name}`);
          return { op: "I32_CONST", val: tableIdx };
        }
        return instr;
      });
    }
    for (const fn of this.functions) {
      fn.builder.instructions = fn.builder.instructions.map((instr) => {
        if ((instr.op === "GLOBAL_GET" || instr.op === "GLOBAL_SET") && typeof instr.index === "string") {
          const absIdx = this.globalNameToIndex.get(instr.index);
          if (absIdx === undefined)
            throw new Error(`Global no definida: ${instr.index}`);
          return { op: instr.op, index: absIdx };
        }
        return instr;
      });
    }
    if (ENABLE_OPTIMIZER) {
      for (const fn of this.functions) {
        fn.builder.instructions = optimizeIR(fn.builder.instructions);
        fn.builder.pruneUnusedLocals();
        fn.builder.instructions = optimizeIR(fn.builder.instructions);
      }
    }
    const hasMemoryImport = this.hasMemoryImport();
    if (!this.hasMemory && !hasMemoryImport) {
      for (const fn of this.functions) {
        if (fn.builder.needsMemory) {
          this.addMemory(1);
          break;
        }
      }
    }
    const hasTableImport = this.hasTableImport();
    if (this.pendingElements.length > 0) {
      const needsActiveTable = this.pendingElements.some((p) => p.mode === 0 || p.mode === 2 || p.mode === 4 || p.mode === 6);
      if (this.tableAuto && this.tables.length === 0 && !hasTableImport) {
        this.tables.push({ min: this.dynamicTableMin, max: undefined, refType: "funcref" });
      } else if (needsActiveTable && this.tables.length === 0 && !hasTableImport) {
        throw new Error("Se agregaron elementos de tabla activos sin definir una tabla");
      }
      for (const seg of this.pendingElements) {
        const resolvedFuncIdx = seg.funcNames ? seg.funcNames.map((name) => {
          const idx = this.funcNameToIndex.get(name);
          if (idx === undefined)
            throw new Error(`Función no encontrada: ${name}`);
          return idx;
        }) : null;
        const resolvedExprBytes = seg.exprs ? seg.exprs.map((e) => this._encodeElementExpr(e)) : null;
        this.elements.push({
          mode: seg.mode,
          tableIndex: seg.tableIndex,
          offsetBytes: seg.offsetBytes,
          funcIndices: resolvedFuncIdx,
          exprsBytes: resolvedExprBytes,
          refType: seg.refType,
          elemKind: seg.elemKind
        });
      }
    }
    const codeEntries = [];
    for (const fn of this.functions) {
      const bytecode = emitirBytecode(fn.builder.instructions);
      bytecode.push(OP.END);
      const locals = fn.builder.getLocals();
      const body = [];
      body.push(...encodeLEB128(locals.length));
      for (const loc of locals) {
        body.push(...encodeLEB128(loc.count));
        body.push(loc.type);
      }
      body.push(...bytecode);
      codeEntries.push({ size: body.length, body });
    }
    const sections = [];
    if (this.types.length) {
      const buf = [...encodeLEB128(this.types.length)];
      for (const t of this.types) {
        buf.push(96);
        buf.push(...encodeLEB128(t.params.length), ...t.params);
        buf.push(...encodeLEB128(t.results.length), ...t.results);
      }
      sections.push({ id: 1, bytes: buf });
    }
    if (importEntries.length) {
      const buf = [...encodeLEB128(importEntries.length)];
      for (const imp of importEntries) {
        buf.push(...encodeName(imp.module), ...encodeName(imp.name));
        if (imp.kind === "function") {
          buf.push(0, ...encodeLEB128(imp.typeIdx));
        } else if (imp.kind === "table") {
          const refOp = refTypeToOp(imp.refType ?? "funcref");
          buf.push(1, refOp);
          const flags = imp.maximum !== undefined ? 1 : 0;
          buf.push(flags, ...encodeLEB128(imp.initial));
          if (imp.maximum !== undefined)
            buf.push(...encodeLEB128(imp.maximum));
        } else if (imp.kind === "memory") {
          buf.push(2);
          const flags = imp.maximum !== undefined ? 1 : 0;
          buf.push(flags, ...encodeLEB128(imp.initial));
          if (imp.maximum !== undefined)
            buf.push(...encodeLEB128(imp.maximum));
        } else if (imp.kind === "global") {
          buf.push(3, typeToOp(imp.valueType), imp.mutable ? 1 : 0);
        }
      }
      sections.push({ id: 2, bytes: buf });
    }
    if (this.functions.length) {
      const buf = [...encodeLEB128(this.functions.length)];
      for (const fn of this.functions)
        buf.push(...encodeLEB128(fn.typeIdx));
      sections.push({ id: 3, bytes: buf });
    }
    if (this.tables.length > 0) {
      const buf = [...encodeLEB128(this.tables.length)];
      for (const t of this.tables) {
        buf.push(refTypeToOp(t.refType));
        const flags = t.max !== undefined ? 1 : 0;
        buf.push(flags, ...encodeLEB128(t.min));
        if (t.max !== undefined)
          buf.push(...encodeLEB128(t.max));
      }
      sections.push({ id: 4, bytes: buf });
    }
    if (this.hasMemory && !hasMemoryImport) {
      const flags = this.memoryMax !== undefined ? 1 : 0;
      const memBytes = [1, flags, ...encodeLEB128(this.memoryInitial)];
      if (this.memoryMax !== undefined)
        memBytes.push(...encodeLEB128(this.memoryMax));
      sections.push({ id: 5, bytes: memBytes });
    }
    if (this.globals.length) {
      const buf = [...encodeLEB128(this.globals.length)];
      for (const g of this.globals) {
        buf.push(typeToOp(g.type), g.mutable ? 1 : 0, ...g.initExprBytes);
      }
      sections.push({ id: 6, bytes: buf });
    }
    if (resolvedExports.length) {
      const buf = [...encodeLEB128(resolvedExports.length)];
      for (const exp of resolvedExports) {
        buf.push(...encodeName(exp.name));
        if (exp.kind === "function")
          buf.push(0);
        else if (exp.kind === "table")
          buf.push(1);
        else if (exp.kind === "memory")
          buf.push(2);
        else if (exp.kind === "global")
          buf.push(3);
        buf.push(...encodeLEB128(exp.index));
      }
      sections.push({ id: 7, bytes: buf });
    }
    if (this.startFunction !== null) {
      let startIdx;
      if (typeof this.startFunction === "string") {
        const idx = this.funcNameToIndex.get(this.startFunction);
        if (idx === undefined)
          throw new Error(`Start: función no encontrada: ${this.startFunction}`);
        startIdx = idx;
      } else {
        startIdx = this.startFunction;
      }
      sections.push({ id: 8, bytes: [...encodeLEB128(startIdx)] });
    }
    if (this.elements.length > 0) {
      const buf = [...encodeLEB128(this.elements.length)];
      for (const seg of this.elements) {
        buf.push(...encodeLEB128(seg.mode));
        switch (seg.mode) {
          case 0:
            buf.push(...seg.offsetBytes);
            buf.push(...encodeLEB128(seg.funcIndices.length));
            for (const fi of seg.funcIndices)
              buf.push(...encodeLEB128(fi));
            break;
          case 1:
            buf.push(seg.elemKind);
            buf.push(...encodeLEB128(seg.funcIndices.length));
            for (const fi of seg.funcIndices)
              buf.push(...encodeLEB128(fi));
            break;
          case 2:
            buf.push(...encodeLEB128(seg.tableIndex));
            buf.push(...seg.offsetBytes);
            buf.push(seg.elemKind);
            buf.push(...encodeLEB128(seg.funcIndices.length));
            for (const fi of seg.funcIndices)
              buf.push(...encodeLEB128(fi));
            break;
          case 3:
            buf.push(seg.elemKind);
            buf.push(...encodeLEB128(seg.funcIndices.length));
            for (const fi of seg.funcIndices)
              buf.push(...encodeLEB128(fi));
            break;
          case 4:
            buf.push(...seg.offsetBytes);
            buf.push(...encodeLEB128(seg.exprsBytes.length));
            for (const expr of seg.exprsBytes)
              buf.push(...expr);
            break;
          case 5:
            buf.push(refTypeToOp(seg.refType));
            buf.push(...encodeLEB128(seg.exprsBytes.length));
            for (const expr of seg.exprsBytes)
              buf.push(...expr);
            break;
          case 6:
            buf.push(...encodeLEB128(seg.tableIndex));
            buf.push(...seg.offsetBytes);
            buf.push(refTypeToOp(seg.refType));
            buf.push(...encodeLEB128(seg.exprsBytes.length));
            for (const expr of seg.exprsBytes)
              buf.push(...expr);
            break;
          case 7:
            buf.push(refTypeToOp(seg.refType));
            buf.push(...encodeLEB128(seg.exprsBytes.length));
            for (const expr of seg.exprsBytes)
              buf.push(...expr);
            break;
          default:
            throw new Error(`Element mode ${seg.mode} no soportado`);
        }
      }
      sections.push({ id: 9, bytes: buf });
    }
    if (this.functions.length) {
      const buf = [...encodeLEB128(this.functions.length)];
      for (const entry of codeEntries) {
        buf.push(...encodeLEB128(entry.size), ...entry.body);
      }
      sections.push({ id: 10, bytes: buf });
    }
    if (this.dataSegments.length > 0) {
      const buf = [...encodeLEB128(this.dataSegments.length)];
      for (const seg of this.dataSegments) {
        buf.push(0);
        buf.push(OP.I32_CONST, ...encodeSignedLEB128(seg.offset), OP.END);
        buf.push(...encodeLEB128(seg.data.length), ...seg.data);
      }
      sections.push({ id: 11, bytes: buf });
    }
    const header = [0, 97, 115, 109, 1, 0, 0, 0];
    const binary = [...header];
    const customSectionsBefore = this.customSections.filter((cs) => !cs.atEnd);
    const customSectionsAfter = this.customSections.filter((cs) => cs.atEnd);
    for (const cs of customSectionsBefore) {
      const content = [...encodeName(cs.name), ...cs.data];
      binary.push(0, ...encodeLEB128(content.length), ...content);
    }
    sections.sort((a, b) => a.id - b.id);
    for (const { id, bytes } of sections) {
      binary.push(id, ...encodeLEB128(bytes.length), ...bytes);
    }
    for (const cs of customSectionsAfter) {
      const content = [...encodeName(cs.name), ...cs.data];
      binary.push(0, ...encodeLEB128(content.length), ...content);
    }
    return new Uint8Array(binary);
  }
  _encodeElementExpr(e) {
    switch (e.kind) {
      case "ref.func": {
        const idx = this.funcNameToIndex.get(e.funcName);
        if (idx === undefined)
          throw new Error(`Element expr: función no encontrada: ${e.funcName}`);
        return [OP.REF_FUNC, ...encodeLEB128(idx), OP.END];
      }
      case "ref.null":
        return [OP.REF_NULL, refTypeToOp(e.type), OP.END];
      case "raw":
        return [...e.bytes];
      default: {
        const _exhaustive = e;
        throw new Error(`ElementExpr desconocido: ${JSON.stringify(_exhaustive)}`);
      }
    }
  }
  toWat() {
    return decodeModuleToWat(this.build());
  }
  toBinaryTree() {
    return formatBinaryTree(parseBinaryTree(this.build()));
  }
}

class BinaryReader {
  buf;
  pos = 0;
  constructor(buf) {
    this.buf = buf;
  }
  readByte() {
    if (this.pos >= this.buf.length)
      throw new Error("EOF");
    return this.buf[this.pos++];
  }
  readBytes(n) {
    if (this.pos + n > this.buf.length)
      throw new Error("EOF");
    const slice = this.buf.slice(this.pos, this.pos + n);
    this.pos += n;
    return slice;
  }
  get position() {
    return this.pos;
  }
  set position(p) {
    this.pos = p;
  }
  readU32() {
    let result = 0, shift = 0;
    while (true) {
      const byte = this.readByte();
      result |= (byte & 127) << shift;
      if (!(byte & 128))
        return result >>> 0;
      shift += 7;
    }
  }
  readS32() {
    let result = 0, shift = 0;
    while (true) {
      const byte = this.readByte();
      result |= (byte & 127) << shift;
      shift += 7;
      if (!(byte & 128)) {
        if (shift < 32 && byte & 64)
          result |= -(1 << shift);
        return result;
      }
    }
  }
  readS64() {
    let result = 0n, shift = 0n;
    while (true) {
      const byte = this.readByte();
      result |= BigInt(byte & 127) << shift;
      shift += 7n;
      if (!(byte & 128)) {
        if (shift < 64n && byte & 64)
          result |= -1n << shift;
        return result;
      }
    }
  }
  readName() {
    const len = this.readU32();
    return new TextDecoder().decode(this.readBytes(len));
  }
  eof() {
    return this.pos >= this.buf.length;
  }
}
var OPCODE_MAP = {
  0: "unreachable",
  1: "nop",
  2: "block",
  3: "loop",
  4: "if",
  5: "else",
  11: "end",
  12: "br",
  13: "br_if",
  14: "br_table",
  15: "return",
  16: "call",
  17: "call_indirect",
  20: "call_ref",
  21: "return_call_ref",
  26: "drop",
  27: "select",
  28: "select_t",
  32: "local.get",
  33: "local.set",
  34: "local.tee",
  35: "global.get",
  36: "global.set",
  37: "table.get",
  38: "table.set",
  40: "i32.load",
  41: "i64.load",
  42: "f32.load",
  43: "f64.load",
  44: "i32.load8_s",
  45: "i32.load8_u",
  46: "i32.load16_s",
  47: "i32.load16_u",
  48: "i64.load8_s",
  49: "i64.load8_u",
  50: "i64.load16_s",
  51: "i64.load16_u",
  52: "i64.load32_s",
  53: "i64.load32_u",
  54: "i32.store",
  55: "i64.store",
  56: "f32.store",
  57: "f64.store",
  58: "i32.store8",
  59: "i32.store16",
  60: "i64.store8",
  61: "i64.store16",
  62: "i64.store32",
  63: "memory.size",
  64: "memory.grow",
  65: "i32.const",
  66: "i64.const",
  67: "f32.const",
  68: "f64.const",
  69: "i32.eqz",
  80: "i64.eqz",
  70: "i32.eq",
  71: "i32.ne",
  72: "i32.lt_s",
  73: "i32.lt_u",
  74: "i32.gt_s",
  75: "i32.gt_u",
  76: "i32.le_s",
  77: "i32.le_u",
  78: "i32.ge_s",
  79: "i32.ge_u",
  81: "i64.eq",
  82: "i64.ne",
  83: "i64.lt_s",
  84: "i64.lt_u",
  85: "i64.gt_s",
  86: "i64.gt_u",
  87: "i64.le_s",
  88: "i64.le_u",
  89: "i64.ge_s",
  90: "i64.ge_u",
  91: "f32.eq",
  92: "f32.ne",
  93: "f32.lt",
  94: "f32.gt",
  95: "f32.le",
  96: "f32.ge",
  97: "f64.eq",
  98: "f64.ne",
  99: "f64.lt",
  100: "f64.gt",
  101: "f64.le",
  102: "f64.ge",
  103: "i32.clz",
  104: "i32.ctz",
  105: "i32.popcnt",
  106: "i32.add",
  107: "i32.sub",
  108: "i32.mul",
  109: "i32.div_s",
  110: "i32.div_u",
  111: "i32.rem_s",
  112: "i32.rem_u",
  113: "i32.and",
  114: "i32.or",
  115: "i32.xor",
  116: "i32.shl",
  117: "i32.shr_s",
  118: "i32.shr_u",
  119: "i32.rotl",
  120: "i32.rotr",
  121: "i64.clz",
  122: "i64.ctz",
  123: "i64.popcnt",
  124: "i64.add",
  125: "i64.sub",
  126: "i64.mul",
  127: "i64.div_s",
  128: "i64.div_u",
  129: "i64.rem_s",
  130: "i64.rem_u",
  131: "i64.and",
  132: "i64.or",
  133: "i64.xor",
  134: "i64.shl",
  135: "i64.shr_s",
  136: "i64.shr_u",
  137: "i64.rotl",
  138: "i64.rotr",
  139: "f32.abs",
  140: "f32.neg",
  141: "f32.ceil",
  142: "f32.floor",
  143: "f32.trunc",
  144: "f32.nearest",
  145: "f32.sqrt",
  146: "f32.add",
  147: "f32.sub",
  148: "f32.mul",
  149: "f32.div",
  150: "f32.min",
  151: "f32.max",
  152: "f32.copysign",
  153: "f64.abs",
  154: "f64.neg",
  155: "f64.ceil",
  156: "f64.floor",
  157: "f64.trunc",
  158: "f64.nearest",
  159: "f64.sqrt",
  160: "f64.add",
  161: "f64.sub",
  162: "f64.mul",
  163: "f64.div",
  164: "f64.min",
  165: "f64.max",
  166: "f64.copysign",
  167: "i32.wrap_i64",
  168: "i32.trunc_f32_s",
  169: "i32.trunc_f32_u",
  170: "i32.trunc_f64_s",
  171: "i32.trunc_f64_u",
  172: "i64.extend_i32_s",
  173: "i64.extend_i32_u",
  174: "i64.trunc_f32_s",
  175: "i64.trunc_f32_u",
  176: "i64.trunc_f64_s",
  177: "i64.trunc_f64_u",
  178: "f32.convert_i32_s",
  179: "f32.convert_i32_u",
  180: "f32.convert_i64_s",
  181: "f32.convert_i64_u",
  182: "f32.demote_f64",
  183: "f64.convert_i32_s",
  184: "f64.convert_i32_u",
  185: "f64.convert_i64_s",
  186: "f64.convert_i64_u",
  187: "f64.promote_f32",
  188: "i32.reinterpret_f32",
  189: "i64.reinterpret_f64",
  190: "f32.reinterpret_i32",
  191: "f64.reinterpret_i64",
  208: "ref.null",
  209: "ref.is_null",
  210: "ref.func"
};
var MISC_SUBOP_MAP = {
  0: "i32.trunc_sat_f32_s",
  1: "i32.trunc_sat_f32_u",
  2: "i32.trunc_sat_f64_s",
  3: "i32.trunc_sat_f64_u",
  4: "i64.trunc_sat_f32_s",
  5: "i64.trunc_sat_f32_u",
  6: "i64.trunc_sat_f64_s",
  7: "i64.trunc_sat_f64_u",
  8: "memory.init",
  9: "data.drop",
  10: "memory.copy",
  11: "memory.fill",
  12: "table.init",
  13: "elem.drop",
  14: "table.copy",
  15: "table.grow",
  16: "table.size",
  17: "table.fill"
};
function valTypeToStr(type) {
  const map = {
    127: "i32",
    126: "i64",
    125: "f32",
    124: "f64",
    123: "v128",
    112: "funcref",
    111: "externref"
  };
  return map[type] ?? "unknown";
}
function formatFuncType(idx, params, results) {
  const p = params.map(valTypeToStr).join(" ");
  const r = results.map(valTypeToStr).join(" ");
  let text = `(type (;${idx};) (func`;
  if (p)
    text += ` (param ${p})`;
  if (r)
    text += ` (result ${r})`;
  text += "))";
  return text;
}
function f32ToWat(bits) {
  return `0x${(bits >>> 0).toString(16).padStart(8, "0")}`;
}
function f64ToWat(bits) {
  return `0x${bits.toString(16).padStart(16, "0")}`;
}
function parseInitExpr(r) {
  const instrs = [];
  while (true) {
    const b = r.readByte();
    if (b === 11)
      break;
    r.position--;
    instrs.push(disassembleInstruction(r));
  }
  return instrs.join(" ");
}
function disassembleInstruction(r) {
  const opcode = r.readByte();
  if (opcode === 253) {
    const sub = r.readU32();
    const entry = SIMD_REVERSE.get(sub);
    if (!entry)
      throw new Error(`Subopcode SIMD desconocido: 0x${sub.toString(16)}`);
    switch (entry.kind) {
      case "noimm":
        return simdWatName(entry.name);
      case "memarg": {
        const alignExp = r.readU32();
        const offset = r.readU32();
        return `${simdWatName(entry.name)} offset=${offset} align=${1 << alignExp}`;
      }
      case "memarg_lane": {
        const alignExp = r.readU32();
        const offset = r.readU32();
        const lane = r.readByte();
        return `${simdWatName(entry.name)} ${lane} offset=${offset} align=${1 << alignExp}`;
      }
      case "lane": {
        const lane = r.readByte();
        return `${simdWatName(entry.name)} ${lane}`;
      }
      case "const": {
        const b = Array.from(r.readBytes(16));
        return `v128.const i8x16 ${b.join(" ")}`;
      }
      case "shuffle": {
        const b = Array.from(r.readBytes(16));
        return `i8x16.shuffle ${b.join(" ")}`;
      }
    }
  }
  if (opcode === 252) {
    const sub = r.readByte();
    const name = MISC_SUBOP_MAP[sub];
    if (!name)
      throw new Error(`Subopcode FC desconocido: 0x${sub.toString(16)}`);
    switch (sub) {
      case 8: {
        const d = r.readU32();
        r.readByte();
        return `memory.init ${d}`;
      }
      case 9:
        return `data.drop ${r.readU32()}`;
      case 10:
        r.readByte();
        r.readByte();
        return "memory.copy";
      case 11:
        r.readByte();
        return "memory.fill";
      case 12:
        return `table.init ${r.readU32()} ${r.readU32()}`;
      case 13:
        return `elem.drop ${r.readU32()}`;
      case 14:
        return `table.copy ${r.readU32()} ${r.readU32()}`;
      case 15:
        return `table.grow ${r.readU32()}`;
      case 16:
        return `table.size ${r.readU32()}`;
      case 17:
        return `table.fill ${r.readU32()}`;
      default:
        return name;
    }
  }
  const mnemonic = OPCODE_MAP[opcode];
  if (!mnemonic)
    throw new Error(`Opcode desconocido: 0x${opcode.toString(16)}`);
  switch (opcode) {
    case 2:
    case 3:
    case 4: {
      const bt = r.readByte();
      if (bt === 64)
        return mnemonic;
      if ([127, 126, 125, 124, 123, 112, 111].includes(bt))
        return `${mnemonic} (result ${valTypeToStr(bt)})`;
      r.position--;
      const typeIdx = r.readS32();
      return `${mnemonic} (type ${typeIdx})`;
    }
    case 12:
    case 13:
      return `${mnemonic} ${r.readU32()}`;
    case 14: {
      const count = r.readU32();
      const labels = [];
      for (let i = 0;i < count; i++)
        labels.push(r.readU32());
      const def = r.readU32();
      return `br_table ${labels.join(" ")} ${def}`;
    }
    case 16:
      return `call ${r.readU32()}`;
    case 17: {
      const typeIdx = r.readU32();
      r.readU32();
      return `call_indirect (type ${typeIdx})`;
    }
    case 20:
      return `call_ref ${r.readU32()}`;
    case 21:
      return `return_call_ref ${r.readU32()}`;
    case 28: {
      const n = r.readU32();
      const types = [];
      for (let i = 0;i < n; i++)
        types.push(valTypeToStr(r.readByte()));
      return `select (result ${types.join(" ")})`;
    }
    case 32:
    case 33:
    case 34:
    case 35:
    case 36:
    case 37:
    case 38:
      return `${mnemonic} ${r.readU32()}`;
    case 65:
      return `i32.const ${r.readS32()}`;
    case 66:
      return `i64.const ${r.readS64()}`;
    case 67: {
      const b = r.readBytes(4);
      const bits = new DataView(b.buffer, b.byteOffset, 4).getUint32(0, true);
      return `f32.const ${f32ToWat(bits)}`;
    }
    case 68: {
      const b = r.readBytes(8);
      const bits = new DataView(b.buffer, b.byteOffset, 8).getBigUint64(0, true);
      return `f64.const ${f64ToWat(bits)}`;
    }
    case 40:
    case 41:
    case 42:
    case 43:
    case 44:
    case 45:
    case 46:
    case 47:
    case 48:
    case 49:
    case 50:
    case 51:
    case 52:
    case 53:
    case 54:
    case 55:
    case 56:
    case 57:
    case 58:
    case 59:
    case 60:
    case 61:
    case 62: {
      const alignExp = r.readU32();
      const offset = r.readU32();
      return `${mnemonic} offset=${offset} align=${1 << alignExp}`;
    }
    case 63:
    case 64:
      r.readByte();
      return mnemonic;
    case 208:
      return `ref.null ${valTypeToStr(r.readByte())}`;
    case 209:
      return "ref.is_null";
    case 210:
      return `ref.func ${r.readU32()}`;
    default:
      return mnemonic;
  }
}
function parseLocals(r) {
  const count = r.readU32();
  const locals = [];
  for (let i = 0;i < count; i++) {
    const n = r.readU32();
    const type = r.readByte();
    for (let j = 0;j < n; j++)
      locals.push(`(local ${valTypeToStr(type)})`);
  }
  return locals;
}
function disassembleInstructions(r, endPos) {
  const instrs = [];
  let blockDepth = 0;
  while (r.position < endPos) {
    const opcode = r.readByte();
    if (opcode === 2 || opcode === 3 || opcode === 4) {
      blockDepth++;
      r.position--;
      instrs.push(disassembleInstruction(r));
    } else if (opcode === 5) {
      r.position--;
      instrs.push(disassembleInstruction(r));
    } else if (opcode === 11) {
      blockDepth--;
      if (blockDepth < 0)
        break;
      instrs.push("end");
    } else {
      r.position--;
      instrs.push(disassembleInstruction(r));
    }
  }
  return instrs;
}
function dataToWatString(bytes) {
  let str = "";
  for (const b of bytes) {
    switch (b) {
      case 9:
        str += "\\t";
        break;
      case 10:
        str += "\\n";
        break;
      case 13:
        str += "\\r";
        break;
      case 34:
        str += "\\\"";
        break;
      case 92:
        str += "\\\\";
        break;
      default:
        if (b >= 32 && b <= 126)
          str += String.fromCharCode(b);
        else
          str += "\\" + b.toString(16).padStart(2, "0");
    }
  }
  return str;
}
function readElementSegment(r, flag, index) {
  switch (flag) {
    case 0: {
      const offsetExpr = parseInitExpr(r);
      const n = r.readU32();
      const idx = [];
      for (let j = 0;j < n; j++)
        idx.push(r.readU32());
      return `(elem (${offsetExpr}) ${idx.join(" ")})`;
    }
    case 1: {
      const k = r.readByte();
      if (k !== 0)
        throw new Error(`elemkind inesperado: ${k}`);
      const n = r.readU32();
      const idx = [];
      for (let j = 0;j < n; j++)
        idx.push(r.readU32());
      return `(elem func ${idx.join(" ")})`;
    }
    case 2: {
      const t = r.readU32();
      const offsetExpr = parseInitExpr(r);
      const k = r.readByte();
      if (k !== 0)
        throw new Error(`elemkind inesperado: ${k}`);
      const n = r.readU32();
      const idx = [];
      for (let j = 0;j < n; j++)
        idx.push(r.readU32());
      return `(elem (table ${t}) (${offsetExpr}) func ${idx.join(" ")})`;
    }
    case 3: {
      const k = r.readByte();
      if (k !== 0)
        throw new Error(`elemkind inesperado: ${k}`);
      const n = r.readU32();
      const idx = [];
      for (let j = 0;j < n; j++)
        idx.push(r.readU32());
      return `(elem declare func ${idx.join(" ")})`;
    }
    case 4: {
      const offsetExpr = parseInitExpr(r);
      const n = r.readU32();
      const exprs = [];
      for (let j = 0;j < n; j++)
        exprs.push(`(${parseInitExpr(r)})`);
      return `(elem (${offsetExpr}) ${exprs.join(" ")})`;
    }
    case 5: {
      const rt = valTypeToStr(r.readByte());
      const n = r.readU32();
      const exprs = [];
      for (let j = 0;j < n; j++)
        exprs.push(`(${parseInitExpr(r)})`);
      return `(elem ${rt} ${exprs.join(" ")})`;
    }
    case 6: {
      const t = r.readU32();
      const offsetExpr = parseInitExpr(r);
      const rt = valTypeToStr(r.readByte());
      const n = r.readU32();
      const exprs = [];
      for (let j = 0;j < n; j++)
        exprs.push(`(${parseInitExpr(r)})`);
      return `(elem (table ${t}) (${offsetExpr}) ${rt} ${exprs.join(" ")})`;
    }
    case 7: {
      const rt = valTypeToStr(r.readByte());
      const n = r.readU32();
      const exprs = [];
      for (let j = 0;j < n; j++)
        exprs.push(`(${parseInitExpr(r)})`);
      return `(elem declare ${rt} ${exprs.join(" ")})`;
    }
    default:
      throw new Error(`Element flag ${flag} (index ${index}) desconocido.`);
  }
}
function decodeModuleToWat(buffer) {
  const r = new BinaryReader(buffer);
  r.readBytes(4);
  r.readBytes(4);
  const types = [];
  const imports = [];
  const funcTypeIndices = [];
  let memoryDef = null;
  let memoryIsImported = false;
  const globals = [];
  const exports = [];
  const tableDefs = [];
  const codeBodies = [];
  const dataSegments = [];
  const elemSegments = [];
  const customComments = [];
  let startLine = null;
  while (!r.eof()) {
    const id = r.readByte();
    const size = r.readU32();
    const endPos = r.position + size;
    switch (id) {
      case 0: {
        const secName = r.readName();
        const remaining = endPos - r.position;
        const data = Array.from(r.readBytes(remaining));
        if (secName === "name") {
          const nr = new BinaryReader(new Uint8Array(data));
          const parts = [];
          while (!nr.eof()) {
            const subId = nr.readByte();
            const subSize = nr.readU32();
            const subEnd = nr.position + subSize;
            if (subId === 0) {
              parts.push(`module="${nr.readName()}"`);
            } else if (subId === 1) {
              const n = nr.readU32();
              const entries = [];
              for (let i = 0;i < n; i++) {
                const idx = nr.readU32();
                entries.push(`${idx}="${nr.readName()}"`);
              }
              parts.push(`funcs=[${entries.join(",")}]`);
            } else if (subId === 2) {
              const n = nr.readU32();
              const entries = [];
              for (let i = 0;i < n; i++) {
                const fi = nr.readU32();
                const m = nr.readU32();
                const locals = [];
                for (let j = 0;j < m; j++) {
                  locals.push(`${nr.readU32()}="${nr.readName()}"`);
                }
                entries.push(`f${fi}:[${locals.join(",")}]`);
              }
              parts.push(`locals=[${entries.join(",")}]`);
            } else {
              nr.position = subEnd;
            }
            nr.position = subEnd;
          }
          customComments.push(`;; name section: ${parts.join(" ")}`);
        } else if (secName === "producers") {
          customComments.push(`;; producers section (${data.length} bytes)`);
        } else {
          customComments.push(`;; custom section "${secName}" (${data.length} bytes)`);
        }
        break;
      }
      case 1: {
        const count = r.readU32();
        for (let i = 0;i < count; i++) {
          const form = r.readByte();
          if (form !== 96) {
            throw new Error(`Functype form inesperado: 0x${form.toString(16)} (se esperaba 0x60)`);
          }
          const pc = r.readU32();
          const params = [];
          for (let j = 0;j < pc; j++)
            params.push(r.readByte());
          const rc = r.readU32();
          const results = [];
          for (let j = 0;j < rc; j++)
            results.push(r.readByte());
          types.push(formatFuncType(i, params, results));
        }
        break;
      }
      case 2: {
        const count = r.readU32();
        for (let i = 0;i < count; i++) {
          const mod = r.readName();
          const name = r.readName();
          const kind = r.readByte();
          if (kind === 0) {
            const typeIdx = r.readU32();
            imports.push(`(import "${mod}" "${name}" (func (type ${typeIdx})))`);
          } else if (kind === 1) {
            const rt = valTypeToStr(r.readByte());
            const flags = r.readByte();
            const initial = r.readU32();
            const maximum = flags & 1 ? r.readU32() : undefined;
            tableDefs.push(`(import "${mod}" "${name}" (table ${initial}${maximum !== undefined ? " " + maximum : ""} ${rt}))`);
          } else if (kind === 2) {
            memoryIsImported = true;
            const flags = r.readByte();
            const initial = r.readU32();
            const maximum = flags & 1 ? r.readU32() : undefined;
            memoryDef = `(import "${mod}" "${name}" (memory ${initial}${maximum !== undefined ? " " + maximum : ""}))`;
          } else if (kind === 3) {
            const type = r.readByte();
            const mut = r.readByte() === 1;
            imports.push(`(import "${mod}" "${name}" (global ${mut ? `(mut ${valTypeToStr(type)})` : valTypeToStr(type)}))`);
          }
        }
        break;
      }
      case 3: {
        const count = r.readU32();
        for (let i = 0;i < count; i++)
          funcTypeIndices.push(r.readU32());
        break;
      }
      case 4: {
        const count = r.readU32();
        for (let i = 0;i < count; i++) {
          const elemType = r.readByte();
          const flags = r.readByte();
          const initial = r.readU32();
          const maximum = flags & 1 ? r.readU32() : undefined;
          tableDefs.push(`(table ${initial}${maximum !== undefined ? " " + maximum : ""} ${valTypeToStr(elemType)})`);
        }
        break;
      }
      case 5: {
        r.readU32();
        const flags = r.readByte();
        const initial = r.readU32();
        const maximum = flags & 1 ? r.readU32() : undefined;
        memoryDef = `(memory ${initial}${maximum !== undefined ? " " + maximum : ""})`;
        break;
      }
      case 6: {
        const count = r.readU32();
        for (let i = 0;i < count; i++) {
          const type = r.readByte();
          const mut = r.readByte() === 1;
          const initExpr = parseInitExpr(r);
          globals.push(`(global (;${i};) ${mut ? `(mut ${valTypeToStr(type)})` : valTypeToStr(type)} ${initExpr})`);
        }
        break;
      }
      case 7: {
        const count = r.readU32();
        for (let i = 0;i < count; i++) {
          const name = r.readName();
          const kind = r.readByte();
          const index = r.readU32();
          const k = ["func", "table", "memory", "global"][kind] ?? "func";
          exports.push(`(export "${name}" (${k} ${index}))`);
        }
        break;
      }
      case 8: {
        const startIdx = r.readU32();
        startLine = `(start ${startIdx})`;
        break;
      }
      case 9: {
        const count = r.readU32();
        for (let i = 0;i < count; i++) {
          const flag = r.readU32();
          elemSegments.push(readElementSegment(r, flag, i));
        }
        break;
      }
      case 10: {
        const count = r.readU32();
        for (let i = 0;i < count; i++) {
          const bodySize = r.readU32();
          const bodyEnd = r.position + bodySize;
          const locals = parseLocals(r);
          const instructions = disassembleInstructions(r, bodyEnd);
          codeBodies.push({ locals, instructions });
          r.position = bodyEnd;
        }
        break;
      }
      case 11: {
        const count = r.readU32();
        for (let i = 0;i < count; i++) {
          const mode = r.readU32();
          if (mode === 0) {
            const offsetExpr = parseInitExpr(r);
            const dataSize = r.readU32();
            const data = Array.from(r.readBytes(dataSize));
            dataSegments.push(`(data (${offsetExpr}) "${dataToWatString(data)}")`);
          } else if (mode === 1) {
            const dataSize = r.readU32();
            const data = Array.from(r.readBytes(dataSize));
            dataSegments.push(`(data "${dataToWatString(data)}")`);
          } else if (mode === 2) {
            const memIdx = r.readU32();
            const offsetExpr = parseInitExpr(r);
            const dataSize = r.readU32();
            const data = Array.from(r.readBytes(dataSize));
            dataSegments.push(`(data (memory ${memIdx}) (${offsetExpr}) "${dataToWatString(data)}")`);
          } else {
            throw new Error(`Data segment con modo ${mode} no soportado`);
          }
        }
        break;
      }
      default:
        r.position = endPos;
    }
    r.position = endPos;
  }
  const lines = [];
  for (const c of customComments)
    lines.push(c);
  lines.push("(module");
  const ind = "  ";
  for (const t of types)
    lines.push(ind + t);
  for (const imp of imports)
    lines.push(ind + imp);
  if (memoryDef && !memoryIsImported)
    lines.push(ind + memoryDef);
  for (const td of tableDefs)
    lines.push(ind + td);
  if (startLine)
    lines.push(ind + startLine);
  for (const es of elemSegments)
    lines.push(ind + es);
  for (const g of globals)
    lines.push(ind + g);
  for (const e of exports)
    lines.push(ind + e);
  for (const ds of dataSegments)
    lines.push(ind + ds);
  const importFuncCount = imports.filter((imp) => imp.includes("(func")).length;
  for (let i = 0;i < funcTypeIndices.length; i++) {
    const body = codeBodies[i];
    lines.push(ind + `(func (;${importFuncCount + i};) (type ${funcTypeIndices[i]})`);
    for (const local of body.locals)
      lines.push(ind + ind + local);
    for (const instr of body.instructions)
      lines.push(ind + ind + instr);
    lines.push(ind + ")");
  }
  lines.push(")");
  return lines.join(`
`);
}
function parseBinaryTree(buffer) {
  const r = new BinaryReader(buffer);
  r.readBytes(4);
  r.readBytes(4);
  const moduleNode = { type: "module", name: "Module", children: [] };
  while (!r.eof()) {
    const id = r.readByte();
    const size = r.readU32();
    const endPos = r.position + size;
    switch (id) {
      case 0: {
        const secName = r.readName();
        const remaining = endPos - r.position;
        r.readBytes(remaining);
        moduleNode.children.push({ type: "custom", name: `Custom "${secName}" (${remaining} bytes)`, children: [] });
        break;
      }
      case 1: {
        const count = r.readU32();
        const node = { type: "section", name: "Type Section", children: [] };
        for (let i = 0;i < count; i++) {
          const form = r.readByte();
          if (form !== 96)
            throw new Error(`Functype form inesperado: 0x${form.toString(16)}`);
          const pc = r.readU32();
          const params = [];
          for (let j = 0;j < pc; j++)
            params.push(r.readByte());
          const rc = r.readU32();
          const results = [];
          for (let j = 0;j < rc; j++)
            results.push(r.readByte());
          node.children.push({ type: "type", name: `Type ${i}: func (${params.map(valTypeToStr).join(" ")}) -> (${results.map(valTypeToStr).join(" ")})` });
        }
        moduleNode.children.push(node);
        break;
      }
      case 2: {
        const count = r.readU32();
        const node = { type: "section", name: "Import Section", children: [] };
        for (let i = 0;i < count; i++) {
          const mod = r.readName();
          const name = r.readName();
          const kind = r.readByte();
          let desc = "";
          if (kind === 0)
            desc = `func type ${r.readU32()}`;
          else if (kind === 1) {
            const rt = valTypeToStr(r.readByte());
            const flags = r.readByte();
            const initial = r.readU32();
            const maximum = flags & 1 ? r.readU32() : undefined;
            desc = `table min=${initial}` + (maximum !== undefined ? ` max=${maximum}` : "") + ` ${rt}`;
          } else if (kind === 2) {
            const flags = r.readByte();
            const initial = r.readU32();
            const maximum = flags & 1 ? r.readU32() : undefined;
            desc = `memory min=${initial}` + (maximum !== undefined ? ` max=${maximum}` : "");
          } else if (kind === 3) {
            const type = r.readByte();
            const mut = r.readByte() === 1;
            desc = `global ${valTypeToStr(type)}${mut ? " mutable" : ""}`;
          }
          node.children.push({ type: "import", name: `"${mod}" "${name}" (${desc})` });
        }
        moduleNode.children.push(node);
        break;
      }
      case 3: {
        const count = r.readU32();
        const node = { type: "section", name: "Function Section", children: [] };
        for (let i = 0;i < count; i++) {
          node.children.push({ type: "func", name: `Function ${i}: type ${r.readU32()}` });
        }
        moduleNode.children.push(node);
        break;
      }
      case 4: {
        const count = r.readU32();
        const node = { type: "section", name: "Table Section", children: [] };
        for (let i = 0;i < count; i++) {
          const elemType = r.readByte();
          const flags = r.readByte();
          const initial = r.readU32();
          const maximum = flags & 1 ? r.readU32() : undefined;
          node.children.push({ type: "table", name: `Table ${i}: min=${initial}` + (maximum !== undefined ? ` max=${maximum}` : "") + ` ${valTypeToStr(elemType)}` });
        }
        moduleNode.children.push(node);
        break;
      }
      case 5: {
        const count = r.readU32();
        const node = { type: "section", name: "Memory Section", children: [] };
        for (let i = 0;i < count; i++) {
          const flags = r.readByte();
          const initial = r.readU32();
          const maximum = flags & 1 ? r.readU32() : undefined;
          node.children.push({ type: "memory", name: `Memory ${i}: min=${initial}` + (maximum !== undefined ? ` max=${maximum}` : "") });
        }
        moduleNode.children.push(node);
        break;
      }
      case 6: {
        const count = r.readU32();
        const node = { type: "section", name: "Global Section", children: [] };
        for (let i = 0;i < count; i++) {
          const type = r.readByte();
          const mut = r.readByte() === 1;
          const initExpr = parseInitExpr(r);
          node.children.push({ type: "global", name: `Global ${i}: ${valTypeToStr(type)}${mut ? " mutable" : ""} = ${initExpr}` });
        }
        moduleNode.children.push(node);
        break;
      }
      case 7: {
        const count = r.readU32();
        const node = { type: "section", name: "Export Section", children: [] };
        for (let i = 0;i < count; i++) {
          const name = r.readName();
          const kind = r.readByte();
          const index = r.readU32();
          const k = ["func", "table", "memory", "global"][kind] ?? "?";
          node.children.push({ type: "export", name: `"${name}" (${k} ${index})` });
        }
        moduleNode.children.push(node);
        break;
      }
      case 8: {
        const startIdx = r.readU32();
        moduleNode.children.push({ type: "section", name: "Start Section", children: [{ type: "start", name: `start func ${startIdx}` }] });
        break;
      }
      case 9: {
        const count = r.readU32();
        const node = { type: "section", name: "Element Section", children: [] };
        for (let i = 0;i < count; i++) {
          const flag = r.readU32();
          node.children.push({ type: "element", name: readElementSegment(r, flag, i) });
        }
        moduleNode.children.push(node);
        break;
      }
      case 10: {
        const count = r.readU32();
        const node = { type: "section", name: "Code Section", children: [] };
        for (let i = 0;i < count; i++) {
          const bodySize = r.readU32();
          const bodyEnd = r.position + bodySize;
          const localCount = r.readU32();
          const locals = [];
          for (let j = 0;j < localCount; j++) {
            const n = r.readU32();
            const type = r.readByte();
            locals.push(`${n} x ${valTypeToStr(type)}`);
          }
          const funcNode = { type: "function", name: `Function ${i}`, children: [] };
          if (locals.length > 0)
            funcNode.children.push({ type: "locals", name: `Locals: ${locals.join(", ")}` });
          const instructions = disassembleInstructions(r, bodyEnd);
          if (instructions.length > 0) {
            const instrNode = { type: "instructions", name: "Instructions", children: [] };
            for (const instr of instructions)
              instrNode.children.push({ type: "instr", name: instr });
            funcNode.children.push(instrNode);
          }
          r.position = bodyEnd;
          node.children.push(funcNode);
        }
        moduleNode.children.push(node);
        break;
      }
      case 11: {
        const count = r.readU32();
        const node = { type: "section", name: "Data Section", children: [] };
        for (let i = 0;i < count; i++) {
          const mode = r.readU32();
          if (mode === 0) {
            const offsetExpr = parseInitExpr(r);
            const dataSize = r.readU32();
            const data = Array.from(r.readBytes(dataSize));
            node.children.push({ type: "data", name: `offset=${offsetExpr}, "${dataToWatString(data)}"` });
          } else if (mode === 1) {
            const dataSize = r.readU32();
            const data = Array.from(r.readBytes(dataSize));
            node.children.push({ type: "data", name: `"${dataToWatString(data)}"` });
          } else if (mode === 2) {
            const memIdx = r.readU32();
            const offsetExpr = parseInitExpr(r);
            const dataSize = r.readU32();
            const data = Array.from(r.readBytes(dataSize));
            node.children.push({ type: "data", name: `memory=${memIdx} offset=${offsetExpr}, "${dataToWatString(data)}"` });
          } else {
            r.position = endPos;
          }
        }
        moduleNode.children.push(node);
        break;
      }
      default: {
        r.position = endPos;
        moduleNode.children.push({ type: "section", name: `Unknown Section (id: ${id})`, children: [] });
      }
    }
    r.position = endPos;
  }
  return moduleNode;
}
function formatBinaryTree(node, prefix = "", isLast = true) {
  const connector = isLast ? "└── " : "├── ";
  let result = prefix + connector + node.name + `
`;
  if (node.children && node.children.length > 0) {
    const newPrefix = prefix + (isLast ? "    " : "│   ");
    node.children.forEach((child, index) => {
      result += formatBinaryTree(child, newPrefix, index === node.children.length - 1);
    });
  }
  return result;
}
function naturalAlign(op) {
  switch (op) {
    case "I32_LOAD":
    case "I32_STORE":
    case "F32_LOAD":
    case "F32_STORE":
    case "I64_LOAD32_S":
    case "I64_LOAD32_U":
    case "I64_STORE32":
      return 2;
    case "I64_LOAD":
    case "I64_STORE":
    case "F64_LOAD":
    case "F64_STORE":
      return 3;
    case "I32_LOAD16_S":
    case "I32_LOAD16_U":
    case "I32_STORE16":
    case "I64_LOAD16_S":
    case "I64_LOAD16_U":
    case "I64_STORE16":
      return 1;
    default:
      return 0;
  }
}
function emitirBytecode(ir) {
  const bytes = [];
  for (const instr of ir) {
    switch (instr.op) {
      case "UNREACHABLE":
        bytes.push(OP.UNREACHABLE);
        break;
      case "NOP":
        bytes.push(OP.NOP);
        break;
      case "BLOCK":
      case "LOOP":
      case "IF": {
        const op = instr.op === "BLOCK" ? OP.BLOCK : instr.op === "LOOP" ? OP.LOOP : OP.IF;
        bytes.push(op);
        const bt = instr.blocktype;
        if (bt === 64 || bt === 127 || bt === 126 || bt === 125 || bt === 124 || bt === 123 || bt === 112 || bt === 111) {
          bytes.push(bt);
        } else {
          bytes.push(...encodeSignedLEB128(bt));
        }
        break;
      }
      case "ELSE":
        bytes.push(OP.ELSE);
        break;
      case "END":
        bytes.push(OP.END);
        break;
      case "BR":
        bytes.push(OP.BR, ...encodeLEB128(instr.depth));
        break;
      case "BR_IF":
        bytes.push(OP.BR_IF, ...encodeLEB128(instr.depth));
        break;
      case "BR_TABLE":
        bytes.push(OP.BR_TABLE);
        bytes.push(...encodeLEB128(instr.labels.length));
        for (const label of instr.labels)
          bytes.push(...encodeLEB128(label));
        bytes.push(...encodeLEB128(instr.default));
        break;
      case "RETURN":
        bytes.push(OP.RETURN);
        break;
      case "CALL":
        bytes.push(OP.CALL, ...encodeLEB128(instr.index));
        break;
      case "CALL_INDIRECT":
        bytes.push(OP.CALL_INDIRECT, ...encodeLEB128(instr.typeIdx), 0);
        break;
      case "CALL_REF":
        bytes.push(OP.CALL_REF, ...encodeLEB128(instr.typeIdx));
        break;
      case "RETURN_CALL_REF":
        bytes.push(OP.RETURN_CALL_REF, ...encodeLEB128(instr.typeIdx));
        break;
      case "DROP":
        bytes.push(OP.DROP);
        break;
      case "SELECT":
        bytes.push(OP.SELECT);
        break;
      case "SELECT_T": {
        bytes.push(OP.SELECT_T, ...encodeLEB128(instr.types.length));
        for (const t of instr.types)
          bytes.push(typeToOp(t));
        break;
      }
      case "LOCAL_GET":
        bytes.push(OP.LOCAL_GET, ...encodeLEB128(instr.index));
        break;
      case "LOCAL_SET":
        bytes.push(OP.LOCAL_SET, ...encodeLEB128(instr.index));
        break;
      case "LOCAL_TEE":
        bytes.push(OP.LOCAL_TEE, ...encodeLEB128(instr.index));
        break;
      case "GLOBAL_GET":
        bytes.push(OP.GLOBAL_GET, ...encodeLEB128(instr.index));
        break;
      case "GLOBAL_SET":
        bytes.push(OP.GLOBAL_SET, ...encodeLEB128(instr.index));
        break;
      case "TABLE_GET":
        bytes.push(OP.TABLE_GET, ...encodeLEB128(instr.tableIdx ?? 0));
        break;
      case "TABLE_SET":
        bytes.push(OP.TABLE_SET, ...encodeLEB128(instr.tableIdx ?? 0));
        break;
      case "TABLE_GROW":
        bytes.push(OP.MISC_PREFIX, OP.TABLE_GROW, ...encodeLEB128(instr.tableIdx ?? 0));
        break;
      case "TABLE_SIZE":
        bytes.push(OP.MISC_PREFIX, OP.TABLE_SIZE, ...encodeLEB128(instr.tableIdx ?? 0));
        break;
      case "TABLE_FILL":
        bytes.push(OP.MISC_PREFIX, OP.TABLE_FILL, ...encodeLEB128(instr.tableIdx ?? 0));
        break;
      case "TABLE_COPY":
        bytes.push(OP.MISC_PREFIX, OP.TABLE_COPY, ...encodeLEB128(instr.dstIdx), ...encodeLEB128(instr.srcIdx));
        break;
      case "TABLE_INIT":
        bytes.push(OP.MISC_PREFIX, OP.TABLE_INIT, ...encodeLEB128(instr.tableIdx), ...encodeLEB128(instr.elemIdx));
        break;
      case "ELEM_DROP":
        bytes.push(OP.MISC_PREFIX, OP.ELEM_DROP, ...encodeLEB128(instr.elemIdx));
        break;
      case "MEMORY_INIT":
        bytes.push(OP.MISC_PREFIX, OP.MEMORY_INIT, ...encodeLEB128(instr.dataIdx), 0);
        break;
      case "DATA_DROP":
        bytes.push(OP.MISC_PREFIX, OP.DATA_DROP, ...encodeLEB128(instr.dataIdx));
        break;
      case "MEMORY_FILL":
        bytes.push(OP.MISC_PREFIX, OP.MEMORY_FILL, 0);
        break;
      case "MEMORY_COPY":
        bytes.push(OP.MISC_PREFIX, OP.MEMORY_COPY, 0, 0);
        break;
      case "SIMD_NOIMM": {
        const sub = SIMD_NOIMM[instr.name];
        if (sub === undefined)
          throw new Error(`SIMD_NOIMM desconocido: ${instr.name}`);
        bytes.push(OP.SIMD_PREFIX, ...encodeLEB128(sub));
        break;
      }
      case "SIMD_MEMARG": {
        const sub = SIMD_MEMARG[instr.name];
        if (sub === undefined)
          throw new Error(`SIMD_MEMARG desconocido: ${instr.name}`);
        const align = instr.align !== undefined && instr.align !== 0 ? instr.align : simdNaturalAlign(instr.name);
        bytes.push(OP.SIMD_PREFIX, ...encodeLEB128(sub), ...encodeLEB128(align), ...encodeLEB128(instr.offset ?? 0));
        break;
      }
      case "SIMD_MEMARG_LANE": {
        const sub = SIMD_MEMARG_LANE[instr.name];
        if (sub === undefined)
          throw new Error(`SIMD_MEMARG_LANE desconocido: ${instr.name}`);
        const align = instr.align !== undefined && instr.align !== 0 ? instr.align : simdNaturalAlignLane(instr.name);
        bytes.push(OP.SIMD_PREFIX, ...encodeLEB128(sub), ...encodeLEB128(align), ...encodeLEB128(instr.offset ?? 0), instr.lane);
        break;
      }
      case "SIMD_LANE": {
        const sub = SIMD_LANE[instr.name];
        if (sub === undefined)
          throw new Error(`SIMD_LANE desconocido: ${instr.name}`);
        bytes.push(OP.SIMD_PREFIX, ...encodeLEB128(sub), instr.lane);
        break;
      }
      case "SIMD_CONST":
        bytes.push(OP.SIMD_PREFIX, ...encodeLEB128(SIMD_CONST_SUBOP), ...instr.bytes);
        break;
      case "SIMD_SHUFFLE":
        bytes.push(OP.SIMD_PREFIX, ...encodeLEB128(SIMD_SHUFFLE_SUBOP), ...instr.lanes);
        break;
      case "I32_LOAD":
      case "I64_LOAD":
      case "F32_LOAD":
      case "F64_LOAD":
      case "I32_LOAD8_S":
      case "I32_LOAD8_U":
      case "I32_LOAD16_S":
      case "I32_LOAD16_U":
      case "I64_LOAD8_S":
      case "I64_LOAD8_U":
      case "I64_LOAD16_S":
      case "I64_LOAD16_U":
      case "I64_LOAD32_S":
      case "I64_LOAD32_U":
      case "I32_STORE":
      case "I64_STORE":
      case "F32_STORE":
      case "F64_STORE":
      case "I32_STORE8":
      case "I32_STORE16":
      case "I64_STORE8":
      case "I64_STORE16":
      case "I64_STORE32": {
        const opName = instr.op;
        const opcode = OP[opName];
        const align = instr.align !== undefined && instr.align !== 0 ? instr.align : naturalAlign(opName);
        bytes.push(opcode, ...encodeLEB128(align), ...encodeLEB128(instr.offset ?? 0));
        break;
      }
      case "MEMORY_SIZE":
        bytes.push(OP.MEMORY_SIZE, 0);
        break;
      case "MEMORY_GROW":
        bytes.push(OP.MEMORY_GROW, 0);
        break;
      case "FUNCTION_INDEX_BY_NAME":
        throw new Error("FUNCTION_INDEX_BY_NAME debe ser resuelto antes de emitir bytecode");
      case "ENV_ADDR_BY_NAME":
        throw new Error("ENV_ADDR_BY_NAME debe ser resuelto antes de emitir bytecode");
      case "I32_CONST":
        bytes.push(OP.I32_CONST, ...encodeSignedLEB128(toI32(instr.val)));
        break;
      case "I64_CONST":
        bytes.push(OP.I64_CONST, ...encodeSignedLEB128(toI64(instr.val)));
        break;
      case "F32_CONST":
        bytes.push(OP.F32_CONST, ...floatToBytes(instr.val, 32));
        break;
      case "F64_CONST":
        bytes.push(OP.F64_CONST, ...floatToBytes(instr.val, 64));
        break;
      case "I32_DATA_CONST":
        bytes.push(OP.I32_CONST, ...encodeSignedLEB128(toI32(instr.val)));
        break;
      case "I32_CLZ":
        bytes.push(OP.I32_CLZ);
        break;
      case "I32_CTZ":
        bytes.push(OP.I32_CTZ);
        break;
      case "I32_POPCNT":
        bytes.push(OP.I32_POPCNT);
        break;
      case "I64_CLZ":
        bytes.push(OP.I64_CLZ);
        break;
      case "I64_CTZ":
        bytes.push(OP.I64_CTZ);
        break;
      case "I64_POPCNT":
        bytes.push(OP.I64_POPCNT);
        break;
      case "I32_ROTL":
        bytes.push(OP.I32_ROTL);
        break;
      case "I32_ROTR":
        bytes.push(OP.I32_ROTR);
        break;
      case "I64_ROTL":
        bytes.push(OP.I64_ROTL);
        break;
      case "I64_ROTR":
        bytes.push(OP.I64_ROTR);
        break;
      case "I32_EQZ":
        bytes.push(OP.I32_EQZ);
        break;
      case "I64_EQZ":
        bytes.push(OP.I64_EQZ);
        break;
      case "I32_EQ":
        bytes.push(OP.I32_EQ);
        break;
      case "I32_NE":
        bytes.push(OP.I32_NE);
        break;
      case "I32_LT_S":
        bytes.push(OP.I32_LT_S);
        break;
      case "I32_LT_U":
        bytes.push(OP.I32_LT_U);
        break;
      case "I32_GT_S":
        bytes.push(OP.I32_GT_S);
        break;
      case "I32_GT_U":
        bytes.push(OP.I32_GT_U);
        break;
      case "I32_LE_S":
        bytes.push(OP.I32_LE_S);
        break;
      case "I32_LE_U":
        bytes.push(OP.I32_LE_U);
        break;
      case "I32_GE_S":
        bytes.push(OP.I32_GE_S);
        break;
      case "I32_GE_U":
        bytes.push(OP.I32_GE_U);
        break;
      case "I32_ADD":
        bytes.push(OP.I32_ADD);
        break;
      case "I32_SUB":
        bytes.push(OP.I32_SUB);
        break;
      case "I32_MUL":
        bytes.push(OP.I32_MUL);
        break;
      case "I32_DIV_S":
        bytes.push(OP.I32_DIV_S);
        break;
      case "I32_DIV_U":
        bytes.push(OP.I32_DIV_U);
        break;
      case "I32_REM_S":
        bytes.push(OP.I32_REM_S);
        break;
      case "I32_REM_U":
        bytes.push(OP.I32_REM_U);
        break;
      case "I32_AND":
        bytes.push(OP.I32_AND);
        break;
      case "I32_OR":
        bytes.push(OP.I32_OR);
        break;
      case "I32_XOR":
        bytes.push(OP.I32_XOR);
        break;
      case "I32_SHL":
        bytes.push(OP.I32_SHL);
        break;
      case "I32_SHR_S":
        bytes.push(OP.I32_SHR_S);
        break;
      case "I32_SHR_U":
        bytes.push(OP.I32_SHR_U);
        break;
      case "I64_EQ":
        bytes.push(OP.I64_EQ);
        break;
      case "I64_NE":
        bytes.push(OP.I64_NE);
        break;
      case "I64_LT_S":
        bytes.push(OP.I64_LT_S);
        break;
      case "I64_LT_U":
        bytes.push(OP.I64_LT_U);
        break;
      case "I64_GT_S":
        bytes.push(OP.I64_GT_S);
        break;
      case "I64_GT_U":
        bytes.push(OP.I64_GT_U);
        break;
      case "I64_LE_S":
        bytes.push(OP.I64_LE_S);
        break;
      case "I64_LE_U":
        bytes.push(OP.I64_LE_U);
        break;
      case "I64_GE_S":
        bytes.push(OP.I64_GE_S);
        break;
      case "I64_GE_U":
        bytes.push(OP.I64_GE_U);
        break;
      case "I64_ADD":
        bytes.push(OP.I64_ADD);
        break;
      case "I64_SUB":
        bytes.push(OP.I64_SUB);
        break;
      case "I64_MUL":
        bytes.push(OP.I64_MUL);
        break;
      case "I64_DIV_S":
        bytes.push(OP.I64_DIV_S);
        break;
      case "I64_DIV_U":
        bytes.push(OP.I64_DIV_U);
        break;
      case "I64_REM_S":
        bytes.push(OP.I64_REM_S);
        break;
      case "I64_REM_U":
        bytes.push(OP.I64_REM_U);
        break;
      case "I64_AND":
        bytes.push(OP.I64_AND);
        break;
      case "I64_OR":
        bytes.push(OP.I64_OR);
        break;
      case "I64_XOR":
        bytes.push(OP.I64_XOR);
        break;
      case "I64_SHL":
        bytes.push(OP.I64_SHL);
        break;
      case "I64_SHR_S":
        bytes.push(OP.I64_SHR_S);
        break;
      case "I64_SHR_U":
        bytes.push(OP.I64_SHR_U);
        break;
      case "F32_ABS":
        bytes.push(OP.F32_ABS);
        break;
      case "F32_NEG":
        bytes.push(OP.F32_NEG);
        break;
      case "F32_CEIL":
        bytes.push(OP.F32_CEIL);
        break;
      case "F32_FLOOR":
        bytes.push(OP.F32_FLOOR);
        break;
      case "F32_TRUNC":
        bytes.push(OP.F32_TRUNC);
        break;
      case "F32_NEAREST":
        bytes.push(OP.F32_NEAREST);
        break;
      case "F32_SQRT":
        bytes.push(OP.F32_SQRT);
        break;
      case "F32_ADD":
        bytes.push(OP.F32_ADD);
        break;
      case "F32_SUB":
        bytes.push(OP.F32_SUB);
        break;
      case "F32_MUL":
        bytes.push(OP.F32_MUL);
        break;
      case "F32_DIV":
        bytes.push(OP.F32_DIV);
        break;
      case "F32_MIN":
        bytes.push(OP.F32_MIN);
        break;
      case "F32_MAX":
        bytes.push(OP.F32_MAX);
        break;
      case "F32_COPYSIGN":
        bytes.push(OP.F32_COPYSIGN);
        break;
      case "F32_EQ":
        bytes.push(OP.F32_EQ);
        break;
      case "F32_NE":
        bytes.push(OP.F32_NE);
        break;
      case "F32_LT":
        bytes.push(OP.F32_LT);
        break;
      case "F32_GT":
        bytes.push(OP.F32_GT);
        break;
      case "F32_LE":
        bytes.push(OP.F32_LE);
        break;
      case "F32_GE":
        bytes.push(OP.F32_GE);
        break;
      case "F64_ABS":
        bytes.push(OP.F64_ABS);
        break;
      case "F64_NEG":
        bytes.push(OP.F64_NEG);
        break;
      case "F64_CEIL":
        bytes.push(OP.F64_CEIL);
        break;
      case "F64_FLOOR":
        bytes.push(OP.F64_FLOOR);
        break;
      case "F64_TRUNC":
        bytes.push(OP.F64_TRUNC);
        break;
      case "F64_NEAREST":
        bytes.push(OP.F64_NEAREST);
        break;
      case "F64_SQRT":
        bytes.push(OP.F64_SQRT);
        break;
      case "F64_ADD":
        bytes.push(OP.F64_ADD);
        break;
      case "F64_SUB":
        bytes.push(OP.F64_SUB);
        break;
      case "F64_MUL":
        bytes.push(OP.F64_MUL);
        break;
      case "F64_DIV":
        bytes.push(OP.F64_DIV);
        break;
      case "F64_MIN":
        bytes.push(OP.F64_MIN);
        break;
      case "F64_MAX":
        bytes.push(OP.F64_MAX);
        break;
      case "F64_COPYSIGN":
        bytes.push(OP.F64_COPYSIGN);
        break;
      case "F64_EQ":
        bytes.push(OP.F64_EQ);
        break;
      case "F64_NE":
        bytes.push(OP.F64_NE);
        break;
      case "F64_LT":
        bytes.push(OP.F64_LT);
        break;
      case "F64_GT":
        bytes.push(OP.F64_GT);
        break;
      case "F64_LE":
        bytes.push(OP.F64_LE);
        break;
      case "F64_GE":
        bytes.push(OP.F64_GE);
        break;
      case "I32_WRAP_I64":
        bytes.push(OP.I32_WRAP_I64);
        break;
      case "I32_TRUNC_F32_S":
        bytes.push(OP.I32_TRUNC_F32_S);
        break;
      case "I32_TRUNC_F32_U":
        bytes.push(OP.I32_TRUNC_F32_U);
        break;
      case "I32_TRUNC_F64_S":
        bytes.push(OP.I32_TRUNC_F64_S);
        break;
      case "I32_TRUNC_F64_U":
        bytes.push(OP.I32_TRUNC_F64_U);
        break;
      case "I64_TRUNC_F32_S":
        bytes.push(OP.I64_TRUNC_F32_S);
        break;
      case "I64_TRUNC_F32_U":
        bytes.push(OP.I64_TRUNC_F32_U);
        break;
      case "I64_TRUNC_F64_S":
        bytes.push(OP.I64_TRUNC_F64_S);
        break;
      case "I64_TRUNC_F64_U":
        bytes.push(OP.I64_TRUNC_F64_U);
        break;
      case "F32_CONVERT_I32_S":
        bytes.push(OP.F32_CONVERT_I32_S);
        break;
      case "F32_CONVERT_I32_U":
        bytes.push(OP.F32_CONVERT_I32_U);
        break;
      case "F32_CONVERT_I64_S":
        bytes.push(OP.F32_CONVERT_I64_S);
        break;
      case "F32_CONVERT_I64_U":
        bytes.push(OP.F32_CONVERT_I64_U);
        break;
      case "F64_CONVERT_I32_S":
        bytes.push(OP.F64_CONVERT_I32_S);
        break;
      case "F64_CONVERT_I32_U":
        bytes.push(OP.F64_CONVERT_I32_U);
        break;
      case "F64_CONVERT_I64_S":
        bytes.push(OP.F64_CONVERT_I64_S);
        break;
      case "F64_CONVERT_I64_U":
        bytes.push(OP.F64_CONVERT_I64_U);
        break;
      case "F32_DEMOTE_F64":
        bytes.push(OP.F32_DEMOTE_F64);
        break;
      case "F64_PROMOTE_F32":
        bytes.push(OP.F64_PROMOTE_F32);
        break;
      case "I32_REINTERPRET_F32":
        bytes.push(OP.I32_REINTERPRET_F32);
        break;
      case "I64_REINTERPRET_F64":
        bytes.push(OP.I64_REINTERPRET_F64);
        break;
      case "F32_REINTERPRET_I32":
        bytes.push(OP.F32_REINTERPRET_I32);
        break;
      case "F64_REINTERPRET_I64":
        bytes.push(OP.F64_REINTERPRET_I64);
        break;
      case "I64_EXTEND_I32_S":
        bytes.push(OP.I64_EXTEND_I32_S);
        break;
      case "I64_EXTEND_I32_U":
        bytes.push(OP.I64_EXTEND_I32_U);
        break;
      case "I32_TRUNC_SAT_F32_S":
        bytes.push(OP.MISC_PREFIX, OP.SAT_I32_TRUNC_SAT_F32_S);
        break;
      case "I32_TRUNC_SAT_F32_U":
        bytes.push(OP.MISC_PREFIX, OP.SAT_I32_TRUNC_SAT_F32_U);
        break;
      case "I32_TRUNC_SAT_F64_S":
        bytes.push(OP.MISC_PREFIX, OP.SAT_I32_TRUNC_SAT_F64_S);
        break;
      case "I32_TRUNC_SAT_F64_U":
        bytes.push(OP.MISC_PREFIX, OP.SAT_I32_TRUNC_SAT_F64_U);
        break;
      case "I64_TRUNC_SAT_F32_S":
        bytes.push(OP.MISC_PREFIX, OP.SAT_I64_TRUNC_SAT_F32_S);
        break;
      case "I64_TRUNC_SAT_F32_U":
        bytes.push(OP.MISC_PREFIX, OP.SAT_I64_TRUNC_SAT_F32_U);
        break;
      case "I64_TRUNC_SAT_F64_S":
        bytes.push(OP.MISC_PREFIX, OP.SAT_I64_TRUNC_SAT_F64_S);
        break;
      case "I64_TRUNC_SAT_F64_U":
        bytes.push(OP.MISC_PREFIX, OP.SAT_I64_TRUNC_SAT_F64_U);
        break;
      case "REF_NULL":
        bytes.push(OP.REF_NULL, refTypeToOp(instr.type));
        break;
      case "REF_IS_NULL":
        bytes.push(OP.REF_IS_NULL);
        break;
      case "REF_FUNC":
        bytes.push(OP.REF_FUNC, ...encodeLEB128(instr.index));
        break;
      case "CALL_BY_NAME":
      case "REF_FUNC_BY_NAME":
        throw new Error(`${instr.op} debe ser resuelto antes de emitir bytecode`);
      default:
        throw new Error(`Opcode IR desconocido: ${instr.op}`);
    }
  }
  return bytes;
}

// src/dce.ts
function eliminateDeadFunctions(module) {
  const roots = new Set;
  roots.add("_start");
  for (const exp of module.externals) {
    if (exp.section === "export" && exp.kind === "function") {
      if (typeof exp.index === "string")
        roots.add(exp.index);
    }
  }
  for (const name of module.functionTableIndices.keys())
    roots.add(name);
  for (const seg of module.pendingElements) {
    if (seg.funcNames)
      for (const n of seg.funcNames)
        roots.add(n);
  }
  const reachable = new Set;
  const liveCallNames = new Set;
  const fnByName = new Map(module.functions.map((f) => [f.name, f]));
  const worklist = [...roots];
  while (worklist.length > 0) {
    const name = worklist.pop();
    if (reachable.has(name))
      continue;
    reachable.add(name);
    liveCallNames.add(name);
    const fn = fnByName.get(name);
    if (!fn)
      continue;
    const builder = fn.builder;
    for (const instr of builder.instructions) {
      if (instr.op === "CALL_BY_NAME" && instr.name)
        worklist.push(instr.name);
      if (instr.op === "REF_FUNC_BY_NAME" && instr.name)
        worklist.push(instr.name);
      if (instr.op === "FUNCTION_INDEX_BY_NAME" && instr.name)
        worklist.push(instr.name);
    }
  }
  const before = module.functions.length;
  module.functions = module.functions.filter((f) => reachable.has(f.name));
  const removed = before - module.functions.length;
  if (removed > 0) {}
  return liveCallNames;
}
function eliminateDeadImports(module, liveCallNames) {
  const keepIdx = new Set;
  for (let i = 0;i < module.externals.length; i++) {
    const e = module.externals[i];
    if (e.section === "export") {
      keepIdx.add(i);
      continue;
    }
    if (e.section !== "import")
      continue;
    if (e.kind !== "function") {
      keepIdx.add(i);
      continue;
    }
    for (const [alias, extIdx] of module.funcAliasToIndex) {
      if (extIdx === i && liveCallNames.has(alias)) {
        keepIdx.add(i);
        break;
      }
    }
  }
  const remap = new Map;
  const newExternals = [];
  for (let i = 0;i < module.externals.length; i++) {
    if (keepIdx.has(i)) {
      remap.set(i, newExternals.length);
      newExternals.push(module.externals[i]);
    }
  }
  module.externals = newExternals;
  const newAlias = new Map;
  for (const [alias, oldIdx] of module.funcAliasToIndex) {
    const newIdx = remap.get(oldIdx);
    if (newIdx !== undefined)
      newAlias.set(alias, newIdx);
  }
  module.funcAliasToIndex = newAlias;
}
function eliminateDeadStrings(module) {
  const pool = module.getStringPoolOrNull();
  if (!pool)
    return;
  const usedOffsets = new Set;
  for (const fn of module.functions) {
    for (const instr of fn.builder.instructions) {
      if (instr.op === "I32_DATA_CONST") {
        usedOffsets.add(instr.val);
      }
    }
  }
  const entries = pool.getAllEntries();
  const kept = entries.filter((e) => usedOffsets.has(e.userOffset));
  if (kept.length === entries.length)
    return;
  const oldToNew = new Map;
  pool.reset();
  for (const e of kept) {
    const ref = pool.add(e.text);
    oldToNew.set(e.userOffset, ref.offset);
  }
  for (const fn of module.functions) {
    for (const instr of fn.builder.instructions) {
      if (instr.op === "I32_DATA_CONST") {
        const newVal = oldToNew.get(instr.val);
        if (newVal !== undefined) {
          instr.val = newVal;
        }
      }
    }
  }
}

// src/codegen.ts
var HEAP_PAGES = 16;
var PAGE_SIZE = 65536;
var LOG2_PAGE_SIZE = 16;
var RT_SAVE = "arena_save";
var RT_RESTORE = "arena_restore";
var RT_ALLOC = "arena_alloc";
var RT_PTR = "__heap_ptr";
var RT_MEM_END = "__mem_end";
function isInlineValue(t) {
  return typeof t === "object" && t.kind === "array";
}
function isNullablePointerType(t) {
  if (typeof t !== "object")
    return false;
  return t.kind === "pointer" || t.kind === "struct" || t.kind === "dynarray";
}
function getStructType(t) {
  if (typeof t !== "object")
    return null;
  if (t.kind === "struct")
    return t;
  if (t.kind === "pointer" && typeof t.targetType === "object" && t.targetType.kind === "struct")
    return t.targetType;
  return null;
}
function isArithType(t) {
  return typeof t === "string" && (t === "s32" || t === "u32" || t === "s64" || t === "u64" || t === "f32" || t === "f64");
}
function canConvertF64ToF32(value) {
  if (!Number.isFinite(value))
    return false;
  const f32 = Math.fround(value);
  return Math.abs(f32 - value) <= Math.abs(value) * 0.0000001;
}
function tryImplicitConvert(b, from, to) {
  if (typesEqual(from, to))
    return true;
  if (from === "null" || to === "null")
    return false;
  if (typeof from !== "string" || typeof to !== "string")
    return false;
  if (from === "string" || to === "string" || from === "bool" || to === "bool")
    return false;
  const fi = arithInfo[from];
  const ti = arithInfo[to];
  if (!fi || !ti)
    return false;
  if (!fi.isFloat && !ti.isFloat) {
    if (fi.width < ti.width) {
      fi.signed ? b.i64ExtendI32S() : b.i64ExtendI32U();
      return true;
    }
    return false;
  }
  if (!fi.isFloat && ti.isFloat) {
    switch (from) {
      case "s32":
        b.f64ConvertI32S();
        break;
      case "u32":
        b.f64ConvertI32U();
        break;
      case "s64":
        b.f64ConvertI64S();
        break;
      case "u64":
        b.f64ConvertI64U();
        break;
    }
    if (to === "f32")
      b.f32DemoteF64();
    return true;
  }
  if (from === "f32" && to === "f64") {
    b.f64PromoteF32();
    return true;
  }
  return false;
}
function handleImplicitConversion(b, exprAst, from, to) {
  if (typesEqual(from, to))
    return;
  if (from === "string" && (to === "s32" || to === "u32") || to === "string" && (from === "s32" || from === "u32"))
    return;
  if (from === "null" && typeof to === "object" && (to.kind === "pointer" || to.kind === "struct" || to.kind === "dynarray" || to.kind === "function"))
    return;
  const fromStruct = getStructType(from);
  const toStructPointer = typeof to === "object" && to.kind === "pointer" ? getStructType(to.targetType) : null;
  if (fromStruct && toStructPointer && fromStruct.name === toStructPointer.name)
    return;
  if (from === "null" || to === "null")
    throw new Error(`Type mismatch: null → ${to}`);
  if (from === "tuple" || to === "tuple")
    throw new Error("No se puede convertir una tupla");
  if (typeof from === "object" && from.kind === "array" && typeof to === "object" && to.kind === "dynarray" && typesEqual(from.elementType, to.elementType)) {
    const elemSize = sizeOfType(from.elementType);
    const totalBytes = elemSize * from.length;
    const src = `$promo_src_${Math.random().toString(36).slice(2, 7)}`;
    b.addLocal(src, "i32");
    b.setLocal(src);
    b.i32Const(4 + totalBytes);
    b.callByName(RT_ALLOC);
    const base = `$promo_base_${Math.random().toString(36).slice(2, 7)}`;
    b.addLocal(base, "i32");
    b.setLocal(base);
    b.getLocal(base);
    b.i32Const(from.length);
    b.i32Store();
    b.getLocal(base);
    b.i32Const(4);
    b.i32Add();
    b.getLocal(src);
    b.i32Const(totalBytes);
    b.callByName("memcpy");
    b.getLocal(base);
    b.i32Const(4);
    b.i32Add();
    return;
  }
  if (typeof from !== "string" || typeof to !== "string")
    throw new Error(`Type mismatch: compuesto (${from} → ${to})`);
  if (from === "string" || to === "string" || from === "bool" || to === "bool")
    throw new Error(`Type mismatch: ${from} → ${to}`);
  if (from === "f64" && to === "f32") {
    if (!canConvertF64ToF32(exprAst.value ?? 0)) {
      throw new Error("Conversión implícita f64→f32 requiere const convertible");
    }
    b.f32DemoteF64();
    return;
  }
  if (!tryImplicitConvert(b, from, to))
    throw new Error(`Type mismatch: ${from} → ${to}`);
}
function emitLoadForType(b, t, offset = 0) {
  if (typeof t === "object" && t.kind === "array") {
    if (offset > 0) {
      b.i32Const(offset);
      b.i32Add();
    }
    return;
  }
  if (typeof t !== "string") {
    b.i32Load(offset);
    return;
  }
  switch (t) {
    case "s32":
    case "u32":
    case "bool":
    case "string":
      b.i32Load(offset);
      break;
    case "s64":
    case "u64":
      b.i64Load(offset);
      break;
    case "f32":
      b.f32Load(offset);
      break;
    case "f64":
      b.f64Load(offset);
      break;
    default:
      throw new Error(`Load no soportado para ${t}`);
  }
}
function emitStoreForType(b, t, offset = 0) {
  if (typeof t === "object" && t.kind === "array") {
    const total = sizeOfType(t);
    const srcName = `$store_arr_src_${Math.random().toString(36).slice(2, 7)}`;
    const baseName = `$store_arr_base_${Math.random().toString(36).slice(2, 7)}`;
    b.addLocal(srcName, "i32");
    b.addLocal(baseName, "i32");
    b.setLocal(srcName);
    b.setLocal(baseName);
    b.getLocal(baseName);
    if (offset > 0) {
      b.i32Const(offset);
      b.i32Add();
    }
    b.getLocal(srcName);
    b.i32Const(total);
    b.callByName("memcpy");
    return;
  }
  if (typeof t !== "string") {
    b.i32Store(offset);
    return;
  }
  switch (t) {
    case "s32":
    case "u32":
    case "bool":
    case "string":
      b.i32Store(offset);
      break;
    case "s64":
    case "u64":
      b.i64Store(offset);
      break;
    case "f32":
      b.f32Store(offset);
      break;
    case "f64":
      b.f64Store(offset);
      break;
    default:
      throw new Error(`Store no soportado para ${t}`);
  }
}

class ExpressionCompiler {
  b;
  module;
  envFunctions;
  zeroCaptureClosures;
  tmp = 0;
  compilingStructEq = new Set;
  constructor(b, module, envFunctions = new Set, zeroCaptureClosures = new Set) {
    this.b = b;
    this.module = module;
    this.envFunctions = envFunctions;
    this.zeroCaptureClosures = zeroCaptureClosures;
  }
  compile(node) {
    return this.compileNode(node);
  }
  compileValue(node) {
    const t = this.compileNode(node);
    if (t === "void")
      throw new Error("Expresión void usada como valor");
    return t;
  }
  fresh(prefix, ty = "i32") {
    const name = `$${prefix}_${this.tmp++}`;
    this.b.addLocal(name, ty);
    return name;
  }
  compileNode(node) {
    switch (node.kind) {
      case "const": {
        if (node.type === "null") {
          this.b.i32Const(-1);
          return "null";
        }
        switch (node.type) {
          case "s32":
          case "u32":
            this.b.i32Const(Number(node.value));
            break;
          case "s64":
          case "u64":
            this.b.i64Const(BigInt(node.value));
            break;
          case "f32":
            this.b.f32Const(Number(node.value));
            break;
          case "f64":
            this.b.f64Const(Number(node.value));
            break;
        }
        return node.type;
      }
      case "bool":
        this.b.i32Const(node.value ? 1 : 0);
        return "bool";
      case "variable": {
        const v = node;
        if (v.isGlobal)
          this.b.globalGet(v.name);
        else
          this.b.getLocal(v.uniqueName ?? v.name);
        if (v.boxed) {
          emitLoadForType(this.b, v.type, 0);
        }
        return v.type;
      }
      case "string":
        this.b.addString(node.value);
        return "string";
      case "function_ref": {
        const r = node;
        this.b.envAddrByName(r.name);
        return r.type;
      }
      case "closure": {
        const c = node;
        if (c.captures.length === 0 && this.zeroCaptureClosures.has(c.codeName)) {
          this.b.envAddrByName(c.codeName);
          return c.type;
        }
        const envSize = 4 * (1 + c.captures.length);
        this.b.i32Const(envSize);
        this.b.callByName(RT_ALLOC);
        const base = this.fresh("closure", "i32");
        this.b.setLocal(base);
        this.b.getLocal(base);
        this.b.functionIndexByName(c.codeName);
        this.b.i32Store(0);
        for (let i = 0;i < c.captures.length; i++) {
          const cap = c.captures[i];
          const expr = c.captureExprs[i];
          if (cap.boxed) {
            this.b.getLocal(base);
            this.compileValue(expr);
            this.b.i32Store(4 + 4 * i);
            continue;
          }
          const boxSize = sizeOfType(cap.type);
          this.b.i32Const(boxSize);
          this.b.callByName(RT_ALLOC);
          const box = this.fresh("capbox", "i32");
          this.b.setLocal(box);
          this.b.getLocal(box);
          const at = this.compileValue(expr);
          if (!typesEqual(at, cap.type)) {
            handleImplicitConversion(this.b, expr, at, cap.type);
          }
          emitStoreForType(this.b, cap.type, 0);
          this.b.getLocal(base);
          this.b.getLocal(box);
          this.b.i32Store(4 + 4 * i);
        }
        this.b.getLocal(base);
        return c.type;
      }
      case "capture_access": {
        const ca = node;
        this.b.getLocal("__env");
        this.b.i32Load(4 + 4 * ca.captureIndex);
        emitLoadForType(this.b, ca.type, 0);
        return ca.type;
      }
      case "call_indirect": {
        const c = node;
        this.compileValue(c.callee);
        const clos = this.fresh("closure", "i32");
        this.b.setLocal(clos);
        this.b.getLocal(clos);
        for (let i = 0;i < c.args.length; i++) {
          const at = this.compileValue(c.args[i]);
          if (c.hasImplicitSelf && i === 0)
            continue;
          const et = c.paramTypes[i];
          if (!typesEqual(at, et))
            handleImplicitConversion(this.b, c.args[i], at, et);
        }
        this.b.getLocal(clos);
        this.b.i32Load(0);
        const wp = ["i32", ...c.paramTypes.map((t) => semanticToWasmType(t))];
        const wr = (c.returnTypes ?? []).map((t) => semanticToWasmType(t));
        const typeIdx = this.module.getTypeIndex(wp, wr);
        this.b.callIndirect(typeIdx);
        return c.returnTypes?.[0] ?? "void";
      }
      case "unary": {
        const ty = this.compileValue(node.operand);
        if (node.op === "not") {
          this.b.i32Eqz();
          return "bool";
        }
        if (node.op === "bitnot") {
          if (ty === "s32" || ty === "u32") {
            this.b.i32Const(-1);
            this.b.i32Xor();
          } else if (ty === "s64" || ty === "u64") {
            this.b.i64Const(-1n);
            this.b.i64Xor();
          } else
            throw new Error(`~ no soportado para ${ty}`);
          return ty;
        }
        if (node.op === "neg") {
          if (ty === "f32")
            this.b.f32Neg();
          else if (ty === "f64")
            this.b.f64Neg();
          else if (ty === "s32" || ty === "u32") {
            this.b.i32Const(-1);
            this.b.i32Mul();
          } else if (ty === "s64" || ty === "u64") {
            this.b.i64Const(-1n);
            this.b.i64Mul();
          } else
            throw new Error(`Negación no soportada para ${ty}`);
          return ty;
        }
        throw new Error("Unario no soportado");
      }
      case "make_array": {
        const n = node;
        if (!n.elementType || !n.type) {
          throw new Error("make_array sin resolver (semantic no rellenó elementType/type)");
        }
        const es = sizeOfType(n.elementType);
        const lenT = this.compileValue(n.lengthExpr);
        if (lenT !== "s32" && lenT !== "u32")
          throw new Error("make() requiere longitud entera");
        const lt = this.fresh("len", "i32");
        this.b.setLocal(lt);
        this.b.getLocal(lt);
        this.b.i32Const(es);
        this.b.i32Mul();
        this.b.i32Const(4);
        this.b.i32Add();
        this.b.callByName(RT_ALLOC);
        const base = this.fresh("makearr", "i32");
        this.b.setLocal(base);
        this.b.getLocal(base);
        this.b.getLocal(lt);
        this.b.i32Store();
        this.b.getLocal(base);
        this.b.i32Const(4);
        this.b.i32Add();
        return n.type;
      }
      case "binary":
        return this.compileBinary(node);
      case "cast": {
        const c = node;
        const from = this.compileValue(c.operand);
        const to = c.newType;
        if (typesEqual(from, to))
          return to;
        if (from === "string" && (to === "s32" || to === "u32") || to === "string" && (from === "s32" || from === "u32"))
          return to;
        if (from === "bool" && (to === "s32" || to === "u32") || to === "bool" && (from === "s32" || from === "u32"))
          return to;
        if (typeof from !== "string" || typeof to !== "string") {
          throw new Error(`cast entre compuestos no soportado (${from} → ${to})`);
        }
        this.emitConversion(from, to);
        return to;
      }
      case "call": {
        const c = node;
        if (c.isSameBuiltin) {
          this.compileValue(c.args[0]);
          this.compileValue(c.args[1]);
          this.b.i32Eq();
          return "bool";
        }
        if (c.isLenBuiltin) {
          const at = c.args[0].type;
          if (typeof at === "object" && at.kind === "dynarray") {
            this.compileValue(c.args[0]);
            this.b.i32Const(4);
            this.b.i32Sub();
            this.b.i32Load();
            return "s32";
          }
          if (typeof at === "object" && at.kind === "array") {
            this.b.i32Const(at.length);
            return "s32";
          }
          throw new Error("len() requiere array/dynarray");
        }
        if (this.envFunctions.has(c.name)) {
          this.b.i32Const(0);
        }
        for (let i = 0;i < c.args.length; i++) {
          const at = this.compileValue(c.args[i]);
          const et = c.paramTypes[i];
          if (!typesEqual(at, et))
            handleImplicitConversion(this.b, c.args[i], at, et);
        }
        this.b.callByName(c.name);
        return c.type;
      }
      case "struct_literal": {
        const s = node;
        const st = s.type;
        this.b.i32Const(st.size);
        this.b.callByName(RT_ALLOC);
        const base = this.fresh("struct", "i32");
        this.b.setLocal(base);
        for (const fv of s.fields) {
          const fd = st.fields.find((f) => f.name === fv.name);
          if (!fd)
            throw new Error(`Campo '${fv.name}' no existe en '${st.name}'`);
          this.b.getLocal(base);
          const at = this.compileValue(fv.value);
          if (!typesEqual(at, fd.type))
            handleImplicitConversion(this.b, fv.value, at, fd.type);
          emitStoreForType(this.b, fd.type, fd.offset);
        }
        this.b.getLocal(base);
        return st;
      }
      case "struct_access": {
        const a = node;
        const baseValueType = this.compileValue(a.base);
        const bt = a.resolvedBaseType ?? getStructType(baseValueType);
        if (!bt)
          throw new Error(`struct_access sobre ${bt}`);
        const field = bt.fields.find((f) => f.name === a.fieldName);
        if (!field)
          throw new Error(`Campo '${a.fieldName}' no existe en '${bt.name}'`);
        const base = this.fresh("struct_base", "i32");
        this.b.setLocal(base);
        if (isNullablePointerType(baseValueType))
          this.assertNotNullPointer(base);
        this.b.getLocal(base);
        if (isInlineValue(field.type)) {
          this.b.i32Const(field.offset);
          this.b.i32Add();
          return field.type;
        }
        emitLoadForType(this.b, field.type, field.offset);
        return field.type;
      }
      case "array_literal": {
        const a = node;
        const arrayType = a.type;
        if (typeof arrayType !== "object" || arrayType.kind !== "array" && arrayType.kind !== "dynarray") {
          throw new Error("array_literal sin tipo de array válido");
        }
        const elementType = arrayType.elementType;
        const elemSize = sizeOfType(elementType);
        const total = elemSize * a.elements.length;
        let data;
        if (arrayType.kind === "dynarray") {
          const allocation = this.fresh("dynarr_alloc", "i32");
          this.b.i32Const(4 + total);
          this.b.callByName(RT_ALLOC);
          this.b.setLocal(allocation);
          this.b.getLocal(allocation);
          this.b.i32Const(a.elements.length);
          this.b.i32Store();
          data = this.fresh("dynarr_data", "i32");
          this.b.getLocal(allocation);
          this.b.i32Const(4);
          this.b.i32Add();
          this.b.setLocal(data);
        } else {
          data = this.fresh("arr", "i32");
          this.b.i32Const(total);
          this.b.callByName(RT_ALLOC);
          this.b.setLocal(data);
        }
        for (let i = 0;i < a.elements.length; i++) {
          this.b.getLocal(data);
          const at = this.compileValue(a.elements[i]);
          if (!typesEqual(at, elementType)) {
            handleImplicitConversion(this.b, a.elements[i], at, elementType);
          }
          emitStoreForType(this.b, elementType, i * elemSize);
        }
        this.b.getLocal(data);
        return arrayType;
      }
      case "array_access": {
        const a = node;
        const bt = this.compileValue(a.base);
        if (typeof bt !== "object" || bt.kind !== "array" && bt.kind !== "dynarray") {
          throw new Error("array_access sobre no-array");
        }
        const base = this.fresh("ab", "i32");
        this.b.setLocal(base);
        this.compileValue(a.index);
        const idx = this.fresh("ai", "i32");
        this.b.setLocal(idx);
        this.b.getLocal(idx);
        this.b.i32Const(0);
        this.b.i32LtS();
        this.b.if_("void");
        this.b.unreachable();
        this.b.end();
        this.b.getLocal(idx);
        if (bt.kind === "dynarray") {
          this.b.getLocal(base);
          this.b.i32Const(4);
          this.b.i32Sub();
          this.b.i32Load();
        } else
          this.b.i32Const(bt.length);
        this.b.i32GeS();
        this.b.if_("void");
        this.b.unreachable();
        this.b.end();
        const es = sizeOfType(bt.elementType);
        this.b.getLocal(base);
        this.b.getLocal(idx);
        this.b.i32Const(es);
        this.b.i32Mul();
        this.b.i32Add();
        if (isInlineValue(bt.elementType))
          return bt.elementType;
        emitLoadForType(this.b, bt.elementType);
        return bt.elementType;
      }
      case "increment":
        return this.compileIncrement(node);
      default:
        throw new Error(`Nodo no soportado en codegen: ${node.kind}`);
    }
  }
  compileBinary(node) {
    const leftPreview = node.left.type;
    const rightPreview = node.right.type;
    if (leftPreview && rightPreview && typeof leftPreview === "object" && leftPreview.kind === "struct" && typeof rightPreview === "object" && rightPreview.kind === "struct" && typesEqual(leftPreview, rightPreview) && (node.op === "==" || node.op === "!=")) {
      this.compileStructEq(node.left, node.right, leftPreview);
      if (node.op === "!=")
        this.b.i32Eqz();
      return "bool";
    }
    const sameArith = isArithType(leftPreview) && isArithType(rightPreview) && leftPreview === rightPreview;
    const bothString = leftPreview === "string" && rightPreview === "string";
    const bothBool = leftPreview === "bool" && rightPreview === "bool";
    const nullCmp = (leftPreview === "null" || rightPreview === "null") && (node.op === "==" || node.op === "!=");
    if (sameArith || bothString || bothBool || nullCmp) {
      return this.compileBinaryOnStack(node);
    }
    return this.compileBinaryWithTemps(node);
  }
  compileStructEq(left, right, st) {
    this.compileValue(left);
    this.compileValue(right);
    this.emitNestedStructEq(st);
  }
  emitPatternMatchOnStack(pattern, type) {
    switch (pattern.kind) {
      case "wildcard":
        this.b.drop();
        this.b.i32Const(1);
        return;
      case "const": {
        if (pattern.type === "null") {
          this.b.i32Const(-1);
          this.b.i32Eq();
          return;
        }
        const litType = pattern.type;
        const litValue = pattern.value;
        switch (litType) {
          case "s32":
          case "u32":
            this.b.i32Const(Number(litValue));
            break;
          case "s64":
          case "u64":
            this.b.i64Const(BigInt(litValue));
            break;
          case "f32":
            this.b.f32Const(Number(litValue));
            break;
          case "f64":
            this.b.f64Const(Number(litValue));
            break;
        }
        if (!typesEqual(litType, type)) {
          if (type === "s64" || type === "u64") {
            if (litType === "s32")
              this.b.i64ExtendI32S();
            else if (litType === "u32")
              this.b.i64ExtendI32U();
            else
              throw new Error(`pattern: conversión ${litType} → ${type} no soportada`);
          } else if (type === "f64") {
            if (litType === "s32")
              this.b.f64ConvertI32S();
            else if (litType === "u32")
              this.b.f64ConvertI32U();
            else if (litType === "s64")
              this.b.f64ConvertI64S();
            else if (litType === "u64")
              this.b.f64ConvertI64U();
            else if (litType === "f32")
              this.b.f64PromoteF32();
          } else if (type === "f32") {
            if (litType === "s32")
              this.b.f32ConvertI32S();
            else if (litType === "u32")
              this.b.f32ConvertI32U();
            else if (litType === "s64")
              this.b.f32ConvertI64S();
            else if (litType === "u64")
              this.b.f32ConvertI64U();
            else if (litType === "f64")
              this.b.f32DemoteF64();
          } else if (type === "s32" || type === "u32") {
            if (litType === "s64" || litType === "u64")
              this.b.i32WrapI64();
          } else {
            throw new Error(`pattern: conversión ${litType} → ${type} no soportada`);
          }
        }
        if (type === "f32")
          this.b.f32Eq();
        else if (type === "f64")
          this.b.f64Eq();
        else if (type === "s64" || type === "u64")
          this.b.i64Eq();
        else
          this.b.i32Eq();
        return;
      }
      case "string": {
        this.b.addString(pattern.value);
        this.b.callByName("str_eq");
        return;
      }
      case "bool": {
        this.b.i32Const(pattern.value ? 1 : 0);
        this.b.i32Eq();
        return;
      }
      case "struct": {
        const st = type;
        const ptrLocal = this.fresh("pm_ptr", "i32");
        this.b.setLocal(ptrLocal);
        this.b.getLocal(ptrLocal);
        this.b.i32Const(-1);
        this.b.i32Ne();
        for (const fp of pattern.fields) {
          if (fp.pattern.kind === "wildcard")
            continue;
          const field = st.fields.find((f) => f.name === fp.name);
          if (!field) {
            throw new Error(`Campo '${fp.name}' no existe en '${st.name}'`);
          }
          this.b.getLocal(ptrLocal);
          emitLoadForType(this.b, field.type, field.offset);
          this.emitPatternMatchOnStack(fp.pattern, field.type);
          this.b.i32And();
        }
        return;
      }
    }
  }
  emitStructEqBody(ltmp, rtmp, st) {
    const stKey = st.name === "" ? null : st.name;
    if (stKey !== null && this.compilingStructEq.has(stKey)) {
      throw new Error(`comparación estructural de '${stKey}': el struct es auto-referencial; ` + `la comparación profunda generaría código infinito. ` + `Compara los campos uno a uno o guarda la igualdad de punteros por separado.`);
    }
    if (stKey !== null)
      this.compilingStructEq.add(stKey);
    try {
      let first = true;
      for (const field of st.fields) {
        const ft = field.type;
        if (!this.isComparableField(ft)) {
          throw new Error(`comparación estructural de '${st.name || "(anónimo)"}': ` + `campo '${field.name}' de tipo ${this.typeDesc(ft)} no soportado`);
        }
        this.b.getLocal(ltmp);
        emitLoadForType(this.b, ft, field.offset);
        this.b.getLocal(rtmp);
        emitLoadForType(this.b, ft, field.offset);
        this.emitEqForType(ft);
        if (first)
          first = false;
        else
          this.b.i32And();
      }
      if (first)
        this.b.i32Const(1);
    } finally {
      if (stKey !== null)
        this.compilingStructEq.delete(stKey);
    }
  }
  isComparableField(t) {
    if (typeof t === "string")
      return true;
    if (t.kind === "pointer")
      return true;
    if (t.kind === "struct")
      return true;
    if (t.kind === "array")
      return this.isComparableField(t.elementType);
    return false;
  }
  emitEqForType(t) {
    if (t === "string") {
      this.b.callByName("str_eq");
      return;
    }
    if (t === "f32") {
      this.b.f32Eq();
      return;
    }
    if (t === "f64") {
      this.b.f64Eq();
      return;
    }
    if (t === "s64" || t === "u64") {
      this.b.i64Eq();
      return;
    }
    if (typeof t === "object" && t.kind === "struct") {
      this.emitNestedStructEq(t);
      return;
    }
    if (typeof t === "object" && t.kind === "array") {
      this.emitArrayEq(t.elementType, t.length);
      return;
    }
    this.b.i32Eq();
  }
  emitNestedStructEq(st) {
    const lp = this.fresh("ns_L", "i32");
    const rp = this.fresh("ns_R", "i32");
    this.b.setLocal(rp);
    this.b.setLocal(lp);
    this.b.getLocal(lp);
    this.b.getLocal(rp);
    this.b.i32Eq();
    this.b.if_("i32");
    this.b.i32Const(1);
    this.b.else_();
    this.b.getLocal(lp);
    this.b.i32Const(-1);
    this.b.i32Eq();
    this.b.if_("i32");
    this.b.i32Const(0);
    this.b.else_();
    this.b.getLocal(rp);
    this.b.i32Const(-1);
    this.b.i32Eq();
    this.b.if_("i32");
    this.b.i32Const(0);
    this.b.else_();
    this.emitStructEqBody(lp, rp, st);
    this.b.end();
    this.b.end();
    this.b.end();
  }
  emitArrayEq(elemType, length) {
    if (length > 256) {
      throw new Error(`comparación de arrays de longitud ${length} no soportada ` + `(máximo 256 elementos por array)`);
    }
    const lp = this.fresh("ae_L", "i32");
    const rp = this.fresh("ae_R", "i32");
    this.b.setLocal(rp);
    this.b.setLocal(lp);
    const elemSize = sizeOfType(elemType);
    let first = true;
    for (let i = 0;i < length; i++) {
      this.b.getLocal(lp);
      emitLoadForType(this.b, elemType, i * elemSize);
      this.b.getLocal(rp);
      emitLoadForType(this.b, elemType, i * elemSize);
      this.emitEqForType(elemType);
      if (first)
        first = false;
      else
        this.b.i32And();
    }
    if (first)
      this.b.i32Const(1);
  }
  typeDesc(t) {
    if (typeof t === "string")
      return t;
    if (t.kind === "struct")
      return `struct ${t.name || "(anónimo)"}`;
    if (t.kind === "array")
      return `[${this.typeDesc(t.elementType)}; ${t.length}]`;
    if (t.kind === "dynarray")
      return `[]${this.typeDesc(t.elementType)}`;
    if (t.kind === "pointer")
      return `*${this.typeDesc(t.targetType)}`;
    if (t.kind === "function")
      return "fn";
    return "?";
  }
  compileBinaryOnStack(node) {
    const lt = this.compileValue(node.left);
    const rt = this.compileValue(node.right);
    if (lt === "null" || rt === "null") {
      if (node.op === "==" || node.op === "!=") {
        this.b.i32Ne();
        if (node.op === "==")
          this.b.i32Eqz();
        return "bool";
      }
      throw new Error("Operación no soportada con null");
    }
    if (node.op === "&&" || node.op === "||") {
      if (node.op === "&&")
        this.b.i32And();
      else
        this.b.i32Or();
      return "bool";
    }
    if (lt === "string" && rt === "string") {
      if (node.op === "+") {
        this.b.callByName("str_concat");
        return "string";
      }
      if (node.op === "==") {
        this.b.callByName("str_eq");
        return "bool";
      }
      if (node.op === "!=") {
        this.b.callByName("str_ne");
        return "bool";
      }
      if (node.op === "<" || node.op === "<=" || node.op === ">" || node.op === ">=") {
        this.b.callByName("str_cmp");
        this.b.i32Const(0);
        switch (node.op) {
          case "<":
            this.b.i32LtS();
            break;
          case "<=":
            this.b.i32LeS();
            break;
          case ">":
            this.b.i32GtS();
            break;
          case ">=":
            this.b.i32GeS();
            break;
        }
        return "bool";
      }
      throw new Error(`Operación '${node.op}' no soportada entre strings`);
    }
    if (lt === "bool" && rt === "bool") {
      switch (node.op) {
        case "==":
          this.b.i32Eq();
          return "bool";
        case "!=":
          this.b.i32Ne();
          return "bool";
        default:
          throw new Error(`Operación '${node.op}' no soportada entre bools`);
      }
    }
    if (lt !== rt || !isArithType(lt)) {
      throw new Error(`compileBinaryOnStack: tipos inesperados (${String(lt)} vs ${String(rt)})`);
    }
    if (["==", "!=", "<", "<=", ">", ">="].includes(node.op)) {
      this.emitComparison(node.op, lt);
      return "bool";
    }
    if (["&", "|", "^", "<<", ">>"].includes(node.op)) {
      this.emitBitwise(node.op, lt);
      return lt;
    }
    this.emitBinary(node.op, lt);
    return lt;
  }
  compileBinaryWithTemps(node) {
    const lt = this.compileValue(node.left);
    const ltmp = this.fresh("L", semanticToWasmType(lt));
    this.b.setLocal(ltmp);
    const rt = this.compileValue(node.right);
    const rtmp = this.fresh("R", semanticToWasmType(rt));
    this.b.setLocal(rtmp);
    if (lt === "null" || rt === "null") {
      if (node.op === "==" || node.op === "!=") {
        this.b.getLocal(ltmp);
        this.b.getLocal(rtmp);
        this.b.i32Ne();
        if (node.op === "==")
          this.b.i32Eqz();
        return "bool";
      }
      throw new Error("Operación no soportada con null");
    }
    if (node.op === "&&" || node.op === "||") {
      this.b.getLocal(ltmp);
      this.b.getLocal(rtmp);
      if (node.op === "&&")
        this.b.i32And();
      else
        this.b.i32Or();
      return "bool";
    }
    if (lt === "string" && rt === "string") {
      if (node.op === "+") {
        this.b.getLocal(ltmp);
        this.b.getLocal(rtmp);
        this.b.callByName("str_concat");
        return "string";
      }
      if (node.op === "==") {
        this.b.getLocal(ltmp);
        this.b.getLocal(rtmp);
        this.b.callByName("str_eq");
        return "bool";
      }
      if (node.op === "!=") {
        this.b.getLocal(ltmp);
        this.b.getLocal(rtmp);
        this.b.callByName("str_ne");
        return "bool";
      }
      if (node.op === "<" || node.op === "<=" || node.op === ">" || node.op === ">=") {
        this.b.getLocal(ltmp);
        this.b.getLocal(rtmp);
        this.b.callByName("str_cmp");
        this.b.i32Const(0);
        switch (node.op) {
          case "<":
            this.b.i32LtS();
            break;
          case "<=":
            this.b.i32LeS();
            break;
          case ">":
            this.b.i32GtS();
            break;
          case ">=":
            this.b.i32GeS();
            break;
        }
        return "bool";
      }
      throw new Error(`Operación '${node.op}' no soportada entre strings`);
    }
    if (lt === "bool" && rt === "bool") {
      this.b.getLocal(ltmp);
      this.b.getLocal(rtmp);
      switch (node.op) {
        case "==":
          this.b.i32Eq();
          return "bool";
        case "!=":
          this.b.i32Ne();
          return "bool";
        default:
          throw new Error(`Operación '${node.op}' no soportada entre bools`);
      }
    }
    if (["==", "!=", "<", "<=", ">", ">="].includes(node.op)) {
      const r2 = maxArithmeticType2(lt, rt);
      this.b.getLocal(ltmp);
      if (lt !== r2)
        this.emitConversion(lt, r2);
      this.b.getLocal(rtmp);
      if (rt !== r2)
        this.emitConversion(rt, r2);
      this.emitComparison(node.op, r2);
      return "bool";
    }
    if (["&", "|", "^", "<<", ">>"].includes(node.op)) {
      const r2 = maxArithmeticType2(lt, rt);
      this.b.getLocal(ltmp);
      if (lt !== r2)
        this.emitConversion(lt, r2);
      this.b.getLocal(rtmp);
      if (rt !== r2)
        this.emitConversion(rt, r2);
      this.emitBitwise(node.op, r2);
      return r2;
    }
    const r2 = maxArithmeticType2(lt, rt);
    this.b.getLocal(ltmp);
    if (lt !== r2)
      this.emitConversion(lt, r2);
    this.b.getLocal(rtmp);
    if (rt !== r2)
      this.emitConversion(rt, r2);
    this.emitBinary(node.op, r2);
    return r2;
  }
  compileIncrementAsStatement(node) {
    const operand = node.operand;
    const type = operand.type;
    if (!isArithType(type)) {
      throw new Error(`No se puede aplicar ${node.operator} al tipo ${String(type)}`);
    }
    let targetAddress = null;
    if (operand.kind === "variable") {
      const variable = operand;
      if (variable.isGlobal)
        this.b.globalGet(variable.name);
      else
        this.b.getLocal(variable.uniqueName ?? variable.name);
      if (variable.boxed)
        emitLoadForType(this.b, type, 0);
    } else {
      targetAddress = this.emitIncrementAddress(operand);
      this.b.getLocal(targetAddress);
      emitLoadForType(this.b, type);
    }
    this.emitIncrementOperation(type, node.operator);
    if (operand.kind === "variable") {
      const variable = operand;
      if (variable.boxed) {
        const tmp = this.fresh("inc_boxv", semanticToWasmType(type));
        this.b.setLocal(tmp);
        if (variable.isGlobal)
          this.b.globalGet(variable.name);
        else
          this.b.getLocal(variable.uniqueName ?? variable.name);
        this.b.getLocal(tmp);
        emitStoreForType(this.b, type, 0);
      } else {
        if (variable.isGlobal)
          this.b.globalSet(variable.name);
        else
          this.b.setLocal(variable.uniqueName ?? variable.name);
      }
    } else {
      const newValue = this.fresh("inc_new", semanticToWasmType(type));
      this.b.setLocal(newValue);
      this.b.getLocal(targetAddress);
      this.b.getLocal(newValue);
      emitStoreForType(this.b, type);
    }
  }
  compileIncrement(node) {
    const operand = node.operand;
    const type = operand.type;
    if (!isArithType(type)) {
      throw new Error(`No se puede aplicar ${node.operator} al tipo ${String(type)}`);
    }
    const oldValue = this.fresh("inc_old", semanticToWasmType(type));
    const newValue = this.fresh("inc_new", semanticToWasmType(type));
    let targetAddress = null;
    if (operand.kind === "variable") {
      const variable = operand;
      if (variable.isGlobal)
        this.b.globalGet(variable.name);
      else
        this.b.getLocal(variable.uniqueName ?? variable.name);
      if (variable.boxed)
        emitLoadForType(this.b, type, 0);
    } else {
      targetAddress = this.emitIncrementAddress(operand);
      this.b.getLocal(targetAddress);
      emitLoadForType(this.b, type);
    }
    this.b.setLocal(oldValue);
    this.b.getLocal(oldValue);
    this.emitIncrementOperation(type, node.operator);
    this.b.setLocal(newValue);
    if (operand.kind === "variable") {
      const variable = operand;
      if (variable.boxed) {
        const tmp = this.fresh("inc_boxv", semanticToWasmType(type));
        this.b.setLocal(tmp);
        if (variable.isGlobal)
          this.b.globalGet(variable.name);
        else
          this.b.getLocal(variable.uniqueName ?? variable.name);
        this.b.getLocal(tmp);
        emitStoreForType(this.b, type, 0);
      } else {
        this.b.getLocal(newValue);
        if (variable.isGlobal)
          this.b.globalSet(variable.name);
        else
          this.b.setLocal(variable.uniqueName ?? variable.name);
      }
    } else {
      this.b.getLocal(targetAddress);
      this.b.getLocal(newValue);
      emitStoreForType(this.b, type);
    }
    this.b.getLocal(node.prefix ? newValue : oldValue);
    return type;
  }
  emitIncrementOperation(type, operator) {
    const isIncrement = operator === "++";
    switch (type) {
      case "s32":
      case "u32":
        this.b.i32Const(1);
        isIncrement ? this.b.i32Add() : this.b.i32Sub();
        break;
      case "s64":
      case "u64":
        this.b.i64Const(1n);
        isIncrement ? this.b.i64Add() : this.b.i64Sub();
        break;
      case "f32":
        this.b.f32Const(1);
        isIncrement ? this.b.f32Add() : this.b.f32Sub();
        break;
      case "f64":
        this.b.f64Const(1);
        isIncrement ? this.b.f64Add() : this.b.f64Sub();
        break;
    }
  }
  emitIncrementAddress(target) {
    const address = this.fresh("inc_addr", "i32");
    if (target.kind === "capture_access") {
      this.b.getLocal("__env");
      this.b.i32Load(4 + 4 * target.captureIndex);
      this.b.setLocal(address);
      return address;
    }
    if (target.kind === "struct_access") {
      const baseValueType = target.base.type;
      const baseType = target.resolvedBaseType ?? getStructType(baseValueType);
      if (!baseType)
        throw new Error("El incremento requiere un campo de struct");
      const field = baseType.fields.find((c) => c.name === target.fieldName);
      if (!field)
        throw new Error(`Campo '${target.fieldName}' no existe en '${baseType.name}'`);
      this.compileValue(target.base);
      const base = this.fresh("inc_struct_base", "i32");
      this.b.setLocal(base);
      if (isNullablePointerType(baseValueType))
        this.assertNotNullPointer(base);
      this.b.getLocal(base);
      this.b.i32Const(field.offset);
      this.b.i32Add();
      this.b.setLocal(address);
      return address;
    }
    if (target.kind === "array_access") {
      const arrayType = target.base.type;
      if (typeof arrayType !== "object" || arrayType.kind !== "array" && arrayType.kind !== "dynarray") {
        throw new Error("El incremento requiere un elemento de array");
      }
      this.compileValue(target.base);
      const base = this.fresh("inc_array_base", "i32");
      this.b.setLocal(base);
      this.compileValue(target.index);
      const index = this.fresh("inc_array_index", "i32");
      this.b.setLocal(index);
      this.b.getLocal(base);
      this.b.getLocal(index);
      this.b.i32Const(sizeOfType(arrayType.elementType));
      this.b.i32Mul();
      this.b.i32Add();
      this.b.setLocal(address);
      return address;
    }
    throw new Error(`Destino de incremento no asignable: ${target.kind}`);
  }
  assertNotNullPointer(pointerLocal) {
    this.b.getLocal(pointerLocal);
    this.b.i32Const(-1);
    this.b.i32Eq();
    this.b.if_("void");
    this.b.unreachable();
    this.b.end();
  }
  emitConversion(from, to) {
    if (from === to)
      return;
    const fS = signedness2[from];
    const tS = signedness2[to];
    if (fS !== "float" && tS !== "float") {
      if (width2[to] > width2[from])
        fS === "signed" ? this.b.i64ExtendI32S() : this.b.i64ExtendI32U();
      else if (width2[to] < width2[from])
        this.b.i32WrapI64();
      return;
    }
    if (fS !== "float" && tS === "float") {
      switch (from) {
        case "s32":
          this.b.f64ConvertI32S();
          break;
        case "u32":
          this.b.f64ConvertI32U();
          break;
        case "s64":
          this.b.f64ConvertI64S();
          break;
        case "u64":
          this.b.f64ConvertI64U();
          break;
      }
      if (to === "f32")
        this.b.f32DemoteF64();
      return;
    }
    if (fS === "float" && tS !== "float") {
      const toSigned = signedness2[to] === "signed";
      const to32 = width2[to] === 32;
      if (from === "f32") {
        if (to32)
          toSigned ? this.b.i32TruncF32S() : this.b.i32TruncF32U();
        else
          toSigned ? this.b.i64TruncF32S() : this.b.i64TruncF32U();
      } else {
        if (to32)
          toSigned ? this.b.i32TruncF64S() : this.b.i32TruncF64U();
        else
          toSigned ? this.b.i64TruncF64S() : this.b.i64TruncF64U();
      }
      return;
    }
    if (from === "f32" && to === "f64")
      this.b.f64PromoteF32();
    else if (from === "f64" && to === "f32")
      this.b.f32DemoteF64();
  }
  emitComparison(op, t) {
    const isF = signedness2[t] === "float";
    const isS = signedness2[t] === "signed";
    const is32 = width2[t] === 32;
    if (isF) {
      const m = { "==": "f64Eq", "!=": "f64Ne", "<": "f64Lt", "<=": "f64Le", ">": "f64Gt", ">=": "f64Ge" };
      this.b[m[op]]();
    } else if (is32) {
      const m = {
        "==": "i32Eq",
        "!=": "i32Ne",
        "<": isS ? "i32LtS" : "i32LtU",
        "<=": isS ? "i32LeS" : "i32LeU",
        ">": isS ? "i32GtS" : "i32GtU",
        ">=": isS ? "i32GeS" : "i32GeU"
      };
      this.b[m[op]]();
    } else {
      const m = {
        "==": "i64Eq",
        "!=": "i64Ne",
        "<": isS ? "i64LtS" : "i64LtU",
        "<=": isS ? "i64LeS" : "i64LeU",
        ">": isS ? "i64GtS" : "i64GtU",
        ">=": isS ? "i64GeS" : "i64GeU"
      };
      this.b[m[op]]();
    }
  }
  emitBitwise(op, t) {
    const is32 = width2[t] === 32;
    const isS = signedness2[t] === "signed";
    switch (op) {
      case "&":
        is32 ? this.b.i32And() : this.b.i64And();
        break;
      case "|":
        is32 ? this.b.i32Or() : this.b.i64Or();
        break;
      case "^":
        is32 ? this.b.i32Xor() : this.b.i64Xor();
        break;
      case "<<":
        is32 ? this.b.i32Shl() : this.b.i64Shl();
        break;
      case ">>":
        if (is32)
          isS ? this.b.i32ShrS() : this.b.i32ShrU();
        else
          isS ? this.b.i64ShrS() : this.b.i64ShrU();
        break;
    }
  }
  emitBinary(op, t) {
    const isF = signedness2[t] === "float";
    const isS = signedness2[t] === "signed";
    const is32 = width2[t] === 32;
    switch (op) {
      case "+":
        isF ? t === "f32" ? this.b.f32Add() : this.b.f64Add() : is32 ? this.b.i32Add() : this.b.i64Add();
        break;
      case "-":
        isF ? t === "f32" ? this.b.f32Sub() : this.b.f64Sub() : is32 ? this.b.i32Sub() : this.b.i64Sub();
        break;
      case "*":
        isF ? t === "f32" ? this.b.f32Mul() : this.b.f64Mul() : is32 ? this.b.i32Mul() : this.b.i64Mul();
        break;
      case "/":
        if (isF)
          t === "f32" ? this.b.f32Div() : this.b.f64Div();
        else if (is32)
          isS ? this.b.i32DivS() : this.b.i32DivU();
        else
          isS ? this.b.i64DivS() : this.b.i64DivU();
        break;
      case "%":
        if (isF)
          throw new Error("% no soportado en flotantes");
        if (is32)
          isS ? this.b.i32RemS() : this.b.i32RemU();
        else
          isS ? this.b.i64RemS() : this.b.i64RemU();
        break;
      default:
        throw new Error(`Operador no soportado: ${op}`);
    }
  }
}

class CodeGenerator {
  modular;
  startBuilder;
  ctr = 0;
  _labelStack = [];
  _regionStack = [];
  envFunctions = new Set;
  zeroCaptureClosures = new Set;
  envBaseAddr = 0;
  envOffsets = new Map;
  constructor(stmts) {
    this.modular = new ModuleBuilder;
    this.modular.addMemory(1);
    this.modular.addExport("memory", "memory", 0);
    for (const s of stmts)
      if (s.kind === "import_decl")
        this.declareImport(s);
    const {
      all: functionRefs,
      direct: directRefs,
      zeroCapture: zeroCaptureClosures
    } = this.collectFunctionRefs(stmts);
    this.envFunctions = functionRefs;
    this.zeroCaptureClosures = zeroCaptureClosures;
    let slot = 0;
    for (const name of functionRefs)
      this.modular.addFunctionToTable(name, slot++);
    for (const s of stmts)
      if (s.kind === "function_def")
        this.compileFunction(s);
    this.startBuilder = new FunctionIRBuilder([], [], [], this.modular);
    for (const s of stmts) {
      if (s.kind === "function_def")
        continue;
      if (s.kind === "struct_def")
        continue;
      if (s.kind === "type_alias")
        continue;
      if (s.kind === "import_decl")
        continue;
      this.compileStatement(s, this.startBuilder, true);
    }
    this.startBuilder.finalize();
    const envNames = new Set;
    const scanInstrs = (instrs) => {
      for (const i of instrs) {
        if (i.op === "ENV_ADDR_BY_NAME")
          envNames.add(i.name);
      }
    };
    for (const fn of this.modular.functions)
      scanInstrs(fn.builder.instructions);
    scanInstrs(this.startBuilder.instructions);
    this.modular.ensureStringData();
    if (envNames.size > 0) {
      const base = this.modular.getStaticDataEnd(4);
      const data = [];
      let cursor = 0;
      for (const name of envNames) {
        this.envOffsets.set(name, cursor);
        data.push(0, 0, 0, 0);
        cursor += 4;
      }
      this.modular.addDataSegment(base, data);
      this.envBaseAddr = base;
    }
    const staticEnd = this.modular.getStaticDataEnd(8);
    const heapBase = staticEnd;
    const needed = heapBase + HEAP_PAGES * PAGE_SIZE;
    const initialPages = Math.max(1, Math.ceil(needed / PAGE_SIZE));
    const memEnd = initialPages * PAGE_SIZE;
    this.modular.addGlobal(RT_PTR, "i32", true, heapBase);
    this.modular.addGlobal(RT_MEM_END, "i32", true, memEnd);
    this.setupRuntime();
    this.modular.addFunctionInstance("_start", this.startBuilder);
    this.modular.addExport("_start", "function", "_start");
    if (initialPages > this.modular.memoryInitial)
      this.modular.memoryInitial = initialPages;
  }
  build() {
    const liveNames = eliminateDeadFunctions(this.modular);
    eliminateDeadImports(this.modular, liveNames);
    eliminateDeadStrings(this.modular);
    this.resolveEnvAddresses();
    this.fillEnvData();
    return this.modular.build();
  }
  resolveEnvAddresses() {
    if (this.envOffsets.size === 0)
      return;
    const base = this.envBaseAddr;
    const rewrite = (instrs) => instrs.map((instr) => {
      if (instr.op === "ENV_ADDR_BY_NAME") {
        const off = this.envOffsets.get(instr.name);
        if (off === undefined)
          throw new Error(`Env no encontrado: ${instr.name}`);
        return { op: "I32_CONST", val: base + off };
      }
      return instr;
    });
    for (const fn of this.modular.functions) {
      fn.builder.instructions = rewrite(fn.builder.instructions);
    }
  }
  fillEnvData() {
    if (this.envOffsets.size === 0)
      return;
    const seg = this.modular.dataSegments.find((s) => s.offset === this.envBaseAddr);
    if (!seg)
      throw new Error("Env segment no encontrado");
    for (const [name, off] of this.envOffsets) {
      const idx = this.modular.functionTableIndices.get(name);
      if (idx === undefined)
        throw new Error(`Función sin índice de tabla: ${name}`);
      seg.data[off] = idx & 255;
      seg.data[off + 1] = idx >> 8 & 255;
      seg.data[off + 2] = idx >> 16 & 255;
      seg.data[off + 3] = idx >> 24 & 255;
    }
  }
  toWat() {
    return this.modular.toWat();
  }
  collectFunctionRefs(stmts) {
    const all = new Set;
    const direct = new Set;
    const zeroCapture = new Set;
    const seen = new WeakSet;
    const visitedFns = new Set;
    const fnByName = new Map;
    for (const s of stmts) {
      if (s.kind === "function_def")
        fnByName.set(s.name, s);
    }
    const visitFunctionBody = (name) => {
      if (visitedFns.has(name))
        return;
      visitedFns.add(name);
      const fn = fnByName.get(name);
      if (!fn)
        return;
      for (const s of fn.body)
        visit(s);
    };
    const visit = (node) => {
      if (!node || typeof node !== "object")
        return;
      if (seen.has(node))
        return;
      seen.add(node);
      if (Array.isArray(node)) {
        for (const item of node)
          visit(item);
        return;
      }
      if (node.kind === "function_def")
        return;
      if (node.kind === "function_ref" && typeof node.name === "string") {
        all.add(node.name);
        direct.add(node.name);
        visitFunctionBody(node.name);
        return;
      }
      if (node.kind === "closure" && typeof node.codeName === "string") {
        all.add(node.codeName);
        if (Array.isArray(node.captures) && node.captures.length === 0) {
          zeroCapture.add(node.codeName);
        }
        visitFunctionBody(node.codeName);
      }
      if (node.kind === "call" && typeof node.name === "string") {
        visitFunctionBody(node.name);
      }
      const SKIP = new Set([
        "type",
        "resolvedBaseType",
        "elementType",
        "targetType",
        "paramTypes",
        "returnTypes"
      ]);
      for (const key of Object.keys(node)) {
        if (key === "kind")
          continue;
        if (SKIP.has(key))
          continue;
        visit(node[key]);
      }
    };
    for (const s of stmts) {
      if (s.kind === "function_def")
        continue;
      if (s.kind === "struct_def")
        continue;
      if (s.kind === "type_alias")
        continue;
      if (s.kind === "import_decl")
        continue;
      visit(s);
    }
    return { all, direct, zeroCapture };
  }
  declareImport(id) {
    const wp = id.params.map((p) => semanticToWasmType(p.type));
    const wr = id.returnType ? semanticToWasmType(id.returnType) : null;
    this.modular.addFunctionImportAlias(id.module, id.field, id.name, wp, wr);
  }
  setupRuntime() {
    const m = this.modular;
    const ALIGN = 8;
    const MASK = ALIGN - 1;
    const NEGMASK = ~MASK | 0;
    m.addFunction(RT_SAVE, [], "i32", (b) => {
      b.globalGet(RT_PTR);
    });
    m.addFunction(RT_RESTORE, ["i32"], null, (b) => {
      b.getLocal("mark");
      b.globalSet(RT_PTR);
    }, ["mark"]);
    m.addFunction(RT_ALLOC, ["i32"], "i32", (b) => {
      const aligned = b.addLocal("$aligned", "i32");
      const end = b.addLocal("$end", "i32");
      const pages = b.addLocal("$pages", "i32");
      const oldSize = b.addLocal("$old_size", "i32");
      b.globalGet(RT_PTR);
      b.i32Const(MASK);
      b.i32Add();
      b.i32Const(NEGMASK);
      b.i32And();
      b.setLocal(aligned);
      b.getLocal(aligned);
      b.getLocal("size");
      b.i32Add();
      b.setLocal(end);
      b.getLocal(end);
      b.globalGet(RT_MEM_END);
      b.i32GtU();
      b.if_("void");
      b.getLocal(end);
      b.globalGet(RT_MEM_END);
      b.i32Sub();
      b.i32Const(PAGE_SIZE - 1);
      b.i32Add();
      b.i32Const(LOG2_PAGE_SIZE);
      b.i32ShrU();
      b.setLocal(pages);
      b.getLocal(pages);
      b.memoryGrow();
      b.setLocal(oldSize);
      b.getLocal(oldSize);
      b.i32Const(-1);
      b.i32Eq();
      b.if_("void");
      b.unreachable();
      b.end();
      b.getLocal(oldSize);
      b.getLocal(pages);
      b.i32Add();
      b.i32Const(LOG2_PAGE_SIZE);
      b.i32Shl();
      b.globalSet(RT_MEM_END);
      b.end();
      b.getLocal(end);
      b.globalSet(RT_PTR);
      b.getLocal(aligned);
    }, ["size"]);
    m.addFunction("memcpy", ["i32", "i32", "i32"], null, (b) => {
      b.getLocal("dst");
      b.getLocal("src");
      b.getLocal("n");
      b.memoryCopy();
    }, ["dst", "src", "n"]);
    m.addFunction("mem_read32", ["i32"], "i32", (b) => {
      b.getLocal("addr");
      b.i32Load();
    }, ["addr"]);
    m.addFunction("mem_write32", ["i32", "i32"], null, (b) => {
      b.getLocal("addr");
      b.getLocal("v");
      b.i32Store();
    }, ["addr", "v"]);
    m.addFunction("mem_read8", ["i32"], "i32", (b) => {
      b.getLocal("addr");
      b.i32Load8U();
    }, ["addr"]);
    m.addFunction("mem_write8", ["i32", "i32"], null, (b) => {
      b.getLocal("addr");
      b.getLocal("v");
      b.i32Store8();
    }, ["addr", "v"]);
    m.addFunction("str_len", ["i32"], "i32", (b) => {
      b.getLocal("s");
      b.i32Const(4);
      b.i32Sub();
      b.i32Load();
    }, ["s"]);
    m.addFunction("str_eq", ["i32", "i32"], "i32", (b) => {
      b.addLocal("len_a", "i32");
      b.addLocal("i", "i32");
      b.getLocal("a");
      b.i32Const(4);
      b.i32Sub();
      b.i32Load();
      b.setLocal("len_a");
      b.getLocal("len_a");
      b.getLocal("b");
      b.i32Const(4);
      b.i32Sub();
      b.i32Load();
      b.i32Ne();
      b.if_("void");
      b.i32Const(0);
      b.return_();
      b.end();
      b.i32Const(0);
      b.setLocal("i");
      b.block("void", "str_eq_done");
      b.loop("void", "str_eq_loop");
      b.getLocal("i");
      b.getLocal("len_a");
      b.i32GeS();
      b.brIfTo("str_eq_done");
      b.getLocal("a");
      b.getLocal("i");
      b.i32Add();
      b.i32Load8U();
      b.getLocal("b");
      b.getLocal("i");
      b.i32Add();
      b.i32Load8U();
      b.i32Ne();
      b.if_("void");
      b.i32Const(0);
      b.return_();
      b.end();
      b.getLocal("i");
      b.i32Const(1);
      b.i32Add();
      b.setLocal("i");
      b.brTo("str_eq_loop");
      b.end();
      b.end();
      b.i32Const(1);
    }, ["a", "b"]);
    m.addFunction("str_ne", ["i32", "i32"], "i32", (b) => {
      b.getLocal("a");
      b.getLocal("b");
      b.callByName("str_eq");
      b.i32Eqz();
    }, ["a", "b"]);
    m.addFunction("str_cmp", ["i32", "i32"], "i32", (b) => {
      b.addLocal("len_a", "i32");
      b.addLocal("len_b", "i32");
      b.addLocal("min_len", "i32");
      b.addLocal("i", "i32");
      b.addLocal("ca", "i32");
      b.addLocal("cb", "i32");
      b.getLocal("a");
      b.i32Const(4);
      b.i32Sub();
      b.i32Load();
      b.setLocal("len_a");
      b.getLocal("b");
      b.i32Const(4);
      b.i32Sub();
      b.i32Load();
      b.setLocal("len_b");
      b.getLocal("len_a");
      b.getLocal("len_b");
      b.i32LtS();
      b.if_("void");
      b.getLocal("len_a");
      b.setLocal("min_len");
      b.else_();
      b.getLocal("len_b");
      b.setLocal("min_len");
      b.end();
      b.i32Const(0);
      b.setLocal("i");
      b.block("void", "str_cmp_done");
      b.loop("void", "str_cmp_loop");
      b.getLocal("i");
      b.getLocal("min_len");
      b.i32GeS();
      b.brIfTo("str_cmp_done");
      b.getLocal("a");
      b.getLocal("i");
      b.i32Add();
      b.i32Load8U();
      b.setLocal("ca");
      b.getLocal("b");
      b.getLocal("i");
      b.i32Add();
      b.i32Load8U();
      b.setLocal("cb");
      b.getLocal("ca");
      b.getLocal("cb");
      b.i32Ne();
      b.if_("void");
      b.getLocal("ca");
      b.getLocal("cb");
      b.i32Sub();
      b.return_();
      b.end();
      b.getLocal("i");
      b.i32Const(1);
      b.i32Add();
      b.setLocal("i");
      b.brTo("str_cmp_loop");
      b.end();
      b.end();
      b.getLocal("len_a");
      b.getLocal("len_b");
      b.i32Sub();
    }, ["a", "b"]);
    m.addFunction("str_concat", ["i32", "i32"], "i32", (b) => {
      b.addLocal("len_a", "i32");
      b.addLocal("len_b", "i32");
      b.addLocal("buf", "i32");
      b.getLocal("a");
      b.i32Const(4);
      b.i32Sub();
      b.i32Load();
      b.setLocal("len_a");
      b.getLocal("b");
      b.i32Const(4);
      b.i32Sub();
      b.i32Load();
      b.setLocal("len_b");
      b.getLocal("len_a");
      b.getLocal("len_b");
      b.i32Add();
      b.i32Const(4);
      b.i32Add();
      b.callByName(RT_ALLOC);
      b.setLocal("buf");
      b.getLocal("buf");
      b.getLocal("len_a");
      b.getLocal("len_b");
      b.i32Add();
      b.i32Store();
      b.getLocal("buf");
      b.i32Const(4);
      b.i32Add();
      b.getLocal("a");
      b.getLocal("len_a");
      b.callByName("memcpy");
      b.getLocal("buf");
      b.i32Const(4);
      b.i32Add();
      b.getLocal("len_a");
      b.i32Add();
      b.getLocal("b");
      b.getLocal("len_b");
      b.callByName("memcpy");
      b.getLocal("buf");
      b.i32Const(4);
      b.i32Add();
    }, ["a", "b"]);
  }
  compileStatement(stmt, b, topLevel = false) {
    const ec = new ExpressionCompiler(b, this.modular, this.envFunctions, this.zeroCaptureClosures);
    switch (stmt.kind) {
      case "function_def":
        this.compileFunction(stmt);
        break;
      case "import_decl":
      case "struct_def":
      case "type_alias":
        break;
      case "const_decl":
      case "var_decl": {
        const v = stmt;
        if (topLevel && v.isGlobal) {
          const wt = semanticToWasmType(v.type);
          let init = null;
          let deferred = false;
          if (!v.initExpr) {
            init = isNullablePointerType(v.type) ? -1 : wt === "i64" ? 0n : 0;
          } else if (v.initExpr.kind === "const" || v.initExpr.kind === "bool") {
            init = v.initExpr.value;
            if (typeof init === "boolean")
              init = init ? 1 : 0;
          } else {
            init = wt === "i64" ? 0n : 0;
            deferred = true;
          }
          this.modular.addGlobal(v.name, wt, true, init);
          if (deferred) {
            const t = ec.compile(v.initExpr);
            if (t === "void")
              throw new Error(`Global '${v.name}' inicializada con void`);
            if (!typesEqual(t, v.type))
              handleImplicitConversion(b, v.initExpr, t, v.type);
            b.globalSet(v.name);
          }
          break;
        }
        const unique = v.uniqueName ?? v.name;
        if (v.boxed) {
          b.addLocal(unique, "i32");
          b.i32Const(sizeOfType(v.type));
          b.callByName(RT_ALLOC);
          b.setLocal(unique);
          if (v.initExpr) {
            const t = ec.compile(v.initExpr);
            if (t === "void")
              throw new Error(`No se puede inicializar '${v.name}' con void`);
            if (!typesEqual(t, v.type))
              handleImplicitConversion(b, v.initExpr, t, v.type);
          } else {
            this.emitZero(b, v.type);
          }
          const tmp = `$box_init_${this.ctr++}`;
          b.addLocal(tmp, semanticToWasmType(v.type));
          b.setLocal(tmp);
          b.getLocal(unique);
          b.getLocal(tmp);
          emitStoreForType(b, v.type, 0);
        } else {
          b.addLocal(unique, semanticToWasmType(v.type));
          if (v.initExpr) {
            const t = ec.compile(v.initExpr);
            if (t === "void")
              throw new Error(`No se puede inicializar '${v.name}' con void`);
            if (!typesEqual(t, v.type))
              handleImplicitConversion(b, v.initExpr, t, v.type);
          } else
            this.emitZero(b, v.type);
          b.setLocal(unique);
        }
        break;
      }
      case "short_var_decl": {
        const v = stmt;
        const unique = v.uniqueName ?? v.name;
        if (v.boxed) {
          const t = ec.compile(v.expr);
          if (t === "void")
            throw new Error("No se puede inferir var desde void");
          const tmp = `$box_init_${this.ctr++}`;
          b.addLocal(tmp, semanticToWasmType(t));
          b.setLocal(tmp);
          b.addLocal(unique, "i32");
          b.i32Const(sizeOfType(t));
          b.callByName(RT_ALLOC);
          b.setLocal(unique);
          b.getLocal(unique);
          b.getLocal(tmp);
          emitStoreForType(b, t, 0);
        } else {
          const t = ec.compile(v.expr);
          if (t === "void")
            throw new Error("No se puede inferir var desde void");
          b.addLocal(unique, semanticToWasmType(t));
          b.setLocal(unique);
        }
        break;
      }
      case "multi_decl": {
        const md = stmt;
        const returnTypes = md.expr.returnTypes;
        if (!returnTypes || !md.uniqueNames || md.uniqueNames.length !== returnTypes.length) {
          throw new Error("multi_decl sin resolver (semantic no rellenó uniqueNames/returnTypes)");
        }
        for (let i = 0;i < md.uniqueNames.length; i++) {
          const un = md.uniqueNames[i];
          if (un !== null) {
            b.addLocal(un, semanticToWasmType(returnTypes[i]));
          }
        }
        ec.compile(md.expr);
        for (let i = md.uniqueNames.length - 1;i >= 0; i--) {
          const un = md.uniqueNames[i];
          if (un === null) {
            b.drop();
          } else {
            b.setLocal(un);
          }
        }
        break;
      }
      case "assign":
        this.compileAssignment(stmt, b, ec);
        break;
      case "return": {
        const r = stmt;
        for (const v of r.values)
          ec.compile(v);
        for (let i = this._regionStack.length - 1;i >= 0; i--) {
          b.getLocal(this._regionStack[i]);
          b.callByName(RT_RESTORE);
        }
        b.return_();
        break;
      }
      case "expression_stmt": {
        const e = stmt;
        if (e.expr.kind === "increment") {
          ec.compileIncrementAsStatement(e.expr);
          break;
        }
        const t = ec.compile(e.expr);
        if (t !== "void")
          b.drop();
        break;
      }
      case "if": {
        const i = stmt;
        ec.compile(i.condition);
        b.if_("void");
        for (const s of i.thenBlock)
          this.compileStatement(s, b);
        if (i.elseBlock) {
          b.else_();
          if (Array.isArray(i.elseBlock))
            for (const s of i.elseBlock)
              this.compileStatement(s, b);
          else
            this.compileStatement(i.elseBlock, b);
        }
        b.end();
        break;
      }
      case "for": {
        const f = stmt;
        if (f.init)
          this.compileStatement(f.init, b);
        const exitLabel = `$for_exit_${this.ctr}`;
        const topLabel = `$for_top_${this.ctr}`;
        const contLabel = `$for_cont_${this.ctr}`;
        this.ctr++;
        b.block("void", exitLabel);
        b.loop("void", topLabel);
        if (f.condition) {
          ec.compile(f.condition);
          b.i32Eqz();
          b.brIfTo(exitLabel);
        }
        b.block("void", contLabel);
        this._labelStack.push({ breakLabel: exitLabel, continueLabel: contLabel, name: f.label ?? null });
        for (const s of f.body)
          this.compileStatement(s, b);
        this._labelStack.pop();
        b.end();
        if (f.post)
          this.compileStatement(f.post, b);
        b.brTo(topLabel);
        b.end();
        b.end();
        break;
      }
      case "for_in": {
        const fi = stmt;
        const iterableType = fi.iterable.type;
        if (typeof iterableType !== "object" || iterableType.kind !== "array" && iterableType.kind !== "dynarray") {
          throw new Error("for_in sobre no-array");
        }
        const arrTemp = `$forin_arr_${this.ctr++}`;
        b.addLocal(arrTemp, "i32");
        ec.compile(fi.iterable);
        b.setLocal(arrTemp);
        const lenTemp = `$forin_len_${this.ctr++}`;
        b.addLocal(lenTemp, "i32");
        if (iterableType.kind === "dynarray") {
          b.getLocal(arrTemp);
          b.i32Const(4);
          b.i32Sub();
          b.i32Load();
          b.setLocal(lenTemp);
        } else {
          b.i32Const(iterableType.length);
          b.setLocal(lenTemp);
        }
        const idxTemp = `$forin_idx_${this.ctr++}`;
        b.addLocal(idxTemp, "i32");
        b.i32Const(0);
        b.setLocal(idxTemp);
        const indexUnique = fi.indexUnique;
        const valueUnique = fi.valueUnique;
        const elemType = iterableType.elementType;
        if (indexUnique != null)
          b.addLocal(indexUnique, "i32");
        if (valueUnique != null)
          b.addLocal(valueUnique, semanticToWasmType(elemType));
        const exitLabel = `$forin_exit_${this.ctr}`;
        const topLabel = `$forin_top_${this.ctr}`;
        const contLabel = `$forin_cont_${this.ctr}`;
        this.ctr++;
        b.block("void", exitLabel);
        b.loop("void", topLabel);
        b.getLocal(idxTemp);
        b.getLocal(lenTemp);
        b.i32GeS();
        b.brIfTo(exitLabel);
        if (indexUnique != null) {
          b.getLocal(idxTemp);
          b.setLocal(indexUnique);
        }
        if (valueUnique != null) {
          const es = sizeOfType(elemType);
          b.getLocal(arrTemp);
          b.getLocal(idxTemp);
          b.i32Const(es);
          b.i32Mul();
          b.i32Add();
          if (isInlineValue(elemType))
            b.setLocal(valueUnique);
          else {
            emitLoadForType(b, elemType);
            b.setLocal(valueUnique);
          }
        }
        b.block("void", contLabel);
        this._labelStack.push({ breakLabel: exitLabel, continueLabel: contLabel, name: fi.label ?? null });
        for (const s of fi.body)
          this.compileStatement(s, b);
        this._labelStack.pop();
        b.end();
        b.getLocal(idxTemp);
        b.i32Const(1);
        b.i32Add();
        b.setLocal(idxTemp);
        b.brTo(topLabel);
        b.end();
        b.end();
        break;
      }
      case "switch": {
        const s = stmt;
        const exprType = s.exprType;
        if (!exprType) {
          throw new Error("switch sin tipo resuelto (semantic no seteó exprType)");
        }
        if (s.cases.length === 0) {
          if (s.defaultBody)
            for (const st of s.defaultBody)
              this.compileStatement(st, b);
          break;
        }
        const tmp = `$switch_${this.ctr++}`;
        b.addLocal(tmp, semanticToWasmType(exprType));
        ec.compile(s.expr);
        b.setLocal(tmp);
        let depth = 0;
        for (let i = 0;i < s.cases.length; i++) {
          const c = s.cases[i];
          if (i > 0)
            b.else_();
          for (let j = 0;j < c.patterns.length; j++) {
            b.getLocal(tmp);
            ec.emitPatternMatchOnStack(c.patterns[j], exprType);
            if (j > 0)
              b.i32Or();
          }
          b.if_("void");
          depth++;
          for (const st of c.body)
            this.compileStatement(st, b);
        }
        if (s.defaultBody) {
          b.else_();
          for (const st of s.defaultBody)
            this.compileStatement(st, b);
        }
        for (let i = 0;i < depth; i++)
          b.end();
        break;
      }
      case "region": {
        const r = stmt;
        const mark = `$region_mark_${this.ctr++}`;
        b.addLocal(mark, "i32");
        b.callByName(RT_SAVE);
        b.setLocal(mark);
        this._regionStack.push(mark);
        try {
          for (const s of r.body)
            this.compileStatement(s, b);
        } finally {
          this._regionStack.pop();
        }
        b.getLocal(mark);
        b.callByName(RT_RESTORE);
        break;
      }
      case "break": {
        const bk = stmt;
        const name = bk.label ?? null;
        let ctx = null;
        if (name !== null) {
          for (let i = this._labelStack.length - 1;i >= 0; i--) {
            if (this._labelStack[i].name === name) {
              ctx = this._labelStack[i];
              break;
            }
          }
          if (!ctx)
            throw new Error(`break: etiqueta '${name}' no encontrada`);
        } else {
          ctx = this._labelStack[this._labelStack.length - 1] ?? null;
          if (!ctx)
            throw new Error("break fuera de bucle");
        }
        b.brTo(ctx.breakLabel);
        break;
      }
      case "continue": {
        const ct = stmt;
        const name = ct.label ?? null;
        let ctx = null;
        if (name !== null) {
          for (let i = this._labelStack.length - 1;i >= 0; i--) {
            const e = this._labelStack[i];
            if (e.name === name && e.continueLabel) {
              ctx = e;
              break;
            }
          }
          if (!ctx)
            throw new Error(`continue: etiqueta '${name}' no encontrada`);
        } else {
          for (let i = this._labelStack.length - 1;i >= 0; i--) {
            if (this._labelStack[i].continueLabel) {
              ctx = this._labelStack[i];
              break;
            }
          }
          if (!ctx)
            throw new Error("continue fuera de bucle");
        }
        b.brTo(ctx.continueLabel);
        break;
      }
      default:
        throw new Error(`Sentencia no soportada en codegen: ${stmt.kind}`);
    }
  }
  compileAssignment(a, b, ec) {
    if (a.target.kind === "variable") {
      const v = a.target;
      const t = ec.compile(a.expr);
      if (t === "void")
        throw new Error("No se puede asignar void");
      if (!typesEqual(t, v.type))
        handleImplicitConversion(b, a.expr, t, v.type);
      if (v.boxed) {
        const tmp = `$asg_box_${this.ctr++}`;
        b.addLocal(tmp, semanticToWasmType(v.type));
        b.setLocal(tmp);
        if (v.isGlobal)
          b.globalGet(v.name);
        else
          b.getLocal(v.uniqueName ?? v.name);
        b.getLocal(tmp);
        emitStoreForType(b, v.type, 0);
        return;
      }
      if (v.isGlobal)
        b.globalSet(v.name);
      else
        b.setLocal(v.uniqueName ?? v.name);
      return;
    }
    if (a.target.kind === "capture_access") {
      const ca = a.target;
      const t = ec.compile(a.expr);
      if (t === "void")
        throw new Error("No se puede asignar void");
      if (!typesEqual(t, ca.type))
        handleImplicitConversion(b, a.expr, t, ca.type);
      const vtmp = `$asg_v_${this.ctr++}`;
      b.addLocal(vtmp, semanticToWasmType(ca.type));
      b.setLocal(vtmp);
      b.getLocal("__env");
      b.i32Load(4 + 4 * ca.captureIndex);
      b.getLocal(vtmp);
      emitStoreForType(b, ca.type, 0);
      return;
    }
    const { addrLocal, targetType } = this.resolveLValueAddr(a.target, b, ec);
    const vt = ec.compile(a.expr);
    if (vt === "void")
      throw new Error("No se puede asignar void");
    if (!typesEqual(vt, targetType))
      handleImplicitConversion(b, a.expr, vt, targetType);
    const vtmp = `$asg_v_${this.ctr++}`;
    b.addLocal(vtmp, semanticToWasmType(targetType));
    b.setLocal(vtmp);
    b.getLocal(addrLocal);
    b.getLocal(vtmp);
    emitStoreForType(b, targetType);
  }
  resolveLValueAddr(target, b, ec) {
    if (target.kind === "variable") {
      const v = target;
      const addr = `$addr_${this.ctr++}`;
      b.addLocal(addr, "i32");
      if (v.isGlobal)
        b.globalGet(v.name);
      else
        b.getLocal(v.uniqueName ?? v.name);
      b.setLocal(addr);
      return { addrLocal: addr, targetType: v.type };
    }
    if (target.kind === "struct_access") {
      const sa = target;
      const baseValueType = sa.base.type;
      const baseTy = sa.resolvedBaseType ?? getStructType(baseValueType);
      if (!baseTy)
        throw new Error("struct_access LValue sobre no-struct");
      const field = baseTy.fields.find((f) => f.name === sa.fieldName);
      if (!field)
        throw new Error(`Campo '${sa.fieldName}' no existe en '${baseTy.name}'`);
      const baseAddr = `$addr_${this.ctr++}`;
      b.addLocal(baseAddr, "i32");
      ec.compile(sa.base);
      b.setLocal(baseAddr);
      if (isNullablePointerType(baseValueType)) {
        b.getLocal(baseAddr);
        b.i32Const(-1);
        b.i32Eq();
        b.if_("void");
        b.unreachable();
        b.end();
      }
      const addr = `$addr_${this.ctr++}`;
      b.addLocal(addr, "i32");
      b.getLocal(baseAddr);
      b.i32Const(field.offset);
      b.i32Add();
      b.setLocal(addr);
      return { addrLocal: addr, targetType: field.type };
    }
    if (target.kind === "array_access") {
      const aa = target;
      const bt = aa.base.type;
      if (typeof bt !== "object" || bt.kind !== "array" && bt.kind !== "dynarray") {
        throw new Error("array_access LValue sobre no-array");
      }
      const { addrLocal: baseAddr } = this.resolveLValueAddr(aa.base, b, ec);
      const idx = `$idx_${this.ctr++}`;
      b.addLocal(idx, "i32");
      const it = ec.compile(aa.index);
      if (it !== "s32" && it !== "u32")
        throw new Error("índice no entero");
      b.setLocal(idx);
      const addr = `$addr_${this.ctr++}`;
      b.addLocal(addr, "i32");
      b.getLocal(baseAddr);
      b.getLocal(idx);
      b.i32Const(sizeOfType(bt.elementType));
      b.i32Mul();
      b.i32Add();
      b.setLocal(addr);
      return { addrLocal: addr, targetType: bt.elementType };
    }
    if (target.kind === "capture_access") {
      const addr = `$addr_${this.ctr++}`;
      b.addLocal(addr, "i32");
      ec.compile(target);
      b.setLocal(addr);
      return { addrLocal: addr, targetType: target.type };
    }
    throw new Error(`LValue no soportado: ${target.kind}`);
  }
  compileFunction(fn) {
    const isLambda = fn.name.startsWith("__lambda_");
    const needsEnv = isLambda || this.envFunctions.has(fn.name);
    const userParamWasm = fn.params.map((p) => semanticToWasmType(p.type));
    const paramWasm = needsEnv ? ["i32", ...userParamWasm] : userParamWasm;
    const userParamNames = fn.params.map((p) => p.uniqueName ?? p.name);
    const paramNames = needsEnv ? ["__env", ...userParamNames] : userParamNames;
    const returnWasm = fn.returnTypes.map((t) => semanticToWasmType(t));
    const wasmName = fn.name;
    const prevRegionStack = this._regionStack;
    this._regionStack = [];
    try {
      this.modular.addFunction(wasmName, paramWasm, returnWasm, (fb) => {
        for (let i = 0;i < paramNames.length; i++)
          fb.setParamName(i, paramNames[i]);
        for (const p of fn.params) {
          if (p.boxed) {
            const uniqueName = p.uniqueName ?? p.name;
            fb.i32Const(sizeOfType(p.type));
            fb.callByName(RT_ALLOC);
            const tmp = `$box_param_${uniqueName}`;
            fb.addLocal(tmp, "i32");
            fb.setLocal(tmp);
            fb.getLocal(tmp);
            fb.getLocal(uniqueName);
            emitStoreForType(fb, p.type, 0);
            fb.getLocal(tmp);
            fb.setLocal(uniqueName);
          }
        }
        for (const s of fn.body)
          this.compileStatement(s, fb);
        if (returnWasm.length > 0) {
          fb.unreachable();
        }
      }, paramNames);
    } finally {
      this._regionStack = prevRegionStack;
    }
  }
  emitZero(b, t) {
    if (typeof t !== "string") {
      b.i32Const(isNullablePointerType(t) ? -1 : 0);
      return;
    }
    switch (t) {
      case "s32":
      case "u32":
      case "bool":
      case "string":
        b.i32Const(0);
        break;
      case "s64":
      case "u64":
        b.i64Const(0n);
        break;
      case "f32":
        b.f32Const(0);
        break;
      case "f64":
        b.f64Const(0);
        break;
      default:
        b.i32Const(0);
    }
  }
}

// node:path
function assertPath(path) {
  if (typeof path !== "string")
    throw TypeError("Path must be a string. Received " + JSON.stringify(path));
}
function normalizeStringPosix(path, allowAboveRoot) {
  var res = "", lastSegmentLength = 0, lastSlash = -1, dots = 0, code;
  for (var i = 0;i <= path.length; ++i) {
    if (i < path.length)
      code = path.charCodeAt(i);
    else if (code === 47)
      break;
    else
      code = 47;
    if (code === 47) {
      if (lastSlash === i - 1 || dots === 1)
        ;
      else if (lastSlash !== i - 1 && dots === 2) {
        if (res.length < 2 || lastSegmentLength !== 2 || res.charCodeAt(res.length - 1) !== 46 || res.charCodeAt(res.length - 2) !== 46) {
          if (res.length > 2) {
            var lastSlashIndex = res.lastIndexOf("/");
            if (lastSlashIndex !== res.length - 1) {
              if (lastSlashIndex === -1)
                res = "", lastSegmentLength = 0;
              else
                res = res.slice(0, lastSlashIndex), lastSegmentLength = res.length - 1 - res.lastIndexOf("/");
              lastSlash = i, dots = 0;
              continue;
            }
          } else if (res.length === 2 || res.length === 1) {
            res = "", lastSegmentLength = 0, lastSlash = i, dots = 0;
            continue;
          }
        }
        if (allowAboveRoot) {
          if (res.length > 0)
            res += "/..";
          else
            res = "..";
          lastSegmentLength = 2;
        }
      } else {
        if (res.length > 0)
          res += "/" + path.slice(lastSlash + 1, i);
        else
          res = path.slice(lastSlash + 1, i);
        lastSegmentLength = i - lastSlash - 1;
      }
      lastSlash = i, dots = 0;
    } else if (code === 46 && dots !== -1)
      ++dots;
    else
      dots = -1;
  }
  return res;
}
function _format(sep, pathObject) {
  var dir = pathObject.dir || pathObject.root, base = pathObject.base || (pathObject.name || "") + (pathObject.ext || "");
  if (!dir)
    return base;
  if (dir === pathObject.root)
    return dir + base;
  return dir + sep + base;
}
function resolve() {
  var resolvedPath = "", resolvedAbsolute = false, cwd;
  for (var i = arguments.length - 1;i >= -1 && !resolvedAbsolute; i--) {
    var path;
    if (i >= 0)
      path = arguments[i];
    else {
      if (cwd === undefined)
        cwd = process.cwd();
      path = cwd;
    }
    if (assertPath(path), path.length === 0)
      continue;
    resolvedPath = path + "/" + resolvedPath, resolvedAbsolute = path.charCodeAt(0) === 47;
  }
  if (resolvedPath = normalizeStringPosix(resolvedPath, !resolvedAbsolute), resolvedAbsolute)
    if (resolvedPath.length > 0)
      return "/" + resolvedPath;
    else
      return "/";
  else if (resolvedPath.length > 0)
    return resolvedPath;
  else
    return ".";
}
function normalize(path) {
  if (assertPath(path), path.length === 0)
    return ".";
  var isAbsolute = path.charCodeAt(0) === 47, trailingSeparator = path.charCodeAt(path.length - 1) === 47;
  if (path = normalizeStringPosix(path, !isAbsolute), path.length === 0 && !isAbsolute)
    path = ".";
  if (path.length > 0 && trailingSeparator)
    path += "/";
  if (isAbsolute)
    return "/" + path;
  return path;
}
function isAbsolute(path) {
  return assertPath(path), path.length > 0 && path.charCodeAt(0) === 47;
}
function join() {
  if (arguments.length === 0)
    return ".";
  var joined;
  for (var i = 0;i < arguments.length; ++i) {
    var arg = arguments[i];
    if (assertPath(arg), arg.length > 0)
      if (joined === undefined)
        joined = arg;
      else
        joined += "/" + arg;
  }
  if (joined === undefined)
    return ".";
  return normalize(joined);
}
function relative(from, to) {
  if (assertPath(from), assertPath(to), from === to)
    return "";
  if (from = resolve(from), to = resolve(to), from === to)
    return "";
  var fromStart = 1;
  for (;fromStart < from.length; ++fromStart)
    if (from.charCodeAt(fromStart) !== 47)
      break;
  var fromEnd = from.length, fromLen = fromEnd - fromStart, toStart = 1;
  for (;toStart < to.length; ++toStart)
    if (to.charCodeAt(toStart) !== 47)
      break;
  var toEnd = to.length, toLen = toEnd - toStart, length = fromLen < toLen ? fromLen : toLen, lastCommonSep = -1, i = 0;
  for (;i <= length; ++i) {
    if (i === length) {
      if (toLen > length) {
        if (to.charCodeAt(toStart + i) === 47)
          return to.slice(toStart + i + 1);
        else if (i === 0)
          return to.slice(toStart + i);
      } else if (fromLen > length) {
        if (from.charCodeAt(fromStart + i) === 47)
          lastCommonSep = i;
        else if (i === 0)
          lastCommonSep = 0;
      }
      break;
    }
    var fromCode = from.charCodeAt(fromStart + i), toCode = to.charCodeAt(toStart + i);
    if (fromCode !== toCode)
      break;
    else if (fromCode === 47)
      lastCommonSep = i;
  }
  var out = "";
  for (i = fromStart + lastCommonSep + 1;i <= fromEnd; ++i)
    if (i === fromEnd || from.charCodeAt(i) === 47)
      if (out.length === 0)
        out += "..";
      else
        out += "/..";
  if (out.length > 0)
    return out + to.slice(toStart + lastCommonSep);
  else {
    if (toStart += lastCommonSep, to.charCodeAt(toStart) === 47)
      ++toStart;
    return to.slice(toStart);
  }
}
function _makeLong(path) {
  return path;
}
function dirname(path) {
  if (assertPath(path), path.length === 0)
    return ".";
  var code = path.charCodeAt(0), hasRoot = code === 47, end = -1, matchedSlash = true;
  for (var i = path.length - 1;i >= 1; --i)
    if (code = path.charCodeAt(i), code === 47) {
      if (!matchedSlash) {
        end = i;
        break;
      }
    } else
      matchedSlash = false;
  if (end === -1)
    return hasRoot ? "/" : ".";
  if (hasRoot && end === 1)
    return "//";
  return path.slice(0, end);
}
function basename(path, ext) {
  if (ext !== undefined && typeof ext !== "string")
    throw TypeError('"ext" argument must be a string');
  assertPath(path);
  var start = 0, end = -1, matchedSlash = true, i;
  if (ext !== undefined && ext.length > 0 && ext.length <= path.length) {
    if (ext.length === path.length && ext === path)
      return "";
    var extIdx = ext.length - 1, firstNonSlashEnd = -1;
    for (i = path.length - 1;i >= 0; --i) {
      var code = path.charCodeAt(i);
      if (code === 47) {
        if (!matchedSlash) {
          start = i + 1;
          break;
        }
      } else {
        if (firstNonSlashEnd === -1)
          matchedSlash = false, firstNonSlashEnd = i + 1;
        if (extIdx >= 0)
          if (code === ext.charCodeAt(extIdx)) {
            if (--extIdx === -1)
              end = i;
          } else
            extIdx = -1, end = firstNonSlashEnd;
      }
    }
    if (start === end)
      end = firstNonSlashEnd;
    else if (end === -1)
      end = path.length;
    return path.slice(start, end);
  } else {
    for (i = path.length - 1;i >= 0; --i)
      if (path.charCodeAt(i) === 47) {
        if (!matchedSlash) {
          start = i + 1;
          break;
        }
      } else if (end === -1)
        matchedSlash = false, end = i + 1;
    if (end === -1)
      return "";
    return path.slice(start, end);
  }
}
function extname(path) {
  assertPath(path);
  var startDot = -1, startPart = 0, end = -1, matchedSlash = true, preDotState = 0;
  for (var i = path.length - 1;i >= 0; --i) {
    var code = path.charCodeAt(i);
    if (code === 47) {
      if (!matchedSlash) {
        startPart = i + 1;
        break;
      }
      continue;
    }
    if (end === -1)
      matchedSlash = false, end = i + 1;
    if (code === 46) {
      if (startDot === -1)
        startDot = i;
      else if (preDotState !== 1)
        preDotState = 1;
    } else if (startDot !== -1)
      preDotState = -1;
  }
  if (startDot === -1 || end === -1 || preDotState === 0 || preDotState === 1 && startDot === end - 1 && startDot === startPart + 1)
    return "";
  return path.slice(startDot, end);
}
function format(pathObject) {
  if (pathObject === null || typeof pathObject !== "object")
    throw TypeError('The "pathObject" argument must be of type Object. Received type ' + typeof pathObject);
  return _format("/", pathObject);
}
function parse(path) {
  assertPath(path);
  var ret = { root: "", dir: "", base: "", ext: "", name: "" };
  if (path.length === 0)
    return ret;
  var code = path.charCodeAt(0), isAbsolute2 = code === 47, start;
  if (isAbsolute2)
    ret.root = "/", start = 1;
  else
    start = 0;
  var startDot = -1, startPart = 0, end = -1, matchedSlash = true, i = path.length - 1, preDotState = 0;
  for (;i >= start; --i) {
    if (code = path.charCodeAt(i), code === 47) {
      if (!matchedSlash) {
        startPart = i + 1;
        break;
      }
      continue;
    }
    if (end === -1)
      matchedSlash = false, end = i + 1;
    if (code === 46) {
      if (startDot === -1)
        startDot = i;
      else if (preDotState !== 1)
        preDotState = 1;
    } else if (startDot !== -1)
      preDotState = -1;
  }
  if (startDot === -1 || end === -1 || preDotState === 0 || preDotState === 1 && startDot === end - 1 && startDot === startPart + 1) {
    if (end !== -1)
      if (startPart === 0 && isAbsolute2)
        ret.base = ret.name = path.slice(1, end);
      else
        ret.base = ret.name = path.slice(startPart, end);
  } else {
    if (startPart === 0 && isAbsolute2)
      ret.name = path.slice(1, startDot), ret.base = path.slice(1, end);
    else
      ret.name = path.slice(startPart, startDot), ret.base = path.slice(startPart, end);
    ret.ext = path.slice(startDot, end);
  }
  if (startPart > 0)
    ret.dir = path.slice(0, startPart - 1);
  else if (isAbsolute2)
    ret.dir = "/";
  return ret;
}
var sep = "/";
var delimiter = ":";
var posix = ((p) => (p.posix = p, p))({ resolve, normalize, isAbsolute, join, relative, _makeLong, dirname, basename, extname, format, parse, sep, delimiter, win32: null, posix: null });

// src/preprocessor.ts
async function preprocess(source, basePath, seen = new Set, inProgress = new Set) {
  const combinedRe = /(\/\*[\s\S]*?\*\/|\/\/.*)|(@include\s*\(\s*"([^"]+)"\s*\))/g;
  let result = "";
  let lastIndex = 0;
  let match;
  while ((match = combinedRe.exec(source)) !== null) {
    result += source.slice(lastIndex, match.index);
    if (match[1]) {
      result += match[0];
    } else if (match[2]) {
      const includePath = match[3];
      const fullPath = resolve(basePath, includePath);
      if (inProgress.has(fullPath)) {
        throw new Error(`@include circular detectado: "${includePath}" ` + `(resuelve a ${fullPath})`);
      }
      if (seen.has(fullPath)) {} else {
        inProgress.add(fullPath);
        const file = Bun.file(fullPath);
        if (!await file.exists()) {
          throw new Error(`@include: no se encontró el archivo "${includePath}" ` + `(resuelve a ${fullPath})`);
        }
        const content = await file.text();
        const expanded = await preprocess(content, dirname(fullPath), seen, inProgress);
        inProgress.delete(fullPath);
        seen.add(fullPath);
        result += expanded;
      }
    }
    lastIndex = combinedRe.lastIndex;
  }
  result += source.slice(lastIndex);
  return result;
}

// src/run.ts
async function compile(inputPath) {
  const raw = await Bun.file(inputPath).text();
  const basePath = dirname(resolve(inputPath));
  const source = await preprocess(raw, basePath);
  const ast = new Parser(new Lexer(source)).parseProgram();
  new SemanticAnalyzer().analyzeProgram(ast);
  const opt = new Optimizer().optimizeProgram(ast);
  return new CodeGenerator(opt.body).build();
}
async function loadWASI() {
  try {
    const bun = await import("bun");
    if (typeof bun.WASI === "function")
      return bun.WASI;
  } catch {}
  try {
    const nodeWasi = await import("node:wasi");
    if (typeof nodeWasi.WASI === "function")
      return nodeWasi.WASI;
  } catch {}
  return null;
}
async function run() {
  const cliArg = process.argv[2];
  if (!cliArg) {
    console.error("Uso: bun run.ts <archivo.cyn> [salida.wasm]");
    process.exit(1);
  }
  const inputPath = resolve(cliArg);
  if (!await Bun.file(inputPath).exists()) {
    console.error(`Archivo no encontrado: ${inputPath}`);
    process.exit(1);
  }
  console.log(`▶ Compilando ${inputPath}`);
  const wasmBytes = await compile(inputPath);
  console.log(`  WASM generado: ${wasmBytes.length} bytes
`);
  const outputArg = process.argv[3];
  if (outputArg) {
    await Bun.write(outputArg, wasmBytes);
    console.log(`  Escrito ${outputArg}`);
    return;
  }
  const WASIClass = await loadWASI();
  if (!WASIClass) {
    console.error(`No se pudo cargar WASI (ni desde bun ni desde node:wasi).
` + `Compilá a un archivo y ejecutalo con wasmtime:
` + `  bun src/run.ts ${cliArg} out.wasm && wasmtime out.wasm`);
    process.exit(1);
  }
  const wasi = new WASIClass({ args: [], env: {} });
  const imports = wasi.wasiImport ?? wasi.exports;
  const instantiated = await WebAssembly.instantiate(wasmBytes, {
    wasi_snapshot_preview1: imports
  });
  const instance = instantiated.instance ?? instantiated;
  wasi.start(instance);
}
run().catch((err) => {
  if (err instanceof Error) {
    console.error("Error:", err.message);
  } else {
    console.error("Error:", err);
  }
  process.exit(1);
});
