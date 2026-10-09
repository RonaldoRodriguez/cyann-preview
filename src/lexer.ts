import { SourceLocation, SourceMap } from './sourceMap';

export type TokenType =
  | 'KEYWORD' | 'IDENTIFIER' | 'NUMBER' | 'STRING' | 'TEMPLATE'
  | 'BOOLEAN' | 'SYMBOL' | 'EOF';

export interface Token {
  type: TokenType;
  value: string;
  line: number;
  column: number;
  filePath: string;
  terminated?: boolean;
}

export class Lexer {
  private source: string;
  private index = 0;
  private line = 1;
  private column = 1;

  constructor(source: string, private readonly sourceMap?: SourceMap) { this.source = source; }

  private token(type: TokenType, value: string, index: number, line: number, column: number): Token {
    const location: SourceLocation = this.sourceMap?.locationAt(index) ?? {
      filePath: '<source>',
      line,
      column,
    };
    return { type, value, ...location };
  }

  public getPosition() { return { line: this.line, column: this.column, index: this.index }; }

  public saveState() { return { index: this.index, line: this.line, column: this.column }; }
  public restoreState(s: { index: number; line: number; column: number }) {
    this.index = s.index; this.line = s.line; this.column = s.column;
  }

  private isEOF() { return this.index >= this.source.length; }
  private peekChar() { return this.source[this.index] || ''; }

  private nextChar(): string {
    const ch = this.source[this.index++];
    if (ch === '\n') { this.line++; this.column = 1; } else { this.column++; }
    return ch;
  }

  private skipTrivia(): void {
    while (!this.isEOF()) {
      const ch = this.peekChar();
      if (/\s/.test(ch)) { this.nextChar(); continue; }
      if (ch === '/' && this.source[this.index + 1] === '/') {
        while (!this.isEOF() && this.peekChar() !== '\n') this.nextChar();
        continue;
      }
      if (ch === '/' && this.source[this.index + 1] === '*') {
        this.index += 2;
        while (!this.isEOF() && !(this.peekChar() === '*' && this.source[this.index + 1] === '/')) this.nextChar();
        if (!this.isEOF()) this.index += 2;
        continue;
      }
      break;
    }
  }

  public nextToken(): Token {
    this.skipTrivia();
    if (this.isEOF()) {
      return this.token('EOF', '', this.index, this.line, this.column);
    }

    const startIndex = this.index;
    const startLine = this.line, startColumn = this.column;
    const ch = this.peekChar();

    if (ch === '$' && this.source[this.index + 1] === '"') {
      this.nextChar();
      this.nextChar();
      let value = '';
      let terminated = false;
      while (!this.isEOF() && this.peekChar() !== '"') {
        if (this.peekChar() === '\\') {
          this.nextChar();
          const esc = this.nextChar();
          switch (esc) {
            case 'n': value += '\n'; break;
            case 't': value += '\t'; break;
            case 'r': value += '\r'; break;
            case '0': value += '\0'; break;
            default: value += esc; break;
          }
        } else value += this.nextChar();
      }
      if (this.peekChar() === '"') {
        this.nextChar();
        terminated = true;
      }
      return { ...this.token('TEMPLATE', value, startIndex, startLine, startColumn), terminated };
    }

    // Strings
    if (ch === '"' || ch === "'") {
      const quote = this.nextChar();
      let val = '';
      while (!this.isEOF() && this.peekChar() !== quote) {
        if (this.peekChar() === '\\') {
          this.nextChar();
          const esc = this.nextChar();
          switch (esc) {
            case 'n': val += '\n'; break;
            case 't': val += '\t'; break;
            case 'r': val += '\r'; break;
            case '0': val += '\0'; break;
            default: val += esc; break;
          }
        } else val += this.nextChar();
      }
      if (this.peekChar() === quote) this.nextChar();
      return this.token('STRING', val, startIndex, startLine, startColumn);
    }

    // Números
        // Números
    // Nota: NO aceptamos `+N` o `-N` como literal con signo. La regla
    // anterior rompía expresiones sin espacios como `x+1` o `(0+1)`.
    // El parser maneja el `-` unario y el optimizador pliega constantes.
    if (/\d/.test(ch)) {
      let raw = this.nextChar();
      while (!this.isEOF() && /[0-9a-fA-F._xXbBuUlLfL]/.test(this.peekChar())) raw += this.nextChar();
      return this.token('NUMBER', raw, startIndex, startLine, startColumn);
    }

    // Identificadores / keywords
    if (/[a-zA-Z_$]/.test(ch)) {
      let id = '';
      while (!this.isEOF() && /[a-zA-Z0-9_$]/.test(this.peekChar())) id += this.nextChar();
      if (id === 'true' || id === 'false') return this.token('BOOLEAN', id, startIndex, startLine, startColumn);

      // ── Lista reducida: solo lo que el parser realmente consume.
      const keywords = [
        'func', 'var', 'const', 'type', 'struct',
        'if', 'else', 'switch', 'case', 'default',
        'for', 'in', 'break', 'continue', 'return',
        'as', 'make', 'null', 'host', 'region',
        'import', 'export', 'size_of'

      ];
      if (keywords.includes(id)) return this.token('KEYWORD', id, startIndex, startLine, startColumn);
      return this.token('IDENTIFIER', id, startIndex, startLine, startColumn);
    }

    // Símbolos multi-carácter
    const twoChar = this.source.slice(this.index, this.index + 2);
    const doubleOps = ['==', '!=', '<=', '>=', '&&', '||', '<<', '>>', '->', ':='];
    if (doubleOps.includes(twoChar)) {
      this.nextChar(); this.nextChar();
      return this.token('SYMBOL', twoChar, startIndex, startLine, startColumn);
    }
    for (const op of ['++', '--']) {
      if (this.source.startsWith(op, this.index)) {
        this.nextChar(); this.nextChar();
        return this.token('SYMBOL', op, startIndex, startLine, startColumn);
      }
    }

    return this.token('SYMBOL', this.nextChar(), startIndex, startLine, startColumn);
  }
}

