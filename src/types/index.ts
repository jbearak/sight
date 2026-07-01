import { Range, Position } from 'vscode-languageserver-textdocument';

// Context Types
export enum LanguageContext {
  STATA = 'stata',
  MATA = 'mata',
  PYTHON = 'python',
}

export interface ContextRange {
  context: LanguageContext;
  range: Range;
  parent_context?: LanguageContext;
  start_delimiter: {
    command: string;
    range: Range;
  };
  end_delimiter?: {
    command: string;
    range: Range;
  };
  is_single_line: boolean;
}

export interface ContextDiagnostic {
  message: string;
  range: Range;
  severity: 'error' | 'warning' | 'information';
  code: ContextErrorCode;
}

export enum ContextErrorCode {
  UNCLOSED_MATA_BLOCK = 'UNCLOSED_MATA_BLOCK',
  UNCLOSED_PYTHON_BLOCK = 'UNCLOSED_PYTHON_BLOCK',
  UNEXPECTED_END = 'UNEXPECTED_END',
  UNEXPECTED_END_COMMAND = 'UNEXPECTED_END_COMMAND',
  MISMATCHED_END_PYTHON = 'MISMATCHED_END_PYTHON',
  NESTED_BLOCK_ERROR = 'NESTED_BLOCK_ERROR',
  INVALID_DELIMITER_POSITION = 'INVALID_DELIMITER_POSITION',
}

// Token Types
export type TokenType =
  | 'WORD'
  | 'NUMBER'
  | 'STRING'
  | 'MACRO_REF_LOCAL'
  | 'MACRO_REF_GLOBAL'
  | 'OPERATOR'
  | 'LBRACE'
  | 'RBRACE'
  | 'LPAREN'
  | 'RPAREN'
  | 'LBRACKET'
  | 'RBRACKET'
  | 'COMMA'
  | 'COLON'
  | 'COMMENT_LINE'
  | 'COMMENT_BLOCK'
  | 'CONTINUATION'
  | 'DELIMIT_DIRECTIVE'
  | 'STATEMENT_TERMINATOR'
  | 'WHITESPACE'
  | 'MATA_START'
  | 'MATA_INLINE'
  | 'PYTHON_START'
  | 'PYTHON_INLINE'
  | 'END_MATA'
  | 'END_PYTHON'
  | 'EMBEDDED_CONTENT'
  | 'EOF';

export interface Token {
  type: TokenType;
  value: string;
  range: Range;
  quoteStyle?: 'simple' | 'compound';
}

// Lexer State
export interface LexerState {
  delimiterMode: 'cr' | 'semicolon';
  line: number;
  column: number;
  language_context?: LanguageContext;
  context_stack?: LanguageContext[];
  embedded_block_start?: Position;
  // Track brace depth for brace-style embedded blocks (e.g., mata { ... })
  // undefined = not a brace-style block, 0+ = brace depth
  embedded_brace_depth?: number;
  // Line number where the embedded block started (for brace-style detection)
  embedded_block_start_line?: number;
  // Track if we're in a continuation sequence (previous line ended with ///)
  in_continuation?: boolean;
}

export interface LexerResult {
  tokens: Token[];
  errors: LexerError[];
  finalState: LexerState;
  line_offsets: number[];
}

// Document Store Types
export interface DocumentStoreMetrics {
  parse_count: number;
  parse_total_ms: number;
  cache_hits: number;
  cache_misses: number;
  evictions: number;
}

// Indexer Metrics
export interface IndexerMetrics {
  files_indexed: number;
  files_skipped: number;
  total_index_time_ms: number;
  avg_file_time_ms: number;
}

/**
 * One concrete definition of a workspace symbol, tied to a specific file.
 * Used by workspace-symbol search so multiple definitions of the same name
 * across files each get their own entry.
 */
export type WorkspaceSymbolKind =
  | 'program'
  | 'global_macro'
  | 'local_macro'
  | 'variable'
  | 'scalar'
  | 'matrix';

export interface WorkspaceSymbolMatch {
  name: string;              // raw name — no backtick/apostrophe decoration
  kind: WorkspaceSymbolKind;
  uri: string;
  range: Range;
}

/**
 * Minimal interface a workspace-symbol search source must satisfy.
 * The real `WorkspaceIndexer` implements this; tests can supply a stub.
 */
export interface WorkspaceSymbolSource {
  find_all_symbol_definitions(query: string): WorkspaceSymbolMatch[];
}

export interface LexerError {
  message: string;
  range: Range;
  code: LexerErrorCode;
}

export enum LexerErrorCode {
  UNBALANCED_QUOTES = 'UNBALANCED_QUOTES',
  UNBALANCED_BLOCK_COMMENT = 'UNBALANCED_BLOCK_COMMENT',
  UNTERMINATED_STATEMENT = 'UNTERMINATED_STATEMENT',
  CONTINUATION_NO_SPACE = 'CONTINUATION_NO_SPACE',
  BLOCK_COMMENT_IN_STAR_COMMENT = 'BLOCK_COMMENT_IN_STAR_COMMENT',
}

