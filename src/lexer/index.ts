import { Range } from 'vscode-languageserver-textdocument';
import {
  Token,
  TokenType,
  LexerState,
  LexerResult,
  LexerError,
  LexerErrorCode,
  LanguageContext,
} from '../types';

const EXPRESSION_CONTEXT_KEYWORDS = new Set(['if', 'else', 'foreach', 'forvalues', 'while', 'gen', 'generate', 'replace', 'egen', 'set', 'scalar', 'matrix', 'return']);
const COMMENT_CONTEXT_KEYWORDS = new Set(['program', 'capture', 'quietly', 'noisily', 'by', 'bysort']);
const MULTIPLICATION_CONTEXT_TYPES = new Set(['NUMBER', 'WORD', 'RPAREN', 'RBRACKET', 'RBRACE', 'MACRO_REF_LOCAL', 'MACRO_REF_GLOBAL', 'LPAREN']);
const ASSIGNMENT_OPERATORS = new Set(['=', '==', '!=', '<', '>', '<=', '>=']);

export class StataLexer {
  private source: string = '';
  private position: number = 0;
  private line: number = 0;
  private column: number = 0;
  private state: LexerState = {
    delimiterMode: 'cr',
    line: 0,
    column: 0,
  };
  private errors: LexerError[] = [];
  private line_offsets: number[] = [];

  private previous_token: Token | null = null;

  tokenize(source: string, initialState?: LexerState): LexerResult {
    this.source = source;
    this.position = 0;
    this.line = 0;
    this.column = 0;
    this.line_offsets = [0]; // First line starts at offset 0
    this.previous_token = null;
    this.state = initialState || {
      delimiterMode: 'cr',
      line: 0,
      column: 0,
      language_context: LanguageContext.STATA,
      context_stack: [LanguageContext.STATA],
    };

    const tokens: Token[] = [];
    this.errors = [];

    while (!this.isAtEnd()) {
      const startPos = this.position;
      const startLine = this.line;
      const startColumn = this.column;

      try {
        const result = this.scanToken();
        if (result) {
          if (Array.isArray(result)) {
            for (const my_token of result) {
              tokens.push(my_token);
              if (my_token.type !== 'WHITESPACE') {
                this.previous_token = my_token;
              }
              // Reset continuation state when we see actual code (not continuation, whitespace, or newline)
              if (my_token.type !== 'CONTINUATION' && 
                  my_token.type !== 'WHITESPACE' && 
                  my_token.type !== 'STATEMENT_TERMINATOR') {
                this.state.in_continuation = false;
              }
            }
          } else {
            tokens.push(result);
            if (result.type !== 'WHITESPACE') {
              this.previous_token = result;
            }
            // Reset continuation state when we see actual code (not continuation, whitespace, or newline)
            if (result.type !== 'CONTINUATION' && 
                result.type !== 'WHITESPACE' && 
                result.type !== 'STATEMENT_TERMINATOR') {
              this.state.in_continuation = false;
            }
          }
        }
      } catch (error) {
        const lexerError: LexerError = {
          message: `Unexpected lexer error: ${error}`,
          range: this.makeRange(startLine, startColumn, this.line, this.column),
          code: LexerErrorCode.UNBALANCED_QUOTES,
        };
        this.errors.push(lexerError);
        // Skip the problematic character and continue
        this.advance();
      }
    }

    // Add EOF token
    tokens.push({
      type: 'EOF',
      value: '',
      range: this.makeRange(this.line, this.column, this.line, this.column),
    });

    return {
      tokens,
      errors: this.errors,
      finalState: { ...this.state, line: this.line, column: this.column },
      line_offsets: this.line_offsets,
    };
  }

  private is_mata_start_delimiter(word: string): boolean {
    return word === 'mata';
  }

  private is_mata_inline_delimiter(word: string): boolean {
    return word === 'mata';
  }

  private is_python_start_delimiter(word: string): boolean {
    return word === 'python';
  }

  private is_python_inline_delimiter(word: string): boolean {
    return word === 'python';
  }

  private is_end_delimiter(word: string): boolean {
    return word === 'end';
  }

  /**
   * Check if 'end' is at a statement boundary.
   * Returns true if the rest of the line (after current position) contains only:
   * - whitespace
   * - comments (// or block comments, NOT star-style since we are in Mata/Python)
   * - 'python' or 'mata' (legacy syntax: 'end python' / 'end mata')
   * 
   * This ensures 'end generate x = 1' is not treated as a block terminator,
   * but 'end python' and 'end mata' are still recognized.
   * 
   * Note: We do NOT treat '*' as a comment here because this function is only
   * called from Mata/Python context, where '*' is multiplication, not a comment.
   */
  private is_end_at_statement_boundary(): boolean {
    let my_pos = this.position;
    
    // Skip whitespace (but not newlines)
    while (my_pos < this.source.length) {
      const my_char = this.source[my_pos];
      if (my_char === '\n' || my_char === '\r') {
        // End of line - 'end' is at statement boundary
        return true;
      }
      if (my_char === ' ' || my_char === '\t') {
        my_pos++;
        continue;
      }
      // Check for comment start (// and /* */ are valid in Mata/Python)
      if (my_char === '/') {
        if (my_pos + 1 < this.source.length && this.source[my_pos + 1] === '/') {
          // // comment - rest of line is comment
          return true;
        }
        if (my_pos + 1 < this.source.length && this.source[my_pos + 1] === '*') {
          // /* comment - could span multiple lines, but for statement boundary
          // purposes, we consider this as 'end' being at boundary
          return true;
        }
      }
      // Note: '*' is NOT a comment in Mata/Python - it's multiplication
      // Check for 'python' or 'mata' (legacy 'end python' / 'end mata' syntax)
      const my_remaining = this.source.substring(my_pos);
      if (my_remaining.startsWith('python') && 
          (my_remaining.length === 6 || !this.isAlphaNumeric(my_remaining[6]))) {
        return true;
      }
      if (my_remaining.startsWith('mata') && 
          (my_remaining.length === 4 || !this.isAlphaNumeric(my_remaining[4]))) {
        return true;
      }
      // Non-whitespace, non-comment, non-python/mata character found
      return false;
    }
    // End of file - 'end' is at statement boundary
    return true;
  }

