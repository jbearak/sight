import { Range } from 'vscode-languageserver-textdocument';
import {
    format_undefined_macro_message,
    format_undefined_variable_message,
} from '../utils/undefined-symbol-diagnostic';
import {
    StataAST,
    StataNode,
    SymbolTable,
    ProgramSymbol,
    MacroSymbol,
    VariableSymbol,
    ScopeInfo,
    CommandNode,
    ProgramNode,
    MacroDefNode,
    ControlFlowNode,
    TriviaNode,
    StataDiagnosticCode,
    Token,
    TokenType,
    ScopeType,
    SyntaxNode,
    ArgumentSpec,
    OptionSpec,
    ProgramSignature,
    ForwardCall,
    CdCommand,
    IdentifierNode,
} from '../types';
import { DirectiveParser } from '../directive-parser';
import {
    build_static_value_env,
    resolve_loop_value_set,
    expand_loop_body,
    scan_macro_refs,
    BindingFrame,
} from './loop-expander';
import { find_macro_creating_command, matches_option } from './macro-creating-commands';
import { parse_option_argument, is_valid_identifier } from './option-argument-parser';
import {
    DECLARATION_DIRECTIVE_PATTERN,
    VARIABLES_DIRECTIVE_PATTERN,
    has_ignore_directive,
    has_ignore_next_directive,
} from '../utils/directives';

// Diagnostic interface for semantic errors
export interface SemanticDiagnostic {
    message: string;
    range: Range;
    code: StataDiagnosticCode;
    severity: 'error' | 'warning' | 'information' | 'hint';
    // Structured carriers for downstream logic so it never parses message prose
    // to recover the referenced symbol. Populated for UNDEFINED_MACRO /
    // UNDEFINED_VARIABLE diagnostics. See docs/superpowers/specs/
    // 2026-06-26-diagnostic-message-code-deduplication.md.
    symbol_name?: string;
    reference_kind?: 'local' | 'global' | 'variable';
}

// Analysis result returned by the semantic analyzer
export interface AnalysisResult {
    symbols: SymbolTable;
    diagnostics: SemanticDiagnostic[];
    scopes: ScopeInfo[];
    forward_calls: ForwardCall[];
    // Top-level literal `cd` commands in source order (issue #252). Consumers
    // resolve these via `build_cd_timeline` to derive the line-sensitive
    // working directory for re-stamping forward calls.
    cd_commands: CdCommand[];
    ignored_lines: Set<number>;
}

// Configuration for semantic analysis
export interface AnalyzerConfig {
    undefined_macro_enabled: boolean;
    undefined_variable_enabled: boolean;
    // Variables declared via @lsp-variables directive, with the
    // line the directive appears on (forward-only, like the other
    // declaration maps).
    declared_variables: Map<string, { line: number }>;
    // Lines to ignore via @lsp-ignore-next directive
    ignored_lines: Set<number>;
    // Symbols declared via @lsp-local, @lsp-global, @lsp-scalar, @lsp-matrix, @lsp-program directives
    declared_locals: Map<string, { line: number }>;
    declared_globals: Map<string, { line: number }>;
    declared_scalars: Map<string, { line: number }>;
    declared_matrices: Map<string, { line: number }>;
    declared_programs: Map<string, { line: number }>;
    // Working directory for resolving paths in do/run/include commands
    // (from @lsp-working-directory directive). Still stamped onto each
    // ForwardCall as resolution context; the analyzer no longer resolves
    // paths itself (see detect_forward_call).
    working_directory?: string;
}

/**
 * Create a fresh AnalyzerConfig initialized with the analyzer's default settings.
 *
 * @returns An AnalyzerConfig with undefined-macro checking enabled, undefined-variable checking disabled, and all declaration/ignore collections initialized empty (new Set/Map instances).
 */
function create_default_config(): AnalyzerConfig {
    return {
        undefined_macro_enabled: true,
        undefined_variable_enabled: false, // Off by default per requirements
        declared_variables: new Map(),
        ignored_lines: new Set(),
        declared_locals: new Map(),
        declared_globals: new Map(),
        declared_scalars: new Map(),
        declared_matrices: new Map(),
        declared_programs: new Map(),
    };
}

/**
 * Stata system-defined global macros.
 * These are automatically set by Stata at runtime and should never
 * be flagged as undefined. Case-sensitive (Stata is case-sensitive).
 * 
 * Reference: Stata documentation on system macros
 * Note: These are legacy macros replaced by c() class results but
 * still widely used for backward compatibility.
 */
export const STATA_SYSTEM_GLOBALS = new Set<string>([
    // Date and time
    'S_DATE',      // Current date (format: "dd Mon yyyy")
    'S_TIME',      // Current time (format: "hh:mm:ss")
    
    // File information
    'S_FN',        // Current filename (name of file in memory)
    'S_FNDATE',    // Date/time when current file was last saved
    
    // System information
    'S_ADO',       // ado-path
    'S_FLAVOR',    // Stata flavor (Small, IC, SE, MP)
    'S_OS',        // Operating system
    'S_MACH',      // Machine type
    'S_OSDTL',     // OS details
    'S_LEVEL',     // Confidence level (default 95)
    
    // Edition indicators
    'S_StataSE',   // Stata SE edition indicator
    'S_StataMP',   // Stata MP edition indicator
    'S_StataIC',   // Stata IC edition indicator
    
    // Mode indicators
    'S_CONSOLE',   // Console mode indicator
    'S_MODE',      // Stata mode
]);

/**
 * Semantic Analyzer for Stata code.
 * 
 * Builds symbol tables and detects semantic issues like undefined macro references.
 * 
 * Scoping rules:
 * - Global macros ($name or ${name}) are visible everywhere
 * - Local macros (`name') are scoped to the containing do-file or program definition
 * - Loop variables (foreach/forvalues) are locals with lifetime matching enclosing scope
 * - Programs are case-sensitive
 * - Macros and variables are case-sensitive
 */
// Weight argument types constant
const WEIGHT_TYPES = ['weight', 'fweight', 'fw', 'aweight', 'aw', 'pweight', 'pw', 'iweight', 'iw'] as const;

// Per Stata `help data_types`. Storage types are case-sensitive.
// `double` may be abbreviated to `dou`, `doub`, `doubl`; `float` to `floa`.
// `byte`, `int`, `long`, and `strL` have no shorter forms. Bare `str` is not
// a valid storage type — only `str1`..`str2045` and `strL`.
const STATA_STORAGE_TYPES = new Set([
    'byte', 'int', 'long',
    'float', 'floa',
    'double', 'doubl', 'doub', 'dou',
    'strL',
]);

const STR_WIDTH_RE = /^str\d+$/;

// A Mata setter's name argument must be a literal double-quoted identifier.
// Hoisted to module level: matched once per `st_local`/`st_global` token in
// the setter scan loop.
const MATA_STRING_NAME_RE = /^"([A-Za-z_][A-Za-z0-9_]*)"$/;

// Identifier words in a Mata function-definition header. Global flag; consumed
// only via `String.prototype.match`, which resets `lastIndex` on each call, so
// the shared instance is safe. Hoisted: consulted once per Mata `{`.
const MATA_HEADER_WORD_RE = /[A-Za-z_][A-Za-z0-9_]*/g;

// Mata control-flow keywords that can precede a `(` ... `)` header before a
// `{` but are NOT function definitions (so their bodies are executed, not
// skipped). Module-level: fixed content, consulted once per Mata `{`.
const MATA_CONTROL_WORDS = new Set([
    'if',
    'else',
    'for',
    'while',
    'do',
    'switch',
    'try',
    'catch',
]);

// Pure trivia (whitespace/comments) — skipped everywhere, but NOT a `///`
// CONTINUATION, which some sites must detect or handle specially rather than
// silently skip. Module-level: fixed content, consulted per token.
const MATA_TRIVIA_TOKENS: Set<TokenType> = new Set([
    'WHITESPACE',
    'COMMENT_LINE',
    'COMMENT_BLOCK',
]);

// Token types skipped when walking to the next/previous significant token in
// the Mata setter scan — trivia plus the `///` continuation marker.
const MATA_SCAN_SKIP_TOKENS: Set<TokenType> = new Set([
    ...MATA_TRIVIA_TOKENS,
    'CONTINUATION',
]);

// Mata return-type / declaration keywords. A header whose pre-`(` words
// include one of these (plus a trailing name) looks like a function
// definition, whose body must be skipped by the setter scan. Module-level:
// fixed content, consulted once per Mata `{`.
const MATA_DECLARATION_WORDS = new Set([
    'function',
    'void',
    'real',
    'complex',
    'numeric',
    'string',
    'transmorphic',
    'pointer',
    'class',
    'struct',
    'scalar',
    'vector',
    'rowvector',
    'colvector',
    'matrix',
]);

function is_stata_storage_type(name: string): boolean {
    if (STATA_STORAGE_TYPES.has(name)) return true;
    // str1..str2045
    if (STR_WIDTH_RE.test(name)) {
        const num = parseInt(name.slice(3), 10);
        return num >= 1 && num <= 2045;
    }
    return false;
}

export class SemanticAnalyzer {
    private uri: string = '';
    private config: AnalyzerConfig = create_default_config();
    private preorder_index: number = 0;
    private directive_parser = new DirectiveParser();
    private forward_calls: ForwardCall[] = [];
    // Top-level literal `cd` commands recorded in source order (issue #252).
    private cd_commands: CdCommand[] = [];
    // Nesting depth for the symbol-building walk. Incremented around recursion
    // into program/loop/control-flow bodies. Only `cd` commands at depth 0 are
    // recorded; `do`/`run`/`include` detection is intentionally NOT gated by
    // this (its behavior must stay unchanged at every nesting level).
    private cd_nesting_depth: number = 0;
    private workspace_symbols?: SymbolTable;
    private tokens?: Token[];
    private current_diagnostics: SemanticDiagnostic[] = [];
    // Active loop iterator frames (innermost last). Source of cartesian
    // bindings for loop-expanded macro names.
    private loop_frames: BindingFrame[] = [];

    // Depth of enclosing bodies that are NOT guaranteed to execute: `if`/
    // `else`/`while` blocks, and dynamic or empty-value-set loops. While this
    // is > 0, loop-macro expansion is suppressed — a constructed name inside a
    // block that may never run must not be injected, or it would falsely
    // suppress a legitimate undefined-macro warning after the block.
    private nonexec_depth = 0;

    /**
     * Analyze an AST and build symbol tables.
     * 
     * @param ast - The parsed AST
     * @param uri - The document URI
     * @param workspace_symbols - Optional workspace symbols for cross-file lookups
     * @param config - Optional configuration overrides
     * @param tokens - Optional token stream for macro reference detection
     */
    analyze(
        ast: StataAST,
        uri: string,
        workspace_symbols?: SymbolTable,
        config?: Partial<AnalyzerConfig>,
        tokens?: Token[]
    ): AnalysisResult {
        this.preorder_index = 0;
        this.uri = uri;
        this.config = { ...create_default_config(), ...config };
        this.forward_calls = []; // Reset forward calls
        this.cd_commands = []; // Reset cd commands (issue #252)
        this.cd_nesting_depth = 0;
        this.loop_frames = []; // Reset loop iterator frames
        this.nonexec_depth = 0; // Reset non-executing-context depth
        this.workspace_symbols = workspace_symbols; // Store workspace symbols
        this.tokens = tokens; // Keep tokens for command-level pattern checks

        // Initialize symbol table
        const symbols: SymbolTable = create_empty_symbol_table();

        const diagnostics: SemanticDiagnostic[] = [];
        this.current_diagnostics = diagnostics;
        const scopes: ScopeInfo[] = [];

        // Create the top-level do-file scope
        const dofile_scope: ScopeInfo = {
            type: 'dofile',
            range: this.get_full_range(ast),
            localMacros: new Map(),
        };
        scopes.push(dofile_scope);

        // First pass: extract comment directives
        this.extract_comment_directives(ast);
        
        // Also extract directives from tokens if provided
        // Pass symbols so declaration directives can register symbols
        if (tokens) {
            this.extract_comment_directives_from_tokens(tokens, symbols);
        }

        // Second pass: build symbol table
        this.build_symbols(ast.nodes, symbols, dofile_scope, scopes);

        // Recognize `st_local`/`st_global` setter calls inside Mata blocks as
        // macro definitions. Runs after `build_symbols`, but registration still
        // compares source positions so first-definition-wins precedence is
        // preserved when a Mata setter appears before a later Stata definition.
        // Runs before reference detection so declared macros suppress
        // undefined-macro warnings at/after their call site. Gated only on
        // `tokens` (not on undefined_macro_enabled) so the declarations also
        // feed completion.
        if (tokens) {
            this.extract_mata_st_local_declarations(tokens, symbols, ast.nodes);
        }

        // Third pass: detect undefined references
        if (this.config.undefined_macro_enabled || this.config.undefined_variable_enabled) {
            // Reset preorder_index for reference pass (must match build_symbols traversal)
            this.preorder_index = 0;
            // Track ranges reported by AST pass to avoid duplicates in token pass
            const reported_ranges = new Set<string>();
            this.detect_undefined_references(ast.nodes, symbols, diagnostics, reported_ranges);
            
            // Also check tokens for macro references if provided
            if (tokens && this.config.undefined_macro_enabled) {
                const program_ranges = this.collect_program_ranges(ast.nodes);
                this.check_token_macro_references(tokens, symbols, diagnostics, reported_ranges, program_ranges);
            }
        }

        // Clear per-analyze state at end
        this.workspace_symbols = undefined;
        this.tokens = undefined;
        this.current_diagnostics = [];

        return {
            symbols,
            diagnostics,
            scopes,
            forward_calls: this.forward_calls,
            cd_commands: this.cd_commands,
            ignored_lines: this.config.ignored_lines,
        };
    }

    /**
     * Extract comment directives from trivia nodes.
     * Handles @lsp-ignore-next and @lsp-variables directives.
     */
    private extract_comment_directives(ast: StataAST): void {
        for (const node of ast.nodes) {
            this.extract_directives_from_node(node);
        }
    }

    /**
     * Extract comment directives from tokens.
     * This catches directives in standalone comments not attached to AST nodes.
     * Also processes declaration directives (@lsp-local, @lsp-global, @lsp-scalar, @lsp-matrix, @lsp-program).
     */
    extract_comment_directives_from_tokens(tokens: Token[], symbols?: SymbolTable): void {
        // Parse declaration directives directly from comment tokens
        // This avoids issues with multi-line block comments causing line number mismatches
        this.parse_declaration_directives_from_tokens(tokens, symbols);
        
        // Process other directives. `ignore` and variable
        // declarations may appear in trailing `//` comments.
        for (let i = 0; i < tokens.length; i++) {
            const token = tokens[i];

            if (token.type === 'COMMENT_LINE') {
                const token_content = token.value.trim();
                const is_standalone_comment = this.is_standalone_comment_token(tokens, i);

                if (has_ignore_directive(token_content)) {
                    if (is_standalone_comment) {
                        this.ignore_next_non_trivia_line(tokens, i);
                    } else {
                        this.config.ignored_lines.add(token.range.start.line);
                    }
                }
                if (has_ignore_next_directive(token_content)) {
                    this.ignore_next_non_trivia_line(tokens, i);
                }

                // Check for @lsp-variables / @lsp-var directive
                const variables_match = token_content.match(VARIABLES_DIRECTIVE_PATTERN);
                if (variables_match) {
                    const the_var_names = this.parse_identifier_list(
                        variables_match[1]
                    );
                    for (const my_var_name of the_var_names) {
                        this.register_declared_variable(
                            my_var_name,
                            token.range.start.line
                        );
                    }
                }
            }
        }
    }

    /**
     * Record a variable declared via `@lsp-variables` /
     * `sight: variables`, keeping the earliest directive line so the
     * declaration is forward-only (effective on that line and after),
     * consistent with the other declaration directives. References on
     * earlier lines still warn.
     */
    private register_declared_variable(name: string, line: number): void {
        const existing = this.config.declared_variables.get(name);
        if (existing === undefined || line < existing.line) {
            this.config.declared_variables.set(name, { line });
        }
    }

    /**
     * Split a directive's raw argument string into declared
     * identifiers, dropping blanks and any token that is not a valid
     * Stata identifier. The identifier check guards against artifacts
     * such as the terminating `;` that `#delimit ;` mode lexes into a
     * trailing `*` comment (e.g. `* sight: local foo ;` would otherwise
     * register a bogus symbol named `;`). Shared by the variable and
     * declaration directive paths so the parse contract lives in one
     * place.
     */
    private parse_identifier_list(raw: string): string[] {
        return raw
            .split(/\s+/)
            .filter(name => name.length > 0 && is_valid_identifier(name));
    }

    private ignore_next_non_trivia_line(tokens: Token[], directive_index: number): void {
        for (let j = directive_index + 1; j < tokens.length; j++) {
            const next_token = tokens[j];
            if (next_token.type !== 'WHITESPACE' &&
                next_token.type !== 'COMMENT_LINE' &&
                next_token.type !== 'COMMENT_BLOCK' &&
                next_token.type !== 'CONTINUATION' &&
                next_token.type !== 'STATEMENT_TERMINATOR') {
                this.config.ignored_lines.add(next_token.range.start.line);
                break;
            }
        }
    }

    /**
     * Parse declaration directives directly from comment tokens.
     * This method processes @lsp-local, @lsp-global, @lsp-scalar, @lsp-matrix, @lsp-program
     * directives directly from tokens, preserving accurate line numbers.
     * 
     * This fixes a bug where multi-line block comments would cause line number mismatches
     * when reconstructing content for the directive parser.
     */
    private parse_declaration_directives_from_tokens(tokens: Token[], symbols?: SymbolTable): void {
        for (let i = 0; i < tokens.length; i++) {
            const token = tokens[i];
            // Declaration directives live in real line comments and are
            // honored whether standalone or trailing code on the same
            // line: the pattern is anchored to the comment token's own
            // text, which begins at `//` or `*`. The lexer may treat
            // a mid-line `*` as a comment (e.g. after a string or
            // `;`), so such a directive is honored too. `/* ... */`
            // block comments do not carry directives (see
            // docs/declaration-directives.md): they lex as a single
            // COMMENT_BLOCK token, never COMMENT_LINE, so a
            // directive-looking line nested inside one stays inert.
            if (token.type !== 'COMMENT_LINE') {
                continue;
            }

            const my_match = token.value.match(DECLARATION_DIRECTIVE_PATTERN);
            if (my_match) {
                const my_type = my_match[1] as 'local' | 'global' | 'scalar' | 'matrix' | 'program';
                const the_names = this.parse_identifier_list(my_match[2]);
                // Declarations are intentionally line-scoped, not
                // character-scoped. A trailing `// sight: local x`
                // applies to the whole physical line as well as
                // following lines.
                const my_actual_line = token.range.start.line;
                for (const my_name of the_names) {
                    this.register_declaration_directive(my_type, my_name, my_actual_line, symbols);
                }
            }
        }
    }

    /**
     * Register a declaration directive in the config maps and optionally in the symbol table.
     */
    private register_declaration_directive(
        type: 'local' | 'global' | 'scalar' | 'matrix' | 'program',
        name: string,
        line: number,
        symbols?: SymbolTable
    ): void {
        const my_range: Range = {
            start: { line, character: 0 },
            end: { line, character: 0 },
        };
        
        switch (type) {
            case 'local':
                this.config.declared_locals.set(name, { line });
                if (symbols) {
                    const macro_symbol: MacroSymbol = {
                        name,
                        scope: 'local',
                        location: { uri: this.uri, range: my_range },
                        sourceUri: this.uri,
                        containingScope: 'dofile',
                        definition_line: line,
                    };
                    symbols.localMacros.set(name, macro_symbol);
                }
                break;
                
            case 'global':
                this.config.declared_globals.set(name, { line });
                if (symbols) {
                    const macro_symbol: MacroSymbol = {
                        name,
                        scope: 'global',
                        location: { uri: this.uri, range: my_range },
                        sourceUri: this.uri,
                        containingScope: 'dofile',
                        definition_line: line,
                    };
                    symbols.globalMacros.set(name, macro_symbol);
                }
                break;
                
            case 'scalar':
                this.config.declared_scalars.set(name, { line });
                if (symbols) {
                    // node_index is not available in directive context;
                    // use 0 as approximation (directive declarations are
                    // rare and not the primary definition site).
                    this.add_or_append_definition(
                        symbols.scalars,
                        name,
                        0,
                        my_range,
                        () => ({
                            name,
                            location: { uri: this.uri, range: my_range },
                            sourceUri: this.uri,
                            definition_line: line,
                        })
                    );
                }
                break;

            case 'matrix':
                this.config.declared_matrices.set(name, { line });
                if (symbols) {
                    // node_index is not available in directive context;
                    // use 0 as approximation (see scalar case above).
                    this.add_or_append_definition(
                        symbols.matrices,
                        name,
                        0,
                        my_range,
                        () => ({
                            name,
                            location: { uri: this.uri, range: my_range },
                            sourceUri: this.uri,
                            definition_line: line,
                        })
                    );
                }
                break;
                
            case 'program':
                this.config.declared_programs.set(name, { line });
                if (symbols) {
                    // node_index is not available in directive context;
                    // use 0 as approximation (matches scalar/matrix case).
                    this.add_or_append_definition(
                        symbols.programs,
                        name,
                        0,
                        my_range,
                        () => ({
                            name,
                            location: { uri: this.uri, range: my_range },
                            sourceUri: this.uri,
                        })
                    );
                }
                break;
        }
    }