// Syntax Command Types
export interface ArgumentSpec {
  type: 'varlist' | 'varname' | 'newvarname' | 'anything' | 'if' | 'in' | 'using' | 'exp' | 'name' | 'namelist' | 'weight' | 'fweight' | 'fw' | 'aweight' | 'aw' | 'pweight' | 'pw' | 'iweight' | 'iw';
  name?: string; // For 'anything(name=...)'
  isOptional: boolean; // true if wrapped in brackets (e.g., [varlist])
  range: Range;
}

export interface OptionSpec {
  name: string;
  minAbbreviation: string; // Computed from casing
  isRequired: boolean; // true if marked with *
  isOptional: boolean; // true if in brackets
  argumentType?: 'real' | 'integer' | 'string' | 'varlist' | 'name' | 'filename' | 'numlist' | 'varname' | 'passthru';
  defaultValue?: string;
  range: Range;
}

export interface ProgramSignature {
  arguments: ArgumentSpec[];
  options: OptionSpec[];
  allowsArbitraryOptions: boolean; // true if * appears
  syntaxRanges: Range[]; // Ranges of all syntax commands (for multiple syntax support)
}

export interface SyntaxNode {
  type: 'syntax';
  signature: ProgramSignature;
  prefix?: PrefixNode[];
  range: Range;
  leadingTrivia?: TriviaNode[];
  trailingTrivia?: TriviaNode[];
}

// AST Node Types
export type StataNode =
  | CommandNode
  | ProgramNode
  | MacroDefNode
  | MacroRefNode
  | ControlFlowNode
  | StringLiteralNode
  | DirectiveNode
  | EmbeddedLanguageBlockNode
  | SyntaxNode;

export interface DirectiveNode {
  type: 'directive';
  directive: 'delimit';
  mode: 'cr' | 'semicolon';
  range: Range;
  leadingTrivia?: TriviaNode[];
  trailingTrivia?: TriviaNode[];
}

export interface EmbeddedLanguageBlockNode {
  type: 'embedded_block';
  language: 'mata' | 'python';
  start_command: string; // 'mata', 'python', 'mata:', 'python:'
  end_command?: string; // 'end', 'end python' (undefined if unclosed)
  content: string; // Raw content between delimiters
  content_range: Range; // Range of the content (excluding delimiters)
  is_single_line: boolean; // true for 'mata:', 'python:'
  prefix?: PrefixNode[]; // Prefix commands like 'capture', 'quietly'
  range: Range; // Full range including delimiters
  leadingTrivia?: TriviaNode[];
  trailingTrivia?: TriviaNode[];
}

export interface PrefixNode {
  type: 'prefix';
  name: string;
  fullName: string;
  varlist?: string[];
  frameName?: string;  // For frame prefixes with frame names
  has_colon?: boolean;
  range: Range;
}

export interface OptionNode {
  type: 'option';
  name: string;
  fullName: string;
  argument?: string;
  argument_range?: Range;
  range: Range;
}

export interface IdentifierNode {
  name: string;
  range: Range;
}

export interface CommandNode {
  type: 'command';
  prefix?: PrefixNode[];
  name: string;
  fullName: string;
  varlist?: IdentifierNode[];
  has_colon_before_varlist?: boolean;  // For unab commands: separates macro name from varlist
  options?: OptionNode[];
  expression?: string;
  ifExpression?: string;
  inExpression?: string;
  body?: StataNode[];  // For prefix command brace blocks (e.g., capture { })
  range: Range;
  leadingTrivia?: TriviaNode[];
  trailingTrivia?: TriviaNode[];
}

export interface ProgramNode {
  type: 'program';
  name: string;
  body: StataNode[];
  signature?: ProgramSignature; // Extracted from syntax command
  range: Range;
  leadingTrivia?: TriviaNode[];
  trailingTrivia?: TriviaNode[];
}

// Extended Macro Function Types
export interface MacroReference {
  name: string;           // The macro name being referenced
  range: Range;           // Position in the source for diagnostics/completions
  scope: 'local' | 'global'; // Whether it's a local (`name') or global ($name) reference
}

export interface ExtendedMacroFunction {
  name: string;           // e.g., 'list', 'word', 'subinstr'
  args: string;           // e.g., 'a - b', 'count string'
  macroRefs?: MacroReference[]; // Macro references with positions
}

export interface MacroDefNode {
  type: 'macro_def';
  scope: 'local' | 'global';
  name: string;
  value: string;
  hasEquals?: boolean;  // Whether the definition used '=' (e.g., local x = 1 vs local x 1)
  extendedFunction?: ExtendedMacroFunction;
  range: Range;
  leadingTrivia?: TriviaNode[];
  trailingTrivia?: TriviaNode[];
}

export interface MacroRefNode {
  type: 'macro_ref';
  scope: 'local' | 'global';
  name: string;
  range: Range;
}