  private get_current_context(): LanguageContext {
    if (!this.state.context_stack || this.state.context_stack.length === 0) {
      return LanguageContext.STATA;
    }
    return this.state.context_stack[this.state.context_stack.length - 1];
  }

  /**
   * Determines if a * character should be treated as a comment or multiplication.
   * 
   * Rules for * comments in Stata:
   * 1. * at the beginning of a line (after optional whitespace) is always a comment
   * 2. * after certain tokens (like newlines, semicolons, braces) is likely a comment
   * 3. * after numbers, identifiers, closing parens/brackets is likely multiplication
   * 4. * in embedded language contexts follows different rules
   */
  private is_star_comment(start_line: number, start_column: number): boolean {
    // Rule 1: * at beginning of line (after optional whitespace) is always comment
    if (start_column === 0) {
      return true;
    }
    
    // Check if * is at the beginning of the line after whitespace
    const line_start_offset = this.line_offsets[start_line] || 0;
    const current_offset = this.position_to_offset(start_line, start_column);
    
    if (current_offset > line_start_offset) {
      const line_prefix = this.source.substring(line_start_offset, current_offset);
      // If everything before * on this line is whitespace, it's a comment
      if (/^\s*$/.test(line_prefix)) {
        return true;
      }
    }
    
    // Rule 2: Check previous token context
    if (!this.previous_token) {
      // No previous token means we're at start of file - treat as comment
      return true;
    }
    
    const prev_token_type = this.previous_token.type;
    const prev_token_value = this.previous_token.value;
    
    // After statement terminators, * is likely a comment
    if (prev_token_type === 'STATEMENT_TERMINATOR') {
      return true;
    }
    
    // After opening braces, * is likely a comment
    if (prev_token_type === 'LBRACE') {
      return true;
    }
    
    // After certain command keywords (case-sensitive), * is likely a comment
    // Keywords that expect expressions where * should be multiplication (case-sensitive)
    
    if (prev_token_type === 'WORD') {
      if (EXPRESSION_CONTEXT_KEYWORDS.has(prev_token_value)) {
        return false; // Treat as multiplication
      } else if (COMMENT_CONTEXT_KEYWORDS.has(prev_token_value)) {
        return true; // Treat as comment
      }
    }
    
    // Rule 3: After these tokens, * is likely multiplication
    if (MULTIPLICATION_CONTEXT_TYPES.has(prev_token_type)) {
      return false;
    }
    
    // After operators (except assignment), * is likely multiplication
    if (prev_token_type === 'OPERATOR') {
      if (!ASSIGNMENT_OPERATORS.has(prev_token_value)) {
        return false;
      }
      // After assignment operators, * could be either - default to comment
      return true;
    }
    
    // After commas, * is likely multiplication (in function calls, etc.)
    if (prev_token_type === 'COMMA') {
      return false;
    }
    
    // Default: when in doubt, treat as comment for safety
    // This prevents accidentally commenting out multiplication
    return true;
  }

  private push_context(context: LanguageContext): void {
    if (!this.state.context_stack) {
      this.state.context_stack = [];
    }
    this.state.context_stack.push(context);
    this.state.language_context = context;
  }

  private pop_context(): LanguageContext | undefined {
    if (!this.state.context_stack || this.state.context_stack.length === 0) {
      return undefined;
    }
    const popped = this.state.context_stack.pop();
    this.state.language_context = this.get_current_context();
    return popped;
  }