    private extract_directives_from_node(node: StataNode): void {
        // Check leading trivia for directives
        if (this.has_trivia(node) && node.leadingTrivia) {
            for (const trivia of node.leadingTrivia) {
                this.parse_directive(trivia, node);
            }
        }

        // Recurse into nested nodes
        if (node.type === 'program') {
            for (const child of node.body) {
                this.extract_directives_from_node(child);
            }
        } else if (this.is_control_flow(node)) {
            for (const child of node.body) {
                this.extract_directives_from_node(child);
            }
        }
    }

    private parse_directive(trivia: TriviaNode, following_node: StataNode): void {
        const content = trivia.content.trim();

        // Standalone ignore directives target the following node.
        if (has_ignore_directive(content) || has_ignore_next_directive(content)) {
            // Ignore the line of the following node
            const line_to_ignore = following_node.range.start.line;
            this.config.ignored_lines.add(line_to_ignore);
        }

        // Check for @lsp-variables / @lsp-var directive
        const variables_match = content.match(VARIABLES_DIRECTIVE_PATTERN);
        if (variables_match) {
            const the_var_names = this.parse_identifier_list(
                variables_match[1]
            );
            for (const my_var_name of the_var_names) {
                this.register_declared_variable(
                    my_var_name,
                    trivia.range.start.line
                );
            }
        }
    }

    private is_standalone_comment_token(tokens: Token[], comment_index: number): boolean {
        const comment = tokens[comment_index];
        const line = comment.range.start.line;

        for (let i = comment_index - 1; i >= 0; i--) {
            const token = tokens[i];
            if (token.range.start.line !== line) {
                break;
            }
            if (token.type !== 'WHITESPACE') {
                return false;
            }
        }

        return true;
    }

    /**
     * Build symbol table by traversing AST nodes.
     */
    private build_symbols(
        nodes: StataNode[],
        symbols: SymbolTable,
        current_scope: ScopeInfo,
        all_scopes: ScopeInfo[]
    ): void {
        this.traverse_ast_preorder(nodes, (node, node_index) => {
            this.process_node(node, symbols, current_scope, all_scopes, node_index);
        });
    }

    /**
     * Build symbols for a nested body (program/loop/control-flow), tracking
     * nesting depth so that `detect_cd_command` records `cd` only at the top
     * level (issue #252). Forward-call detection is unaffected — it fires at
     * every depth, exactly as before.
     */
    private build_symbols_in_body(
        nodes: StataNode[],
        symbols: SymbolTable,
        current_scope: ScopeInfo,
        all_scopes: ScopeInfo[]
    ): void {
        this.cd_nesting_depth++;
        try {
            this.build_symbols(nodes, symbols, current_scope, all_scopes);
        } finally {
            this.cd_nesting_depth--;
        }
    }

    /**
     * Traverse AST nodes in preorder, calling callback for each node.
     * CRITICAL: Both symbol building and reference checking MUST use this method.
     * Note: Does NOT recurse into program/control_flow bodies - callers handle that
     * to maintain proper scope tracking.
     */
    private traverse_ast_preorder(
        nodes: StataNode[],
        callback: (node: StataNode, index: number) => void
    ): void {
        for (const node of nodes) {
            const node_index = this.preorder_index++;
            callback(node, node_index);
        }
    }

    private process_node(
        node: StataNode,
        symbols: SymbolTable,
        current_scope: ScopeInfo,
        all_scopes: ScopeInfo[],
        node_index: number
    ): void {
        switch (node.type) {
            case 'program':
                this.process_program(node, symbols, all_scopes, node_index);
                break;

            case 'macro_def':
                this.process_macro_def(node, symbols, current_scope, node_index);
                break;

            case 'command':
                this.process_command(node, symbols, current_scope, node_index);
                break;

            case 'syntax':
                this.analyze_syntax_node(node, symbols, current_scope, node_index);
                break;

            case 'foreach':
            case 'forvalues':
                this.process_loop(node, symbols, current_scope, all_scopes, node_index);
                break;

            case 'if':
            case 'else':
            case 'while':
            case 'frame':
                this.process_control_flow(node, symbols, current_scope, all_scopes);
                break;

            default:
                // Other node types don't contribute to symbol table
                break;
        }
    }

    /**
     * First-def-wins registration. Creates the primary entry on first call;
     * on subsequent calls, appends to `additional_definitions`.
     *
     * Returns the canonical symbol (primary) — useful when callers need to
     * mutate it further (e.g., attach c_locals to a program).
     */
    private add_or_append_definition<
        T extends {
            location: { uri: string; range: Range };
            additional_definitions?: Array<{
                index: number;
                line: number;
                location: { uri: string; range: Range };
            }>;
        }
    >(
        symbol_map: Map<string, T>,
        name: string,
        node_index: number,
        range: Range,
        create_primary: () => T
    ): T {
        const existing = symbol_map.get(name);
        if (existing) {
            if (!existing.additional_definitions) {
                existing.additional_definitions = [];
            }
            existing.additional_definitions.push({
                index: node_index,
                line: range.start.line,
                location: { uri: this.uri, range },
            });
            return existing;
        }
        const primary = create_primary();
        symbol_map.set(name, primary);
        return primary;
    }

    /**
     * Process a program definition.
     * Programs are case-sensitive.
     */
    private process_program(
        node: ProgramNode,
        symbols: SymbolTable,
        all_scopes: ScopeInfo[],
        node_index: number
    ): void {
        // Detect whether this is the first definition before registering
        const is_first_definition = !symbols.programs.has(node.name);

        const program_symbol: ProgramSymbol = this.add_or_append_definition(
            symbols.programs,
            node.name,
            node_index,
            node.range,
            (): ProgramSymbol => ({
                name: node.name,
                location: { uri: this.uri, range: node.range },
                sourceUri: this.uri,
            })
        );

        // Create a new scope for the program body — unconditional so that
        // each redeclaration's body gets its own scope for per-body diagnostics.
        const program_scope: ScopeInfo = {
            type: 'program',
            range: node.range,
            localMacros: new Map(),
        };
        all_scopes.push(program_scope);

        // Process program body with the new scope — unconditional for the
        // same reason: locals defined inside each body deserve diagnostic
        // coverage regardless of which definition is "primary".
        //
        // Isolate loop iterator frames across the program boundary: a program
        // defined inside a loop must not let its internal `local `i'` expand
        // against the enclosing do-file iterator. Uses build_symbols_in_body so
        // cd-nesting tracking (issue #252) still applies inside the program.
        const saved_loop_frames = this.loop_frames;
        const saved_nonexec_depth = this.nonexec_depth;
        this.loop_frames = [];
        // A program body executes top-level when the program is called, so reset
        // the non-executing-context depth for its own internal loops.
        this.nonexec_depth = 0;
        try {
            this.build_symbols_in_body(node.body, symbols, program_scope, all_scopes);
        } finally {
            this.loop_frames = saved_loop_frames;
            this.nonexec_depth = saved_nonexec_depth;
        }

        // Guard body-metadata extractions on first definition only.
        // These all mutate program_symbol.* and must follow first-def-wins
        // semantics to match location / additional_definitions behaviour.
        //
        // Known limitation (outside issue #135 scope): the first-def-wins
        // gate below also gates `extract_and_attach_signature`, which is
        // the only code path that registers implicit locals from `syntax`
        // into `program_scope`. For redeclared programs with *different*
        // signatures, body #2's implicit locals are therefore not
        // registered, and a reference to `` `B' `` in body #2 where the
        // second body declared `syntax varlist, B(string)` will emit a
        // false-positive "undefined local macro" diagnostic. The pattern
        // (two `program define NAME` blocks in one file with divergent
        // signatures) is rare in practice — dropping and redefining a
        // program usually uses `program drop NAME` first. If this bites,
        // the fix is to split signature extraction into "register implicit
        // locals" (per body) and "attach signature to program_symbol"
        // (first-def-wins only).
        if (is_first_definition) {
            // Extract c_local macro names from program body
            const c_locals = this.extract_c_locals(node.body);
            if (c_locals.length > 0) {
                program_symbol.c_locals = c_locals;
            }

            // Extract and attach signature from program body FIRST
            // This also registers implicit locals from all syntax commands
            this.extract_and_attach_signature(node, program_symbol, program_scope, symbols);

            // Extract macro-creating option patterns from program body
            // Must happen AFTER signature extraction so we can filter by
            // syntax parameters
            const syntax_option_names = this.extract_syntax_option_names(node.body);
            const { local_options, global_options } = this.extract_macro_creating_option_patterns(node.body, syntax_option_names);
            if (local_options.length > 0) {
                program_symbol.macro_creating_local_options = local_options;
            }
            if (global_options.length > 0) {
                program_symbol.macro_creating_global_options = global_options;
            }
        }
    }

    /**
     * Extract static c_local macro names from program body.
     * Only extracts names that are literal identifiers (not macro expansions).
     */
    private extract_c_locals(nodes: StataNode[]): string[] {
        const c_locals: string[] = [];
        for (const node of nodes) {
            if (node.type === 'command') {
                if (node.fullName === 'c_local' && node.varlist && node.varlist.length > 0) {
                    const name = node.varlist[0].name;
                    // Only include valid literal identifiers (exclude macro refs like `name')
                    if (is_valid_identifier(name)) {
                        c_locals.push(name);
                    }
                }
            } else if (this.is_control_flow(node)) {
                // Recurse into control flow bodies
                c_locals.push(...this.extract_c_locals(node.body));
            }
        }
        return c_locals;
    }

    /**
     * Extract option names from syntax commands in program body.
     * Returns a Set of lowercased option names declared in the program's
     * syntax signature. Stata's `syntax` command creates lowercased implicit
     * locals for options, even when the signature uses uppercase letters to
     * declare minimum abbreviations.
     */
    private extract_syntax_option_names(nodes: StataNode[]): Set<string> {
        const option_names = new Set<string>();
        for (const node of nodes) {
            if (node.type === 'syntax') {
                for (const opt of node.signature.options) {
                    option_names.add(opt.name.toLowerCase());
                }
            } else if (this.is_control_flow(node)) {
                // Recurse into control flow bodies
                for (const name of this.extract_syntax_option_names(node.body)) {
                    option_names.add(name);
                }
            }
        }
        return option_names;
    }

    /**
     * Extract macro-creating option patterns from program body.
     * Detects patterns like "c_local `local'" and "global `global'" where
     * the backticked identifier matches a syntax parameter name.
     * Case-sensitive for command names. Results are deduplicated.
     */
    private extract_macro_creating_option_patterns(nodes: StataNode[], syntax_option_names: Set<string>): { local_options: string[], global_options: string[] } {
        const local_set = new Set<string>();
        const global_set = new Set<string>();
        
        for (const node of nodes) {
            if (node.type === 'command') {
                // Check for c_local `local' pattern (case-sensitive)
                if (node.fullName === 'c_local' && node.varlist && node.varlist.length > 0) {
                    const macro_name = node.varlist[0].name;
                    // Check if it's a macro reference pattern (starts with backtick)
                    if (macro_name.startsWith('`') && macro_name.endsWith("'")) {
                        const inner_name = macro_name.slice(1, -1);
                        const local_name = inner_name.toLowerCase();
                        // Only add if it's a valid identifier AND matches a syntax option parameter
                        if (inner_name && is_valid_identifier(inner_name) && syntax_option_names.has(local_name)) {
                            local_set.add(local_name);
                        }
                    }
                }
                // Check for global `global' pattern (case-sensitive)
                else if (node.fullName === 'global' && node.varlist && node.varlist.length > 0) {
                    const macro_name = node.varlist[0].name;
                    // Check if it's a macro reference pattern (starts with backtick)
                    if (macro_name.startsWith('`') && macro_name.endsWith("'")) {
                        const inner_name = macro_name.slice(1, -1);
                        const global_name = inner_name.toLowerCase();
                        // Only add if it's a valid identifier AND matches a syntax option parameter
                        if (inner_name && is_valid_identifier(inner_name) && syntax_option_names.has(global_name)) {
                            global_set.add(global_name);
                        }
                    }
                }
            } else if (this.is_control_flow(node)) {
                // Recurse into control flow bodies
                const nested = this.extract_macro_creating_option_patterns(node.body, syntax_option_names);
                for (const opt of nested.local_options) local_set.add(opt);
                for (const opt of nested.global_options) global_set.add(opt);
            }
        }
        
        return { local_options: [...local_set], global_options: [...global_set] };
    }

    /**
     * Process a macro definition.
     * Macros are case-sensitive. Registers macros regardless of extended function type.
     */
    /**
     * True if `value` interpolates a local macro whose name is an active loop
     * iterator (`this.loop_frames`). Such a value is captured per-iteration, so
     * a macro assigned to it inside the loop is iteration-dependent. Loop
     * iterators are always locals, so only local refs can match.
     */
    private value_captures_active_iterator(value: string | undefined): boolean {
        if (!value || this.loop_frames.length === 0) return false;
        const the_iterator_vars = new Set(
            this.loop_frames.map((my_frame) => my_frame.var)
        );
        let captures = false;
        scan_macro_refs(value, {
            literal: () => {},
            local_ref: (name) => {
                if (the_iterator_vars.has(name)) captures = true;
                return true;
            },
            global_ref: () => true,
        });
        return captures;
    }

    private process_macro_def(
        node: MacroDefNode,
        symbols: SymbolTable,
        current_scope: ScopeInfo,
        node_index: number
    ): void {
        // Check if macro already exists (first definition wins)
        const existing = node.scope === 'local' 
            ? symbols.localMacros.get(node.name)
            : symbols.globalMacros.get(node.name);
        
        if (existing) {
            // Add to additional_definitions array
            if (!existing.additional_definitions) {
                existing.additional_definitions = [];
            }
            existing.additional_definitions.push({
                index: node_index,
                line: node.range.start.line,
                location: { uri: this.uri, range: node.range }
            });
        } else {
            // Create new macro with first definition
            const macro_symbol: MacroSymbol = {
                name: node.name,
                scope: node.scope,
                location: { uri: this.uri, range: node.range },
                sourceUri: this.uri,
                value: node.value,
                hasEquals: node.hasEquals,
                containingScope: current_scope.type,
                extendedFunction: node.extendedFunction,
                definition_index: node_index,
                definition_line: node.range.start.line,
                // A definition reached under a non-executing context (an
                // `if`/`while` body, or a dynamic/empty loop body) is not
                // guaranteed to run, so its value must not be folded into a
                // later loop's value-set or constructed names.
                ...(this.nonexec_depth > 0 ? { maybe_unexecuted: true } : {}),
                // Defined inside a guaranteed loop with a value that captured the
                // loop iterator (e.g. `` local suffix `i' ``): its runtime value
                // is iteration-dependent and must not be statically folded.
                ...(this.value_captures_active_iterator(node.value)
                    ? { iteration_dependent: true }
                    : {}),
            };

            // Register macro in symbol table regardless of extended function type
            if (node.scope === 'local') {
                current_scope.localMacros.set(node.name, macro_symbol);
                symbols.localMacros.set(node.name, macro_symbol);
            } else {
                symbols.globalMacros.set(node.name, macro_symbol);
            }
        }

    }

    /**
     * Analyze a syntax node and register implicit locals.
     */
    private analyze_syntax_node(
        node: SyntaxNode,
        symbols: SymbolTable,
        current_scope: ScopeInfo,
        node_index: number
    ): void {
        const signature = node.signature;

        // Register implicit locals for all arguments and options
        this.register_implicit_locals(signature, current_scope, symbols, node_index);
    }

    /**
     * Validate that an argument type is recognized.
     */
    private validate_argument_type(arg_type: string): void {
        const valid_types = [
            'varlist', 'varname', 'newvarname', 'anything', 'if', 'in', 'using', 'exp', 'name', 'namelist'
        ];

        if (!valid_types.includes(arg_type)) {
            // Unknown argument type - would be caught by parser
        }
    }

    /**
     * Validate that an option argument type is recognized.
     */
    private validate_option_argument_type(arg_type: string): void {
        const valid_types = [
            'real', 'integer', 'string', 'varlist', 'name', 'filename', 'numlist', 'varname', 'passthru'
        ];

        if (!valid_types.includes(arg_type)) {
            // Unknown option argument type
        }
    }

    /**
     * Register implicit local macros created by syntax command.
     * All arguments and options become implicit locals in the program scope.
     */
    private register_implicit_locals(
        signature: ProgramSignature,
        current_scope: ScopeInfo,
        symbols: SymbolTable,
        node_index: number
    ): void {
        // Register each argument as an implicit local
        for (const arg of signature.arguments) {
            const arg_name = this.get_implicit_local_name(arg);
            if (arg_name) {
                // Check if macro already exists (first definition wins)
                const existing_macro = symbols.localMacros.get(arg_name);
                if (existing_macro) {
                    // Add to additional_definitions array
                    if (!existing_macro.additional_definitions) {
                        existing_macro.additional_definitions = [];
                    }
                    existing_macro.additional_definitions.push({
                        index: node_index,
                        line: arg.range.start.line,
                        location: { uri: this.uri, range: arg.range }
                    });
                } else {
                    // Create new macro with first definition
                    const macro_symbol: MacroSymbol = {
                        name: arg_name,
                        scope: 'local',
                        location: { uri: this.uri, range: arg.range },
                        sourceUri: this.uri,
                        containingScope: current_scope.type,
                        definition_index: node_index,
                        definition_line: arg.range.start.line,
                    };

                    current_scope.localMacros.set(arg_name, macro_symbol);
                    symbols.localMacros.set(arg_name, macro_symbol);
                }
                
                // For weight types, also register 'exp' as implicit local
                if ((WEIGHT_TYPES as readonly string[]).includes(arg.type)) {
                    const existing_exp = symbols.localMacros.get('exp');
                    if (existing_exp) {
                        if (!existing_exp.additional_definitions) {
                            existing_exp.additional_definitions = [];
                        }
                        existing_exp.additional_definitions.push({
                            index: node_index,
                            line: arg.range.start.line,
                            location: { uri: this.uri, range: arg.range }
                        });
                    } else {
                        const exp_symbol: MacroSymbol = {
                            name: 'exp',
                            scope: 'local',
                            location: { uri: this.uri, range: arg.range },
                            sourceUri: this.uri,
                            containingScope: current_scope.type,
                            definition_index: node_index,
                            definition_line: arg.range.start.line,
                        };
                        current_scope.localMacros.set('exp', exp_symbol);
                        symbols.localMacros.set('exp', exp_symbol);
                    }
                }
            }
        }

        // Register each option as an implicit local. Stata's `syntax` command
        // uses uppercase letters in option names to declare a minimum
        // abbreviation (e.g. `Cache(string)`), but the implicit local Stata
        // creates at runtime is always lowercased.
        for (const opt of signature.options) {
            const local_name = opt.name.toLowerCase();
            const existing_macro = symbols.localMacros.get(local_name);
            if (existing_macro) {
                if (!existing_macro.additional_definitions) {
                    existing_macro.additional_definitions = [];
                }
                existing_macro.additional_definitions.push({
                    index: node_index,
                    line: opt.range.start.line,
                    location: { uri: this.uri, range: opt.range }
                });
            } else {
                const macro_symbol: MacroSymbol = {
                    name: local_name,
                    scope: 'local',
                    location: { uri: this.uri, range: opt.range },
                    sourceUri: this.uri,
                    containingScope: current_scope.type,
                    definition_index: node_index,
                    definition_line: opt.range.start.line,
                };

                current_scope.localMacros.set(local_name, macro_symbol);
                symbols.localMacros.set(local_name, macro_symbol);
            }
        }
    }