export interface ControlFlowNode {
  type: 'if' | 'else' | 'foreach' | 'forvalues' | 'while' | 'frame';
  condition?: string;
  loopVar?: string;
  loopSpec?: string;
  frameName?: string;
  body: StataNode[];
  range: Range;
  leadingTrivia?: TriviaNode[];
  trailingTrivia?: TriviaNode[];
}

export interface StringLiteralNode {
  type: 'string';
  quoteStyle: 'simple' | 'compound';
  value: string;
  range: Range;
}

export interface TriviaNode {
  type: 'comment';
  style: 'star' | 'slash' | 'block' | 'continuation';
  content: string;
  range: Range;
}

export interface StataAST {
  nodes: StataNode[];
}

export interface ParseResult {
  ast: StataAST;
  errors: ParseError[];
}

export interface ParseError {
  message: string;
  range: Range;
  code: ParseErrorCode;
}

export enum ParseErrorCode {
  SYNTAX_ERROR = 'SYNTAX_ERROR',
  BRACE_ELSE_SAME_LINE = 'BRACE_ELSE_SAME_LINE',
  BRACE_NOT_ALONE = 'BRACE_NOT_ALONE',
  MISSING_PROGRAM_END = 'MISSING_PROGRAM_END',
  OPEN_BRACE_ALONE = 'OPEN_BRACE_ALONE',
  UNCLOSED_BLOCK = 'UNCLOSED_BLOCK',
  CODE_AFTER_OPEN_BRACE = 'CODE_AFTER_OPEN_BRACE',
  FORVALUES_SYNTAX = 'FORVALUES_SYNTAX',
  REDUNDANT_MACRO_SUFFIX = 'REDUNDANT_MACRO_SUFFIX',
  MISSING_EXPRESSION_AFTER_EQUALS = 'MISSING_EXPRESSION_AFTER_EQUALS',
  UNBALANCED_PARENTHESES = 'UNBALANCED_PARENTHESES',
  ORPHAN_CLOSE_BRACE = 'ORPHAN_CLOSE_BRACE',
  STRAY_TOKEN_IN_CONDITION = 'STRAY_TOKEN_IN_CONDITION',
  SPLIT_LITERAL_IN_CONDITION = 'SPLIT_LITERAL_IN_CONDITION',
}


// Symbol Types
export interface SymbolTable {
  programs: Map<string, ProgramSymbol>;
  localMacros: Map<string, MacroSymbol>;
  globalMacros: Map<string, MacroSymbol>;
  variables: Map<string, VariableSymbol>;
  scalars: Map<string, ScalarSymbol>;
  matrices: Map<string, MatrixSymbol>;
}

export interface ProgramSymbol {
  name: string;
  location: { uri: string; range: Range };
  sourceUri: string;
  parameters?: string[];
  signature?: ProgramSignature; // Extracted from syntax command
  c_locals?: string[]; // Macro names created via c_local
  macro_creating_local_options?: string[]; // Local macro names created via options (e.g., c_local `local')
  macro_creating_global_options?: string[]; // Global macro names created via options (e.g., global `global')
  additional_definitions?: Array<{ index: number, line: number, location: { uri: string; range: Range } }>;
}

export interface MacroSymbol {
  name: string;
  scope: 'local' | 'global';
  location: { uri: string; range: Range };
  sourceUri: string;
  value?: string;
  hasEquals?: boolean;  // True if defined with = sign (local x = expr) vs literal (local x a b)
  containingScope?: ScopeType;
  extendedFunction?: ExtendedMacroFunction;
  definition_index?: number;  // Preorder index where macro was defined
  definition_line?: number;   // Line number where macro was first defined
  // For Mata setters: the position after which the macro becomes
  // visible (the end of the inline `mata:` statement). References before
  // this position are in the same Mata unit and not yet defined.
  visibility_start?: { line: number; character: number };
  // True when this symbol was synthesized by the loop expander from a
  // constructed name (e.g. `local x_`i'`). Its `location` points at the
  // loop-body template statement, whose text does NOT contain the concrete
  // name, so find-references must not surface it as a textual occurrence.
  is_expanded?: boolean;
  // True when this macro's FIRST definition is inside a context that may not
  // execute at runtime (an `if`/`else`/`while` body, or a dynamic/empty loop
  // body, tracked via `nonexec_range_stack`). This does NOT make the
  // macro block-scoped: Stata locals remain visible in the containing do-file /
  // program after loops. The flag only says its stored `value` must not be
  // statically folded outside the active execution context, because doing so
  // could fabricate iteration values or constructed names that never exist.
  maybe_unexecuted?: boolean;
  // Nearest enclosing non-executing range for a maybe-unexecuted definition.
  // Static folding may still use this value while resolving later statements
  // inside the same currently-active range. This supports by-design expansion
  // of static inner-loop constructed names inside dynamic outer loops.
  maybe_unexecuted_range?: Range;
  // True when this macro is defined inside a guaranteed loop body and its value
  // interpolates an active loop iterator (e.g. `` local suffix `i' `` inside
  // `foreach i ...`). Its runtime value is the last iteration's binding, which
  // is not known statically, so it must NOT be folded into a later loop's
  // value-set or constructed name (folding the iterator's stale stored value
  // would fabricate names that never exist at runtime, falsely suppressing
  // undefined-macro warnings).
  iteration_dependent?: boolean;
  additional_definitions?: Array<{ index: number, line: number, location: { uri: string; range: Range }, is_expanded?: boolean }>;
}