  private scanToken(): Token | Token[] | null {
    const startLine = this.line;
    const startColumn = this.column;
    const char = this.advance();
    const my_current_context = this.get_current_context();

    // In embedded language context, handle content differently
    if (my_current_context !== LanguageContext.STATA) {
      return this.scanEmbeddedContent(char, startLine, startColumn);
    }

    // Skip whitespace (except newlines which may be significant)
    if (char === ' ' || char === '\t' || char === '\r') {
      // Continue scanning whitespace
      while (this.peek() === ' ' || this.peek() === '\t' || this.peek() === '\r') {
        this.advance();
      }

      // In semicolon mode, whitespace is trivia - return it
      // In cr mode, skip whitespace entirely
      if (this.state.delimiterMode === 'semicolon') {
        return {
          type: 'WHITESPACE',
          value: this.source.substring(this.position_to_offset(startLine, startColumn), this.position),
          range: this.makeRange(startLine, startColumn, this.line, this.column),
        };
      }
      return null; // Skip whitespace in cr mode
    }

    // Handle newlines (significant in cr mode)
    if (char === '\n') {
      if (this.state.delimiterMode === 'cr') {
        return {
          type: 'STATEMENT_TERMINATOR',
          value: '\n',
          range: this.makeRange(startLine, startColumn, this.line, this.column),
        };
      } else {
        // In semicolon mode, newlines are whitespace
        return {
          type: 'WHITESPACE',
          value: '\n',
          range: this.makeRange(startLine, startColumn, this.line, this.column),
        };
      }
    }

    // Handle semicolons (significant in semicolon mode)
    if (char === ';') {
      if (this.state.delimiterMode === 'semicolon') {
        return {
          type: 'STATEMENT_TERMINATOR',
          value: ';',
          range: this.makeRange(startLine, startColumn, this.line, this.column),
        };
      } else {
        // In cr mode, semicolons are just operators
        return {
          type: 'OPERATOR',
          value: ';',
          range: this.makeRange(startLine, startColumn, this.line, this.column),
        };
      }
    }

    // Handle comments - improved * comment detection
    if (char === '*') {
      // Check if this is a * comment vs multiplication
      if (this.is_star_comment(startLine, startColumn)) {
        return this.scanLineComment(startLine, startColumn, 'star');
      }
      // Otherwise, fall through to operator handling
    }

    if (char === '/' && this.peek() === '/') {
      this.advance(); // consume second /

      // Check for continuation comment ///
      if (this.peek() === '/') {
        this.advance(); // consume third /
        
        // Check if this is a visual separator (only slashes until end of line)
        // e.g., "//////////////////////////////////////" is a comment, not continuation
        if (this.isOnlySlashesUntilEndOfLine()) {
          return this.scanLineComment(startLine, startColumn, 'slash');
        }
        
        // /// is a continuation if:
        // 1. There's code before it on the same line (startColumn > 0), OR
        // 2. We're continuing a valid continuation sequence (previous line ended with ///)
        if (startColumn === 0 && !this.state.in_continuation) {
          return this.scanLineComment(startLine, startColumn, 'slash');
        }
        
        return this.scanContinuationComment(startLine, startColumn);
      } else {
        return this.scanLineComment(startLine, startColumn, 'slash');
      }
    }

    if (char === '/' && this.peek() === '*') {
      this.advance(); // consume *
      return this.scanBlockComment(startLine, startColumn);
    }

    // Handle #delimit directive
    if (char === '#') {
      // Check if this is followed by 'delimit'
      const remaining = this.source.substring(this.position);
      if (remaining.startsWith('delimit')) {
        // Consume 'delimit'
        for (let i = 0; i < 7; i++) {
          this.advance();
        }
        return this.scanDelimitDirective(startLine, startColumn);
      }
    }

    // Handle strings
    if (char === '"') {
      return this.scanString(startLine, startColumn, 'simple');
    }

    // Handle single quotes as operators (not string delimiters in Stata)
    if (char === "'") {
      return this.makeToken('OPERATOR', char, startLine, startColumn);
    }

    // Handle compound quotes `"..."'
    if (char === '`' && this.peek() === '"') {
      this.advance(); // consume "
      return this.scanString(startLine, startColumn, 'compound');
    }

    // Handle local macro references `name'
    if (char === '`') {
      return this.scanLocalMacroRef(startLine, startColumn);
    }

    // Handle global macro references $name or ${name}
    if (char === '$') {
      return this.scanGlobalMacroRef(startLine, startColumn);
    }

    // Handle operators and punctuation
    switch (char) {
      case '=':
        if (this.peek() === '=') {
          this.advance();
          return this.makeToken('OPERATOR', '==', startLine, startColumn);
        }
        return this.makeToken('OPERATOR', '=', startLine, startColumn);
      case '!':
        if (this.peek() === '=') {
          this.advance();
          return this.makeToken('OPERATOR', '!=', startLine, startColumn);
        }
        return this.makeToken('OPERATOR', '!', startLine, startColumn);
      case '<':
        if (this.peek() === '=') {
          this.advance();
          return this.makeToken('OPERATOR', '<=', startLine, startColumn);
        }
        return this.makeToken('OPERATOR', '<', startLine, startColumn);
      case '>':
        if (this.peek() === '=') {
          this.advance();
          return this.makeToken('OPERATOR', '>=', startLine, startColumn);
        }
        return this.makeToken('OPERATOR', '>', startLine, startColumn);
      case '+':
        if (this.peek() === '+') {
          this.advance();
          return this.makeToken('OPERATOR', '++', startLine, startColumn);
        }
        return this.makeToken('OPERATOR', '+', startLine, startColumn);
      case '-':
        if (this.peek() === '-') {
          this.advance();
          return this.makeToken('OPERATOR', '--', startLine, startColumn);
        }
        return this.makeToken('OPERATOR', '-', startLine, startColumn);
      case '*':
        // * is handled above in comment detection
        return this.makeToken('OPERATOR', char, startLine, startColumn);
      case '/':
      case '^':
      case '&':
      case '|':
      case '~':
        return this.makeToken('OPERATOR', char, startLine, startColumn);
      case '{':
        return this.makeToken('LBRACE', char, startLine, startColumn);
      case '}':
        return this.makeToken('RBRACE', char, startLine, startColumn);
      case '(':
        return this.makeToken('LPAREN', char, startLine, startColumn);
      case ')':
        return this.makeToken('RPAREN', char, startLine, startColumn);
      case '[':
        return this.makeToken('LBRACKET', char, startLine, startColumn);
      case ']':
        return this.makeToken('RBRACKET', char, startLine, startColumn);
      case ',':
        return this.makeToken('COMMA', char, startLine, startColumn);
      case ':':
        return this.makeToken('COLON', char, startLine, startColumn);
    }

    // Handle numbers
    if (this.isDigit(char) || (char === '.' && this.isDigit(this.peek()))) {
      return this.scanNumber(startLine, startColumn);
    }

    // Handle extended missing values (.a through .z) and invalid dot-letter sequences
    if (char === '.' && this.isAlpha(this.peek())) {
      return this.scanExtendedMissingOrWord(startLine, startColumn);
    }

    // Handle words (identifiers, keywords, commands)
    if (this.isAlpha(char) || char === '_') {
      return this.scanWord(startLine, startColumn);
    }

    // Unknown character - treat as word for now
    return this.makeToken('WORD', char, startLine, startColumn);
  }

