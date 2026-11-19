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
  PROGRAM_COMMAND_NAMES,
  program_header_text,
} from '../utils/program-definition';
import { SemicolonStatementTracker } from '../utils/semicolon-statement';
import { delimit_keyword_length } from '../utils/delimit-directive';
import {
  is_name_letter,
  is_name_letter_or_digit,
} from '../utils/stata-name';
import {
  create_input_quote_scan,
  input_declaration_fields,
  input_row_end,
  InputQuoteScan,
  is_input_brace_row,
  is_input_data_row,
  is_input_end_row,
} from '../utils/input-data';
import {
  COLON_PREFIX_COMMANDS,
  PREFIX_COMMANDS,
} from '../utils/stata-prefix-commands';

const EXPRESSION_CONTEXT_KEYWORDS = new Set(['if', 'else', 'foreach', 'forvalues', 'while', 'gen', 'generate', 'replace', 'egen', 'set', 'scalar', 'matrix', 'return']);
// The names Stata takes for `input`.
const INPUT_COMMAND_NAMES: ReadonlySet<string> = new Set(['inp', 'inpu', 'input']);
// The newline before a line whose first word is `end`, which ends
// `input` data: blanks, then `end` not followed by a word character
// or `.`.
const INPUT_END_LINE = /\n[ \t]*end(?![A-Za-z0-9_.])/g;
// Under `#delimit ;`, the `;` before a record whose first word is
// `end`, which ends `input` data (StataMP 18).
const INPUT_END_RECORD = /;\s*end(?![A-Za-z0-9_.])/g;
const CHAR_SPACE = 32;
const CHAR_TAB = 9;
const CHAR_LF = 10;
const CHAR_CR = 13;
const CHAR_VT = 11;
const CHAR_FF = 12;
const CHAR_COLON = 58;
const CHAR_SLASH = 47;
const CHAR_UNDERSCORE = 95;

function is_ascii_letter_or_underscore(code: number): boolean {
  return (code >= 65 && code <= 90) || (code >= 97 && code <= 122) ||
    code === CHAR_UNDERSCORE;
}

function is_ascii_word_char(code: number): boolean {
  return is_ascii_letter_or_underscore(code) || (code >= 48 && code <= 57);
}

/** A blank on a line; with `across_lines`, a line break as well. */
function is_row_blank(code: number, across_lines: boolean): boolean {
  if (code === CHAR_SPACE || code === CHAR_TAB || code === CHAR_CR) {
    return true;
  }
  return across_lines &&
    (code === CHAR_LF || code === CHAR_VT || code === CHAR_FF);
}
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
// Prefixes whose colon starts a command that may be `mata:` or
// `python:` (`mi xeq: mata: x`, `by g: mata: x`): every colon prefix.
// Stata 18 reads the word after any of them as the command.
const EMBEDDED_OPENER_COLON_PREFIXES: ReadonlySet<string> = new Set([
  ...COLON_PREFIX_COMMANDS.keys(),
  ...[...PREFIX_COMMANDS].filter(([, my_name]) =>
    my_name === 'by' || my_name === 'bysort').map(([my_word]) => my_word),
  'frame',
]);
// Tokens an `if` condition's operand can end with, and those that
// can follow an operator or `(` inside one.
const CONDITION_OPERAND_TYPES: ReadonlySet<TokenType> = new Set<TokenType>([
  'WORD', 'NUMBER', 'STRING', 'MACRO_REF_LOCAL', 'MACRO_REF_GLOBAL',
]);
const CONDITION_OPERAND_END_TYPES: ReadonlySet<TokenType> = new Set<TokenType>([
  ...CONDITION_OPERAND_TYPES, 'RPAREN', 'RBRACKET',
]);
// A statement starts after one of these (or at the start of the file).
const STATEMENT_START_TYPES: ReadonlySet<TokenType> = new Set<TokenType>([
  'STATEMENT_TERMINATOR', 'DELIMIT_DIRECTIVE', 'LBRACE', 'RBRACE',
  'END_MATA', 'END_PYTHON',
]);

/**
 * The offset just past the `*\/` that closes the block comment opening
 * at `start` in `source`, or `limit` (by default the source's length)
 * if none does before it. Block comments nest, as in Stata.
 */