export interface VariableSymbol {
  name: string;
  location: { uri: string; range: Range };
  sourceUri: string;
  type?: string;
  label?: string;
  value_label_name?: string;
  value_labels?: Map<number | string, string>;
  source: 'gen' | 'egen' | 'input' | 'inferred' | 'directive' | 'rename' | 'confirm';
}

export type ScopeType = 'dofile' | 'program' | 'ado';

export interface ScopeInfo {
  type: ScopeType;
  range: Range;
  localMacros: Map<string, MacroSymbol>;
}

// Command Database Types
export interface CommandInfo {
  name: string;
  minAbbreviation: string;
  /** Syntax string (optional - may be removed from cache) */
  syntax?: string;
  options: OptionInfo[];
  /** Subcommands for prefix commands (e.g., frame create, mi estimate) */
  subcommands?: SubcommandInfo[];
  category: string;
  isBuiltin: boolean;
  priority?: 1 | 2 | 3;
  /**
   * Basename (without `.sthlp`) of the help file that documents this
   * command when it differs from `name`. Populated from the cache so the
   * `sight/resolveSthlpFile` handler can redirect topics like `local` to
   * `macro.sthlp`.
   */
  helpFile?: string;
}

export interface OptionInfo {
  name: string;
  minAbbreviation: string;
  hasArgument: boolean;
}

export interface SubcommandInfo {
  name: string;
  minAbbreviation: string;
}

// Diagnostic Codes
export enum StataDiagnosticCode {
  // Lexer errors
  UNBALANCED_QUOTES = 'UNBALANCED_QUOTES',
  UNBALANCED_BLOCK_COMMENT = 'UNBALANCED_BLOCK_COMMENT',
  UNTERMINATED_STATEMENT = 'UNTERMINATED_STATEMENT',
  CONTINUATION_NO_SPACE = 'CONTINUATION_NO_SPACE',
  BLOCK_COMMENT_IN_STAR_COMMENT = 'BLOCK_COMMENT_IN_STAR_COMMENT',

  // Semantic errors
  UNDEFINED_MACRO = 'UNDEFINED_MACRO',
  UNDEFINED_VARIABLE = 'UNDEFINED_VARIABLE',
  OUT_OF_SCOPE_SYMBOL = 'OUT_OF_SCOPE_SYMBOL',
  MISSING_VARIABLE_NAME = 'MISSING_VARIABLE_NAME',

  // Parser errors
  SYNTAX_ERROR = 'SYNTAX_ERROR',
  BRACE_ELSE_SAME_LINE = 'BRACE_ELSE_SAME_LINE',
  BRACE_NOT_ALONE = 'BRACE_NOT_ALONE',
  MISSING_PROGRAM_END = 'MISSING_PROGRAM_END',
  OPEN_BRACE_ALONE = 'OPEN_BRACE_ALONE',
  UNCLOSED_BLOCK = 'UNCLOSED_BLOCK',
  CODE_AFTER_OPEN_BRACE = 'CODE_AFTER_OPEN_BRACE',
  FORVALUES_SYNTAX = 'FORVALUES_SYNTAX',
  REDUNDANT_MACRO_SUFFIX = 'REDUNDANT_MACRO_SUFFIX',
  INVALID_MACRO_CHAR = 'INVALID_MACRO_CHAR',

  // Indentation errors
  UNNECESSARY_INDENTATION = 'UNNECESSARY_INDENTATION',
  MISSING_INDENTATION = 'MISSING_INDENTATION',

  // Operator sequence diagnostics
  MALFORMED_OPERATOR = 'MALFORMED_OPERATOR',
  INVALID_OPERATOR_SEQUENCE = 'INVALID_OPERATOR_SEQUENCE',
  CSTYLE_LOGICAL_IN_CONTROL_FLOW = 'CSTYLE_LOGICAL_IN_CONTROL_FLOW',
  MIXED_LOGICAL_OPERATORS = 'MIXED_LOGICAL_OPERATORS',
  SPACED_COMPOUND_OPERATOR = 'SPACED_COMPOUND_OPERATOR',

  // Expression-structure diagnostics
  CHAINED_COMPARISON = 'CHAINED_COMPARISON',
  LITERAL_MACRO_ADJACENCY = 'LITERAL_MACRO_ADJACENCY',