  private scanEmbeddedContent(
    first_char: string,
    startLine: number,
    startColumn: number
  ): Token | Token[] | null {
    // In embedded language context, we still need to handle:
    // 1. Strings (to avoid false delimiter detection)
    // 2. Comments (to avoid false delimiter detection)
    // 3. Braces (for bracket matching)
    // 4. Words (to detect end delimiters)
    // Everything else is EMBEDDED_CONTENT

    // Handle strings
    if (first_char === '"') {
      return this.scanString(startLine, startColumn, 'simple');
    }

    // Handle single quotes as operators (not string delimiters in Stata)
    if (first_char === "'") {
      return this.makeToken('OPERATOR', first_char, startLine, startColumn);
    }

    // Handle compound quotes
    if (first_char === '`' && this.peek() === '"') {
      this.advance();
      return this.scanString(startLine, startColumn, 'compound');
    }

    // Handle comments
    if (first_char === '/' && this.peek() === '/') {
      this.advance();
      if (this.peek() === '/') {
        this.advance();
        return this.scanContinuationComment(startLine, startColumn);
      } else {
        return this.scanLineComment(startLine, startColumn, 'slash');
      }
    }

    if (first_char === '/' && this.peek() === '*') {
      this.advance();
      return this.scanBlockComment(startLine, startColumn);
    }

    if (first_char === '*') {
      // In embedded contexts, * comments follow same rules as Stata
      if (this.is_star_comment(startLine, startColumn)) {
        return this.scanLineComment(startLine, startColumn, 'star');
      }
      // Otherwise treat as embedded content
    }

    // Handle braces for bracket matching
    if (first_char === '{') {
      // Check if this is the opening brace of a brace-style embedded block
      // (e.g., mata { ... }) - only if { is on the same line as mata/python
      const my_context = this.get_current_context();
      if ((my_context === LanguageContext.MATA || my_context === LanguageContext.PYTHON) &&
          this.state.embedded_brace_depth === undefined &&
          this.state.embedded_block_start_line !== undefined &&
          startLine === this.state.embedded_block_start_line) {
        // This is the first { on the same line as mata/python - start tracking brace depth
        this.state.embedded_brace_depth = 1;
      } else if (this.state.embedded_brace_depth !== undefined && this.state.embedded_brace_depth > 0) {
        // Already in a brace-style block, increment depth for nested braces
        this.state.embedded_brace_depth++;
      }
      return this.makeToken('LBRACE', first_char, startLine, startColumn);
    }
    if (first_char === '}') {
      // Check if this closes a brace-style embedded block
      if (this.state.embedded_brace_depth !== undefined && this.state.embedded_brace_depth > 0) {
        this.state.embedded_brace_depth--;
        if (this.state.embedded_brace_depth === 0) {
          // Brace-style block is closed - pop the embedded context
          this.state.embedded_brace_depth = undefined;
          this.state.embedded_block_start_line = undefined;
          this.pop_context();
        }
      }
      return this.makeToken('RBRACE', first_char, startLine, startColumn);
    }

    // Handle words (to detect end delimiters)
    if (this.isAlpha(first_char) || first_char === '_') {
      return this.scanWord(startLine, startColumn);
    }

    // Handle newlines
    if (first_char === '\n') {
      if (this.state.delimiterMode === 'cr') {
        return {
          type: 'STATEMENT_TERMINATOR',
          value: '\n',
          range: this.makeRange(startLine, startColumn, this.line, this.column),
        };
      } else {
        return {
          type: 'WHITESPACE',
          value: '\n',
          range: this.makeRange(startLine, startColumn, this.line, this.column),
        };
      }
    }

    // Handle whitespace
    if (first_char === ' ' || first_char === '\t' || first_char === '\r') {
      while (this.peek() === ' ' || this.peek() === '\t' || this.peek() === '\r') {
        this.advance();
      }
      
      // In embedded content, always preserve whitespace
      return {
        type: 'WHITESPACE',
        value: this.source.substring(this.position_to_offset(startLine, startColumn), this.position),
        range: this.makeRange(startLine, startColumn, this.line, this.column),
      };
    }

    // Everything else in embedded context is EMBEDDED_CONTENT
    // Consume until we hit something special
    while (!this.isAtEnd()) {
      const my_char = this.peek();
      
      // Stop at delimiters, strings, comments, braces, words, whitespace, newlines
      if (my_char === '"' || my_char === '`' || my_char === '/' || my_char === '*' ||
          my_char === '{' || my_char === '}' || my_char === '\n' ||
          my_char === ' ' || my_char === '\t' || my_char === '\r' ||
          this.isAlpha(my_char) || my_char === '_') {
        break;
      }
      
      this.advance();
    }

    const value = this.source.substring(this.position_to_offset(startLine, startColumn), this.position);
    return {
      type: 'EMBEDDED_CONTENT',
      value,
      range: this.makeRange(startLine, startColumn, this.line, this.column),
    };
  }

  private scanLineComment(startLine: number, startColumn: number, style: 'star' | 'slash'): Token {
    // Consume until end of line
    while (this.peek() !== '\n' && !this.isAtEnd()) {
      this.advance();
    }

    const value = this.source.substring(this.position_to_offset(startLine, startColumn), this.position);
    return {
      type: 'COMMENT_LINE',
      value,
      range: this.makeRange(startLine, startColumn, this.line, this.column),
    };
  }

  private scanContinuationComment(startLine: number, startColumn: number): Token {
    // Check if there's preceding whitespace
    const hasWhitespace = startColumn > 0;
    if (!hasWhitespace) {
      // Warning: continuation without preceding whitespace
      // For now, just continue parsing
    }

    // Consume until end of line
    while (this.peek() !== '\n' && !this.isAtEnd()) {
      this.advance();
    }

    // Mark that we're in a continuation sequence
    this.state.in_continuation = true;

    const value = this.source.substring(this.position_to_offset(startLine, startColumn), this.position);
    return {
      type: 'CONTINUATION',
      value,
      range: this.makeRange(startLine, startColumn, this.line, this.column),
    };
  }

  private scanBlockComment(startLine: number, startColumn: number): Token {
    // Consume until */
    while (!this.isAtEnd()) {
      if (this.peek() === '*' && this.peekNext() === '/') {
        this.advance(); // consume *
        this.advance(); // consume /
        break;
      }
      this.advance();
    }

    const value = this.source.substring(this.position_to_offset(startLine, startColumn), this.position);
    return {
      type: 'COMMENT_BLOCK',
      value,
      range: this.makeRange(startLine, startColumn, this.line, this.column),
    };
  }

  private scanDelimitDirective(startLine: number, startColumn: number): Token {
    // Skip whitespace after #delimit
    while (this.peek() === ' ' || this.peek() === '\t') {
      this.advance();
    }

    // Read the mode (cr or ;)
    if (this.peek() === 'c' && this.peekNext() === 'r') {
      this.advance();
      this.advance();
      this.state.delimiterMode = 'cr';
    } else if (this.peek() === ';') {
      this.advance();
      this.state.delimiterMode = 'semicolon';
    }

    // Consume until end of line
    while (this.peek() !== '\n' && !this.isAtEnd()) {
      this.advance();
    }

    const value = this.source.substring(this.position_to_offset(startLine, startColumn), this.position);
    return {
      type: 'DELIMIT_DIRECTIVE',
      value,
      range: this.makeRange(startLine, startColumn, this.line, this.column),
    };
  }

