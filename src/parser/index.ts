import { Position, Range } from 'vscode-languageserver-textdocument';
import {
  Token,
  TokenType,
  StataNode,
  ParseResult,
  ParseError,
  ParseErrorCode,
  CommandNode,
  ProgramNode,
  MacroDefNode,
  MacroReference,
  ControlFlowNode,
  DirectiveNode,
  TriviaNode,
  PrefixNode,
  OptionNode,
  IdentifierNode,
  EmbeddedLanguageBlockNode,
  SyntaxNode,
  SourceLine,
  ProgramSignature,
  ArgumentSpec,
  OptionSpec,
  ExpressionNode,
  InRangeNode,
  UsingClause,
  PathNode,
  WeightClause,
  StataAST,
} from '../types';
import { ContextTracker } from '../context-tracker';
import { unwrap_macval } from '../utils/local-macro';
import { isFileCommand } from '../utils/file-path-utils';
import { is_swallowed_continuation_terminator } from '../utils/continuation';
import { compare_positions } from '../utils/scope-position';
import { program_signature_syntax_nodes } from '../utils/node-body';
import { PROGRAM_SUBCOMMANDS } from '../utils/program-definition';
import {
  COLON_PREFIX_COMMANDS,
  PREFIX_COMMANDS,
} from '../utils/stata-prefix-commands';
import {
  WEIGHT_KEYWORDS,
  name_parts_from_tokens,
  parse_egen_function,
  parse_expression,
  parse_in_range,
  parse_path,
  parse_varlist,
} from '../expression-parser';
import { is_macro_piece, joins_name } from '../utils/name-words';

/** Tokens that can be part of a macro name joined across macros. */
const NAME_PIECE_TOKEN_TYPES: ReadonlySet<TokenType> = new Set<TokenType>([
  'WORD', 'NUMBER', 'MACRO_REF_LOCAL', 'MACRO_REF_GLOBAL',
]);

/**
 * `display` and its abbreviations. It has no options, so a comma in it
 * is an argument (`di "a", "b"` shows `a b` in Stata 18).
 */
const DISPLAY_COMMANDS: ReadonlySet<string> = new Set([
  'di', 'dis', 'disp', 'displ', 'displa', 'display',
]);

/**
 * `: list` subcommands that take one macro name, as in
 * `list uniq mylist`. Stata 18 accepts them exactly as written (no
 * abbreviation, exact case), except `retokenize`; see
 * `is_list_retokenize`.
 */
const LIST_UNARY_SUBCOMMANDS: ReadonlySet<string> = new Set([
  'uniq', 'dups', 'sort', 'clean', 'sizeof',
]);

/** `retokenize` and its abbreviations down to `retok`, as in Stata 18. */
function is_list_retokenize(word: string): boolean {
  return word.length >= 5 && 'retokenize'.startsWith(word);
}

/** A bare word that can be a macro name. */
const MACRO_NAME_WORD = /^[a-zA-Z_][a-zA-Z0-9_]*$/;

/**
 * The bare macro-name operands of `: list`, from its argument tokens
 * (after `list`). Stata 18's forms:
 *
 * - `uniq|dups|sort|clean|sizeof|retok[enize] macname`
 * - `posof "element" in macname`
 * - `macname1 op macname2`, with op `|`, `&`, `-`, `==`, `===`, `in`
 *
 * A subcommand word followed by an operator is a macro name in the
 * binary form (`list sort | b`). Explicit `` `x' `` and `$x` tokens
 * are references of their own, read elsewhere.
 */
function list_operand_tokens(arg_tokens: Token[]): Token[] {
  const the_tokens = arg_tokens.filter((my_token) =>
    my_token.type !== 'WHITESPACE');
  const first = the_tokens[0];
  const second = the_tokens[1];
  const is_word = (my_token: Token | undefined, value?: string): boolean =>
    my_token !== undefined && my_token.type === 'WORD' &&
    (value === undefined || my_token.value === value);
  const second_is_operator = second !== undefined &&
    (second.type === 'OPERATOR' || is_word(second, 'in'));

  let the_operands: Token[];
  if (is_word(first, 'posof') && !second_is_operator) {
    // The element is a string; the operand follows `in`.
    const in_index = the_tokens.findIndex(
      (my_token, i) => i > 0 && is_word(my_token, 'in'));
    the_operands = in_index < 0 ? [] : the_tokens.slice(in_index + 1);
  } else if (
    first !== undefined && is_word(first) && !second_is_operator &&
    (LIST_UNARY_SUBCOMMANDS.has(first.value) || is_list_retokenize(first.value))
  ) {
    the_operands = the_tokens.slice(1);
  } else {
    // Binary: drop the `in` operator, keep the names on either side.
    const in_index = the_tokens.findIndex(
      (my_token, i) => i > 0 && is_word(my_token, 'in'));
    the_operands = the_tokens.filter((_, i) => i !== in_index);
  }
  // A word touching a macro reference or another word is part of a
  // name built at run time (`` `dim'list ``), not a name to check.
  const touches = (left: Token | undefined, right: Token | undefined): boolean =>
    left !== undefined && right !== undefined &&
    left.type !== 'OPERATOR' && right.type !== 'OPERATOR' &&
    left.range.end.line === right.range.start.line &&
    left.range.end.character === right.range.start.character;
  const the_operand_set = new Set(the_operands);
  return the_tokens.filter((my_token, i) =>
    the_operand_set.has(my_token) &&
    my_token.type === 'WORD' && MACRO_NAME_WORD.test(my_token.value) &&
    !touches(the_tokens[i - 1], my_token) &&
    !touches(my_token, the_tokens[i + 1]));
}

/** `define` and its abbreviations after `program`. */
const PROGRAM_DEFINE_KEYWORDS: ReadonlySet<string> = new Set([
  'de', 'def', 'defi', 'defin', 'define',
]);

// Tokens that can name a command (`gen`, `` `cmd' ``, `$cmd`).
const COMMAND_NAME_TYPES: ReadonlySet<TokenType | undefined> = new Set<TokenType>([
  'WORD', 'MACRO_REF_LOCAL', 'MACRO_REF_GLOBAL',
]);
// Tokens after a prefix that start a brace block or Mata/Python.
const PREFIX_CHAIN_BLOCK_TYPES: ReadonlySet<TokenType> = new Set<TokenType>([
  'LBRACE', 'MATA_START', 'MATA_INLINE', 'PYTHON_START', 'PYTHON_INLINE',
]);
// Tokens between the end of one statement and the start of the next.
const NEXT_STATEMENT_SKIP_TYPES: ReadonlySet<TokenType> = new Set<TokenType>([
  'STATEMENT_TERMINATOR', 'COMMENT_LINE', 'COMMENT_BLOCK', 'CONTINUATION',
  'WHITESPACE',
]);
// `#delimit ;`, with the `;` as the first thing after the keyword.
const DELIMIT_SEMICOLON_PATTERN = /^#delimit[ \t]*;/;

/**
 * Does `token` end its statement? Under `#delimit ;` a `*` comment runs
 * to the next `;`, which the lexer keeps in the comment (`* note;`), so
 * `quietly` then `* note;` is a whole statement (Stata 18).
 */
function is_statement_ending_comment(token: Token): boolean {
  return token.type === 'COMMENT_LINE' &&
    token.value.startsWith('*') && token.value.endsWith(';');
}

/** Is `token` a `///` continuation with a note after it? */
function is_noted_continuation(token: Token): boolean {
  return token.type === 'CONTINUATION' && token.value.slice(3).trim() !== '';
}

/**
 * Do `tokens` hold two `/` operators with nothing between them? That is
 * a `//` or `///` with code right before it (`b///`, `http://`), which
 * Stata 18 reads as text, so it must keep its slashes together.
 */
function has_adjacent_slashes(tokens: Token[]): boolean {
  for (let i = 1; i < tokens.length; i++) {
    const previous = tokens[i - 1];
    const my_token = tokens[i];
    if (previous.type === 'OPERATOR' && previous.value === '/' &&
        my_token.type === 'OPERATOR' && my_token.value === '/' &&
        compare_positions(previous.range.end, my_token.range.start) === 0) {
      return true;
    }
  }
  return false;
}

/**
 * The lines of `tokens` as written (see SourceLine). Tokens on one line
 * keep their gaps; a token's own line breaks (a multi-line comment)
 * stay in its text.
 */
function source_lines_of(tokens: Token[]): SourceLine[] {
  const the_lines: SourceLine[] = [];
  let the_parts: string[] = [];
  let column = tokens[0]?.range.start.character ?? 0;
  let previous: Token | undefined;
  for (const my_token of tokens) {
    if (previous !== undefined) {
      const line_gap = my_token.range.start.line - previous.range.end.line;
      if (line_gap === 0) {
        const gap = my_token.range.start.character - previous.range.end.character;
        if (gap > 0) {
          the_parts.push(' '.repeat(gap));
        }
      } else {
        the_lines.push({ column, text: the_parts.join('') });
        for (let i = 1; i < line_gap; i++) {
          the_lines.push({ column: 0, text: '' });
        }
        the_parts = [];
        column = my_token.range.start.character;
      }
    }
    the_parts.push(my_token.value);
    previous = my_token;
  }
  the_lines.push({ column, text: the_parts.join('') });
  return the_lines;
}

/** Placeholder for a qualifier or `=` with nothing after it. */
function empty_expression(position: Position): ExpressionNode {
  return {
    kind: 'unparsed',
    text: '',
    reason: 'empty',
    range: { start: position, end: position },
  };
}

/** Parse an `if`/`while` condition, or an empty placeholder. */
function parse_condition(tokens: Token[], fallback: Position): ExpressionNode {
  const node = parse_expression(tokens);
  return node.kind === 'unparsed' && node.reason === 'empty'
    ? empty_expression(fallback)
    : node;
}

/** Options for {@link StataParser}. */
export interface ParserOptions {
  /**
   * Build the structured expression fields: `expression_ast`, `if_ast`,
   * `in_range`, `using`, `condition_ast`, a weight's `expression_ast`, and
   * a `by` prefix's `by_varlist`/`sort_varlist`. Off by default because
   * the language server does not read them and they add parse time on
   * long files; tools that translate Stata turn it on.
   */
  structured?: boolean;
}

export class StataParser {
  private readonly structured: boolean;
  private tokens: Token[] = [];
  private current: number = 0;
  private errors: ParseError[] = [];
  private pending_trivia: TriviaNode[] = [];
  private context_tracker: ContextTracker | null = null;
  private inside_program: boolean = false;
  // Where the program being parsed ended: Stata ends a program
  // definition at the `end` of a mata/python block in its body, even one
  // nested in a brace block. Every enclosing body stops there.
  private program_end_at: Position | undefined;
  // Code the AST does not hold as written (see StataAST)
  private unprintable_ranges: Range[] = [];
  // The `#delimit` mode at the current statement
  private delimit_mode: 'cr' | 'semicolon' = 'cr';
  private if_brace_scan_end = -1;
  private if_brace_scan_result = false;

  // Regex patterns for nested compound string delimiters
  private static readonly OPENING_DELIMITER_PATTERN = /^(`")+$/;
  private static readonly CLOSING_DELIMITER_PATTERN = /^("')+$/;

  constructor(options: ParserOptions = {}) {
    this.structured = options.structured === true;
  }

  /** Build a document AST and collect syntax errors from lexer tokens. */
  parse(tokens: Token[], context_tracker?: ContextTracker): ParseResult {
    this.tokens = tokens;
    this.current = 0;
    this.errors = [];
    this.pending_trivia = [];
    this.if_brace_scan_end = -1;
    this.if_brace_scan_result = false;
    this.delimit_mode = 'cr';
    this.program_end_at = undefined;
    this.unprintable_ranges = [];
    this.context_tracker = context_tracker || null;

    const nodes: StataNode[] = [];

    while (!this.isAtEnd()) {
      const statement_start = this.peek().range.start;
      try {
        const node = this.parseStatement();
        if (node) {
          nodes.push(node);
        }
      } catch (error) {
        // Error recovery: skip to next statement boundary. The
        // statement, and any block it was in, is not in the AST.
        this.synchronize();
        this.addError(`Parse error: ${error}`, this.peek().range);
        this.note_unprintable(statement_start);
        this.inside_program = false;
        this.program_end_at = undefined;
      }
    }

    // If the file ends with trivia (comment-only tail), attach it to the
    // last node. With no node to hold it, keep it on the AST rather than
    // dropping it, so a file of only comments prints back unchanged.
    let eof_trivia: TriviaNode[] | undefined;
    if (this.pending_trivia.length > 0) {
      const last_node = nodes[nodes.length - 1];
      if (last_node !== undefined && this.isNodeWithTrivia(last_node)) {
        if (last_node.trailingTrivia) {
          last_node.trailingTrivia.push(...this.pending_trivia);
        } else {
          last_node.trailingTrivia = this.pending_trivia;
        }
      } else {
        eof_trivia = this.pending_trivia;
      }
      this.pending_trivia = [];
    }

    const ast: StataAST = eof_trivia ? { nodes, trailingTrivia: eof_trivia } : { nodes };
    if (this.unprintable_ranges.length > 0) {
      ast.unprintable_ranges = this.unprintable_ranges;
    }
    return { ast, errors: this.errors };
  }

  /**
   * Parse one statement and attach its comments.
   * Inline if bodies leave the shared terminator for their enclosing if.
   */
  private parseStatement(consume_terminator = true): StataNode | null {
    // Collect trivia at the beginning of the statement. Trivia-only lines (e.g. comment-only)
    // should attach to the next real node, so we carry it forward via pending_trivia.
    const leading_trivia = [...this.pending_trivia, ...this.collectTrivia()];
    this.pending_trivia = [];

    if (this.isAtEnd()) {
      this.pending_trivia = leading_trivia;
      return null;
    }

    // Empty line or trivia-only line: consume terminator and keep trivia pending.
    if (this.check('STATEMENT_TERMINATOR')) {
      this.advance();
      this.pending_trivia = leading_trivia;
      return null;
    }

    let node: StataNode | null = null;
    const statement_start = this.current;

    // Check for different statement types
    if (this.check('DELIMIT_DIRECTIVE')) {
      node = this.parseDelimitDirective();
    } else if (this.check('MATA_START') || this.check('MATA_INLINE')) {
      node = this.parseEmbeddedLanguageBlock('mata');
    } else if (this.check('PYTHON_START') || this.check('PYTHON_INLINE')) {
      node = this.parseEmbeddedLanguageBlock('python');
    } else if (this.check('WORD') && this.isPrefixCommand(this.peek().value)) {
      // Prefix command - delegate to parseCommand which handles prefix parsing
      node = this.parseCommand();
    } else if (this.checkWord('program') && this.starts_program_definition()) {
      node = this.parseProgramDefinition();
    } else if (this.checkWord('syntax')) {
      node = this.parseSyntaxCommand();
    } else if (this.checkWord('local') || this.checkWord('global')) {
      // Only parse as macro definition if next non-trivia token is WORD or ++/-- WORD
      // Otherwise fall back to parseCommand() for patterns like `global `global' = ...`
      if (this.looksLikeMacroDefinition()) {
        node = this.parseMacroDefinition();
      } else {
        node = this.parseCommand();
      }
    } else if (this.checkWord('if')) {
      node = this.parseIfStatement();
    } else if (this.checkWord('else')) {
      node = this.parseElseStatement();
    } else if (this.checkWord('foreach') || this.checkForvalues()) {
      node = this.parseLoopStatement();
    } else if (this.checkWord('while')) {
      node = this.parseWhileStatement();
    } else if (this.checkWord('frame')) {
      // Try to parse as frame block (frame name { ... })
      // If it's not a frame block syntax, parseFrameBlock returns null
      // and we fall through to parseCommand
      node = this.parseFrameBlock();
      if (node === null) {
        node = this.parseCommand();
      }
    } else if (this.check('WORD') || this.check('MACRO_REF_LOCAL') || this.check('MACRO_REF_GLOBAL')) {
      // Default to command parsing (handles both regular commands and macro-led commands)
      node = this.parseCommand();
    } else if (this.check('STRING')) {
      // Standalone string literal or compound string with embedded macros
      // The lexer splits compound strings with macros into multiple tokens,
      // so we need to collect all tokens until the statement terminator
      node = this.parseStringStatement();
    } else if (this.check('LBRACE') && this.at_statement_start()) {
      // A standalone `{ ... }` block. Stata 18 runs one at the top
      // level, in a program, after another block, and nested, and
      // locals defined in it stay defined after it. parseCommand reads
      // it as a block with no prefix. A header or prefix that ended
      // just before it (`if 1` then `{` on the next line) reports
      // OPEN_BRACE_ALONE itself.
      node = this.parseCommand();
    } else if (this.check('LBRACE')) {
      // A `{` after a command on its line (`b {`), where the command's
      // arguments stopped. Stata 18 passes it to `b` as an argument,
      // and the `}` that was to close it is "not a valid command name"
      // (r(199)).
      const brace_token = this.advance();
      this.errors.push({
        message: 'open brace does not open a block here: Stata passes ' +
          'it to the command before it',
        range: brace_token.range,
        code: ParseErrorCode.OPEN_BRACE_ALONE,
      });
      // Skip until we find the matching close brace or end of file
      let brace_depth = 1;
      while (!this.isAtEnd() && brace_depth > 0) {
        if (this.check('LBRACE')) {
          brace_depth++;
        } else if (this.check('RBRACE')) {
          brace_depth--;
        }
        this.advance();
      }
      this.note_unprintable(brace_token.range.start);
      this.pending_trivia = leading_trivia;
      return null;
    } else if (this.check('RBRACE')) {
      // Orphan closing brace - this is an error in Stata
      const brace_token = this.advance();
      this.errors.push({
        message: 'unexpected closing brace - no matching opening brace',
        range: brace_token.range,
        code: ParseErrorCode.ORPHAN_CLOSE_BRACE,
      });
      this.note_unprintable(brace_token.range.start);
      this.pending_trivia = leading_trivia;
      return null;
    } else if (has_adjacent_slashes(this.tokens.slice(this.current, this.current + 2))) {
      node = this.parse_slash_led_statement();
    } else {
      // Skip unknown tokens but preserve any leading trivia for the next statement.
      const skipped_token = this.advance();
      this.note_unprintable(skipped_token.range.start);
      this.pending_trivia = leading_trivia;
      return null;
    }

    // Attach leading/trailing trivia.
    if (node && this.isNodeWithTrivia(node) && leading_trivia.length > 0) {
      node.leadingTrivia = leading_trivia;
    }
    // A standalone string statement keeps all of its source, comments
    // included, in its name (parseStringStatement).
    const is_string_statement = this.tokens[statement_start]?.type === 'STRING';
    if (node !== null && !is_string_statement &&
        ((node.type === 'command' && node.body === undefined) ||
         node.type === 'macro_def' || node.type === 'syntax')) {
      // A parenthesized varlist group such as `(mean /* c */)` keeps
      // its comments in its text. Items and comments are both in source
      // order, so one sweep finds the item around each comment.
      const the_items = node.type === 'command' ? node.varlist ?? [] : [];
      let item_index = 0;
      const interior_trivia = this.comments_between(
        statement_start, this.current
      ).filter((my_comment) => {
        while (item_index < the_items.length &&
            compare_positions(the_items[item_index].range.end, my_comment.range.start) <= 0) {
          item_index++;
        }
        const item = the_items[item_index];
        return item === undefined ||
          compare_positions(item.range.start, my_comment.range.start) > 0;
      });
      if (interior_trivia.length > 0) {
        node.interiorTrivia = interior_trivia;
      }
    }
    if (node !== null && !is_string_statement) {
      this.keep_noted_lines(node, statement_start);
    }

    const trailing_trivia = this.collectTrivia();
    // Under `#delimit ;` these come before the statement's `;`. Comments
    // the end of the file adds later come after it.
    if (node !== null && node.type !== 'directive' &&
        this.delimit_mode === 'semicolon' &&
        this.check('STATEMENT_TERMINATOR') && this.peek().value === ';') {
      for (const my_trivia of trailing_trivia) {
        my_trivia.before_terminator = true;
      }
    }
    if (node && this.isNodeWithTrivia(node) && trailing_trivia.length > 0) {
      node.trailingTrivia = trailing_trivia;
    }

    // An inline if body shares its terminator with the enclosing statement.
    if (consume_terminator && this.check('STATEMENT_TERMINATOR')) {
      this.advance();
    }