  // Cross-file diagnostics
  PATH_CASE_MISMATCH = 'PATH_CASE_MISMATCH',
  CROSS_FILE_MISSING_FILE = 'CROSS_FILE_MISSING_FILE',
  // Emitted when a traversal cap (max_backward_depth / max_forward_depth /
  // max_chain_depth) truncates cross-file resolution. Signals "results may be
  // incomplete", NOT a genuine undefined symbol — surfaced distinctly by
  // `sight check` and excluded from its pass/fail tally.
  CROSS_FILE_TRUNCATED = 'CROSS_FILE_TRUNCATED',
}

// Structured payload carried on a diagnostic's `data` field for undefined-symbol
// diagnostics (UNDEFINED_MACRO / UNDEFINED_VARIABLE). Lets downstream logic
// (suppression, out-of-scope rewriting) recover the referenced symbol from
// structured data instead of parsing the human-facing message prose, so the
// message wording can change without breaking behavior. See docs/superpowers/
// specs/2026-06-26-diagnostic-message-code-deduplication.md.
export interface UndefinedSymbolDiagnosticData {
  symbol_name?: string;
  reference_kind?: 'local' | 'global' | 'variable';
}


// Configuration Types
export interface CommentFormattingConfig {
  preferredCommentStyle: 'line' | '//' | '*' | '/* */';
  normalizeCommentStyle: boolean;
  commentLineWidth: number;
  lineWidth?: number;
}

export interface StataLSPConfig {
  diagnostics: {
    enabled: boolean;
    severity: {
      undefinedMacro: 'error' | 'warning' | 'information' | 'hint' | 'off';
      undefinedVariable: 'error' | 'warning' | 'information' | 'hint' | 'off';
      styleWarnings: 'error' | 'warning' | 'information' | 'hint' | 'off';
      malformedOperator: 'error' | 'warning' | 'information' | 'hint' | 'off';
      spacedCompoundOperator: 'error' | 'warning' | 'information' | 'hint' | 'off';
      invalidOperatorSequence: 'error' | 'warning' | 'information' | 'hint' | 'off';
      cStyleLogicalInControlFlow: 'error' | 'warning' | 'information' | 'hint' | 'off';
      mixedLogicalOperators: 'error' | 'warning' | 'information' | 'hint' | 'off';
      chainedComparison: 'error' | 'warning' | 'information' | 'hint' | 'off';
      literalMacroAdjacency: 'error' | 'warning' | 'information' | 'hint' | 'off';
    };
    indentation: boolean;
  };
  completion: {
    cacheSize: number;
    prefixMaxItems: number;
  };
  formatting: {
    indentSize: number;
    indentStyle: 'spaces' | 'tabs';
    lineWidth: number;
    preferredCommentStyle: 'line' | '//' | '*' | '/* */';
    normalizeCommentStyle: boolean;
    commentLineWidth: number;
    preserve_alignment?: boolean;
    mode?: 'source-preserving' | 'ast';
  };
  lineCommentStyle?: '//' | '*';
  indexing: {
    maxFileSizeBytes: number;
  };
  adoPaths: string[];
  indexWorkspace: boolean;
  cross_file: CrossFileConfig;
  // Workspace-relative glob patterns to exclude from `sight check` and the
  // workspace index (issue #255), e.g. ["output/**"]. In-editor open documents
  // are still analyzed; exclusion governs bulk scanning only.
  exclude: string[];
  debug?: boolean;
}

// Command Metadata System Types
export type StataVersion = 15 | 16 | 17 | 18;

// Cross-File Awareness Types

export interface Directive {
  type: 'done-by' | 'included-by';
  path: string;                    // Resolved absolute path
  raw_path: string;                // Original path from directive
  call_site?: CallSite;            // Optional call site specification
  range: Range;                    // Location in source file
}

export interface CallSite {
  type: 'line' | 'match';
  value: number | string;          // Line number or match string
  resolved_line?: number;          // Resolved line number (for match)
}

// Working Directory Directive Types
export interface WorkingDirectoryDirective {
  /** The raw path string from the directive */
  path: string;

  /** Resolved absolute filesystem path */
  resolved_path: string;

  /** True if the path started with / (workspace-relative) */
  is_workspace_relative: boolean;

  /** Source location for diagnostics */
  range: Range;

  /** Which directive synonym was used (e.g., "working-directory", "cd", "wd") */
  directive_form: string;
}

export interface DirectiveParseResult {
  directives: Directive[];
  declaration_directives: DeclarationDirective[];
  diagnostics: DirectiveDiagnostic[];
  forward_calls?: ForwardCallDirective[];
  working_directory?: WorkingDirectoryDirective;
}

// Declaration Directive Types
export type DeclarationDirectiveType = 'local' | 'global' | 'scalar' | 'matrix' | 'program';

export interface DeclarationDirective {
  type: DeclarationDirectiveType;
  name: string;
  range: Range;
}

/**
 * Source information for diagnostics that originate from parent files in directive chains.
 */
