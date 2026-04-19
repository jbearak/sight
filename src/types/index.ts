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
  UNCLOSED_MATA_BLOCK = 4001,
  UNCLOSED_PYTHON_BLOCK = 4002,
  UNEXPECTED_END = 4003,
  UNEXPECTED_END_COMMAND = 4004,
  MISMATCHED_END_PYTHON = 4005,
  NESTED_BLOCK_ERROR = 4006,
  INVALID_DELIMITER_POSITION = 4007,
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

export interface LexerError {
  message: string;
  range: Range;
  code: LexerErrorCode;
}

export enum LexerErrorCode {
  UNBALANCED_QUOTES = 1001,
  UNBALANCED_BLOCK_COMMENT = 1002,
  UNTERMINATED_STATEMENT = 1003,
  CONTINUATION_NO_SPACE = 1004,
  BLOCK_COMMENT_IN_STAR_COMMENT = 1005,
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
  SYNTAX_ERROR = 3000,
  BRACE_ELSE_SAME_LINE = 3001,
  BRACE_NOT_ALONE = 3002,
  MISSING_PROGRAM_END = 3003,
  OPEN_BRACE_ALONE = 3004,
  UNCLOSED_BLOCK = 3005,
  CODE_AFTER_OPEN_BRACE = 3006,
  FORVALUES_SYNTAX = 3008,
  REDUNDANT_MACRO_SUFFIX = 3009,
  MISSING_EXPRESSION_AFTER_EQUALS = 3010,
  UNBALANCED_PARENTHESES = 3011,
  ORPHAN_CLOSE_BRACE = 3012,
  STRAY_TOKEN_IN_CONDITION = 3013,
  SPLIT_LITERAL_IN_CONDITION = 3014,
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
  containingScope?: ScopeType;
  extendedFunction?: ExtendedMacroFunction;
  definition_index?: number;  // Preorder index where macro was defined
  definition_line?: number;   // Line number where macro was first defined
  additional_definitions?: Array<{ index: number, line: number, location: { uri: string; range: Range } }>;
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
  UNBALANCED_QUOTES = 1001,
  UNBALANCED_BLOCK_COMMENT = 1002,
  UNTERMINATED_STATEMENT = 1003,
  CONTINUATION_NO_SPACE = 1004,
  BLOCK_COMMENT_IN_STAR_COMMENT = 1005,

  // Semantic errors
  UNDEFINED_MACRO = 2001,
  UNDEFINED_VARIABLE = 2002,
  OUT_OF_SCOPE_SYMBOL = 2003,

  // Parser errors
  SYNTAX_ERROR = 3000,
  BRACE_ELSE_SAME_LINE = 3001,
  BRACE_NOT_ALONE = 3002,
  MISSING_PROGRAM_END = 3003,
  OPEN_BRACE_ALONE = 3004,
  UNCLOSED_BLOCK = 3005,
  CODE_AFTER_OPEN_BRACE = 3006,
  FORVALUES_SYNTAX = 3008,
  REDUNDANT_MACRO_SUFFIX = 3009,
  INVALID_MACRO_CHAR = 3010,

  // Indentation errors
  UNNECESSARY_INDENTATION = 5001,
  MISSING_INDENTATION = 5002,

  // Malformed operator diagnostics
  MALFORMED_OPERATOR = 6001,
  INVALID_OPERATOR_SEQUENCE = 6002,
  CSTYLE_LOGICAL_IN_CONTROL_FLOW = 6003,
  MIXED_LOGICAL_OPERATORS = 6004,
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
      invalidOperatorSequence: 'error' | 'warning' | 'information' | 'hint' | 'off';
      cStyleLogicalInControlFlow: 'error' | 'warning' | 'information' | 'hint' | 'off';
      mixedLogicalOperators: 'error' | 'warning' | 'information' | 'hint' | 'off';
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
    out_of_scope: 'error' | 'warning' | 'information' | 'off';
    missing_file: 'error' | 'warning' | 'information' | 'off';
    max_depth: 'error' | 'warning' | 'information' | 'off';
    // Severity for call site identification diagnostics
    call_site_identification?: 'error' | 'warning' | 'information' | 'off';
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

  // Forward call specific bidirectional tracking
  // Maps caller_uri -> Set<callee_uri> for forward calls specifically
  // This enables O(M) cleanup where M = number of callees for a file
  forward_caller_to_callees: Map<string, Set<string>>;

  // Cache of the last known interface hashes for each file (dual hashing)
  interface_hashes: Map<string, DualInterfaceHash>;

  // Cache of the last known forward calls for each caller URI
  // Used to compute diffs when update_reverse_dependencies is called
  last_forward_calls: Map<string, ForwardCall[]>;
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
  directive_type: 'done-by' | 'included-by' | 'current';
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
  path: string;           // Resolved absolute path
  raw_path: string;       // Original path from directive
  call_site_line: number; // Line where directive appears (0-indexed)
  call_site?: CallSite;   // Optional call site specification (line=N or match="string")
  range: Range;
}

export interface ForwardCall {
  type: ForwardCallType;
  path: string;           // Resolved absolute path (or empty if macro)
  raw_path: string;       // Original path from command/directive
  call_site_line: number; // Line where call occurs (0-indexed)
  range: Range;
  source: 'directive' | 'command';
  is_static: boolean;     // false if path contains macro references
}

export interface ForwardResolveContext {
  visited: Map<string, EffectiveCallType>;
  effective_call_type: EffectiveCallType;
  depth: number;
  diagnostics: DirectiveDiagnostic[];
  working_directory?: string;  // Inherited working directory for path resolution
  call_chain?: string[];       // Call chain for diagnostic messages (e.g., ["parent.do", "child.do"])
}

export interface ForwardCallSite {
  callee_uri: string;
  call_line: number;        // 0-indexed line in caller
  symbols: SymbolTable;
  effective_type: EffectiveCallType;
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
  | { action: 'add_locals_only' };