    /**
     * Get the implicit local name for an argument.
     * For most types, it's the type name (e.g., 'varlist', 'if', 'in').
     * For 'anything(name=...)', it's the specified name.
     * For weight types, it's always 'weight' (Stata uses the same macro name regardless of weight type).
     */
    private get_implicit_local_name(arg: ArgumentSpec): string | null {
        if (arg.type === 'anything' && arg.name) {
            return arg.name;
        }
        
        // Weight types all create a 'weight' implicit local
        if ((WEIGHT_TYPES as readonly string[]).includes(arg.type)) {
            return 'weight';
        }
        
        return arg.type;
    }

    /**
     * Extract signature from program body and attach to program symbol.
     * Merges multiple syntax commands in order of appearance.
     */
    private extract_and_attach_signature(
        program_node: ProgramNode,
        program_symbol: ProgramSymbol,
        _program_scope: ScopeInfo,
        _symbols: SymbolTable
    ): void {
        const syntax_nodes: SyntaxNode[] = [];

        // Find all syntax nodes in program body
        for (const node of program_node.body) {
            if (node.type === 'syntax') {
                syntax_nodes.push(node);
            }
        }

        if (syntax_nodes.length === 0) {
            return; // No syntax command in this program
        }

        // Merge signatures from all syntax commands
        const merged_signature = this.merge_signatures(syntax_nodes);

        // Attach to program node and symbol
        program_node.signature = merged_signature;
        program_symbol.signature = merged_signature;
    }

    /**
     * Merge multiple program signatures.
     * Arguments are concatenated in order.
     * Options are merged, with later definitions overriding earlier ones.
     */
    private merge_signatures(syntax_nodes: SyntaxNode[]): ProgramSignature {
        const merged_arguments: ArgumentSpec[] = [];
        const merged_options: OptionSpec[] = [];
        let allows_arbitrary_options = false;
        const syntax_ranges: Range[] = [];

        for (const syntax_node of syntax_nodes) {
            const sig = syntax_node.signature;
            syntax_ranges.push(syntax_node.range);

            // Concatenate arguments
            merged_arguments.push(...sig.arguments);

            // Preserve all options (including duplicates)
            merged_options.push(...sig.options);

            // Track if any syntax allows arbitrary options
            if (sig.allowsArbitraryOptions) {
                allows_arbitrary_options = true;
            }
        }

        return {
            arguments: merged_arguments,
            options: merged_options,
            allowsArbitraryOptions: allows_arbitrary_options,
            syntaxRanges: syntax_ranges,
        };
    }

    /**
     * Extract the first file-path argument from a file command's varlist.
     *
     * Shared by `detect_forward_call` (do/run/include) and `detect_cd_command`
     * (cd). Surrounding quotes are stripped; `has_macro` is true when the path
     * contains a `` ` `` or `$` macro reference (the lexer splits a quoted path
     * with a macro into multiple tokens, so partial-quoted paths are
     * concatenated until the closing quote).
     *
     * Returns `null` when the command has no varlist argument (e.g. bare `cd`).
     */
    private extract_command_path(
        node: CommandNode
    ): { raw_path: string; has_macro: boolean } | null {
        if (!node.varlist || node.varlist.length === 0) {
            return null;
        }

        let raw_path = '';
        let has_macro = false;

        const first_item = node.varlist[0];
        const first_name = first_item.name;

        // Check if this is a complete quoted string (starts and ends with same quote)
        const is_complete_double_quoted = first_name.startsWith('"') && first_name.endsWith('"') && first_name.length > 1;
        const is_complete_single_quoted = first_name.startsWith("'") && first_name.endsWith("'") && first_name.length > 1;

        if (is_complete_double_quoted || is_complete_single_quoted) {
            // Complete quoted path - use only the first item
            // Subsequent items are script arguments
            raw_path = first_name;
            has_macro = raw_path.includes('`') || raw_path.includes('$');
        } else if (first_name.startsWith('"') || first_name.startsWith("'")) {
            // Partial quoted path - concatenate items until we find the closing quote
            // This happens when the path contains macro references
            const quote_char = first_name[0];
            raw_path = first_name;
            has_macro = raw_path.includes('`') || raw_path.includes('$');

            for (let i = 1; i < node.varlist.length; i++) {
                const item_name = node.varlist[i].name;
                raw_path += item_name;

                // Check for macro references in this item
                if (item_name.includes('`') || item_name.includes('$')) {
                    has_macro = true;
                }

                // Stop when we find the closing quote
                if (item_name.endsWith(quote_char)) {
                    break;
                }
            }
        } else {
            // Unquoted path - use only the first item
            // Note: The parser may have already coalesced unquoted paths
            raw_path = first_name;
            has_macro = raw_path.includes('`') || raw_path.includes('$');
        }

        // Strip surrounding quotes if present
        if ((raw_path.startsWith('"') && raw_path.endsWith('"')) ||
            (raw_path.startsWith("'") && raw_path.endsWith("'"))) {
            raw_path = raw_path.slice(1, -1);
        }

        return { raw_path, has_macro };
    }

    /**
     * Detect forward call commands (do, run, include).
     */
    private detect_forward_call(node: CommandNode): void {
        const cmd_name = node.name;

        // Check for do, run, include commands (with abbreviations)
        // do has no abbreviation - must be spelled out fully
        // run can be abbreviated to 'ru'
        // include has no abbreviation
        const is_do = cmd_name === 'do';
        const is_run = cmd_name === 'run' || cmd_name === 'ru';
        const is_include = cmd_name === 'include';

        if (!is_do && !is_run && !is_include) {
            return;
        }

        // Skip if this line is ignored via @lsp-ignore or @lsp-ignore-next
        if (this.config.ignored_lines.has(node.range.start.line)) {
            return;
        }

        // Get the first argument (path) - subsequent arguments are script arguments
        // e.g., `do "wfs/survey.do" Cameroon 1978` - only "wfs/survey.do" is the path
        const extracted = this.extract_command_path(node);
        if (!extracted) {
            return;
        }
        const { raw_path, has_macro } = extracted;

        const call_type: 'do' | 'run' | 'include' = is_do ? 'do' : is_run ? 'run' : 'include';

        // No path resolution here: consumers (dependency graph,
        // scope-resolver reverse deps, forward-scope-resolver) resolve the
        // callee from raw_path + caller dir + working_directory via the
        // shared case-aware resolve_forward_call_rich. We only record the
        // raw path and resolution context.
        this.forward_calls.push({
            type: call_type,
            raw_path: raw_path,
            call_site_line: node.range.start.line,
            range: node.range,
            source: 'command',
            is_static: !has_macro,
            caller_uri: this.uri,
            working_directory: this.config.working_directory,
        });
    }

    /**
     * Detect a top-level `cd` command and record it for the working-directory
     * timeline (issue #252).
     *
     * Conservative recognition — only records `cd` when ALL hold:
     *  - the command name is exactly lowercase `cd` (Stata is case-sensitive),
     *  - it is at the top level of the file (`cd_nesting_depth === 0`): `cd`
     *    inside loops/programs/branches is out of scope,
     *  - it has NO prefix (skips `capture cd`, `quietly cd`, etc. — conditional
     *    or error-swallowing forms that must not change the timeline),
     *  - it has a path argument (bare `cd`, which changes to the home
     *    directory, is unmodelable and is skipped — leaving the WD unchanged).
     *
     * No path resolution happens here (the analyzer is filesystem-pure);
     * `build_cd_timeline` resolves the recorded paths in source order.
     *
     * KNOWN LIMITATION — `#delimit ;` files: the parser does not attach a file
     * command's path as a `varlist` argument under semicolon delimiting
     * (`cd "raw";` parses as a `cd` node with no varlist plus a separate
     * `"raw"` node), so `extract_command_path` returns null and the `cd` is
     * skipped. This is a PRE-EXISTING parser limitation that affects ALL
     * file-path commands equally — `do`/`run`/`include` forward-call detection
     * (`detect_forward_call`) is already a no-op for `#delimit ;` files for the
     * same reason. `cd` tracking is therefore consistent with the existing
     * cross-file feature; full `#delimit ;` support is a separate parser change,
     * out of scope for issue #252.
     */
    private detect_cd_command(node: CommandNode): void {
        if (node.name !== 'cd') {
            return;
        }
        // Top-level only; prefixed forms (capture/quietly/...) are skipped.
        if (this.cd_nesting_depth !== 0) {
            return;
        }
        if (node.prefix && node.prefix.length > 0) {
            return;
        }
        const extracted = this.extract_command_path(node);
        if (!extracted) {
            // Bare `cd` (home directory) — unmodelable; leave WD unchanged.
            return;
        }
        this.cd_commands.push({
            raw_path: extracted.raw_path,
            range: node.range,
            is_static: !extracted.has_macro,
        });
    }

    /**
     * Process a command node.
     *
     * Symbol extraction handled here:
     * - Variables: gen/generate, egen, input, rename/ren, confirm
     * - Scalars: scalar
     * - Matrices: matrix, matrix define
     * - Macros: tempvar/tempfile/tempname, unab, args,
     *           gettoken/gettok, file read
     *
     * Note: `replace` mutates an existing variable and is not
     * currently treated as a definition site.
     */
    private process_command(
        node: CommandNode,
        symbols: SymbolTable,
        current_scope: ScopeInfo,
        node_index: number
    ): void {
        // Detect forward calls first
        this.detect_forward_call(node);
        // Detect top-level `cd` commands for the working-directory timeline
        // (issue #252). Gated to depth 0 inside detect_cd_command.
        this.detect_cd_command(node);

        const cmd_name = node.fullName;

        // Check for variable-creating commands
        if (cmd_name === 'generate' || cmd_name === 'gen') {
            this.extract_gen_variable(node, symbols);
        } else if (cmd_name === 'egen') {
            this.extract_egen_variable(node, symbols);
        } else if (cmd_name === 'input') {
            this.extract_input_variables(node, symbols);
        } else if (cmd_name === 'rename' || cmd_name === 'ren') {
            this.extract_rename_variables(node, symbols);
        } else if (cmd_name === 'confirm') {
            this.extract_confirm_variable(node, symbols);
        } else if (cmd_name === 'scalar') {
            this.extract_scalar_symbol(node, symbols, node_index);
        } else if (cmd_name === 'matrix') {
            this.extract_matrix_symbol(node, symbols, node_index);
        } else if (cmd_name === 'tempvar' || cmd_name === 'tempfile' || cmd_name === 'tempname') {
            // tempvar/tempfile/tempname create LOCAL MACROs
            this.extract_tempvar_macro(node, symbols, current_scope, node_index);
        } else if (cmd_name === 'unab') {
            // unab creates a local macro containing variable names
            // Syntax: unab macname : varlist
            this.extract_unab_macro(node, symbols, current_scope, node_index);
        } else if (cmd_name === 'args') {
            // args creates local macros for positional arguments
            // Syntax: args name1 [name2 ...]
            this.extract_args_macros(node, symbols, current_scope, node_index);
        } else if (cmd_name === 'gettoken' || cmd_name === 'gettok') {
            // gettoken extracts the first token from a string and optionally stores the remainder
            // Syntax: gettoken macname1 [macname2] : macname3 [, options]
            this.extract_gettoken_macros(node, symbols, current_scope, node_index);
        } else if (cmd_name === 'file' || cmd_name === 'fil' || cmd_name === 'fi') {
            // file read stores a line from a file into a local macro
            // Syntax: file read handle macroname
            this.extract_file_read_macro(node, symbols, current_scope, node_index);
        }

        // Extract macros from local() and global() options
        this.extract_macro_creating_options(node, symbols, current_scope, node_index);

        // Check if command is a known program with c_locals or macro-creating options
        // First check symbols.programs.get(cmd_name), then this.workspace_symbols?.programs.get(cmd_name)
        let program = symbols.programs.get(cmd_name);
        if (!program && this.workspace_symbols) {
            program = this.workspace_symbols.programs.get(cmd_name);
        }
        
        if (program?.c_locals) {
            for (const macro_name of program.c_locals) {
                const macro_symbol: MacroSymbol = {
                    name: macro_name,
                    scope: 'local',
                    location: { uri: this.uri, range: node.range },
                    sourceUri: program.sourceUri,
                    containingScope: current_scope.type,
                    definition_index: node_index,
                    definition_line: node.range.start.line,
                };
                current_scope.localMacros.set(macro_name, macro_symbol);
                symbols.localMacros.set(macro_name, macro_symbol);
            }
        }
    }

    /**
     * Extract scalar definition from scalar command.
     * Spec patterns:
     * - scalar <name> = ...
     */
    private extract_scalar_symbol(
        node: CommandNode,
        symbols: SymbolTable,
        node_index: number
    ): void {
        if (!node.varlist || node.varlist.length === 0) {
            return;
        }

        const scalar_name = node.varlist[0].name;
        this.add_or_append_definition(
            symbols.scalars,
            scalar_name,
            node_index,
            node.varlist[0].range,
            () => ({
                name: scalar_name,
                location: { uri: this.uri, range: node.varlist![0].range },
                sourceUri: this.uri,
                definition_line: node.varlist![0].range.start.line,
            })
        );
    }

    /**
     * Extract matrix definition from matrix command.
     * Spec patterns:
     * - matrix <name> = ...
     * - matrix define <name> = ...
     */
    private extract_matrix_symbol(
        node: CommandNode,
        symbols: SymbolTable,
        node_index: number
    ): void {
        if (!node.varlist || node.varlist.length === 0) {
            return;
        }

        const first = node.varlist[0]?.name;
        const second = node.varlist[1]?.name;

        const matrix_name = (first && first === 'define')
            ? second
            : first;

        if (!matrix_name) {
            return;
        }

        // If 'define' is present, prefer the name token's range.
        const name_range = (first && first === 'define' && node.varlist[1])
            ? node.varlist[1].range
            : node.varlist[0].range;

        this.add_or_append_definition(
            symbols.matrices,
            matrix_name,
            node_index,
            name_range,
            () => ({
                name: matrix_name,
                location: { uri: this.uri, range: name_range },
                sourceUri: this.uri,
                definition_line: name_range.start.line,
            })
        );
    }

    /**
     * Pick the new-variable token from a `gen`/`egen` varlist, skipping a
     * leading storage type when present. Storage-type keywords are reserved
     * in this position, so a lone storage-type token (e.g. `gen byte = 1`,
     * which is invalid Stata) yields no variable.
     */
    // Pushes diagnostics to this.current_diagnostics; only call from within an
    // analyze() cycle (e.g., process_command → extract_gen_variable / extract_egen_variable).
    private pick_new_variable(node: CommandNode): IdentifierNode | undefined {
        if (!node.varlist || node.varlist.length === 0) {
            return undefined;
        }
        if (is_stata_storage_type(node.varlist[0].name)) {
            if (node.varlist.length > 1) {
                return node.varlist[1];
            }
            this.current_diagnostics.push({
                message: `Missing variable name after storage type \`${node.varlist[0].name}'`,
                range: node.varlist[0].range,
                code: StataDiagnosticCode.MISSING_VARIABLE_NAME,
                severity: 'error',
            });
            return undefined;
        }
        return node.varlist[0];
    }

    /**
     * Extract variable from generate command.
     * Syntax: gen[erate] [type] newvar = exp
     */
    private extract_gen_variable(node: CommandNode, symbols: SymbolTable): void {
        const new_var = this.pick_new_variable(node);
        if (!new_var) return;

        // Skip macro references - they are not actual variable definitions
        if (this.is_macro_reference(new_var.name)) {
            return;
        }

        const var_symbol: VariableSymbol = {
            name: new_var.name,
            location: { uri: this.uri, range: new_var.range },
            sourceUri: this.uri,
            source: 'gen',
        };

        symbols.variables.set(new_var.name, var_symbol);
    }

    /**
     * Extract variable from egen command.
     * Syntax: egen [type] newvar = fcn(arguments)
     */
    private extract_egen_variable(node: CommandNode, symbols: SymbolTable): void {
        const new_var = this.pick_new_variable(node);
        if (!new_var) return;

        // Skip macro references - they are not actual variable definitions
        if (this.is_macro_reference(new_var.name)) {
            return;
        }

        const var_symbol: VariableSymbol = {
            name: new_var.name,
            location: { uri: this.uri, range: new_var.range },
            sourceUri: this.uri,
            source: 'egen',
        };

        symbols.variables.set(new_var.name, var_symbol);
    }

    /**
     * Extract variables from input command.
     * Syntax: input varlist
     */
    private extract_input_variables(node: CommandNode, symbols: SymbolTable): void {
        if (!node.varlist) {
            return;
        }

        for (const var_node of node.varlist) {
            // Skip macro references - they are not actual variable definitions
            if (this.is_macro_reference(var_node.name)) {
                continue;
            }

            const var_symbol: VariableSymbol = {
                name: var_node.name,
                location: { uri: this.uri, range: var_node.range },
                sourceUri: this.uri,
                source: 'input',
            };

            symbols.variables.set(var_node.name, var_symbol);
        }
    }

    /**
     * Check if a variable name contains wildcard characters.
     * Wildcards (* and ?) indicate pattern-based renames that cannot be statically resolved.
     */
    private contains_wildcard(name: string): boolean {
        return name.includes('*') || name.includes('?');
    }

    private has_adjacent_wildcard_token(name_range: Range): boolean {
        if (!this.tokens) {
            return false;
        }

        // We only care about wildcard tokens that are immediately adjacent to the
        // identifier token (stub patterns like new* or *new).
        for (const token of this.tokens) {
            if (token.range.start.line !== name_range.start.line) {
                continue;
            }

            const is_wildcard_token =
                (token.type === 'OPERATOR' && token.value === '*') ||
                (token.type === 'WORD' && token.value === '?');

            if (!is_wildcard_token) {
                continue;
            }

            const touches_end =
                token.range.start.character === name_range.end.character &&
                token.range.start.line === name_range.end.line;

            const touches_start =
                token.range.end.character === name_range.start.character &&
                token.range.end.line === name_range.start.line;

            if (touches_end || touches_start) {
                return true;
            }
        }

        return false;
    }

    /**
     * Extract variables from rename command.
     * 
     * Supported syntaxes:
     * - rename oldvar newvar
     * - ren oldvar newvar
     * - rename (old1 old2) (new1 new2)
     * 
     * Pattern-based renames (wildcards, stubs) are not supported
     * as they cannot be statically resolved.
     */
    private extract_rename_variables(node: CommandNode, symbols: SymbolTable): void {
        if (!node.varlist || node.varlist.length < 2) {
            return;
        }

        // In the simple form, rename should have exactly two varlist identifiers
        // (oldvar newvar). If parsing yields extra varlist items, treat it as a
        // non-statically-resolvable pattern/incomplete statement.
        //
        // This also guards cases like: rename old new?  ("?" may become a separate WORD token)
        if (
            node.varlist.length !== 2 &&
            !(node.varlist[0].name.startsWith('(') && node.varlist[1].name.startsWith('('))
        ) {
            return;
        }

        // Check for grouped syntax: (old1 old2) (new1 new2)
        // Parser captures parenthesized groups as single varlist items with parens
        const first_item = node.varlist[0].name;
        const second_item = node.varlist[1].name;

        if (first_item.startsWith('(') && second_item.startsWith('(')) {
            // If either group contains wildcards, treat as pattern-based rename
            if (this.contains_wildcard(first_item) || this.contains_wildcard(second_item)) {
                return;
            }
            // Grouped syntax - extract names from second group
            this.extract_grouped_rename_variables(second_item, node.varlist[1].range, symbols);
            return;
        }

        // Simple syntax: rename oldvar newvar
        // Skip if either name contains wildcards (* or ?)
        if (this.contains_wildcard(first_item) || this.contains_wildcard(second_item)) {
            return;
        }

        // The lexer tokenizes stub patterns like new* as WORD("new") + OPERATOR("*")
        // (and similarly for *new). The parser currently drops the wildcard token from
        // varlist, so we must consult the token stream to avoid false registration.
        if (
            this.has_adjacent_wildcard_token(node.varlist[0].range) ||
            this.has_adjacent_wildcard_token(node.varlist[1].range)
        ) {
            return;
        }

        const new_var = node.varlist[1];

        // Skip macro references - they are not actual variable definitions
        if (this.is_macro_reference(new_var.name)) {
            return;
        }

        const var_symbol: VariableSymbol = {
            name: new_var.name,
            location: { uri: this.uri, range: new_var.range },
            sourceUri: this.uri,
            source: 'rename',
        };

        symbols.variables.set(new_var.name, var_symbol);
    }