export interface DiagnosticSource {
  /** Filename where the error originated (basename only) */
  source_file: string;
  /** Line number in source file (0-indexed). Omit when call site is unknown. */
  source_line?: number;
  /** Original range in the source file */
  original_range: Range;
}

export interface DirectiveDiagnostic {
  message: string;
  range: Range;
  severity: 'error' | 'warning' | 'information';
  source?: DiagnosticSource;  // Source attribution for diagnostics from parent files
  /** Structured discriminator for severity routing. */
  kind?: 'missing_file' | 'path_case_mismatch' | 'truncation' | 'missing_directory';
  /** Stable code included on the emitted LSP Diagnostic (e.g. PATH_CASE_MISMATCH). */
  code?: StataDiagnosticCode;
  /**
   * Real existing directory used to probe host case-sensitivity when
   * `config.cross_file.diagnostics.case_mismatch === 'auto'`.
   * Typically the workspace root that contains the mismatched path.
   * When absent and severity is 'auto', the converter treats the host
   * as case-sensitive (Warning) as a conservative fallback.
   */
  case_mismatch_seed_dir?: string;
}

export interface ScalarSymbol {
  name: string;
  location: { uri: string; range: Range };
  sourceUri: string;
  definition_line?: number;
  additional_definitions?: Array<{ index: number, line: number, location: { uri: string; range: Range } }>;
}

export interface MatrixSymbol {
  name: string;
  location: { uri: string; range: Range };
  sourceUri: string;
  definition_line?: number;
  additional_definitions?: Array<{ index: number, line: number, location: { uri: string; range: Range } }>;
}


export interface ScopeChainEntry {
  uri: string;
  directive_type: 'done-by' | 'included-by';
  call_site_line: number;          // Line in parent where call occurs
  symbols: SymbolTable;            // Symbols from this file
  forward_call_sites?: ForwardCallSite[];  // Parent forward calls visible before the child call site
  /**
   * Parent's forward calls across the entire parent file, in line order.
   * Used only by find-references (collect_visible_reference_uris) to detect
   * sibling/post-site reachability. Never merged into `symbols`.
   */
  all_forward_call_sites?: ForwardCallSite[];
  depth: number;                   // Distance from current file (0 = current)
  // Order of the directive in the referencing file header.
  // Larger means it appeared later in the header ("lattermost" wins at same depth).
  directive_order: number;
  sort_key: string;                // Deterministic sort key for tie-breaking
}

export type OutOfScopeReason = 'after_call_site' | 'inheritance_excludes_locals';

export interface OutOfScopeSymbol {
  name: string;
  type: 'local' | 'global' | 'program' | 'variable' | 'scalar' | 'matrix';
  source_uri: string;
  defined_line: number;            // 0-indexed line where symbol is defined
  call_site_line: number;          // 0-indexed call site line
  reason: OutOfScopeReason;        // Why the symbol is out of scope
}

export interface ResolvedScope {
  chain: ScopeChainEntry[];        // Ordered from current to root
  symbols: SymbolTable;            // Merged symbols respecting shadowing
  out_of_scope_symbols: OutOfScopeSymbol[];  // Symbols filtered by call site
  diagnostics: DirectiveDiagnostic[];
  has_directives: boolean;         // True if current file has directive comments (regardless of resolution)
  has_auto_parents: boolean;       // True if auto-discovered (not explicit directive) parents were used
  /**
   * Snapshot of `dependency_graph.is_scan_complete()` taken at the
   * same moment as `has_auto_parents`. Diagnostic deferral must use
   * THIS value, not a fresh `is_scan_complete()` read at publication
   * time — otherwise a scan that completes between
   * `get_effective_backward_directives` and the deferral check can
   * make the LSP publish an undefined-symbol warning that gets cleared
   * a moment later by the next re-validation. The user perceives that
   * as a red-squiggly flicker. `undefined` means the resolver had no
   * dependency graph attached (legacy/test path).
   */
  scan_complete_at_resolve_time?: boolean;
  inherited_working_directory?: string;  // Working directory inherited from parent files (if any)
  forward_call_symbols?: ForwardCallSite[];  // Symbols from current file's forward calls with visibility info
}

export interface ScopeResolverConfig {
  assume_call_site: 'end' | 'start';
  backward_dependencies?: 'auto' | 'explicit';  // Auto-discover parents or explicit directives only
  max_backward_depth: number;      // Limit backward directive chain depth (@lsp-done-by, @lsp-included-by)
  max_forward_depth: number;       // Limit forward-call recursion depth (do/run/include commands)
  max_chain_depth: number;         // Overall limit for combined forward + backward resolution
  diagnostics?: {
    max_depth?: 'error' | 'warning' | 'information' | 'off';
    // Severity for call site identification diagnostics
    call_site_identification?: 'error' | 'warning' | 'information' | 'off';
    // Severity for case-only path mismatch diagnostics in backward
    // directives; 'auto' resolves at emission time via
    // host_is_case_sensitive().
    case_mismatch?: CrossFileCaseMismatchSeverity;
  };
}