  private scanString(startLine: number, startColumn: number, quoteStyle: 'simple' | 'compound'): Token | Token[] {
    if (quoteStyle === 'simple') {
      return this.scanSimpleString(startLine, startColumn);
    }
    return this.scanCompoundString(startLine, startColumn);
  }

  private scanSimpleString(startLine: number, startColumn: number): Token | Token[] {
    const the_tokens: Token[] = [];
    let segment_start_line = startLine;
    let segment_start_column = startColumn;
    let properly_closed = false;

    while (!this.isAtEnd()) {
      const char = this.peek();

      if (char === '\n') {
        const error: LexerError = {
          message: 'Unclosed string literal',
          range: this.makeRange(startLine, startColumn, this.line, this.column + 1),
          code: LexerErrorCode.UNBALANCED_QUOTES
        };
        this.errors.push(error);
        break;
      }

      if (char === '"') {
        if (this.peekNext() === '"') {
          this.advance(); // consume first "
          this.advance(); // consume second "
          continue;
        } else {
          this.advance(); // consume closing "
          properly_closed = true;
          break;
        }
      }

      // Check for local macro reference: `
      if (char === '`') {
        // Emit string segment before macro ref
        const segment_value = this.source.substring(
          this.position_to_offset(segment_start_line, segment_start_column),
          this.position
        );
        if (segment_value.length > 0) {
          the_tokens.push({
            type: 'STRING',
            value: segment_value,
            range: this.makeRange(segment_start_line, segment_start_column, this.line, this.column),
            quoteStyle: 'simple',
          });
        }

        // Scan macro reference
        const macro_start_line = this.line;
        const macro_start_column = this.column;
        this.advance(); // consume `
        while (this.peek() !== "'" && this.peek() !== '\n' && !this.isAtEnd()) {
          this.advance();
        }
        if (this.peek() === "'") {
          this.advance(); // consume '
        }
        const macro_value = this.source.substring(
          this.position_to_offset(macro_start_line, macro_start_column),
          this.position
        );
        the_tokens.push({
          type: 'MACRO_REF_LOCAL',
          value: macro_value,
          range: this.makeRange(macro_start_line, macro_start_column, this.line, this.column),
        });

        // Start new segment
        segment_start_line = this.line;
        segment_start_column = this.column;
        continue;
      }

      // Check for global macro reference: $
      if (char === '$') {
        // Emit string segment before macro ref
        const segment_value = this.source.substring(
          this.position_to_offset(segment_start_line, segment_start_column),
          this.position
        );
        if (segment_value.length > 0) {
          the_tokens.push({
            type: 'STRING',
            value: segment_value,
            range: this.makeRange(segment_start_line, segment_start_column, this.line, this.column),
            quoteStyle: 'simple',
          });
        }

        // Scan global macro reference
        const macro_start_line = this.line;
        const macro_start_column = this.column;
        this.advance(); // consume $
        if (this.peek() === '{') {
          // ${name} form - track nested braces and local macros
          this.advance(); // consume {
          let brace_depth = 1;
          let local_depth = 0;
          
          while (!this.isAtEnd() && brace_depth > 0) {
            const my_char = this.peek();
            
            if (my_char === '\n') {
              break; // Stop at newline
            }
            
            // Track local macro nesting
            if (my_char === '`') {
              local_depth++;
              this.advance();
              continue;
            }
            
            if (my_char === "'" && local_depth > 0) {
              local_depth--;
              this.advance();
              continue;
            }
            
            // Track brace nesting (only when not inside a local macro)
            if (my_char === '{' && local_depth === 0) {
              brace_depth++;
              this.advance();
              continue;
            }
            
            if (my_char === '}' && local_depth === 0) {
              brace_depth--;
              if (brace_depth > 0) {
                this.advance();
                continue;
              }
              // brace_depth == 0, consume final } and exit
              this.advance();
              break;
            }
            
            this.advance();
          }
        } else {
          // $name form - consume word characters
          while (/[a-zA-Z0-9_]/.test(this.peek()) && !this.isAtEnd()) {
            this.advance();
          }
        }
        const macro_value = this.source.substring(
          this.position_to_offset(macro_start_line, macro_start_column),
          this.position
        );
        the_tokens.push({
          type: 'MACRO_REF_GLOBAL',
          value: macro_value,
          range: this.makeRange(macro_start_line, macro_start_column, this.line, this.column),
        });

        // Start new segment
        segment_start_line = this.line;
        segment_start_column = this.column;
        continue;
      }

      this.advance();
    }

    // Report error if string was not properly closed (EOF reached)
    if (!properly_closed && this.isAtEnd()) {
      const error: LexerError = {
        message: 'Unclosed string literal',
        range: this.makeRange(startLine, startColumn, this.line, this.column),
        code: LexerErrorCode.UNBALANCED_QUOTES
      };
      this.errors.push(error);
    }

    // Emit final segment
    const final_value = this.source.substring(
      this.position_to_offset(segment_start_line, segment_start_column),
      this.position
    );
    if (final_value.length > 0) {
      the_tokens.push({
        type: 'STRING',
        value: final_value,
        range: this.makeRange(segment_start_line, segment_start_column, this.line, this.column),
        quoteStyle: 'simple',
      });
    }

    // Return single token if no macro refs, array otherwise
    if (the_tokens.length === 1) {
      return the_tokens[0];
    }
    return the_tokens;
  }

