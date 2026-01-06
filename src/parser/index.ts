import { Range } from 'vscode-languageserver-textdocument';
import {
  Token,
  TokenType,
  StataNode,
  StataAST,
  ParseResult,
  ParseError,
  ParseErrorCode,
  CommandNode,
  ProgramNode,
  MacroDefNode,
  MacroRefNode,
  MacroReference,
  ControlFlowNode,
  StringLiteralNode,
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
    } else if (this.checkWord('program') && this.peekNext()?.value === 'define') {
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
    } else if (this.checkWord('foreach') || this.checkWord('forvalues')) {
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
    const startToken = this.advance(); // consume 'program'

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

    const nameToken = this.advance();
    const programName = nameToken.value;

    // Skip any additional parameters/options for now
    this.skipToStatementEnd();

    // Parse program body
    const body: StataNode[] = [];
    const was_inside_program = this.inside_program;
    this.inside_program = true;

    while (!this.isAtEnd() && !this.checkWord('end')) {
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
      this.addError('Missing "end" for program definition', startToken.range);
    }

    // Extract and merge signatures from syntax nodes
    const merged_signature = this.extract_and_merge_signatures(body);

    return {
      type: 'program',
      name: programName,
      body,
      signature: merged_signature,
      range: this.makeRange(startToken.range.start, this.previous().range.end),
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

    this.skipTrivia();

    // Handle prefix increment/decrement: local ++i or local --i
    let prefixOp: string | undefined;
    if (this.check('OPERATOR') && (this.peek().value === '++' || this.peek().value === '--')) {
      prefixOp = this.advance().value;
      this.skipTrivia();
    }

    if (!this.check('WORD')) {
      this.addError('Expected macro name', this.peek().range);
      throw new Error('Missing macro name');
    }

    const nameToken = this.advance();
    const macroName = nameToken.value;

    // Check for suffix increment/decrement (likely mistake): local i++
    // This assigns "++" to the macro instead of incrementing it.
    this.skipTrivia();
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
    this.skipTrivia();

    // Collect the rest of the line as the macro value (stop at comment or terminator)
    let value = prefixOp || ''; // If prefixOp exists and no = value follows, it signifies increment
    const value_start_pos = this.current;
    let paren_depth = 0;
    
    while (!this.check('STATEMENT_TERMINATOR') && !this.isAtEnd()) {
      // Handle continuation tokens - skip them and continue parsing
      if (this.skipContinuation()) {
        continue;
      }

      // Stop at comments (but not continuations - handled above)
      const token_type = this.peek().type;
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
      
      // Preserve whitespace as-is to maintain spacing between tokens
      // (e.g., `country_name' `survey_year' needs the space preserved)
      value += token.value;
    }

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
    this.skipTrivia();

    if (!this.check('WORD')) {
      this.addError('Expected function name after colon', this.peek().range);
      throw new Error('Missing function name');
    }

    const function_name = this.advance().value;
    this.skipTrivia();

    // Collect function arguments.
    // IMPORTANT: Preserve the original token stream verbatim to avoid introducing
    // artificial token boundaries (e.g., turning "0Ea" into "0E a").
    const arg_tokens: Token[] = [];
    while (!this.check('STATEMENT_TERMINATOR') && !this.isAtEnd() && !this.isTrivia()) {
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
    const startToken = this.peek();
    const command_start_line = startToken.range.start.line;

    // Parse prefix commands (by, quietly, capture, etc.)
    const prefixes: PrefixNode[] = [];
    while (this.isPrefixCommand(this.peek().value)) {
      const prefixToken = this.advance();
      const prefix: PrefixNode = {
        type: 'prefix',
        name: prefixToken.value,
        fullName: prefixToken.value, // TODO: expand abbreviations
        range: prefixToken.range,
      };

      // Handle 'by' prefix with variable list
      if (prefixToken.value === 'by') {
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
      }

      prefixes.push(prefix);
    }

    const commandToken = this.peek();

    // Check if this is a syntax command after prefixes (e.g., qui syntax anything [if] [in])
    // This must be checked before embedded language blocks to ensure proper parsing
    if (this.checkWord('syntax')) {
      const syntax_node = this.parseSyntaxCommand();
      // Attach prefixes to the syntax node
      if (prefixes.length > 0) {
        syntax_node.prefix = prefixes;
        // Update range to include prefixes
        syntax_node.range = this.makeRange(startToken.range.start, syntax_node.range.end);
      }
      return syntax_node as unknown as CommandNode;
    }

    // Check if this is an embedded language block after prefixes (e.g., capture mata: ...)
    if (this.check('MATA_START') || this.check('MATA_INLINE')) {
      const embedded_node = this.parseEmbeddedLanguageBlock('mata');
      // Attach prefixes to the embedded block
      if (prefixes.length > 0) {
        embedded_node.prefix = prefixes;
        // Update range to include prefixes
        embedded_node.range = this.makeRange(startToken.range.start, embedded_node.range.end);
      }
      return embedded_node as unknown as CommandNode;
    }
    if (this.check('PYTHON_START') || this.check('PYTHON_INLINE')) {
      const embedded_node = this.parseEmbeddedLanguageBlock('python');
      // Attach prefixes to the embedded block
      if (prefixes.length > 0) {
        embedded_node.prefix = prefixes;
        // Update range to include prefixes
        embedded_node.range = this.makeRange(startToken.range.start, embedded_node.range.end);
      }
      return embedded_node as unknown as CommandNode;
    }

    // Check if this is a block after prefixes (e.g., quietly { ... })
    if (this.check('LBRACE')) {
      const lbrace_index = this.current;
      const lbrace_token = this.advance(); // consume {

      // Validate open brace placement
      // has_condition_before is true if the brace is on the same line as the prefix command
      const has_condition_before = lbrace_token.range.start.line === command_start_line;
      this.validate_open_brace(lbrace_token, lbrace_index, has_condition_before);

      const body: StataNode[] = [];
      while (!this.check('RBRACE') && !this.isAtEnd()) {
        const stmt = this.parseStatement();
        if (stmt) {
          body.push(stmt);
        }
      }
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
        range: this.makeRange(startToken.range.start, this.previous().range.end),
      };
    }

    if (!this.check('WORD') && !this.check('MACRO_REF_LOCAL') && !this.check('MACRO_REF_GLOBAL')) {
      this.addError('Expected command name', this.peek().range);
      throw new Error('Missing command name');
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
    if (commandName === 'frame' && this.check('WORD')) {
      const saved_pos = this.current;
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
          varlist: [frame_name_token.value],
          has_colon: true,
          range: this.makeRange(command_token.range.start, this.previous().range.end),
        };
        prefixes.push(frame_prefix);
        
        // Parse any additional prefix commands
        while (this.isPrefixCommand(this.peek().value)) {
          const prefixToken = this.advance();
          const prefix: PrefixNode = {
            type: 'prefix',
            name: prefixToken.value,
            fullName: prefixToken.value,
            range: prefixToken.range,
          };
          if (this.check('COLON')) {
            this.advance();
            prefix.has_colon = true;
          }
          prefixes.push(prefix);
        }
        
        // Now parse the main command
        if (!this.check('WORD') && !this.check('MACRO_REF_LOCAL') && !this.check('MACRO_REF_GLOBAL')) {
          this.addError('Expected command name after frame prefix', this.peek().range);
          return {
            type: 'command',
            prefix: prefixes,
            name: '',
            fullName: '',
            range: this.makeRange(startToken.range.start, this.previous().range.end),
          };
        }
        
        const actual_command_token = this.advance();
        const actual_command_name = actual_command_token.value;
        
        // Handle unab specially
        if (actual_command_name === 'unab') {
          const unab_node = this.parseUnabCommandBody(actual_command_token);
          unab_node.prefix = prefixes;
          unab_node.range = this.makeRange(startToken.range.start, unab_node.range.end);
          return unab_node;
        }
        
        // Parse the rest of the command normally
        return this.parseCommandBody(actual_command_token, prefixes, startToken);
      } else {
        // Not frame prefix syntax, backtrack
        this.current = saved_pos;
      }
    }

    // Parse variable list (stop at comma, statement terminator, comment, or 'if' keyword)
    // Use file path coalescing for file commands
    const varlist: IdentifierNode[] = [];
    
    // For file commands, try to parse the first argument as a file path
    if (isFileCommand(commandName) && (this.check('WORD') || this.check('NUMBER') || this.check('OPERATOR') || this.check('STRING') || this.check('MACRO_REF_LOCAL') || this.check('MACRO_REF_GLOBAL'))) {
      const filePath = this.parseFilePathArgument();
      if (filePath) {
        varlist.push(filePath);
      }
    }
    
    // Parse remaining arguments normally (including parenthesized groups)
    while (!this.check('COMMA') && !this.isTrivia() && !this.check('STATEMENT_TERMINATOR') && !this.isAtEnd()) {
      // Stop at 'if' keyword for if-qualifier
      if (this.checkWord('if')) {
        break;
      }
      // Stop at 'in' keyword for in-qualifier
      if (this.checkWord('in')) {
        break;
      }
      
      // Check for wildcard operators (* and ?) which are valid in varlists
      const is_wildcard = this.check('OPERATOR') && (this.peek().value === '*' || this.peek().value === '?');
      
      if (this.check('WORD') || this.check('STRING') || this.check('MACRO_REF_LOCAL') || this.check('MACRO_REF_GLOBAL') || this.check('NUMBER') || is_wildcard) {
        const varToken = this.advance();
        varlist.push({
          name: varToken.value,
          range: varToken.range,
        });
      } else if (this.check('LPAREN')) {
        // Handle parenthesized groups (e.g., getmata (var1 var2)=matrix, exit(1))
        // Capture the entire parenthesized expression as a single varlist item
        const paren_start = this.advance(); // consume (
        const paren_parts = [];
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
            const current_is_word = this.check('WORD') || this.check('NUMBER') || 
                                    this.check('MACRO_REF_LOCAL') || this.check('MACRO_REF_GLOBAL');
            // Add space between consecutive word-like tokens
            if (last_was_word && current_is_word) {
              paren_parts.push(' ');
            }
            paren_parts.push(this.advance().value);
            last_was_word = current_is_word;
          }
        }
        const paren_content = paren_parts.join('');
        const paren_end_pos = this.check('RPAREN') ? this.peek().range.end : this.previous().range.end;
        if (this.check('RPAREN')) {
          this.advance(); // consume closing paren
        }
        // Add the parenthesized content as a single varlist item with parens
        if (paren_content.trim()) {
          varlist.push({
            name: `(${paren_content})`,
            range: this.makeRange(paren_start.range.start, paren_end_pos),
          });
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
            fullName: optionToken.value, // TODO: expand abbreviations
            range: optionToken.range,
          };

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
      name: commandName,
      fullName: commandName, // TODO: expand abbreviations
      varlist: varlist.length > 0 ? varlist : undefined,
      options: options.length > 0 ? options : undefined,
      expression,
      ifExpression,
      inExpression,
      range: this.makeRange(startToken.range.start, this.previous().range.end),
    };
  }

  /**
   * Parse the body of a command (varlist, expression, qualifiers, options).
   * Used when the command name has already been consumed.
   */
  private parseCommandBody(command_token: Token, prefixes: PrefixNode[], startToken: Token): CommandNode {
    const commandName = command_token.value;
    
    // Parse variable list (stop at comma, statement terminator, comment, or 'if' keyword)
    // Use file path coalescing for file commands
    const varlist: IdentifierNode[] = [];
    
    // For file commands, try to parse the first argument as a file path
    if (isFileCommand(commandName) && (this.check('WORD') || this.check('NUMBER') || this.check('OPERATOR') || this.check('STRING') || this.check('MACRO_REF_LOCAL') || this.check('MACRO_REF_GLOBAL'))) {
      const filePath = this.parseFilePathArgument();
      if (filePath) {
        varlist.push(filePath);
      }
    }
    
    // Parse remaining arguments normally (including parenthesized groups)
    while (!this.check('COMMA') && !this.isTrivia() && !this.check('STATEMENT_TERMINATOR') && !this.isAtEnd()) {
      // Stop at 'if' keyword for if-qualifier
      if (this.checkWord('if')) {
        break;
      }
      // Stop at 'in' keyword for in-qualifier
      if (this.checkWord('in')) {
        break;
      }
      
      if (this.check('WORD') || this.check('STRING') || this.check('MACRO_REF_LOCAL') || this.check('MACRO_REF_GLOBAL') || this.check('NUMBER')) {
        const varToken = this.advance();
        varlist.push({
          name: varToken.value,
          range: varToken.range,
        });
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
      name: commandName,
      fullName: commandName,
      varlist: varlist.length > 0 ? varlist : undefined,
      options: options.length > 0 ? options : undefined,
      expression,
      ifExpression,
      inExpression,
      range: this.makeRange(startToken.range.start, this.previous().range.end),
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
   * Parse unab command: unab macroname : varlist
   */
  private parseUnabCommand(commandToken: Token, prefixes: PrefixNode[]): CommandNode {
    const startPos = commandToken.range.start;
    
    // Parse macro name
    if (!this.check('WORD')) {
      this.addError('Expected macro name after unab', this.peek().range);
      throw new Error('Missing macro name in unab command');
    }
    
    const macroNameToken = this.advance();
    const varlist: IdentifierNode[] = [
      {
        name: macroNameToken.value,
        range: macroNameToken.range,
      }
    ];
    
    // Track whether we found a colon - stored in dedicated field, not varlist
    // This keeps varlists pure (only variable names) while preserving syntax info
    let has_colon_before_varlist = false;
    
    // Expect colon
    if (!this.check('COLON')) {
      this.addError('Expected ":" after macro name in unab command', this.peek().range);
    } else {
      this.advance(); // consume colon
      has_colon_before_varlist = true;
    }
    
    // Parse variable list after colon
    while ((this.check('WORD') || this.check('MACRO_REF_LOCAL') || this.check('MACRO_REF_GLOBAL')) && !this.check('COMMA') && !this.isTrivia()) {
      const varToken = this.advance();
      varlist.push({
        name: varToken.value,
        range: varToken.range,
      });
    }
    
    // Parse options (after comma) - same as regular commands
    const options: OptionNode[] = [];
    if (this.check('COMMA')) {
      this.advance(); // consume comma

      while (!this.check('STATEMENT_TERMINATOR') && !this.isAtEnd() && !this.isTrivia()) {
        if (this.check('WORD')) {
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
      range: this.makeRange(startPos, this.previous().range.end),
    };
  }

  /**
   * Parse args command: args name1 [name2 ...]
   * The args command doesn't support if/in qualifiers, so 'if' and 'in' are valid macro names.
   */
  private parseArgsCommand(commandToken: Token, prefixes: PrefixNode[]): CommandNode {
    const startPos = commandToken.range.start;
    
    // Parse macro names - all WORD tokens until statement terminator or trivia
    // Unlike regular commands, 'if' and 'in' are valid macro names here
    const varlist: IdentifierNode[] = [];
    
    while (!this.check('STATEMENT_TERMINATOR') && !this.isAtEnd() && !this.isTrivia()) {
      if (this.check('WORD') || this.check('STRING') || this.check('MACRO_REF_LOCAL') || this.check('MACRO_REF_GLOBAL')) {
        const varToken = this.advance();
        varlist.push({
          name: varToken.value,
          range: varToken.range,
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
      range: this.makeRange(startPos, this.previous().range.end),
    };
  }

  private parseSyntaxCommand(): SyntaxNode {
    const start_token = this.advance(); // consume 'syntax'

    // Parse arguments and options
    const arguments_list: ArgumentSpec[] = [];
    const options_list: OptionSpec[] = [];
    let allows_arbitrary_options = false;
    const seen_option_names = new Set<string>();

    // Collect all tokens until statement terminator or comment
    const syntax_tokens: Token[] = [];
    while (
      !this.check('STATEMENT_TERMINATOR') &&
      !this.isAtEnd() &&
      !this.isTrivia()
    ) {
      syntax_tokens.push(this.advance());
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
   * Skip continuation token and its following statement terminator.
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
      if (!this.isAtEnd() && this.check('STATEMENT_TERMINATOR')) {
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

      while (!this.check('RBRACE') && !this.isAtEnd()) {
        const stmt = this.parseStatement();
        if (stmt) {
          body.push(stmt);
        }
      }

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
    if (this.check('LBRACE')) {
      const lbrace_index = this.current;
      const lbrace_token = this.advance(); // consume {

      // Validate open brace placement
      // has_condition_before is true if the brace is on the same line as the 'else' keyword
      const has_condition_before = lbrace_token.range.start.line === elseToken.range.start.line;
      this.validate_open_brace(lbrace_token, lbrace_index, has_condition_before);

      while (!this.check('RBRACE') && !this.isAtEnd()) {
        const stmt = this.parseStatement();
        if (stmt) {
          body.push(stmt);
        }
      }

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

    return {
      type: 'else',
      body,
      range: this.makeRange(elseToken.range.start, this.previous().range.end),
    };
  }


  private parseLoopStatement(): ControlFlowNode {
    const loopToken = this.advance(); // consume 'foreach' or 'forvalues'
    const loopType = loopToken.value as 'foreach' | 'forvalues';
    const loop_start_line = loopToken.range.start.line;

    let loopVar = '';
    let loopSpec = '';

    // Parse loop variable
    if (this.check('WORD')) {
      loopVar = this.advance().value;
    }

    // Parse loop specification
    // For forvalues: next token is '=' (OPERATOR)
    // For foreach: next token is 'in' or 'of' (WORD)
    const is_forvalues_spec = this.check('OPERATOR') && this.peek().value === '=';
    const is_foreach_spec = this.check('WORD') && 
        (this.peek().value === 'in' || this.peek().value === 'of');

    if (is_forvalues_spec || is_foreach_spec) {
      const specType = this.advance().value;
      let needs_space = false;

      // Collect specification until {
      while (!this.check('LBRACE') && !this.isAtEnd()) {
        // Stop at statement terminator unless preceded by continuation
        if (this.check('STATEMENT_TERMINATOR')) {
          if (this.current > 0 && this.tokens[this.current - 1].type === 'CONTINUATION') {
            this.advance(); // skip newline after continuation
            continue;
          }
          break;
        }
        const token = this.advance();
        // Preserve whitespace tokens as-is, don't add extra spaces
        if (token.type === 'WHITESPACE') {
          loopSpec += token.value;
          needs_space = false;
        } else {
          // Add space between non-whitespace tokens only if needed
          if (needs_space && loopSpec.length > 0 && !loopSpec.endsWith(' ')) {
            loopSpec += ' ';
          }
          loopSpec += token.value;
          needs_space = true;
        }
      }
      loopSpec = specType + ' ' + loopSpec.trim();
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

      while (!this.check('RBRACE') && !this.isAtEnd()) {
        const stmt = this.parseStatement();
        if (stmt) {
          body.push(stmt);
        }
      }

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

      while (!this.check('RBRACE') && !this.isAtEnd()) {
        const stmt = this.parseStatement();
        if (stmt) {
          body.push(stmt);
        }
      }

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
   * Parse a frame block: `frame name { ... }` or frame prefix: `frame name: command`
   * Frame blocks execute code in the context of a named data frame.
   * Syntax: frame framename { commands } OR frame framename: command
   * 
   * Unlike conditional blocks (if, while), frame blocks don't have a condition -
   * they just have a frame name followed by a brace block or colon.
   */
  private parseFrameBlock(): ControlFlowNode | CommandNode | null {
    const frame_token = this.advance(); // consume 'frame'
    const frame_start_line = frame_token.range.start.line;

    this.skipTrivia();

    // Get frame name - must be a WORD token
    if (!this.check('WORD')) {
      // Not a frame block/prefix syntax, fall back to command parsing
      // Reset position and return null to let parseCommand handle it
      this.current--;
      return null;
    }

    const name_token = this.peek();

    // Check if this is followed by a brace (frame block syntax) or colon (frame prefix syntax)
    // We need to look ahead past the frame name
    const saved_position = this.current;
    this.advance(); // consume frame name
    this.skipTrivia();

    if (this.check('COLON')) {
      // This is frame prefix syntax: frame name: command
      this.advance(); // consume colon
      
      // Create a prefix node for the frame
      const frame_prefix: PrefixNode = {
        type: 'prefix',
        name: 'frame',
        fullName: 'frame',
        varlist: [name_token.value],
        has_colon: true,
        range: this.makeRange(frame_token.range.start, this.previous().range.end),
      };
      
      // Parse the rest as a command with this prefix
      // We need to handle the case where there might be more prefix commands after frame:
      const prefixes: PrefixNode[] = [frame_prefix];
      
      // Parse any additional prefix commands
      while (this.isPrefixCommand(this.peek().value)) {
        const prefixToken = this.advance();
        const prefix: PrefixNode = {
          type: 'prefix',
          name: prefixToken.value,
          fullName: prefixToken.value,
          range: prefixToken.range,
        };

        // Handle 'by' prefix with variable list
        if (prefixToken.value === 'by') {
          if (this.check('COLON')) {
            // by varlist: command
            // TODO: parse variable list before colon
          } else {
            // by: command (no variables)
          }
        }

        // Consume colon after any prefix command
        if (this.check('COLON')) {
          this.advance();
          prefix.has_colon = true;
        }

        prefixes.push(prefix);
      }
      
      // Now parse the main command
      if (!this.check('WORD') && !this.check('MACRO_REF_LOCAL') && !this.check('MACRO_REF_GLOBAL')) {
        this.addError('Expected command name after frame prefix', this.peek().range);
        return {
          type: 'command',
          prefix: prefixes,
          name: '',
          fullName: '',
          range: this.makeRange(frame_token.range.start, this.previous().range.end),
        };
      }
      
      const command_token = this.advance();
      const commandName = command_token.value;
      
      // Special handling for unab command: unab macroname : varlist
      if (commandName === 'unab') {
        const unab_node = this.parseUnabCommandBody(command_token);
        unab_node.prefix = prefixes;
        unab_node.range = this.makeRange(frame_token.range.start, unab_node.range.end);
        return unab_node;
      }
      
      // Parse variable list
      const varlist: IdentifierNode[] = [];
      while ((this.check('WORD') || this.check('OPERATOR') || this.check('MACRO_REF_LOCAL') || this.check('MACRO_REF_GLOBAL')) && 
             !this.check('COMMA') && !this.isTrivia() && !this.check('STATEMENT_TERMINATOR')) {
        // Stop at 'if' or 'in' keywords (qualifiers)
        if (this.check('WORD') && (this.peek().value === 'if' || this.peek().value === 'in')) {
          break;
        }
        const varToken = this.advance();
        varlist.push({
          name: varToken.value,
          range: varToken.range,
        });
      }
      
      // Parse if/in qualifiers
      let ifExpression: string | undefined;
      let inExpression: string | undefined;
      
      if (this.checkWord('if')) {
        this.advance();
        ifExpression = this.parseExpression();
      }
      
      if (this.checkWord('in')) {
        this.advance();
        inExpression = this.parseExpression();
      }
      
      // Parse options
      const options: OptionNode[] = [];
      if (this.check('COMMA')) {
        this.advance();
        while (!this.check('STATEMENT_TERMINATOR') && !this.isAtEnd() && !this.isTrivia()) {
          if (this.check('WORD')) {
            const optionToken = this.advance();
            const option: OptionNode = {
              type: 'option',
              name: optionToken.value,
              fullName: optionToken.value,
              range: optionToken.range,
            };
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
        prefix: prefixes,
        name: commandName,
        fullName: commandName,
        varlist: varlist.length > 0 ? varlist : undefined,
        options: options.length > 0 ? options : undefined,
        ifExpression,
        inExpression,
        range: this.makeRange(frame_token.range.start, this.previous().range.end),
      };
    }

    if (!this.check('LBRACE')) {
      // Not a frame block syntax (might be other frame command like `frame create`)
      // Reset position and return null to let parseCommand handle it
      this.current = saved_position - 1; // Reset to before 'frame' was consumed
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
    const body: StataNode[] = [];
    while (!this.check('RBRACE') && !this.isAtEnd()) {
      const stmt = this.parseStatement();
      if (stmt) {
        body.push(stmt);
      }
    }

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
   * Parse the body of an unab command (after the command name has been consumed).
   * unab macroname : varlist
   */
  private parseUnabCommandBody(commandToken: Token): CommandNode {
    const startPos = commandToken.range.start;
    
    // Parse macro name
    if (!this.check('WORD')) {
      this.addError('Expected macro name after unab', this.peek().range);
      return {
        type: 'command',
        name: 'unab',
        fullName: 'unab',
        range: this.makeRange(startPos, this.previous().range.end),
      };
    }
    
    const macroNameToken = this.advance();
    const varlist: IdentifierNode[] = [
      {
        name: macroNameToken.value,
        range: macroNameToken.range,
      }
    ];
    
    // Track whether we found a colon - stored in dedicated field, not varlist
    // This keeps varlists pure (only variable names) while preserving syntax info
    let has_colon_before_varlist = false;
    
    // Expect colon
    if (!this.check('COLON')) {
      this.addError('Expected ":" after macro name in unab command', this.peek().range);
    } else {
      this.advance(); // consume colon
      has_colon_before_varlist = true;
    }
    
    // Parse variable list after colon
    while ((this.check('WORD') || this.check('MACRO_REF_LOCAL') || this.check('MACRO_REF_GLOBAL')) && !this.check('COMMA') && !this.isTrivia()) {
      const varToken = this.advance();
      varlist.push({
        name: varToken.value,
        range: varToken.range,
      });
    }
    
    // Parse options (after comma)
    const options: OptionNode[] = [];
    if (this.check('COMMA')) {
      this.advance();
      while (!this.check('STATEMENT_TERMINATOR') && !this.isAtEnd() && !this.isTrivia()) {
        if (this.check('WORD')) {
          const optionToken = this.advance();
          const option: OptionNode = {
            type: 'option',
            name: optionToken.value,
            fullName: optionToken.value,
            range: optionToken.range,
          };
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
      range: this.makeRange(startPos, this.previous().range.end),
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
   * Check if the next non-trivia token(s) look like a macro definition.
   * Returns true if next token is WORD, or OPERATOR ++/-- followed by WORD.
   */
  private looksLikeMacroDefinition(): boolean {
    let offset = 1;
    // Skip trivia tokens
    while (this.current + offset < this.tokens.length) {
      const token = this.tokens[this.current + offset];
      if (token.type === 'COMMENT_LINE' || token.type === 'COMMENT_BLOCK' || 
          token.type === 'CONTINUATION' || token.type === 'WHITESPACE') {
        offset++;
        continue;
      }
      // Found first non-trivia token
      if (token.type === 'WORD') {
        return true;
      }
      // Check for ++/-- prefix followed by WORD
      if (token.type === 'OPERATOR' && (token.value === '++' || token.value === '--')) {
        offset++;
        // Skip trivia after operator
        while (this.current + offset < this.tokens.length) {
          const next_token = this.tokens[this.current + offset];
          if (next_token.type === 'COMMENT_LINE' || next_token.type === 'COMMENT_BLOCK' || 
              next_token.type === 'CONTINUATION' || next_token.type === 'WHITESPACE') {
            offset++;
            continue;
          }
          return next_token.type === 'WORD';
        }
      }
      return false;
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
        this.checkWord('if') || this.checkWord('foreach') || this.checkWord('forvalues') ||
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

  private advance(): Token {
    if (!this.isAtEnd()) this.current++;
    return this.previous();
  }

  private isAtEnd(): boolean {
    return this.peek().type === 'EOF';
  }

  private peek(): Token {
    return this.tokens[this.current];
  }

  private peekNext(): Token | undefined {
    if (this.current + 1 >= this.tokens.length) return undefined;
    return this.tokens[this.current + 1];
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

      // Handle continuation tokens - skip them and continue parsing
      if (this.skipContinuation()) {
        continue;
      }

      // Stop at top-level terminators
      if (paren_depth === 0) {
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

      // Stray token and split literal detection - skip if in string context or if this is a delimiter-only STRING
      // We also skip delimiter-only STRING tokens because they are part of the string literal structure
      if (current_state === 'AFTER_RHS' && token.type !== 'LPAREN' && token.type !== 'RPAREN' && !in_string_context && !is_delimiter_only) {
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
      if (token.type !== 'WHITESPACE' && token.type !== 'LPAREN' && token.type !== 'RPAREN') {
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
   */
  find_code_after_on_same_line(start_pos: number, line: number): Token | null {
    const trivia_types: TokenType[] = [
      'WHITESPACE',
      'COMMENT_LINE',
      'COMMENT_BLOCK',
      'CONTINUATION',
    ];

    for (let i = start_pos; i < this.tokens.length; i++) {
      const my_token = this.tokens[i];

      // Stop if we've moved to a different line
      if (my_token.range.start.line !== line) {
        return null;
      }

      // Stop at statement terminator or EOF
      if (my_token.type === 'STATEMENT_TERMINATOR' || my_token.type === 'EOF') {
        return null;
      }

      // Skip trivia tokens
      if (trivia_types.includes(my_token.type)) {
        continue;
      }

      // Found a non-trivia token on the same line
      return my_token;
    }

    return null;
  }

  /**
   * Check if there are non-trivia tokens before the given position on the same line.
   * Returns the last non-trivia token if found, null otherwise.
   * Skips WHITESPACE, COMMENT_LINE, COMMENT_BLOCK, CONTINUATION tokens.
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
          // Look back for a continuation on the previous line
          if (i > 0 && this.tokens[i - 1].type === 'CONTINUATION') {
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
    const code_after = this.find_code_after_on_same_line(brace_index + 1, brace_line);
    if (code_after) {
      // Find the last token on the same line to get the full range
      let last_token = code_after;
      for (let i = brace_index + 2; i < this.tokens.length; i++) {
        const my_token = this.tokens[i];
        if (my_token.range.start.line !== brace_line) {
          break;
        }
        if (my_token.type === 'STATEMENT_TERMINATOR' || my_token.type === 'EOF') {
          break;
        }
        // Skip trivia when determining the last code token
        const trivia_types: TokenType[] = [
          'WHITESPACE',
          'COMMENT_LINE',
          'COMMENT_BLOCK',
          'CONTINUATION',
        ];
        if (!trivia_types.includes(my_token.type)) {
          last_token = my_token;
        }
      }

      this.errors.push({
        message: 'code after open brace may be silently ignored',
        range: this.makeRange(brace_token.range.start, last_token.range.end),
        code: ParseErrorCode.CODE_AFTER_OPEN_BRACE,
      });
    }
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