export interface ScopeCacheEntry {
  resolved_scope: ResolvedScope;
  content_hash: string;
  timestamp: number;
  // URIs that this resolved scope depends on (including the root file itself).
  dependent_uris: Set<string>;
}

export interface ScopeCacheMetrics {
  // Nested counters for scope and file caches
  scope: { hits: number; misses: number; invalidations: number };
  file: { hits: number; misses: number; invalidations: number };

  // Top-level aliases for backward compatibility (implemented as getters in actual object)
  readonly hits: number;         // alias for scope.hits
  readonly misses: number;       // alias for scope.misses
  readonly invalidations: number; // alias for scope.invalidations
}

export type CrossFileCaseMismatchSeverity =
    'auto' | 'error' | 'warning' | 'information' | 'off';

export interface CrossFileConfig {
  index_workspace: boolean;
  max_indexed_files: number;
  assume_call_site: 'end' | 'start';
  backward_dependencies: 'auto' | 'explicit';  // Auto-discover parents from workspace scan vs explicit directives only
  max_backward_depth: number;      // Limit backward directive chain depth
  max_forward_depth: number;       // Limit forward-call recursion depth
  max_chain_depth: number;         // Overall limit for combined resolution
  max_callee_revalidations?: number;  // Maximum callees to revalidate per caller change (default: 10)
  diagnostics: {
    missing_file: 'error' | 'warning' | 'information' | 'off';
    max_depth: 'error' | 'warning' | 'information' | 'off';
    // Severity for call site identification diagnostics
    call_site_identification?: 'error' | 'warning' | 'information' | 'off';
    // Severity for case-mismatch diagnostics; 'auto' means the server chooses
    case_mismatch?: CrossFileCaseMismatchSeverity;
  };
}

// Reverse Dependency Tracking Types (for callee revalidation)

export interface CallEdge {
  call_type: 'do' | 'run' | 'include';
  call_site_line: number;  // 0-indexed
}

/**
 * Stable hash of the symbols exported by a file.
 * Used to skip re-validating callees if the interface hasn't changed.
 */
export type InterfaceHash = string;

/**
 * Dual interface hashes for a file.
 * do_hash: excludes local macros (for do/run callees)
 * include_hash: includes local macros (for include callees)
 */
export interface DualInterfaceHash {
  do_hash: InterfaceHash;
  include_hash: InterfaceHash;
}

export interface ReverseDependencyIndex {
  // Map from caller URI to (callee URI → array of call edges)
  caller_to_callees: Map<string, Map<string, CallEdge[]>>;

  // Reverse lookup: callee URI → set of caller URIs
  callee_to_callers: Map<string, Set<string>>;

  // Cache of the last known interface hashes for each file (dual hashing)
  interface_hashes: Map<string, DualInterfaceHash>;

  // Cache of the last known forward calls for each caller URI, paired with
  // the resolved callee URI computed at registration time (while the callee
  // file still exists on disk). The stored URI is used during deletion
  // cleanup so we do NOT re-resolve from the filesystem after the file is
  // gone (which would produce the wrong-cased URI and leave a stale entry).
  last_forward_calls: Map<string, Array<{
    call: ForwardCall;
    resolved_uri: string;
  }>>;
}

export interface CallEdgeDiff {
  added: Map<string, CallEdge[]>;    // New callees
  removed: Map<string, CallEdge[]>;  // Removed callees
  modified: Map<string, {
    old_edges: CallEdge[];
    new_edges: CallEdge[];
  }>;  // Callees with changed edges
}

// Completion Ranking Types
export interface CompletionRankingFactors {
  scope_depth: number;
  directive_type: 'done-by' | 'included-by' | 'current' | 'out-of-scope';
  symbol_type: 'builtin' | 'user-program' | 'program-argument' | 'local-macro' | 'global-macro' | 'variable' | 'scalar' | 'matrix';
  alphabetical_order: string;
  parent_uri?: string;
  command_priority?: 1 | 2 | 3;  // Priority tier for built-in commands
}

// Logger interface for ScopeResolver
export interface ScopeResolverLogger {
  log(message: string): void;
  warn(message: string): void;
}
// Forward Scope Resolution Types

export type ForwardCallType = 'do' | 'run' | 'include';
export type EffectiveCallType = 'do' | 'include';

export interface ForwardCallDirective {
  type: ForwardCallType;
  raw_path: string;       // Original path from directive
  call_site_line: number; // Line where directive appears (0-indexed)
  call_site?: CallSite;   // Optional call site specification (line=N or match="string")
  range: Range;
}

export interface ForwardCall {
  type: ForwardCallType;
  raw_path: string;       // Original path from command/directive
  call_site_line: number; // Line where call occurs (0-indexed)
  range: Range;
  source: 'directive' | 'command';
  is_static: boolean;     // false if path contains macro references
  // Resolution context: populated by every producer so downstream consumers
  // can replay the join (raw_path + caller dir + working_directory) uniformly.
  caller_uri?: string;         // URI of the file that contains the call
  working_directory?: string;  // Effective WD at the call site; undefined means
                               // script-relative (the raw_path join base is the
                               // caller file's own directory).
}