    /**
     * Extract variable names from a grouped rename expression.
     * Input: "(new1 new2 new3)" → registers new1, new2, new3
     */
    private extract_grouped_rename_variables(
        group_content: string,
        group_range: Range,
        symbols: SymbolTable
    ): void {
        // Remove parentheses and split by whitespace
        const inner = group_content.slice(1, -1).trim();
        const the_names = inner.split(/\s+/).filter(n => n.length > 0);

        for (const my_name of the_names) {
            // Skip wildcards
            if (this.contains_wildcard(my_name)) {
                continue;
            }

            // Skip macro references - they are not actual variable definitions
            if (this.is_macro_reference(my_name)) {
                continue;
            }

            const var_symbol: VariableSymbol = {
                name: my_name,
                location: { uri: this.uri, range: group_range },
                sourceUri: this.uri,
                source: 'rename',
            };

            symbols.variables.set(my_name, var_symbol);
        }
    }

    /**
     * Extract variable from confirm variable command.
     * 
     * Supported syntaxes:
     * - confirm variable varname [, exact]
     * - confirm var varname [, exact]
     * - capture confirm variable varname
     * - capture: confirm var varname
     * - quietly confirm variable varname
     * 
     * The parser produces a CommandNode with:
     * - name: "confirm"
     * - varlist: [{name: "variable"|"var"}, {name: varname}, ...]
     * 
     * We check if the first varlist item is "variable" or "var",
     * then register the second varlist item as the variable.
     */
    private extract_confirm_variable(node: CommandNode, symbols: SymbolTable): void {
        if (!node.varlist || node.varlist.length < 2) {
            return;
        }

        const first_item = node.varlist[0].name.toLowerCase();

        // Check if this is a "confirm variable" or "confirm var" command
        if (first_item !== 'variable' && first_item !== 'var') {
            return;
        }

        // The second item is the variable name
        const var_node = node.varlist[1];

        // Skip macro references - they are not actual variable definitions
        if (this.is_macro_reference(var_node.name)) {
            return;
        }

        const var_symbol: VariableSymbol = {
            name: var_node.name,
            location: { uri: this.uri, range: var_node.range },
            sourceUri: this.uri,
            source: 'confirm',
        };

        symbols.variables.set(var_node.name, var_symbol);
    }

    /**
     * Extract macro from tempvar command.
     * tempvar creates a local macro containing a generated variable name.
     * Syntax: tempvar name [name ...]
     */
    private extract_tempvar_macro(
        node: CommandNode,
        symbols: SymbolTable,
        current_scope: ScopeInfo,
        node_index: number
    ): void {
        if (!node.varlist) {
            return;
        }

        for (const var_node of node.varlist) {
            // Check if macro already exists (first definition wins)
            const existing_macro = symbols.localMacros.get(var_node.name);
            if (existing_macro) {
                // Add to additional_definitions array
                if (!existing_macro.additional_definitions) {
                    existing_macro.additional_definitions = [];
                }
                existing_macro.additional_definitions.push({
                    index: node_index,
                    line: var_node.range.start.line,
                    location: { uri: this.uri, range: var_node.range }
                });
            } else {
                // Create new macro with first definition
                const macro_symbol: MacroSymbol = {
                    name: var_node.name,
                    scope: 'local',
                    location: { uri: this.uri, range: var_node.range },
                    sourceUri: this.uri,
                    value: `__tempvar_${var_node.name}__`, // Placeholder value
                    containingScope: current_scope.type,
                    definition_index: node_index,
                    definition_line: node.range.start.line,
                };

                current_scope.localMacros.set(var_node.name, macro_symbol);
                symbols.localMacros.set(var_node.name, macro_symbol);
            }
        }
    }

    /**
     * Extract macro from unab command.
     * unab creates a local macro containing variable names.
     * Syntax: unab macname : varlist
     */
    private extract_unab_macro(
        node: CommandNode,
        symbols: SymbolTable,
        current_scope: ScopeInfo,
        node_index: number
    ): void {
        // For unab command, the first argument is the macro name
        // The syntax is: unab macname : varlist
        if (node.varlist && node.varlist.length > 0) {
            const macro_name = node.varlist[0].name;

            // Check if macro already exists (first definition wins)
            const existing_macro = symbols.localMacros.get(macro_name);
            if (existing_macro) {
                if (!existing_macro.additional_definitions) {
                    existing_macro.additional_definitions = [];
                }
                existing_macro.additional_definitions.push({
                    index: node_index,
                    line: node.varlist[0].range.start.line,
                    location: { uri: this.uri, range: node.varlist[0].range }
                });
            } else {
                const macro_symbol: MacroSymbol = {
                    name: macro_name,
                    scope: 'local',
                    location: { uri: this.uri, range: node.varlist[0].range },
                    sourceUri: this.uri,
                    value: `__unab_${macro_name}__`, // Placeholder value
                    containingScope: current_scope.type,
                    definition_index: node_index,
                    definition_line: node.range.start.line,
                };

                current_scope.localMacros.set(macro_name, macro_symbol);
                symbols.localMacros.set(macro_name, macro_symbol);
            }
        }
    }

    /**
     * Extract macros from args command.
     * args creates local macros for positional arguments passed to a program.
     * Syntax: args name1 [name2 ...]
     * Each name becomes a local macro containing the corresponding positional
     * argument value.
     */
    private extract_args_macros(
        node: CommandNode,
        symbols: SymbolTable,
        current_scope: ScopeInfo,
        node_index: number
    ): void {
        // For args command, each argument in the varlist becomes a local macro
        // The syntax is: args name1 name2 name3 ...
        if (node.varlist && node.varlist.length > 0) {
            for (const my_var_node of node.varlist) {
                const macro_name = my_var_node.name;
                
                // Check if macro already exists (first definition wins)
                const existing_macro = symbols.localMacros.get(macro_name);
                if (existing_macro) {
                    // Add to additional_definitions array
                    if (!existing_macro.additional_definitions) {
                        existing_macro.additional_definitions = [];
                    }
                    existing_macro.additional_definitions.push({
                        index: node_index,
                        line: my_var_node.range.start.line,
                        location: { uri: this.uri, range: my_var_node.range }
                    });
                } else {
                    // Use definition_index: 0 and definition_line: 0 because args macros
                    // represent parameters passed into the program/file. Unlike regular
                    // `local` definitions, they should be valid from the start of the scope
                    // to avoid false "undefined local macro" warnings for forward references.
                    const macro_symbol: MacroSymbol = {
                        name: macro_name,
                        scope: 'local',
                        location: { uri: this.uri, range: my_var_node.range },
                        sourceUri: this.uri,
                        value: `__args_${macro_name}__`, // Placeholder value
                        containingScope: current_scope.type,
                        definition_index: 0,
                        definition_line: 0,
                    };

                    current_scope.localMacros.set(macro_name, macro_symbol);
                    symbols.localMacros.set(macro_name, macro_symbol);
                }
            }
        }
    }

    /**
     * Extract macros from gettoken command.
     * gettoken extracts the first token from a string and optionally stores the remainder.
     * Syntax: gettoken macname1 [macname2] : macname3 [, options]
     * 
     * @param node - The command node for gettoken
     * @param symbols - The symbol table to update
     * @param current_scope - The current scope info
     * @param node_index - The preorder traversal index for forward reference detection
     */
    private extract_gettoken_macros(
        node: CommandNode,
        symbols: SymbolTable,
        current_scope: ScopeInfo,
        node_index: number
    ): void {
        // For gettoken command, the varlist contains macro names before the colon
        // The syntax is: gettoken macname1 [macname2] : macname3 [, options]
        // - If varlist has 1 element: single output macro (macname1)
        // - If varlist has 2 elements: two output macros (macname1, macname2)
        if (!node.varlist || node.varlist.length === 0) {
            return;
        }

        // Extract up to 2 macro names from the varlist (before the colon)
        const max_macros = Math.min(node.varlist.length, 2);
        for (let i = 0; i < max_macros; i++) {
            const my_var_node = node.varlist[i];
            const macro_name = my_var_node.name;

            // Skip invalid identifiers (e.g., macro references like `name')
            if (!is_valid_identifier(macro_name)) {
                continue;
            }

            // Check if macro already exists (first definition wins)
            const existing_macro = symbols.localMacros.get(macro_name);
            if (existing_macro) {
                // Add to additional_definitions array
                if (!existing_macro.additional_definitions) {
                    existing_macro.additional_definitions = [];
                }
                existing_macro.additional_definitions.push({
                    index: node_index,
                    line: my_var_node.range.start.line,
                    location: { uri: this.uri, range: my_var_node.range }
                });
            } else {
                // Create new macro with first definition
                const macro_symbol: MacroSymbol = {
                    name: macro_name,
                    scope: 'local',
                    location: { uri: this.uri, range: my_var_node.range },
                    sourceUri: this.uri,
                    value: `__gettoken_${macro_name}__`, // Placeholder value
                    containingScope: current_scope.type,
                    definition_index: node_index,
                    definition_line: node.range.start.line,
                };

                current_scope.localMacros.set(macro_name, macro_symbol);
                symbols.localMacros.set(macro_name, macro_symbol);
            }
        }
    }

    /**
     * Extract macro from file read command.
     * Syntax: file read handle macroname
     *
     * varlist layout: [0]=subcommand, [1]=handle, [2]=macroname
     * Only the exact subcommand spelling "read" creates a local
     * macro.
     *
     * Note: this layout assumes 'file' is NOT in FILE_COMMANDS
     * (file-path-utils.ts), so the parser does not coalesce the
     * first argument as a file path.
     */
    private extract_file_read_macro(
        node: CommandNode,
        symbols: SymbolTable,
        current_scope: ScopeInfo,
        node_index: number
    ): void {
        // Require at least 3 varlist items: subcommand, handle, macroname
        if (!node.varlist || node.varlist.length < 3) {
            return;
        }

        // Only "read" subcommand creates a local macro (exact match)
        if (node.varlist[0].name !== 'read') {
            return;
        }

        const macro_node = node.varlist[2];
        const macro_name = macro_node.name;

        if (!is_valid_identifier(macro_name)) {
            return;
        }

        // Check if macro already exists (first definition wins)
        const existing_macro = symbols.localMacros.get(macro_name);
        if (existing_macro) {
            if (!existing_macro.additional_definitions) {
                existing_macro.additional_definitions = [];
            }
            existing_macro.additional_definitions.push({
                index: node_index,
                line: macro_node.range.start.line,
                location: { uri: this.uri, range: macro_node.range }
            });
        } else {
            const macro_symbol: MacroSymbol = {
                name: macro_name,
                scope: 'local',
                location: { uri: this.uri, range: macro_node.range },
                sourceUri: this.uri,
                value: `__file_read_${macro_name}__`,
                containingScope: current_scope.type,
                definition_index: node_index,
                definition_line: node.range.start.line,
            };

            current_scope.localMacros.set(macro_name, macro_symbol);
            symbols.localMacros.set(macro_name, macro_symbol);
        }
    }

    /**
     * Get macro-creating options for a user-defined program.
     * Checks current file symbols first, then workspace symbols.
     * Returns undefined if program not found or has no macro-creating options.
     */
    private get_program_macro_creating_options(program_name: string, symbols: SymbolTable): { local_options: string[], global_options: string[] } | undefined {
        // Check current file symbols first (higher precedence)
        let program = symbols.programs.get(program_name);
        if (program && (program.macro_creating_local_options || program.macro_creating_global_options)) {
            return {
                local_options: program.macro_creating_local_options || [],
                global_options: program.macro_creating_global_options || []
            };
        }

        // Check workspace symbols (lower precedence)
        if (this.workspace_symbols) {
            program = this.workspace_symbols.programs.get(program_name);
            if (program && (program.macro_creating_local_options || program.macro_creating_global_options)) {
                return {
                    local_options: program.macro_creating_local_options || [],
                    global_options: program.macro_creating_global_options || []
                };
            }
        }

        return undefined;
    }

    /**
     * Extract macros created by local() and global() options.
     * Supports allowlisted built-in commands (e.g., levelsof, glevelsof) and
     * user-defined programs with macro-creating options.
     */
    private extract_macro_creating_options(
        node: CommandNode,
        symbols: SymbolTable,
        current_scope: ScopeInfo,
        node_index: number
    ): void {
        for (const my_created of this.get_command_created_macros(node, symbols)) {
            const my_range = my_created.argument_range ?? node.range;
            const target = my_created.scope === 'local'
                ? symbols.localMacros
                : symbols.globalMacros;
            const existing_macro = target.get(my_created.name);
            if (existing_macro) {
                // Add to additional_definitions array (first definition wins)
                if (!existing_macro.additional_definitions) {
                    existing_macro.additional_definitions = [];
                }
                existing_macro.additional_definitions.push({
                    index: node_index,
                    line: my_range.start.line,
                    location: { uri: this.uri, range: my_range },
                });
            } else {
                // Create new macro with first definition
                const macro_symbol: MacroSymbol = {
                    name: my_created.name,
                    scope: my_created.scope,
                    location: { uri: this.uri, range: my_range },
                    sourceUri: this.uri,
                    value: `__option_${my_created.scope}_${my_created.name}__`,
                    containingScope: current_scope.type,
                    definition_index: node_index,
                    definition_line: node.range.start.line,
                };
                target.set(my_created.name, macro_symbol);
                if (my_created.scope === 'local') {
                    current_scope.localMacros.set(my_created.name, macro_symbol);
                }
            }
        }
    }

    /**
     * Read-only detection of the macros a command statement creates via
     * macro-creating options: built-in commands (`levelsof ..., local(x)`,
     * `glevelsof`) and user-defined programs with `local()`/`global()` options.
     * Returns the concrete (literal) created names with scope and the option's
     * argument range. Constructed/dynamic option arguments (e.g. `local(`j')`)
     * are skipped — their concrete name is not statically known.
     *
     * Shared by `extract_macro_creating_options` (which registers the symbols)
     * and the loop expander (which uses it to poison a helper that a loop body
     * reassigns via such a command before a later constructed name interpolates
     * it). Keeping ONE detection path guarantees the expander poisons exactly
     * the set of names the analyzer treats as command-created.
     */
    /**
     * Literal LOCAL-macro names a command (re)defines through a POSITIONAL
     * target (not a `local()`/`global()` option): `tempvar`/`tempname`/
     * `tempfile`, `args`, `unab`, `gettoken`, and `file read`. Mirrors the
     * target positions used by the corresponding `extract_*` methods. Used by
     * the loop expander to poison such a target in execution order, so a
     * constructed name AFTER e.g. `` gettoken suffix rest : x `` no longer folds
     * the helper's stale pre-loop value. Dynamic targets (a macro-ref name like
     * `` `i' ``) are intentionally skipped — that is a documented out-of-scope
     * limitation (the (re)defined macro's name is not statically known).
     */
    /**
     * True if a macro-creating command (built-in or user program) has a matched
     * `local()`/`global()` option whose argument is NOT a literal identifier —
     * so the created macro's name is determined at runtime (e.g.
     * `` levelsof x, local(`i') ``). Such a redefinition has an unknown target.
     */
    private command_creates_dynamic_macro(
        node: CommandNode,
        symbols: SymbolTable
    ): boolean {
        if (!node.options) return false;
        const builtin_cmd = find_macro_creating_command(node.fullName);
        const program_options =
            this.get_program_macro_creating_options(node.fullName, symbols);
        if (!builtin_cmd && !program_options) return false;
        for (const my_option of node.options) {
            let matches = false;
            if (builtin_cmd) {
                for (const opt of builtin_cmd.local_options) {
                    if (matches_option(my_option.name, opt)) matches = true;
                }
                for (const opt of builtin_cmd.global_options) {
                    if (matches_option(my_option.name, opt)) matches = true;
                }
            } else if (program_options) {
                const my_lower = my_option.name.toLowerCase();
                matches =
                    program_options.local_options.some((o) => o.toLowerCase() === my_lower)
                    || program_options.global_options.some((o) => o.toLowerCase() === my_lower);
            }
            if (matches) {
                const parsed = parse_option_argument(my_option.argument);
                if (!parsed.is_literal || !parsed.identifier) return true;
            }
        }
        return false;
    }

    /**
     * Targets of a `macro drop`/`mac drop` command, which clears GLOBAL macros.
     * Literal names are returned for poisoning; `_all` or a name with a `*`/`?`
     * wildcard makes the set of dropped macros unknown.
     */
    private get_macro_drop_targets(
        node: CommandNode
    ): { names: string[]; unknown: boolean } {
        if (node.fullName !== 'macro' && node.fullName !== 'mac') {
            return { names: [], unknown: false };
        }
        const the_args = node.varlist ?? [];
        // First varlist item is the `drop` subcommand (allow abbreviations).
        if (the_args.length < 2 || !/^dr(o(p)?)?$/.test(the_args[0].name)) {
            return { names: [], unknown: false };
        }
        const names: string[] = [];
        let unknown = false;
        for (const my_arg of the_args.slice(1)) {
            const my_name = my_arg.name;
            if (my_name === '_all' || /[*?]/.test(my_name)) {
                unknown = true;
            } else if (is_valid_identifier(my_name)) {
                names.push(my_name);
            }
        }
        return { names, unknown };
    }

    /**
     * Names a call to a known user program writes back into the CALLER scope via
     * `c_local` (mirrors the c_local registration in `process_command`). Used by
     * the loop expander to poison those caller locals in execution order.
     */
    private get_program_c_local_names(
        node: CommandNode,
        symbols: SymbolTable
    ): string[] {
        let program = symbols.programs.get(node.fullName);
        if (!program && this.workspace_symbols) {
            program = this.workspace_symbols.programs.get(node.fullName);
        }
        return program?.c_locals ? [...program.c_locals] : [];
    }

    private get_command_redefined_macro_names(node: CommandNode): string[] {
        const cmd_name = node.fullName;
        const names: string[] = [];
        const push_literal = (name: string | undefined): void => {
            if (name && is_valid_identifier(name)) names.push(name);
        };
        if (
            cmd_name === 'tempvar' || cmd_name === 'tempfile'
            || cmd_name === 'tempname' || cmd_name === 'args'
        ) {
            for (const my_var of node.varlist ?? []) push_literal(my_var.name);
        } else if (cmd_name === 'unab') {
            push_literal(node.varlist?.[0]?.name);
        } else if (cmd_name === 'gettoken' || cmd_name === 'gettok') {
            const max_macros = Math.min(node.varlist?.length ?? 0, 2);
            for (let i = 0; i < max_macros; i++) {
                push_literal(node.varlist![i].name);
            }
        } else if (cmd_name === 'file' || cmd_name === 'fil' || cmd_name === 'fi') {
            // `file read handle macroname` — only the "read" subcommand creates
            // a macro, stored in varlist[2] (see extract_file_read_macro).
            if ((node.varlist?.length ?? 0) >= 3 && node.varlist![0].name === 'read') {
                push_literal(node.varlist![2].name);
            }
        }
        return names;
    }