  private scanCompoundString(startLine: number, startColumn: number): Token | Token[] {
    const the_tokens: Token[] = [];
    let depth = 1;
    let segment_start_line = startLine;
    let segment_start_column = startColumn;

    while (!this.isAtEnd() && depth > 0) {
      const char = this.peek();

      if (char === '\n') {
        const error: LexerError = {
          message: 'Unclosed string literal',
          range: this.makeRange(startLine, startColumn, this.line, this.column + 1),
          code: LexerErrorCode.UNBALANCED_QUOTES
        };
        this.errors.push(error);
        break;
      }

      // Check for nested compound quote opening: `"
      if (char === '`' && this.peekNext() === '"') {
        this.advance(); // consume `
        this.advance(); // consume "
        depth++;
        continue;
      }

      // Check for compound quote closing: "'
      if (char === '"' && this.peekNext() === "'") {
        this.advance(); // consume "
        this.advance(); // consume '
        depth--;
        continue;
      }

      // Check for local macro reference: ` not followed by "
      if (char === '`' && this.peekNext() !== '"' && depth === 1) {
        // Emit string segment before macro ref
        const segment_value = this.source.substring(
          this.position_to_offset(segment_start_line, segment_start_column),
          this.position
        );
        if (segment_value.length > 0) {
          the_tokens.push({
            type: 'STRING',
            value: segment_value,
            range: this.makeRange(segment_start_line, segment_start_column, this.line, this.column),
            quoteStyle: 'compound',
          });
        }

        // Scan macro reference
        const macro_start_line = this.line;
        const macro_start_column = this.column;
        this.advance(); // consume `
        while (this.peek() !== "'" && this.peek() !== '\n' && !this.isAtEnd()) {
          this.advance();
        }
        if (this.peek() === "'") {
          this.advance(); // consume '
        }
        const macro_value = this.source.substring(
          this.position_to_offset(macro_start_line, macro_start_column),
          this.position
        );
        the_tokens.push({
          type: 'MACRO_REF_LOCAL',
          value: macro_value,
          range: this.makeRange(macro_start_line, macro_start_column, this.line, this.column),
        });

        // Start new segment
        segment_start_line = this.line;
        segment_start_column = this.column;
        continue;
      }

      // Check for global macro reference: $
      if (char === '$' && depth === 1) {
        // Emit string segment before macro ref
        const segment_value = this.source.substring(
          this.position_to_offset(segment_start_line, segment_start_column),
          this.position
        );
        if (segment_value.length > 0) {
          the_tokens.push({
            type: 'STRING',
            value: segment_value,
            range: this.makeRange(segment_start_line, segment_start_column, this.line, this.column),
            quoteStyle: 'compound',
          });
        }

        // Scan global macro reference
        const macro_start_line = this.line;
        const macro_start_column = this.column;
        this.advance(); // consume $
        if (this.peek() === '{') {
          // ${name} form - track nested braces and local macros
          this.advance(); // consume {
          let brace_depth = 1;
          let local_depth = 0;
          
          while (!this.isAtEnd() && brace_depth > 0) {
            const my_char = this.peek();
            
            if (my_char === '\n') {
              break; // Stop at newline
            }
            
            // Track local macro nesting
            if (my_char === '`') {
              local_depth++;
              this.advance();
              continue;
            }
            
            if (my_char === "'" && local_depth > 0) {
              local_depth--;
              this.advance();
              continue;
            }
            
            // Track brace nesting (only when not inside a local macro)
            if (my_char === '{' && local_depth === 0) {
              brace_depth++;
              this.advance();
              continue;
            }
            
            if (my_char === '}' && local_depth === 0) {
              brace_depth--;
              if (brace_depth > 0) {
                this.advance();
                continue;
              }
              // brace_depth == 0, consume final } and exit
              this.advance();
              break;
            }
            
            this.advance();
          }
        } else {
          // $name form - consume word characters
          while (/[a-zA-Z0-9_]/.test(this.peek()) && !this.isAtEnd()) {
            this.advance();
          }
        }
        const macro_value = this.source.substring(
          this.position_to_offset(macro_start_line, macro_start_column),
          this.position
        );
        the_tokens.push({
          type: 'MACRO_REF_GLOBAL',
          value: macro_value,
          range: this.makeRange(macro_start_line, macro_start_column, this.line, this.column),
        });

        // Start new segment
        segment_start_line = this.line;
        segment_start_column = this.column;
        continue;
      }

      this.advance();
    }

    // Report error if string was not properly closed (EOF reached with depth > 0)
    if (depth > 0 && this.isAtEnd()) {
      const error: LexerError = {
        message: 'Unclosed string literal',
        range: this.makeRange(startLine, startColumn, this.line, this.column),
        code: LexerErrorCode.UNBALANCED_QUOTES
      };
      this.errors.push(error);
    }

    // Emit final segment
    const final_value = this.source.substring(
      this.position_to_offset(segment_start_line, segment_start_column),
      this.position
    );
    if (final_value.length > 0) {
      the_tokens.push({
        type: 'STRING',
        value: final_value,
        range: this.makeRange(segment_start_line, segment_start_column, this.line, this.column),
        quoteStyle: 'compound',
      });
    }

    // Return single token if no macro refs, array otherwise
    if (the_tokens.length === 1) {
      return the_tokens[0];
    }
    return the_tokens;
  }



  private scanLocalMacroRef(startLine: number, startColumn: number): Token {
    let nesting_depth = 1; // Start at 1 for the initial backtick

    while (nesting_depth > 0 && !this.isAtEnd()) {
      const my_char = this.peek();

      if (my_char === '\n') {
        const my_error: LexerError = {
          message: 'Incomplete macro expression: expected closing quote',
          range: this.makeRange(startLine, startColumn, this.line, this.column),
          code: LexerErrorCode.UNBALANCED_QUOTES,
        };
        this.errors.push(my_error);
        break;
      }

      if (my_char === '`') {
        nesting_depth++;
        this.advance();
        continue;
      }

      if (my_char === "'") {
        nesting_depth--;
        this.advance();
        continue;
      }

      this.advance();
    }

    if (nesting_depth > 0 && this.isAtEnd()) {
      const my_error: LexerError = {
        message: 'Incomplete macro expression: expected closing quote',
        range: this.makeRange(startLine, startColumn, this.line, this.column),
        code: LexerErrorCode.UNBALANCED_QUOTES,
      };
      this.errors.push(my_error);
    }

    const value = this.source.substring(
      this.position_to_offset(startLine, startColumn),
      this.position
    );
    return {
      type: 'MACRO_REF_LOCAL',
      value,
      range: this.makeRange(startLine, startColumn, this.line, this.column),
    };
  }