    return node;
  }

  private parseDelimitDirective(): DirectiveNode {
    const token = this.advance(); // consume DELIMIT_DIRECTIVE

    // The mode is the first thing after `#delimit`, as in the lexer:
    // `#delimit cr // c;` is cr.
    const mode = DELIMIT_SEMICOLON_PATTERN.test(token.value) ? 'semicolon' : 'cr';
    this.delimit_mode = mode;

    return {
      type: 'directive',
      directive: 'delimit',
      mode,
      range: token.range,
    };
  }

  private parseEmbeddedLanguageBlock(
    language: 'mata' | 'python'
  ): EmbeddedLanguageBlockNode {
    const start_token = this.advance(); // consume MATA_START, MATA_INLINE, PYTHON_START, or PYTHON_INLINE
    const start_command = start_token.value;
    const is_single_line =
      start_token.type === 'MATA_INLINE' ||
      start_token.type === 'PYTHON_INLINE';

    // Under `#delimit ;`, the `;` after `mata` / `python` ends the
    // opener statement (`mata;`); it is not block content.
    if (!is_single_line && this.delimit_mode === 'semicolon') {
      let my_index = this.current;
      while (this.tokens[my_index]?.type === 'WHITESPACE' &&
          !this.tokens[my_index]?.value.includes('\n')) {
        my_index++;
      }
      const my_token = this.tokens[my_index];
      if (my_token !== undefined && my_token.type === 'EMBEDDED_CONTENT' &&
          my_token.value === ';' &&
          my_token.range.start.line === start_token.range.end.line) {
        this.current = my_index + 1;
      }
    }

    const content_start_pos = this.current;
    let end_command: string | undefined;
    let end_token_index: number | undefined;

    // For single-line contexts, collect until statement terminator
    if (is_single_line) {
      while (
        !this.check('STATEMENT_TERMINATOR') &&
        !this.isAtEnd()
      ) {
        this.advance();
      }
      end_command = start_command; // Single-line contexts don't have explicit end
    } else {
      // Check if this is a brace-style block (mata { ... } or python { ... })
      // Skip whitespace to check for opening brace
      this.skipTrivia();
      const is_brace_style = this.check('LBRACE');

      if (is_brace_style) {
        // Brace-style block: collect until matching closing brace
        this.advance(); // consume opening {
        let brace_depth = 1;

        while (!this.isAtEnd() && brace_depth > 0) {
          if (this.check('LBRACE')) {
            brace_depth++;
          } else if (this.check('RBRACE')) {
            brace_depth--;
            if (brace_depth === 0) {
              end_token_index = this.current;
              end_command = '}';
              this.advance(); // consume closing }
              break;
            }
          }
          this.advance();
        }
      } else {
        // For multi-line contexts, collect until matching end delimiter
        const end_token_type =
          language === 'mata' ? 'END_MATA' : 'END_PYTHON';

        while (!this.isAtEnd()) {
          if (this.check(end_token_type)) {
            end_token_index = this.current;
            end_command = this.peek().value;
            this.advance(); // consume end delimiter
            break;
          }
          this.advance();
        }
      }
    }

    // Extract content between delimiters
    const content_tokens = this.tokens.slice(
      content_start_pos,
      end_token_index !== undefined ? end_token_index : this.current
    );

    // Reconstruct content preserving whitespace between tokens
    let content = '';
    if (content_tokens.length > 0) {
      for (let i = 0; i < content_tokens.length; i++) {
        const my_token = content_tokens[i];

        // Add the token value
        content += my_token.value;

        // Add source gap between tokens if there is one. In `#delimit ;`
        // mode, inline embedded content can cross physical lines without an
        // interposed WHITESPACE token; preserve that line boundary so `//`
        // comments do not swallow the next physical line.
        if (i < content_tokens.length - 1) {
          const next_token = content_tokens[i + 1];
          if (next_token.range.start.line === my_token.range.end.line) {
            const gap =
              next_token.range.start.character -
              my_token.range.end.character;
            if (gap > 0) {
              content += ' '.repeat(gap);
            }
          } else if (next_token.range.start.line > my_token.range.end.line) {
            const line_gap =
              next_token.range.start.line - my_token.range.end.line;
            content += '\n'.repeat(line_gap);
            if (next_token.range.start.character > 0) {
              content += ' '.repeat(next_token.range.start.character);
            }
          }
        }
      }
    }
    // A block's lines keep their indentation as written (Python's is
    // part of the code); only the opener's line break and the blanks
    // after the last line go.
    content = is_single_line
      ? content.trim()
      : content.replace(/^[ \t]*\r?\n/, '').trimEnd();

    // Calculate content range
    const content_range: Range =
      content_tokens.length > 0
        ? {
            start: content_tokens[0].range.start,
            end: content_tokens[content_tokens.length - 1].range.end,
          }
        : start_token.range;

    return {
      type: 'embedded_block',
      language,
      start_command,
      end_command,
      content,
      content_range,
      is_single_line,
      range: this.makeRange(
        start_token.range.start,
        this.previous().range.end
      ),
    };
  }

  /**
   * Does `program` at the current token start a definition? Stata accepts
   * `program [define] name`; `program dir`, `program drop`, and
   * `program list` (and their abbreviations) are other subcommands.
   */
  private starts_program_definition(): boolean {
    // In `#delimit cr` mode a line break is a terminator token, so the
    // next significant WORD is on the same logical statement.
    const next = this.tokens[this.next_header_token(this.current + 1)];
    return next?.type === 'WORD' && !PROGRAM_SUBCOMMANDS.has(next.value) &&
      !this.declares_plugin();
  }

  /**
   * Does the current `program` statement have the `plugin` option? A
   * plugin declaration (`program hello, plugin using(...)`) has no body
   * and no `end`, so it is parsed as an ordinary command.
   */
  private declares_plugin(): boolean {
    let saw_comma = false;
    let depth = 0;
    for (let i = this.current + 1; i < this.tokens.length; i++) {
      const my_token = this.tokens[i];
      if (my_token.type === 'STATEMENT_TERMINATOR') {
        if (is_swallowed_continuation_terminator(
          my_token, this.tokens[i - 1].type === 'CONTINUATION')) {
          continue;
        }
        return false;
      }
      if (my_token.type === 'EOF') {
        return false;
      }
      if (my_token.type === 'LPAREN') {
        depth++;
      } else if (my_token.type === 'RPAREN') {
        depth = Math.max(0, depth - 1);
      } else if (my_token.type === 'COMMA' && depth === 0) {
        saw_comma = true;
      } else if (saw_comma && depth === 0 && my_token.type === 'WORD' &&
          my_token.value === 'plugin') {
        return true;
      }
    }
    return false;
  }

  /**
   * Index of the first token at or after `index` that is not a block
   * comment, a `///` continuation, or the newline a continuation
   * swallows.
   */
  private next_header_token(index: number): number {
    let i = index;
    for (;;) {
      const my_token = this.tokens[i];
      if (my_token?.type === 'COMMENT_BLOCK' || my_token?.type === 'CONTINUATION') {
        i++;
        continue;
      }
      if (my_token !== undefined && i > 0 &&
          is_swallowed_continuation_terminator(
            my_token, this.tokens[i - 1].type === 'CONTINUATION')) {
        i++;
        continue;
      }
      return i;
    }
  }

  private parseProgramDefinition(): ProgramNode {
    const start_token = this.advance(); // consume 'program'

    // `define` is optional; a define abbreviation followed by another
    // word is the keyword, otherwise the word is the program name.
    let define_keyword: string | undefined;
    this.current = this.next_header_token(this.current);
    // `define` itself is always the keyword (a program named define is
    // `program define define`); an abbreviation is the keyword only when a
    // name follows.
    if (this.check('WORD') && PROGRAM_DEFINE_KEYWORDS.has(this.peek().value) &&
        (this.peek().value === 'define' ||
         this.tokens[this.next_header_token(this.current + 1)]?.type === 'WORD')) {
      define_keyword = this.advance().value;
    }

    this.current = this.next_header_token(this.current);


    // Get program name
    if (!this.check('WORD')) {
      this.addError('Expected program name', this.peek().range);
      throw new Error('Missing program name');
    }

    const name_token = this.advance();
    const program_name = name_token.value;

    // Keep the raw text of `, options` (rclass, eclass, byable(), ...)
    const option_tokens: Token[] = [];
    let saw_comma = false;
    while (!this.isAtEnd() && !this.check('STATEMENT_TERMINATOR')) {
      if (this.check('CONTINUATION')) {
        if (this.skipContinuation()) {
          continue;
        }
      }
      const my_token = this.advance();
      if (my_token.type === 'COMMENT_LINE' || my_token.type === 'COMMENT_BLOCK') {
        continue;
      }
      if (!saw_comma && my_token.type === 'COMMA') {
        saw_comma = true;
        continue;
      }
      if (saw_comma) {
        option_tokens.push(my_token);
      }
    }
    const define_options = saw_comma
      ? this.reconstruct_value_tokens(option_tokens).trim()
      : undefined;

    // Parse program body
    const body: StataNode[] = [];
    const was_inside_program = this.inside_program;
    this.inside_program = true;

    // Collect any leading trivia before re-checking `end`, mirroring
    // parseBraceBody (issue #301).
    // Set when the program ends at an embedded block's `end`
    let embedded_block_end: Position | undefined;
    while (!this.isAtEnd()) {
      const my_trivia = this.collectTrivia();
      if (my_trivia.length > 0) {
        this.pending_trivia.push(...my_trivia);
      }
      if (this.checkWord('end') || this.isAtEnd()) {
        break;
      }
      const stmt = this.parseStatement();
      if (stmt) {
        body.push(stmt);
        this.note_program_ending_block(stmt);
      }
      if (this.program_end_at !== undefined) {
        embedded_block_end = this.program_end_at;
        break;
      }
    }

    const program_block_ending_trivia = this.checkWord('end')
      ? this.drainBlockEndingTrivia()
      : undefined;

    this.inside_program = was_inside_program;
    this.program_end_at = undefined;

    // Consume 'end'
    if (embedded_block_end !== undefined) {
      // The block's `end` was the program's
    } else if (this.checkWord('end')) {
      this.advance();
    } else {
      this.addError('Missing "end" for program definition', start_token.range);
      // Printing the AST would add the missing closer
      this.note_unprintable(start_token.range.start);
    }

    // Extract and merge signatures from syntax nodes
    const merged_signature = this.extract_and_merge_signatures(body);

    return {
      type: 'program',
      name: program_name,
      ...(define_keyword !== undefined ? { define_keyword } : {}),
      ...(define_options !== undefined ? { define_options } : {}),
      body,
      signature: merged_signature,
      ...(embedded_block_end !== undefined
        ? { ends_at_embedded_block: true }
        : {}),
      range: this.makeRange(
        start_token.range.start,
        embedded_block_end ?? this.previous().range.end
      ),
      blockEndingTrivia: program_block_ending_trivia,
    };
  }

  private extract_and_merge_signatures(body: StataNode[]): ProgramSignature | undefined {
    // The syntax statements the signature comes from (see
    // program_signature_syntax_nodes)
    const syntax_nodes = program_signature_syntax_nodes(body);

    // If no syntax nodes, return undefined
    if (syntax_nodes.length === 0) {
      return undefined;
    }

    // Merge signatures in order of appearance
    // Arguments are concatenated, options are preserved (including duplicates)
    const merged_arguments: ArgumentSpec[] = [];
    const merged_options: OptionSpec[] = [];
    let allows_arbitrary_options = false;
    const syntax_ranges: Range[] = [];

    for (const syntax_node of syntax_nodes) {
      const sig = syntax_node.signature;

      // Concatenate arguments
      merged_arguments.push(...sig.arguments);

      // Preserve all options (including duplicates)
      merged_options.push(...sig.options);

      // Track arbitrary options marker
      if (sig.allowsArbitraryOptions) {
        allows_arbitrary_options = true;
      }

      // Track syntax ranges
      syntax_ranges.push(...sig.syntaxRanges);
    }

    return {
      arguments: merged_arguments,
      options: merged_options,
      allowsArbitraryOptions: allows_arbitrary_options,
      syntaxRanges: syntax_ranges,
    };
  }

  private parseMacroDefinition(): MacroDefNode {
    const scopeToken = this.advance(); // consume 'local' or 'global'
    const scope = scopeToken.value as 'local' | 'global';

    this.skipMacroDefinitionTrivia();

    // Handle prefix increment/decrement: local ++i or local --i
    let prefixOp: string | undefined;
    if (this.check('OPERATOR') && (this.peek().value === '++' || this.peek().value === '--')) {
      prefixOp = this.advance().value;
      this.skipMacroDefinitionTrivia();
    }

    if (!this.check('WORD')) {
      this.addError('Expected macro name', this.peek().range);
      throw new Error('Missing macro name');
    }

    const nameToken = this.advance();
    // `` local foo`x' 1 `` defines `foo` followed by the value of `x`,
    // so the name runs on across touching macro references.
    const the_name_tokens = this.read_joined_name(nameToken);
    const macroName = the_name_tokens.map((t) => t.value).join('');
    const name_parts = the_name_tokens.length > 1
      ? name_parts_from_tokens(the_name_tokens)
      : undefined;

    // Check for suffix increment/decrement (likely mistake): local i++
    // This assigns "++" to the macro instead of incrementing it.
    this.skipMacroDefinitionTrivia();
    if (!prefixOp && this.check('OPERATOR') && (this.peek().value === '++' || this.peek().value === '--')) {
      const suffixOp = this.peek().value;
      this.errors.push({
        message: `Macro ${suffixOp} suffix is likely a mistake. Did you mean ${suffixOp}${macroName}?`,
        range: this.makeRange(nameToken.range.start, this.peek().range.end),
        code: ParseErrorCode.REDUNDANT_MACRO_SUFFIX,
      });
      // Continue parsing as if standard assignment (which is what Stata does)
    }

    // Check for colon (extended macro syntax)
    if (this.check('COLON')) {
      const extended_node = this.parse_extended_macro_def(scopeToken, scope, macroName);
      if (name_parts) {
        extended_node.name_parts = name_parts;
      }
      return extended_node;
    }

    // Skip assignment operator if present
    let has_equals = false;
    if (this.check('OPERATOR') && this.peek().value === '=') {
      has_equals = true;
      this.advance();
    }
    this.skipMacroDefinitionTrivia();

    // Collect the rest of the line as the macro value (stop at comment or terminator)
    const prefix_value = prefixOp || ''; // If prefixOp exists and no = value follows, it signifies increment
    const value_start_pos = this.current;
    let paren_depth = 0;
    const value_tokens: Token[] = [];

    while (!this.check('STATEMENT_TERMINATOR') && !this.isAtEnd()) {
      // Handle continuation tokens - skip them and continue parsing
      if (this.check('CONTINUATION')) {
        if (this.skipContinuation()) {
          continue;
        }
      }

      // A comment with more of the value after it is whitespace; other
      // comments end the value (continuations are handled above).
      const token_type = this.peek().type;
      if (this.is_interior_comment(this.current)) {
        this.advance();
        continue;
      }
      if (token_type === 'COMMENT_LINE' || token_type === 'COMMENT_BLOCK') {
        break;
      }

      const token = this.advance();

      // Track parenthesis depth for error checking
      if (token.type === 'LPAREN') {
        paren_depth++;
      } else if (token.type === 'RPAREN') {
        paren_depth--;
        // Check for unbalanced parentheses (more closing than opening)
        if (paren_depth < 0) {
          this.addError('Unbalanced parentheses: unexpected closing parenthesis', token.range, ParseErrorCode.UNBALANCED_PARENTHESES);
          paren_depth = 0; // Reset to prevent cascading errors
        }
      }

      value_tokens.push(token);
    }

    // Reconstruct with single-space separation from token ranges. The lexer
    // drops whitespace tokens in `#delimit cr` mode, so plain concatenation
    // would collapse `local mylist a b c` to "abc" and `` `a' `b' `` to
    // "`a'`b'". A separated token pair (gap on the same line, or a line break
    // from a `///` continuation) becomes one space; adjacent tokens stay joined.
    const value = prefix_value + this.reconstruct_value_tokens(value_tokens);

    // Check for unbalanced parentheses (unclosed opening parentheses)
    if (paren_depth > 0) {
      const end_pos = this.current > 0 ? this.previous().range : this.peek().range;
      this.addError('Unbalanced parentheses: missing closing parenthesis', end_pos, ParseErrorCode.UNBALANCED_PARENTHESES);
    }

    // Check for missing expression after equals sign
    if (has_equals && value.trim() === '' && !prefixOp) {
      const equals_pos = value_start_pos > 0 ? this.tokens[value_start_pos - 1].range : this.peek().range;
      this.addError('Missing expression after equals sign', equals_pos, ParseErrorCode.MISSING_EXPRESSION_AFTER_EQUALS);
    }

    const macro_node: MacroDefNode = {
      type: 'macro_def',
      scope,
      name: macroName,
      value: value.trim(),
      hasEquals: has_equals,
      range: this.makeRange(scopeToken.range.start, this.previous().range.end),
    };
    if (name_parts) {
      macro_node.name_parts = name_parts;
    }
    if (prefixOp === '++' || prefixOp === '--') {
      macro_node.increment = prefixOp;
    }
    if (has_equals && this.structured) {
      const equals_end = value_start_pos > 0
        ? this.tokens[value_start_pos - 1].range.end
        : scopeToken.range.end;
      macro_node.expression_ast = value_tokens.length > 0
        ? parse_expression(value_tokens)
        : empty_expression(equals_end);
    }
    return macro_node;
  }

  /**
   * `first` and the tokens after it that join it into one name, as
   * Stata reads `` foo`x'bar `` or `` foo${g} ``: a touching macro
   * reference, a word or number touching one, or, after one, any
   * touching word or number (`` foo`x'1bar ``). A quote, `:`, `=`
   * or other operator ends the name (`` local q`x'"a b" `` names
   * `` q`x' ``; checked in StataMP 18).
   */
  private read_joined_name(first: Token): Token[] {
    const the_tokens = [first];
    let previous = first;
    let has_macro = is_macro_piece({ text: first.value, range: first.range });
    while (!this.isAtEnd()) {
      const next = this.peek();
      const next_piece = { text: next.value, range: next.range };
      if (!NAME_PIECE_TOKEN_TYPES.has(next.type) ||
          !joins_name(
            { text: previous.value, range: previous.range },
            next_piece,
            has_macro)) {
        break;
      }
      the_tokens.push(this.advance());
      previous = next;
      has_macro = has_macro || is_macro_piece(next_piece);
    }
    return the_tokens;
  }

  private parse_extended_macro_def(scopeToken: Token, scope: 'local' | 'global', macroName: string): MacroDefNode {
    this.advance(); // consume colon
    this.skipMacroDefinitionTrivia();

    // The function may be named by macros, joined like a macro name:
    // `` local x : `ch'(scalars) `` runs `e(scalars)` when `ch` is `e`,
    // and `` local x : `what'names m `` runs `rownames` (StataMP 18).
    if (!this.check('WORD') && !this.check('MACRO_REF_LOCAL') &&
        !this.check('MACRO_REF_GLOBAL')) {
      this.addError('Expected function name after colon', this.peek().range);
      throw new Error('Missing function name');
    }

    const function_name = this.read_joined_name(this.advance())
      .map((my_token) => my_token.value)
      .join('');
    this.skipMacroDefinitionTrivia();

    // Collect function arguments. `arg_tokens` keeps every token for
    // macro-reference extraction, while `value_tokens` holds the tokens used
    // to reconstruct the arg string from source ranges. Range reconstruction
    // keeps the two delimiter modes identical (a single space per gap) and
    // never invents artificial boundaries (adjacent tokens like `0Ea` stay
    // joined).
    const arg_tokens: Token[] = [];
    const value_tokens: Token[] = [];
    while (!this.check('STATEMENT_TERMINATOR') && !this.isAtEnd()) {
      // Bridge `///` continuations onto the next physical line, matching the
      // standard `= ...` value path.
      if (this.check('CONTINUATION')) {
        if (this.skipContinuation()) {
          continue;
        }
      }

      // A comment with more arguments after it is whitespace; other
      // comments end the arguments (continuations are handled above).
      if (this.is_interior_comment(this.current)) {
        this.advance();
        continue;
      }
      if (this.check('COMMENT_LINE') || this.check('COMMENT_BLOCK')) {
        break;
      }

      const token = this.advance();
      arg_tokens.push(token);
      value_tokens.push(token);
    }

    // Reconstruct args with mode-independent single-space spacing.
    const args_trimmed = this.reconstruct_value_tokens(value_tokens).trim();
    const extended_function = {
      name: function_name,
      args: args_trimmed,
      macroRefs: this.extract_macro_refs_from_extended_tokens(function_name, arg_tokens),
    };

    return {
      type: 'macro_def',
      scope,
      name: macroName,
      value: '', // Extended macros don't have direct values
      extendedFunction: extended_function,
      range: this.makeRange(scopeToken.range.start, this.previous().range.end),
    };
  }

  private extract_macro_refs_from_extended_tokens(
    function_name: string,
    arg_tokens: Token[]
  ): MacroReference[] {
    const macro_refs: MacroReference[] = [];

    // 1) Explicit macro tokens (`name' and $name/${name}) come from the lexer with exact ranges.
    for (const my_token of arg_tokens) {
      if (my_token.type === 'MACRO_REF_LOCAL') {
        const macro_name = this.extract_local_macro_name(my_token.value);
        if (macro_name) {
          macro_refs.push({
            name: macro_name,
            range: my_token.range,
            scope: 'local',
          });
        }
      } else if (my_token.type === 'MACRO_REF_GLOBAL') {
        const macro_name = this.extract_global_macro_name(my_token.value);
        if (macro_name) {
          macro_refs.push({
            name: macro_name,
            range: my_token.range,
            scope: 'global',
          });
        }
      }
    }

    // 2) The operands of `list` are macro names written bare
    // (`list a - b`), so they are local macro references too. No other
    // extended function takes a bare macro name operand that is
    // checked, so only `list` gets them.
    if (function_name === 'list') {
      for (const my_token of list_operand_tokens(arg_tokens)) {
        macro_refs.push({
          name: my_token.value,
          range: my_token.range,
          scope: 'local',
        });
      }
    }

    return macro_refs;
  }

  private extract_local_macro_name(value: string): string | null {
    // Remove backtick prefix and apostrophe suffix
    if (value.startsWith('`') && value.endsWith("'")) {
      return unwrap_macval(value.slice(1, -1));
    }
    return null;
  }

  private extract_global_macro_name(value: string): string | null {
    if (value.startsWith('${') && value.endsWith('}')) {
      // ${name} format
      return value.slice(2, -1);
    } else if (value.startsWith('$')) {
      // $name format
      return value.slice(1);
    }
    return null;
  }


  /**
   * A prefixed definition still defines the macro: `capture local y 2`,
   * `qui: local z 3`, `version 14: local x = 1`, `frame f: local x 1`.
   * Like an unprefixed one, a definition whose name is not a plain word
   * (`` global `g' = 1 ``) stays a command, so this returns null.
   */
  private parse_prefixed_macro_definition(
    prefixes: PrefixNode[],
    start_token: Token
  ): MacroDefNode | null {
    if (prefixes.length === 0 ||
        !(this.checkWord('local') || this.checkWord('global')) ||
        !this.looksLikeMacroDefinition()) {
      return null;
    }
    const macro_node = this.parseMacroDefinition();
    macro_node.prefix = prefixes;
    macro_node.range = this.makeRange(start_token.range.start, macro_node.range.end);
    return macro_node;
  }

  /**
   * The control-flow statement after a prefix, or undefined. Stata 18
   * runs `capture while 1 {`, `quietly if 1 {`, `noisily foreach`,
   * `qui else {`, and `capture frame f {` with their bodies.
   */
  private parse_prefixed_control_flow(): ControlFlowNode | undefined {
    if (this.checkWord('foreach') || this.checkForvalues()) {
      return this.parseLoopStatement();
    }
    if (this.checkWord('while')) {
      return this.parseWhileStatement();
    }
    if (this.checkWord('if')) {
      return this.parseIfStatement();
    }
    if (this.checkWord('else')) {
      return this.parseElseStatement();
    }
    if (this.checkWord('frame') && this.starts_frame_block()) {
      const frame_node = this.parseFrameBlock();
      return frame_node?.type === 'frame' ? frame_node : undefined;
    }
    return undefined;
  }

  /** Put `the_comments`, from before the node's header, first in its interiorTrivia. */
  private add_interior_comments(node: ControlFlowNode, the_comments: TriviaNode[]): void {
    const the_merged = [...the_comments, ...(node.interiorTrivia ?? [])];
    if (the_merged.length > 0) {
      node.interiorTrivia = the_merged;
    }
  }

  /** Does `frame name {` start at the current token? */
  private starts_frame_block(): boolean {
    const name_index = this.index_after_statement_trivia(this.current + 1);
    if (this.tokens[name_index]?.type !== 'WORD') {
      return false;
    }
    const brace_index = this.index_after_statement_trivia(name_index + 1);
    return this.tokens[brace_index]?.type === 'LBRACE';
  }

  private parseCommand(): CommandNode | MacroDefNode | ControlFlowNode {
    const start_token = this.peek();
    const start_index = this.current;
    const command_start_line = start_token.range.start.line;

    // Parse prefix commands (by, quietly, capture, svy:, etc.)
    const prefixes: PrefixNode[] = [];
    this.parse_prefix_chain(prefixes);
    // Comments the prefix chain read as whitespace. Plain commands and
    // macro definitions collect theirs in parseStatement.
    const prefix_comments = this.comments_between(start_index, this.current);

    const macro_node = this.parse_prefixed_macro_definition(prefixes, start_token);
    if (macro_node) {
      return macro_node;
    }
    // A prefixed loop, `if`, `else`, `while`, or frame block keeps its
    // body: `capture while 1 {`, `quietly if 1 {`, `version 14: foreach`.
    const control_node = prefixes.length > 0
      ? this.parse_prefixed_control_flow()
      : undefined;
    if (control_node) {
      control_node.prefix = prefixes;
      control_node.range = this.makeRange(start_token.range.start, control_node.range.end);
      this.add_interior_comments(control_node, prefix_comments);
      return control_node;
    }

    // Check if this is a syntax command after prefixes
    // (e.g., qui syntax anything [if] [in])
    // This must be checked before embedded language blocks
    if (this.checkWord('syntax')) {
      const syntax_node = this.parseSyntaxCommand();
      // Attach prefixes to the syntax node
      if (prefixes.length > 0) {
        syntax_node.prefix = prefixes;
        // Update range to include prefixes
        syntax_node.range = this.makeRange(
          start_token.range.start,
          syntax_node.range.end
        );
      }
      return syntax_node as unknown as CommandNode;
    }

    // Check if this is an embedded language block after prefixes
    // (e.g., capture mata: ...)
    const is_mata = this.check('MATA_START') || this.check('MATA_INLINE');
    if (is_mata || this.check('PYTHON_START') || this.check('PYTHON_INLINE')) {
      const embedded_node = this.parseEmbeddedLanguageBlock(is_mata ? 'mata' : 'python');
      // Attach prefixes to the embedded block
      if (prefixes.length > 0) {
        embedded_node.prefix = prefixes;
        // Update range to include prefixes
        embedded_node.range = this.makeRange(
          start_token.range.start,
          embedded_node.range.end
        );
      }
      if (prefix_comments.length > 0) {
        embedded_node.interiorTrivia = prefix_comments;
      }
      return embedded_node as unknown as CommandNode;
    }

    // Check if this is a block after prefixes (e.g., quietly { ... })
    if (this.check('LBRACE')) {
      const lbrace_index = this.current;
      const lbrace_token = this.advance(); // consume {

      // Validate open brace placement
      // has_condition_before is true if brace is on same line as prefix command
      const has_condition_before =
          lbrace_token.range.start.line === command_start_line;
      const has_code_after = this.validate_open_brace(
        lbrace_token, lbrace_index, has_condition_before);
      // Stata 18 stops at `{ di 1` and `quietly { di 1` ("code follows
      // on the same line as open brace", r(198)); printing the AST
      // would move `di 1` onto its own line, where it runs.
      if (has_code_after) {
        this.note_unprintable(lbrace_token.range.start);
      }

      const body: StataNode[] = [];
      const { body: my_body, blockEndingTrivia } = this.parseBraceBody();
      body.push(...my_body);
      let closed_by_program_end = false;
      // After the program's end, a `}` is a statement of its own.
      if (this.check('RBRACE') && !this.program_ended_in_block()) {
        const rbrace_index = this.current;
        const rbrace_token = this.advance(); // consume }

        // Validate close brace placement
        this.validate_close_brace(rbrace_token, rbrace_index);
      } else if (this.program_ended_in_block()) {
        closed_by_program_end = true;
      } else {
        // Printing the AST would add the missing closer
        this.note_unprintable(start_token.range.start);
      }

      return {
        type: 'command',
        prefix: prefixes.length > 0 ? prefixes : undefined,
        name: '{',
        fullName: '{',
        expression: undefined,
        body,
        range: this.makeRange(
          start_token.range.start,
          this.brace_block_end()
        ),
        interiorTrivia: prefix_comments.length > 0 ? prefix_comments : undefined,
        blockEndingTrivia,
        ...(closed_by_program_end ? { closed_by_program_end: true } : {}),
      };
    }

    if (!this.check('WORD') && !this.check('MACRO_REF_LOCAL') && !this.check('MACRO_REF_GLOBAL')) {
      // `capture`, `quietly:`, and `capture: * note` are valid Stata.
      if (!this.at_statement_end()) {
        this.addError('Expected command name', this.peek().range);
      } else {
        // `capture` alone then `{` on the next line: Stata 18 runs the
        // block without the prefix (an error in it is not captured).
        this.report_brace_after_statement(
          start_token, 'here the block runs without it');
      }
      // This point is only reachable after consuming one or more prefix
      // commands (a zero-prefix entry always starts on a WORD/macro_ref), so
      // we have a dangling prefix like `quietly` or `by` with no command after
      // it. Throwing here would unwind past an enclosing block before its `}`
      // is consumed, leaving the brace to be misreported as an orphan close
      // brace. Instead, emit the diagnostic above and return a node for the
      // consumed prefix(es), leaving the current token (e.g. the block's `}`)
      // for the enclosing parser to handle.
      return {
        type: 'command',
        prefix: prefixes.length > 0 ? prefixes : undefined,
        name: '',
        fullName: '',
        expression: undefined,
        range: this.makeRange(
          start_token.range.start,
          this.previous().range.end
        ),
      };
    }

    const command_token = this.advance();
    const commandName = command_token.value;

    // Special handling for unab command: unab macroname : varlist
    if (commandName === 'unab') {
      return this.parseUnabCommand(command_token, prefixes);
    }

    // Special handling for args command: args name1 [name2 ...]
    // The args command doesn't support if/in qualifiers, so 'if' and 'in' are valid macro names
    if (commandName === 'args') {
      return this.parseArgsCommand(command_token, prefixes);
    }

    // Special handling for frame prefix: frame name: command
    // This handles cases like `capture frame this: that`.
    if (commandName === 'frame') {
      const saved_pos = this.current;
      if (this.check('WORD')) {
        const frame_name_token = this.advance();
        this.skipTrivia();
        if (this.check('COLON')) {
          // This is frame prefix syntax: frame name: command
          this.advance(); // consume colon

          // Create a prefix node for the frame
          const frame_prefix: PrefixNode = {
            type: 'prefix',
            name: 'frame',
            fullName: 'frame',
            frameName: frame_name_token.value,
            has_colon: true,
            range: this.makeRange(
              command_token.range.start,
              this.previous().range.end
            ),
          };

          // Use shared helper for consistent frame prefix parsing
          const frame_node = this.parseFramePrefixedCommand(
            frame_prefix, prefixes, start_token, saved_pos - 1
          );
          // `capture /* c */ frame f: if 1 {`: plain commands collect
          // their comments in parseStatement; a loop or if does not.
          if (frame_node.type !== 'command' && frame_node.type !== 'macro_def') {
            this.add_interior_comments(frame_node, prefix_comments);
          }
          return frame_node;
        }
      }
      // Not frame prefix syntax, backtrack
      this.current = saved_pos;
    }

    // Delegate to parseCommandBody for varlist/expression/qualifier/option parsing
    return this.parseCommandBody(command_token, prefixes, start_token);
  }

  /**
   * Parse a frame-prefixed command after the frame prefix has been identified.
   * Shared logic used by both parseCommand and parseFrameBlock to ensure
   * consistent handling of frame prefix syntax:
   * frame name: [prefix...] command [args]
   *
   * @param frame_prefix - The frame prefix node (has_colon=true)
   * @param prefixes - Array of prefix nodes to append to
   * @param start_token - The original start token for range calculation
   * @param frame_index - Index of the `frame` token
   * @returns the frame-prefixed command, loop, if, or macro definition
   */
  private parseFramePrefixedCommand(
    frame_prefix: PrefixNode,
    prefixes: PrefixNode[],
    start_token: Token,
    frame_index: number
  ): CommandNode | MacroDefNode | ControlFlowNode {
    prefixes.push(frame_prefix);

    // Skip whitespace after the colon. A comment that ends the
    // statement (`frame f:` then `* note;` under `#delimit ;`) stays.
    this.skip_statement_whitespace();

    // Parse any additional prefix commands (e.g., frame name: quietly: command)
    this.parse_prefix_chain(prefixes);

    // Skip any remaining whitespace before the main command
    this.skip_statement_whitespace();

    const macro_node = this.parse_prefixed_macro_definition(prefixes, start_token);
    if (macro_node) {
      return macro_node;
    }
    // Comments from `frame` on, e.g. `frame f: /* c */ while 1 {`.
    // Plain commands collect theirs in parseStatement.
    const frame_comments = this.comments_between(frame_index, this.current);
    const control_node = this.parse_prefixed_control_flow();
    if (control_node) {
      control_node.prefix = prefixes;
      control_node.range = this.makeRange(start_token.range.start, control_node.range.end);
      this.add_interior_comments(control_node, frame_comments);
      return control_node;
    }

    // Now parse the main command
    if (!this.check('WORD') && !this.check('MACRO_REF_LOCAL') &&
        !this.check('MACRO_REF_GLOBAL')) {
      if (!this.at_statement_end()) {
        this.addError(
          'Expected command name after frame prefix',
          this.peek().range
        );
      }
      return {
        type: 'command',
        prefix: prefixes,
        name: '',
        fullName: '',
        range: this.makeRange(
          start_token.range.start,
          this.previous().range.end
        ),
      };
    }

    const command_token = this.advance();
    const command_name = command_token.value;

    // Special handling for unab command: unab macroname : varlist
    if (command_name === 'unab') {
      const unab_node = this.parseUnabCommandBody(command_token);
      unab_node.prefix = prefixes;
      unab_node.range = this.makeRange(
        start_token.range.start,
        unab_node.range.end
      );
      return unab_node;
    }

    // Use parseCommandBody for consistent varlist/option parsing
    // This ensures wildcards and other features work the same way
    return this.parseCommandBody(command_token, prefixes, start_token);
  }

  /**
   * Parse the body of a command (varlist, expression, qualifiers, options).
   * Used when the command name has already been consumed.
   *
   * The node covers the whole statement: tokens that fit no other slot
   * are kept in `extra_args` rather than starting new command nodes.
   * Qualifiers (`= exp`, `if`, `in`, weights, `using`) may come in any
   * order, as Stata allows.
   */
  private parseCommandBody(
    command_token: Token,
    prefixes: PrefixNode[],
    start_token: Token
  ): CommandNode {
    const command_name = command_token.value;

    // Parse variable list (stop at comma, statement terminator, comment,
    // qualifier keyword, or weight). Use file path coalescing for file
    // commands.
    const varlist: IdentifierNode[] = [];
    // Argument tokens from the first one that cannot belong to a varlist
    // (an operator, colon, or bracket) up to the qualifiers.
    const extra_tokens: Token[] = [];

    // For file commands, try to parse the first argument as a file path
    const is_file_cmd = isFileCommand(command_name);
    const has_file_arg = this.check('WORD') || this.check('NUMBER') ||
        this.check('OPERATOR') || this.check('STRING') ||
        this.check('MACRO_REF_LOCAL') || this.check('MACRO_REF_GLOBAL');
    if (is_file_cmd && has_file_arg && !this.checkWord('using')) {
      const file_path = this.parseFilePathArgument();
      if (file_path) {
        varlist.push(file_path);
      }
    }

    // Parse remaining arguments (including parenthesized groups)
    let extra_depth = 0;
    while (!this.isAtEnd()) {
      if (this.skipContinuation()) {
        continue;
      }
      if (this.is_interior_comment(this.current)) {
        this.advance(); // a comment inside the statement is whitespace
        continue;
      }
      if (this.isTrivia() || this.check('STATEMENT_TERMINATOR') ||
          this.check('LBRACE') || this.check('RBRACE')) {
        break;
      }
      if (extra_depth === 0 && this.at_argument_boundary() &&
          !(this.check('COMMA') && DISPLAY_COMMANDS.has(command_name))) {
        break;
      }

      if (extra_tokens.length === 0) {
        // Check for wildcard operators (* and ?) which are valid in varlists
        const is_wildcard = this.check('OPERATOR') &&
            (this.peek().value === '*' || this.peek().value === '?');

        const is_varlist_token = this.check('WORD') || this.check('STRING') ||
            this.check('MACRO_REF_LOCAL') || this.check('MACRO_REF_GLOBAL') ||
            this.check('NUMBER') || is_wildcard;
        if (is_varlist_token) {
          const var_token = this.advance();
          let name = var_token.value;
          let end_range = var_token.range.end;

          // Coalesce adjacent wildcard tokens (e.g., var* -> single item "var*")
          // Only coalesce if the wildcard immediately follows (no whitespace)
          while (!this.isAtEnd() && this.isWildcardToken(this.peek()) &&
                 this.isAdjacentToken(this.previous(), this.peek())) {
            const wildcard_token = this.advance();
            name += wildcard_token.value;
            end_range = wildcard_token.range.end;
          }

          varlist.push({
            name: name,
            range: { start: var_token.range.start, end: end_range },
          });
          continue;
        }
        if (this.check('LPAREN')) {
          const paren_node = this.parseParenthesizedGroup();
          if (paren_node) {
            varlist.push(paren_node);
          }
          continue;
        }
      }

      const extra_token = this.advance();
      if (extra_token.type === 'LPAREN' || extra_token.type === 'LBRACKET') {
        extra_depth++;
      } else if (extra_token.type === 'RPAREN' || extra_token.type === 'RBRACKET') {
        extra_depth = Math.max(0, extra_depth - 1);
      }
      extra_tokens.push(extra_token);
    }

    // Qualifiers, in any order, then options.
    let expression: string | undefined;
    let expression_ast: ExpressionNode | undefined;
    let ifExpression: string | undefined;
    let if_ast: ExpressionNode | undefined;
    let inExpression: string | undefined;
    let in_range: InRangeNode | undefined;
    let weight: WeightClause | undefined;
    let using_clause: UsingClause | undefined;
    let saw_using = false;
    const options: OptionNode[] = [];
    let options_tail: IdentifierNode[] = [];

    for (;;) {
      if (this.skipContinuation()) {
        continue;
      }
      if (this.is_interior_comment(this.current)) {
        this.advance();
        continue;
      }
      if (expression === undefined && this.check('OPERATOR') &&
          this.peek().value === '=') {
        const equals_token = this.advance(); // consume '='
        const collected = this.collect_expression();
        expression = collected.text;
        if (this.structured) {
          expression_ast = collected.tokens.length > 0
            ? (command_name === 'egen'
                ? parse_egen_function(collected.tokens)
                : parse_expression(collected.tokens))
            : empty_expression(equals_token.range.end);
        }
        continue;
      }
      if (ifExpression === undefined && this.checkWord('if')) {
        const if_token = this.advance(); // consume 'if'
        const collected = this.collect_qualifier_expression('if', true, true);
        ifExpression = collected.text;
        if (this.structured) {
          if_ast = collected.tokens.length > 0
            ? parse_expression(collected.tokens)
            : empty_expression(if_token.range.end);
        }
        continue;
      }
      if (inExpression === undefined && this.checkWord('in')) {
        const in_token = this.advance(); // consume 'in'
        const collected = this.collect_qualifier_expression('in', false, false);
        inExpression = collected.text;
        if (this.structured) {
          in_range = parse_in_range(collected.tokens, in_token.range.end);
        }
        continue;
      }
      if (weight === undefined && this.is_weight_start(this.current)) {
        weight = this.parse_weight_clause();
        continue;
      }
      if (!saw_using && this.checkWord('using')) {
        saw_using = true;
        using_clause = this.parse_using_clause(varlist);
        continue;
      }
      if (this.check('COMMA')) {
        options_tail = this.parse_command_options(options, this.advance());
        break;
      }
      if (this.isAtEnd() || this.check('STATEMENT_TERMINATOR') ||
          this.check('LBRACE') || this.check('RBRACE') || this.isTrivia()) {
        break;
      }
      // A token no slot accepts (e.g. a second `if`): keep it with the
      // statement instead of letting it start a new command.
      extra_tokens.push(this.advance());
    }

    const extra_args = this.group_adjacent_tokens(extra_tokens);
    const node: CommandNode = {
      type: 'command',
      prefix: prefixes.length > 0 ? prefixes : undefined,
      name: command_name,
      fullName: command_name,
      varlist: varlist.length > 0 ? varlist : undefined,
      options: options.length > 0 ? options : undefined,
      expression,
      ifExpression,
      inExpression,
      range: this.makeRange(start_token.range.start, this.previous().range.end),
    };
    if (extra_args.length > 0) {
      node.extra_args = extra_args;
    }
    if (options_tail.length > 0) {
      node.options_tail = options_tail;
    }
    if (expression_ast) {
      node.expression_ast = expression_ast;
    }
    if (if_ast) {
      node.if_ast = if_ast;
    }
    if (in_range) {
      node.in_range = in_range;
    }
    if (weight) {
      node.weight = weight;
    }
    if (using_clause && this.structured) {
      node.using = using_clause;
    }
    return node;
  }

  /**
   * Parse command options after the comma. Continuations join option
   * lines and comments inside the statement are whitespace; other
   * comments end the options.
   *
   * Returns the rest of the statement from a token no option can start,
   * as in `twoway scatter y x, mcolor(red) || line y x`, for
   * `options_tail`. With no option before it, the comma is part of that
   * too, so a bare trailing comma (`reg y x,`) is kept.
   */
  private parse_command_options(options: OptionNode[], comma_token: Token): IdentifierNode[] {
    // Token index of each option's name
    const the_option_starts: number[] = [];
    while (!this.check('STATEMENT_TERMINATOR') && !this.isAtEnd()) {
      if (this.skipContinuation()) continue;
      if (this.is_interior_comment(this.current)) {
        this.advance();
        continue;
      }
      if (this.isTrivia()) break;
      if (this.check('WORD')) {
        the_option_starts.push(this.current);
        const optionToken = this.advance();
        const option: OptionNode = {
          type: 'option',
          name: optionToken.value,
          fullName: optionToken.value,
          range: optionToken.range,
        };

        // Check for option argument
        if (this.check('LPAREN')) {
          const parsed = this.parse_option_argument_inside_parens();
          option.argument = parsed.argument;
          option.argument_range = parsed.argument_range;
          if (parsed.argument_unclosed) {
            option.argument_unclosed = true;
          }
        }

        options.push(option);
      } else {
        // An option can't start here. One it touches (`robust/cluster`)
        // goes with it, so the text stays as written.
        const last_start = the_option_starts[the_option_starts.length - 1];
        if (last_start !== undefined &&
            this.isAdjacentToken(this.previous(), this.peek())) {
          options.pop();
          this.current = last_start;
        }
        return this.option_tail_items(options, comma_token, this.collect_statement_tail_tokens(false));
      }
    }
    return this.option_tail_items(options, comma_token, []);
  }

  /** The `options_tail` items for parse_command_options. */
  private option_tail_items(
    options: OptionNode[],
    comma_token: Token,
    the_tokens: Token[]
  ): IdentifierNode[] {
    return this.group_adjacent_tokens(
      options.length === 0 ? [comma_token, ...the_tokens] : the_tokens);
  }

  /**
   * True at a token that ends a command's argument list: a comma, a
   * qualifier keyword, `using`, a weight, or `=`.
   */
  private at_argument_boundary(): boolean {
    if (this.check('COMMA')) {
      return true;
    }
    if (this.checkWord('if') || this.checkWord('in') || this.checkWord('using')) {
      return true;
    }
    if (this.check('OPERATOR') && this.peek().value === '=') {
      return true;
    }
    return this.is_weight_start(this.current);
  }

  /**
   * Does the statement have more code after the comment(s) at `index`?
   * A comment followed by code is whitespace inside the statement; one
   * at the end of the statement is trailing trivia. A `//` comment can
   * be followed by code only under `#delimit ;`, where its line break
   * doesn't end the statement: `di 1 // c` then `2;` displays 12
   * (Stata 18).
   */
  private statement_continues_after(index: number): boolean {
    let i = index;
    for (;;) {
      const my_token = this.tokens[i];
      if (my_token !== undefined && is_statement_ending_comment(my_token)) {
        return false;
      }
      if (my_token?.type === 'COMMENT_BLOCK' || my_token?.type === 'COMMENT_LINE' ||
          my_token?.type === 'CONTINUATION') {
        i++;
        continue;
      }
      // The newline after `///` joins the next line to the statement.
      if (my_token !== undefined && i > 0 &&
          is_swallowed_continuation_terminator(
            my_token, this.tokens[i - 1].type === 'CONTINUATION')) {
        i++;
        continue;
      }
      break;
    }
    const next = this.tokens[i];
    return next !== undefined &&
      next.type !== 'STATEMENT_TERMINATOR' &&
      next.type !== 'EOF';
  }

  /**
   * Does the statement end at the current token: a terminator, the end
   * of the file, or a comment with nothing of the statement after it?
   */
  private at_statement_end(): boolean {
    const type = this.peek().type;
    if (type === 'STATEMENT_TERMINATOR' || type === 'EOF') {
      return true;
    }
    return (type === 'COMMENT_LINE' || type === 'COMMENT_BLOCK') &&
      !this.statement_continues_after(this.current);
  }

  /** Is the token at `index` a comment with more of the statement after it? */
  private is_interior_comment(index: number): boolean {
    const type = this.tokens[index]?.type;
    return (type === 'COMMENT_BLOCK' || type === 'COMMENT_LINE') &&
      this.statement_continues_after(index);
  }

  /**
   * Does a weight clause start at token index `index`? Either
   * `[keyword = ...]` with a Stata weight keyword, or the
   * `` [`weight'`exp'] `` idiom of programs that use `syntax`.
   */
  private is_weight_start(index: number): boolean {
    const open = this.tokens[index];
    const keyword = this.tokens[index + 1];
    if (open?.type !== 'LBRACKET' || keyword === undefined) {
      return false;
    }
    if (keyword.type === 'MACRO_REF_LOCAL') {
      return keyword.value === "`weight'";
    }
    const equals = this.tokens[index + 2];
    return keyword.type === 'WORD' && WEIGHT_KEYWORDS.has(keyword.value) &&
      equals?.type === 'OPERATOR' && equals.value === '=';
  }

  /** Parse `[keyword = exp]` (or `` [`weight'`exp'] ``). */
  private parse_weight_clause(): WeightClause {
    const open_token = this.advance(); // consume '['
    const keyword_token = this.advance();
    const kind = WEIGHT_KEYWORDS.get(keyword_token.value) ?? null;
    if (kind !== null) {
      this.advance(); // consume '='
    }
    const the_tokens: Token[] = [];
    let depth = 0;
    while (!this.isAtEnd() && !this.check('STATEMENT_TERMINATOR')) {
      if (this.check('CONTINUATION')) {
        if (this.skipContinuation()) {
          continue;
        }
      }
      if (this.check('COMMENT_BLOCK') || this.check('COMMENT_LINE')) {
        this.advance();
        continue;
      }
      if (depth === 0 && this.check('RBRACKET')) {
        break;
      }
      const my_token = this.advance();
      if (my_token.type === 'LBRACKET' || my_token.type === 'LPAREN') {
        depth++;
      } else if (my_token.type === 'RBRACKET' || my_token.type === 'RPAREN') {
        depth = Math.max(0, depth - 1);
      }
      the_tokens.push(my_token);
    }
    if (this.check('RBRACKET')) {
      this.advance(); // consume ']'
    }
    return {
      keyword: keyword_token.value,
      kind,
      expression: this.reconstruct_value_tokens(the_tokens).trim(),
      ...(this.structured ? {
        expression_ast: the_tokens.length > 0
          ? parse_expression(the_tokens)
          : empty_expression(this.previous().range.start),
      } : {}),
      range: this.makeRange(open_token.range.start, this.previous().range.end),
    };
  }

  /**
   * Parse `using filename [filename ...]`. Each run of adjacent tokens is
   * one file name, so a quoted name with macros inside stays whole.
   *
   * `using` and the file names are also appended to `varlist`, where
   * they have always appeared, so existing consumers see no change.
   */
  private parse_using_clause(varlist: IdentifierNode[]): UsingClause {
    const using_token = this.advance(); // consume 'using'
    varlist.push({ name: using_token.value, range: using_token.range });
    const the_paths: PathNode[] = [];
    let current_path: Token[] = [];
    const flush = (): void => {
      if (current_path.length > 0) {
        const first = current_path[0];
        const last = current_path[current_path.length - 1];
        const range = this.makeRange(first.range.start, last.range.end);
        varlist.push({ name: current_path.map((t) => t.value).join(''), range });
        if (this.structured) {
          the_paths.push(parse_path(current_path));
        }
        current_path = [];
      }
    };
    while (!this.isAtEnd()) {
      if (this.skipContinuation()) {
        flush();
        continue;
      }
      if (this.is_interior_comment(this.current)) {
        flush();
        this.advance();
        continue;
      }
      if (this.check('STATEMENT_TERMINATOR') || this.check('COMMA') ||
          this.check('LBRACE') || this.check('RBRACE') || this.isTrivia()) {
        break;
      }
      const my_token = this.peek();
      const last_token = current_path[current_path.length - 1];
      const continues_path = last_token !== undefined &&
        this.isAdjacentToken(last_token, my_token);
      if (!continues_path &&
          (this.checkWord('if') || this.checkWord('in') ||
           this.is_weight_start(this.current))) {
        break;
      }
      if (!continues_path) {
        flush();
      }
      current_path.push(this.advance());
    }
    flush();
    return {
      paths: the_paths,
      range: this.makeRange(using_token.range.start, this.previous().range.end),
    };
  }

  /** Group tokens into items, joining tokens with no gap between them. */
  private group_adjacent_tokens(tokens: Token[]): IdentifierNode[] {
    const the_items: IdentifierNode[] = [];
    for (const my_token of tokens) {
      const last_item = the_items[the_items.length - 1];
      if (last_item &&
          last_item.range.end.line === my_token.range.start.line &&
          last_item.range.end.character === my_token.range.start.character) {
        last_item.name += my_token.value;
        last_item.range = { start: last_item.range.start, end: my_token.range.end };
      } else {
        the_items.push({ name: my_token.value, range: my_token.range });
      }
    }
    return the_items;
  }

  /**
   * Parse option argument inside parentheses.
   * Assumes LPAREN is next token. Consumes through RPAREN.
   * Returns argument string, argument_range (span of non-whitespace tokens),
   * and argument_unclosed when recovery stopped before consuming the outer
   * closing paren.
   */
  private parse_option_argument_inside_parens(): {
    argument: string;
    argument_range?: Range;
    argument_unclosed?: true;
  } {
    this.advance(); // consume (
    // Collect argument tokens and reconstruct spacing from their ranges via
    // reconstruct_value_tokens, so delimiter modes produce the identical
    // single-space form and multi-token arguments are never fused — e.g.
    // `absorb(firm year)` stays `firm year`, not `firmyear` (issue #306).
    const arg_tokens: Token[] = [];
    let paren_depth = 1;
    while (!this.isAtEnd() && paren_depth > 0) {
      if (this.check('STATEMENT_TERMINATOR')) {
        break;
      }
      if (this.check('CONTINUATION')) {
        if (this.skipContinuation()) {
          continue;
        }
      }
      if (this.check('COMMENT_LINE') || this.check('COMMENT_BLOCK')) {
        this.advance();
        continue;
      }
      const t = this.advance();
      if (t.type === 'LPAREN') {
        paren_depth++;
      } else if (t.type === 'RPAREN') {
        paren_depth--;
        if (paren_depth === 0) {
          break;
        }
      }
      arg_tokens.push(t);
    }
    const argument_unclosed = paren_depth > 0 ? true : undefined;
    const argument = this.reconstruct_value_tokens(arg_tokens);
    const argument_range = arg_tokens.length > 0
      ? { start: arg_tokens[0].range.start, end: arg_tokens[arg_tokens.length - 1].range.end }
      : undefined;
    return { argument, argument_range, argument_unclosed };
  }

  /**
   * Parse a file path argument for file commands.
   * Coalesces tokens until whitespace, comma, terminator, or trivia.
   */
  private parseFilePathArgument(): IdentifierNode | null {
    // If STRING token, return as-is (quoted paths already work)
    if (this.check('STRING')) {
      const token = this.advance();
      return {
        name: token.value,
        range: token.range,
      };
    }

    // Must start with WORD, NUMBER, OPERATOR, or macro ref
    if (!this.check('WORD') && !this.check('NUMBER') && !this.check('OPERATOR') && !this.check('MACRO_REF_LOCAL') && !this.check('MACRO_REF_GLOBAL')) {
      return null;
    }

    // Coalesce adjacent tokens until whitespace, comma, terminator, or trivia
    const start_token = this.advance();
    let path = start_token.value;
    let end_range = start_token.range.end;
    let prev_token = start_token;

    while (!this.isAtEnd()) {
      // Stop at whitespace, comma, terminator, or trivia
      if (this.check('COMMA') ||
          this.check('STATEMENT_TERMINATOR') ||
          this.isTrivia()) {
        break;
      }

      // Stop at a source gap. Coalescing every non-trivia token would merge a
      // file command's entire argument list into one path (e.g.
      // `merge 1:1 id using data` -> `1:1idusingdata`). Only coalesce tokens
      // physically adjacent to the previous one; a gap ends the path.
      if (!this.isAdjacentToken(prev_token, this.peek())) {
        break;
      }

      // Consume any other token as part of the path
      const token = this.advance();
      path += token.value;
      end_range = token.range.end;
      prev_token = token;
    }

    return {
      name: path,
      range: { start: start_token.range.start, end: end_range }
    };
  }

  /**
   * Parse a parenthesized group from the token stream.
   * Assumes the current token is LPAREN.
   * Handles nested parentheses and preserves spacing between word-like tokens.
   *
   * @returns IdentifierNode with the parenthesized content including surrounding
   *          parens, or null if the parenthesized group is empty/whitespace-only
   */
  private parseParenthesizedGroup(): IdentifierNode | null {
    const paren_start = this.advance(); // consume (
    // Collect the inner tokens (everything up to, but not including, the
    // matching outer close paren) and reconstruct spacing from their ranges via
    // reconstruct_value_tokens, so delimiter modes produce the identical
    // single-space form — e.g. `(a b)` stays `(a b)` and `(1/3 = 1)` is
    // `(1/3 = 1)` in both modes (issue #306).
    const inner_tokens: Token[] = [];
    let paren_depth = 1;

    const collect = (my_token: Token): void => {
      inner_tokens.push(my_token);
    };

    while (!this.isAtEnd() && paren_depth > 0) {
      if (this.check('STATEMENT_TERMINATOR')) {
        break;
      }
      if (this.check('CONTINUATION')) {
        if (this.skipContinuation()) {
          continue;
        }
      }
      if (this.check('LPAREN')) {
        paren_depth++;
        collect(this.advance());
      } else if (this.check('RPAREN')) {
        paren_depth--;
        // Collect nested close parens; the matching outer close is the wrapper
        // and is excluded from the reconstructed content.
        if (paren_depth > 0) {
          collect(this.advance());
        }
      } else {
        collect(this.advance());
      }
    }

    const paren_content = this.reconstruct_value_tokens(inner_tokens);
    const closed_group = paren_depth === 0 && this.check('RPAREN');
    const paren_end_pos = closed_group
        ? this.peek().range.end
        : this.previous().range.end;

    if (closed_group) {
      this.advance(); // consume closing paren
    }

    // Empty balanced groups are not useful varlist items. Empty unclosed
    // groups still contain authored source text: keep the opener so AST-mode
    // formatting does not delete user input while they are mid-statement.
    if (!paren_content.trim()) {
      if (closed_group) {
        return null;
      }
      return {
        name: '(',
        recovery_only: true,
        range: this.makeRange(paren_start.range.start, paren_end_pos),
      };
    }

    // If recovery stopped at a statement terminator or EOF, preserve only the
    // text the user wrote. We intentionally do not emit an unbalanced-paren
    // diagnostic here: like unclosed option arguments, this is usually an
    // editor mid-typing state and warning on each keystroke is noisy.
    // After a closing `//` comment, the `)` goes on the next line.
    const closer = inner_tokens[inner_tokens.length - 1]?.type === 'COMMENT_LINE'
      ? '\n)'
      : ')';
    const group_name = closed_group
      ? `(${paren_content}${closer}`
      : `(${paren_content}`;

    return {
      name: group_name,
      range: this.makeRange(paren_start.range.start, paren_end_pos),
    };
  }

  /**
   * Parse unab command: unab macroname : varlist
   */
  private parseUnabCommand(
    command_token: Token,
    prefixes: PrefixNode[]
  ): CommandNode {
    // Parse macro name
    this.skip_statement_whitespace();
    if (!this.check('WORD')) {
      this.addError('Expected macro name after unab', this.peek().range);
      throw new Error('Missing macro name in unab command');
    }

    const unab_node = this.parse_unab_rest(command_token, this.advance());
    unab_node.prefix = prefixes.length > 0 ? prefixes : undefined;
    return unab_node;
  }

  /**
   * The rest of `unab macroname : varlist [, options]` after the macro
   * name. Tokens no name can start, as in `unab x : a/b`, are kept in
   * `extra_args`: Stata reads them as part of the statement (and rejects
   * them, r(198)), so they don't start a new command.
   */
  private parse_unab_rest(command_token: Token, macro_name_token: Token): CommandNode {
    const varlist: IdentifierNode[] = [
      {
        name: macro_name_token.value,
        range: macro_name_token.range,
      }
    ];

    // Track whether we found a colon - stored in dedicated field, not varlist
    // This keeps varlists pure (only variable names) while preserving syntax
    let has_colon_before_varlist = false;

    // Expect colon; a block comment or `///` before it is whitespace.
    this.skip_statement_whitespace();
    if (!this.check('COLON')) {
      this.addError(
        'Expected ":" after macro name in unab command',
        this.peek().range
      );
    } else {
      this.advance(); // consume colon
      has_colon_before_varlist = true;
    }

    // Parse variable list after colon; a block comment or `///` between
    // names is whitespace.
    for (;;) {
      this.skip_statement_whitespace();
      if (!this.is_unab_varlist_token()) {
        break;
      }
      const var_token = this.advance();
      let name = var_token.value;
      let end_range = var_token.range.end;

      // Only coalesce wildcards for actual varlist tokens, not standalone wildcards
      const is_varlist_token = var_token.type === 'WORD' || var_token.type === 'MACRO_REF_LOCAL' ||
          var_token.type === 'MACRO_REF_GLOBAL';
      if (is_varlist_token) {
        // Coalesce adjacent wildcard tokens
        while (!this.isAtEnd() && this.isWildcardToken(this.peek()) &&
               this.isAdjacentToken(this.previous(), this.peek())) {
          const wildcard_token = this.advance();
          name += wildcard_token.value;
          end_range = wildcard_token.range.end;
        }
      }

      varlist.push({
        name: name,
        range: { start: var_token.range.start, end: end_range },
      });

    }

    const extra_args = this.collect_statement_tail(true);

    // Parse options (after comma) - same as regular commands
    const options: OptionNode[] = [];
    const options_tail = this.check('COMMA')
      ? this.parse_command_options(options, this.advance())
      : [];

    const node: CommandNode = {
      type: 'command',
      name: 'unab',
      fullName: 'unab',
      varlist,
      has_colon_before_varlist,
      options: options.length > 0 ? options : undefined,
      expression: undefined,
      range: this.makeRange(command_token.range.start, this.previous().range.end),
    };
    if (extra_args.length > 0) {
      node.extra_args = extra_args;
    }
    if (options_tail.length > 0) {
      node.options_tail = options_tail;
    }
    return node;
  }

  /**
   * The tokens from the current one up to the end of the statement (or,
   * with `stop_at_comma`, up to the comma that starts its options), as
   * `extra_args` items. Continuations and comments inside the statement
   * are whitespace.
   */
  private collect_statement_tail(stop_at_comma: boolean): IdentifierNode[] {
    return this.group_adjacent_tokens(this.collect_statement_tail_tokens(stop_at_comma));
  }

  /** The tokens collect_statement_tail groups into items. */
  private collect_statement_tail_tokens(stop_at_comma: boolean): Token[] {
    const the_tokens: Token[] = [];
    while (!this.isAtEnd()) {
      if (this.skipContinuation()) {
        continue;
      }
      if (this.is_interior_comment(this.current)) {
        this.advance();
        continue;
      }
      if (this.isTrivia() || this.check('STATEMENT_TERMINATOR') ||
          (stop_at_comma && this.check('COMMA')) ||
          this.check('LBRACE') || this.check('RBRACE')) {
        break;
      }
      the_tokens.push(this.advance());
    }
    return the_tokens;
  }

  /**
   * Parse args command: args name1 [name2 ...]
   * The args command doesn't support if/in qualifiers,
   * so 'if' and 'in' are valid macro names.
   */
  private parseArgsCommand(
    command_token: Token,
    prefixes: PrefixNode[]
  ): CommandNode {
    const start_pos = command_token.range.start;

    // Macro names up to the end of the statement. Unlike regular
    // commands, 'if' and 'in' are valid macro names here. Continuations
    // and comments inside the statement are whitespace. From a token no
    // name can start (`/note` in `args a/note`), the rest of the
    // statement is kept in `extra_args`: Stata reads it as part of the
    // statement (and rejects the name, r(198)).
    const varlist: IdentifierNode[] = [];
    while (!this.isAtEnd()) {
      if (this.skipContinuation()) {
        continue;
      }
      if (this.is_interior_comment(this.current)) {
        this.advance();
        continue;
      }
      const is_varlist_token = this.check('WORD') || this.check('STRING') ||
          this.check('MACRO_REF_LOCAL') || this.check('MACRO_REF_GLOBAL');
      if (!is_varlist_token) {
        break;
      }
      const var_token = this.advance();
      varlist.push({
        name: var_token.value,
        range: var_token.range,
      });
    }
    // args has no options, so a comma is part of the tail too.
    const extra_args = this.collect_statement_tail(false);

    const node: CommandNode = {
      type: 'command',
      prefix: prefixes.length > 0 ? prefixes : undefined,
      name: 'args',
      fullName: 'args',
      varlist: varlist.length > 0 ? varlist : undefined,
      options: undefined,
      expression: undefined,
      range: this.makeRange(start_pos, this.previous().range.end),
    };
    if (extra_args.length > 0) {
      node.extra_args = extra_args;
    }
    return node;
  }

  private parseSyntaxCommand(): SyntaxNode {
    const start_token = this.advance(); // consume 'syntax'

    // Parse arguments and options
    const arguments_list: ArgumentSpec[] = [];
    const options_list: OptionSpec[] = [];
    let allows_arbitrary_options = false;
    const seen_option_names = new Set<string>();

    // Collect all tokens until statement terminator or comment. The
    // index-based spec parsers below operate on the lexer token stream
    // directly; comments still stop collection.
    const syntax_tokens: Token[] = [];
    while (
      !this.check('STATEMENT_TERMINATOR') &&
      !this.isAtEnd()
    ) {
      // Bridge `///` continuations onto the next physical line so a multi-line
      // syntax declaration (`syntax varlist, ///` newline `opt(string)`) is
      // collected whole rather than truncated at the first continuation
      // (issue #306). A comment still stops collection.
      if (this.check('CONTINUATION')) {
        if (this.skipContinuation()) {
          continue;
        }
      }
      // A comment with more of the spec after it is whitespace
      // (`syntax varlist /* c */ [if]`); other comments end the spec.
      if (this.is_interior_comment(this.current)) {
        this.advance();
        continue;
      }
      if (this.check('COMMENT_LINE') || this.check('COMMENT_BLOCK')) {
        break;
      }
      const my_token = this.advance();
      syntax_tokens.push(my_token);
    }

    // Parse the collected tokens
    let token_idx = 0;

    // Parse arguments (before comma)
    while (token_idx < syntax_tokens.length) {
      const my_token = syntax_tokens[token_idx];

      // Stop at comma (options follow)
      if (my_token.type === 'COMMA') {
        token_idx++;
        break;
      }

      // Try to parse an argument
      const arg_result = this.parse_argument_spec(
        syntax_tokens,
        token_idx
      );
      if (arg_result) {
        arguments_list.push(arg_result.spec);
        token_idx = arg_result.next_idx;
      } else {
        token_idx++;
      }
    }

    // Parse options (after comma)
    while (token_idx < syntax_tokens.length) {
      const my_token = syntax_tokens[token_idx];

      // Check for * (could be arbitrary options marker or required option marker)
      if (my_token.type === 'OPERATOR' && my_token.value === '*') {
        // Look ahead to see if there's an option name following
        if (token_idx + 1 < syntax_tokens.length &&
            syntax_tokens[token_idx + 1].type === 'WORD') {
          // This is a required option marker, let parse_option_spec handle it
          const opt_result = this.parse_option_spec(
            syntax_tokens,
            token_idx
          );
          if (opt_result) {
            // Track option names for duplicate detection
            const opt_name_lower = opt_result.spec.name;
            seen_option_names.add(opt_name_lower);
            // PRESERVE all options, even duplicates
            options_list.push(opt_result.spec);
            token_idx = opt_result.next_idx;
          } else {
            token_idx++;
          }
        } else {
          // This is the arbitrary options marker
          allows_arbitrary_options = true;
          token_idx++;
        }
        continue;
      }

      // Try to parse an option
      const opt_result = this.parse_option_spec(
        syntax_tokens,
        token_idx
      );
      if (opt_result) {
        // Track option names for duplicate detection
        const opt_name_lower = opt_result.spec.name;
        seen_option_names.add(opt_name_lower);
        // PRESERVE all options, even duplicates
        options_list.push(opt_result.spec);
        token_idx = opt_result.next_idx;
      } else {
        token_idx++;
      }
    }

    const signature: ProgramSignature = {
      arguments: arguments_list,
      options: options_list,
      allowsArbitraryOptions: allows_arbitrary_options,
      syntaxRanges: [start_token.range],
    };

    const syntax_node: SyntaxNode = {
      type: 'syntax',
      signature,
      range: this.makeRange(
        start_token.range.start,
        syntax_tokens.length > 0
          ? syntax_tokens[syntax_tokens.length - 1].range.end
          : start_token.range.end
      ),
    };
    if (syntax_tokens.length > 0) {
      syntax_node.arguments = this.reconstruct_value_tokens(syntax_tokens);
    }
    return syntax_node;
  }

  private parse_argument_spec(
    tokens: Token[],
    start_idx: number
  ): { spec: ArgumentSpec; next_idx: number } | null {
    if (start_idx >= tokens.length) {
      return null;
    }

    const my_token = tokens[start_idx];

    // Check for optional bracket
    let is_optional = false;
    let current_idx = start_idx;

    if (my_token.type === 'LBRACKET') {
      is_optional = true;
      current_idx++;
      if (current_idx >= tokens.length) {
        return null;
      }
    }

    const arg_token = tokens[current_idx];

    // Check for =exp (= is an OPERATOR, not a WORD)
    if (arg_token.type === 'OPERATOR' && arg_token.value === '=') {
      current_idx++;
      if (current_idx < tokens.length && tokens[current_idx].type === 'WORD' && tokens[current_idx].value === 'exp') {
        current_idx++;
        const spec: ArgumentSpec = {
          type: 'exp',
          isOptional: is_optional,
          range: this.makeRange(my_token.range.start, tokens[current_idx - 1].range.end),
        };

        // Check for closing bracket
        if (is_optional && current_idx < tokens.length && tokens[current_idx].type === 'RBRACKET') {
          current_idx++;
        }

        return { spec, next_idx: current_idx };
      }
      return null;
    }

    // Recognize standard argument types
    const standard_types = [
      'varlist',
      'varname',
      'newvarname',
      'anything',
      'if',
      'in',
      'using',
      'name',
      'namelist',
      // Weight types
      'weight',
      'fweight', 'fw',
      'aweight', 'aw',
      'pweight', 'pw',
      'iweight', 'iw',
    ];

    if (arg_token.type !== 'WORD') {
      return null;
    }

    const arg_type_str = arg_token.value;

    if (!standard_types.includes(arg_type_str)) {
      return null;
    }

    current_idx++;
    let arg_name: string | undefined;

    // Check for anything(name=...)
    if (arg_type_str === 'anything' && current_idx < tokens.length && tokens[current_idx].type === 'LPAREN') {
      current_idx++; // consume (
      if (current_idx < tokens.length && tokens[current_idx].value === 'name') {
        current_idx++;
        if (current_idx < tokens.length && tokens[current_idx].type === 'OPERATOR' && tokens[current_idx].value === '=') {
          current_idx++;
          if (current_idx < tokens.length && tokens[current_idx].type === 'WORD') {
            arg_name = tokens[current_idx].value;
            current_idx++;
          }
        }
      }
      if (current_idx < tokens.length && tokens[current_idx].type === 'RPAREN') {
        current_idx++;
      }
    }

    // Check for closing bracket
    if (is_optional && current_idx < tokens.length && tokens[current_idx].type === 'RBRACKET') {
      current_idx++;
    }

    const spec: ArgumentSpec = {
      type: arg_type_str as ArgumentSpec['type'],
      name: arg_name,
      isOptional: is_optional,
      range: this.makeRange(my_token.range.start, tokens[current_idx - 1].range.end),
    };

    return { spec, next_idx: current_idx };
  }

  private parse_option_spec(
    tokens: Token[],
    start_idx: number
  ): { spec: OptionSpec; next_idx: number } | null {
    if (start_idx >= tokens.length) {
      return null;
    }

    let current_idx = start_idx;
    const start_token = tokens[current_idx];

    // Check for required marker (*)
    let is_required = false;
    if (start_token.type === 'OPERATOR' && start_token.value === '*') {
      is_required = true;
      current_idx++;
      if (current_idx >= tokens.length) {
        return null;
      }
    }

    // Check for optional bracket
    let is_optional = false;
    if (tokens[current_idx].type === 'LBRACKET') {
      is_optional = true;
      current_idx++;
      if (current_idx >= tokens.length) {
        return null;
      }
    }

    // Get option name
    const name_token = tokens[current_idx];
    if (name_token.type !== 'WORD') {
      return null;
    }

    const option_name = name_token.value;
    current_idx++;

    let argument_type: OptionSpec['argumentType'] | undefined;
    let default_value: string | undefined;

    // Check for argument type in parentheses
    if (current_idx < tokens.length && tokens[current_idx].type === 'LPAREN') {
      current_idx++; // consume (

      // Collect tokens until closing paren
      const type_tokens: Token[] = [];
      let paren_depth = 1;
      while (current_idx < tokens.length && paren_depth > 0) {
        const my_token = tokens[current_idx];
        if (my_token.type === 'LPAREN') {
          paren_depth++;
        } else if (my_token.type === 'RPAREN') {
          paren_depth--;
          if (paren_depth === 0) {
            break;
          }
        }
        type_tokens.push(my_token);
        current_idx++;
      }

      if (current_idx < tokens.length && tokens[current_idx].type === 'RPAREN') {
        current_idx++;
      }

      // Extract argument type from first token
      if (type_tokens.length > 0 && type_tokens[0].type === 'WORD') {
        const first_part = type_tokens[0].value;
        const valid_types = [
          'real',
          'integer',
          'string',
          'varlist',
          'name',
          'filename',
          'numlist',
          'varname',
          'passthru',
        ];
        if (valid_types.includes(first_part)) {
          argument_type = first_part as OptionSpec['argumentType'];

          // Look for default(value) in remaining tokens
          for (let i = 1; i < type_tokens.length; i++) {
            if (type_tokens[i].type === 'WORD' &&
                type_tokens[i].value === 'default' &&
                i + 1 < type_tokens.length &&
                type_tokens[i + 1].type === 'LPAREN') {
              // Found default(, collect tokens until closing paren and
              // reconstruct spacing from token ranges via the shared helper, so
              // a multi-token default like `default(a b)` stays `a b` instead
              // of fusing to `ab` (issue #306). Range-based reconstruction
              // yields a single space per gap even though whitespace tokens are
              // absent here.
              const default_tokens: Token[] = [];
              let default_paren_depth = 1;
              let j = i + 2;
              while (j < type_tokens.length && default_paren_depth > 0) {
                const my_token = type_tokens[j];
                if (my_token.type === 'LPAREN') {
                  default_paren_depth++;
                } else if (my_token.type === 'RPAREN') {
                  default_paren_depth--;
                  if (default_paren_depth === 0) {
                    break;
                  }
                }
                default_tokens.push(my_token);
                j++;
              }
              default_value =
                this.reconstruct_value_tokens(default_tokens).trim();
              break;
            }
          }
        }
      }
    }

    // Check for closing bracket
    if (is_optional && current_idx < tokens.length && tokens[current_idx].type === 'RBRACKET') {
      current_idx++;
    }

    const min_abbrev = this.compute_min_abbreviation(option_name);

    const spec: OptionSpec = {
      name: option_name,
      minAbbreviation: min_abbrev,
      isRequired: is_required,
      isOptional: is_optional,
      argumentType: argument_type,
      defaultValue: default_value,
      range: this.makeRange(start_token.range.start, tokens[current_idx - 1].range.end),
    };

    return { spec, next_idx: current_idx };
  }

  private compute_min_abbreviation(name: string): string {
    if (name.length === 0) {
      return '';
    }

    // Check casing pattern
    const has_upper = /[A-Z]/.test(name);
    const has_lower = /[a-z]/.test(name);

    if (has_upper && !has_lower) {
      // All uppercase: return first letter
      return name[0];
    } else if (!has_upper && has_lower) {
      // All lowercase: return first letter
      return name[0];
    } else {
      // Mixed case: return first uppercase letter, or first letter if none
      for (const my_char of name) {
        if (/[A-Z]/.test(my_char)) {
          return my_char;
        }
      }
      return name[0];
    }
  }

  /** Can the current token be a name in unab's varlist? */
  private is_unab_varlist_token(): boolean {
    return this.check('WORD') || this.check('MACRO_REF_LOCAL') ||
      this.check('MACRO_REF_GLOBAL') ||
      (this.check('OPERATOR') &&
        (this.peek().value === '*' || this.peek().value === '?'));
  }

  private isTrivia(): boolean {
    const type = this.peek().type;
    return type === 'COMMENT_LINE' || type === 'COMMENT_BLOCK' || type === 'CONTINUATION';
  }

  /**
   * Skip a continuation token and, if present, the swallowed newline
   * terminator that follows it.
   * Returns true if a continuation was skipped, false otherwise.
   */
  private skipContinuation(): boolean {
    if (this.check('CONTINUATION')) {
      const continuation_token = this.peek();
      // Validate continuation token exists and has proper structure
      if (!continuation_token || typeof continuation_token.value !== 'string') {
        // Malformed continuation - don't advance
        return false;
      }

      this.advance(); // consume continuation
      // Only the swallowed newline is trivia; a literal terminator on
      // the next line is a real statement end
      if (
        !this.isAtEnd() &&
        is_swallowed_continuation_terminator(this.peek(), true)
      ) {
        this.advance(); // skip newline after continuation
      }
      return true;
    }
    return false;
  }

  /**
   * Check if the given operator value is a comparison operator.
   * Comparison operators: ==, !=, ~=, <, >, <=, >=
   * Note: ~= may be tokenized as two separate tokens (~ and =)
   */
  private isComparisonOperator(value: string): boolean {
    return value === '==' || value === '!=' || value === '~=' ||
           value === '<' || value === '>' || value === '<=' || value === '>=' ||
           value === '~'; // ~ alone can be part of ~= (handled in state machine)
  }

  /**
   * Check if the given operator value is a logical operator.
   * Logical operators: &, |
   */
  private isLogicalOperator(value: string): boolean {
    return value === '&' || value === '|';
  }

  /**
   * Check if the given operator value is an arithmetic operator.
   * Arithmetic operators: +, -, *, /, ^
   */
  private isArithmeticOperator(value: string): boolean {
    return value === '+' || value === '-' || value === '*' || value === '/' || value === '^';
  }

  /**
   * Check if the token is a macro reference (local or global).
   */
  private isMacroRefToken(token: Token): boolean {
    return token.type === 'MACRO_REF_LOCAL' ||
           token.type === 'MACRO_REF_GLOBAL';
  }

  /**
   * Check if `token` continues the operand started by `prev_token`.
   * The lexer splits a name at macro boundaries, so `var'_bh becomes a
   * macro reference followed by a WORD with no gap between them. The two
   * tokens are one operand when they are physically adjacent, both are
   * operand-like (word, number, or macro reference), and at least one is
   * a macro reference. Strings are excluded: "foo"bar is invalid Stata.
   */
  private isAdjacentOperandFragment(prev_token: Token, token: Token): boolean {
    const is_operand_like = (t: Token): boolean =>
      t.type === 'WORD' || t.type === 'NUMBER' || this.isMacroRefToken(t);
    return is_operand_like(prev_token) &&
           is_operand_like(token) &&
           (this.isMacroRefToken(prev_token) || this.isMacroRefToken(token)) &&
           this.isAdjacentToken(prev_token, token);
  }

  /**
   * Check if the given token is valid after a comparison expression.
   * Valid tokens: ), {, &, |, comma, terminator, 'in' keyword, trivia
   */
  private isValidAfterComparison(token: Token): boolean {
    // Closing paren is valid (end of parenthesized expression)
    if (token.type === 'RPAREN') {
      return true;
    }
    // Opening brace is valid (brace-style blocks like `if x == y { ... }`)
    if (token.type === 'LBRACE') {
      return true;
    }
    // Comma is valid (end of condition before options)
    if (token.type === 'COMMA') {
      return true;
    }
    // Statement terminator is valid (end of statement)
    if (token.type === 'STATEMENT_TERMINATOR') {
      return true;
    }
    // EOF is valid
    if (token.type === 'EOF') {
      return true;
    }
    // Logical operators are valid (compound expressions)
    if (token.type === 'OPERATOR' && this.isLogicalOperator(token.value)) {
      return true;
    }
    // Arithmetic operators are valid (arithmetic in RHS, e.g., `if x == y + 1`)
    if (token.type === 'OPERATOR' && this.isArithmeticOperator(token.value)) {
      return true;
    }
    // 'in' keyword is valid (for if-qualifiers followed by in-qualifiers)
    if (token.type === 'WORD' && token.value === 'in') {
      return true;
    }
    // Trivia (comments, continuations) is valid
    if (token.type === 'COMMENT_LINE' || token.type === 'COMMENT_BLOCK' || token.type === 'CONTINUATION') {
      return true;
    }
    return false;
  }

  /**
   * Check for an opening brace before the logical statement ends.
   * The brace may belong to a nested if; the condition parser decides
   * ownership when it reaches a separated literal if keyword.
   * @returns Whether a brace occurs before the next logical terminator.
   */
  private hasIfBrace(): boolean {
    // Nested inline ifs share the same logical statement. Reuse its scan
    // rather than rescanning the remaining tokens at each nesting level.
    if (this.current <= this.if_brace_scan_end) {
      return this.if_brace_scan_result;
    }
    for (let i = this.current; i < this.tokens.length; i++) {
      const token = this.tokens[i];
      if (token.type === 'LBRACE' || token.type === 'EOF' ||
          (token.type === 'STATEMENT_TERMINATOR' &&
           !is_swallowed_continuation_terminator(
             token, this.tokens[i - 1]?.type === 'CONTINUATION'
           ))) {
        this.if_brace_scan_end = i;
        this.if_brace_scan_result = token.type === 'LBRACE';
        return this.if_brace_scan_result;
      }
    }
    return false;
  }

  /** Parse an if condition and its braced or single-statement body. */
  private parseIfStatement(): ControlFlowNode {
    const ifToken = this.advance(); // consume 'if'
    // Keep brace conditions intact: macros can supply operators or other
    // expression fragments, making an apparent command boundary ambiguous.
    const has_brace = this.hasIfBrace();

    // Parse condition up to { or a single statement, reconstructing spacing from
    // token ranges, so both delimiter modes agree and `///` continuations
    // space the same way as expressions/qualifiers (issue #306).
    const condition_tokens: Token[] = [];
    const condition_start_line = ifToken.range.start.line;
    let paren_depth = 0;
    let bracket_depth = 0;
    let previous_operand: Token | undefined;
    let is_single_statement = false;
    const the_comments: TriviaNode[] = [];

    while (!this.check('LBRACE') && !this.isAtEnd()) {
      // Handle continuation tokens - skip them and continue parsing
      if (this.check('CONTINUATION')) {
        if (this.skipContinuation()) {
          continue;
        }
      }
      if (this.collect_header_comment(the_comments)) {
        continue;
      }
      // A line comment that ends the statement stays trailing trivia.
      if (this.at_header_ending_comment()) {
        break;
      }

      // Stop at statement terminator
      if (this.check('STATEMENT_TERMINATOR')) {
        break;
      }

      const token = this.peek();
      // Two separate operands cannot belong to one expression. The second
      // starts the command in `if expression command`. Adjacent fragments
      // of macro-built names and interpolated strings are still one operand.
      const joins_operand = previous_operand &&
        previous_operand.type !== 'RPAREN' &&
        previous_operand.type !== 'RBRACKET' &&
        this.isAdjacentToken(previous_operand, token);
      // A separated literal `if` starts a nested statement, so any brace
      // ahead belongs to that statement. Unlike a macro, the keyword
      // cannot expand to an operator or serve as a variable name.
      const starts_nested_if = this.checkWord('if');
      if ((!has_brace || starts_nested_if) &&
          paren_depth === 0 && bracket_depth === 0 &&
          previous_operand && !joins_operand &&
          (token.type === 'WORD' || this.isMacroRefToken(token) ||
           token.type === 'MATA_INLINE' || token.type === 'PYTHON_INLINE')) {
        is_single_statement = true;
        break;
      }
      this.advance();

      // Track parenthesis depth for error checking
      if (token.type === 'LPAREN') {
        paren_depth++;
      } else if (token.type === 'RPAREN') {
        paren_depth--;
        if (paren_depth < 0) {
          this.addError('Unbalanced parentheses in if condition', token.range, ParseErrorCode.UNBALANCED_PARENTHESES);
          paren_depth = 0;
        }
      }

      if (token.type === 'LBRACKET') {
        bracket_depth++;
      } else if (token.type === 'RBRACKET') {
        bracket_depth = Math.max(0, bracket_depth - 1);
      }
      if (token.type !== 'COMMENT_LINE' && token.type !== 'COMMENT_BLOCK') {
        previous_operand =
          token.type === 'WORD' || token.type === 'NUMBER' ||
          token.type === 'STRING' || this.isMacroRefToken(token) ||
          token.type === 'RPAREN' || token.type === 'RBRACKET'
            ? token : undefined;
      }

      condition_tokens.push(token);
    }

    // Reconstruct condition with mode-independent single-space spacing.
    const condition = this.reconstruct_value_tokens(condition_tokens).trim();

    // Check for unbalanced parentheses and empty condition
    if (paren_depth > 0) {
      this.addError('Unbalanced parentheses in if condition: missing closing parenthesis', ifToken.range, ParseErrorCode.UNBALANCED_PARENTHESES);
    }

    if (condition.trim() === '') {
      this.addError('Empty if condition', ifToken.range, ParseErrorCode.MISSING_EXPRESSION_AFTER_EQUALS);
    }

    // Parse body
    const body: StataNode[] = [];
    let blockEndingTrivia: TriviaNode[] | undefined;
    // The program around the block ended inside it (no `}`)
    let closed_by_program_end = false;
    if (is_single_statement) {
      const statement = this.parseStatement(false);
      if (statement) body.push(statement);
    } else if (this.check('LBRACE')) {
      const lbrace_index = this.current;
      const lbrace_token = this.advance(); // consume {

      // Validate open brace placement
      // has_condition_before is true if the brace is on the same line as the 'if' keyword
      const has_condition_before = lbrace_token.range.start.line === condition_start_line;
      this.validate_open_brace(lbrace_token, lbrace_index, has_condition_before, true);

      const { body: my_body, blockEndingTrivia: my_block_ending_trivia } = this.parseBraceBody();
      body.push(...my_body);
      blockEndingTrivia = my_block_ending_trivia;

      // After the program's end, a `}` is a statement of its own.
      if (this.check('RBRACE') && !this.program_ended_in_block()) {
        const rbrace_index = this.current;
        const rbrace_token = this.advance(); // consume }

        // Validate close brace placement
        this.validate_close_brace(rbrace_token, rbrace_index);
      } else if (this.program_ended_in_block()) {
        closed_by_program_end = true;
      } else {
        this.addError('Missing closing brace for if statement', ifToken.range);
        // Printing the AST would add the missing closer
        this.note_unprintable(ifToken.range.start);
      }
    } else {
      // `if exp` with no `{` and no command: Stata stops, "{ required"
      this.report_header_without_brace(ifToken, true);
      this.note_unprintable(ifToken.range.start);
    }

    return {
      type: 'if',
      ...(is_single_statement ? { is_single_statement: true } : {}),
      condition: condition.trim(),
      ...(this.structured
        ? { condition_ast: parse_condition(condition_tokens, ifToken.range.end) }
        : {}),
      body,
      range: this.makeRange(
        ifToken.range.start,
        is_single_statement && body.length > 0
          ? body[body.length - 1].range.end : this.brace_block_end()
      ),
      ...(the_comments.length > 0 ? { interiorTrivia: the_comments } : {}),
      blockEndingTrivia,
      ...(closed_by_program_end ? { closed_by_program_end: true } : {}),
    };
  }

  private parseElseStatement(): ControlFlowNode {
    const elseToken = this.advance(); // consume 'else'
    // `else /* c */ {`: the comment is whitespace before the body.
    const the_comments: TriviaNode[] = [];
    this.skip_header_whitespace(the_comments);
    const comment_field = the_comments.length > 0 ? { interiorTrivia: the_comments } : {};

    // Check for 'if' (else if)
    if (this.checkWord('if')) {
      const if_start = this.current;
      const ifNode = this.parseIfStatement();
      this.keep_noted_lines(ifNode, if_start);
      return {
        type: 'else',
        is_else_if: true,
        body: [ifNode],
        range: this.makeRange(elseToken.range.start, ifNode.range.end),
        ...comment_field,
        // The program's end cut the `if` off, and with it this `else`
        ...(ifNode.closed_by_program_end ? { closed_by_program_end: true } : {}),
      };
    }

    // Parse body
    const body: StataNode[] = [];
    let blockEndingTrivia: TriviaNode[] | undefined;
    // The program around the block ended inside it (no `}`)
    let closed_by_program_end = false;
    let is_brace_else = false;
    if (this.check('LBRACE')) {
      is_brace_else = true;
      const lbrace_index = this.current;
      const lbrace_token = this.advance(); // consume {

      // Validate open brace placement
      // has_condition_before is true if the brace is on the same line as the 'else' keyword
      const has_condition_before = lbrace_token.range.start.line === elseToken.range.start.line;
      this.validate_open_brace(lbrace_token, lbrace_index, has_condition_before);

      const { body: my_body, blockEndingTrivia: my_block_ending_trivia } = this.parseBraceBody();
      body.push(...my_body);
      blockEndingTrivia = my_block_ending_trivia;

      // After the program's end, a `}` is a statement of its own.
      if (this.check('RBRACE') && !this.program_ended_in_block()) {
        const rbrace_index = this.current;
        const rbrace_token = this.advance(); // consume }

        // Validate close brace placement
        this.validate_close_brace(rbrace_token, rbrace_index);
      } else if (this.program_ended_in_block()) {
        closed_by_program_end = true;
      } else {
        this.addError('Missing closing brace for else statement', elseToken.range);
        // Printing the AST would add the missing closer
        this.note_unprintable(elseToken.range.start);
      }
    } else {
      // `else` alone on its line is a statement of its own to Stata
      // 18, so a `{` on the next line opens a block that always runs.
      // Printing the AST would turn the `else` into `else {` `}`,
      // hiding which block the `{` was meant for.
      if (this.at_statement_end() &&
          this.report_brace_after_statement(
            elseToken, 'here the block runs whatever the `if` found')) {
        this.note_unprintable(elseToken.range.start);
      }
      // Single statement else
      const stmt = this.parseStatement();
      if (stmt) {
        body.push(stmt);
        // The program's end cut the body off, and with it this `else`
        if ('closed_by_program_end' in stmt && stmt.closed_by_program_end === true) {
          closed_by_program_end = true;
        }
      }
    }

    // For a single-statement else the block has no closing brace of its own,
    // so its extent is exactly its body. Use the last body node's end rather
    // than this.previous(), which can be a statement terminator whose range
    // spills onto the next line (e.g. the following `end` / ancestor `}`).
    // Otherwise that ancestor closer inherits the else's depth and is wrongly
    // flagged as under-indented. The brace form keeps using the `}` token.
    const end_position =
      !is_brace_else && body.length > 0
        ? body[body.length - 1].range.end
        : this.brace_block_end();

    return {
      type: 'else',
      body,
      range: this.makeRange(elseToken.range.start, end_position),
      ...comment_field,
      blockEndingTrivia,
      ...(closed_by_program_end ? { closed_by_program_end: true } : {}),
    };
  }


  private parseLoopStatement(): ControlFlowNode {
    const loopToken = this.advance(); // consume 'foreach' or 'forvalues'
    const loopType: 'foreach' | 'forvalues' =
        loopToken.value === 'foreach' ? 'foreach' : 'forvalues';
    const loop_start_line = loopToken.range.start.line;

    let loopVar = '';
    let loopSpec = '';
    const the_comments: TriviaNode[] = [];

    // Parse loop variable.
    this.skip_header_whitespace(the_comments);
    if (this.check('WORD')) {
      loopVar = this.advance().value;
    }
    this.skip_header_whitespace(the_comments);

    // Parse loop specification
    // For forvalues: next token is '=' (OPERATOR)
    // For foreach: next token is 'in' or 'of' (WORD)
    const is_forvalues_spec = this.check('OPERATOR') && this.peek().value === '=';
    const is_foreach_spec = this.check('WORD') &&
        (this.peek().value === 'in' || this.peek().value === 'of');

    if (is_forvalues_spec || is_foreach_spec) {
      const specType = this.advance().value;
      // Collect the spec tokens and reconstruct spacing from their ranges via
      // reconstruct_value_tokens, so `#delimit ;` and `#delimit cr` yield the
      // identical single-space form and value items are never fused (issue
      // #306).
      const spec_tokens: Token[] = [];

      // Collect specification until {
      while (!this.check('LBRACE') && !this.isAtEnd()) {
        // Stop at a real statement terminator; only the swallowed '\n'
        // of a /// continuation is skipped
        if (this.check('STATEMENT_TERMINATOR')) {
          if (
            is_swallowed_continuation_terminator(
              this.tokens[this.current],
              this.current > 0 &&
                this.tokens[this.current - 1].type === 'CONTINUATION'
            )
          ) {
            this.advance(); // skip newline after continuation
            continue;
          }
          break;
        }
        if (this.collect_header_comment(the_comments)) {
          continue;
        }
        if (this.at_header_ending_comment()) {
          break;
        }
        const token = this.advance();
        if (token.type === 'CONTINUATION') {
          continue;
        }
        spec_tokens.push(token);
      }
      loopSpec = specType + ' ' +
        this.reconstruct_value_tokens(spec_tokens).trim();
    }

    // Parse body
    const body: StataNode[] = [];
    let blockEndingTrivia: TriviaNode[] | undefined;
    // The program around the block ended inside it (no `}`)
    let closed_by_program_end = false;
    if (this.check('LBRACE')) {
      const lbrace_index = this.current;
      const lbrace_token = this.advance(); // consume {

      // Validate open brace placement
      // has_condition_before is true if the brace is on the same line as the loop keyword
      const has_condition_before = lbrace_token.range.start.line === loop_start_line;
      this.validate_open_brace(lbrace_token, lbrace_index, has_condition_before);

      const { body: my_body, blockEndingTrivia: my_block_ending_trivia } = this.parseBraceBody();
      body.push(...my_body);
      blockEndingTrivia = my_block_ending_trivia;

      // After the program's end, a `}` is a statement of its own.
      if (this.check('RBRACE') && !this.program_ended_in_block()) {
        const rbrace_index = this.current;
        const rbrace_token = this.advance(); // consume }

        // Validate close brace placement
        this.validate_close_brace(rbrace_token, rbrace_index);
      } else if (this.program_ended_in_block()) {
        closed_by_program_end = true;
      } else {
        this.addError(`Missing closing brace for ${loopType} statement`, loopToken.range);
        // Printing the AST would add the missing closer
        this.note_unprintable(loopToken.range.start);
      }
    } else {
      // A loop header with no `{`: Stata stops, "{ required"
      this.report_header_without_brace(loopToken, false);
      this.note_unprintable(loopToken.range.start);
    }

    return {
      type: loopType,
      loopVar,
      loopSpec,
      body,
      range: this.makeRange(loopToken.range.start, this.brace_block_end()),
      ...(the_comments.length > 0 ? { interiorTrivia: the_comments } : {}),
      blockEndingTrivia,
      ...(closed_by_program_end ? { closed_by_program_end: true } : {}),
    };
  }

  private parseWhileStatement(): ControlFlowNode {
    const whileToken = this.advance(); // consume 'while'
    const while_start_line = whileToken.range.start.line;

    // Parse condition - collect tokens until { and reconstruct spacing from
    // token ranges, matching the expression/qualifier path (issue #306).
    const condition_tokens: Token[] = [];
    let paren_depth = 0;
    const the_comments: TriviaNode[] = [];

    while (!this.check('LBRACE') && !this.isAtEnd()) {
      // Handle continuation tokens - skip them and continue parsing
      if (this.check('CONTINUATION')) {
        if (this.skipContinuation()) {
          continue;
        }
      }
      if (this.collect_header_comment(the_comments)) {
        continue;
      }
      // A line comment that ends the statement stays trailing trivia.
      if (this.at_header_ending_comment()) {
        break;
      }

      // Stop at statement terminator
      if (this.check('STATEMENT_TERMINATOR')) {
        break;
      }

      const token = this.advance();

      // Track parenthesis depth for error checking
      if (token.type === 'LPAREN') {
        paren_depth++;
      } else if (token.type === 'RPAREN') {
        paren_depth--;
        if (paren_depth < 0) {
          this.addError('Unbalanced parentheses in while condition', token.range, ParseErrorCode.UNBALANCED_PARENTHESES);
          paren_depth = 0;
        }
      }

      condition_tokens.push(token);
    }

    // Reconstruct condition with mode-independent single-space spacing.
    const condition = this.reconstruct_value_tokens(condition_tokens).trim();

    // Check for unbalanced parentheses and empty condition
    if (paren_depth > 0) {
      this.addError('Unbalanced parentheses in while condition: missing closing parenthesis', whileToken.range, ParseErrorCode.UNBALANCED_PARENTHESES);
    }

    if (condition.trim() === '') {
      this.addError('Empty while condition', whileToken.range, ParseErrorCode.MISSING_EXPRESSION_AFTER_EQUALS);
    }

    // Parse body
    const body: StataNode[] = [];
    let blockEndingTrivia: TriviaNode[] | undefined;
    // The program around the block ended inside it (no `}`)
    let closed_by_program_end = false;
    if (this.check('LBRACE')) {
      const lbrace_index = this.current;
      const lbrace_token = this.advance(); // consume {

      // Validate open brace placement
      // has_condition_before is true if the brace is on the same line as the 'while' keyword
      const has_condition_before = lbrace_token.range.start.line === while_start_line;
      this.validate_open_brace(lbrace_token, lbrace_index, has_condition_before);

      const { body: my_body, blockEndingTrivia: my_block_ending_trivia } = this.parseBraceBody();
      body.push(...my_body);
      blockEndingTrivia = my_block_ending_trivia;

      // After the program's end, a `}` is a statement of its own.
      if (this.check('RBRACE') && !this.program_ended_in_block()) {
        const rbrace_index = this.current;
        const rbrace_token = this.advance(); // consume }

        // Validate close brace placement
        this.validate_close_brace(rbrace_token, rbrace_index);
      } else if (this.program_ended_in_block()) {
        closed_by_program_end = true;
      } else {
        this.addError('Missing closing brace for while statement', whileToken.range);
        // Printing the AST would add the missing closer
        this.note_unprintable(whileToken.range.start);
      }
    } else {
      // A while header with no `{`: Stata stops, "{ required"
      this.report_header_without_brace(whileToken, false);
      this.note_unprintable(whileToken.range.start);
    }

    return {
      type: 'while',
      condition: condition.trim(),
      ...(this.structured
        ? { condition_ast: parse_condition(condition_tokens, whileToken.range.end) }
        : {}),
      body,
      range: this.makeRange(whileToken.range.start, this.brace_block_end()),
      ...(the_comments.length > 0 ? { interiorTrivia: the_comments } : {}),
      blockEndingTrivia,
      ...(closed_by_program_end ? { closed_by_program_end: true } : {}),
    };
  }

  /**
   * Parse a standalone string statement.
   *
   * In Stata, a string literal on its own line is valid syntax (though it does nothing).
   * The lexer splits compound strings with embedded macros into multiple tokens:
   * - `"`macro'"' becomes: STRING `" + MACRO_REF_LOCAL `macro' + STRING "'
   *
   * This method collects all tokens until the statement terminator and reconstructs
   * the original string with proper spacing preserved.
   */
  private parseStringStatement(): CommandNode {
    const start_token = this.peek();
    const statement_tokens: Token[] = [];

    // Collect all tokens until statement terminator
    while (!this.check('STATEMENT_TERMINATOR') && !this.isAtEnd()) {
      const token = this.advance();
      statement_tokens.push(token);
    }

    // Reconstruct the string with original spacing
    const content = this.reconstructTokensWithSpacing(statement_tokens);

    // Create a command node with the reconstructed string as the name.
    // This is a pragmatic choice: standalone strings in Stata are valid
    // (though no-op) statements. By storing them as CommandNode with
    // the string content as `name`, the PrettyPrinter outputs them
    // correctly without needing special handling.
    return {
      type: 'command',
      name: content,
      fullName: content,
      range: this.makeRange(start_token.range.start, this.previous().range.end),
    };
  }

  /**
   * Parse a frame block: `frame name { ... }` or prefix: `frame name: cmd`
   * Frame blocks execute code in the context of a named data frame.
   * Syntax: frame framename { commands } OR frame framename: command
   *
   * Unlike conditional blocks (if, while), frame blocks don't have a
   * condition - they just have a frame name followed by brace or colon.
   */
  private parseFrameBlock(): ControlFlowNode | CommandNode | MacroDefNode | null {
    // Index of the `frame` token itself. Both non-block fallbacks below
    // restore to exactly this index so parseCommand re-parses `frame` and its
    // arguments from the start.
    const frame_index = this.current;
    const frame_token = this.advance(); // consume 'frame'
    const frame_start_line = frame_token.range.start.line;

    this.skipTrivia();

    // Get frame name: a word, or a macro holding one (`frame `f' {`)
    if (!this.check('WORD') && !this.isMacroRefToken(this.peek())) {
      // Not a frame block/prefix syntax, fall back to command parsing
      // Reset position and return null to let parseCommand handle it
      this.current = frame_index;
      return null;
    }

    const name_token = this.peek();

    // Check if followed by brace (frame block) or colon (frame prefix)
    // We need to look ahead past the frame name
    this.advance(); // consume frame name
    this.skipTrivia();

    if (this.check('COLON')) {
      // This is frame prefix syntax: frame name: command
      // Use shared frame prefix parsing logic for consistent behavior
      this.advance(); // consume colon

      // Create a prefix node for the frame
      const frame_prefix: PrefixNode = {
        type: 'prefix',
        name: 'frame',
        fullName: 'frame',
        frameName: name_token.value,
        has_colon: true,
        range: this.makeRange(
          frame_token.range.start,
          this.previous().range.end
        ),
      };

      // Use shared helper for consistent frame prefix parsing
      return this.parseFramePrefixedCommand(frame_prefix, [], frame_token, frame_index);
    }

    if (!this.check('LBRACE')) {
      // Not frame block syntax (might be `frame create` or similar)
      // Reset position and return null to let parseCommand handle it
      this.current = frame_index; // Reset to before 'frame' was consumed
      return null;
    }

    // This is a frame block: frame name { ... }
    const frame_name = name_token.value;

    const lbrace_index = this.current;
    const lbrace_token = this.advance(); // consume {

    // Validate open brace placement
    // For frame blocks, the brace should be on the same line as the frame command
    const has_condition_before = lbrace_token.range.start.line === frame_start_line;
    this.validate_open_brace(lbrace_token, lbrace_index, has_condition_before);

    // Parse body
    const { body, blockEndingTrivia } = this.parseBraceBody();
    let closed_by_program_end = false;

    // After the program's end, a `}` is a statement of its own.
    if (this.check('RBRACE') && !this.program_ended_in_block()) {
      const rbrace_index = this.current;
      const rbrace_token = this.advance(); // consume }

      // Validate close brace placement
      this.validate_close_brace(rbrace_token, rbrace_index);
    } else if (this.program_ended_in_block()) {
      closed_by_program_end = true;
    } else {
      this.addError('Missing closing brace for frame block', frame_token.range);
      // Printing the AST would add the missing closer
      this.note_unprintable(frame_token.range.start);
    }

    // `frame f /* c */ {`: the comment is whitespace in the header.
    const header_comments = this.comments_between(frame_index, lbrace_index);
    return {
      type: 'frame',
      frameName: frame_name,
      body,
      range: this.makeRange(frame_token.range.start, this.brace_block_end()),
      ...(header_comments.length > 0 ? { interiorTrivia: header_comments } : {}),
      blockEndingTrivia,
      ...(closed_by_program_end ? { closed_by_program_end: true } : {}),
    };
  }

  /**
   * Parse the body of an unab command (after command name consumed).
   * unab macroname : varlist
   */
  private parseUnabCommandBody(command_token: Token): CommandNode {
    // Parse macro name
    this.skip_statement_whitespace();
    if (!this.check('WORD')) {
      this.addError('Expected macro name after unab', this.peek().range);
      return {
        type: 'command',
        name: 'unab',
        fullName: 'unab',
        range: this.makeRange(command_token.range.start, this.previous().range.end),
      };
    }
    return this.parse_unab_rest(command_token, this.advance());
  }

  // Helper methods
  private isNodeWithTrivia(node: StataNode): node is CommandNode | ProgramNode | MacroDefNode | ControlFlowNode | DirectiveNode | EmbeddedLanguageBlockNode | SyntaxNode {
    return (
      node.type === 'command' ||
      node.type === 'program' ||
      node.type === 'macro_def' ||
      node.type === 'directive' ||
      node.type === 'embedded_block' ||
      node.type === 'syntax' ||
      node.type === 'if' ||
      node.type === 'else' ||
      node.type === 'foreach' ||
      node.type === 'forvalues' ||
      node.type === 'while' ||
      node.type === 'frame'
    );
  }

  /**
   * Consume a chain of prefixes (`capture noisily by g (t), sort:`,
   * `svy, subpop(x):`, `version 14:`) and append them to `prefixes`.
   */
  private parse_prefix_chain(prefixes: PrefixNode[]): void {
    for (;;) {
      // `///` continuations and block comments may separate prefixes
      // and what follows them: `capture /* c */ noisily`,
      // `quietly /* c */ {`, `capture: /* c */ mata:`. A
      // comment before anything else ends the chain, so it stays
      // attached to the statement as trivia.
      while (this.skipContinuation()) {
        // skip
      }
      const next_index = this.index_after_statement_trivia(this.current);
      if (next_index > this.current && this.continues_prefix_chain(next_index)) {
        while (this.current < next_index) {
          this.advance();
        }
      }
      const token = this.peek();
      if (token.type !== 'WORD') {
        return;
      }
      const prefix_name = PREFIX_COMMANDS.get(token.value);
      if (prefix_name !== undefined) {
        prefixes.push(this.parse_simple_prefix(prefix_name));
        continue;
      }
      const colon_prefix_name = COLON_PREFIX_COMMANDS.get(token.value);
      if (colon_prefix_name === undefined) {
        return;
      }
      const colon_index = this.find_statement_colon(this.current + 1);
      if (colon_index === -1) {
        return;
      }
      prefixes.push(this.parse_colon_prefix(colon_prefix_name, colon_index));
    }
  }

  /**
   * Parse `by`/`bysort` (with their varlist, sort group, and options)
   * or an argument-free prefix such as `quietly`.
   */
  private parse_simple_prefix(prefix_name: string): PrefixNode {
    const prefix_token = this.advance();
    const prefix: PrefixNode = {
      type: 'prefix',
      name: prefix_token.value,
      fullName: prefix_name,
      range: prefix_token.range,
    };

    const is_by = prefix_name === 'by' || prefix_name === 'bysort';
    if (is_by && !this.check('COLON')) {
      const colon_index = this.find_statement_colon(this.current);
      if (colon_index !== -1) {
        this.parse_by_spec(prefix, colon_index);
      }
    }

    // Consume colon after any prefix command (quietly:, capture:, by g:,
    // etc.). A block comment or `///` before it is whitespace:
    // `quietly /* c */ : gen x = 1`.
    const colon_index = this.index_after_statement_trivia(this.current);
    if (colon_index > this.current &&
        this.tokens[colon_index]?.type === 'COLON') {
      while (this.current < colon_index) {
        this.advance();
      }
    }
    if (this.check('COLON')) {
      this.advance();
      prefix.has_colon = true;
    }
    prefix.range = this.makeRange(prefix_token.range.start, this.previous().range.end);
    return prefix;
  }

  /**
   * Parse `varlist [(sortvars)] [, options]` of a by prefix, stopping at
   * the colon at `colon_index`.
   */
  private parse_by_spec(prefix: PrefixNode, colon_index: number): void {
    const by_tokens: Token[] = [];
    let sort_tokens: Token[] | undefined;
    const raw_items: Token[][] = [];

    // Group tokens into raw items by adjacency, for printing.
    const add_raw = (my_token: Token): void => {
      const last_item = raw_items[raw_items.length - 1];
      const last_token = last_item?.[last_item.length - 1];
      if (last_item && last_token && this.isAdjacentToken(last_token, my_token)) {
        last_item.push(my_token);
      } else {
        raw_items.push([my_token]);
      }
    };

    while (this.current < colon_index && !this.check('COMMA')) {
      if (this.skip_statement_trivia()) {
        continue;
      }
      if (this.check('LPAREN')) {
        // `(sortvars)` group of bysort/by
        sort_tokens = sort_tokens ?? [];
        add_raw(this.advance());
        let depth = 1;
        while (this.current < colon_index && depth > 0) {
          if (this.skip_statement_trivia()) {
            continue;
          }
          const my_token = this.advance();
          if (my_token.type === 'LPAREN') {
            depth++;
          } else if (my_token.type === 'RPAREN') {
            depth--;
          }
          add_raw(my_token);
          if (depth > 0) {
            sort_tokens.push(my_token);
          }
        }
        continue;
      }
      const my_token = this.advance();
      by_tokens.push(my_token);
      add_raw(my_token);
    }

    prefix.varlist = raw_items.map((my_item) => my_item.map((t) => t.value).join(''));
    if (this.structured) {
      prefix.by_varlist = parse_varlist(by_tokens);
      if (sort_tokens !== undefined) {
        prefix.sort_varlist = parse_varlist(sort_tokens);
      }
    }
    if (this.check('COMMA')) {
      this.advance();
      const options = this.parse_options_until(colon_index);
      if (options.length > 0) {
        prefix.options = options;
      }
    }
    // Anything left before the colon is malformed; skip it.
    while (this.current < colon_index) {
      this.advance();
    }
  }

  /**
   * Parse a colon prefix with arguments, e.g. `svy linearized, subpop(x):`
   * or `version 14:`, whose colon is at `colon_index`.
   */
  private parse_colon_prefix(prefix_name: string, colon_index: number): PrefixNode {
    const prefix_token = this.advance();
    const prefix: PrefixNode = {
      type: 'prefix',
      name: prefix_token.value,
      fullName: prefix_name,
      range: prefix_token.range,
    };

    const argument_tokens: Token[] = [];
    let depth = 0;
    while (this.current < colon_index) {
      if (this.check('CONTINUATION')) {
        if (this.skipContinuation()) {
          continue;
        }
      }
      if (this.skip_statement_trivia()) {
        continue;
      }
      if (depth === 0 && this.check('COMMA')) {
        break;
      }
      const my_token = this.advance();
      if (my_token.type === 'LPAREN' || my_token.type === 'LBRACKET') {
        depth++;
      } else if (my_token.type === 'RPAREN' || my_token.type === 'RBRACKET') {
        depth = Math.max(0, depth - 1);
      }
      argument_tokens.push(my_token);
    }

    if (argument_tokens.length > 0) {
      prefix.arguments = this.reconstruct_value_tokens(argument_tokens).trim();
      prefix.arguments_range = this.makeRange(
        argument_tokens[0].range.start,
        argument_tokens[argument_tokens.length - 1].range.end
      );
    }
    if (this.check('COMMA')) {
      this.advance();
      const options = this.parse_options_until(colon_index);
      if (options.length > 0) {
        prefix.options = options;
      }
    }
    while (this.current < colon_index) {
      this.advance();
    }
    this.advance(); // consume colon
    prefix.has_colon = true;
    prefix.range = this.makeRange(prefix_token.range.start, this.previous().range.end);
    return prefix;
  }

  /**
   * Index of the first colon at bracket depth 0 in the current
   * statement, scanning from `start`, or -1. Crosses `///` continuations;
   * stops at the statement terminator and at braces.
   */
  private find_statement_colon(start: number): number {
    let depth = 0;
    for (let i = start; i < this.tokens.length; i++) {
      const my_token = this.tokens[i];
      switch (my_token.type) {
        case 'STATEMENT_TERMINATOR':
          if (is_swallowed_continuation_terminator(
            my_token,
            i > 0 && this.tokens[i - 1].type === 'CONTINUATION'
          )) {
            continue;
          }
          return -1;
        case 'EOF':
        case 'LBRACE':
        case 'RBRACE':
          return -1;
        case 'LPAREN':
        case 'LBRACKET':
          depth++;
          break;
        case 'RPAREN':
        case 'RBRACKET':
          depth = Math.max(0, depth - 1);
          break;
        case 'COLON':
          if (depth === 0) {
            return i;
          }
          break;
      }
    }
    return -1;
  }

  /**
   * Skip one piece of trivia inside a statement: a `///` continuation
   * (with its swallowed newline) or a comment. Returns true if skipped.
   */
  private skip_statement_trivia(): boolean {
    if (this.skipContinuation()) {
      return true;
    }
    if (this.check('COMMENT_BLOCK') || this.check('COMMENT_LINE')) {
      this.advance();
      return true;
    }
    return false;
  }

  /**
   * May the prefix chain read the tokens from the current one up to
   * `index` as whitespace and go on there? Yes before a command word,
   * a brace block, or Mata/Python.
   */
  private continues_prefix_chain(index: number): boolean {
    const next = this.tokens[index];
    return next !== undefined &&
      (COMMAND_NAME_TYPES.has(next.type) || PREFIX_CHAIN_BLOCK_TYPES.has(next.type));
  }

  /**
   * Index of the first token from `index` on that isn't a comment or a
   * `///` continuation with its swallowed newline.
   */
  private index_after_statement_trivia(index: number): number {
    let i = index;
    for (;;) {
      const my_token = this.tokens[i];
      if (my_token !== undefined && is_statement_ending_comment(my_token)) {
        return i;
      }
      if (my_token?.type === 'COMMENT_BLOCK' || my_token?.type === 'COMMENT_LINE' ||
          my_token?.type === 'CONTINUATION') {
        i++;
      } else if (my_token !== undefined && i > 0 &&
          is_swallowed_continuation_terminator(
            my_token, this.tokens[i - 1]?.type === 'CONTINUATION')) {
        i++;
      } else {
        return i;
      }
    }
  }

  /**
   * Skip `///` continuations and block comments that have more of the
   * statement after them. Stata reads both as whitespace.
   */
  private skip_statement_whitespace(): void {
    while (this.skipContinuation() || this.skip_interior_comments()) {
      // skip
    }
  }

  /**
   * Consume a comment in a control-flow header into `the_comments`: a
   * block comment, or a `//` comment with more of the header after it
   * (under `#delimit ;`). Stata reads it as whitespace, so it stays out
   * of the condition or loop spec. Returns true if one was consumed.
   */
  private collect_header_comment(the_comments: TriviaNode[]): boolean {
    if (!this.check('COMMENT_BLOCK') && !this.is_interior_comment(this.current)) {
      return false;
    }
    const start = this.current;
    this.advance();
    the_comments.push(...this.comments_between(start, this.current));
    return true;
  }

  /**
   * Is the current token a comment that ends a control-flow header: a
   * line comment with no more of the statement after it?
   */
  private at_header_ending_comment(): boolean {
    return this.check('COMMENT_LINE') && !this.is_interior_comment(this.current);
  }

  /**
   * Skip `///` continuations and comments in a control-flow header,
   * keeping the comments in `the_comments`.
   */
  private skip_header_whitespace(the_comments: TriviaNode[]): void {
    while (this.skipContinuation() || this.collect_header_comment(the_comments)) {
      // skip
    }
  }

  /**
   * Skip comments that have more of the statement after them; a
   * comment there is whitespace. Returns true if any were skipped.
   */
  private skip_interior_comments(): boolean {
    let skipped = false;
    while (this.is_interior_comment(this.current)) {
      this.advance();
      skipped = true;
    }
    return skipped;
  }

  /**
   * Options `name[(argument)] ...` from the current token up to, not
   * including, token index `stop`.
   */
  private parse_options_until(stop: number): OptionNode[] {
    const options: OptionNode[] = [];
    while (this.current < stop && !this.isAtEnd()) {
      if (this.skip_statement_trivia()) {
        continue;
      }
      if (!this.check('WORD')) {
        this.advance();
        continue;
      }
      const option_token = this.advance();
      const option: OptionNode = {
        type: 'option',
        name: option_token.value,
        fullName: option_token.value,
        range: option_token.range,
      };
      if (this.current < stop && this.check('LPAREN')) {
        const parsed = this.parse_option_argument_inside_parens();
        option.argument = parsed.argument;
        option.argument_range = parsed.argument_range;
        if (parsed.argument_unclosed) {
          option.argument_unclosed = true;
        }
      }
      options.push(option);
    }
    return options;
  }

  private isPrefixCommand(word: string): boolean {
    return PREFIX_COMMANDS.has(word);
  }

  private collectTrivia(): TriviaNode[] {
    const trivia: TriviaNode[] = [];

    while (this.check('COMMENT_LINE') || this.check('COMMENT_BLOCK') || this.check('CONTINUATION')) {
      const token = this.advance();

      if (token.type === 'COMMENT_LINE') {
        const style = token.value.startsWith('*') ? 'star' : 'slash';
        trivia.push({
          type: 'comment',
          style,
          content: token.value,
          range: token.range,
        });
      } else if (token.type === 'COMMENT_BLOCK') {
        trivia.push({
          type: 'comment',
          style: 'block',
          content: token.value,
          range: token.range,
        });
      } else if (token.type === 'CONTINUATION') {
        trivia.push({
          type: 'comment',
          style: 'continuation',
          content: token.value,
          range: token.range,
        });
      }
    }

    return trivia;
  }


  /**
   * A statement that starts with `//` as code: under `#delimit ;`, a
   * column-0 `//` on a later line of a statement, which Stata 18 runs
   * ("/ is not a valid command name"; the lexer warns). It has no
   * command name, and keep_noted_lines keeps its text as written.
   */
  private parse_slash_led_statement(): CommandNode {
    const start_token = this.peek();
    while (!this.at_statement_end()) {
      this.advance();
    }
    return {
      type: 'command',
      name: '',
      fullName: '',
      expression: undefined,
      range: this.makeRange(start_token.range.start, this.previous().range.end),
    };
  }

  /**
   * Keep the lines of the statement starting at token `start` as
   * written when a `///` in it has a note after it, so the AST printer
   * can keep the note on its line (`reg y x /// note` then `z`). A
   * brace block keeps only its header, through `{`. Slashes with code
   * right before them (`reg y x, robust///`) are kept as written too:
   * reprinting could space them out or drop them.
   */
  private keep_noted_lines(node: StataNode, start: number): void {
    let end = start;
    switch (node.type) {
      case 'command':
      case 'macro_def':
      case 'syntax':
      case 'if':
      case 'foreach':
      case 'forvalues':
      case 'while':
      case 'frame':
        break;
      default:
        return;
    }
    if (node.type === 'command' && node.body !== undefined) {
      return;
    }
    const is_block = node.type !== 'command' && node.type !== 'macro_def' &&
      node.type !== 'syntax' && !(node.type === 'if' && node.is_single_statement);
    if (is_block) {
      // The header ends at `{`, which is on its last line.
      for (;;) {
        const my_token = this.tokens[end];
        if (my_token === undefined || my_token.type === 'EOF' ||
            (my_token.type === 'STATEMENT_TERMINATOR' &&
             !is_swallowed_continuation_terminator(
               my_token, this.tokens[end - 1]?.type === 'CONTINUATION'))) {
          return;
        }
        end++;
        if (my_token.type === 'LBRACE') {
          break;
        }
      }
    } else {
      while (end < this.tokens.length &&
          compare_positions(this.tokens[end].range.start, node.range.end) < 0) {
        end++;
      }
    }
    const the_tokens = this.tokens.slice(start, end)
      .filter((my_token) => my_token.type !== 'STATEMENT_TERMINATOR');
    if (the_tokens.some(is_noted_continuation) ||
        has_adjacent_slashes(the_tokens)) {
      node.noted_lines = source_lines_of(the_tokens);
    }
  }

  /**
   * Comments among the tokens from `start` up to `end`. Inside a
   * statement these are block comments, `//` comments with code after
   * them under `#delimit ;`, and any comment a clause consumed (such as
   * one after an unclosed option argument).
   */
  private comments_between(start: number, end: number): TriviaNode[] {
    const the_comments: TriviaNode[] = [];
    for (let i = start; i < end; i++) {
      const my_token = this.tokens[i];
      if (my_token?.type === 'COMMENT_BLOCK' || my_token?.type === 'COMMENT_LINE') {
        the_comments.push({
          type: 'comment',
          style: my_token.type === 'COMMENT_BLOCK'
            ? 'block'
            : my_token.value.startsWith('*') ? 'star' : 'slash',
          content: my_token.value,
          range: my_token.range,
        });
      }
    }
    return the_comments;
  }

  private skipTrivia(): void {
    while (this.check('COMMENT_LINE') || this.check('COMMENT_BLOCK') || this.check('CONTINUATION') || this.check('WHITESPACE')) {
      this.advance();
    }
  }

  /**
   * Parse the statements of a brace-delimited block body, stopping at the
   * matching `}` (left unconsumed for the caller to validate) or EOF.
   *
   * This loop consumes leading trivia — carrying comments forward via
   * pending_trivia exactly as parseStatement would — and then checks for `}`
   * itself, so the closing brace is never handed to parseStatement, which
   * would misreport it as an orphan (issue #301).
   *
   * A comment sitting between the last body statement and a real closing brace
   * belongs to the block body, not to the following statement. It is returned
   * separately so printers and formatters can keep it before the closer at
   * body indentation.
   */
  private parseBraceBody(): { body: StataNode[]; blockEndingTrivia?: TriviaNode[] } {
    const body: StataNode[] = [];
    while (!this.isAtEnd()) {
      const my_trivia = this.collectTrivia();
      if (my_trivia.length > 0) {
        this.pending_trivia.push(...my_trivia);
      }
      if (this.check('RBRACE') || this.isAtEnd()) {
        break;
      }
      // Stata ends a program definition at the first line whose first
      // word is `end`, even in a brace block; the program takes it.
      if (this.inside_program && this.checkWord('end')) {
        break;
      }
      const stmt = this.parseStatement();
      if (stmt) {
        body.push(stmt);
        this.note_program_ending_block(stmt);
      }
      // The program ended inside this block, which has no `}`: Stata
      // reads the lines after the program's end at the top level.
      if (this.program_end_at !== undefined) {
        break;
      }
    }

    const blockEndingTrivia = this.check('RBRACE') && !this.program_ended_in_block()
      ? this.drainBlockEndingTrivia()
      : undefined;

    return { body, blockEndingTrivia };
  }

  /**
   * Record that the code from `start` through the previous token is not
   * in the AST as written: the parser skipped it to recover from an
   * error, or a block header has no `{` (`if x` alone), so printing the
   * AST would lose or invent code.
   */
  private note_unprintable(start: Position): void {
    this.unprintable_ranges.push(this.makeRange(start, this.previous().range.end));
  }

  /**
   * Where a brace block that just finished parsing ends: at its `}`, or,
   * when the program around it ended inside it, at that block's `end`
   * (the token before the cursor can be a terminator on the next line).
   */
  private brace_block_end(): Position {
    if (this.program_end_at !== undefined) {
      return this.program_end_at;
    }
    let my_index = this.current - 1;
    if (this.program_ended_in_block()) {
      // Before the `end`, not at the terminator ahead of it
      while (my_index > 0 && this.tokens[my_index].type === 'STATEMENT_TERMINATOR') {
        my_index--;
      }
    }
    return this.tokens[my_index].range.end;
  }

  /**
   * Did the program around the brace block that just finished parsing
   * end inside it, at an embedded block's `end` or at an `end` line?
   * Then the block has no `}`: Stata reads the lines after the
   * program's end at the top level.
   */
  private program_ended_in_block(): boolean {
    return this.program_end_at !== undefined ||
      (this.inside_program && this.checkWord('end'));
  }

  /**
   * Stata ends a program definition at the first line whose first word
   * is `end`, so the `end` of a mata/python block in the body ends the
   * program too, at any depth (`if 1 {` then `mata:` ... `end`).
   */
  private note_program_ending_block(stmt: StataNode): void {
    if (this.inside_program && stmt.type === 'embedded_block' &&
        !stmt.is_single_line && stmt.end_command !== undefined &&
        stmt.end_command !== '}') {
      this.program_end_at = stmt.range.end;
    }
  }

  private drainBlockEndingTrivia(): TriviaNode[] | undefined {
    if (this.pending_trivia.length === 0) {
      return undefined;
    }

    // Only reposition a PURE run of comments into the block. If a `///`
    // continuation is interleaved with the trailing comments, leave the whole
    // group in pending_trivia untouched: draining only the comments would
    // reorder the continuation relative to the comment across the closer (and
    // a continuation is not a block-ending comment). The mixed case then keeps
    // its pre-existing behavior (all pending trivia flows to the next
    // statement, or to the end-of-parse flush).
    const has_continuation = this.pending_trivia.some(
      my_trivia =>
        my_trivia.type === 'comment' && my_trivia.style === 'continuation'
    );
    if (has_continuation) {
      return undefined;
    }

    const block_ending_trivia = this.pending_trivia;
    this.pending_trivia = [];
    return block_ending_trivia;
  }

  // Skip trivia within a macro definition statement, bridging `///`
  // continuations onto the next physical line (skipContinuation consumes
  // the continuation token AND its swallowed newline terminator, if
  // present).
  //
  // Stata 18 MP audit: `local x = ///` followed by `1 / 2` succeeds with
  // `_rc == 0` and x == .5, while bare `local x =` errors with invalid
  // syntax rc 198, so bridging here still leaves a truly empty assignment
  // diagnostic-worthy. A `///` may appear at any point inside the
  // statement (after `local`/`global`, after the name, after `=`, or
  // after the extended `:` function), so every trivia-skipping step in
  // macro-definition parsing uses this instead of plain skipTrivia().
  private skipMacroDefinitionTrivia(): void {
    while (!this.isAtEnd()) {
      if (this.skipContinuation()) {
        continue;
      }

      if (this.check('COMMENT_LINE') || this.check('COMMENT_BLOCK')) {
        this.advance();
        continue;
      }

      break;
    }
  }

  /**
   * Advance a lookahead offset past trivia, bridging `///` continuations the
   * same way skipMacroDefinitionTrivia does for the live cursor (a continuation
   * also consumes its swallowed newline terminator, if present).
   * Returns the offset of the next significant token (or the
   * end-of-token offset).
   */
  private nextSignificantOffsetForMacroDef(offset: number): number {
    while (this.current + offset < this.tokens.length) {
      const token = this.tokens[this.current + offset];
      if (token.type === 'CONTINUATION') {
        offset++;
        if (this.current + offset < this.tokens.length &&
            is_swallowed_continuation_terminator(
              this.tokens[this.current + offset],
              true
            )) {
          offset++;
        }
        continue;
      }
      if (token.type === 'COMMENT_LINE' || token.type === 'COMMENT_BLOCK') {
        offset++;
        continue;
      }
      break;
    }
    return offset;
  }

  /**
   * Check if the next non-trivia token(s) look like a macro definition.
   * Returns true if next token is WORD, or OPERATOR ++/-- followed by WORD.
   * `///` continuations between the scope keyword and the name are bridged.
   */
  private looksLikeMacroDefinition(): boolean {
    let offset = this.nextSignificantOffsetForMacroDef(1);
    if (this.current + offset >= this.tokens.length) {
      return false;
    }

    const token = this.tokens[this.current + offset];
    // Found first non-trivia token
    if (token.type === 'WORD') {
      return true;
    }
    // Check for ++/-- prefix followed by WORD
    if (token.type === 'OPERATOR' && (token.value === '++' || token.value === '--')) {
      offset = this.nextSignificantOffsetForMacroDef(offset + 1);
      if (this.current + offset >= this.tokens.length) {
        return false;
      }
      return this.tokens[this.current + offset].type === 'WORD';
    }
    return false;
  }

  private skipToStatementEnd(): void {
    while (!this.check('STATEMENT_TERMINATOR') && !this.isAtEnd()) {
      this.advance();
    }
  }

  private synchronize(): void {
    this.advance();

    while (!this.isAtEnd()) {
      if (this.previous().type === 'STATEMENT_TERMINATOR') {
        return;
      }

      // Synchronize on statement-starting keywords
      if (this.checkWord('program') || this.checkWord('local') || this.checkWord('global') ||
        this.checkWord('if') || this.checkWord('foreach') || this.checkForvalues() ||
        this.checkWord('while')) {
        return;
      }

      this.advance();
    }
  }

  private check(type: TokenType): boolean {
    if (this.isAtEnd()) return false;
    return this.peek().type === type;
  }

  private checkWord(word: string): boolean {
    if (this.isAtEnd()) return false;
    return this.peek().type === 'WORD' && this.peek().value === word;
  }

  /** Check if the current token is a valid abbreviation of `forvalues` (min `forv`). */
  private checkForvalues(): boolean {
    if (this.isAtEnd()) return false;
    const token = this.peek();
    return token.type === 'WORD' &&
        token.value.length >= 4 &&
        'forvalues'.startsWith(token.value);
  }

  private advance(): Token {
    if (!this.isAtEnd()) this.current++;
    return this.previous();
  }

  private isAtEnd(): boolean {
    return this.peek().type === 'EOF';
  }

  /**
   * Check if two tokens are adjacent (no whitespace between them).
   * Adjacent means prev_token.range.end equals next_token.range.start.
   */
  private isAdjacentToken(prev_token: Token, next_token: Token): boolean {
    return prev_token.range.end.line === next_token.range.start.line &&
           prev_token.range.end.character === next_token.range.start.character;
  }

  /**
   * Check if a token is a wildcard operator (* or ?).
   * Note: * is always tokenized as OPERATOR, but ? can be tokenized as either OPERATOR or WORD.
   */
  private isWildcardToken(token: Token): boolean {
    if (token.value === '*' && token.type === 'OPERATOR') {
      return true;
    }
    if (token.value === '?' && (token.type === 'OPERATOR' || token.type === 'WORD')) {
      return true;
    }
    return false;
  }

  private peek(): Token {
    return this.tokens[this.current];
  }

  private previous(): Token {
    return this.tokens[this.current - 1];
  }

  private addError(message: string, range: Range, code: ParseErrorCode = ParseErrorCode.SYNTAX_ERROR): void {
    this.errors.push({
      message,
      range,
      code,
    });
  }

  private makeRange(start: { line: number; character: number }, end: { line: number; character: number }): Range {
    return { start, end };
  }

  get_context_tracker(): ContextTracker | null {
    return this.context_tracker;
  }

  /**
   * Parse an expression, stopping at top-level comma, statement terminator, or qualifier keywords.
   * Tracks parenthesis depth to handle nested function calls.
   * Returns the expression as a trimmed string.
   */
  parseExpression(): string {
    return this.collect_expression().text;
  }

  /**
   * Collect an expression's tokens (see parseExpression) and return them
   * with the reconstructed text. Also stops at a top-level weight clause
   * or `using`.
   */
  private collect_expression(): { text: string; tokens: Token[] } {
    // Collect the surviving tokens and reconstruct spacing from their ranges,
    // so delimiter modes produce the identical, source-faithful single-space
    // form (issue #306).
    const the_tokens: Token[] = [];
    let paren_depth = 0;
    let bracket_depth = 0;
    const start_pos = this.current;

    while (!this.isAtEnd()) {
      const token = this.peek();

      if (token.type === 'STATEMENT_TERMINATOR') {
        break;
      }

      // Handle continuation tokens - skip them and continue parsing
      if (this.skipContinuation()) {
        continue;
      }

      // A comment with more of the statement after it is whitespace;
      // one at the end of the statement is trailing trivia.
      if (this.is_interior_comment(this.current)) {
        this.advance();
        continue;
      }

      // Track parenthesis and subscript-bracket depth; a comma inside
      // either (`f(a, b)`, `M[1,2]`) does not start the options.
      if (token.type === 'LBRACKET' && !this.is_weight_start(this.current)) {
        bracket_depth++;
      } else if (token.type === 'RBRACKET') {
        bracket_depth = Math.max(0, bracket_depth - 1);
      }
      if (token.type === 'LPAREN') {
        paren_depth++;
      } else if (token.type === 'RPAREN') {
        paren_depth--;
        // Check for unbalanced parentheses (more closing than opening)
        if (paren_depth < 0) {
          this.addError('Unbalanced parentheses: unexpected closing parenthesis', token.range, ParseErrorCode.UNBALANCED_PARENTHESES);
          paren_depth = 0; // Reset to prevent cascading errors
        }
      }

      // Stop at top-level comma or qualifier keywords. A statement terminator
      // is always a hard stop and is handled before depth accounting above.
      if (paren_depth === 0 && bracket_depth === 0) {
        if (token.type === 'COMMA') {
          break;
        }
        // Stop at qualifier keywords
        if (token.type === 'WORD' &&
            (token.value === 'if' || token.value === 'in' || token.value === 'using')) {
          break;
        }
        if (this.is_weight_start(this.current)) {
          break;
        }
      }

      // Stop at comments (but not continuations - handled above)
      if (token.type === 'COMMENT_LINE' || token.type === 'COMMENT_BLOCK') {
        break;
      }

      this.advance();
      the_tokens.push(token);
    }

    const expression = this.reconstruct_value_tokens(the_tokens);

    // Check for unbalanced parentheses (unclosed opening parentheses)
    if (paren_depth > 0) {
      const end_pos = this.current > 0 ? this.previous().range : this.peek().range;
      this.addError('Unbalanced parentheses: missing closing parenthesis', end_pos, ParseErrorCode.UNBALANCED_PARENTHESES);
    }

    const trimmed_expression = expression.trim();

    // Check for empty expression (missing expression after =)
    if (trimmed_expression === '') {
      const equals_pos = start_pos > 0 ? this.tokens[start_pos - 1].range : this.peek().range;
      this.addError('Missing expression after equals sign', equals_pos, ParseErrorCode.MISSING_EXPRESSION_AFTER_EQUALS);
    }

    return { text: trimmed_expression, tokens: the_tokens };
  }

  /**
   * Check if a STRING token is just a string delimiter.
   * This indicates a string with embedded macros, where the
   * lexer splits the string into delimiter + macro + delimiter
   * tokens.
   *
   * Stata string delimiters:
   * - Double-quoted: " (opening), " (closing)
   * - Compound: `" (opening), "' (closing)
   * - Nested compound: `"`" (opening), "'"' (closing), etc.
   *
   * A STRING token is delimiter-only if it:
   * - Starts with `" or " (opening)
   * - Ends with "' or " (closing)
   * - Contains no other content between the delimiters
   */
  private isStringDelimiterOnly(token: Token): boolean {
    if (token.type !== 'STRING') {
      return false;
    }

    const token_value = token.value;

    // Check for simple double-quote delimiter
    if (token_value === '"') {
      return true;
    }

    // Check for compound string opening delimiter: `"
    if (token_value === '`"') {
      return true;
    }

    // Check for compound string closing delimiter: "'
    if (token_value === `"'`) {
      return true;
    }

    // Check for nested compound string delimiters
    // Opening: `"`", `"`"`", etc. (pattern: (`")+)
    // Closing: "'"', "'"'"', etc. (pattern: ("')+)
    if (StataParser.OPENING_DELIMITER_PATTERN.test(token_value) ||
        StataParser.CLOSING_DELIMITER_PATTERN.test(token_value)) {
      return true;
    }

    return false;
  }

  /**
   * Shared helper for parsing qualifier expressions with stray token detection.
   * Used by both parseIfQualifierExpression and parseInQualifierExpression.
   *
   * @param qualifier_type - 'if' or 'in' for error messages
   * @param stop_at_in - Whether to stop at the 'in' keyword (true for if-qualifiers)
   * @param check_empty - Whether to check for empty expression (true for if-qualifiers)
   * @returns The parsed expression as a trimmed string
   */
  private parseQualifierExpressionWithStrayDetection(
    qualifier_type: 'if' | 'in',
    stop_at_in: boolean,
    check_empty: boolean
  ): string {
    return this.collect_qualifier_expression(
      qualifier_type, stop_at_in, check_empty
    ).text;
  }

  /**
   * Collect a qualifier's tokens (see
   * parseQualifierExpressionWithStrayDetection) and return them with the
   * reconstructed text. Stops at a top-level weight clause or `using`,
   * and an `in` qualifier also stops at `if`.
   */
  private collect_qualifier_expression(
    qualifier_type: 'if' | 'in',
    stop_at_in: boolean,
    check_empty: boolean
  ): { text: string; tokens: Token[] } {
    // Collect the surviving tokens and reconstruct spacing from their ranges,
    // so `#delimit ;` and `#delimit cr` yield the identical single-space form
    // (issue #306). The stray-token state machine below is unchanged; only the
    // string it builds is collected here instead of appended inline.
    const the_tokens: Token[] = [];
    let paren_depth = 0;
    let bracket_depth = 0;  // Track subscript bracket depth
    const start_token = this.peek();

    // State machine for stray token detection at each paren level
    // States: INITIAL, AFTER_OPERAND, AFTER_COMPARE, AFTER_RHS
    type ExpressionState = 'INITIAL' | 'AFTER_OPERAND' | 'AFTER_COMPARE' | 'AFTER_RHS';

    // Track state at each paren depth level
    const state_stack: ExpressionState[] = ['INITIAL'];

    // Track previous significant token for split literal detection
    let prev_token: Token | null = null;

    // Track string context for embedded macro handling
    // This handles both double-quoted ("...") and compound (`"..."') strings
    // When we encounter a delimiter-only STRING token, we toggle this flag
    let in_string_context = false;

    while (!this.isAtEnd()) {
      const token = this.peek();

      if (token.type === 'STATEMENT_TERMINATOR') {
        break;
      }

      // A weight clause ends the qualifier. Checked before depth tracking
      // because its `[` would otherwise count as a subscript bracket.
      if (paren_depth === 0 && bracket_depth === 0 &&
          this.is_weight_start(this.current)) {
        break;
      }

      // Track parenthesis depth
      if (token.type === 'LPAREN') {
        paren_depth++;
        // Push new INITIAL state for the new paren level
        state_stack.push('INITIAL');
      } else if (token.type === 'RPAREN') {
        paren_depth--;
        if (paren_depth < 0) {
          this.addError(`Unbalanced parentheses in ${qualifier_type} qualifier`, token.range, ParseErrorCode.UNBALANCED_PARENTHESES);
          paren_depth = 0;
        }
        // Pop state for the closed paren level
        if (state_stack.length > 1) {
          state_stack.pop();
        }
        // After closing paren, the outer level sees an operand
        if (state_stack.length > 0) {
          const outer_state = state_stack[state_stack.length - 1];
          if (outer_state === 'AFTER_COMPARE') {
            state_stack[state_stack.length - 1] = 'AFTER_RHS';
          } else if (outer_state === 'INITIAL') {
            state_stack[state_stack.length - 1] = 'AFTER_OPERAND';
          }
        }
      }

      // Track bracket depth for subscript expressions like var[_n-1]
      // Brackets don't create new expression contexts like parentheses do,
      // they just modify the preceding operand
      if (token.type === 'LBRACKET') {
        bracket_depth++;
      } else if (token.type === 'RBRACKET') {
        bracket_depth--;
        if (bracket_depth < 0) {
          bracket_depth = 0;
        }
      }

      // Handle continuation tokens - skip them and continue parsing
      if (this.skipContinuation()) {
        continue;
      }

      // A name that mixes macro references and literal text, such as
      // `var'_bh or y_`var', is lexed as several physically adjacent
      // tokens. Those fragments form a single operand: a fragment that
      // directly touches the previous operand is neither a stray token
      // nor an `in` qualifier keyword. Plain adjacency without a macro
      // reference (for example "foo"bar) is not a fragment, because the
      // lexer only splits names at macro boundaries.
      const is_operand_fragment =
        prev_token !== null &&
        this.isAdjacentOperandFragment(prev_token, token);

      // Stop at top-level separators (only when not inside brackets). A
      // statement terminator is always a hard stop and is handled before depth
      // accounting above.
      if (paren_depth === 0 && bracket_depth === 0) {
        if (token.type === 'COMMA') {
          break;
        }
        // Stop at 'in' keyword (only for if-qualifiers), unless it is
        // the literal tail of a macro-built name such as `var'in.
        if (stop_at_in && token.type === 'WORD' && token.value === 'in' &&
            !is_operand_fragment) {
          break;
        }
        // `using` is reserved, and an `in` range can be followed by `if`
        // (`sum x in 1/5 if y`).
        if (token.type === 'WORD' && !is_operand_fragment &&
            (token.value === 'using' ||
             (qualifier_type === 'in' && token.value === 'if'))) {
          break;
        }

        // Stop at opening brace (brace-style blocks)
        if (token.type === 'LBRACE') {
          break;
        }
      }

      // A comment with more of the statement after it is whitespace;
      // other comments end the qualifier (continuations are handled
      // above).
      if (this.is_interior_comment(this.current)) {
        this.advance();
        continue;
      }
      if (token.type === 'COMMENT_LINE' || token.type === 'COMMENT_BLOCK') {
        break;
      }

      // Track string context - toggle when encountering delimiter-only STRING tokens
      // A STRING token that is just a delimiter indicates entering/exiting
      // a string with embedded macros
      const is_delimiter_only = this.isStringDelimiterOnly(token);
      if (is_delimiter_only) {
        in_string_context = !in_string_context;
      }

      // Get current state for this paren level
      const current_state = state_stack[state_stack.length - 1];

      // Stray token and split literal detection - skip if in string context, inside brackets, or if this is a delimiter-only STRING
      // We also skip delimiter-only STRING tokens because they are part of the string literal structure
      // Skip when inside brackets (bracket_depth > 0) because subscript expressions like var[_n-1] are valid
      if (current_state === 'AFTER_RHS' && token.type !== 'LPAREN' && token.type !== 'RPAREN' && token.type !== 'LBRACKET' && token.type !== 'RBRACKET' && bracket_depth === 0 && !in_string_context && !is_delimiter_only && !is_operand_fragment) {
        // Check for split literal patterns first
        if (prev_token && this.detectSplitLiteral(prev_token, token)) {
          // Split literal diagnostic already emitted by detectSplitLiteral
        } else if (!this.isValidAfterComparison(token)) {
          // This is a stray token
          this.addError(
            `Unexpected token '${token.value}' after comparison expression. Did you mean to use '&' or '|'?`,
            token.range,
            ParseErrorCode.STRAY_TOKEN_IN_CONDITION
          );
        }
      }

      // State transitions based on token type.
      // Also skip state transitions when inside brackets - bracket content is a subscript
      // expression that doesn't affect the outer expression state
      if (token.type !== 'LPAREN' && token.type !== 'RPAREN' && bracket_depth === 0) {
        const current_state_for_transition = state_stack[state_stack.length - 1];

        if (token.type === 'OPERATOR') {
          // Handle ~= as two tokens: ~ followed by =
          // When we see =, check if previous token was ~
          if (token.value === '=' && prev_token && prev_token.type === 'OPERATOR' && prev_token.value === '~') {
            // This is the = part of ~=, transition to AFTER_COMPARE
            state_stack[state_stack.length - 1] = 'AFTER_COMPARE';
          } else if (token.value === '~') {
            // Handle ~ operator - could be part of ~= or standalone negation
            // Don't transition to AFTER_COMPARE yet, wait for potential =
            // If not followed by =, it's treated as negation in next iteration
          } else if (this.isComparisonOperator(token.value) && token.value !== '~') {
            state_stack[state_stack.length - 1] = 'AFTER_COMPARE';
          } else if (this.isLogicalOperator(token.value)) {
            state_stack[state_stack.length - 1] = 'INITIAL';
          } else if (this.isArithmeticOperator(token.value)) {
            // Arithmetic operators: if we're in AFTER_COMPARE, stay there (unary operator)
            // Otherwise, reset to INITIAL (binary operator expecting another operand)
            if (current_state_for_transition !== 'AFTER_COMPARE') {
              state_stack[state_stack.length - 1] = 'INITIAL';
            }
            // If in AFTER_COMPARE, stay there - the next operand will be the RHS
          } else if (token.value === '!' || token.value === '~') {
            // Negation operators: if we're in AFTER_COMPARE, stay there (unary negation)
            // Otherwise, reset to INITIAL
            if (current_state_for_transition !== 'AFTER_COMPARE') {
              state_stack[state_stack.length - 1] = 'INITIAL';
            }
          }
        } else if (token.type === 'WORD' || token.type === 'NUMBER' ||
                   token.type === 'STRING' || token.type === 'MACRO_REF_LOCAL' ||
                   token.type === 'MACRO_REF_GLOBAL') {
          const state = state_stack[state_stack.length - 1];
          if (state === 'AFTER_COMPARE') {
            state_stack[state_stack.length - 1] = 'AFTER_RHS';
          } else if (state === 'INITIAL') {
            state_stack[state_stack.length - 1] = 'AFTER_OPERAND';
          }
          // If already AFTER_RHS, stay there (stray token case handled above)
        }

        prev_token = token;
      }

      this.advance();
      the_tokens.push(token);
    }

    // Check for unbalanced parentheses
    if (paren_depth > 0) {
      this.addError(`Unbalanced parentheses in ${qualifier_type} qualifier: missing closing parenthesis`, start_token.range, ParseErrorCode.UNBALANCED_PARENTHESES);
    }

    const trimmed_expression = this.reconstruct_value_tokens(the_tokens).trim();

    // Check for empty expression (only for if-qualifiers)
    if (check_empty && trimmed_expression === '') {
      this.addError(`Empty ${qualifier_type} qualifier expression`, start_token.range, ParseErrorCode.MISSING_EXPRESSION_AFTER_EQUALS);
    }

    return { text: trimmed_expression, tokens: the_tokens };
  }

  /**
   * Parse an if qualifier expression, stopping at statement terminator, comma, or 'in' keyword.
   * Tracks parenthesis depth to handle nested expressions.
   * Detects stray tokens after comparison expressions.
   * Returns the expression as a trimmed string.
   */
  parseIfQualifierExpression(): string {
    return this.parseQualifierExpressionWithStrayDetection('if', true, true);
  }

  /**
   * Detect split literal patterns and emit diagnostics.
   * Returns true if a split literal was detected.
   *
   * Patterns detected:
   * - `. N` (dot space number) → suggests `.N`
   * - `. a` (dot space letter) → suggests `.a` (extended missing value)
   *
   * Note: The lexer may tokenize `.` as either OPERATOR or WORD depending on context.
   */
  private detectSplitLiteral(prev_token: Token, current_token: Token): boolean {
    // Check for `. N` pattern (dot followed by number)
    // The dot may be tokenized as OPERATOR or WORD
    const is_prev_dot = prev_token.value === '.' && (prev_token.type === 'OPERATOR' || prev_token.type === 'WORD');

    if (is_prev_dot) {
      if (current_token.type === 'NUMBER') {
        this.addError(
          `Split literal detected: '${prev_token.value} ${current_token.value}' may have been intended as '.${current_token.value}'`,
          { start: prev_token.range.start, end: current_token.range.end },
          ParseErrorCode.SPLIT_LITERAL_IN_CONDITION
        );
        return true;
      }
      // Check for `. a` pattern (dot followed by single letter - extended missing value)
      if (current_token.type === 'WORD' && /^[a-z]$/i.test(current_token.value)) {
        this.addError(
          `Split literal detected: '${prev_token.value} ${current_token.value}' may have been intended as '.${current_token.value}' (extended missing value)`,
          { start: prev_token.range.start, end: current_token.range.end },
          ParseErrorCode.SPLIT_LITERAL_IN_CONDITION
        );
        return true;
      }
    }

    // Check for `N .` pattern (number followed by dot)
    const is_current_dot = current_token.value === '.' && (current_token.type === 'OPERATOR' || current_token.type === 'WORD');

    if (prev_token.type === 'NUMBER' && is_current_dot) {
      this.addError(
        `Split literal detected: '${prev_token.value} ${current_token.value}' may have been intended as '${prev_token.value}.' or the '.' may be stray`,
        { start: prev_token.range.start, end: current_token.range.end },
        ParseErrorCode.SPLIT_LITERAL_IN_CONDITION
      );
      return true;
    }

    // Check for `a .` pattern (identifier followed by dot)
    // Triggers for any word followed by a dot (e.g., `var .` or `x .`)
    if (prev_token.type === 'WORD' && prev_token.value !== '.' && is_current_dot) {
      this.addError(
        `Split literal detected: '${prev_token.value} ${current_token.value}' - the '.' may be stray or part of a split literal`,
        { start: prev_token.range.start, end: current_token.range.end },
        ParseErrorCode.SPLIT_LITERAL_IN_CONDITION
      );
      return true;
    }

    return false;
  }

  /**
   * Parse an in qualifier expression, stopping at statement terminator or comma.
   * Tracks parenthesis depth to handle nested expressions.
   * Detects stray tokens after comparison expressions.
   * Returns the expression as a trimmed string.
   */
  parseInQualifierExpression(): string {
    return this.parseQualifierExpressionWithStrayDetection('in', false, false);
  }

  // Brace validation helper methods

  /**
   * Check if two tokens are on the same line.
   * Compares line numbers from token ranges.
   */
  are_on_same_line(token1: Token, token2: Token): boolean {
    return token1.range.start.line === token2.range.start.line;
  }

  /**
   * Check if there are non-trivia tokens after the given position on the same line.
   * Returns the first non-trivia token if found, null otherwise.
   * Skips COMMENT_LINE, COMMENT_BLOCK, CONTINUATION tokens.
   * A `///` continuation joins the next physical line, so "same
   * line" means the same logical line.
   */
  find_code_after_on_same_line(start_pos: number, line: number): Token | null {
    return this.scan_code_on_same_line(start_pos, line)?.first_token ?? null;
  }

  /**
   * Walk the logical line starting at `start_pos` in a single pass
   * and return its first and last non-trivia tokens, or null when the
   * line has no code before a real terminator or EOF. A `///`
   * continuation joins the next physical line into the same logical
   * line. Skips COMMENT_LINE, COMMENT_BLOCK, CONTINUATION.
   */
  scan_code_on_same_line(
    start_pos: number,
    line: number
  ): { first_token: Token; last_token: Token } | null {
    const trivia_types: TokenType[] = [
      'COMMENT_LINE',
      'COMMENT_BLOCK',
      'CONTINUATION',
    ];

    let first_token: Token | null = null;
    let last_token: Token | null = null;
    let current_line = line;

    for (let i = start_pos; i < this.tokens.length; i++) {
      const my_token = this.tokens[i];

      // Stop if we've moved to a different line
      if (my_token.range.start.line !== current_line) {
        break;
      }

      // The swallowed '\n' of a /// continuation joins the next
      // physical line into this logical line
      if (
        is_swallowed_continuation_terminator(
          my_token,
          i > 0 && this.tokens[i - 1].type === 'CONTINUATION'
        )
      ) {
        const next_token = this.tokens[i + 1];
        if (!next_token) {
          break;
        }
        current_line = next_token.range.start.line;
        continue;
      }

      // Stop at statement terminator or EOF
      if (my_token.type === 'STATEMENT_TERMINATOR' || my_token.type === 'EOF') {
        break;
      }

      // Skip trivia tokens
      if (trivia_types.includes(my_token.type)) {
        continue;
      }

      if (first_token === null) {
        first_token = my_token;
      }
      last_token = my_token;
    }

    if (first_token === null || last_token === null) {
      return null;
    }
    return { first_token, last_token };
  }

  /**
   * Check if there are non-trivia tokens before the given position on the same line.
   * Returns the last non-trivia token if found, null otherwise.
   * Skips COMMENT_LINE, COMMENT_BLOCK, CONTINUATION tokens.
   * A `///` continuation, or a `//` comment under `#delimit ;`, joins
   * the next physical line, so "same line" means the same logical line.
   */
  find_code_before_on_same_line(end_pos: number, line: number): Token | null {
    const trivia_types: TokenType[] = [
      'COMMENT_LINE',
      'COMMENT_BLOCK',
      'CONTINUATION',
    ];

    let last_code_token: Token | null = null;
    let current_line = line;

    for (let i = end_pos - 1; i >= 0; i--) {
      const my_token = this.tokens[i];

      // If on different line, check if we should follow a continuation
      if (my_token.range.start.line !== current_line) {
        // STATEMENT_TERMINATOR after continuation - skip it and check for continuation
        if (my_token.type === 'STATEMENT_TERMINATOR') {
          // Only a swallowed '\n' right after a /// continuation is
          // trivia; any other terminator is a real statement end.
          if (
            is_swallowed_continuation_terminator(
              my_token,
              i > 0 && this.tokens[i - 1].type === 'CONTINUATION'
            )
          ) {
            current_line = this.tokens[i - 1].range.start.line;
            i--; // skip the continuation too
            continue;
          }
          break;
        }
        // Direct continuation token
        if (my_token.type === 'CONTINUATION') {
          current_line = my_token.range.start.line;
          continue;
        }
        // Under `#delimit ;`, a `//` comment with more of the
        // statement after it joins the next line, as `///` does.
        if (my_token.type === 'COMMENT_LINE' && this.is_interior_comment(i)) {
          current_line = my_token.range.start.line;
          continue;
        }
        break;
      }

      // Stop at statement terminator on same line (real end of statement)
      if (my_token.type === 'STATEMENT_TERMINATOR') {
        break;
      }

      // Skip trivia tokens
      if (trivia_types.includes(my_token.type)) {
        continue;
      }

      // Found a non-trivia token on the same logical line
      last_code_token = my_token;
      break;
    }

    return last_code_token;
  }

  /**
   * Validate close brace placement and emit diagnostics if invalid.
   * Checks for:
   * - Code after brace on same line → emit BRACE_NOT_ALONE
   * - Code before brace on same line → emit BRACE_NOT_ALONE
   * - `else` after brace on same line → emit BRACE_ELSE_SAME_LINE
   *
   * @param brace_token The closing brace token to validate
   * @param brace_index The index of the brace token in the tokens array
   */
  validate_close_brace(brace_token: Token, brace_index: number): void {
    const brace_line = brace_token.range.start.line;

    // Check for code BEFORE the close brace on the same line
    // We need to find the last non-trivia, non-LBRACE token before this brace
    const code_before = this.find_code_before_on_same_line(brace_index, brace_line);
    if (code_before && code_before.type !== 'LBRACE') {
      // There's code before the close brace on the same line
      this.errors.push({
        message: 'close brace must be alone on its line',
        range: this.makeRange(code_before.range.start, brace_token.range.end),
        code: ParseErrorCode.BRACE_NOT_ALONE,
      });
    }

    // Check for code AFTER the close brace on the same line
    const code_after = this.find_code_after_on_same_line(brace_index + 1, brace_line);
    if (code_after) {
      // Check if it's specifically 'else' - that's a special case
      if (code_after.type === 'WORD' && code_after.value === 'else') {
        this.errors.push({
          message: 'else must appear on a separate line from close brace',
          range: this.makeRange(brace_token.range.start, code_after.range.end),
          code: ParseErrorCode.BRACE_ELSE_SAME_LINE,
        });
      } else {
        // Generic code after close brace
        this.errors.push({
          message: 'code follows on the same line as close brace',
          range: this.makeRange(brace_token.range.start, code_after.range.end),
          code: ParseErrorCode.BRACE_NOT_ALONE,
        });
      }
    }
  }

  /**
   * The `{` that starts the statement after the current one, or
   * undefined. Called at the end of a statement (a terminator, a
   * comment that ends it, or the end of the file); skips blank lines
   * and comments.
   */
  private next_statement_open_brace(): Token | undefined {
    for (let i = this.current; i < this.tokens.length; i++) {
      const my_token = this.tokens[i];
      if (!NEXT_STATEMENT_SKIP_TYPES.has(my_token.type)) {
        return my_token.type === 'LBRACE' ? my_token : undefined;
      }
    }
    return undefined;
  }

  /**
   * Does the current token start a statement? Only comments (and
   * whitespace) may come between it and the end of the previous
   * statement, or the start of the file. A `///` joins the lines
   * around it into one statement. In cr mode a `//` comment ends at a
   * terminator, which this reaches first.
   */
  private at_statement_start(): boolean {
    for (let i = this.current - 1; i >= 0; i--) {
      const my_token = this.tokens[i];
      if (my_token.type === 'COMMENT_BLOCK' || my_token.type === 'COMMENT_LINE' ||
          my_token.type === 'WHITESPACE') {
        continue;
      }
      if (my_token.type === 'STATEMENT_TERMINATOR') {
        return !is_swallowed_continuation_terminator(
          my_token, this.tokens[i - 1]?.type === 'CONTINUATION');
      }
      return my_token.type === 'DELIMIT_DIRECTIVE';
    }
    return true;
  }

  /**
   * After a statement that needed its `{` on its own line (`else` or a
   * prefix like `capture`, alone), report OPEN_BRACE_ALONE on a `{`
   * that starts the next statement. Stata 18 runs that `{` as a block
   * of its own; `consequence` says what that means. Returns whether it
   * reported.
   */
  private report_brace_after_statement(
    keyword_token: Token,
    consequence: string
  ): boolean {
    const brace_token = this.next_statement_open_brace();
    if (brace_token === undefined) {
      return false;
    }
    this.push_open_brace_alone(brace_token, keyword_token.value, consequence);
    return true;
  }

  /**
   * A block header (`if exp`, `foreach`, `forvalues`, `while`) ended
   * with no `{`, and for `if` no command. Stata 18 stops there with
   * "{ required" (r(100)), also under `#delimit ;` and after a
   * prefix (`capture if 1` sets `_rc` to 100). When the next statement
   * is a `{`, it was meant to open the block, so the error goes on it
   * as OPEN_BRACE_ALONE; otherwise MISSING_OPEN_BRACE goes on the
   * header.
   */
  private report_header_without_brace(
    keyword_token: Token,
    takes_command: boolean
  ): void {
    const keyword = keyword_token.value;
    const brace_token = this.next_statement_open_brace();
    if (brace_token !== undefined) {
      this.push_open_brace_alone(
        brace_token, keyword, 'Stata stops with "{ required"');
      return;
    }
    // A loop header Sight could not read (`foreach v bogus`) stops
    // short of its end; leave that to the loop's own checks.
    if (!this.at_statement_end()) {
      return;
    }
    const the_options = takes_command ? 'a command or a {' : 'a {';
    const where = this.delimit_mode === 'cr' ? 'line' : 'statement';
    this.errors.push({
      message: `{ required: \`${keyword}\` needs ${the_options} ` +
        `at the end of its ${where}`,
      range: this.makeRange(
        keyword_token.range.start, this.previous().range.end),
      code: ParseErrorCode.MISSING_OPEN_BRACE,
    });
  }

  /** Report OPEN_BRACE_ALONE on a `{` meant for the `keyword` before it. */
  private push_open_brace_alone(
    brace_token: Token,
    keyword: string,
    consequence: string
  ): void {
    const placement = this.delimit_mode === 'cr'
      ? `on the same line as \`${keyword}\``
      : `before the ; that ends the \`${keyword}\``;
    this.errors.push({
      message: `open brace must be ${placement}; ${consequence}`,
      range: brace_token.range,
      code: ParseErrorCode.OPEN_BRACE_ALONE,
    });
  }

  /**
   * Validate open brace placement and emit diagnostics if invalid.
   * Checks for:
   * - Brace alone on line (no condition before) → emit OPEN_BRACE_ALONE
   * - Code after brace on same line → after an `if` header (prefixed,
   *   or in `else if`), Stata 18 runs the block and ignores the code:
   *   CODE_AFTER_OPEN_BRACE (warning). After any other header (`{`,
   *   `quietly {`, `else {`, a loop, `while`, `frame`), Stata stops
   *   with "code follows on the same line as open brace" (r(198)):
   *   CODE_FOLLOWS_OPEN_BRACE (error). Under `capture` that error is
   *   swallowed, the body runs unblocked, and its `}` fails (r(199)).
   *
   * @param brace_token The opening brace token to validate
   * @param brace_index The index of the brace token in the tokens array
   * @param has_condition_before Whether there is a condition/statement before the brace on the same line
   * @param after_if_header Whether the brace ends an `if` header
   * @returns Whether code follows the brace on its line
   */
  validate_open_brace(
    brace_token: Token,
    brace_index: number,
    has_condition_before: boolean,
    after_if_header = false
  ): boolean {
    const brace_line = brace_token.range.start.line;

    // Check if brace is alone on line (no condition before)
    // This happens when the open brace is on its own line, like:
    // if (1 == 1)
    // {
    // Under `#delimit ;` a line break doesn't end the header, so a `{`
    // on the next line is still in it: Stata 18 runs `if 1` then `{;`.
    if (!has_condition_before && this.delimit_mode === 'cr') {
      // Check if there's any code before the brace on the same line
      const code_before = this.find_code_before_on_same_line(brace_index, brace_line);
      if (!code_before) {
        // Brace is alone on its line - this is an error in Stata
        this.errors.push({
          message: 'open brace must be on the same line as the condition',
          range: brace_token.range,
          code: ParseErrorCode.OPEN_BRACE_ALONE,
        });
      }
    }

    // Check for code AFTER the open brace on the same line
    const code_after = this.scan_code_on_same_line(brace_index + 1, brace_line);
    if (code_after) {
      this.errors.push({
        message: after_if_header
          ? 'code after open brace may be silently ignored'
          : 'code after open brace is an error in Stata',
        range: this.makeRange(
          brace_token.range.start,
          code_after.last_token.range.end
        ),
        code: after_if_header
          ? ParseErrorCode.CODE_AFTER_OPEN_BRACE
          : ParseErrorCode.CODE_FOLLOWS_OPEN_BRACE,
      });
    }
    return code_after !== null;
  }

  /**
   * Reconstruct a macro value from its tokens, collapsing any inter-token gap
   * to a single space and joining truly adjacent tokens directly.
   *
   * A line break between tokens is always a separator. A `///`
   * continuation needs a space or tab before it (Stata 18 reads `b///` as
   * text), and Stata keeps that whitespace and the next line's
   * indentation, so `local x = 1 + ///` then `2` is `"1 + 2"`. Under
   * `#delimit ;` a newline is ordinary whitespace (`local xs a` then `b ;`
   * is `"a b"`). Unlike `reconstructTokensWithSpacing`, exact widths and
   * indentation are collapsed, so values read cleanly.
   *
   * @param tokens - value tokens in order (CONTINUATION removed)
   */
  private reconstruct_value_tokens(tokens: Token[]): string {
    const the_parts: string[] = [];
    let prev_token: Token | null = null;
    for (const my_token of tokens) {
      if (prev_token?.type === 'COMMENT_LINE') {
        // A `//` comment runs to the end of its line, so what followed
        // it (under `#delimit ;`, `(mean // c` then `x)`) stays on the
        // next line.
        the_parts.push('\n');
      } else if (prev_token !== null) {
        const same_line = prev_token.range.end.line === my_token.range.start.line;
        // Same-line gap: separate only when there is whitespace between.
        const needs_separator = !same_line ||
          my_token.range.start.character - prev_token.range.end.character > 0;
        if (needs_separator) {
          the_parts.push(' ');
        }
      }
      the_parts.push(my_token.value);
      prev_token = my_token;
    }
    return the_parts.join('');
  }

  /**
   * Reconstruct a string from tokens while preserving original spacing.
   * Uses token ranges to determine gaps between tokens and adds appropriate whitespace.
   *
   * @param tokens - Array of tokens to reconstruct
   * @returns The reconstructed string with original spacing preserved
   */
  private reconstructTokensWithSpacing(tokens: Token[]): string {
    if (tokens.length === 0) {
      return '';
    }

    const the_parts: string[] = [];
    let prev_token: Token | null = null;

    for (const my_token of tokens) {
      if (prev_token !== null) {
        // Calculate gap between previous token end and current token start
        // Handle same-line gaps
        if (prev_token.range.end.line === my_token.range.start.line) {
          const gap = my_token.range.start.character - prev_token.range.end.character;
          if (gap > 0) {
            the_parts.push(' '.repeat(gap));
          }
        } else if (my_token.range.start.line > prev_token.range.end.line) {
          const line_gap =
            my_token.range.start.line - prev_token.range.end.line;
          the_parts.push('\n'.repeat(line_gap));
          if (my_token.range.start.character > 0) {
            the_parts.push(' '.repeat(my_token.range.start.character));
          }
        }
      }
      the_parts.push(my_token.value);
      prev_token = my_token;
    }

    return the_parts.join('');
  }
}