    private get_command_created_macros(
        node: CommandNode,
        symbols: SymbolTable
    ): Array<{ scope: 'local' | 'global'; name: string; argument_range?: Range }> {
        if (!node.options) {
            return [];
        }

        // Built-in macro-creating command, or a user-defined program with
        // macro-creating options.
        const builtin_cmd = find_macro_creating_command(node.fullName);
        const program_options =
            this.get_program_macro_creating_options(node.fullName, symbols);
        if (!builtin_cmd && !program_options) {
            return [];
        }

        // Pre-build Sets of matching option names to avoid O(n²) complexity.
        const local_option_names = new Set<string>();
        const global_option_names = new Set<string>();
        if (builtin_cmd) {
            for (const option of node.options) {
                for (const opt of builtin_cmd.local_options) {
                    if (matches_option(option.name, opt)) {
                        local_option_names.add(option.name.toLowerCase());
                    }
                }
                for (const opt of builtin_cmd.global_options) {
                    if (matches_option(option.name, opt)) {
                        global_option_names.add(option.name.toLowerCase());
                    }
                }
            }
        } else if (program_options) {
            for (const option_name of program_options.local_options) {
                local_option_names.add(option_name.toLowerCase());
            }
            for (const option_name of program_options.global_options) {
                global_option_names.add(option_name.toLowerCase());
            }
        }

        const the_created: Array<{
            scope: 'local' | 'global';
            name: string;
            argument_range?: Range;
        }> = [];
        for (const option of node.options) {
            const parse_result = parse_option_argument(option.argument);
            if (!parse_result.is_literal || !parse_result.identifier) {
                continue;
            }
            const option_name = option.name.toLowerCase();
            if (local_option_names.has(option_name)) {
                the_created.push({
                    scope: 'local',
                    name: parse_result.identifier,
                    argument_range: option.argument_range,
                });
            } else if (global_option_names.has(option_name)) {
                the_created.push({
                    scope: 'global',
                    name: parse_result.identifier,
                    argument_range: option.argument_range,
                });
            }
        }
        return the_created;
    }

    /**
     * Process a loop (foreach/forvalues).
     * Loop variables are locals with lifetime matching the enclosing scope.
     */
    private process_loop(
        node: ControlFlowNode,
        symbols: SymbolTable,
        current_scope: ScopeInfo,
        all_scopes: ScopeInfo[],
        node_index: number
    ): void {
        // Loop variable is a local macro in the enclosing scope
        if (node.loopVar) {
            // Check if macro already exists (first definition wins)
            const existing = symbols.localMacros.get(node.loopVar);
            
            const macro_symbol: MacroSymbol = {
                name: node.loopVar,
                scope: 'local',
                location: { uri: this.uri, range: node.range },
                sourceUri: this.uri,
                containingScope: current_scope.type,
                definition_index: existing?.definition_index ?? node_index,
                definition_line: existing?.definition_line ?? node.range.start.line,
            };

            // Add to enclosing scope (not a new scope) only if not already defined
            if (!existing) {
                current_scope.localMacros.set(node.loopVar, macro_symbol);
                symbols.localMacros.set(node.loopVar, macro_symbol);
            }
        }

        // Resolve the iteration value-set BEFORE processing the body so the
        // list can only reference macros defined before the loop.
        const loop_type = node.type === 'forvalues' ? 'forvalues' : 'foreach';
        // Static folding must see only the locals visible in the ACTIVE scope
        // (plus file-wide globals). `symbols.localMacros` accumulates locals
        // from EVERY scope (e.g. program bodies), so folding against it would
        // let a top-level `foreach i of local list` resolve a `local list` that
        // exists only inside some program — fabricating concrete names that are
        // never defined in this scope and suppressing real undefined warnings.
        // `current_scope.localMacros` holds the active scope's locals; globals
        // are genuinely file-wide.
        const scoped_macros: Pick<SymbolTable, 'localMacros' | 'globalMacros'> = {
            localMacros: current_scope.localMacros,
            globalMacros: symbols.globalMacros,
        };
        const value_set = resolve_loop_value_set(
            loop_type,
            node.loopSpec,
            build_static_value_env(scoped_macros)
        );
        const pushed = value_set.kind === 'static' && !!node.loopVar;
        if (pushed) {
            this.loop_frames.push({
                var: node.loopVar!,
                values: (value_set as { kind: 'static'; values: string[] }).values,
            });
        }

        // The loop body is guaranteed to execute (≥1 iteration) only when the
        // value-set is static AND non-empty. A dynamic or empty-value-set loop
        // body may not run, so a constructed name inside it must not be
        // expanded — and any nested static loop must be suppressed too.
        const guaranteed = pushed
            && (value_set as { kind: 'static'; values: string[] }).values.length > 0;
        // Expand only when this loop runs unconditionally AND the whole
        // enclosing context does too (no `if`/`while` or non-guaranteed loop
        // above us). Snapshot the pre-loop macros (cloning additional_definitions
        // so body redefinitions cannot retroactively poison the fold) so the
        // fold sees only macros visible before the loop, and expand AFTER the
        // body is walked so a body-literal definition of the same concrete name
        // remains the primary symbol.
        const can_expand = guaranteed && this.tokens != null && this.nonexec_depth === 0;
        const pre_loop_macros = can_expand
            ? this.snapshot_macro_maps(scoped_macros)
            : undefined;
        if (!guaranteed) this.nonexec_depth++;
        try {
            // Process loop body with the same scope (loop doesn't create new
            // scope). build_symbols_in_body tracks cd-nesting depth (issue #252).
            this.build_symbols_in_body(node.body, symbols, current_scope, all_scopes);

            if (can_expand && pre_loop_macros && this.tokens) {
                const the_expanded = expand_loop_body(
                    node,
                    this.tokens,
                    this.loop_frames,
                    pre_loop_macros,
                    // Let the expander poison a helper that the loop body
                    // reassigns via an analyzer-known macro-creating construct
                    // (e.g. `levelsof ..., local(suffix)` or a Mata
                    // `st_local("suffix", ...)`) before a later constructed name
                    // interpolates it.
                    (statement) => {
                        const mata_redefs = this.get_mata_setter_redefinitions(
                            statement
                        );
                        const names = mata_redefs.names;
                        if (statement.type !== 'command') {
                            return mata_redefs;
                        }
                        names.push(
                            ...this.get_command_created_macros(statement, symbols)
                                .map((m) => ({ scope: m.scope, name: m.name }))
                        );
                        // Positional macro-creating commands (gettoken/unab/
                        // args/tempvar/file read) reassign LOCAL macros that the
                        // option-based path above does not cover.
                        for (const my_name of this.get_command_redefined_macro_names(statement)) {
                            names.push({ scope: 'local', name: my_name });
                        }
                        // A call to a user program that `c_local`s names back into
                        // the caller reassigns those caller locals.
                        for (const my_name of this.get_program_c_local_names(statement, symbols)) {
                            names.push({ scope: 'local', name: my_name });
                        }
                        // `macro drop` clears global macros (literal names poison;
                        // `_all`/wildcards are unknown).
                        const the_drop = this.get_macro_drop_targets(statement);
                        for (const my_name of the_drop.names) {
                            names.push({ scope: 'global', name: my_name });
                        }
                        // A macro-creating command with a DYNAMIC target name
                        // (`` local(`i') ``) reassigns an unknown macro.
                        const unknown =
                            mata_redefs.unknown ||
                            the_drop.unknown
                            || this.command_creates_dynamic_macro(statement, symbols);
                        return { names, unknown };
                    }
                );
                for (const my_macro of the_expanded) {
                    this.inject_expanded_macro(
                        my_macro,
                        symbols,
                        current_scope,
                        node_index
                    );
                }
            }
        } finally {
            if (!guaranteed) this.nonexec_depth--;
            if (pushed) {
                this.loop_frames.pop();
            }
        }

        // After the loop, a pre-existing iterator macro holds the LAST iteration
        // value (unknown statically), not its stored pre-loop value. Mark it
        // iteration-dependent so a LATER fold (e.g. `foreach j of local i`) does
        // not use the stale value. This runs AFTER the body/expansion above, so
        // the loop's own expansion and any pre-loop helper that froze `` `i' ``
        // still resolve against the iterator's pre-loop value. A statically
        // empty loop never runs, so it leaves the pre-loop value intact.
        const loop_may_execute = !(
            value_set.kind === 'static'
            && (value_set as { kind: 'static'; values: string[] }).values.length === 0
        );
        if (node.loopVar && loop_may_execute) {
            const existing_iterator = current_scope.localMacros.get(node.loopVar);
            if (existing_iterator && existing_iterator.value !== undefined) {
                existing_iterator.iteration_dependent = true;
            }
        }
    }

    /**
     * The loop expander runs before the analyzer's whole-file Mata setter pass.
     * Reuse that scanner on this embedded-block statement's token slice so a
     * preceding `st_local("helper", ...)` / `st_global("HELPER", ...)` poisons
     * stale pre-loop helper folds in execution order.
     */
    private get_mata_setter_redefinitions(
        statement: StataNode
    ): {
        names: Array<{ scope: 'local' | 'global'; name: string }>;
        unknown: boolean;
    } {
        if (
            statement.type !== 'embedded_block' ||
            statement.language !== 'mata' ||
            this.tokens === undefined
        ) {
            return { names: [], unknown: false };
        }

        const the_tokens = this.tokens.filter(
            token =>
                this.compare_positions(token.range.start, statement.range.start) >= 0 &&
                this.compare_positions(token.range.end, statement.range.end) <= 0
        );
        if (the_tokens.length === 0) {
            return { names: [], unknown: false };
        }

        const temp_symbols = create_empty_symbol_table();
        const unknown = this.extract_mata_st_local_declarations(
            the_tokens,
            temp_symbols,
            [statement]
        );
        const names = [
            ...Array.from(temp_symbols.localMacros.keys()).map(name => ({
                scope: 'local' as const,
                name,
            })),
            ...Array.from(temp_symbols.globalMacros.keys()).map(name => ({
                scope: 'global' as const,
                name,
            })),
        ];
        return { names, unknown };
    }

    /**
     * Snapshot the macro maps for loop expansion. Each `MacroSymbol` is cloned
     * (with its own `additional_definitions` array) so that processing the loop
     * body — which may redefine a pre-loop helper and append to the original
     * symbol's `additional_definitions` — cannot retroactively change what the
     * pre-loop fold sees.
     */
    private snapshot_macro_maps(
        macros: Pick<SymbolTable, 'localMacros' | 'globalMacros'>
    ): Pick<SymbolTable, 'localMacros' | 'globalMacros'> {
        const clone_map = (
            src: Map<string, MacroSymbol>
        ): Map<string, MacroSymbol> => {
            const out = new Map<string, MacroSymbol>();
            for (const [my_name, my_symbol] of src) {
                out.set(my_name, {
                    ...my_symbol,
                    additional_definitions: my_symbol.additional_definitions
                        ? [...my_symbol.additional_definitions]
                        : undefined,
                });
            }
            return out;
        };
        return {
            localMacros: clone_map(macros.localMacros),
            globalMacros: clone_map(macros.globalMacros),
        };
    }

    /**
     * Inject a loop-expanded concrete macro into the symbol table. The source
     * range points at the defining body statement for navigation, and
     * definition_line is that same statement line so later references in the
     * loop body are in scope while earlier references still warn.
     */
    private inject_expanded_macro(
        macro: { name: string; scope: 'local' | 'global'; sourceRange: Range },
        symbols: SymbolTable,
        current_scope: ScopeInfo,
        node_index: number
    ): void {
        const target = macro.scope === 'local'
            ? symbols.localMacros
            : symbols.globalMacros;
        const definition_line = macro.sourceRange.start.line;
        const existing = target.get(macro.name);
        if (existing) {
            // Collision (two loops, or a loop + a real definition): append
            // rather than drop, preserving redeclaration locations.
            if (!existing.additional_definitions) {
                existing.additional_definitions = [];
            }
            const expanded_location = { uri: this.uri, range: macro.sourceRange };
            // Consumers read the PRIMARY definition markers, never
            // additional_definitions: `is_macro_defined` reads
            // definition_line / definition_index, and cross-file include/
            // done-by call-site filtering reads location.range.start.line. So
            // when this expanded definition runs earlier than the current
            // primary (e.g. a constructed `local `i' …` that executes before a
            // later literal `local a …`), it must BECOME the primary — line,
            // index, and location together — or a reference / child include
            // between the two definitions is wrongly treated as undefined / not
            // inherited. The former primary is demoted to additional_definitions
            // so its location is still available for find-references. Only
            // promote when strictly earlier, so the earliest definition wins and
            // no genuine forward reference is suppressed.
            const expanded_is_earlier =
                existing.definition_line === undefined ||
                definition_line < existing.definition_line;
            if (expanded_is_earlier) {
                existing.additional_definitions.push({
                    index: existing.definition_index ?? node_index,
                    line: existing.definition_line ?? definition_line,
                    location: existing.location,
                    is_expanded: existing.is_expanded,
                });
                existing.location = expanded_location;
                existing.definition_line = definition_line;
                existing.definition_index = node_index;
                existing.is_expanded = true;
            } else {
                existing.additional_definitions.push({
                    index: node_index,
                    line: definition_line,
                    location: expanded_location,
                    is_expanded: true,
                });
            }
            return;
        }
        const symbol: MacroSymbol = {
            name: macro.name,
            scope: macro.scope,
            location: { uri: this.uri, range: macro.sourceRange },
            sourceUri: this.uri,
            containingScope: current_scope.type,
            definition_line,
            is_expanded: true,
        };
        target.set(macro.name, symbol);
        if (macro.scope === 'local') {
            current_scope.localMacros.set(macro.name, symbol);
        }
    }

    /**
     * Process control flow (if/while).
     * These don't create new scopes in Stata.
     */
    private process_control_flow(
        node: ControlFlowNode,
        symbols: SymbolTable,
        current_scope: ScopeInfo,
        all_scopes: ScopeInfo[]
    ): void {
        // `if`/`else`/`while` bodies may not execute, so loop-macro expansion
        // inside them must be suppressed. `frame X { ... }` always runs, so it
        // does not gate expansion.
        const is_conditional = node.type !== 'frame';
        if (is_conditional) this.nonexec_depth++;
        try {
            // Process body with the same scope
            this.build_symbols_in_body(node.body, symbols, current_scope, all_scopes);
        } finally {
            if (is_conditional) this.nonexec_depth--;
        }
    }

    /**
     * Detect undefined macro and variable references.
     * @param inside_program - When true, suppresses undefined global macro
     *   diagnostics because the program may be called after globals are defined.
     */
    private detect_undefined_references(
        nodes: StataNode[],
        symbols: SymbolTable,
        diagnostics: SemanticDiagnostic[],
        reported_ranges: Set<string>,
        inside_program = false
    ): void {
        this.traverse_ast_preorder(nodes, (node, node_index) => {
            this.check_node_references(node, symbols, diagnostics, reported_ranges, node_index, inside_program);
        });
    }

    private check_node_references(
        node: StataNode,
        symbols: SymbolTable,
        diagnostics: SemanticDiagnostic[],
        reported_ranges: Set<string>,
        node_index: number,
        inside_program: boolean
    ): void {
        // Check if this line should be ignored
        if (this.config.ignored_lines.has(node.range.start.line)) {
            return;
        }

        switch (node.type) {
            case 'macro_ref':
                // Suppress undefined global macro warnings inside program blocks
                if (inside_program && node.scope === 'global') {
                    break;
                }
                this.check_macro_reference(node, symbols, diagnostics, reported_ranges, node_index);
                break;

            case 'macro_def':
                // Check macro references in extended functions for specific functions that expect macro arguments
                if (node.extendedFunction?.macroRefs) {
                    const FUNCTIONS_WITH_MACRO_ARGS = new Set([
                        'list', // list operations expect macro names as arguments
                        // Other functions like substr, word, etc. may have string/variable args, not macro refs
                    ]);

                    // Only check macro references for functions that expect macro arguments
                    if (FUNCTIONS_WITH_MACRO_ARGS.has(node.extendedFunction.name)) {
                        for (const macro_ref of node.extendedFunction.macroRefs) {
                            // Suppress undefined global macro warnings inside program blocks
                            if (inside_program && macro_ref.scope === 'global') {
                                continue;
                            }
                            this.check_extended_macro_reference(macro_ref, symbols, diagnostics, reported_ranges, node_index);
                        }
                    }
                }
                break;

            case 'command':
                this.check_command_references(node, symbols, diagnostics);
                break;

            case 'program':
                // Recurse into program body with inside_program = true
                this.detect_undefined_references(node.body, symbols, diagnostics, reported_ranges, true);
                break;

            case 'foreach':
            case 'forvalues':
            case 'if':
            case 'else':
            case 'while':
            case 'frame':
                // Recurse into control flow body, preserving inside_program context
                this.detect_undefined_references(node.body, symbols, diagnostics, reported_ranges, inside_program);
                break;

            default:
                break;
        }
    }

    /**
     * Check a macro reference for undefined macros.
     * This is a simplified version that doesn't track scope context.
     * For proper scope tracking, we would need to pass scope context through the tree.
     */
    private check_macro_reference(
        node: { type: 'macro_ref'; scope: 'local' | 'global'; name: string; range: Range },
        symbols: SymbolTable,
        diagnostics: SemanticDiagnostic[],
        reported_ranges: Set<string>,
        reference_index: number
    ): void {
        if (!this.config.undefined_macro_enabled) {
            return;
        }

        const is_defined = this.is_macro_defined(
            node.name,
            node.scope,
            symbols,
            reference_index,
            node.range.start.line,
            node.range
        );

        if (!is_defined) {
            const range_key = `${node.range.start.line}:${node.range.start.character}:${node.range.end.line}:${node.range.end.character}`;
            reported_ranges.add(range_key);
            diagnostics.push({
                message: format_undefined_macro_message(node.scope, node.name),
                range: node.range,
                code: StataDiagnosticCode.UNDEFINED_MACRO,
                severity: 'warning',
                symbol_name: node.name,
                reference_kind: node.scope,
            });
        }
    }

    /**
     * Check macro reference from extended function for undefined macros.
     */
    private check_extended_macro_reference(
        macro_ref: { name: string; range: Range; scope: 'local' | 'global' },
        symbols: SymbolTable,
        diagnostics: SemanticDiagnostic[],
        reported_ranges: Set<string>,
        reference_index: number
    ): void {
        if (!this.config.undefined_macro_enabled) {
            return;
        }

        const is_defined = this.is_macro_defined(
            macro_ref.name,
            macro_ref.scope,
            symbols,
            reference_index,
            macro_ref.range.start.line,
            macro_ref.range
        );

        if (!is_defined) {
            const range_key = `${macro_ref.range.start.line}:${macro_ref.range.start.character}:${macro_ref.range.end.line}:${macro_ref.range.end.character}`;
            reported_ranges.add(range_key);
            diagnostics.push({
                message: format_undefined_macro_message(
                    macro_ref.scope,
                    macro_ref.name
                ),
                range: macro_ref.range,
                code: StataDiagnosticCode.UNDEFINED_MACRO,
                severity: 'warning',
                symbol_name: macro_ref.name,
                reference_kind: macro_ref.scope,
            });
        }
    }

    /**
     * Check command for undefined variable references.
     */
    private check_command_references(
        node: CommandNode,
        symbols: SymbolTable,
        diagnostics: SemanticDiagnostic[]
    ): void {
        if (!this.config.undefined_variable_enabled) {
            return;
        }

        // Skip variable-creating commands
        const cmd_name = node.fullName;
        if (cmd_name === 'generate' || cmd_name === 'gen' || 
            cmd_name === 'egen' || cmd_name === 'input' ||
            cmd_name === 'tempvar' || cmd_name === 'unab') {
            return;
        }

        // Check varlist for undefined variables
        if (node.varlist) {
            for (const var_node of node.varlist) {
                const is_defined = this.is_variable_defined(
                    var_node.name,
                    symbols,
                    var_node.range.start.line
                );

                if (!is_defined) {
                    diagnostics.push({
                        message: format_undefined_variable_message(
                            var_node.name
                        ),
                        range: var_node.range,
                        code: StataDiagnosticCode.UNDEFINED_VARIABLE,
                        severity: 'information',
                        symbol_name: var_node.name,
                        reference_kind: 'variable',
                    });
                }
            }
        }
    }

    /**
     * Check if a macro name is a positional argument.
     * Positional arguments are numeric macro names (`0', `1', `2', etc.)
     * that represent command-line arguments passed to do-files.
     * 
     * @param name - The macro name to check
     * @returns true if the name is a non-negative integer (positional argument)
     */
    private is_positional_argument(name: string): boolean {
        return /^[0-9]+$/.test(name);
    }

    /**
     * Check if a macro name is a Stata system-defined global macro.
     * System globals are automatically set by Stata at runtime.
     * 
     * @param name - The macro name to check (without $ prefix)
     * @returns true if the name is a known system global
     */
    private is_system_global(name: string): boolean {
        return STATA_SYSTEM_GLOBALS.has(name);
    }

