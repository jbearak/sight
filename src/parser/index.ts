import { Range } from 'vscode-languageserver-textdocument';
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
  ProgramSignature,
  ArgumentSpec,
  OptionSpec,
} from '../types';
import { ContextTracker } from '../context-tracker';
import { isFileCommand } from '../utils/file-path-utils';
import { is_swallowed_continuation_terminator } from '../utils/continuation';

const PREFIX_COMMANDS = new Set(['by', 'bysort', 'quietly', 'qui', 'capture', 'cap', 'noisily', 'noi']);

export class StataParser {
  private tokens: Token[] = [];
  private current: number = 0;
  private errors: ParseError[] = [];
  private pending_trivia: TriviaNode[] = [];
  private context_tracker: ContextTracker | null = null;
  private inside_program: boolean = false;

  // Regex patterns for nested compound string delimiters
  private static readonly OPENING_DELIMITER_PATTERN = /^(`")+$/;
  private static readonly CLOSING_DELIMITER_PATTERN = /^("')+$/;

  parse(tokens: Token[], context_tracker?: ContextTracker): ParseResult {
    this.tokens = tokens;
    this.current = 0;
    this.errors = [];
    this.pending_trivia = [];
    this.context_tracker = context_tracker || null;

    const nodes: StataNode[] = [];

    while (!this.isAtEnd()) {
      try {
        const node = this.parseStatement();
        if (node) {
          nodes.push(node);
        }
      } catch (error) {
        // Error recovery: skip to next statement boundary
        this.synchronize();
        this.addError(`Parse error: ${error}`, this.peek().range);
      }
    }

    // If the file ends with trivia (comment-only tail), attach it to the last node.
    if (this.pending_trivia.length > 0 && nodes.length > 0) {
      const last_node = nodes[nodes.length - 1];
      if (this.isNodeWithTrivia(last_node)) {
        if (last_node.trailingTrivia) {
          last_node.trailingTrivia.push(...this.pending_trivia);
        } else {
          last_node.trailingTrivia = this.pending_trivia;
        }
      }
      this.pending_trivia = [];
    }

    return {
      ast: { nodes },
      errors: this.errors,
    };
  }

  private parseStatement(): StataNode | null {
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
    } else if (this.checkWord('program') && this.peekValueAfterWhitespace() === 'define') {
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
    } else if (this.check('LBRACE')) {
      // Standalone open brace - this is an error in Stata
      // The brace should be on the same line as a condition/statement
      const brace_token = this.advance();
      this.errors.push({
        message: 'open brace must be on the same line as the condition',
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
      this.pending_trivia = leading_trivia;
      return null;
    } else {
      // Skip unknown tokens but preserve any leading trivia for the next statement.
      this.advance();
      this.pending_trivia = leading_trivia;
      return null;
    }

    // Attach leading/trailing trivia.
    if (node && this.isNodeWithTrivia(node) && leading_trivia.length > 0) {
      node.leadingTrivia = leading_trivia;
    }

    const trailing_trivia = this.collectTrivia();
    if (node && this.isNodeWithTrivia(node) && trailing_trivia.length > 0) {
      node.trailingTrivia = trailing_trivia;
    }

    // Consume statement terminator
    if (this.check('STATEMENT_TERMINATOR')) {
      this.advance();
    }

    return node;
  }

  private parseDelimitDirective(): DirectiveNode {
    const token = this.advance(); // consume DELIMIT_DIRECTIVE

    // Extract mode from token value
    const mode = token.value.includes(';') ? 'semicolon' : 'cr';

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

        // Add space between tokens if there's a gap and not the last token
        if (i < content_tokens.length - 1) {
          const next_token = content_tokens[i + 1];
          const gap = next_token.range.start.character - my_token.range.end.character;
          if (gap > 0) {
            // Add the appropriate number of spaces
            content += ' '.repeat(gap);
          }
        }
      }
    }
    content = content.trim();

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

  private parseProgramDefinition(): ProgramNode {
    const start_token = this.advance(); // consume 'program'

    // In `#delimit ;` mode the lexer emits a WHITESPACE token between `program`
    // and `define` (elided in `#delimit cr` mode); skip it so the `define`
    // check succeeds and the program is recognized rather than misparsed as an
    // ordinary command (issue #305).
    this.skipWhitespace();

    if (!this.checkWord('define')) {
      this.addError('Expected "define" after "program"', this.peek().range);
    } else {
      this.advance(); // consume 'define'
    }

    this.skipTrivia();


    // Get program name
    if (!this.check('WORD')) {
      this.addError('Expected program name', this.peek().range);
      throw new Error('Missing program name');
    }

    const name_token = this.advance();
    const program_name = name_token.value;

    // Skip any additional parameters/options for now
    this.skipToStatementEnd();

    // Parse program body
    const body: StataNode[] = [];
    const was_inside_program = this.inside_program;
    this.inside_program = true;

    // Collect any leading trivia before re-checking `end`, mirroring
    // parseBraceBody (issue #301). In `#delimit ;` mode the lexer emits
    // WHITESPACE tokens — and a comment-only line before `end` is a comment
    // followed by WHITESPACE — that `#delimit cr` mode elides. Without
    // consuming that trivia here, parseStatement() would run at the comment,
    // swallow it plus the following whitespace, and then parse `end` as an
    // ordinary command, losing the terminator and running the program off to
    // EOF (issue #305). Carrying the trivia forward via pending_trivia so it
    // attaches to the statement after the program matches how parseBraceBody
    // handles a comment before `}`. Inert in cr mode (no WHITESPACE tokens).
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
      }
    }

    this.inside_program = was_inside_program;

    // Consume 'end'
    if (this.checkWord('end')) {
      this.advance();
    } else {
      this.addError('Missing "end" for program definition', start_token.range);
    }

    // Extract and merge signatures from syntax nodes
    const merged_signature = this.extract_and_merge_signatures(body);

    return {
      type: 'program',
      name: program_name,
      body,
      signature: merged_signature,
      range: this.makeRange(
        start_token.range.start,
        this.previous().range.end
      ),
    };
  }

  private extract_and_merge_signatures(body: StataNode[]): ProgramSignature | undefined {
    // Find all SyntaxNode instances in the program body
    const syntax_nodes: SyntaxNode[] = [];
    for (const node of body) {
      if (node.type === 'syntax') {
        syntax_nodes.push(node);
      }
    }

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
    const macroName = nameToken.value;

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
      return this.parse_extended_macro_def(scopeToken, scope, macroName);
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
    // Parallel to value_tokens: true when the token at the same index was
    // reached by crossing a `///` continuation (vs an ordinary newline). A
    // `///` join keeps only indentation, so an unindented continuation joins
    // with no space; a raw `#delimit ;` newline is ordinary whitespace and
    // always separates. See reconstruct_value_tokens.
    const preceded_by_continuation: boolean[] = [];
    let continuation_pending = false;

    while (!this.check('STATEMENT_TERMINATOR') && !this.isAtEnd()) {
      // Handle continuation tokens - skip them and continue parsing
      if (this.skipContinuation()) {
        continuation_pending = true;
        continue;
      }

      // Stop at comments (but not continuations - handled above)
      const token_type = this.peek().type;
      if (token_type === 'COMMENT_LINE' || token_type === 'COMMENT_BLOCK') {
        break;
      }

      const token = this.advance();

      // In `#delimit ;` mode the lexer emits WHITESPACE tokens whose value is
      // the raw run of spaces/newlines. Skip them: reconstruct_value_tokens
      // re-inserts a single space from inter-token gaps, so keeping them would
      // embed literal whitespace (and `\n`) into the stored macro value.
      // Leave continuation_pending untouched: a `///` continuation's
      // indentation may surface as a WHITESPACE token before the next real
      // token, and the continuation status still applies to that token.
      if (token.type === 'WHITESPACE') {
        continue;
      }

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
      preceded_by_continuation.push(continuation_pending);
      continuation_pending = false;
    }

    // Reconstruct with single-space separation from token ranges. The lexer
    // drops whitespace tokens in `#delimit cr` mode, so plain concatenation
    // would collapse `local mylist a b c` to "abc" and `` `a' `b' `` to
    // "`a'`b'". A separated token pair (gap on the same line, or a line break
    // from a `///` continuation) becomes one space; adjacent tokens stay joined.
    const value = prefix_value + this.reconstruct_value_tokens(value_tokens, preceded_by_continuation);

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

    return {
      type: 'macro_def',
      scope,
      name: macroName,
      value: value.trim(),
      hasEquals: has_equals,
      range: this.makeRange(scopeToken.range.start, this.previous().range.end),
    };
  }

  private parse_extended_macro_def(scopeToken: Token, scope: 'local' | 'global', macroName: string): MacroDefNode {
    this.advance(); // consume colon
    this.skipMacroDefinitionTrivia();

    if (!this.check('WORD')) {
      this.addError('Expected function name after colon', this.peek().range);
      throw new Error('Missing function name');
    }

    const function_name = this.advance().value;
    this.skipMacroDefinitionTrivia();

    // Collect function arguments.
    // IMPORTANT: Preserve the original token stream verbatim to avoid introducing
    // artificial token boundaries (e.g., turning "0Ea" into "0E a").
    const arg_tokens: Token[] = [];
    while (!this.check('STATEMENT_TERMINATOR') && !this.isAtEnd()) {
      // Bridge `///` continuations onto the next physical line, matching the
      // standard `= ...` value path.
      if (this.skipContinuation()) {
        continue;
      }

      // Stop at comments (continuations are handled above).
      if (this.check('COMMENT_LINE') || this.check('COMMENT_BLOCK')) {
        break;
      }

      const token = this.advance();
      arg_tokens.push(token);
    }

    // Reconstruct args with original spacing preserved
    const args_trimmed = this.reconstructTokensWithSpacing(arg_tokens).trim();
    const extended_function = {
      name: function_name,
      args: args_trimmed,
      macroRefs: this.extract_macro_refs_from_extended_tokens(arg_tokens),
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

  private extract_macro_refs_from_extended_tokens(arg_tokens: Token[]): MacroReference[] {
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

    // 2) Bare identifiers (e.g., list a - b) are WORD tokens. These are treated as local
    // macro references only for a subset of downstream checks (e.g. list operations).
    // We keep them here so downstream consumers can decide which functions to validate.
    const function_names = new Set([
      'list',
      'sizeof',
      'sort',
      'uniq',
      'dups',
      'clean',
      'posof',
      'in',
      'and',
      'or',
      'count',
      'word',
      'piece',
      'subinstr',
      'length',
    ]);

    for (const my_token of arg_tokens) {
      if (my_token.type !== 'WORD') {
        continue;
      }

      const name = my_token.value;
      if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(name)) {
        continue;
      }

      if (function_names.has(name)) {
        continue;
      }

      macro_refs.push({
        name,
        range: my_token.range,
        scope: 'local',
      });
    }

    return macro_refs;
  }

  private extract_local_macro_name(value: string): string | null {
    // Remove backtick prefix and apostrophe suffix
    if (value.startsWith('`') && value.endsWith("'")) {
      return value.slice(1, -1);
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


  private parseCommand(): CommandNode {
    const start_token = this.peek();
    const command_start_line = start_token.range.start.line;

    // Parse prefix commands (by, quietly, capture, etc.)
    const prefixes: PrefixNode[] = [];
    while (this.isPrefixCommand(this.peek().value)) {
      const prefix_token = this.advance();
      const prefix: PrefixNode = {
        type: 'prefix',
        name: prefix_token.value,
        fullName: prefix_token.value, // TODO: expand abbreviations
        range: prefix_token.range,
      };

      // In `#delimit ;` mode the lexer emits WHITESPACE tokens between the
      // prefix and what follows it — an optional colon, a chained prefix, or a
      // `{ ... }` block (elided in `#delimit cr` mode). Skip that spacing
      // before each of those checks so the prefix is not misparsed and its
      // block is recognized rather than treated as a stray open brace (issue
      // #301). Whitespace only — a comment here must not be discarded.
      this.skipWhitespace();

      // Handle 'by' prefix with variable list
      if (prefix_token.value === 'by') {
        if (this.check('COLON')) {
          // by varlist: command
          // TODO: parse variable list before colon
        } else {
          // by: command (no variables)
        }
      }

      // Consume colon after any prefix command (quietly:, capture:, noisily:, etc.)
      if (this.check('COLON')) {
        this.advance();
        prefix.has_colon = true;
        this.skipWhitespace();
      }

      prefixes.push(prefix);
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
    if (this.check('MATA_START') || this.check('MATA_INLINE')) {
      const embedded_node = this.parseEmbeddedLanguageBlock('mata');
      // Attach prefixes to the embedded block
      if (prefixes.length > 0) {
        embedded_node.prefix = prefixes;
        // Update range to include prefixes
        embedded_node.range = this.makeRange(
          start_token.range.start,
          embedded_node.range.end
        );
      }
      return embedded_node as unknown as CommandNode;
    }
    if (this.check('PYTHON_START') || this.check('PYTHON_INLINE')) {
      const embedded_node = this.parseEmbeddedLanguageBlock('python');
      // Attach prefixes to the embedded block
      if (prefixes.length > 0) {
        embedded_node.prefix = prefixes;
        // Update range to include prefixes
        embedded_node.range = this.makeRange(
          start_token.range.start,
          embedded_node.range.end
        );
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
      this.validate_open_brace(lbrace_token, lbrace_index, has_condition_before);

      const body: StataNode[] = [];
      body.push(...this.parseBraceBody());
      if (this.check('RBRACE')) {
        const rbrace_index = this.current;
        const rbrace_token = this.advance(); // consume }

        // Validate close brace placement
        this.validate_close_brace(rbrace_token, rbrace_index);
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
          this.previous().range.end
        ),
      };
    }

    if (!this.check('WORD') && !this.check('MACRO_REF_LOCAL') && !this.check('MACRO_REF_GLOBAL')) {
      this.addError('Expected command name', this.peek().range);
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
    // This handles cases like `capture frame this: that`
    // In `#delimit ;` mode the lexer emits a WHITESPACE token between `frame`
    // and the frame name (elided in `#delimit cr` mode); skip it before the
    // WORD check so frame-prefix syntax is still recognized (issue #305).
    // saved_pos is captured before that skip so a non-frame-prefix command
    // backtracks fully and falls through to parseCommandBody unchanged.
    if (commandName === 'frame') {
      const saved_pos = this.current;
      this.skipWhitespace();
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
          return this.parseFramePrefixedCommand(
            frame_prefix, prefixes, start_token
          );
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
   * @returns CommandNode representing the frame-prefixed command
   */
  private parseFramePrefixedCommand(
    frame_prefix: PrefixNode,
    prefixes: PrefixNode[],
    start_token: Token
  ): CommandNode {
    prefixes.push(frame_prefix);

    // Skip whitespace after the colon
    this.skipTrivia();

    // Parse any additional prefix commands (e.g., frame name: quietly: command)
    while (this.isPrefixCommand(this.peek().value)) {
      const prefix_token = this.advance();
      const prefix: PrefixNode = {
        type: 'prefix',
        name: prefix_token.value,
        fullName: prefix_token.value,
        range: prefix_token.range,
      };
      // In `#delimit ;` mode the lexer emits a WHITESPACE token between the
      // prefix and its optional colon (elided in `#delimit cr` mode); skip it
      // before the colon check so `frame m: quietly : cmd` is not split at the
      // colon, mirroring the main prefix loop (issue #305).
      this.skipWhitespace();
      // Consume colon after any prefix command
      if (this.check('COLON')) {
        this.advance();
        prefix.has_colon = true;
      }
      prefixes.push(prefix);
      this.skipTrivia();
    }

    // Skip any remaining whitespace before the main command
    this.skipTrivia();

    // Now parse the main command
    if (!this.check('WORD') && !this.check('MACRO_REF_LOCAL') &&
        !this.check('MACRO_REF_GLOBAL')) {
      this.addError(
        'Expected command name after frame prefix',
        this.peek().range
      );
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
   */
  private parseCommandBody(
    command_token: Token,
    prefixes: PrefixNode[],
    start_token: Token
  ): CommandNode {
    const command_name = command_token.value;

    // Parse variable list (stop at comma, statement terminator, comment,
    // or 'if' keyword). Use file path coalescing for file commands.
    const varlist: IdentifierNode[] = [];

    // In `#delimit ;` mode the lexer emits a WHITESPACE token between the
    // command name and its first argument (elided in `#delimit cr` mode).
    // Skip it so the first argument — including a file path — is recognized
    // rather than the varlist collection breaking immediately (issue #305).
    // Whitespace only: a comment here belongs to the following statement's
    // trivia and must not be discarded.
    this.skipWhitespace();

    // For file commands, try to parse the first argument as a file path
    const is_file_cmd = isFileCommand(command_name);
    const has_file_arg = this.check('WORD') || this.check('NUMBER') ||
        this.check('OPERATOR') || this.check('STRING') ||
        this.check('MACRO_REF_LOCAL') || this.check('MACRO_REF_GLOBAL');
    if (is_file_cmd && has_file_arg) {
      const file_path = this.parseFilePathArgument();
      if (file_path) {
        varlist.push(file_path);
      }
    }

    // Parse remaining arguments normally (including parenthesized groups)
    while (!this.check('COMMA') && !this.isTrivia() &&
           !this.check('STATEMENT_TERMINATOR') && !this.isAtEnd()) {
      // In `#delimit ;` mode the lexer emits WHITESPACE tokens between varlist
      // items that `#delimit cr` mode elides. Skip the interstitial spacing so
      // each item is collected as its own entry instead of the loop breaking
      // at the first space (issue #305). Whitespace is the item *separator*, so
      // skipping it still yields separate entries; it must not merge fragments
      // that coalesce only when adjacent (wildcards like `var*`), which the
      // isAdjacentToken()-gated coalescing below still handles correctly.
      if (this.check('WHITESPACE')) {
        this.advance();
        continue;
      }
      // Stop at 'if' keyword for if-qualifier
      if (this.checkWord('if')) {
        break;
      }
      // Stop at 'in' keyword for in-qualifier
      if (this.checkWord('in')) {
        break;
      }

      // Check for wildcard operators (* and ?) which are valid in varlists
      // This mirrors the logic in parseCommand for consistency
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
      } else if (this.check('LPAREN')) {
        const paren_node = this.parseParenthesizedGroup();
        if (paren_node) {
          varlist.push(paren_node);
        }
      } else if (this.check('OPERATOR') && this.peek().value === '=') {
        // Stop at assignment operator
        break;
      } else {
        // Stop at other tokens
        break;
      }
    }

    // Check for assignment expression after varlist
    let expression: string | undefined;
    if (this.check('OPERATOR') && this.peek().value === '=') {
      this.advance(); // consume '='
      expression = this.parseExpression();
    }

    // Parse if-qualifier
    let ifExpression: string | undefined;
    if (this.checkWord('if')) {
      this.advance(); // consume 'if'
      ifExpression = this.parseIfQualifierExpression();
    }

    // Parse in-qualifier
    let inExpression: string | undefined;
    if (this.checkWord('in')) {
      this.advance(); // consume 'in'
      inExpression = this.parseInQualifierExpression();
    }

    // Parse options (after comma)
    const options: OptionNode[] = [];
    if (this.check('COMMA')) {
      this.advance(); // consume comma

      // Stop at statement terminator, end of file, or comment (trivia)
      while (!this.check('STATEMENT_TERMINATOR') && !this.isAtEnd() && !this.isTrivia()) {
        if (this.check('WORD')) {
          const optionToken = this.advance();
          const option: OptionNode = {
            type: 'option',
            name: optionToken.value,
            fullName: optionToken.value,
            range: optionToken.range,
          };

          // In `#delimit ;` mode a WHITESPACE token may sit between the option
          // name and its `(...)` argument (elided in `#delimit cr` mode); skip
          // it so the argument still attaches to the option rather than the
          // paren group being misread as a separate option (issue #305).
          this.skipWhitespace();

          // Check for option argument
          if (this.check('LPAREN')) {
            const parsed = this.parse_option_argument_inside_parens();
            option.argument = parsed.argument;
            option.argument_range = parsed.argument_range;
          }

          options.push(option);
        } else {
          this.advance(); // skip unknown tokens in options
        }
      }
    }

    return {
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
  }

  /**
   * Parse option argument inside parentheses.
   * Assumes LPAREN is next token. Consumes through RPAREN.
   * Returns argument string and argument_range (span of non-whitespace tokens).
   */
  private parse_option_argument_inside_parens(): { argument: string; argument_range?: Range } {
    this.advance(); // consume (
    let argument = '';
    const arg_tokens: Token[] = [];
    while (!this.check('RPAREN') && !this.isAtEnd()) {
      const t = this.advance();
      arg_tokens.push(t);
      argument += t.value;
    }
    if (this.check('RPAREN')) {
      this.advance(); // consume )
    }
    const non_ws = arg_tokens.filter(t => t.type !== 'WHITESPACE');
    const argument_range = non_ws.length > 0
      ? { start: non_ws[0].range.start, end: non_ws[non_ws.length - 1].range.end }
      : undefined;
    return { argument, argument_range };
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

    // Coalesce all tokens until whitespace, comma, terminator, or trivia
    const start_token = this.advance();
    let path = start_token.value;
    let end_range = start_token.range.end;

    while (!this.isAtEnd()) {
      // Stop at whitespace, comma, terminator, or trivia
      if (this.check('WHITESPACE') ||
          this.check('COMMA') ||
          this.check('STATEMENT_TERMINATOR') ||
          this.isTrivia()) {
        break;
      }

      // Consume any other token as part of the path
      const token = this.advance();
      path += token.value;
      end_range = token.range.end;
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
    const paren_parts: string[] = [];
    let paren_depth = 1;
    let last_was_word = false;

    while (!this.isAtEnd() && paren_depth > 0) {
      if (this.check('LPAREN')) {
        paren_depth++;
        paren_parts.push(this.advance().value);
        last_was_word = false;
      } else if (this.check('RPAREN')) {
        paren_depth--;
        if (paren_depth > 0) {
          paren_parts.push(this.advance().value);
        }
        last_was_word = false;
      } else {
        const current_is_word = this.check('WORD') ||
            this.check('NUMBER') ||
            this.check('MACRO_REF_LOCAL') ||
            this.check('MACRO_REF_GLOBAL');
        // Add space between consecutive word-like tokens
        if (last_was_word && current_is_word) {
          paren_parts.push(' ');
        }
        paren_parts.push(this.advance().value);
        last_was_word = current_is_word;
      }
    }

    const paren_content = paren_parts.join('');
    const paren_end_pos = this.check('RPAREN')
        ? this.peek().range.end
        : this.previous().range.end;

    if (this.check('RPAREN')) {
      this.advance(); // consume closing paren
    }

    // Return null for empty/whitespace-only content
    if (!paren_content.trim()) {
      return null;
    }

    return {
      name: `(${paren_content})`,
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
    const start_pos = command_token.range.start;

    // In `#delimit ;` mode the lexer emits WHITESPACE tokens around the macro
    // name, colon, and varlist that `#delimit cr` mode elides. Skip that
    // spacing before each discrete check so the command is not misparsed
    // (issue #305).
    this.skipWhitespace();

    // Parse macro name
    if (!this.check('WORD')) {
      this.addError('Expected macro name after unab', this.peek().range);
      throw new Error('Missing macro name in unab command');
    }

    const macro_name_token = this.advance();
    const varlist: IdentifierNode[] = [
      {
        name: macro_name_token.value,
        range: macro_name_token.range,
      }
    ];

    // Track whether we found a colon - stored in dedicated field, not varlist
    // This keeps varlists pure (only variable names) while preserving syntax
    let has_colon_before_varlist = false;

    this.skipWhitespace();

    // Expect colon
    if (!this.check('COLON')) {
      this.addError(
        'Expected ":" after macro name in unab command',
        this.peek().range
      );
    } else {
      this.advance(); // consume colon
      has_colon_before_varlist = true;
    }

    // Parse variable list after colon
    this.skipWhitespace();
    while ((this.check('WORD') || this.check('MACRO_REF_LOCAL') ||
            this.check('MACRO_REF_GLOBAL') ||
            (this.check('OPERATOR') && (this.peek().value === '*' || this.peek().value === '?'))) &&
           !this.check('COMMA') && !this.isTrivia()) {
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

      // Skip interstitial whitespace before the next varlist item. Placed
      // after wildcard coalescing so `var*` is still joined via adjacency
      // (issue #305).
      this.skipWhitespace();
    }

    // Parse options (after comma) - same as regular commands
    const options: OptionNode[] = [];
    if (this.check('COMMA')) {
      this.advance(); // consume comma

      while (!this.check('STATEMENT_TERMINATOR') &&
             !this.isAtEnd() && !this.isTrivia()) {
        if (this.check('WORD')) {
          const option_token = this.advance();
          const option: OptionNode = {
            type: 'option',
            name: option_token.value,
            fullName: option_token.value,
            range: option_token.range,
          };

          // Skip a WHITESPACE token between the option name and its `(...)`
          // argument in `#delimit ;` mode so the argument still attaches
          // (issue #305).
          this.skipWhitespace();

          // Check for option argument
          if (this.check('LPAREN')) {
            const parsed = this.parse_option_argument_inside_parens();
            option.argument = parsed.argument;
            option.argument_range = parsed.argument_range;
          }

          options.push(option);
        } else {
          this.advance(); // skip unknown tokens in options
        }
      }
    }

    return {
      type: 'command',
      prefix: prefixes.length > 0 ? prefixes : undefined,
      name: 'unab',
      fullName: 'unab',
      varlist,
      has_colon_before_varlist,
      options: options.length > 0 ? options : undefined,
      expression: undefined,
      range: this.makeRange(start_pos, this.previous().range.end),
    };
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

    // Parse macro names - all WORD tokens until statement terminator or trivia
    // Unlike regular commands, 'if' and 'in' are valid macro names here
    const varlist: IdentifierNode[] = [];

    while (!this.check('STATEMENT_TERMINATOR') &&
           !this.isAtEnd() && !this.isTrivia()) {
      // In `#delimit ;` mode the lexer emits WHITESPACE tokens between the
      // names that `#delimit cr` mode elides; skip that spacing so each name
      // is collected separately instead of the loop breaking at the first
      // space (issue #305).
      if (this.check('WHITESPACE')) {
        this.advance();
        continue;
      }
      const is_varlist_token = this.check('WORD') || this.check('STRING') ||
          this.check('MACRO_REF_LOCAL') || this.check('MACRO_REF_GLOBAL');
      if (is_varlist_token) {
        const var_token = this.advance();
        varlist.push({
          name: var_token.value,
          range: var_token.range,
        });
      } else {
        // Stop at other tokens
        break;
      }
    }

    return {
      type: 'command',
      prefix: prefixes.length > 0 ? prefixes : undefined,
      name: 'args',
      fullName: 'args',
      varlist: varlist.length > 0 ? varlist : undefined,
      options: undefined,
      expression: undefined,
      range: this.makeRange(start_pos, this.previous().range.end),
    };
  }

  private parseSyntaxCommand(): SyntaxNode {
    const start_token = this.advance(); // consume 'syntax'

    // Parse arguments and options
    const arguments_list: ArgumentSpec[] = [];
    const options_list: OptionSpec[] = [];
    let allows_arbitrary_options = false;
    const seen_option_names = new Set<string>();

    // Collect all tokens until statement terminator or comment. In
    // `#delimit ;` mode the lexer emits interstitial WHITESPACE tokens that
    // `#delimit cr` mode elides; the index-based spec parsers below assume
    // cr-mode adjacency (e.g. an option name immediately followed by `(`), so
    // consume the whitespace but do not collect it. This makes the token array
    // identical to cr mode and keeps `syntax , opt (string)` parsing the same
    // in both modes (issue #305). Whitespace is not meaningful within a syntax
    // spec, so dropping it is safe; comments still stop collection via
    // isTrivia().
    const syntax_tokens: Token[] = [];
    while (
      !this.check('STATEMENT_TERMINATOR') &&
      !this.isAtEnd() &&
      !this.isTrivia()
    ) {
      const my_token = this.advance();
      if (my_token.type !== 'WHITESPACE') {
        syntax_tokens.push(my_token);
      }
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

    return {
      type: 'syntax',
      signature,
      range: this.makeRange(
        start_token.range.start,
        syntax_tokens.length > 0
          ? syntax_tokens[syntax_tokens.length - 1].range.end
          : start_token.range.end
      ),
    };
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
              // Found default(, collect tokens until closing paren
              let default_str = '';
              let default_paren_depth = 1;
              let j = i + 2;
              while (j < type_tokens.length && default_paren_depth > 0) {
                const my_token = type_tokens[j];
                if (my_token.type === 'LPAREN') {
                  default_paren_depth++;
                  default_str += my_token.value;
                } else if (my_token.type === 'RPAREN') {
                  default_paren_depth--;
                  if (default_paren_depth > 0) {
                    default_str += my_token.value;
                  }
                } else {
                  default_str += my_token.value;
                }
                j++;
              }
              default_value = default_str.trim();
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

  private parseIfStatement(): ControlFlowNode {
    const ifToken = this.advance(); // consume 'if'

    // Parse condition - collect tokens until { and reconstruct with original spacing
    const condition_tokens: Token[] = [];
    const condition_start_line = ifToken.range.start.line;
    let paren_depth = 0;

    while (!this.check('LBRACE') && !this.isAtEnd()) {
      // Handle continuation tokens - skip them and continue parsing
      if (this.skipContinuation()) {
        continue;
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
          this.addError('Unbalanced parentheses in if condition', token.range, ParseErrorCode.UNBALANCED_PARENTHESES);
          paren_depth = 0;
        }
      }

      // Skip whitespace tokens but collect all others
      if (token.type !== 'WHITESPACE') {
        condition_tokens.push(token);
      }
    }

    // Reconstruct condition with original spacing preserved
    const condition = this.reconstructTokensWithSpacing(condition_tokens).trim();

    // Check for unbalanced parentheses and empty condition
    if (paren_depth > 0) {
      this.addError('Unbalanced parentheses in if condition: missing closing parenthesis', ifToken.range, ParseErrorCode.UNBALANCED_PARENTHESES);
    }

    if (condition.trim() === '') {
      this.addError('Empty if condition', ifToken.range, ParseErrorCode.MISSING_EXPRESSION_AFTER_EQUALS);
    }

    // Parse body
    const body: StataNode[] = [];
    if (this.check('LBRACE')) {
      const lbrace_index = this.current;
      const lbrace_token = this.advance(); // consume {

      // Validate open brace placement
      // has_condition_before is true if the brace is on the same line as the 'if' keyword
      const has_condition_before = lbrace_token.range.start.line === condition_start_line;
      this.validate_open_brace(lbrace_token, lbrace_index, has_condition_before);

      body.push(...this.parseBraceBody());

      if (this.check('RBRACE')) {
        const rbrace_index = this.current;
        const rbrace_token = this.advance(); // consume }

        // Validate close brace placement
        this.validate_close_brace(rbrace_token, rbrace_index);
      } else {
        this.addError('Missing closing brace for if statement', ifToken.range);
      }
    }

    return {
      type: 'if',
      condition: condition.trim(),
      body,
      range: this.makeRange(ifToken.range.start, this.previous().range.end),
    };
  }

  private parseElseStatement(): ControlFlowNode {
    const elseToken = this.advance(); // consume 'else'

    // In `#delimit ;` mode the lexer emits a WHITESPACE token between `else`
    // and what follows (elided in `#delimit cr` mode), so skip that spacing
    // before the `else if` / brace checks. Without this an `else {` on its own
    // line is misparsed as a single-statement else whose statement is a stray
    // `{` (issue #301). Whitespace only — a comment here must not be discarded.
    this.skipWhitespace();

    // Check for 'if' (else if)
    if (this.checkWord('if')) {
      const ifNode = this.parseIfStatement();
      return {
        type: 'else',
        body: [ifNode],
        range: this.makeRange(elseToken.range.start, ifNode.range.end),
      };
    }

    // Parse body
    const body: StataNode[] = [];
    let is_brace_else = false;
    if (this.check('LBRACE')) {
      is_brace_else = true;
      const lbrace_index = this.current;
      const lbrace_token = this.advance(); // consume {

      // Validate open brace placement
      // has_condition_before is true if the brace is on the same line as the 'else' keyword
      const has_condition_before = lbrace_token.range.start.line === elseToken.range.start.line;
      this.validate_open_brace(lbrace_token, lbrace_index, has_condition_before);

      body.push(...this.parseBraceBody());

      if (this.check('RBRACE')) {
        const rbrace_index = this.current;
        const rbrace_token = this.advance(); // consume }

        // Validate close brace placement
        this.validate_close_brace(rbrace_token, rbrace_index);
      } else {
        this.addError('Missing closing brace for else statement', elseToken.range);
      }
    } else {
      // Single statement else
      const stmt = this.parseStatement();
      if (stmt) {
        body.push(stmt);
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
        : this.previous().range.end;

    return {
      type: 'else',
      body,
      range: this.makeRange(elseToken.range.start, end_position),
    };
  }


  private parseLoopStatement(): ControlFlowNode {
    const loopToken = this.advance(); // consume 'foreach' or 'forvalues'
    const loopType: 'foreach' | 'forvalues' =
        loopToken.value === 'foreach' ? 'foreach' : 'forvalues';
    const loop_start_line = loopToken.range.start.line;

    let loopVar = '';
    let loopSpec = '';

    // Parse loop variable. In `#delimit ;` mode the lexer emits WHITESPACE
    // tokens between the keyword, the loop variable, and the spec keyword
    // (they are elided in `#delimit cr` mode), so skip that spacing before
    // each discrete token check (issue #301). Whitespace only — a comment here
    // must not be discarded.
    this.skipWhitespace();
    if (this.check('WORD')) {
      loopVar = this.advance().value;
    }
    this.skipWhitespace();

    // Parse loop specification
    // For forvalues: next token is '=' (OPERATOR)
    // For foreach: next token is 'in' or 'of' (WORD)
    const is_forvalues_spec = this.check('OPERATOR') && this.peek().value === '=';
    const is_foreach_spec = this.check('WORD') &&
        (this.peek().value === 'in' || this.peek().value === 'of');

    if (is_forvalues_spec || is_foreach_spec) {
      const specType = this.advance().value;
      let loop_spec_body = '';
      let prev_spec_token: Token | null = null;
      // True when the next real token was reached by crossing a `///`
      // continuation (vs an ordinary newline). A `///` join keeps only the
      // continuation line's indentation, so an unindented item joins with no
      // space; a raw `#delimit ;` newline is whitespace and always separates.
      let continuation_pending = false;

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
        const token = this.advance();
        // Spacing is derived from token ranges, not from WHITESPACE/CONTINUATION
        // token values. A `///` continuation, however, changes how a line break
        // is spaced, so remember that we crossed one.
        if (token.type === 'CONTINUATION') {
          continuation_pending = true;
          continue;
        }
        if (token.type === 'WHITESPACE') {
          continue;
        }
        if (prev_spec_token !== null) {
          const same_line = prev_spec_token.range.end.line === token.range.start.line;
          let needs_separator: boolean;
          if (same_line) {
            // Same-line gap: separate only when there is whitespace between.
            // Truly adjacent fragments (e.g. `a`m'`) join into one list item.
            needs_separator =
              token.range.start.character - prev_spec_token.range.end.character > 0;
          } else if (continuation_pending) {
            // `///`-continued item: Stata removes the newline and keeps only
            // indentation, so an unindented continuation joins (`a///`\n`b` ⇒
            // `ab`) and an indented one separates.
            needs_separator = token.range.start.character > 0;
          } else {
            // Raw newline (`#delimit ;` mode): ordinary whitespace separator.
            needs_separator = true;
          }
          if (needs_separator) {
            loop_spec_body += ' ';
          }
        }
        loop_spec_body += token.value;
        prev_spec_token = token;
        continuation_pending = false;
      }
      loopSpec = specType + ' ' + loop_spec_body.trim();
    }

    // Parse body
    const body: StataNode[] = [];
    if (this.check('LBRACE')) {
      const lbrace_index = this.current;
      const lbrace_token = this.advance(); // consume {

      // Validate open brace placement
      // has_condition_before is true if the brace is on the same line as the loop keyword
      const has_condition_before = lbrace_token.range.start.line === loop_start_line;
      this.validate_open_brace(lbrace_token, lbrace_index, has_condition_before);

      body.push(...this.parseBraceBody());

      if (this.check('RBRACE')) {
        const rbrace_index = this.current;
        const rbrace_token = this.advance(); // consume }

        // Validate close brace placement
        this.validate_close_brace(rbrace_token, rbrace_index);
      } else {
        this.addError(`Missing closing brace for ${loopType} statement`, loopToken.range);
      }
    }

    return {
      type: loopType,
      loopVar,
      loopSpec,
      body,
      range: this.makeRange(loopToken.range.start, this.previous().range.end),
    };
  }

  private parseWhileStatement(): ControlFlowNode {
    const whileToken = this.advance(); // consume 'while'
    const while_start_line = whileToken.range.start.line;

    // Parse condition - collect tokens until { and reconstruct with original spacing
    const condition_tokens: Token[] = [];
    let paren_depth = 0;

    while (!this.check('LBRACE') && !this.isAtEnd()) {
      // Handle continuation tokens - skip them and continue parsing
      if (this.skipContinuation()) {
        continue;
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

      // Skip whitespace tokens but collect all others
      if (token.type !== 'WHITESPACE') {
        condition_tokens.push(token);
      }
    }

    // Reconstruct condition with original spacing preserved
    const condition = this.reconstructTokensWithSpacing(condition_tokens).trim();

    // Check for unbalanced parentheses and empty condition
    if (paren_depth > 0) {
      this.addError('Unbalanced parentheses in while condition: missing closing parenthesis', whileToken.range, ParseErrorCode.UNBALANCED_PARENTHESES);
    }

    if (condition.trim() === '') {
      this.addError('Empty while condition', whileToken.range, ParseErrorCode.MISSING_EXPRESSION_AFTER_EQUALS);
    }

    // Parse body
    const body: StataNode[] = [];
    if (this.check('LBRACE')) {
      const lbrace_index = this.current;
      const lbrace_token = this.advance(); // consume {

      // Validate open brace placement
      // has_condition_before is true if the brace is on the same line as the 'while' keyword
      const has_condition_before = lbrace_token.range.start.line === while_start_line;
      this.validate_open_brace(lbrace_token, lbrace_index, has_condition_before);

      body.push(...this.parseBraceBody());

      if (this.check('RBRACE')) {
        const rbrace_index = this.current;
        const rbrace_token = this.advance(); // consume }

        // Validate close brace placement
        this.validate_close_brace(rbrace_token, rbrace_index);
      } else {
        this.addError('Missing closing brace for while statement', whileToken.range);
      }
    }

    return {
      type: 'while',
      condition: condition.trim(),
      body,
      range: this.makeRange(whileToken.range.start, this.previous().range.end),
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
      if (token.type !== 'WHITESPACE') {
        statement_tokens.push(token);
      }
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
  private parseFrameBlock(): ControlFlowNode | CommandNode | null {
    // Index of the `frame` token itself. Both non-block fallbacks below
    // restore to exactly this index so parseCommand re-parses `frame` and its
    // arguments from the start. A fixed offset (e.g. `saved_position - 1`)
    // assumed `#delimit cr` adjacency where `frame` immediately precedes the
    // name; in `#delimit ;` mode a WHITESPACE token sits between them, so the
    // offset landed on the whitespace and dropped `frame` from the re-parse
    // (issue #305).
    const frame_index = this.current;
    const frame_token = this.advance(); // consume 'frame'
    const frame_start_line = frame_token.range.start.line;

    this.skipTrivia();

    // Get frame name - must be a WORD token
    if (!this.check('WORD')) {
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
      return this.parseFramePrefixedCommand(frame_prefix, [], frame_token);
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
    const body: StataNode[] = this.parseBraceBody();

    if (this.check('RBRACE')) {
      const rbrace_index = this.current;
      const rbrace_token = this.advance(); // consume }

      // Validate close brace placement
      this.validate_close_brace(rbrace_token, rbrace_index);
    } else {
      this.addError('Missing closing brace for frame block', frame_token.range);
    }

    return {
      type: 'frame',
      frameName: frame_name,
      body,
      range: this.makeRange(frame_token.range.start, this.previous().range.end),
    };
  }

  /**
   * Parse the body of an unab command (after command name consumed).
   * unab macroname : varlist
   */
  private parseUnabCommandBody(command_token: Token): CommandNode {
    const start_pos = command_token.range.start;

    // In `#delimit ;` mode the lexer emits WHITESPACE tokens around the macro
    // name, colon, and varlist that `#delimit cr` mode elides. Skip that
    // spacing before each discrete check so the command is not misparsed
    // (issue #305).
    this.skipWhitespace();

    // Parse macro name
    if (!this.check('WORD')) {
      this.addError('Expected macro name after unab', this.peek().range);
      return {
        type: 'command',
        name: 'unab',
        fullName: 'unab',
        range: this.makeRange(start_pos, this.previous().range.end),
      };
    }

    const macro_name_token = this.advance();
    const varlist: IdentifierNode[] = [
      {
        name: macro_name_token.value,
        range: macro_name_token.range,
      }
    ];

    // Track whether we found a colon - stored in dedicated field, not varlist
    // This keeps varlists pure (only variable names) while preserving syntax
    let has_colon_before_varlist = false;

    this.skipWhitespace();

    // Expect colon
    if (!this.check('COLON')) {
      this.addError(
        'Expected ":" after macro name in unab command',
        this.peek().range
      );
    } else {
      this.advance(); // consume colon
      has_colon_before_varlist = true;
    }

    // Parse variable list after colon
    this.skipWhitespace();
    while ((this.check('WORD') || this.check('MACRO_REF_LOCAL') ||
            this.check('MACRO_REF_GLOBAL') ||
            (this.check('OPERATOR') && (this.peek().value === '*' || this.peek().value === '?'))) &&
           !this.check('COMMA') && !this.isTrivia()) {
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

      // Skip interstitial whitespace before the next varlist item. Placed
      // after wildcard coalescing so `var*` is still joined via adjacency
      // (issue #305).
      this.skipWhitespace();
    }

    // Parse options (after comma)
    const options: OptionNode[] = [];
    if (this.check('COMMA')) {
      this.advance();
      while (!this.check('STATEMENT_TERMINATOR') &&
             !this.isAtEnd() && !this.isTrivia()) {
        if (this.check('WORD')) {
          const option_token = this.advance();
          const option: OptionNode = {
            type: 'option',
            name: option_token.value,
            fullName: option_token.value,
            range: option_token.range,
          };
          // Skip a WHITESPACE token between the option name and its `(...)`
          // argument in `#delimit ;` mode so the argument still attaches
          // (issue #305).
          this.skipWhitespace();
          if (this.check('LPAREN')) {
            const parsed = this.parse_option_argument_inside_parens();
            option.argument = parsed.argument;
            option.argument_range = parsed.argument_range;
          }
          options.push(option);
        } else {
          this.advance();
        }
      }
    }

    return {
      type: 'command',
      name: 'unab',
      fullName: 'unab',
      varlist,
      has_colon_before_varlist,
      options: options.length > 0 ? options : undefined,
      expression: undefined,
      range: this.makeRange(start_pos, this.previous().range.end),
    };
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

  private isPrefixCommand(word: string): boolean {
    return PREFIX_COMMANDS.has(word);
  }

  private collectTrivia(): TriviaNode[] {
    const trivia: TriviaNode[] = [];

    while (this.check('COMMENT_LINE') || this.check('COMMENT_BLOCK') || this.check('CONTINUATION') || this.check('WHITESPACE')) {
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
      // Skip whitespace tokens (don't add to trivia)
    }

    return trivia;
  }

  private skipTrivia(): void {
    while (this.check('COMMENT_LINE') || this.check('COMMENT_BLOCK') || this.check('CONTINUATION') || this.check('WHITESPACE')) {
      this.advance();
    }
  }

  /**
   * Skip only WHITESPACE tokens, leaving comments and continuations in place.
   *
   * `#delimit ;` mode emits a WHITESPACE token between adjacent tokens that
   * `#delimit cr` mode elides (e.g. between a loop keyword and its variable,
   * `else` and its brace, or a prefix and its block). Structural checks that
   * only need to tolerate that interstitial spacing use this rather than
   * skipTrivia(), which would silently discard comment trivia at those
   * positions — dropping user comments from the formatter output (issue #301).
   */
  private skipWhitespace(): void {
    while (this.check('WHITESPACE')) {
      this.advance();
    }
  }

  /**
   * Parse the statements of a brace-delimited block body, stopping at the
   * matching `}` (left unconsumed for the caller to validate) or EOF.
   *
   * In `#delimit ;` mode a raw newline before `}` is emitted as a WHITESPACE
   * token (elided in `#delimit cr` mode), so the closing brace can be preceded
   * by trivia. This loop consumes that leading trivia — carrying comments
   * forward via pending_trivia exactly as parseStatement would — and then
   * checks for `}` itself, so the closing brace is never handed to
   * parseStatement, which would misreport it as an orphan (issue #301).
   *
   * A comment sitting between the last body statement and the closing brace is
   * left in pending_trivia so it attaches to the statement after the block —
   * identical to how the parser already handles that comment in `#delimit cr`
   * mode. (Folding it into the last body node's trailing trivia instead makes
   * the AST pretty-printer emit it inline on the preceding statement's line,
   * corrupting output; repositioning block-ending comments is out of scope.)
   */
  private parseBraceBody(): StataNode[] {
    const body: StataNode[] = [];
    while (!this.isAtEnd()) {
      const my_trivia = this.collectTrivia();
      if (my_trivia.length > 0) {
        this.pending_trivia.push(...my_trivia);
      }
      if (this.check('RBRACE') || this.isAtEnd()) {
        break;
      }
      const stmt = this.parseStatement();
      if (stmt) {
        body.push(stmt);
      }
    }
    return body;
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

      if (this.check('WHITESPACE') || this.check('COMMENT_LINE') || this.check('COMMENT_BLOCK')) {
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
      if (token.type === 'COMMENT_LINE' || token.type === 'COMMENT_BLOCK' ||
          token.type === 'WHITESPACE') {
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

  /**
   * Value of the next token after any interstitial WHITESPACE tokens, without
   * consuming anything. `#delimit ;` mode emits a WHITESPACE token between
   * tokens that `#delimit cr` mode elides, so a two-token lookahead such as
   * `program` + `define` needs to skip that spacing (issue #305). Whitespace
   * only — a comment between the two tokens is not skipped, matching cr mode,
   * where such a comment is likewise a distinct token that defeats the
   * adjacency lookahead.
   */
  private peekValueAfterWhitespace(): string | undefined {
    let offset = 1;
    while (this.current + offset < this.tokens.length &&
           this.tokens[this.current + offset].type === 'WHITESPACE') {
      offset++;
    }
    return this.tokens[this.current + offset]?.value;
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
    let expression = '';
    let paren_depth = 0;
    const start_pos = this.current;

    while (!this.isAtEnd()) {
      const token = this.peek();

      // Handle continuation tokens - skip them and continue parsing
      if (this.skipContinuation()) {
        continue;
      }

      // Track parenthesis depth
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

      // Stop at top-level comma, statement terminator, or qualifier keywords
      if (paren_depth === 0) {
        if (token.type === 'COMMA' || token.type === 'STATEMENT_TERMINATOR') {
          break;
        }
        // Stop at qualifier keywords
        if (token.type === 'WORD' && (token.value === 'if' || token.value === 'in')) {
          break;
        }
      }

      // Stop at comments (but not continuations - handled above)
      if (token.type === 'COMMENT_LINE' || token.type === 'COMMENT_BLOCK') {
        break;
      }

      const tokenValue = this.advance().value;
      if (token.type === 'WHITESPACE') {
        expression += ' '; // Normalize whitespace to single space
      } else {
        expression += tokenValue;
      }
    }

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

    return trimmed_expression;
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
    let expression = '';
    let paren_depth = 0;
    let bracket_depth = 0;  // Track subscript bracket depth
    const start_token = this.peek();

    // State machine for stray token detection at each paren level
    // States: INITIAL, AFTER_OPERAND, AFTER_COMPARE, AFTER_RHS
    type ExpressionState = 'INITIAL' | 'AFTER_OPERAND' | 'AFTER_COMPARE' | 'AFTER_RHS';

    // Track state at each paren depth level
    const state_stack: ExpressionState[] = ['INITIAL'];

    // Track previous non-whitespace token for split literal detection
    let prev_token: Token | null = null;

    // Track string context for embedded macro handling
    // This handles both double-quoted ("...") and compound (`"..."') strings
    // When we encounter a delimiter-only STRING token, we toggle this flag
    let in_string_context = false;

    while (!this.isAtEnd()) {
      const token = this.peek();

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

      // Stop at top-level terminators (only when not inside brackets)
      if (paren_depth === 0 && bracket_depth === 0) {
        if (token.type === 'STATEMENT_TERMINATOR' || token.type === 'COMMA') {
          break;
        }
        // Stop at 'in' keyword (only for if-qualifiers)
        if (stop_at_in && token.type === 'WORD' && token.value === 'in') {
          break;
        }
        // Stop at opening brace (brace-style blocks)
        if (token.type === 'LBRACE') {
          break;
        }
      }

      // Stop at comments (but not continuations - handled above)
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
      // Skip WHITESPACE: in `#delimit ;` mode the lexer preserves interstitial
      // WHITESPACE tokens (elided in `#delimit cr` mode), which reach this
      // check in AFTER_RHS state (e.g. the space in `if z > 1 in 1/10`). A
      // space is never a stray token, so treating it as one produced a false
      // STRAY_TOKEN_IN_CONDITION on valid semicolon-delimited qualifiers; the
      // state machine already excludes WHITESPACE from transitions below
      // (issue #305).
      if (current_state === 'AFTER_RHS' && token.type !== 'WHITESPACE' && token.type !== 'LPAREN' && token.type !== 'RPAREN' && token.type !== 'LBRACKET' && token.type !== 'RBRACKET' && bracket_depth === 0 && !in_string_context && !is_delimiter_only) {
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

      // State transitions based on token type (skip whitespace)
      // Also skip state transitions when inside brackets - bracket content is a subscript
      // expression that doesn't affect the outer expression state
      if (token.type !== 'WHITESPACE' && token.type !== 'LPAREN' && token.type !== 'RPAREN' && bracket_depth === 0) {
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

      const tokenValue = this.advance().value;
      if (token.type === 'WHITESPACE') {
        expression += ' ';
      } else {
        expression += tokenValue;
      }
    }

    // Check for unbalanced parentheses
    if (paren_depth > 0) {
      this.addError(`Unbalanced parentheses in ${qualifier_type} qualifier: missing closing parenthesis`, start_token.range, ParseErrorCode.UNBALANCED_PARENTHESES);
    }

    const trimmed_expression = expression.trim();

    // Check for empty expression (only for if-qualifiers)
    if (check_empty && trimmed_expression === '') {
      this.addError(`Empty ${qualifier_type} qualifier expression`, start_token.range, ParseErrorCode.MISSING_EXPRESSION_AFTER_EQUALS);
    }

    return trimmed_expression;
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
   * Skips WHITESPACE, COMMENT_LINE, COMMENT_BLOCK, CONTINUATION tokens.
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
   * line. Skips WHITESPACE, COMMENT_LINE, COMMENT_BLOCK, CONTINUATION.
   */
  scan_code_on_same_line(
    start_pos: number,
    line: number
  ): { first_token: Token; last_token: Token } | null {
    const trivia_types: TokenType[] = [
      'WHITESPACE',
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
   * Skips WHITESPACE, COMMENT_LINE, COMMENT_BLOCK, CONTINUATION tokens.
   * A `///` continuation joins the next physical line, so "same
   * line" means the same logical line.
   */
  find_code_before_on_same_line(end_pos: number, line: number): Token | null {
    const trivia_types: TokenType[] = [
      'WHITESPACE',
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
   * Validate open brace placement and emit diagnostics if invalid.
   * Checks for:
   * - Brace alone on line (no condition before) → emit OPEN_BRACE_ALONE
   * - Code after brace on same line → emit CODE_AFTER_OPEN_BRACE (warning)
   *
   * @param brace_token The opening brace token to validate
   * @param brace_index The index of the brace token in the tokens array
   * @param has_condition_before Whether there is a condition/statement before the brace on the same line
   */
  validate_open_brace(brace_token: Token, brace_index: number, has_condition_before: boolean): void {
    const brace_line = brace_token.range.start.line;

    // Check if brace is alone on line (no condition before)
    // This happens when the open brace is on its own line, like:
    // if (1 == 1)
    // {
    if (!has_condition_before) {
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
    // This is a warning because Stata runs but silently ignores the code
    const code_after = this.scan_code_on_same_line(brace_index + 1, brace_line);
    if (code_after) {
      this.errors.push({
        message: 'code after open brace may be silently ignored',
        range: this.makeRange(
          brace_token.range.start,
          code_after.last_token.range.end
        ),
        code: ParseErrorCode.CODE_AFTER_OPEN_BRACE,
      });
    }
  }

  /**
   * Reconstruct a macro value from its tokens, collapsing any inter-token gap
   * to a single space and joining truly adjacent tokens directly.
   *
   * A `///` continuation removes the `///` and the newline but keeps the next
   * line's leading indentation as part of the value, so a continued token that
   * starts at column 0 joins with NO space (`local x = ab///\ncd` ⇒ `"abcd"`,
   * `1///\n+2` ⇒ `"1+2"`) while an indented continuation keeps a single space
   * (`local x = 1 + ///\n    2` ⇒ `"1 + 2"`). A line break that is NOT a `///`
   * continuation only occurs in `#delimit ;` mode, where a newline is ordinary
   * whitespace; it always contributes a separator even when the next token
   * starts at column 0 (`local xs a` \n `b ;` ⇒ `"a b"`, not `"ab"`). Unlike
   * `reconstructTokensWithSpacing`, exact widths and indentation are collapsed,
   * so values read cleanly.
   *
   * @param tokens - value tokens in order (WHITESPACE/CONTINUATION removed)
   * @param preceded_by_continuation - parallel array; entry `i` is true when
   *   `tokens[i]` was reached by crossing a `///` continuation
   */
  private reconstruct_value_tokens(
    tokens: Token[],
    preceded_by_continuation: boolean[]
  ): string {
    const the_parts: string[] = [];
    let prev_token: Token | null = null;
    for (let i = 0; i < tokens.length; i++) {
      const my_token = tokens[i];
      if (prev_token !== null) {
        const same_line = prev_token.range.end.line === my_token.range.start.line;
        let needs_separator: boolean;
        if (same_line) {
          // Same-line gap: separate only when there is whitespace between.
          needs_separator =
            my_token.range.start.character - prev_token.range.end.character > 0;
        } else if (preceded_by_continuation[i]) {
          // `///` continuation: the gap is the continued token's own
          // indentation, so column 0 joins and an indented token separates.
          needs_separator = my_token.range.start.character > 0;
        } else {
          // Raw newline (`#delimit ;` mode): ordinary whitespace separator,
          // regardless of the next line's indentation.
          needs_separator = true;
        }
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
        } else {
          // Different lines - preserve original spacing by using the token's column position
          const spaces_from_line_start = my_token.range.start.character;
          if (spaces_from_line_start > 0) {
            the_parts.push(' '.repeat(spaces_from_line_start));
          } else {
            the_parts.push(' ');
          }
        }
      }
      the_parts.push(my_token.value);
      prev_token = my_token;
    }

    return the_parts.join('');
  }
}