function block_comment_end(
  source: string, start: number, limit = source.length
): number {
  let my_depth = 0;
  let i = start;
  while (i < limit) {
    if (source[i] === '/' && source[i + 1] === '*') {
      my_depth++;
      i += 2;
    } else if (source[i] === '*' && source[i + 1] === '/') {
      my_depth--;
      i += 2;
      if (my_depth === 0) {
        return i;
      }
    } else {
      i++;
    }
  }
  return limit;
}

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
  // Whether the statement is an `if` (or `else if`), its `if`, and
  // whether its condition has ended (a command has started), for
  // finding where a one-line `if`'s command starts.
  private in_if_statement = false;
  private if_keyword_token: Token | null = null;
  // The last token that counts for where commands start (not a
  // newline a `///` swallows), and whether it began where one can.
  private command_previous_token: Token | null = null;
  private previous_started_command = true;
  private if_condition_done = false;
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
  // Whether a command starts at the next code token for opening
  // embedded code, though not for reading a `*` as a comment: after
  // the colon of `mi xeq:`, `by g:` and the like (see
  // EMBEDDED_OPENER_COLON_PREFIXES), or of a macro that starts the
  // command (`` `run': python:``, the macro holding a prefix).
  private at_prefixed_command_start = false;
  // The word naming the command after a prefix's colon (`notes` in
  // `mi xeq: notes:`), until the next colon or statement.
  private prefixed_command_word: string | null = null;
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
  // An `input` statement has begun, so the lines after it are data.
  private input_data_pending = false;
  // Offset just past the `input` word, where its declaration starts.
  private input_declaration_start = 0;
  // How many `{` blocks of Stata code are open here, and were open at
  // the pending `input` (see scan_input_data).
  private stata_brace_depth = 0;
  private input_brace_depth = 0;
  // The last search for an `end` after `input` data (see
  // next_input_end_candidate).
  private input_end_candidate:
    { searched_from: number; index: number; is_semicolon: boolean } | null = null;
  // The last yes of input_end_follows_unclaimed: rows from `from` up
  // to `until` (the row of the `end` that closes the data) are data.
  private input_end_lookahead: {
    from: number; until: number; is_semicolon: boolean;
  } | null = null;
  // Where `input` data quotes have no closing quote (see input_row_end).
  private input_quote_scan: InputQuoteScan = create_input_quote_scan();
  // The offset of the source's last `"`, once looked up (see
  // unclosed_string_stop), or -1 if it has none.
  private last_double_quote_offset: number | null = null;

  tokenize(source: string, initialState?: LexerState): LexerResult {
    this.source = source;
    this.position = 0;
    this.line = 0;
    this.column = 0;
    this.line_offsets = [0]; // First line starts at offset 0
    this.content_end_offset = source.trimEnd().length;
    this.previous_token = null;
    this.previous_code_token = null;
    this.in_if_statement = false;
    this.if_keyword_token = null;
    this.if_condition_done = false;
    this.previous_started_command = true;
    this.command_previous_token = null;
    this.comment_run_start_line = null;
    this.joined_to_previous_line = false;
    this.at_command_start = true;
    this.command_word = null;
    this.at_prefixed_command_start = false;
    this.prefixed_command_word = null;
    this.in_mata_inline_statement = false;
    this.in_python_inline_statement = false;
    this.program_definition_open = false;
    this.python_block_reads_statements = false;
    this.semicolon_statement = new SemicolonStatementTracker();
    this.input_data_pending = false;
    this.input_declaration_start = 0;
    this.stata_brace_depth = 0;
    this.input_brace_depth = 0;
    this.input_end_candidate = null;
    this.input_quote_scan = create_input_quote_scan();
    this.input_end_lookahead = null;
    this.last_double_quote_offset = null;
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
   * word starting on `start_line`, and return whether the word opens
   * one: `program` (or an abbreviation) as the first code of a
   * statement (see at_statement_start) followed by a definition header
   * (see is_program_definition_header). An `end` that begins its
   * logical line closes the definition. Stata ends a definition at
   * the first such `end`, so a `program define` inside one is body
   * text; the parser still reads it as a nested definition, as it
   * did before this flag, but it leaves the open definition open.
   */
  private note_program_definition_word(value: string, start_line: number): boolean {
    if (PROGRAM_COMMAND_NAMES.has(value) && this.at_statement_start()) {
      const my_is_header = is_program_definition_header(
        program_header_text(this.source, this.position,
          this.state.delimiterMode === 'semicolon'));
      this.program_definition_open ||= my_is_header;
      return my_is_header;
    }
    if (value === 'end' && this.program_definition_open &&
        this.is_end_at_line_start(start_line)) {
      this.program_definition_open = false;
    }
    return false;
  }

  /**
   * Note an `input` command (`inp` … `input`) where a command starts,
   * after any prefixes (`quietly input x`) or a one-line `if`'s
   * condition (`if 1 input x`), whose data starts after the statement.
   * Inside a program definition there is no data: Stata ends the
   * definition at the data's `end` (StataMP 18).
   */
  private note_input_command_word(
    value: string, start_line: number, start_column: number,
  ): void {
    if (INPUT_COMMAND_NAMES.has(value) && !this.program_definition_open &&
        (this.at_command_start ||
          this.if_condition_ends_before(start_line, start_column))) {
      this.input_data_pending = true;
      this.input_declaration_start = this.position;
      this.input_brace_depth = this.stata_brace_depth;
    }
  }

  /**
   * The data after an `input` statement, from the current position
   * just past the newline (or, under `#delimit ;`, the `;`) that ends
   * it. StataMP 18 reads the data literally, without expanding macros,
   * as lines (or `;`-ended records) up to one whose first word is
   * `end`, unless it stops sooner because it has filled the dataset's
   * observations. Sight can't know those, so the data also ends before
   * the first row that does not fit the variables `input` declares
   * (see src/utils/input-data.ts): `input score` then `10` then
   * `local label score` is one row of data, as is `input str5 city`
   * then `Paris` then `local n = _N`.
   *
   * The data is one INPUT_DATA token holding the rows as written; it
   * stops before the terminator that ends the last row, and is empty
   * when `end` comes right after `input`. When an `end` closes it,
   * that terminator, the `end` word and the rest of its line (or
   * record), which Stata discards (see scan_end_tail_tokens), follow;
   * when the data stopped before an inconsistent row, only the
   * terminator does, and that row is lexed as code.
   *
   * Null, consuming nothing, when no `end` follows, or when the data
   * stops before any row with something in it.
   */
  private scan_input_data(): Token[] | null {
    const is_semicolon = this.state.delimiterMode === 'semicolon';
    const the_fields = input_declaration_fields(this.source.substring(
      this.input_declaration_start, this.position - 1));
    // Any declaration Sight can read can end the data at a row that
    // does not fit it.
    const can_stop_early = the_fields !== null;
    let my_row_start = this.position;
    let my_data_end = -1;
    let my_has_rows = false;
    let my_ended_by_end = false;
    for (;;) {
      // No row can start with `end` past the last candidate, so data
      // that can't stop early has no end (this keeps a file of many
      // `input` blocks with unreadable declarations and no `end`
      // linear).
      if (!can_stop_early &&
          this.next_input_end_candidate(my_row_start - 1, is_semicolon) === -1) {
        return null;
      }
      if (is_input_end_row(this.source, my_row_start, is_semicolon)) {
        my_ended_by_end = true;
        break;
      }
      if (my_row_start >= this.source.length) {
        return null;
      }
      const my_row_end = input_row_end(
        this.source, my_row_start, is_semicolon, this.input_quote_scan);
      const my_row = this.source.substring(my_row_start, my_row_end);
      if (this.input_brace_depth > 0 && is_input_brace_row(my_row)) {
        break;
      }
      if (the_fields !== null && !is_input_data_row(my_row, the_fields) &&
          !this.input_end_follows_unclaimed(my_row_start, is_semicolon)) {
        break;
      }
      my_has_rows = my_has_rows || my_row.trim() !== '';
      my_data_end = my_row_end;
      if (my_row_end >= this.source.length) {
        return null;
      }
      my_row_start = my_row_end + 1;
    }
    if (!my_ended_by_end && !my_has_rows) {
      return null;
    }
    const data_end = my_ended_by_end
      ? Math.max(this.position, my_row_start - 1)
      : my_data_end;
    if (is_semicolon) {
      // Data on the lines after `input x;` starts on the next line.
      let my_pos = this.position;
      while (this.source[my_pos] === ' ' || this.source[my_pos] === '\t' ||
          this.source[my_pos] === '\r') {
        my_pos++;
      }
      if (this.source[my_pos] === '\n' && my_pos < data_end) {
        while (this.position <= my_pos) {
          this.advance();
        }
      }
    }
    const the_tokens: Token[] = [];
    the_tokens.push(this.scan_raw_token('INPUT_DATA', data_end));
    if (this.source[this.position] === (is_semicolon ? ';' : '\n')) {
      the_tokens.push(this.scan_raw_token('STATEMENT_TERMINATOR', this.position + 1));
    }
    if (!my_ended_by_end) {
      return the_tokens;
    }
    while (/\s/.test(this.peek()) && this.position < this.source.length) {
      this.advance();
    }
    the_tokens.push(this.scan_raw_token('WORD', this.position + 'end'.length));
    the_tokens.push(...this.scan_end_tail_tokens(is_semicolon));
    return the_tokens;
  }

  /**
   * Whether the `input` data row starting at `row_start`, which does
   * not fit the declared variables, is data all the same: the next row
   * whose first word is `end` closes the data, and no row from this
   * one up to it opens a block that needs an `end` of its own (a
   * program definition, a `mata` or `python` block, another `input`).
   * StataMP 18 reads such a row as data (it ignores extra fields, and
   * drops a row with text for a number after "cannot be read as a
   * number"), so `1 2` then `end` under `input x` is data. When such a
   * block opens first, that `end` is its own, and when no `end`
   * follows, nothing closes the data: either way the data ended before
   * this row, which is code.
   *
   * One scan per data block: a later row of the same block up to the
   * same `end` reuses the answer (see input_end_lookahead).
   */
  private input_end_follows_unclaimed(row_start: number, is_semicolon: boolean): boolean {
    const my_cache = this.input_end_lookahead;
    if (my_cache !== null && my_cache.is_semicolon === is_semicolon &&
        my_cache.from <= row_start && row_start < my_cache.until) {
      return true;
    }
    if (this.next_input_end_candidate(row_start - 1, is_semicolon) === -1) {
      return false;
    }
    let my_row_start = row_start;
    let my_is_data = false;
    while (my_row_start < this.source.length) {
      if (is_input_end_row(this.source, my_row_start, is_semicolon)) {
        my_is_data = true;
        break;
      }
      const my_row_end = input_row_end(
        this.source, my_row_start, is_semicolon, this.input_quote_scan);
      if (this.input_row_opens_block(my_row_start, my_row_end, is_semicolon) ||
          (this.input_brace_depth > 0 && is_input_brace_row(
            this.source.substring(my_row_start, my_row_end)))) {
        break;
      }
      my_row_start = my_row_end + 1;
    }
    // Only a yes is kept: after a no the data ends, and a later block
    // must not reuse it.
    if (my_is_data) {
      this.input_end_lookahead = { from: row_start, until: my_row_start, is_semicolon };
    }
    return my_is_data;
  }

  /**
   * Whether the row from `start` to `end` (a line, or a `;` record)
   * opens a block that needs its own `end`: a program definition (by
   * is_program_definition_header, as for any `program` statement), a
   * `mata` or `python` block (the word, an optional `:`, and nothing
   * else but blanks and a comment), or another `input`. The block may
   * follow the prefixes where the lexer opens it: `mata` and `python`
   * after argument-free prefixes (`quietly`, `capture:`) and the colon
   * of any colon prefix (`by g:`, `version 18:`, `frame f:`); `input`
   * after those, except `by` and the estimation-style colon prefixes
   * (StataMP 18: "input may not be combined with by"); a program
   * definition only with no prefix.
   */
  private input_row_opens_block(start: number, end: number, is_semicolon: boolean): boolean {
    // Scanned by hand, one pass from `start` to `end`: the first word
    // of a data line after blanks, or of a `;` record after blanks and
    // line breaks, then the word after each prefix.
    const my_source = this.source;
    let my_word_start = start;
    let my_has_prefix = false;
    let my_takes_input = true;
    let my_word = '';
    let my_word_end = start;
    for (;;) {
      while (my_word_start < end &&
          is_row_blank(my_source.charCodeAt(my_word_start), is_semicolon)) {
        my_word_start++;
      }
      if (my_word_start >= end ||
          !is_ascii_letter_or_underscore(my_source.charCodeAt(my_word_start))) {
        return false;
      }
      my_word_end = my_word_start + 1;
      while (my_word_end < end &&
          is_ascii_word_char(my_source.charCodeAt(my_word_end))) {
        my_word_end++;
      }
      my_word = my_source.substring(my_word_start, my_word_end);
      if (ARGUMENT_FREE_PREFIXES.has(my_word)) {
        // `quietly`, or `capture:` with its optional colon.
        my_word_start = my_word_end;
        while (my_word_start < end &&
            is_row_blank(my_source.charCodeAt(my_word_start), is_semicolon)) {
          my_word_start++;
        }
        if (my_word_start < end &&
            my_source.charCodeAt(my_word_start) === CHAR_COLON) {
          my_word_start++;
        }
        my_has_prefix = true;
        continue;
      }
      if (!EMBEDDED_OPENER_COLON_PREFIXES.has(my_word)) {
        break;
      }
      // A colon prefix (`version 18:`, `by g (t):`): the command
      // starts after the colon on this row, if it has one.
      let my_colon = my_word_end;
      while (my_colon < end && my_source.charCodeAt(my_colon) !== CHAR_COLON) {
        my_colon++;
      }
      if (my_colon >= end) {
        return false;
      }
      my_takes_input = my_takes_input && STAR_COMMENT_COLON_PREFIXES.has(my_word);
      my_has_prefix = true;
      my_word_start = my_colon + 1;
    }
    if (PROGRAM_COMMAND_NAMES.has(my_word)) {
      if (my_has_prefix) {
        return false;
      }
      return is_program_definition_header(
        program_header_text(my_source, my_word_end, is_semicolon));
    }
    if (my_word === 'mata' || my_word === 'python') {
      // What may follow on a line that opens a block: an optional `:`,
      // then blanks and perhaps a `//` comment.
      // Blanks may come before the colon (`mata :`), as where the
      // lexer opens the block.
      let my_tail = my_word_end;
      let my_colon = my_tail;
      while (my_colon < end &&
          is_row_blank(my_source.charCodeAt(my_colon), false)) {
        my_colon++;
      }
      if (my_colon < end && my_source.charCodeAt(my_colon) === CHAR_COLON) {
        my_tail = my_colon + 1;
      }
      while (my_tail < end &&
          is_row_blank(my_source.charCodeAt(my_tail), false)) {
        my_tail++;
      }
      if (my_tail + 1 < end &&
          my_source.charCodeAt(my_tail) === CHAR_SLASH &&
          my_source.charCodeAt(my_tail + 1) === CHAR_SLASH) {
        const my_line_end = my_source.indexOf('\n', my_tail);
        my_tail = my_line_end === -1 || my_line_end > end ? end : my_line_end;
      }
      while (my_tail < end &&
          is_row_blank(my_source.charCodeAt(my_tail), true)) {
        my_tail++;
      }
      return my_tail >= end;
    }
    return my_takes_input && INPUT_COMMAND_NAMES.has(my_word);
  }

  /**
   * The offset of the first newline (or, under `#delimit ;`, `;`)
   * at or after `from` that blanks and then `end` follow, or -1 if
   * none does. Searches resume where the last one left off, so lexing
   * a file costs one pass over it.
   */
  private next_input_end_candidate(from: number, is_semicolon: boolean): number {
    const my_cache = this.input_end_candidate;
    if (my_cache !== null && my_cache.is_semicolon === is_semicolon &&
        my_cache.searched_from <= from &&
        (my_cache.index === -1 || my_cache.index >= from)) {
      return my_cache.index;
    }
    const my_pattern = is_semicolon ? INPUT_END_RECORD : INPUT_END_LINE;
    my_pattern.lastIndex = from;
    const my_index = my_pattern.exec(this.source)?.index ?? -1;
    this.input_end_candidate = { searched_from: from, index: my_index, is_semicolon };
    return my_index;
  }

  /**
   * The rest of the line (or, under `#delimit ;`, of the record) after
   * an input data's `end`, which Stata discards, so a `/*` or a quote
   * there opens nothing. Each block comment there is a COMMENT_BLOCK
   * token, as is an unclosed `/*` and what follows it; other text is
   * a COMMENT_LINE token. So comment normalization reads a block
   * comment as one, and rewrites the rest once into a comment that
   * stays as written. Blanks between them are left out; the `;` that
   * ends the record is left to be lexed.
   */
  private scan_end_tail_tokens(is_semicolon: boolean): Token[] {
    const the_tokens: Token[] = [];
    let tail_end = is_semicolon
      ? this.source.indexOf(';', this.position)
      : this.source.indexOf('\n', this.position);
    if (tail_end < 0) {
      tail_end = this.source.length;
    }
    tail_end = this.position +
      this.source.substring(this.position, tail_end).trimEnd().length;
    for (;;) {
      while (this.peek() === ' ' || this.peek() === '\t') {
        this.advance();
      }
      if (this.position >= tail_end) {
        return the_tokens;
      }
      if (!this.source.startsWith('/*', this.position)) {
        the_tokens.push(this.scan_raw_token('COMMENT_LINE', tail_end));
        return the_tokens;
      }
      // Only to the end of the tail, so a `/*` left open there costs
      // no scan to the end of the file (a file of many `end /*` lines
      // was quadratic).
      const my_comment_end = block_comment_end(
        this.source, this.position, tail_end);
      the_tokens.push(this.scan_raw_token('COMMENT_BLOCK', my_comment_end));
    }
  }

  /** A token of `type` for the source from here up to offset `end`. */
  private scan_raw_token(type: TokenType, end: number): Token {
    const start_line = this.line;
    const start_column = this.column;
    const start = this.position;
    while (this.position < end) {
      this.advance();
    }
    return this.makeToken(
      type, this.source.substring(start, end), start_line, start_column);
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
   * Whether the next code token is the first code of a statement, which
   * is the only place StataMP 18 reads `#delimit`: at the start of the
   * file, after a `#delimit` directive, or after a statement terminator
   * (a newline that no `///` joins, or a `;` under `#delimit ;`, also
   * mid-line: `di 1; #d cr`), with only blanks and block comments
   * between (a block comment, then `#d ;`). Not after a `///` join,
   * a block comment that opened after code on the line above, a `{`,
   * a prefix (`quietly #d ;`), or mid-statement at the start of a line
   * under `#delimit ;` (`di 1` then `#d cr` is `di 1 #d cr`).
   * The `end` of a Mata block also ends a statement under
   * `#delimit ;` without a `;` (StataMP 18 reads `#d cr` on the next
   * line); the `end` of a Python block, a program or `input` data
   * there, and a `}`, need their `;`.
   */
  private at_statement_start(): boolean {
    const my_prev_code = this.previous_code_token;
    if (my_prev_code === null || my_prev_code.type === 'DELIMIT_DIRECTIVE') {
      return true;
    }
    return (my_prev_code.type === 'STATEMENT_TERMINATOR' ||
        my_prev_code.type === 'END_MATA') &&
      !this.joined_to_previous_line;
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
   *   - "mata: ///\n x = 5\n" (`///` joins the next line, so the code
   *     there follows the colon)
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
        if (this.source[my_pos + 2] === '/') {
          // `///` joins the next line to this one, so what follows the
          // opener is on the next line: `capture mata: ///` then code
          // is a one-line statement in Stata 18
          const my_newline = this.source.indexOf('\n', my_pos);
          if (my_newline < 0) {
            return true;
          }
          my_pos = my_newline + 1;
          continue;
        }
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

  /**
   * Whether a command can start at the word just scanned (at
   * `start_line`, `start_column`), so `mata` or `python` there opens
   * embedded code: at the start of a statement or after a prefix or its
   * colon (`capture mata:`, `version 18: mata:`), after `else` or
   * where a one-line `if`'s condition ends (`if flag quietly mata:`),
   * or after a macro that starts the command (`` `vv' mata:``, which
   * holds a prefix). Elsewhere it is
   * an argument: `local x 1 mata: y`, `if flag local x 1 mata: y`.
   */
  private at_embedded_opener_position(start_line: number, start_column: number): boolean {
    if (this.at_command_start || this.at_prefixed_command_start) {
      return true;
    }
    const my_previous = this.command_previous_token;
    if (my_previous === null) {
      return true;
    }
    const my_starts_statement = this.previous_started_command &&
      (my_previous.type === 'MACRO_REF_LOCAL' ||
        my_previous.type === 'MACRO_REF_GLOBAL');
    return my_starts_statement ||
      this.if_condition_ends_before(start_line, start_column);
  }

  /**
   * Whether an `if` statement's condition ends right before the word
   * just scanned (at `start_line`, `start_column`), so a command starts
   * there: `if flag mata: x`, `if (c) mata: x`, `if a == b mata: x`.
   * Once the command has started (`if flag local x mata: y`), what
   * follows is its arguments.
   */
  private if_condition_ends_before(start_line: number, start_column: number): boolean {
    const my_previous = this.command_previous_token;
    return this.in_if_statement && !this.if_condition_done &&
      my_previous !== null && my_previous !== this.if_keyword_token &&
      CONDITION_OPERAND_END_TYPES.has(my_previous.type) &&
      !(my_previous.range.end.line === start_line &&
        my_previous.range.end.character === start_column);
  }

  /**
   * Whether `:` follows the word just scanned, after any spaces or tabs.
   * Stata 18 reads `mata :` and `python :` as `mata:` and `python:`.
   */
  private colon_follows_blanks(): boolean {
    let my_pos = this.position;
    while (this.source[my_pos] === ' ' || this.source[my_pos] === '\t') {
      my_pos++;
    }
    return this.source[my_pos] === ':';
  }

  /** Consume the blanks and `:` that `colon_follows_blanks` found. */
  private consume_blanks_and_colon(): void {
    while (this.peek() === ' ' || this.peek() === '\t') {
      this.advance();
    }
    this.advance();
  }

  /**
   * Whether `{` comes next, after blanks and any `///` continuations:
   * the opening brace of `mata {` or `python {` on the keyword's
   * logical line.
   */
  private brace_follows_blanks(): boolean {
    let my_pos = this.position;
    for (;;) {
      while (this.source[my_pos] === ' ' || this.source[my_pos] === '\t') {
        my_pos++;
      }
      if (!this.source.startsWith('///', my_pos)) {
        return this.source[my_pos] === '{';
      }
      const my_newline = this.source.indexOf('\n', my_pos);
      if (my_newline < 0) {
        return false;
      }
      my_pos = my_newline + 1;
    }
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

  /**
   * Track a one-line `if`: where it starts, and where its condition
   * ends. Two operands in a row can't both be in the condition, so
   * the second starts the command (`if flag local …`); tokens that
   * touch (`"`a'"`, `` x`i' ``) are one operand.
   */
  private note_if_condition(token: Token): void {
    const my_previous = this.command_previous_token;
    if (this.in_if_statement && !this.if_condition_done &&
        CONDITION_OPERAND_TYPES.has(token.type) &&
        my_previous !== null && my_previous !== this.if_keyword_token &&
        CONDITION_OPERAND_END_TYPES.has(my_previous.type) &&
        !(my_previous.range.end.line === token.range.start.line &&
          my_previous.range.end.character === token.range.start.character)) {
      // The command starts here, so prefixes may come first:
      // `if flag quietly mata: x`
      this.if_condition_done = true;
      this.at_command_start = true;
    }
    // At command position only; `else if` gets there because `else`
    // keeps it open, but not `local x else if …`
    if (token.type === 'WORD' && token.value === 'if' && this.at_command_start) {
      this.in_if_statement = true;
      this.if_keyword_token = token;
      this.if_condition_done = false;
    }
  }

  /**
   * Track where commands start, and the last token that counts for it
   * (the newline a `///` swallows doesn't).
   */
  private note_command_position(token: Token): void {
    if (is_swallowed_continuation_terminator(
      token, this.previous_token?.type === 'CONTINUATION')) {
      return;
    }
    this.note_if_condition(token);
    const my_started_command = this.at_command_start;
    this.update_command_position(token);
    this.previous_started_command = my_started_command;
    this.command_previous_token = token;
  }

  /** Track where commands start, for reading a `*` as a comment. */
  private update_command_position(token: Token): void {
    this.update_prefixed_command_start(token);
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
      this.in_if_statement = false;
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
      // A command follows a prefix, and `else`: `else capture mata: x`
      if (ARGUMENT_FREE_PREFIXES.has(token.value) || token.value === 'else') {
        return;
      }
      this.command_word = token.value;
    }
    this.at_command_start = false;
  }


  /**
   * Track at_prefixed_command_start from the code token just scanned:
   * a colon after a colon prefix's word, or right after a macro that
   * starts the command, sets it, and argument-free prefixes after it
   * keep it (`mi xeq: quietly mata: x`).
   */
  private update_prefixed_command_start(token: Token): void {
    if (token.type === 'COLON') {
      const my_previous = this.command_previous_token;
      const my_after_prefix_macro = this.previous_started_command &&
        (my_previous?.type === 'MACRO_REF_LOCAL' ||
          my_previous?.type === 'MACRO_REF_GLOBAL');
      // The command this colon follows: the one after the last prefix
      // colon if there was one (`mi xeq: notes: mata:` is the note
      // "mata:" in StataMP 18, while `mi xeq: by g: mata:` opens Mata).
      const my_word = this.prefixed_command_word ?? this.command_word;
      this.at_prefixed_command_start = my_after_prefix_macro ||
        (my_word !== null && EMBEDDED_OPENER_COLON_PREFIXES.has(my_word));
      this.prefixed_command_word = null;
      return;
    }
    if (STATEMENT_START_TYPES.has(token.type)) {
      this.prefixed_command_word = null;
    } else if (this.at_prefixed_command_start && token.type === 'WORD' &&
        !ARGUMENT_FREE_PREFIXES.has(token.value)) {
      this.prefixed_command_word = token.value;
    }
    this.at_prefixed_command_start = this.at_prefixed_command_start &&
      token.type === 'WORD' && ARGUMENT_FREE_PREFIXES.has(token.value);
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
        const terminator: Token = {
          type: 'STATEMENT_TERMINATOR',
          value: '\n',
          range: this.makeRange(startLine, startColumn, this.line, this.column),
        };
        // A `///` before the newline continues the `input` statement.
        if (this.input_data_pending &&
            this.previous_token?.type !== 'CONTINUATION') {
          this.input_data_pending = false;
          const the_data_tokens = this.scan_input_data();
          if (the_data_tokens !== null) {
            return [terminator, ...the_data_tokens];
          }
        }
        return terminator;
      }
      return null;
    }

    // Handle semicolons (significant in semicolon mode)
    if (char === ';') {
      if (this.state.delimiterMode === 'semicolon') {
        const terminator: Token = {
          type: 'STATEMENT_TERMINATOR',
          value: ';',
          range: this.makeRange(startLine, startColumn, this.line, this.column),
        };
        if (this.input_data_pending) {
          this.input_data_pending = false;
          const the_data_tokens = this.scan_input_data();
          if (the_data_tokens !== null) {
            return [terminator, ...the_data_tokens];
          }
        }
        return terminator;
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

    // A `#delimit` directive, or an abbreviation down to `#d`, as the
    // first code of a statement. Elsewhere `#` is the factor-variable
    // interaction operator (`i.a#d`) or text (`local tag {#d ;}`).
    if (char === '#') {
      const keyword_length =
        delimit_keyword_length(this.source, this.position - 1);
      if (keyword_length > 0 && this.at_statement_start()) {
        // Consume the rest of the keyword
        for (let i = 1; i < keyword_length; i++) {
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
        this.stata_brace_depth++;
        return this.makeToken('LBRACE', char, startLine, startColumn);
      case '}':
        this.stata_brace_depth = Math.max(0, this.stata_brace_depth - 1);
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

  private scanDelimitDirective(startLine: number, startColumn: number): Token | Token[] {
    // Skip whitespace after the keyword
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
    const directive: Token = {
      type: 'DELIMIT_DIRECTIVE',
      value,
      range: this.makeRange(startLine, startColumn, this.line, this.column),
    };
    // A `*` comment on the directive line ends at the newline even
    // after `#delimit ;` (Stata 18 runs the next line's command), so
    // it is scanned here rather than as a `;`-ended star comment.
    if (rest.startsWith('*')) {
      while (this.peek() === ' ' || this.peek() === '\t') {
        this.advance();
      }
      let line_end = this.source.indexOf('\n', comment_start);
      if (line_end < 0) {
        line_end = this.source.length;
      }
      const comment_end = comment_start +
        this.source.substring(comment_start, line_end).trimEnd().length;
      return [directive, this.scan_raw_token('COMMENT_LINE', comment_end)];
    }
    return directive;
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
    const my_stop = this.unclosed_string_stop();

    while (!this.isAtEnd()) {
      const char = this.peek();

      // Under `#delimit ;` a line break inside a string is part of it:
      // Stata's ml_searc.ado sets `local options "... LOg` then
      // `MAXFEAS(integer 1000) ... TRace" ;`. A string that no `"`
      // closes stops where unclosed_string_stop says.
      if ((char === '\n' && this.state.delimiterMode !== 'semicolon') ||
          (my_stop !== -1 && this.position >= my_stop)) {
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
          while ((this.isAlphaNumeric(this.peek()) || this.peek() === '_') &&
              !this.isAtEnd()) {
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

  /**
   * Under `#delimit ;`, where a simple string that opened just before
   * the current position stops when no `"` follows to close it: StataMP
   * 18 would read the rest of the file into it, so Sight ends it at the
   * end of its line, or at a `;` that is the last code on that line
   * (which then ends the statement): `display "oops;` then
   * `local one 1;` leaves the `local` a statement of its own, with the
   * open quote still reported. -1 when the string has a `"` after it,
   * under `#delimit cr` (where every string ends at its line), or in a
   * Mata or Python block (see reads_semicolon_statements).
   */
  private unclosed_string_stop(): number {
    if (!this.reads_semicolon_statements()) {
      return -1;
    }
    if (this.last_double_quote_offset === null) {
      this.last_double_quote_offset = this.source.lastIndexOf('"');
    }
    if (this.position <= this.last_double_quote_offset) {
      return -1;
    }
    let my_line_end = this.source.indexOf('\n', this.position);
    if (my_line_end === -1) {
      my_line_end = this.source.length;
    }
    let my_last = my_line_end - 1;
    while (my_last >= this.position && /\s/.test(this.source[my_last])) {
      my_last--;
    }
    return my_last >= this.position && this.source[my_last] === ';'
      ? my_last
      : my_line_end;
  }

  /**
   * Whether Stata code is read as `;`-ended statements here: under
   * `#delimit ;`, outside a Mata or Python block. (StataMP 18 reads a
   * Mata block under `#delimit ;` by physical lines, where a string
   * ends at its line and a `;` in it is text; such strings keep the
   * reading they had.)
   */
  private reads_semicolon_statements(): boolean {
    return this.state.delimiterMode === 'semicolon' &&
      this.get_current_context() === LanguageContext.STATA;
  }

  private scanCompoundString(startLine: number, startColumn: number): Token | Token[] {
    const the_tokens: Token[] = [];
    let depth = 1;
    let segment_start_line = startLine;
    let segment_start_column = startColumn;
    const is_semicolon_statement = this.reads_semicolon_statements();

    while (!this.isAtEnd() && depth > 0) {
      const char = this.peek();

      // Under `#delimit ;` a compound string runs on across lines, but
      // a `;` in it ends the statement (StataMP 18 reads
      // `` local d `"x;y"'; `` as `` local d `"x `` and `` y"' ``).
      if ((char === '\n' && !is_semicolon_statement) ||
          (char === ';' && is_semicolon_statement)) {
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
          while ((this.isAlphaNumeric(this.peek()) || this.peek() === '_') &&
              !this.isAtEnd()) {
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
    let my_starts_program = false;

    if (my_current_context === LanguageContext.STATA) {
      my_starts_program = this.note_program_definition_word(value, startLine);
      this.note_input_command_word(value, startLine, startColumn);
      // Check for embedded language block starts (case-sensitive: Stata requires lowercase)
      if (this.is_mata_start_delimiter(value)) {
        // Check if previous token is MATA_INLINE - if so, we're inside an inline mata expression
        // e.g., "mata: mata drop foo()" - the second "mata" is a Mata command, not a block start
        const prev_is_mata_inline = this.previous_token &&
          this.previous_token.type === 'MATA_INLINE';
        
        // First check for mata: syntax (mata followed by colon, after
        // any blanks): `capture mata:`, `if flag mata:`, but not
        // `local mata : word 1 of a b` or `local x mata: y`
        const at_opener_position =
          this.at_embedded_opener_position(startLine, startColumn);
        if (prev_is_mata_inline || !at_opener_position) {
          // "mata" is an argument to a command or part of inline mata, not a block start
          // Fall through to return as WORD
        } else if (this.colon_follows_blanks()) {
          this.consume_blanks_and_colon();
          // The opener as written (`mata:` or `mata :`), so formatting
          // keeps it
          const full_value = this.source.substring(
            this.position_to_offset(startLine, startColumn), this.position);
          
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
        } else if (
          !this.is_only_whitespace_or_comment_until_newline() &&
          !this.brace_follows_blanks()
        ) {
          // `mata x = 5`: code on the line makes a one-line statement,
          // as with `mata:` (Stata 18 runs it and stays in Stata)
          return {
            type: 'MATA_INLINE',
            value,
            range: this.makeRange(startLine, startColumn, this.line, this.column),
          };
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
        // Check for python: (python followed by colon, after any
        // blanks), unless python is a command's argument
        // (`local python : word 1 of a b`)
        const at_opener_position =
          this.at_embedded_opener_position(startLine, startColumn);
        if (!at_opener_position) {
          // Fall through to return as WORD
        } else if (this.colon_follows_blanks()) {
          this.consume_blanks_and_colon();
          // The opener as written (`python:` or `python :`)
          const full_value = this.source.substring(
            this.position_to_offset(startLine, startColumn), this.position);
          
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
        
        // `python query`, `python set exec …`: words after `python` make
        // a one-line Stata subcommand, not a block
        const is_subcommand =
          !this.is_only_whitespace_or_comment_until_newline() &&
          !this.brace_follows_blanks();
        
        if (at_opener_position && !prev_is_end && !is_subcommand) {
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
      ...(my_starts_program ? { starts_program_definition: true } : {}),
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

  // A letter, as in a Stata name: ASCII or Unicode (see stata-name.ts).
  private isAlpha(char: string): boolean {
    return is_name_letter(char);
  }

  // What a name goes on with, other than `_` (see stata-name.ts).
  private isAlphaNumeric(char: string): boolean {
    return is_name_letter_or_digit(char);
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