    /**
     * Check if a macro is defined.
     * Macros are case-sensitive.
     * Also checks declaration directives (@lsp-local, @lsp-global) with forward-only effect.
     * Falls back to workspace symbols if not found locally.
     */
    private is_macro_defined(
        name: string,
        scope: 'local' | 'global',
        symbols: SymbolTable,
        reference_index?: number,
        reference_line?: number,
        reference_range?: Range
    ): boolean {
        if (scope === 'local') {
            // Check for positional arguments (numeric macro names like `1', `2', etc.)
            // These are always potentially defined as they represent command-line arguments
            if (this.is_positional_argument(name)) {
                return true;
            }

            // Check declared locals from @lsp-local directive (forward-only effect)
            const declared_local = this.config.declared_locals.get(name);
            if (declared_local) {
                // Only suppress warning if reference is at or after the directive line
                if (reference_line !== undefined && reference_line >= declared_local.line) {
                    return true;
                }
                // If no reference_line, check if we have a reference_index
                // In this case, we can't do forward-only check, so we accept it
                if (reference_line === undefined && reference_index !== undefined) {
                    // We need to be conservative here - the symbol is declared
                    // but we can't verify forward-only without line info
                    // Check the symbol table entry for line info
                    const macro = symbols.localMacros.get(name);
                    if (macro && macro.definition_line !== undefined) {
                        // Use the macro's definition line for comparison
                        // This is set from the directive's line
                        return true; // Symbol exists in table, let normal check handle it
                    }
                }
            }

            // Check local macros (case-sensitive)
            // For local macros, we need to check if ANY definition exists
            // since we don't have proper scope tracking yet
            const macro = symbols.localMacros.get(name);
            if (macro) {
                return this.macro_resolves_at_reference(
                    macro,
                    reference_index,
                    reference_line,
                    reference_range
                );
            }

            // NOTE: Workspace symbols do NOT suppress undefined macro warnings.
            // Only cross-file directives (@lsp-done-by, @lsp-included-by, @lsp-do, etc.)
            // provide scope resolution. Workspace symbols are used only for:
            // - Completions and go-to-definition
            // - Looking up called programs for c_locals registration
        } else {
            // Check declared globals from @lsp-global directive (forward-only effect)
            const declared_global = this.config.declared_globals.get(name);
            if (declared_global) {
                // Only suppress warning if reference is at or after the directive line
                if (reference_line !== undefined && reference_line >= declared_global.line) {
                    return true;
                }
                // If no reference_line, check if we have a reference_index
                if (reference_line === undefined && reference_index !== undefined) {
                    const macro = symbols.globalMacros.get(name);
                    if (macro && macro.definition_line !== undefined) {
                        return true; // Symbol exists in table, let normal check handle it
                    }
                }
            }

            // Check global macros (case-sensitive)
            const macro = symbols.globalMacros.get(name);
            if (macro) {
                return this.macro_resolves_at_reference(
                    macro,
                    reference_index,
                    reference_line,
                    reference_range
                );
            }

            // NOTE: Workspace symbols do NOT suppress undefined macro warnings.
            // Only cross-file directives provide scope resolution.

            // NEW: Check for system-defined global macros as FALLBACK
            // Only reached if not found in symbol table or directives
            if (this.is_system_global(name)) {
                return true;
            }
        }

        return false;
    }

    private is_reference_before_macro_definition(
        macro: MacroSymbol,
        reference_range?: Range
    ): boolean {
        if (reference_range === undefined) {
            return false;
        }
        // The same-line character ordering is only meaningful when the
        // macro's effective `definition_line` coincides with its physical
        // location — then the location's character marks where it becomes
        // visible on that line. Macros whose `definition_line` is
        // deliberately earlier than their location, notably `args` macros
        // (`definition_line === 0`, visible from the start of scope), are
        // already in scope on the reference's line and must not be treated as
        // a same-line forward reference.
        const definition_line =
            macro.definition_line ?? macro.location.range.start.line;
        if (definition_line !== macro.location.range.start.line) {
            return false;
        }
        return (
            macro.location.range.start.line === reference_range.start.line &&
            this.compare_ranges(reference_range, macro.location.range) < 0
        );
    }

    /**
     * Forward-visibility check shared by the local- and global-macro branches
     * of `is_macro_defined`: given a macro found in the symbol table, is it
     * visible at the reference? A Mata setter's `visibility_start` is the
     * authoritative answer when present (the macro is visible only after its
     * inline unit ends); otherwise fall back to preorder-index, line-number,
     * and same-line forward-reference checks. Identical for both scopes — the
     * scope-specific lookups and fallbacks stay in `is_macro_defined`.
     */
    private macro_resolves_at_reference(
        macro: MacroSymbol,
        reference_index?: number,
        reference_line?: number,
        reference_range?: Range
    ): boolean {
        if (macro.visibility_start !== undefined) {
            return !this.is_reference_before_visibility_start(
                macro,
                reference_line,
                reference_range
            );
        }
        // Forward reference by preorder index.
        if (
            reference_index !== undefined &&
            macro.definition_index !== undefined &&
            macro.definition_index > reference_index
        ) {
            return false;
        }
        // Forward reference by line number.
        if (
            reference_line !== undefined &&
            macro.definition_line !== undefined &&
            macro.definition_line > reference_line
        ) {
            return false;
        }
        // Same-line forward reference.
        if (this.is_reference_before_macro_definition(macro, reference_range)) {
            return false;
        }
        return true;
    }

    /**
     * For a Mata setter with a `visibility_start` (the end of its inline
     * `mata:` unit), is the reference before that point — i.e. still inside
     * the same Mata unit, where the macro is not yet defined? Uses the precise
     * reference position when available, else the line.
     */
    private is_reference_before_visibility_start(
        macro: MacroSymbol,
        reference_line?: number,
        reference_range?: Range
    ): boolean {
        const visibility_start = macro.visibility_start;
        if (visibility_start === undefined) {
            return false;
        }
        if (reference_range !== undefined) {
            return (
                this.compare_positions(
                    reference_range.start,
                    visibility_start
                ) < 0
            );
        }
        if (reference_line !== undefined) {
            return reference_line < visibility_start.line;
        }
        return false;
    }

    /**
     * Check if a variable is defined.
     * Variables are case-sensitive.
     * NOTE: Workspace symbols do NOT suppress undefined variable warnings.
     */
    private is_variable_defined(
        name: string,
        symbols: SymbolTable,
        reference_line: number
    ): boolean {
        // Check local symbol table
        if (symbols.variables.has(name)) {
            return true;
        }

        // Check declared variables from @lsp-variables directive.
        // Forward-only: the declaration is effective on its own
        // line and after, so a reference on an earlier line still
        // warns.
        const declared = this.config.declared_variables.get(name);
        if (declared !== undefined && reference_line >= declared.line) {
            return true;
        }

        // NOTE: Workspace symbols do NOT suppress undefined variable warnings.
        // Only cross-file directives provide scope resolution.

        return false;
    }

    /**
     * Collect line ranges of program block bodies from the AST (recursively).
     * Uses exclusive boundaries (start.line + 1, end.line - 1) to match
     * the AST pass which only operates on body nodes, not the header/end lines.
     */
    private collect_program_ranges(nodes: StataNode[]): Array<[number, number]> {
        const the_ranges: Array<[number, number]> = [];
        for (const my_node of nodes) {
            if (my_node.type === 'program') {
                // Exclude the header line (program define ...) and the end line
                the_ranges.push([my_node.range.start.line + 1, my_node.range.end.line - 1]);
                // Recurse for nested programs
                the_ranges.push(...this.collect_program_ranges(my_node.body));
            } else if ('body' in my_node && Array.isArray(my_node.body)) {
                the_ranges.push(...this.collect_program_ranges(my_node.body));
            }
        }
        return the_ranges;
    }

    /**
     * Full (character-precise) ranges of every program block, including
     * nested ones. Used to scope Mata setters precisely even when a setter
     * shares a physical line with the program header or its `end`.
     */
    private collect_program_position_ranges(nodes: StataNode[]): Range[] {
        const the_ranges: Range[] = [];
        for (const my_node of nodes) {
            if (my_node.type === 'program') {
                the_ranges.push(my_node.range);
                the_ranges.push(
                    ...this.collect_program_position_ranges(my_node.body)
                );
            } else if ('body' in my_node && Array.isArray(my_node.body)) {
                the_ranges.push(
                    ...this.collect_program_position_ranges(my_node.body)
                );
            }
        }
        return the_ranges;
    }

    /** Is `position` within `range` (inclusive), comparing line then char? */
    private position_within_range(
        position: { line: number; character: number },
        range: Range
    ): boolean {
        return (
            this.compare_positions(position, range.start) >= 0 &&
            this.compare_positions(position, range.end) <= 0
        );
    }

    /**
     * Recognize `st_local("name", value)` / `st_global("name", value)` setter
     * calls inside Mata blocks and register the named macro as a definition.
     *
     * In Stata's Mata, the two-argument form `st_local(name, value)` SETS a
     * local macro in the calling Stata scope, whereas the one-argument form
     * `st_local(name)` only READS it — so only the two-argument (setter) form
     * declares a macro here. The name must be a literal double-quoted
     * identifier; dynamic names (variables, expressions, compound quotes, or
     * embedded macro references) cannot be resolved statically and are
     * skipped.
     *
     * Operates on the flat token stream (the same approach as
     * `check_token_macro_references`) so it sees the real, positioned `STRING`
     * tokens for both the inline (`mata:`) and block (`mata` ... `end` /
     * `mata { ... }`) forms, and never false-matches `st_local(...)` text that
     * merely appears inside a string literal.
     *
     * Like every other local-defining construct in this analyzer, the macro is
     * registered into the flat, file-global symbol table (program-scoping is
     * tracked separately in issue #261). Forward-only visibility is preserved
     * via `definition_line` (the call's line), matching `local` / `c_local`.
     *
     * NOTE ON THE PER-TOKEN-TYPE OPENER/CLOSER BRANCHES BELOW: the several
     * `MATA_START` / `WORD "mata"` / `PYTHON_START` / `WORD "python"` opener
     * cases and the `END_MATA` / `END_PYTHON` / `WORD "end"` closer cases look
     * like collapsible duplication, but each compensates for a DISTINCT lexer
     * degradation that cannot be detected from the token type alone:
     *   - `#delimit ;` re-lexes a plain block's `end` as `WORD "end"` + `;`,
     *     not END_MATA / END_PYTHON;
     *   - a utility one-liner (`mata clear`) leaves the lexer stuck in Mata
     *     context, so a later `mata`/`python` opener arrives as a bare WORD and
     *     a Mata block's `end` can lex as END_PYTHON (and vice versa).
     * They already share the real generalizations (`classify_embedded_block_opener`,
     * `begins_statement` / `ends_statement`, `enter_python_kind`); do NOT merge
     * the remaining branches further — each maps to a specific lexer failure
     * mode, and collapsing them silently drops a handled case. The principled
     * fix is a Mata/Python-aware lexer, which is out of scope here.
     */
    private extract_mata_st_local_declarations(
        tokens: Token[],
        symbols: SymbolTable,
        nodes: StataNode[]
    ): boolean {
        let saw_unknown_setter = false;
        // Position-precise program ranges (start of `program` keyword to end
        // of `end`). Used to scope a setter to `program` vs `dofile`. Unlike
        // the line-based `collect_program_ranges`, this stays correct when a
        // setter shares a physical line with the program header or `end`
        // (common under `#delimit ;`, e.g. `... ;end ;`).
        const program_position_ranges =
            this.collect_program_position_ranges(nodes);

        // Track whether we are inside a Mata block / inline expression:
        //   'inline'      — `mata: <expr>`, ends at the statement terminator
        //   'block_plain' — `mata` ... `end`
        //   'block_brace' — `mata { ... }`, ends at the matching `}`
        type MataMode = 'inline' | 'block_plain' | 'block_brace' | null;
        let mata_mode: MataMode = null;
        let brace_depth = 0;
        let mata_function_body_depth = 0;
        // Python blocks are a separate embedded language. Their bodies lex as
        // WORD tokens, so without tracking Python context a statement that
        // happens to start with `mata` would trip the Mata re-entry below and
        // misread Python `st_local(...)` text as a Stata setter. The scan is
        // inert while inside a Python block. A `python:` / `python` block ends
        // with END_PYTHON; a brace-style `python { ... }` block ends with the
        // matching RBRACE, so track its brace depth to find the close.
        let in_python_block = false;
        let python_is_brace = false;
        let python_brace_depth = 0;
        // Inline Python (`python: <stmt>`) runs to the end of the logical line;
        // any Mata-looking tokens on that line are Python, not Mata, so stay
        // inert from PYTHON_INLINE through its statement terminator.
        let in_inline_python = false;

        // Entering or leaving any Mata unit zeroes both depth counters
        // together. The mode itself (`mata_mode = ...`) stays an explicit
        // assignment at each site so TypeScript can still narrow `mata_mode`
        // at the brace-tracking reads below — routing it through a closure
        // would hide the `block_*` writes from control-flow analysis.
        const reset_mata_depths = (): void => {
            brace_depth = 0;
            mata_function_body_depth = 0;
        };
        // Enter the Python state implied by an opener `kind` (shared by the
        // PYTHON_START token and the bare-`WORD "python"` re-entry used when
        // the lexer is stuck in Mata context). Returns whether a Python region
        // was entered — `subcommand` (e.g. `python query`) is a one-liner and
        // enters nothing, so a following real Mata block is still scanned.
        const enter_python_kind = (
            kind: 'inline' | 'block_brace' | 'block_plain' | 'subcommand'
        ): boolean => {
            if (kind === 'inline') {
                in_inline_python = true;
                return true;
            }
            if (kind === 'block_brace' || kind === 'block_plain') {
                in_python_block = true;
                python_is_brace = kind === 'block_brace';
                python_brace_depth = 0;
                return true;
            }
            return false;
        };

        // `skip_terminators` crosses STATEMENT_TERMINATOR tokens
        // unconditionally. Mata block calls (`mata` ... `end` / `mata { }`)
        // may span physical lines WITHOUT a `///` continuation, so a setter
        // formatted as `st_local(\n "foo", value)` puts a terminator between
        // the `(` and the name literal. The name/comma lookups pass this in
        // block mode so such calls are still recognized; inline `mata:` keeps
        // the default (a bare newline ends the statement there).
        const next_significant = (
            from: number,
            skip_terminators = false
        ): number => {
            let j = from;
            let after_continuation = false;
            while (j < tokens.length) {
                const token = tokens[j];
                if (MATA_SCAN_SKIP_TOKENS.has(token.type)) {
                    if (token.type === 'CONTINUATION') {
                        after_continuation = true;
                    }
                    j++;
                    continue;
                }
                if (
                    token.type === 'STATEMENT_TERMINATOR' &&
                    (after_continuation || skip_terminators)
                ) {
                    after_continuation = false;
                    j++;
                    continue;
                }
                break;
            }
            return j;
        };
        const is_continuation_terminator = (index: number): boolean =>
            this.is_continuation_terminator_at(tokens, index);
        const previous_significant = (from: number): number => {
            let j = from;
            while (j >= 0) {
                const token = tokens[j];
                if (MATA_SCAN_SKIP_TOKENS.has(token.type)) {
                    j--;
                    continue;
                }
                if (
                    token.type === 'STATEMENT_TERMINATOR' &&
                    is_continuation_terminator(j)
                ) {
                    j--;
                    continue;
                }
                break;
            }
            return j;
        };
        // A token begins a statement when the previous significant token is a
        // statement boundary: STATEMENT_TERMINATOR, the block opener
        // (MATA_START), a top-level function body's closing `}` (RBRACE), or —
        // under `#delimit ;`, where interior terminators lex as
        // `EMBEDDED_CONTENT ";"` — an embedded `;`. Start-of-input also counts.
        const begins_statement = (index: number): boolean => {
            const previous_idx = previous_significant(index - 1);
            if (previous_idx < 0) {
                return true;
            }
            const previous_token = tokens[previous_idx];
            return (
                previous_token.type === 'STATEMENT_TERMINATOR' ||
                previous_token.type === 'MATA_START' ||
                previous_token.type === 'RBRACE' ||
                (previous_token.type === 'EMBEDDED_CONTENT' &&
                    previous_token.value.trimEnd().endsWith(';'))
            );
        };
        // A token is its own complete statement when the next significant token
        // is a statement boundary (or end-of-input / END_MATA).
        const ends_statement = (index: number): boolean => {
            const next_idx = next_significant(index + 1);
            if (next_idx >= tokens.length) {
                return true;
            }
            const next_token = tokens[next_idx];
            return (
                next_token.type === 'STATEMENT_TERMINATOR' ||
                next_token.type === 'END_MATA' ||
                (next_token.type === 'EMBEDDED_CONTENT' &&
                    next_token.value.trimStart().startsWith(';'))
            );
        };
        const is_qualified_mata_call_name = (index: number): boolean => {
            const previous_idx = previous_significant(index - 1);
            if (previous_idx < 0) {
                return false;
            }
            const previous_value = tokens[previous_idx].value.trimEnd();
            if (
                previous_value.endsWith('.') ||
                previous_value.endsWith('::') ||
                previous_value.endsWith('->')
            ) {
                return true;
            }

            const before_previous_idx = previous_significant(previous_idx - 1);
            if (before_previous_idx < 0) {
                return false;
            }
            const before_previous_value =
                tokens[before_previous_idx].value.trimEnd();
            return (
                (previous_value === ':' &&
                    before_previous_value.endsWith(':')) ||
                (previous_value === '>' && before_previous_value.endsWith('-'))
            );
        };
        // The opening paren and the argument-separating comma surface as
        // `LPAREN`/`COMMA` in the inline form (Stata-context tokens) but as
        // `EMBEDDED_CONTENT` in block form. The comma may be coalesced with
        // following punctuation, e.g. `,(`, so accept embedded content that
        // starts with the delimiter.
        const is_open_paren = (token: Token): boolean =>
            token.type === 'LPAREN' ||
            (token.type === 'EMBEDDED_CONTENT' && token.value.trim() === '(');
        const is_comma = (token: Token): boolean =>
            token.type === 'COMMA' ||
            (token.type === 'EMBEDDED_CONTENT' &&
                token.value.trimStart().startsWith(','));
        const find_setter_comma = (
            from: number,
            cross_lines: boolean
        ): number => {
            let paren_depth = 0;
            for (let k = from; k < tokens.length; k++) {
                const my_token = tokens[k];
                if (
                    !cross_lines &&
                    my_token.type === 'STATEMENT_TERMINATOR' &&
                    !is_continuation_terminator(k)
                ) {
                    return -1;
                }
                if (
                    my_token.type === 'END_MATA' ||
                    my_token.type === 'END_PYTHON' ||
                    my_token.type === 'RBRACE' ||
                    (
                        my_token.type === 'WORD' &&
                        my_token.value === 'end' &&
                        begins_statement(k) &&
                        ends_statement(k)
                    )
                ) {
                    return -1;
                }
                if (
                    my_token.type === 'STRING' ||
                    my_token.type === 'COMMENT_LINE' ||
                    my_token.type === 'COMMENT_BLOCK'
                ) {
                    continue;
                }
                for (const my_char of my_token.value) {
                    if (my_char === '(') {
                        paren_depth++;
                    } else if (my_char === ')') {
                        if (paren_depth === 0) {
                            return -1;
                        }
                        paren_depth--;
                    } else if (my_char === ',' && paren_depth === 0) {
                        return k;
                    }
                }
            }
            return -1;
        };

        for (let i = 0; i < tokens.length; i++) {
            const token = tokens[i];
            // Track Python blocks and stay inert inside them.
            if (token.type === 'PYTHON_START') {
                mata_mode = null;
                reset_mata_depths();
                // The lexer emits PYTHON_START for any leading `python`,
                // including one-line subcommands like `python query` /
                // `python set ...` that do NOT open a block. Classify the
                // opener (the logic is shared with Mata) to decide what we
                // entered; a `subcommand` enters nothing so a following real
                // Mata block is still scanned. Brace-style `python { ... }`
                // closes with the matching RBRACE rather than END_PYTHON.
                enter_python_kind(this.classify_embedded_block_opener(tokens, i));
                continue;
            }
            if (token.type === 'END_PYTHON') {
                in_python_block = false;
                python_is_brace = false;
                python_brace_depth = 0;
                // `end` closes whatever embedded block is open. When the lexer
                // is stuck in Mata context (e.g. after `mata clear`), a Mata
                // block's closing `end` can lex as END_PYTHON, so also reset
                // Mata mode here (you cannot be in both at once, so this is
                // safe in normal state).
                mata_mode = null;
                reset_mata_depths();
                continue;
            }
            if (in_python_block) {
                // For a brace-style block, balance braces to find the close
                // (nested `{ }` in Python code are counted and ignored).
                if (python_is_brace) {
                    if (token.type === 'LBRACE') {
                        python_brace_depth++;
                    } else if (token.type === 'RBRACE') {
                        python_brace_depth--;
                        if (python_brace_depth <= 0) {
                            in_python_block = false;
                            python_is_brace = false;
                        }
                    }
                } else if (token.type === 'END_MATA') {
                    // A non-brace Python block normally closes with
                    // END_PYTHON (handled above). When the lexer is stuck in
                    // Mata context (e.g. after `mata clear`) the closing `end`
                    // lexes as END_MATA instead, so treat it as the block
                    // close too — a real Mata block never contains END_MATA
                    // inside a Python region, so this is safe in normal state.
                    in_python_block = false;
                } else if (
                    token.type === 'WORD' &&
                    token.value === 'end' &&
                    begins_statement(i) &&
                    ends_statement(i)
                ) {
                    // Under `#delimit ;` a plain `python ; ... end ;` block's
                    // closing `end` lexes as `WORD "end"` + embedded `;`, not
                    // END_PYTHON, so recognize a standalone `end` statement as
                    // the block close (mirrors the Mata plain-block WORD-"end"
                    // terminator). Without this the scan stays inert and skips
                    // later Mata setters.
                    in_python_block = false;
                }
                continue;
            }
            // Inline `python: <stmt>` makes the rest of the logical line
            // Python; ignore any Mata-looking tokens until the statement
            // terminator (a trailing `///` continuation extends the line).
            if (token.type === 'PYTHON_INLINE') {
                in_inline_python = true;
                mata_mode = null;
                reset_mata_depths();
                continue;
            }
            if (in_inline_python) {
                if (
                    token.type === 'STATEMENT_TERMINATOR' &&
                    !is_continuation_terminator(i)
                ) {
                    in_inline_python = false;
                }
                continue;
            }
            switch (token.type) {
                case 'MATA_INLINE':
                    mata_mode = 'inline';
                    mata_function_body_depth = 0;
                    continue;
                case 'MATA_START': {
                    // The lexer emits MATA_START for any leading `mata`,
                    // including utility one-liners like `mata clear` that do
                    // NOT open a block. Classify the opener to decide what (if
                    // anything) we entered.
                    const kind = this.classify_embedded_block_opener(tokens, i);
                    if (kind === 'subcommand') {
                        // Not a block opener; stay out of Mata mode.
                        continue;
                    }
                    mata_mode = kind;
                    reset_mata_depths();
                    continue;
                }
                case 'END_MATA':
                    mata_mode = null;
                    reset_mata_depths();
                    continue;
                case 'STATEMENT_TERMINATOR':
                    if (
                        mata_mode === 'inline' &&
                        !is_continuation_terminator(i)
                    ) {
                        mata_mode = null;
                        mata_function_body_depth = 0;
                    }
                    continue;
                case 'LBRACE':
                    if (mata_mode === 'block_brace') {
                        brace_depth++;
                    }
                    if (mata_mode !== null) {
                        if (mata_function_body_depth > 0) {
                            mata_function_body_depth++;
                        } else if (this.is_mata_function_body_start(tokens, i)) {
                            mata_function_body_depth = 1;
                        }
                    }
                    continue;
                case 'RBRACE':
                    if (mata_function_body_depth > 0) {
                        mata_function_body_depth--;
                    }
                    if (mata_mode === 'block_brace') {
                        brace_depth--;
                        if (brace_depth <= 0) {
                            mata_mode = null;
                            mata_function_body_depth = 0;
                        }
                    }
                    continue;
            }

            // The lexer normally emits PYTHON_START / PYTHON_INLINE for a
            // `python` opener, but a preceding Mata utility one-liner (e.g.
            // `mata clear`) leaves the lexer stuck in Mata context, so a later
            // `python` opener arrives as a bare `WORD` (its `:` / `{` as
            // EMBEDDED_CONTENT). Recognize it here and stay inert over the
            // Python region, so embedded `mata` / `st_local` text on those
            // lines is not mistaken for a real Mata setter (which would
            // otherwise trip the `WORD "mata"` re-entry just below). Gate on
            // `mata_mode === null`: only the lexer-stuck/top-level state has
            // this problem. Inside a live Mata block `python` is ordinary Mata
            // code (a variable/expression), not a Stata Python opener, so the
            // block's later setters must keep being scanned.
            if (
                mata_mode === null &&
                token.type === 'WORD' &&
                token.value === 'python' &&
                begins_statement(i)
            ) {
                // Same opener classification as PYTHON_START (shared with
                // Mata). A one-line subcommand (`python query`) is left alone
                // so a following real Mata block is still scanned; only a
                // genuine block / inline opener makes the scan inert.
                const kind = this.classify_embedded_block_opener(tokens, i);
                if (enter_python_kind(kind)) {
                    mata_mode = null;
                    reset_mata_depths();
                    continue;
                }
            }

            // The lexer emits MATA_START / MATA_INLINE only for the FIRST
            // `mata` opener; once it is in Mata context (which a utility
            // one-liner like `mata clear` enters but never closes, and which a
            // `#delimit ;` block leaves open because no END_MATA is emitted),
            // later openers arrive as `WORD "mata"` followed by `:` (inline),
            // `{` (brace), or a separator (plain). Recognize a top-level
            // `mata` WORD here and re-enter the matching mode so subsequent
            // setters are still found. `mata <subcommand>` (e.g. `mata clear`,
            // where a WORD follows) is not a block opener and is left alone.
            if (
                mata_mode === null &&
                token.type === 'WORD' &&
                token.value === 'mata' &&
                begins_statement(i)
            ) {
                // Same opener classification as the MATA_START token (a
                // continued `#delimit ;` block or a utility one-liner leaves
                // the lexer in Mata context, so later openers arrive as a
                // WORD). `subcommand` (`mata clear`) is left alone.
                const kind = this.classify_embedded_block_opener(tokens, i);
                if (kind !== 'subcommand') {
                    mata_mode = kind;
                    reset_mata_depths();
                    continue;
                }
            }
            if (
                mata_mode === 'block_plain' &&
                mata_function_body_depth === 0 &&
                token.type === 'WORD' &&
                token.value === 'end' &&
                begins_statement(i) &&
                ends_statement(i)
            ) {
                mata_mode = null;
                reset_mata_depths();
                continue;
            }

            if (
                mata_mode === null ||
                mata_function_body_depth > 0 ||
                token.type !== 'WORD'
            ) {
                continue;
            }
            if (token.value !== 'st_local' && token.value !== 'st_global') {
                continue;
            }
            if (is_qualified_mata_call_name(i)) {
                continue;
            }

            const scope: 'local' | 'global' =
                token.value === 'st_local' ? 'local' : 'global';

            // Inside a Mata block, a call's argument list may wrap across
            // physical lines without `///`, so cross statement terminators
            // when looking for the name literal and its trailing comma.
            const cross_lines = mata_mode !== 'inline';

            // Expect the call shape: `(` "<name>" `,` ... In block mode the
            // `(` itself may sit on a line after `st_local`, so cross lines
            // here too (the name-literal + comma checks below still guard
            // against false matches).
            const paren_idx = next_significant(i + 1, cross_lines);
            if (paren_idx >= tokens.length || !is_open_paren(tokens[paren_idx])) {
                continue;
            }
            const name_idx = next_significant(paren_idx + 1, cross_lines);
            if (name_idx >= tokens.length) {
                continue;
            }
            const comma_idx = find_setter_comma(name_idx, cross_lines);
            if (comma_idx < 0) {
                continue;
            }
            const name_token = tokens[name_idx];
            const after_name_idx = next_significant(name_idx + 1, cross_lines);
            if (
                name_token.type !== 'STRING' ||
                name_token.quoteStyle === 'compound' ||
                after_name_idx >= tokens.length ||
                !is_comma(tokens[after_name_idx])
            ) {
                saw_unknown_setter = true;
                continue;
            }
            const name_match = MATA_STRING_NAME_RE.exec(name_token.value);
            if (!name_match) {
                saw_unknown_setter = true;
                continue;
            }

            const macro_name = name_match[1];
            const definition_line = token.range.start.line;

            // Forward-only visibility. Stata expands a statement's backtick
            // macros before the code runs, so a setter is not visible to
            // references in the SAME unit. `visibility_start` records where
            // the setter becomes visible; a `` `name' `` reference before it
            // is treated as not-yet-defined, references at/after it resolve.
            //   - Inline `mata:`: the unit is the whole inline line, so anchor
            //     at the line's terminator. This covers the setter's own value
            //     argument (`st_local("x", "`x'")`) and a later sub-statement
            //     on the same line (`st_local("x","1"); y = `x'`).
            //   - Block (`mata` ... `end` / `mata { }`): anchor at the end of
            //     the setter call's matching `)`, so a backtick reference in
            //     the value argument is not-yet-defined. (A reference in a
            //     LATER statement of the same block still resolves; per Stata
            //     it would expand pre-execution too, but that remains an
            //     accepted, documented limitation.)
            // (A continued inline setter whose name literal moves to a later
            // physical line still orders by the call line; go-to-definition
            // points at the literal.)
            let visibility_start:
                | { line: number; character: number }
                | undefined;
            if (mata_mode === 'inline') {
                for (let k = i + 1; k < tokens.length; k++) {
                    if (
                        tokens[k].type === 'STATEMENT_TERMINATOR' &&
                        !is_continuation_terminator(k)
                    ) {
                        visibility_start = tokens[k].range.start;
                        break;
                    }
                }
            } else {
                // Block setter: anchor past the matching close paren. Balance
                // parens by scanning token values, ignoring STRING and comment
                // tokens so a `)`/`(` inside a string literal or a comment
                // (e.g. `st_local("foo", /* ( */ "1")`) does not skew the
                // count and close the call early or never.
                let paren_depth = 0;
                let closed = false;
                for (let k = paren_idx; k < tokens.length && !closed; k++) {
                    if (
                        tokens[k].type === 'STRING' ||
                        tokens[k].type === 'COMMENT_LINE' ||
                        tokens[k].type === 'COMMENT_BLOCK'
                    ) {
                        continue;
                    }
                    for (const my_char of tokens[k].value) {
                        if (my_char === '(') {
                            paren_depth++;
                        } else if (my_char === ')') {
                            paren_depth--;
                            if (paren_depth <= 0) {
                                visibility_start = tokens[k].range.end;
                                closed = true;
                                break;
                            }
                        }
                    }
                }
            }
            // Neither branch found an anchor (inline unit with no terminator —
            // runs to end-of-input; or an unbalanced/malformed block call):
            // fall back to past the last token so references in the unit are
            // still treated as inside it (and there is nothing after it).
            if (visibility_start === undefined && tokens.length > 0) {
                visibility_start = tokens[tokens.length - 1].range.end;
            }

            // Scope the setter to the innermost enclosing program (character-
            // precise, so a setter sharing the program header or `end` line is
            // still attributed correctly). Limitation: the parser only builds
            // `program` block nodes under `#delimit cr`; under `#delimit ;` a
            // `program define ... end` is parsed as flat commands with no
            // block node, so setters there fall back to `dofile` scope.
            const containing_scope: ScopeType = program_position_ranges.some(
                program_range =>
                    this.position_within_range(token.range.start, program_range)
            )
                ? 'program'
                : 'dofile';

            this.register_mata_macro(
                macro_name,
                scope,
                name_token.range,
                definition_line,
                containing_scope,
                symbols,
                visibility_start
            );
        }
        return saw_unknown_setter;
    }