/**
 * A top-level Stata `cd` command recognized by the analyzer (issue #252).
 *
 * Only literal, unprefixed `cd` statements at the top level of a file are
 * recorded; `capture cd`, macro-interpolated paths, bare `cd` (no argument),
 * and `cd` inside loops/programs/branches are NOT recorded (they must not
 * poison the effective working-directory timeline).
 *
 * The analyzer performs NO path resolution: it only records the raw path and
 * the command's range. The shared `build_cd_timeline` helper
 * (`src/utils/file-path-utils.ts`) resolves these against the filesystem in
 * source (position) order to produce the line-sensitive working directory used
 * to re-stamp each `ForwardCall.working_directory`.
 */
export interface CdCommand {
  raw_path: string;       // Path exactly as written (quotes already stripped)
  range: Range;           // Command range; range.start orders the cd timeline
  is_static: boolean;     // false if raw_path contains a macro reference
}

export interface ForwardResolveContext {
  visited: Map<string, EffectiveCallType>;
  effective_call_type: EffectiveCallType;
  depth: number;
  diagnostics: DirectiveDiagnostic[];
  working_directory?: string;  // Inherited working directory for path resolution
  /**
   * Top-level `cd` commands of the file being resolved in THIS frame
   * (issue #252). The resolver builds a working-directory timeline from
   * `working_directory` (the call-site WD) + these commands, so each forward
   * call resolves against the WD active at its position. Each recursion level
   * carries the callee's own cd_commands.
   */
  cd_commands?: CdCommand[];
  call_chain?: string[];       // Call chain for diagnostic messages
  /**
   * URI of the file whose diagnostics are being collected in this
   * resolution pass. Only path_case_mismatch diagnostics for forward
   * calls written directly in this file (current_file_uri ===
   * diagnostic_owner_uri && depth === 0) are emitted. Nested callee
   * resolution and ancestor-scope builds resolve leniently but suppress
   * the diagnostic to avoid cascade / double-emit.
   */
  diagnostic_owner_uri?: string;
  /**
   * Range of the depth-0 forward call in the diagnostic-owner file that began
   * this resolution. Set once, on the first recursion into an owner-rooted
   * call, and propagated unchanged. Used to anchor NESTED cap-truncation
   * diagnostics (#209) to the owner file's actual call site — otherwise a
   * nested call's line (in a callee file) would be reported against the owner
   * file, since the backward-directive remap does not run for a root file with
   * no directives. Undefined for ancestor-scope builds (no owner).
   */
  root_call_range?: Range;
}

export interface ForwardCallSite {
  callee_uri: string;
  call_line: number;        // 0-indexed line in caller
  symbols: SymbolTable;
  effective_type: EffectiveCallType;
  // Effective end-of-execution top-level local macros of the callee,
  // computed as the include-only end state of the callee's sub-chain.
  // Populated ONLY on direct-child `do`/`run` sites (calls made from the
  // file being resolved whose original type is `do`/`run`). A blame entry
  // represents "if this one call were promoted to `include`, the
  // referenced local would be bound here" — so the diagnostic can point
  // at the file whose `local` statement actually wins under that one-line
  // fix. Nested sites flattened from a deeper `resolve()` always arrive
  // with `excluded_locals: undefined`; their blame would correspond to a
  // different boundary promotion than the one the outer diagnostic's
  // message suggests.
  excluded_locals?: Map<string, MacroSymbol>;
}

export interface ForwardResolvedScope {
  symbols: SymbolTable;
  call_sites: ForwardCallSite[];
  diagnostics: DirectiveDiagnostic[];
}

/**
 * Interface for providing file content to ScopeResolver.
 * Allows abstraction of file system access, enabling reading from memory buffers (DocumentStore).
 */
export interface ContentProvider {
  read_file(uri: string): Promise<string>;
  exists(uri: string): Promise<boolean>;
  stat?(uri: string): Promise<{ mtimeMs: number; size: number } | undefined>;
}

export type DuplicateCallDecision =
  | { action: 'skip' }
  | { action: 'process' }
  | { action: 'add_locals_only' }
  // Previously-visited callee is being invoked again via `do`/`run`.
  // Symbol accumulation is unchanged (do/run don't propagate locals), but
  // this is still a distinct root-level boundary: the second `do`/`run`
  // can be promoted to `include` independently of the first, and that
  // promotion may expose a different file's `local X` than the first
  // visit's callee would. Emit a barrier-only site so the diagnostic
  // rewrite can blame the second boundary under last-visible-site
  // precedence. Note: `resolve()` gates the meaningful handling of this
  // variant to `depth === 0`; nested-depth occurrences are short-
  // circuited because the flattening loop strips `excluded_locals` on
  // bubbled-up nested sites.
  | { action: 'boundary_only' };