  private scanGlobalMacroRef(startLine: number, startColumn: number): Token {
    if (this.peek() === '{') {
      // ${name} form - track nested braces and local macros
      this.advance(); // consume {
      let brace_depth = 1;
      let local_depth = 0;
      
      while (!this.isAtEnd() && brace_depth > 0) {
        const my_char = this.peek();
        
        // Stop at newline - incomplete macro syntax
        if (my_char === '\n') {
          const my_error: LexerError = {
            message: 'Incomplete macro expression: expected \'}\' or closing quote',
            range: this.makeRange(startLine, startColumn, this.line, this.column),
            code: LexerErrorCode.UNBALANCED_QUOTES,
          };
          this.errors.push(my_error);
          break;
        }
        
        // Track local macro nesting (backtick opens, apostrophe closes)
        if (my_char === '`') {
          local_depth++;
          this.advance();
          continue;
        }
        
        if (my_char === "'" && local_depth > 0) {
          local_depth--;
          this.advance();
          continue;
        }
        
        // Track brace nesting (only when not inside a local macro)
        if (my_char === '{' && local_depth === 0) {
          brace_depth++;
          this.advance();
          continue;
        }
        
        if (my_char === '}' && local_depth === 0) {
          brace_depth--;
          if (brace_depth > 0) {
            this.advance();
            continue;
          }
          // brace_depth == 0, consume final } and exit
          this.advance();
          break;
        }
        
        this.advance();
      }
      
      // If we reached EOF without closing all braces, emit diagnostic
      if (brace_depth > 0 && this.isAtEnd()) {
        const my_error: LexerError = {
          message: 'Incomplete macro expression: expected \'}\' or closing quote',
          range: this.makeRange(startLine, startColumn, this.line, this.column),
          code: LexerErrorCode.UNBALANCED_QUOTES,
        };
        this.errors.push(my_error);
      }
    } else {
      // $name form
      while (this.isAlphaNumeric(this.peek()) || this.peek() === '_') {
        this.advance();
      }
    }

    const value = this.source.substring(this.position_to_offset(startLine, startColumn), this.position);
    return {
      type: 'MACRO_REF_GLOBAL',
      value,
      range: this.makeRange(startLine, startColumn, this.line, this.column),
    };
  }

  private scanNumber(startLine: number, startColumn: number): Token {
    // Consume digits
    while (this.isDigit(this.peek())) {
      this.advance();
    }

    // Look for decimal part
    if (this.peek() === '.' && this.isDigit(this.peekNext())) {
      this.advance(); // consume .
      while (this.isDigit(this.peek())) {
        this.advance();
      }
    }

    // Look for exponent
    if (this.peek() === 'e' || this.peek() === 'E') {
      this.advance();
      if (this.peek() === '+' || this.peek() === '-') {
        this.advance();
      }
      while (this.isDigit(this.peek())) {
        this.advance();
      }
    }

    const value = this.source.substring(this.position_to_offset(startLine, startColumn), this.position);
    return {
      type: 'NUMBER',
      value,
      range: this.makeRange(startLine, startColumn, this.line, this.column),
    };
  }

  /**
   * Handle dot followed by letter(s) for extended missing values.
   * - Lowercase single letter (.a-.z) → NUMBER token (valid extended missing)
   * - Uppercase single letter (.A-.Z) → WORD token (invalid, parser will report error)
   * - Multiple letters (.ab, .abc, .Abc) → single WORD token (invalid)
   */
  private scanExtendedMissingOrWord(startLine: number, startColumn: number): Token {
    // At this point, we've consumed the '.' and peek() is a letter
    const next_char = this.peek();
    const after_next = this.peekNext();

    // Check if it's a single letter followed by non-alphanumeric
    if (this.isAlpha(next_char) && !this.isAlphaNumeric(after_next) && after_next !== '_') {
      this.advance(); // consume the letter
      const value = '.' + next_char;

      // Lowercase single letter = valid extended missing value (NUMBER)
      if (next_char >= 'a' && next_char <= 'z') {
        return this.makeToken('NUMBER', value, startLine, startColumn);
      }

      // Uppercase single letter = invalid (WORD, parser will report error)
      return this.makeToken('WORD', value, startLine, startColumn);
    }

    // Multiple letters after dot = consume all as single WORD token
    // e.g., ".ab", ".abc", ".Abc"
    while (this.isAlphaNumeric(this.peek()) || this.peek() === '_') {
      this.advance();
    }

    const value = this.source.substring(
      this.position_to_offset(startLine, startColumn),
      this.position
    );
    return this.makeToken('WORD', value, startLine, startColumn);
  }

