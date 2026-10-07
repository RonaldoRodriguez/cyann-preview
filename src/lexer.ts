export type TokenType =
  | 'KEYWORD' | 'IDENTIFIER' | 'NUMBER' | 'STRING'
  | 'BOOLEAN' | 'SYMBOL' | 'EOF';

export interface Token {
  type: TokenType;
  value: string;
  line: number;
  column: number;
}

export class Lexer {
  private source: string;
  private index = 0;
  private line = 1;
  private column = 1;

  constructor(source: string) { this.source = source; }

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
    if (this.isEOF()) return { type: 'EOF', value: '', line: this.line, column: this.column };

    const startLine = this.line, startColumn = this.column;
    const ch = this.peekChar();

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
      return { type: 'STRING', value: val, line: startLine, column: startColumn };
    }

    // Números
        // Números
    // Nota: NO aceptamos `+N` o `-N` como literal con signo. La regla
    // anterior rompía expresiones sin espacios como `x+1` o `(0+1)`.
    // El parser maneja el `-` unario y el optimizador pliega constantes.
    if (/\d/.test(ch)) {
      let raw = this.nextChar();
      while (!this.isEOF() && /[0-9a-fA-F._xXbBuUlLfL]/.test(this.peekChar())) raw += this.nextChar();
      return { type: 'NUMBER', value: raw, line: startLine, column: startColumn };
    }

    // Identificadores / keywords
    if (/[a-zA-Z_$]/.test(ch)) {
      let id = '';
      while (!this.isEOF() && /[a-zA-Z0-9_$]/.test(this.peekChar())) id += this.nextChar();
      if (id === 'true' || id === 'false') return { type: 'BOOLEAN', value: id, line: startLine, column: startColumn };

      // ── Lista reducida: solo lo que el parser realmente consume.
      const keywords = [
        'func', 'var', 'const', 'type', 'struct',
        'if', 'else', 'switch', 'case', 'default',
        'for', 'in', 'break', 'continue', 'return',
        'as', 'make', 'null', 'host', 'region',
        'import'
      ];
      if (keywords.includes(id)) return { type: 'KEYWORD', value: id, line: startLine, column: startColumn };
      return { type: 'IDENTIFIER', value: id, line: startLine, column: startColumn };
    }

    // Símbolos multi-carácter
    const twoChar = this.source.slice(this.index, this.index + 2);
    const doubleOps = ['==', '!=', '<=', '>=', '&&', '||', '<<', '>>', '->', ':='];
    if (doubleOps.includes(twoChar)) {
      this.nextChar(); this.nextChar();
      return { type: 'SYMBOL', value: twoChar, line: startLine, column: startColumn };
    }
    for (const op of ['++', '--']) {
      if (this.source.startsWith(op, this.index)) {
        this.nextChar(); this.nextChar();
        return { type: 'SYMBOL', value: op, line: startLine, column: startColumn };
      }
    }

    return { type: 'SYMBOL', value: this.nextChar(), line: startLine, column: startColumn };
  }
}