    /**
     * Register a macro discovered from an `st_local`/`st_global` setter.
     * First-definition-wins: if this token-only definition appears earlier
     * than the current primary, promote it and move the old primary into
     * `additional_definitions`; otherwise record it as an additional
     * definition in source order.
     */
    private register_mata_macro(
        name: string,
        scope: 'local' | 'global',
        range: Range,
        definition_line: number,
        containing_scope: ScopeType,
        symbols: SymbolTable,
        visibility_start?: { line: number; character: number }
    ): void {
        // System globals (e.g. `S_DATE`) are always defined. Registering a
        // forward-only symbol for an `st_global("S_DATE", ...)` setter would
        // shadow the `is_system_global` fallback in `is_macro_defined` and
        // make an EARLIER `$S_DATE` reference report as undefined. Leave them
        // to the fallback.
        if (scope === 'global' && this.is_system_global(name)) {
            return;
        }

        const symbol_map =
            scope === 'local' ? symbols.localMacros : symbols.globalMacros;

        const new_symbol: MacroSymbol = {
            name,
            scope,
            location: { uri: this.uri, range },
            sourceUri: this.uri,
            value: scope === 'local' ? '__st_local__' : '__st_global__',
            containingScope: containing_scope,
            definition_line,
            visibility_start,
        };

        const existing = symbol_map.get(name);
        if (!existing) {
            symbol_map.set(name, new_symbol);
            return;
        }

        if (this.is_mata_definition_before(definition_line, range, existing)) {
            const old_primary =
                this.macro_symbol_to_additional_definition(existing);
            new_symbol.additional_definitions = [
                old_primary,
                ...(existing.additional_definitions ?? []),
            ];
            this.sort_additional_definitions(new_symbol.additional_definitions);
            symbol_map.set(name, new_symbol);
            return;
        }

        if (!existing.additional_definitions) {
            existing.additional_definitions = [];
        }
        existing.additional_definitions.push(
            this.macro_symbol_to_additional_definition(new_symbol)
        );
        this.sort_additional_definitions(existing.additional_definitions);
    }

    private macro_symbol_to_additional_definition(symbol: MacroSymbol): {
        index: number;
        line: number;
        location: { uri: string; range: Range };
    } {
        return {
            index: symbol.definition_index ?? 0,
            // Invariant (issue #135): every `additional_definitions` entry's
            // `line` must equal `location.range.start.line`. Consumers
            // (`has_definition_in_window`, hover's redefinition footer) rely
            // on it. For a continued Mata setter the `st_local` call line
            // (`definition_line`) can differ from the macro-name literal's
            // line (`location`), so derive `line` from the location to keep
            // the invariant. The primary symbol keeps `definition_line` for
            // forward-only ordering.
            line: symbol.location.range.start.line,
            location: symbol.location,
        };
    }

    private sort_additional_definitions(
        definitions: Array<{
            index: number;
            line: number;
            location: { uri: string; range: Range };
        }>
    ): void {
        definitions.sort((a, b) =>
            this.compare_ranges(a.location.range, b.location.range)
        );
    }

    /**
     * Should a newly discovered Mata setter replace the current primary
     * definition of the same macro? First-definition-wins is ordered by
     * effective visibility (`definition_line`), NOT raw source position, so
     * that a setter never overrides a symbol whose `definition_line` was
     * deliberately set apart from its location. In particular `args` macros
     * carry `definition_line === 0` (visible from the start of scope); a
     * later Mata setter must not promote over them and reintroduce a forward-
     * reference warning. Same-line ties fall back to the location character —
     * but only when the existing symbol's effective line actually coincides
     * with its location, so the columns are comparable on the same physical
     * line. For a synthetic line (e.g. `args` with `definition_line === 0` but
     * a location on the later `args` token), the columns are on different
     * lines and meaningless, so the existing symbol keeps precedence.
     */
    private is_mata_definition_before(
        new_definition_line: number,
        new_range: Range,
        existing: MacroSymbol
    ): boolean {
        const existing_line =
            existing.definition_line ?? existing.location.range.start.line;
        if (new_definition_line !== existing_line) {
            return new_definition_line < existing_line;
        }
        if (
            existing.definition_line !== undefined &&
            existing.definition_line !== existing.location.range.start.line
        ) {
            return false;
        }
        // The new setter's range is its name literal, which a continuation can
        // push to a later physical line than its call (`new_definition_line`).
        // Only compare columns when the literal is actually on the tie line;
        // otherwise the characters are on different lines and meaningless, so
        // the existing symbol keeps precedence.
        if (new_range.start.line !== new_definition_line) {
            return false;
        }
        return (
            new_range.start.character < existing.location.range.start.character
        );
    }

    /**
     * Lexicographic (line, then character) comparison of two positions.
     * Returns <0 when `a` is before `b`, 0 when equal, >0 when after.
     */
    private compare_positions(
        a: { line: number; character: number },
        b: { line: number; character: number }
    ): number {
        return a.line !== b.line ? a.line - b.line : a.character - b.character;
    }

    private compare_ranges(left: Range, right: Range): number {
        return this.compare_positions(left.start, right.start);
    }

    /**
     * Mata function and type (`struct`/`class`) bodies are definitions, not
     * executed statements. A flat token scan must therefore ignore setters
     * inside bodies such as `void f() { st_local("foo", "1") }` or a
     * `struct S { ... }` declaration block.
     */
    private is_mata_function_body_start(
        tokens: Token[],
        brace_index: number
    ): boolean {
        const header = this.collect_mata_header_before_brace(
            tokens,
            brace_index
        );
        return (
            this.looks_like_mata_function_header(header) ||
            this.looks_like_mata_type_definition_header(header)
        );
    }

    /**
     * A `struct NAME {` / `class NAME [extends BASE] {` declaration header.
     * Unlike a function header it has no `()` call shape, so it is detected
     * separately: the first identifier word is the (case-sensitive) `struct`
     * or `class` keyword, followed by at least a name.
     */
    private looks_like_mata_type_definition_header(header: string): boolean {
        const the_words = header.trim().match(MATA_HEADER_WORD_RE) ?? [];
        return (
            the_words.length >= 2 &&
            (the_words[0] === 'struct' || the_words[0] === 'class')
        );
    }

    /**
     * Is the STATEMENT_TERMINATOR at `index` a `///` line continuation
     * (rather than a real end of statement)? True when the previous
     * significant token — skipping whitespace and comments — is a
     * CONTINUATION.
     */
    private is_continuation_terminator_at(
        tokens: Token[],
        index: number
    ): boolean {
        let j = index - 1;
        while (j >= 0 && MATA_TRIVIA_TOKENS.has(tokens[j].type)) {
            j--;
        }
        return j >= 0 && tokens[j].type === 'CONTINUATION';
    }

    /**
     * Classify what an embedded-language keyword (`mata` or `python`) at
     * `keyword_index` opens. Used for the lexer's MATA_START / PYTHON_START
     * tokens and for `WORD` re-entry (the lexer emits a WORD once it is
     * already in an embedded context, e.g. after `mata clear`). The logic
     * inspects only the tokens after the keyword, so it is keyword-agnostic.
     * The opener is the next significant token, with a `///` continuation
     * joining it to the keyword's logical line:
     *  - same-logical-line `:` -> 'inline' (`mata: <expr>`)
     *  - same-logical-line `{` -> 'block_brace' (`mata { ... }` / `python { }`)
     *  - same-logical-line WORD or dynamic opener -> 'subcommand'
     *    (`mata clear`, `python query`, `mata `m'`; not a block)
     *  - anything else (opener on a later physical line, a `;`/terminator, or
     *    end-of-input) -> 'block_plain' (`mata`/`python` ... `end`), so an
     *    inner `{` or body on the next line is NOT mistaken for the delimiter.
     */
    private classify_embedded_block_opener(
        tokens: Token[],
        mata_index: number
    ): 'inline' | 'block_brace' | 'block_plain' | 'subcommand' {
        // Walk to the first significant token after the keyword. The opener
        // shares the keyword's logical line when it is on the same physical
        // line, or reached only via `///` continuations (`crossed_continuation`)
        // with no intervening hard break. A hard break is a real (non-`///`)
        // STATEMENT_TERMINATOR or a `;` separator (under `#delimit ;`); once
        // one is seen the body is on a later line, so a blank or comment-only
        // continued line cannot keep the opener on the logical line. Under
        // `#delimit ;` a physical newline lexes as WHITESPACE (no terminator
        // token), so the physical-line comparison is what detects that break.
        let opener_idx = mata_index + 1;
        let crossed_continuation = false;
        let saw_hard_break = false;
        while (opener_idx < tokens.length) {
            const my_token = tokens[opener_idx];
            if (MATA_TRIVIA_TOKENS.has(my_token.type)) {
                opener_idx++;
                continue;
            }
            if (my_token.type === 'CONTINUATION') {
                crossed_continuation = true;
                opener_idx++;
                continue;
            }
            if (my_token.type === 'STATEMENT_TERMINATOR') {
                if (!this.is_continuation_terminator_at(tokens, opener_idx)) {
                    saw_hard_break = true;
                }
                opener_idx++;
                continue;
            }
            if (
                (my_token.type === 'EMBEDDED_CONTENT' ||
                    my_token.type === 'OPERATOR') &&
                my_token.value.includes(';')
            ) {
                saw_hard_break = true;
                opener_idx++;
                continue;
            }
            break;
        }
        const opener =
            opener_idx < tokens.length ? tokens[opener_idx] : undefined;
        if (opener === undefined) {
            return 'block_plain';
        }
        const on_logical_line =
            !saw_hard_break &&
            (opener.range.start.line ===
                tokens[mata_index].range.start.line ||
                crossed_continuation);
        if (on_logical_line) {
            const value = opener.value.trim();
            if (
                (opener.type === 'EMBEDDED_CONTENT' ||
                    opener.type === 'OPERATOR') &&
                value === ':'
            ) {
                return 'inline';
            }
            if (
                opener.type === 'LBRACE' ||
                (opener.type === 'EMBEDDED_CONTENT' && value === '{')
            ) {
                return 'block_brace';
            }
            // Any other token sharing the logical line is NOT a block opener:
            // a WORD subcommand (`mata clear`, `python query`), or a dynamic /
            // macro-expanded opener (`mata `m'`, where `m' might expand to
            // `clear`, `set matastrict on`, etc.) whose run-time text we
            // cannot know. Treat these as one-liners so later `st_local(...)`
            // text is not falsely registered as a setter.
            return 'subcommand';
        }
        return 'block_plain';
    }