  private scanWord(startLine: number, startColumn: number): Token {
    while (this.isAlphaNumeric(this.peek()) || this.peek() === '_') {
      this.advance();
    }

    const value = this.source.substring(this.position_to_offset(startLine, startColumn), this.position);
    
    // Check for embedded language delimiters
    const my_current_context = this.get_current_context();
    
    if (my_current_context === LanguageContext.STATA) {
      // Check for embedded language block starts (case-sensitive: Stata requires lowercase)
      if (this.is_mata_start_delimiter(value)) {
        // Check if previous token is a WORD - if so, "mata" is an argument, not a block start
        // e.g., "clear mata" should not start a Mata block
        const prev_is_word = this.previous_token && 
          this.previous_token.type === 'WORD';
        
        // Check if previous token is MATA_INLINE - if so, we're inside an inline mata expression
        // e.g., "mata: mata drop foo()" - the second "mata" is a Mata command, not a block start
        const prev_is_mata_inline = this.previous_token &&
          this.previous_token.type === 'MATA_INLINE';
        
        // First check for inline mata: syntax (mata followed by colon)
        // This takes precedence because "capture mata:" should be recognized as inline mata
        if (this.peek() === ':') {
          this.advance(); // consume the colon
          const full_value = value + ':';
          // NOTE: Do NOT push Mata context for inline mata:
          // Inline Mata executes a single expression and returns to Stata immediately
          return {
            type: 'MATA_INLINE',
            value: full_value,
            range: this.makeRange(startLine, startColumn, this.line, this.column),
          };
        } else if (prev_is_word || prev_is_mata_inline) {
          // "mata" is an argument to a command or part of inline mata, not a block start
          // Fall through to return as WORD
        } else {
          // Regular mata block start
          this.push_context(LanguageContext.MATA);
          // Track the start line for brace-style block detection
          this.state.embedded_block_start_line = startLine;
          return {
            type: 'MATA_START',
            value,
            range: this.makeRange(startLine, startColumn, this.line, this.column),
          };
        }
      } else if (this.is_python_start_delimiter(value)) {
        // Check if next character is colon for python:
        if (this.peek() === ':') {
          this.advance(); // consume the colon
          const full_value = value + ':';
          // NOTE: Do NOT push Python context for inline python:
          // Inline Python executes a single expression and returns to Stata immediately
          return {
            type: 'PYTHON_INLINE',
            value: full_value,
            range: this.makeRange(startLine, startColumn, this.line, this.column),
          };
        }
        
        // Check if previous token was "end" - if so, this is "end python" not a block start
        const prev_is_end = this.previous_token && 
          this.previous_token.type === 'WORD' && 
          this.previous_token.value === 'end';
        
        if (!prev_is_end) {
          this.push_context(LanguageContext.PYTHON);
          // Track the start line for brace-style block detection
          this.state.embedded_block_start_line = startLine;
          return {
            type: 'PYTHON_START',
            value,
            range: this.makeRange(startLine, startColumn, this.line, this.column),
          };
        }
        // If prev was "end", fall through to return as WORD
      }
    } else if (my_current_context === LanguageContext.MATA) {
      // In Mata context, check for end delimiter (case-sensitive)
      // But NOT if we're in a brace-style block (mata { ... })
      // And only if 'end' is at a statement boundary (nothing else on the line except comments)
      if (this.is_end_delimiter(value) && this.state.embedded_brace_depth === undefined) {
        if (this.is_end_at_statement_boundary()) {
          this.pop_context();
          this.state.embedded_block_start_line = undefined;
          return {
            type: 'END_MATA',
            value,
            range: this.makeRange(startLine, startColumn, this.line, this.column),
          };
        }
        // 'end' followed by other code - treat as WORD, not block terminator
      }
    } else if (my_current_context === LanguageContext.PYTHON) {
      // In Python context, check for end delimiter (case-sensitive)
      // But NOT if we're in a brace-style block (python { ... })
      // And only if 'end' is at a statement boundary (nothing else on the line except comments)
      if (this.is_end_delimiter(value) && this.state.embedded_brace_depth === undefined) {
        if (this.is_end_at_statement_boundary()) {
          this.pop_context();
          this.state.embedded_block_start_line = undefined;
          return {
            type: 'END_PYTHON',
            value,
            range: this.makeRange(startLine, startColumn, this.line, this.column),
          };
        }
        // 'end' followed by other code - treat as WORD, not block terminator
      }
    }
    
    return {
      type: 'WORD',
      value,
      range: this.makeRange(startLine, startColumn, this.line, this.column),
    };
  }

  private matchWord(word: string): boolean {
    const remaining = this.source.substring(this.position);
    return remaining.startsWith(word) &&
      (remaining.length === word.length || !this.isAlphaNumeric(remaining[word.length]));
  }

  private isAtEnd(): boolean {
    return this.position >= this.source.length;
  }

  /**
   * Check if this looks like a visual separator line.
   * Visual separators typically have many consecutive slashes (e.g., "////////////////////")
   * Real continuations are just "///" possibly followed by comment text.
   * We check if there are more than 3 additional slashes after the initial "///".
   */
  private isOnlySlashesUntilEndOfLine(): boolean {
    let my_pos = this.position;
    let my_slash_count = 0;
    
    // Count consecutive slashes
    while (my_pos < this.source.length && this.source[my_pos] === '/') {
      my_slash_count++;
      my_pos++;
    }
    
    // If we have 4+ more slashes (total 7+ with the initial ///), it's a visual separator
    return my_slash_count >= 4;
  }

  private advance(): string {
    if (this.isAtEnd()) return '\0';

    const char = this.source[this.position];
    this.position++;

    if (char === '\n') {
      this.line++;
      this.column = 0;
      // Track the offset where the next line starts
      this.line_offsets.push(this.position);
    } else {
      this.column++;
    }

    return char;
  }

  private peek(): string {
    if (this.isAtEnd()) return '\0';
    return this.source[this.position];
  }

  private peekNext(): string {
    if (this.position + 1 >= this.source.length) return '\0';
    return this.source[this.position + 1];
  }

  private isDigit(char: string): boolean {
    return char >= '0' && char <= '9';
  }

  private isAlpha(char: string): boolean {
    return (char >= 'a' && char <= 'z') ||
      (char >= 'A' && char <= 'Z');
  }

  private isAlphaNumeric(char: string): boolean {
    return this.isAlpha(char) || this.isDigit(char);
  }

  private makeToken(type: TokenType, value: string, startLine: number, startColumn: number): Token {
    return {
      type,
      value,
      range: this.makeRange(startLine, startColumn, this.line, this.column),
    };
  }

  private makeRange(startLine: number, startColumn: number, endLine: number, endColumn: number): Range {
    return {
      start: { line: startLine, character: startColumn },
      end: { line: endLine, character: endColumn },
    };
  }

  private getStartPosition(startLine: number, startColumn: number): number {
    // DEPRECATED: Use position_to_offset instead
    // This method is kept for backward compatibility but should not be used
    let pos = 0;
    let currentLine = 0;

    while (currentLine < startLine && pos < this.source.length) {
      if (this.source[pos] === '\n') {
        currentLine++;
      }
      pos++;
    }

    return pos + startColumn;
  }

  /**
   * Convert line/column to byte offset using pre-computed line_offsets.
   * O(1) time complexity.
   * Returns -1 for out-of-bounds line or column.
   */
  private position_to_offset(
    line: number,
    column: number
  ): number {
    if (line < 0 || line >= this.line_offsets.length) {
      return -1;
    }

    const line_start = this.line_offsets[line];
    const line_end = line + 1 < this.line_offsets.length
      ? this.line_offsets[line + 1] - 1  // Exclude newline
      : this.source.length;
    const line_length = line_end - line_start;

    if (column < 0 || column > line_length) {
      return -1;
    }

    return line_start + column;
  }
}
