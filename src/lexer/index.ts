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
import { is_swallowed_continuation_terminator } from '../utils/continuation';
import {
  is_program_definition_header,
  logical_line_text,
} from '../utils/program-definition';
import { SemicolonStatementTracker } from '../utils/semicolon-statement';
import {
  COLON_PREFIX_COMMANDS,
  PREFIX_COMMANDS,
} from '../utils/stata-prefix-commands';

const EXPRESSION_CONTEXT_KEYWORDS = new Set(['if', 'else', 'foreach', 'forvalues', 'while', 'gen', 'generate', 'replace', 'egen', 'set', 'scalar', 'matrix', 'return']);
const COMMENT_CONTEXT_KEYWORDS = new Set(['program', 'capture', 'quietly', 'noisily', 'by', 'bysort']);
// A `*` after one of these is multiplication. A string never ends a
// statement on its own line, so `"ab" * 3` is string repetition, not a
// star comment.
const MULTIPLICATION_CONTEXT_TYPES = new Set(['NUMBER', 'WORD', 'STRING', 'RPAREN', 'RBRACKET', 'RBRACE', 'MACRO_REF_LOCAL', 'MACRO_REF_GLOBAL', 'LPAREN']);
const ASSIGNMENT_OPERATORS = new Set(['=', '==', '!=', '<', '>', '<=', '>=']);
const COMMENT_TOKEN_TYPES: ReadonlySet<TokenType> = new Set<TokenType>([
  'COMMENT_LINE', 'COMMENT_BLOCK', 'CONTINUATION',
]);
// Prefixes a command can follow directly (`quietly * note`), with
// their abbreviations.
const ARGUMENT_FREE_PREFIXES: ReadonlySet<string> = new Set(
  [...PREFIX_COMMANDS].filter(([, my_name]) =>
    my_name !== 'by' && my_name !== 'bysort').map(([my_word]) => my_word),
);
// Prefixes whose colon starts a command that may be a `*` comment
// (`version 18: * note`). After `by g:`, `svy:`, `bootstrap:` and the
// like, Stata 18 reads `*` as the command name and fails.
const STAR_COMMENT_COLON_PREFIXES: ReadonlySet<string> = new Set([
  ...[...COLON_PREFIX_COMMANDS].filter(([, my_name]) =>
    my_name === 'version' || my_name === 'xi').map(([my_word]) => my_word),
  'frame',
]);
// A statement starts after one of these (or at the start of the file).
const STATEMENT_START_TYPES: ReadonlySet<TokenType> = new Set<TokenType>([
  'STATEMENT_TERMINATOR', 'DELIMIT_DIRECTIVE', 'LBRACE', 'RBRACE',
  'END_MATA', 'END_PYTHON',
]);

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
  // Offset just past the last non-whitespace character of the source.
  private content_end_offset = 0;

  private previous_token: Token | null = null;
  // The previous token other than whitespace or a comment, so
  // `a /* c */ * b` reads `*` after `a`.
  private previous_code_token: Token | null = null;
  // Start line of the run of block comments since previous_code_token
  // (null if none), so `x /* a<newline>b */ /* c */ end` is mid-line.
  private comment_run_start_line: number | null = null;
  // Whether a `///` joins the current line to the one above (no code
  // since the `///` other than the newline it continues).
  private joined_to_previous_line = false;
  // Whether a command that may be a `*` comment starts at the next code
  // token: at the start of a statement, after `capture`/`quietly`/
  // `noisily` there, or after a prefix colon such as `version 18:`.
  private at_command_start = true;
  // The word naming the current command, once past any argument-free
  // prefixes; it tells `version 18:` from `unab x :`.
  private command_word: string | null = null;
  // Inside a `mata:` one-liner, where `:*` multiplies.
  private in_mata_inline_statement = false;
  // Inside a `python:` one-liner, where `*` is Python code.
  private in_python_inline_statement = false;
  // Inside a `program define` body. Stata ends the definition at the
  // first line whose first word is `end`, even one inside a mata or
  // python block, so such an `end` also closes the block.
  private program_definition_open = false;
  // Whether the open python block was opened by `python;` (or
  // `python:;`) under `#delimit ;`, so Stata reads it as `;`-ended
  // statements (see is_python_end_statement).
  private python_block_reads_statements = false;
  // Under `#delimit ;`, whether the current statement has anything in
  // it yet, comments included: Stata 18 reads a column-0 `//` or `///`
  // as a comment only on a statement's first line.
  private semicolon_statement = new SemicolonStatementTracker();

  tokenize(source: string, initialState?: LexerState): LexerResult {
    this.source = source;
    this.position = 0;
    this.line = 0;
    this.column = 0;
    this.line_offsets = [0]; // First line starts at offset 0
    this.content_end_offset = source.trimEnd().length;
    this.previous_token = null;
    this.previous_code_token = null;
    this.comment_run_start_line = null;
    this.joined_to_previous_line = false;
    this.at_command_start = true;
    this.command_word = null;
    this.in_mata_inline_statement = false;
    this.in_python_inline_statement = false;
    this.program_definition_open = false;
    this.python_block_reads_statements = false;
    this.semicolon_statement = new SemicolonStatementTracker();
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
      const startLine = this.line;
      const startColumn = this.column;

      try {
        const result = this.scanToken();
        if (result) {
          if (Array.isArray(result)) {
            for (const my_token of result) {
              tokens.push(my_token);
              this.note_previous_token(my_token);
              // Reset continuation state when we see actual code (not continuation, whitespace, or newline)
              if (my_token.type !== 'CONTINUATION' && 
                  my_token.type !== 'WHITESPACE' && 
                  my_token.type !== 'STATEMENT_TERMINATOR') {
                this.state.in_continuation = false;
              }
            }
          } else {
            tokens.push(result);
            this.note_previous_token(result);
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
   * Whether the `end` just scanned (starting at `start_line`) begins
   * its logical line, which is where Stata ends a plain `mata` block
   * and a program definition. Stata 18 ends a Mata block at an `end` that
   * begins its logical line: leading blanks and a block comment may
   * precede it, but code may not (`y end`, `a=end`, `x = 1; end`), and
   * neither may a `///` that joins it to the line above. Anything but
   * a word character or `.` may follow (`end foo`, `end;`, `end(1)`,
   * `end mata`); Stata discards that tail.
   */
  private is_end_at_line_start(start_line: number): boolean {
    return this.peek() !== '.' && this.is_first_code_on_line(start_line);
  }

  /**
   * Track whether a program definition is open, from a Stata-context
   * word starting on `start_line`: `program` first on its line opens
   * one (see is_program_definition_header, shared with the parser and
   * the context tracker), and `end` first on its line closes it.
   */
  private note_program_definition_word(value: string, start_line: number): void {
    if (value === 'program' && !this.program_definition_open &&
        this.is_first_code_on_line(start_line)) {
      this.program_definition_open = is_program_definition_header(
        logical_line_text(this.source, this.position)
      );
    } else if (value === 'end' && this.program_definition_open &&
        this.is_end_at_line_start(start_line)) {
      this.program_definition_open = false;
    }
  }

  /**
   * Consume the tail Stata discards after an `end` that closes a Mata
   * block (or, inside a program definition, any block), up to
   * a comment, the end of the line, or (under `#delimit ;`) the `;`
   * that ends the statement. Trailing blanks are left to be lexed as
   * whitespace.
   */
  private consume_end_tail(): void {
    let my_pos = this.position;
    let my_tail_end = this.position;
    while (my_pos < this.source.length) {
      const my_char = this.source[my_pos];
      const my_next = this.source[my_pos + 1];
      if (my_char === '\n') {
        break;
      }
      if (my_char === '/' && (my_next === '/' || my_next === '*')) {
        break;
      }
      if (my_char === ';' && this.state.delimiterMode === 'semicolon') {
        break;
      }
      if (my_char !== ' ' && my_char !== '\t' && my_char !== '\r') {
        my_tail_end = my_pos + 1;
      }
      my_pos++;
    }
    while (this.position < my_tail_end) {
      this.advance();
    }
  }

  /**
   * Whether the `end` just scanned (starting at `start_column`) closes
   * a plain `python` block. Stata 18 hands Python every line except
   * one that is exactly `end`, with optional trailing blanks: an
   * indented `end`, `end // c`, `end # c` and `end python` all stay
   * Python code.
   */
  private is_python_block_end(start_column: number): boolean {
    if (start_column !== 0) {
      return false;
    }
    if (this.python_block_reads_statements) {
      return this.is_python_end_statement(start_column);
    }
    let my_pos = this.position;
    while (my_pos < this.source.length) {
      const my_char = this.source[my_pos];
      if (my_char === '\n') {
        return true;
      }
      if (my_char !== ' ' && my_char !== '\t' && my_char !== '\r') {
        return false;
      }
      my_pos++;
    }
    return true;
  }

  /**
   * Note how a python block that starts at the current position reads.
   * Under `#delimit ;`, `python;` and `python:;` open a block of
   * `;`-ended statements. A bare `python` line there is not a block
   * opener in Stata (the statement runs on to the next `;`); it keeps
   * the physical-line rule as a lenient reading of that invalid code.
   */
  private note_python_block_opener(): void {
    if (this.state.delimiterMode !== 'semicolon') {
      this.python_block_reads_statements = false;
      return;
    }
    let my_pos = this.position;
    while (this.source[my_pos] === ' ' || this.source[my_pos] === '\t') {
      my_pos++;
    }
    this.python_block_reads_statements = this.source[my_pos] === ';';
  }

  /**
   * Under `#delimit ;`, Stata 18 hands a Python block whole `;`-ended
   * statements (lines joined until the `;`), and ends the block at a
   * statement that is exactly `end`, with trailing blanks or line
   * breaks before its `;`. So the `end` (in column 0) must follow the
   * previous statement's `;` (or the opener's) with only line breaks
   * between, and be followed by blanks and then `;`. `print(1); end;`
   * on one line hands Python ` end`, which does not end the block.
   */
  private is_python_end_statement(start_column: number): boolean {
    let my_before = this.position - 'end'.length - 1;
    while (my_before >= 0 &&
        (this.source[my_before] === '\n' || this.source[my_before] === '\r')) {
      my_before--;
    }
    if (start_column !== 0 || my_before < 0 || this.source[my_before] !== ';') {
      return false;
    }
    let my_after = this.position;
    while (my_after < this.source.length && /\s/.test(this.source[my_after])) {
      my_after++;
    }
    return this.source[my_after] === ';';
  }


  /**
   * Whether no code token precedes the word starting on `start_line`
   * on its logical line. Block comments do not count as code, but a
   * run of them that opened on an earlier line counts from there, so
   * `end` after `x = 1` plus a block comment that spans lines is still
   * mid-line, while `end` after only such a comment is not. A `///`
   * joins the line to the one above.
   */
  private is_first_code_on_line(start_line: number): boolean {
    if (this.joined_to_previous_line) {
      return false;
    }
    const my_prev_code = this.previous_code_token;
    if (my_prev_code === null) {
      return true;
    }
    if (
      my_prev_code.type === 'STATEMENT_TERMINATOR' &&
      my_prev_code.value === '\n'
    ) {
      return true;
    }
    const my_line = this.comment_run_start_line ?? start_line;
    return my_prev_code.range.end.line < my_line;
  }


  /**
   * Check if the rest of the current line contains only whitespace or comments.
   * Used to determine if mata:/python: should start a block or be inline.
   * Returns true if only whitespace/comments (or nothing) remains until newline/EOF.
   * 
   * Examples that return true (block mode):
   *   - "mata:\n"           (nothing after colon)
   *   - "mata:   \n"        (only whitespace)
   *   - "mata: // comment\n" (whitespace + line comment)
   *   - "mata: [block comment]\n" (whitespace + block comment)
   *   - "mata:;\n" under `#delimit ;` (the `;` ends the opener)
   * 
   * Examples that return false (inline mode):
   *   - "mata: x = 5\n"     (code after colon)
   *   - "mata: x = 5 // comment\n" (code + comment)
   *   - "mata: * note\n"    (`*` after the colon is code: Stata 18 runs
   *     it as Mata, giving r(3499) "note not found")
   */
  private is_only_whitespace_or_comment_until_newline(): boolean {
    let my_pos = this.position;
    
    while (my_pos < this.source.length) {
      const my_char = this.source[my_pos];
      
      if (my_char === '\n' || my_char === '\r') {
        // Reached end of line - only whitespace/comments found
        return true;
      }
      
      if (my_char === ' ' || my_char === '\t') {
        // Skip whitespace
        my_pos++;
        continue;
      }

      // Under `#delimit ;`, the `;` ends the opener statement: Stata 18
      // opens a block at `mata:;` and `python:;`, and reads anything after
      // the `;` on the line as block content.
      if (my_char === ';' && this.state.delimiterMode === 'semicolon') {
        return true;
      }
      
      // Check for // line comment
      if (my_char === '/' && my_pos + 1 < this.source.length && 
          this.source[my_pos + 1] === '/') {
        // Rest of line is a comment - treat as block mode
        return true;
      }
      
      // Check for /* block comment */ (nestable, matching
      // consumeBlockCommentBody)
      if (my_char === '/' && my_pos + 1 < this.source.length &&
          this.source[my_pos + 1] === '*') {
        // Skip the (possibly nested) block comment, tracking depth
        my_pos += 2; // Skip the opening /*
        let my_depth = 1;
        while (my_pos + 1 < this.source.length && my_depth > 0) {
          if (this.source[my_pos] === '/' && this.source[my_pos + 1] === '*') {
            my_depth++;
            my_pos += 2; // Skip nested /*
            continue;
          }
          if (this.source[my_pos] === '*' && this.source[my_pos + 1] === '/') {
            my_depth--;
            my_pos += 2; // Skip */
            continue;
          }
          if (this.source[my_pos] === '\n') {
            // Block comment spans to next line - treat as block mode
            return true;
          }
          my_pos++;
        }
        // If still open, we reached EOF or near-EOF; treat an unclosed
        // block comment as block mode
        if (my_depth > 0) {
          return true;
        }
        continue;
      }
      
      // Found non-whitespace, non-comment content
      return false;
    }
    
    // Reached EOF - treat as end of line
    return true;
  }

  private get_current_context(): LanguageContext {
    if (!this.state.context_stack || this.state.context_stack.length === 0) {
      return LanguageContext.STATA;
    }
    return this.state.context_stack[this.state.context_stack.length - 1];
  }

  /** Remember the token just scanned for context-sensitive lexing. */
  private note_previous_token(token: Token): void {
    this.semicolon_statement.note(token, this.state.delimiterMode);
    if (token.type === 'WHITESPACE') {
      // Under `#delimit ;` a newline is whitespace; it still ends the
      // physical line a comment run sits on.
      if (token.value.includes('\n')) {
        this.comment_run_start_line = null;
      }
      return;
    }
    if (token.type === 'COMMENT_BLOCK') {
      this.comment_run_start_line ??= token.range.start.line;
    }
    if (token.type === 'CONTINUATION') {
      this.joined_to_previous_line = true;
    } else if (!COMMENT_TOKEN_TYPES.has(token.type)) {
      // The newline right after a `///` stays joined; any other code
      // starts a fresh logical line.
      const my_is_joined_newline =
        token.type === 'STATEMENT_TERMINATOR' &&
        token.value === '\n' &&
        this.previous_token?.type === 'CONTINUATION';
      this.joined_to_previous_line =
        this.joined_to_previous_line && my_is_joined_newline;
      this.comment_run_start_line = null;
      this.note_command_position(token);
      this.previous_code_token = token;
    }
    this.previous_token = token;
  }

  /** Track where commands start, for reading a `*` as a comment. */
  private note_command_position(token: Token): void {
    if (STATEMENT_START_TYPES.has(token.type)) {
      // The newline after `///` doesn't end the statement.
      if (is_swallowed_continuation_terminator(
        token, this.previous_token?.type === 'CONTINUATION')) {
        return;
      }
      if (token.type !== 'LBRACE' && token.type !== 'RBRACE') {
        this.in_mata_inline_statement = false;
        this.in_python_inline_statement = false;
      }
      this.at_command_start = true;
      this.command_word = null;
      return;
    }
    if (token.type === 'MATA_INLINE') {
      this.in_mata_inline_statement = true;
    }
    if (token.type === 'PYTHON_INLINE') {
      this.in_python_inline_statement = true;
    }
    if (token.type === 'COLON') {
      // `capture:` and `version 18:` start a command; `unab x :` and
      // `local m :` don't (Stata 18 reads `unab x : *` as a wildcard).
      const my_word = this.command_word;
      if (this.at_command_start || (my_word !== null &&
          STAR_COMMENT_COLON_PREFIXES.has(my_word))) {
        this.at_command_start = true;
        this.command_word = null;
      }
      return;
    }
    if (this.at_command_start && token.type === 'WORD') {
      if (ARGUMENT_FREE_PREFIXES.has(token.value)) {
        return;
      }
      this.command_word = token.value;
    }
    this.at_command_start = false;
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
    // A `mata:` or `python:` one-liner is Mata or Python code, where
    // `*` never starts a comment (`mata: * note` is r(3499) in Stata 18).
    if (this.in_mata_inline_statement || this.in_python_inline_statement) {
      return false;
    }
    // Rule 1: * at beginning of line (after optional whitespace) is a
    // comment where a command starts: at the start of a statement, or
    // after a prefix (`quietly` or `capture:` then `* note`). Elsewhere
    // it is code: under `#delimit ;`, `gen y = a` then `* b;`
    // multiplies, as does `gen y = a ///` then `* b` (Stata 18).
    if (this.is_at_line_start(start_line, start_column)) {
      return this.get_current_context() !== LanguageContext.STATA ||
        this.at_command_start;
    }
    
    // Rule 2: Check previous token context
    // A comment is whitespace here: look at the code before it.
    if (!this.previous_code_token) {
      // No previous token means we're at start of file - treat as comment
      return true;
    }
    
    const prev_token_type = this.previous_code_token.type;
    const prev_token_value = this.previous_code_token.value;
    
    // After statement terminators, * is likely a comment, but not
    // after the newline a `///` swallows (`a ///` then `/* c */ * b`).
    if (prev_token_type === 'STATEMENT_TERMINATOR') {
      return this.at_command_start;
    }
    
    // After opening braces, * is likely a comment
    if (prev_token_type === 'LBRACE') {
      return true;
    }
    
    // After a colon, * is a comment only where a command starts
    // (`capture: * note`); `unab x : *` and `mata: z = x :* y` are code.
    if (prev_token_type === 'COLON') {
      return this.at_command_start && !this.in_mata_inline_statement;
    }

    // After certain command keywords (case-sensitive), * is likely a comment
    // Keywords that expect expressions where * should be multiplication (case-sensitive)
    
    if (prev_token_type === 'WORD') {
      // `quietly * note` is a comment, but `gen r = quietly * 2`
      // multiplies a variable named quietly.
      if (ARGUMENT_FREE_PREFIXES.has(prev_token_value)) {
        return this.at_command_start;
      }
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

  /** Is only whitespace before this position on its line? */
  private is_at_line_start(start_line: number, start_column: number): boolean {
    if (start_column === 0) {
      return true;
    }
    const line_start_offset = this.line_offsets[start_line] || 0;
    const current_offset = this.position_to_offset(start_line, start_column);
    return /^\s*$/.test(this.source.substring(line_start_offset, current_offset));
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

      return null;
    }

    // Handle newlines (significant in cr mode)
    if (char === '\n') {
      if (this.state.delimiterMode === 'cr') {
        return {
          type: 'STATEMENT_TERMINATOR',
          value: '\n',
          range: this.makeRange(startLine, startColumn, this.line, this.column),
        };
      }
      return null;
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
        return this.scan_star_comment(startLine, startColumn);
      }
      // Otherwise, fall through to operator handling
    }

    // A `//` or `///` with code right before it is code, not a comment
    // or a continuation: Stata 18 stores `local a b///` as `b///` and
    // runs the next line as its own command, and reads `di 4//2` as
    // division. Each of its slashes is then an operator.
    if (char === '/' && this.peek() === '/' &&
        !this.is_comment_slash_position(startColumn)) {
      this.note_tight_continuation(startLine, startColumn);
      return this.makeToken('OPERATOR', char, startLine, startColumn);
    }

    // Under `#delimit ;`, a `//` or `///` at column 0 is a comment
    // only on a statement's first line. Later in the statement it is
    // code: Stata 18 stores `local a b` / `/// x` / `c;` as `b /// x c`.
    if (char === '/' && this.peek() === '/' && startColumn === 0 &&
        this.state.delimiterMode === 'semicolon' &&
        this.semicolon_statement.is_open) {
      this.note_slashes_mid_statement(startLine);
      return this.makeToken('OPERATOR', char, startLine, startColumn);
    }

    if (char === '/' && this.peek() === '/') {
      this.advance(); // consume second /

      // Check for continuation comment ///
      if (this.peek() === '/') {
        this.advance(); // consume third /

        // A `///` (or a longer run of slashes) after whitespace is a
        // continuation; Stata 18 joins `b ////////` to the next line.
        // One that starts a line continues a chain (`a ///`,
        // `////////`, `b` is `a b`). Otherwise it starts a statement
        // and Stata reads the next line as that statement, so it is a
        // comment, at any indentation.
        if (this.is_at_line_start(startLine, startColumn) &&
            this.slash_line_starts_statement()) {
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
        return this.makeToken('OPERATOR', char, startLine, startColumn);
      case '~':
        if (this.peek() === '=') {
          this.advance();
          return this.makeToken('OPERATOR', '~=', startLine, startColumn);
        }
        return this.makeToken('OPERATOR', '~', startLine, startColumn);
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

    // Mata has `//` and `/* */` comments (and `///` joins lines).
    // Python block content is handed to Python as written: `//` is
    // floor division and `/*` is code, and Stata does not join `///`
    // lines there. In neither language does `*` start a comment (in
    // Mata it multiplies or dereferences a pointer).
    if (this.get_current_context() === LanguageContext.MATA) {
      if (first_char === '/' && this.peek() === '/') {
        this.advance();
        if (this.peek() === '/') {
          this.advance();
          return this.scanContinuationComment(startLine, startColumn);
        }
        return this.scanLineComment(startLine, startColumn, 'slash');
      }

      if (first_char === '/' && this.peek() === '*') {
        this.advance();
        return this.scanBlockComment(startLine, startColumn);
      }
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

  /**
   * Scan a `*` comment in Stata code, ending where Stata 18 ends it.
   *
   * In cr mode it ends at the end of the line, unless a ` ///` there
   * joins the next line into it (`* c ///` then `gen q = 1` runs
   * nothing). Under `#delimit ;` it ends at the next `;`, across
   * lines, and takes that `;`; with none, it runs to the end of the
   * file, past any `#delimit cr`.
   *
   * A `;` or `///` does not count inside `"..."` (a `"` right after a
   * backtick opens no quote), inside a block comment, or after a `//` that
   * follows a space or tab; that `//` hides the rest of its line. In
   * cr mode a quote ends at the end of the line.
   */
  private scan_star_comment(start_line: number, start_column: number): Token {
    const ends_at_semicolon = this.state.delimiterMode === 'semicolon';
    let in_quote = false;
    while (!this.isAtEnd()) {
      // A comment that runs to the end of the file leaves the trailing
      // whitespace out.
      if (ends_at_semicolon && this.position >= this.content_end_offset) {
        break;
      }
      const my_char = this.peek();
      if (my_char === '\n') {
        if (!ends_at_semicolon) {
          break;
        }
        this.advance();
        continue;
      }
      if (in_quote) {
        in_quote = my_char !== '"';
        this.advance();
        continue;
      }
      if (my_char === ';' && ends_at_semicolon) {
        this.advance();
        break;
      }
      if (my_char === '"' && this.source[this.position - 1] !== '`') {
        in_quote = true;
        this.advance();
        continue;
      }
      if (my_char === '/' && this.peekNext() === '*') {
        this.scan_block_comment_in_star_comment();
        continue;
      }
      const my_previous_char = this.source[this.position - 1];
      if (my_char === '/' && this.peekNext() === '/' &&
          (my_previous_char === ' ' || my_previous_char === '\t')) {
        const is_continuation = this.source[this.position + 2] === '/';
        while (this.peek() !== '\n' && !this.isAtEnd()) {
          this.advance();
        }
        if (!ends_at_semicolon && !is_continuation) {
          break;
        }
        if (!ends_at_semicolon) {
          this.advance(); // `///` joins the next line into the comment
        }
        continue;
      }
      this.advance();
    }

    const value = this.source.substring(
      this.position_to_offset(start_line, start_column), this.position);
    return {
      type: 'COMMENT_LINE',
      value,
      range: this.makeRange(start_line, start_column, this.line, this.column),
    };
  }

  /**
   * Consume a block comment inside a `*` comment, warning when it spans
   * lines:
   * Stata then reads those lines as part of the comment.
   */
  private scan_block_comment_in_star_comment(): void {
    const my_block_start_line = this.line;
    const my_block_start_column = this.column;
    this.advance(); // consume /
    this.advance(); // consume *

    this.consumeBlockCommentBody();

    if (this.line !== my_block_start_line) {
      this.errors.push({
        message: 'Block comment `/* */` inside star comment causes'
          + ' multi-line comment behavior \u2014 subsequent lines until'
          + ' `*/` will be treated as comment by Stata',
        range: this.makeRange(
          my_block_start_line, my_block_start_column,
          this.line, this.column
        ),
        code: LexerErrorCode.BLOCK_COMMENT_IN_STAR_COMMENT,
      });
    }
  }

  private scanLineComment(startLine: number, startColumn: number, style: 'star' | 'slash'): Token {
    // Consume until end of line, but watch for /* in star comments.
    // In Stata, /* inside a * comment opens a block comment that extends
    // to the matching */ — potentially spanning multiple lines.
    while (this.peek() !== '\n' && !this.isAtEnd()) {
      if (style === 'star' && this.peek() === '/' && this.peekNext() === '*') {
        this.scan_block_comment_in_star_comment();
        // Continue scanning the rest of the line (star comment still active)
        continue;
      }
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
    this.consumeBlockCommentBody();

    const value = this.source.substring(this.position_to_offset(startLine, startColumn), this.position);
    return {
      type: 'COMMENT_BLOCK',
      value,
      range: this.makeRange(startLine, startColumn, this.line, this.column),
    };
  }

  private consumeBlockCommentBody(): void {
    let depth = 1;

    while (!this.isAtEnd() && depth > 0) {
      if (this.peek() === '/' && this.peekNext() === '*') {
        this.advance(); // consume /
        this.advance(); // consume *
        depth++;
        continue;
      }

      if (this.peek() === '*' && this.peekNext() === '/') {
        this.advance(); // consume *
        this.advance(); // consume /
        depth--;
        continue;
      }

      this.advance();
    }
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

    // A comment after the mode is its own token, so its text and any
    // Sight directive in it are kept: Stata 18 accepts
    // `#delimit ; // c`, `#delimit cr /* c */`, and `#delimit ; * c`.
    // Anything else up to the end of the line stays in the directive
    // token. A `///` is left there too: it would join the next line.
    let comment_start = this.position;
    while (this.source[comment_start] === ' ' || this.source[comment_start] === '\t') {
      comment_start++;
    }
    const rest = this.source.substring(comment_start, comment_start + 3);
    const starts_comment = (rest.startsWith('//') && rest !== '///') ||
      rest.startsWith('/*') || rest.startsWith('*');
    if (!starts_comment) {
      while (this.peek() !== '\n' && !this.isAtEnd()) {
        this.advance();
      }
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
      this.note_program_definition_word(value, startLine);
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
        
        // First check for mata: syntax (mata followed by colon)
        // This takes precedence because "capture mata:" should be recognized
        if (this.peek() === ':') {
          this.advance(); // consume the colon
          const full_value = value + ':';
          
          // Lookahead: check if there's content on the same line after the colon
          // (whitespace and comments don't count as content)
          if (this.is_only_whitespace_or_comment_until_newline()) {
            // mata: followed by newline/comment = block start
            this.push_context(LanguageContext.MATA);
            this.state.embedded_block_start_line = startLine;
            return {
              type: 'MATA_START',
              value: full_value,
              range: this.makeRange(startLine, startColumn, this.line, this.column),
            };
          } else {
            // mata: followed by content = inline expression
            return {
              type: 'MATA_INLINE',
              value: full_value,
              range: this.makeRange(startLine, startColumn, this.line, this.column),
            };
          }
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
          
          // Lookahead: check if there's content on the same line after the colon
          // (whitespace and comments don't count as content)
          if (this.is_only_whitespace_or_comment_until_newline()) {
            // python: followed by newline/comment = block start
            this.push_context(LanguageContext.PYTHON);
            this.note_python_block_opener();
            this.state.embedded_block_start_line = startLine;
            return {
              type: 'PYTHON_START',
              value: full_value,
              range: this.makeRange(startLine, startColumn, this.line, this.column),
            };
          } else {
            // python: followed by content = inline expression
            return {
              type: 'PYTHON_INLINE',
              value: full_value,
              range: this.makeRange(startLine, startColumn, this.line, this.column),
            };
          }
        }
        
        // Check if previous token was "end" - if so, this is "end python" not a block start
        const prev_is_end = this.previous_token && 
          this.previous_token.type === 'WORD' && 
          this.previous_token.value === 'end';
        
        if (!prev_is_end) {
          this.push_context(LanguageContext.PYTHON);
          this.note_python_block_opener();
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
      // And only where Stata ends the block (see is_end_at_line_start)
      if (this.is_end_delimiter(value) && this.state.embedded_brace_depth === undefined) {
        if (this.is_end_at_line_start(startLine)) {
          this.consume_end_tail();
          this.program_definition_open = false;
          this.pop_context();
          this.state.embedded_block_start_line = undefined;
          return {
            type: 'END_MATA',
            value: this.source.substring(
              this.position_to_offset(startLine, startColumn),
              this.position
            ),
            range: this.makeRange(startLine, startColumn, this.line, this.column),
          };
        }
        // 'end' followed by other code - treat as WORD, not block terminator
      }
    } else if (my_current_context === LanguageContext.PYTHON) {
      // In Python context, check for end delimiter (case-sensitive)
      // But NOT if we're in a brace-style block (python { ... })
      // And only where Stata ends the block (see is_python_block_end),
      // or where it ends an enclosing program definition
      if (this.is_end_delimiter(value) && this.state.embedded_brace_depth === undefined) {
        const my_ends_program = this.program_definition_open &&
          this.is_end_at_line_start(startLine);
        if (my_ends_program || this.is_python_block_end(startColumn)) {
          this.consume_end_tail();
          this.program_definition_open = false;
          this.pop_context();
          this.state.embedded_block_start_line = undefined;
          return {
            type: 'END_PYTHON',
            value: this.source.substring(
              this.position_to_offset(startLine, startColumn),
              this.position
            ),
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
   * Can a `//` or `///` starting at this column start a comment or a
   * continuation? Only at the start of a line, after a space or tab,
   * or after the `;` that ends a statement under `#delimit ;` (Stata 18
   * reads `local a b;// c` there as `local a b`). Anything else before
   * the slashes, even a quote, a parenthesis, a brace, or the end of a
   * block comment, makes them code.
   */
  private is_comment_slash_position(start_column: number): boolean {
    if (start_column === 0) {
      return true;
    }
    const before = this.source[this.position - 2];
    return before === ' ' || before === '\t' ||
      (before === ';' && this.state.delimiterMode === 'semicolon');
  }

  /**
   * Whether a `///` line starts a statement rather than continuing one:
   * under `#delimit cr`, the line above has no `///`; under
   * `#delimit ;`, the statement has nothing in it yet.
   */
  private slash_line_starts_statement(): boolean {
    return this.state.delimiterMode === 'semicolon'
      ? !this.semicolon_statement.is_open
      : !this.state.in_continuation;
  }

  /**
   * Warn at a column-0 run of slashes that is code because the
   * `#delimit ;` statement began on an earlier line.
   */
  private note_slashes_mid_statement(start_line: number): void {
    const slash_offset = this.position - 1;
    let my_end = slash_offset;
    while (this.source[my_end] === '/') {
      my_end++;
    }
    this.errors.push({
      message: 'Under `#delimit ;`, `//` at the start of a line is a'
        + ' comment only on the first line of a statement. This'
        + ' statement began on an earlier line (a comment does not end'
        + ' it), so Stata reads these slashes as code. Indent the line,'
        + ' or end the statement with `;` first.',
      range: this.makeRange(
        start_line, 0, start_line, my_end - slash_offset
      ),
      code: LexerErrorCode.SLASHES_MID_STATEMENT,
    });
  }

  /**
   * Warn at the first slash of a `///` (or longer run) that is code
   * because nothing separates it from the code before it. Under
   * `#delimit cr` the next line then runs as its own command; under
   * `#delimit ;` the slashes and any note after them stay in the
   * command.
   */
  private note_tight_continuation(start_line: number, start_column: number): void {
    const slash_offset = this.position - 1;
    if (this.source[slash_offset - 1] === '/' ||
        this.source[slash_offset + 2] !== '/') {
      return;
    }
    let my_end = slash_offset;
    while (this.source[my_end] === '/') {
      my_end++;
    }
    const consequence = this.state.delimiterMode === 'semicolon'
      ? 'the slashes and anything after them stay in the command'
      : 'the next line runs as a separate command';
    this.errors.push({
      message: '`///` is not a line continuation unless a space or tab'
        + ` comes before it; here ${consequence}. Add a space before`
        + ' `///`.',
      range: this.makeRange(
        start_line, start_column,
        start_line, start_column + (my_end - slash_offset)
      ),
      code: LexerErrorCode.CONTINUATION_NO_SPACE,
    });
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