    private collect_mata_header_before_brace(
        tokens: Token[],
        brace_index: number
    ): string {
        const parts: string[] = [];
        let unmatched_close_parens = 0;

        const track_parens = (value: string): void => {
            for (let i = value.length - 1; i >= 0; i--) {
                const ch = value[i];
                if (ch === ')') {
                    unmatched_close_parens++;
                } else if (ch === '(' && unmatched_close_parens > 0) {
                    unmatched_close_parens--;
                }
            }
        };

        // A statement separator ends the header scan. A `;` separator is
        // tokenized differently by context: STATEMENT_TERMINATOR normally,
        // `EMBEDDED_CONTENT ";"` inside `mata` ... `end` blocks under
        // `#delimit ;`, and an `OPERATOR ";"` between inline `mata:`
        // statements. Recognize all three (stopping here also prevents
        // pulling a preceding statement into the header).
        const is_statement_separator = (token: Token): boolean =>
            token.type === 'STATEMENT_TERMINATOR' ||
            ((token.type === 'EMBEDDED_CONTENT' ||
                token.type === 'OPERATOR') &&
                token.value.includes(';'));

        for (let i = brace_index - 1; i >= 0; i--) {
            const token = tokens[i];
            // Trivia is skipped entirely and significant tokens are joined
            // with a single space below, rather than relying on emitted
            // WHITESPACE tokens to separate them. Inline `mata:` code under
            // the default `#delimit cr` emits no whitespace tokens at all, so
            // appending raw values would turn `void f()` into `voidf()` and
            // defeat function-header detection.
            if (
                token.type === 'WHITESPACE' ||
                token.type === 'CONTINUATION' ||
                token.type === 'COMMENT_LINE' ||
                token.type === 'COMMENT_BLOCK'
            ) {
                continue;
            }

            if (is_statement_separator(token)) {
                if (parts.length === 0) {
                    continue;
                }
                if (unmatched_close_parens > 0) {
                    continue;
                }
                // A `///` continuation keeps the statement (and thus the
                // header) going even outside the argument parentheses, e.g.
                // `void ///` on its own line before `f() { ... }`.
                if (
                    token.type === 'STATEMENT_TERMINATOR' &&
                    this.is_continuation_terminator_at(tokens, i)
                ) {
                    continue;
                }
                break;
            }

            if (
                token.type === 'MATA_START' ||
                token.type === 'MATA_INLINE' ||
                token.type === 'END_MATA' ||
                token.type === 'LBRACE' ||
                token.type === 'RBRACE'
            ) {
                break;
            }

            parts.push(token.value);
            // Don't count parentheses inside string literals — e.g. a Mata
            // condition `if (s == ")") { ... }` would otherwise leave the
            // scan thinking the `if` parens are unbalanced and skip the real
            // statement separator before it.
            if (token.type !== 'STRING') {
                track_parens(token.value);
            }
        }

        // Tokens were collected by scanning backwards, so reverse once (O(n))
        // to restore source order — avoids O(n^2) `unshift`. Join with a
        // single space so adjacent identifiers stay separate words even when
        // no whitespace token sat between them (inline `mata:` headers);
        // `looks_like_mata_function_header` tolerates the extra spaces.
        return parts.reverse().join(' ');
    }

    private looks_like_mata_function_header(header: string): boolean {
        const trimmed = header.trim();
        if (trimmed.length === 0 || !trimmed.endsWith(')')) {
            return false;
        }

        const open_paren = this.find_matching_open_paren(trimmed);
        if (open_paren <= 0) {
            return false;
        }

        const before_args = trimmed.slice(0, open_paren).trim();
        const the_words = before_args.match(MATA_HEADER_WORD_RE) ?? [];
        if (the_words.length < 2) {
            return false;
        }

        const function_name = the_words[the_words.length - 1];
        if (MATA_CONTROL_WORDS.has(function_name)) {
            return false;
        }

        return the_words
            .slice(0, -1)
            .some(word => MATA_DECLARATION_WORDS.has(word));
    }

    private find_matching_open_paren(text: string): number {
        let depth = 0;
        for (let i = text.length - 1; i >= 0; i--) {
            const ch = text[i];
            if (ch === ')') {
                depth++;
            } else if (ch === '(') {
                depth--;
                if (depth === 0) {
                    return i;
                }
            }
        }
        return -1;
    }

    /**
     * Check tokens for macro references and report undefined ones.
     * This catches macro references that aren't parsed into AST nodes.
     * Skips ranges already reported by AST pass to avoid duplicates.
     */
    private check_token_macro_references(
        tokens: Token[],
        symbols: SymbolTable,
        diagnostics: SemanticDiagnostic[],
        reported_ranges: Set<string>,
        program_ranges: Array<[number, number]>
    ): void {
        for (const token of tokens) {
            // Check if this line should be ignored
            if (this.config.ignored_lines.has(token.range.start.line)) {
                continue;
            }

            const range_key = `${token.range.start.line}:${token.range.start.character}:${token.range.end.line}:${token.range.end.character}`;

            // Skip if already reported by AST pass
            if (reported_ranges.has(range_key)) {
                continue;
            }

            // Suppress undefined global macro warnings inside program blocks
            if (token.type === 'MACRO_REF_GLOBAL') {
                const token_line = token.range.start.line;
                if (program_ranges.some(([start, end]) => token_line >= start && token_line <= end)) {
                    continue;
                }
            }

            if (token.type === 'MACRO_REF_LOCAL') {
                // Extract macro name from `name' format
                const macro_name = this.extract_local_macro_name(token.value);
                
                // Skip stored result references like `r(values)' - they are valid Stata syntax
                if (macro_name && this.is_stored_result_reference(macro_name)) {
                    continue;
                }
                
                // Skip nested macro references - they contain valid macro syntax characters
                if (macro_name && this.contains_nested_macro(macro_name)) {
                    continue;
                }
                
                // Skip unbalanced macro expressions - the lexer already reports these
                if (macro_name && this.is_unbalanced_local_macro(macro_name)) {
                    continue;
                }
                
                // Skip expression evaluation macros - they use `=expr' syntax
                if (macro_name && this.is_expression_evaluation(macro_name)) {
                    continue;
                }
                
                // Skip inline extended function macros - they use `:function' syntax
                if (macro_name && this.is_inline_extended_function(macro_name)) {
                    continue;
                }
                
                // Check for invalid characters in local macro reference
                if (macro_name && this.has_invalid_macro_char(macro_name)) {
                    diagnostics.push({
                        message: 'Invalid character in macro name',
                        range: token.range,
                        code: StataDiagnosticCode.INVALID_MACRO_CHAR,
                        severity: 'error',
                    });
                    continue; // Skip undefined check for invalid macro
                }
                
                const token_line = token.range.start.line;
                if (
                    macro_name &&
                    !this.is_macro_defined(
                        macro_name,
                        'local',
                        symbols,
                        undefined,
                        token_line,
                        token.range
                    )
                ) {
                    diagnostics.push({
                        message: format_undefined_macro_message(
                            'local',
                            macro_name
                        ),
                        range: token.range,
                        code: StataDiagnosticCode.UNDEFINED_MACRO,
                        severity: 'warning',
                        symbol_name: macro_name,
                        reference_kind: 'local',
                    });
                }
            } else if (token.type === 'MACRO_REF_GLOBAL') {
                // Extract macro name from $name or ${name} format
                const macro_name = this.extract_global_macro_name(token.value);
                const is_braced = token.value.startsWith('${');
                
                // Skip unbalanced braced global expressions - the lexer already reports these
                if (is_braced && !token.value.endsWith('}')) {
                    continue;
                }
                
                // Skip nested macro references - they contain valid macro syntax characters
                if (is_braced && macro_name && this.contains_nested_macro(macro_name)) {
                    continue;
                }
                
                // Check for invalid characters in braced global macro reference
                if (is_braced && macro_name && this.has_invalid_macro_char(macro_name)) {
                    diagnostics.push({
                        message: 'Invalid character in macro name',
                        range: token.range,
                        code: StataDiagnosticCode.INVALID_MACRO_CHAR,
                        severity: 'error',
                    });
                    continue; // Skip undefined check for invalid macro
                }
                
                const token_line = token.range.start.line;
                if (
                    macro_name &&
                    !this.is_macro_defined(
                        macro_name,
                        'global',
                        symbols,
                        undefined,
                        token_line,
                        token.range
                    )
                ) {
                    diagnostics.push({
                        message: format_undefined_macro_message(
                            'global',
                            macro_name
                        ),
                        range: token.range,
                        code: StataDiagnosticCode.UNDEFINED_MACRO,
                        severity: 'warning',
                        symbol_name: macro_name,
                        reference_kind: 'global',
                    });
                }
            }
        }
    }

    /**
     * Check if a macro name contains invalid characters.
     * Valid macro identifier chars are [A-Za-z0-9_].
     */
    private has_invalid_macro_char(name: string): boolean {
        return !/^[A-Za-z0-9_]*$/.test(name);
    }

    /**
     * Check if a macro name content contains nested macro references.
     * Nested macros use backtick-apostrophe pairs for locals or ${} for globals.
     * 
     * Examples of nested patterns:
     * - `one`two'' → content is "one`two'" (contains nested local)
     * - ${one${two}} → content is "one${two}" (contains nested global)
     * - ${one`two'} → content is "one`two'" (contains nested local in global)
     * - $one`two' → content is "one`two'" (contains nested local in unbraced global)
     * 
     * Note: Due to lexer limitations with nested braced globals, the content may
     * have incomplete nesting (e.g., "a${a" instead of "a${a}"). We detect the
     * presence of nested macro syntax markers rather than requiring complete pairs.
     * 
     * @param content The extracted macro name content (without outer delimiters)
     * @returns true if the content contains nested macro syntax
     */
    private contains_nested_macro(content: string): boolean {
        // Check for nested local macro: backtick followed eventually by apostrophe
        if (content.includes('`') && content.includes("'")) {
            return true;
        }
        
        // Check for nested braced global macro: ${
        // Note: We only check for ${ because the lexer may not capture the closing }
        // when there are nested braced globals (it stops at the first })
        if (content.includes('${')) {
            return true;
        }
        
        // Check for nested unbraced global macro: $identifier
        // Match $[A-Za-z_][A-Za-z0-9_]* pattern
        if (/\$[A-Za-z_][A-Za-z0-9_]*/.test(content)) {
            return true;
        }
        
        return false;
    }

    /**
     * Check if a local macro content represents an unbalanced macro expression.
     * An unbalanced local macro has backticks that don't have matching apostrophes.
     * 
     * Examples of unbalanced patterns:
     * - `one`two' → content is "one`two" (backtick without matching apostrophe)
     * - `a`b`c'' → content is "a`b`c'" (2 backticks, 1 apostrophe - unbalanced)
     * 
     * The lexer already reports these as "Incomplete macro expression" errors,
     * so we should not produce additional INVALID_MACRO_CHAR diagnostics.
     * 
     * @param content The extracted macro name content (without outer delimiters)
     * @returns true if the content has unbalanced backticks/apostrophes
     */
    private is_unbalanced_local_macro(content: string): boolean {
        // Count backticks and apostrophes
        let backtick_count = 0;
        let apostrophe_count = 0;
        
        for (const char of content) {
            if (char === '`') {
                backtick_count++;
            } else if (char === "'") {
                apostrophe_count++;
            }
        }
        
        // If there are backticks but they don't match apostrophes, it's unbalanced
        // A balanced nested macro would have equal counts (e.g., `a`b'' has content "a`b'" with 1 backtick and 1 apostrophe)
        if (backtick_count > 0 && backtick_count !== apostrophe_count) {
            return true;
        }
        
        return false;
    }

    /**
     * Check if a string is a stored result reference.
     * Stored results use the format r(...), e(...), c(...), or s(...)
     * with optional matrix subscripts [...].
     * Case-sensitive: only lowercase r/e/c/s are valid.
     * 
     * Examples:
     * - r(values) - return values
     * - e(N) - estimation results
     * - c(current_date) - system constants
     * - s(macros) - string scalars
     * - r(table)[1,2] - matrix subscript
     */
    private is_stored_result_reference(content: string): boolean {
        return /^[recs]\(.*\)(\[.*\])?$/.test(content);
    }

    /**
     * Check if a local macro content represents an expression evaluation.
     * Expression evaluation macros use the `=expr' syntax where the content
     * starts with '=' followed by any valid Stata expression.
     * 
     * Examples:
     * - `=1+2' → content is "=1+2" (arithmetic expression)
     * - `=uchar(65533)' → content is "=uchar(65533)" (function call)
     * - `=string(varname)' → content is "=string(varname)" (function call)
     * - `=`a' + `b'' → content is "=`a' + `b'" (expression with nested macros)
     * - `=r(table)[1,1]' → content is "=r(table)[1,1]" (matrix subscript)
     * 
     * @param content The extracted macro name content (without outer delimiters)
     * @returns true if the content is an expression evaluation (starts with =)
     */
    private is_expression_evaluation(content: string): boolean {
        return content.startsWith('=');
    }

    /**
     * Check if a macro content represents an inline extended function.
     * Inline extended functions use `:function' syntax for inline evaluation.
     * 
     * Examples:
     * - `:type mpg' → content is ":type mpg" (type function)
     * - `:format price' → content is ":format price" (format function)
     * - `:variable label mpg' → content is ":variable label mpg" (variable label)
     * 
     * @param content The extracted macro name content (without outer delimiters)
     * @returns true if the content is an inline extended function (starts with :)
     */
    private is_inline_extended_function(content: string): boolean {
        return content.startsWith(':');
    }

    /**
     * Check if a varlist item name is a macro reference rather than a plain identifier.
     * Local macro references: `name' (backtick + name + single quote)
     * Global macro references: $name or ${name}
     */
    private is_macro_reference(name: string): boolean {
        if (name.startsWith('`') && name.endsWith("'")) {
            return true;
        }
        if (name.startsWith('$')) {
            return true;
        }
        return false;
    }

    /**
     * Extract macro name from local macro reference token.
     * Format: `name'
     */
    private extract_local_macro_name(value: string): string | null {
        // Remove backtick prefix and apostrophe suffix
        if (value.startsWith('`') && value.endsWith("'")) {
            return value.slice(1, -1);
        }
        return null;
    }

    /**
     * Extract macro name from global macro reference token.
     * Format: $name or ${name}
     */
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
     * Extract macro references from extended function arguments.
     * Handles list operations (a - b, a & b, a | b), unary operations 
     * (sizeof, sort, uniq, dups, clean), posof patterns, and subinstr/length.
     */
    extract_macro_refs_from_extended_args(args: string): string[] {
        const macro_refs: string[] = [];
        
        // Match local macro references: `name'
        // Exclude backtick from the name class so the scanner restarts at each
        // backtick without overlap (avoids polynomial ReDoS); macro names
        // cannot contain a backtick anyway.
        const local_pattern = /`([^'`]+)'/g;
        let match;
        while ((match = local_pattern.exec(args)) !== null) {
            macro_refs.push(match[1]);
        }
        
        // Match global macro references: $name or ${name}
        // Exclude '{' from the braced-name class so the scanner restarts at
        // each '${' without overlap (avoids polynomial ReDoS); macro names
        // cannot contain a brace.
        const global_pattern = /\$\{([^{}]+)\}|\$([a-zA-Z_][a-zA-Z0-9_]*)/g;
        while ((match = global_pattern.exec(args)) !== null) {
            macro_refs.push(match[1] || match[2]);
        }
        
        return macro_refs;
    }

    // Helper methods

    private has_trivia(node: StataNode): node is StataNode & { 
        leadingTrivia?: TriviaNode[]; 
        trailingTrivia?: TriviaNode[] 
    } {
        return (
            node.type === 'command' ||
            node.type === 'program' ||
            node.type === 'macro_def' ||
            node.type === 'directive' ||
            node.type === 'syntax' ||
            node.type === 'if' ||
            node.type === 'else' ||
            node.type === 'foreach' ||
            node.type === 'forvalues' ||
            node.type === 'while'
        );
    }

    private is_control_flow(node: StataNode): node is ControlFlowNode {
        return (
            node.type === 'if' ||
            node.type === 'else' ||
            node.type === 'foreach' ||
            node.type === 'forvalues' ||
            node.type === 'while'
        );
    }

    private get_full_range(ast: StataAST): Range {
        if (ast.nodes.length === 0) {
            return {
                start: { line: 0, character: 0 },
                end: { line: 0, character: 0 },
            };
        }

        const first_node = ast.nodes[0];
        const last_node = ast.nodes[ast.nodes.length - 1];

        return {
            start: first_node.range.start,
            end: last_node.range.end,
        };
    }
}

/**
 * Create an empty symbol table.
 */
export function create_empty_symbol_table(): SymbolTable {
    return {
        programs: new Map(),
        localMacros: new Map(),
        globalMacros: new Map(),
        variables: new Map(),
        scalars: new Map(),
        matrices: new Map(),
    };
}

/**
 * Merge two symbol tables, always returning a new object.
 * Used for combining workspace symbols with document symbols.
 */
export function merge_symbol_tables(base: SymbolTable, overlay: SymbolTable): SymbolTable {
    // Fast path: if overlay is empty, return shallow copy of base
    if (is_empty_symbol_table(overlay)) {
        return {
            programs: new Map(base.programs),
            localMacros: new Map(base.localMacros),
            globalMacros: new Map(base.globalMacros),
            variables: new Map(base.variables),
            scalars: new Map(base.scalars),
            matrices: new Map(base.matrices),
        };
    }

    // Fast path: if base is empty, return shallow copy of overlay
    if (is_empty_symbol_table(base)) {
        return {
            programs: new Map(overlay.programs),
            localMacros: new Map(overlay.localMacros),
            globalMacros: new Map(overlay.globalMacros),
            variables: new Map(overlay.variables),
            scalars: new Map(overlay.scalars),
            matrices: new Map(overlay.matrices),
        };
    }

    // Full merge
    return {
        programs: new Map([...base.programs, ...overlay.programs]),
        localMacros: new Map([...base.localMacros, ...overlay.localMacros]),
        globalMacros: new Map([...base.globalMacros, ...overlay.globalMacros]),
        variables: new Map([...base.variables, ...overlay.variables]),
        scalars: new Map([...base.scalars, ...overlay.scalars]),
        matrices: new Map([...base.matrices, ...overlay.matrices]),
    };
}

/**
 * Check if a symbol table is empty.
 */
function is_empty_symbol_table(table: SymbolTable): boolean {
    return table.programs.size === 0 &&
           table.localMacros.size === 0 &&
           table.globalMacros.size === 0 &&
           table.variables.size === 0 &&
           table.scalars.size === 0 &&
           table.matrices.size === 0;
}
