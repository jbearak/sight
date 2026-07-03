/**
 * Hover Provider for Sight
 *
 * Provides hover information for commands, macros, programs, and variables.
 * Follows the design document specification for hover behavior.
 *
 * Context-Aware Behavior:
 * - In Stata context: Normal hover for commands, macros, programs, variables
 * - In Mata/Python context: Suppress Stata command hover, still provide macro hover
 * - For block delimiters: Provide hover info about embedded language block syntax
 *
 * Built-in Command Hover:
 * - Displays command name, options list, and help link
 */

import {
    Hover,
    MarkupContent,
    MarkupKind,
    Position,
    Range,
    CancellationToken,
} from 'vscode-languageserver';
import { URI } from 'vscode-uri';
import * as path from 'path';
import { DocumentState } from '../document-store';
import { CommandDatabase } from '../command-database';
import {
    SymbolTable,
    MacroSymbol,
    ScalarSymbol,
    MatrixSymbol,
    Token,
    ProgramSignature,
    OptionSpec,
    ArgumentSpec,
    ResolvedScope,
    ScopeResolverConfig,
    CommandInfo,
} from '../types';
import { IContextTracker } from '../context-tracker/types';
import { LanguageContext } from '../context-tracker/types';
import { ScopeResolver } from '../scope-resolver';
import { format_help_link } from '../utils/help-link';
import { is_swallowed_continuation_terminator } from '../utils/continuation';
import type { WorkspaceIndexer } from '../indexer';
import { build_scope_resolver_config } from '../scope-resolver';
import { get_visible_symbols_at } from '../scope-resolver';
import { get_line_text } from '../utils/line-utils';
import {
    find_last_token_starting_before,
    find_token_index_at_position,
} from '../utils/token-utils';
import { is_cursor_in_comment } from '../utils/comment-utils';
import { is_cursor_in_string_literal } from '../utils/string-literal-utils';
import {
    find_inherited_dofile_local,
    is_cross_file_hidden_local,
} from '../utils/dofile-locals';
import { lookup_scoped_local_macro } from '../utils/scoped-locals';

const MARKDOWN_TEXT_ESCAPE_PATTERN =
    /([\\`*_{}\[\]()#+\-.!|])/g;

// Fallback list used only when the command database has no functions
// loaded (e.g. tests without a cache fixture). Source of truth is
// command_db.is_function.
export const STATA_EXPRESSION_FUNCTIONS_FALLBACK = new Set<string>([
    // Type casting / storage types
    'byte', 'double', 'float', 'int', 'long',
    // String functions
    'abbrev', 'char', 'indexnot', 'itrim', 'length',
    'lower', 'ltrim', 'plural', 'proper', 'real',
    'regexm', 'regexr', 'regexs', 'reverse',
    'rtrim', 'soundex', 'soundex_nara',
    'strcat', 'strdup', 'string',
    'stritrim', 'strlen', 'strlower', 'strltrim',
    'strmatch', 'strofreal', 'strpos', 'strproper',
    'strreverse', 'strrtrim', 'strtoname', 'strtrim',
    'strupper', 'subinstr', 'subinword', 'substr',
    'tobytes', 'trim', 'upper', 'word', 'wordbreaklocale',
    'wordcount',
    // Unicode string functions
    'uchar', 'udstrlen', 'udsubstr',
    'uisdigit', 'uisletter',
    'ustrcompare', 'ustrcompareex', 'ustrfix', 'ustrinvalidcnt',
    'ustrleft', 'ustrlen', 'ustrlower', 'ustrltrim',
    'ustrnormalize', 'ustrpos', 'ustrregexm', 'ustrregexrf',
    'ustrregexs', 'ustrreverse', 'ustrright', 'ustrrpos',
    'ustrrtrim', 'ustrsortkey', 'ustrsortkeyex',
    'ustrtitle', 'ustrtrim', 'ustrunescape', 'ustrupper',
    'ustrword', 'ustrwordcount', 'usubinstr', 'usubstr',
    // Math functions
    'abs', 'ceil', 'cloglog', 'comb', 'digamma',
    'exp', 'expm1', 'floor', 'invcloglog',
    'invlogit', 'ln', 'lnfactorial', 'lngamma',
    'log', 'log10', 'log1p', 'logit',
    'max', 'min', 'mod', 'reldif', 'round',
    'sign', 'sqrt', 'sum', 'trunc', 'trigamma',
    // Trig functions
    'acos', 'acosh', 'asin', 'asinh', 'atan', 'atan2',
    'atanh', 'cos', 'cosh', 'sin', 'sinh', 'tan', 'tanh',
    // Date/time functions
    'bofd', 'Cdhms', 'Chms', 'clock', 'clockdiff',
    'Cmdyhms', 'Cofc', 'Cofd', 'cofC', 'cofd',
    'daily', 'date', 'day', 'dhms', 'dmy', 'dofb',
    'dofC', 'dofc', 'dofh', 'dofm', 'dofq', 'dofw', 'dofy',
    'dow', 'doy', 'halfyearly', 'halfyear', 'hh', 'hhC',
    'hms', 'hofd', 'hours',
    'mdy', 'mdyhms', 'minutes', 'mm', 'mmC',
    'mofd', 'month', 'monthly',
    'qofd', 'quarter', 'quarterly',
    'seconds', 'ss', 'ssC',
    'tC', 'tc', 'td', 'th', 'tm', 'tq', 'tw',
    'week', 'weekly', 'wofd',
    'year', 'yearly', 'yh', 'ym', 'yofd', 'yq', 'yw',
    // Random number functions
    'rbeta', 'rbinomial', 'rcauchy', 'rchi2',
    'rexponential', 'rgamma', 'rhypergeometric',
    'rigaussian', 'rlaplace', 'rlogistic',
    'rnbinomial', 'rnormal', 'rpoisson',
    'rt', 'runiform', 'runiformint', 'rweibull',
    // Statistical distribution functions
    'betaden', 'binomial', 'binomialp', 'binomialtail',
    'binormal', 'chi2', 'chi2den', 'chi2tail',
    'Fden', 'Ftail', 'gammaden', 'gammap', 'gammaptail',
    'invbinomial', 'invbinomialtail',
    'invchi2', 'invchi2tail', 'invF', 'invFtail',
    'invgammap', 'invgammaptail',
    'invnbinomial', 'invnbinomialtail',
    'invnchi2', 'invnFtail', 'invnibeta',
    'invnormal', 'invnt', 'invnttail',
    'invpoisson', 'invpoissontail',
    'invt', 'invttail',
    'nbetaden', 'nbinomial', 'nbinomialp', 'nbinomialtail',
    'nchi2', 'nchi2den', 'nchi2tail',
    'nFden', 'nFtail', 'nibeta',
    'normal', 'normalden', 'npnchi2',
    'ntden', 'nttail',
    'poisson', 'poissonp', 'poissontail',
    'tden', 'ttail',
    // Programming functions
    'autocode', 'byteorder', 'c', 'cholesky',
    'clip', 'cond', 'e', 'epsdouble', 'epsfloat',
    'fileexists', 'fileread', 'filereaderror', 'filewrite',
    'has_eprop', 'inlist', 'inrange', 'irecode',
    'matrix', 'maxbyte', 'maxdouble', 'maxfloat',
    'maxint', 'maxlong', 'minbyte', 'mindouble',
    'minfloat', 'minint', 'minlong',
    'missing', 'r', 'recode', 'replay',
    'return', 'scalar', 's',
    // Misc
    'chop', 'colnumb', 'colsof', 'det',
    'diag', 'el', 'hadamard', 'I', 'inv', 'issymmetric',
    'J', 'matmissing', 'matuniform', 'mreldif',
    'nullmat', 'rownumb', 'rowsof', 'sweep', 'trace',
    'vec', 'vecdiag',
]);

export const STATA_EXPRESSION_FUNCTION_ALIASES = new Map<string, string>([
    ['mi', 'missing'],
]);

/**
 * Stata system variables with descriptions.
 * These are built-in read-only values available in all contexts.
 */
export const STATA_SYSTEM_VARIABLES = new Map<string, string>([
    ['_rc', 'Return code from the last `capture` command'],
    ['_N', 'Total number of observations in the dataset'],
    ['_n', 'Current observation number'],
    ['_pi', 'The mathematical constant π (3.14159…)'],
    ['_cons', 'Constant term in estimation results'],
]);

/**
 * One entry in a symbol's `additional_definitions` array.
 *
 * Analyzer invariant (enforced by `add_or_append_definition` and the ad-hoc
 * macro paths in `src/analyzer/index.ts`): `line === location.range.start.line`.
 * Indexer-sourced entries honor the same invariant; test stubs may omit
 * `location.range`, so callers still fall back to `.line`.
 */
interface AdditionalDefinitionEntry {
    index: number;
    line: number;
    location: { uri: string; range: Range };
    // True for a loop-expanded definition, whose location is the loop-body
    // template statement (text that does not contain the concrete name). Such
    // entries are excluded from the redefinition footer, consistent with
    // find-references and go-to-definition.
    is_expanded?: boolean;
}

/**
 * Minimum shape the primary-hit argument to
 * `collect_workspace_additional_definitions` needs to satisfy. Widened to
 * optional `location` because some hover unit tests pass partial symbol stubs
 * that omit `.location` entirely.
 */
interface SymbolWithAdditionalDefinitions {
    location?: { uri: string; range?: Range };
    additional_definitions?: AdditionalDefinitionEntry[];
}

function has_definition_index(hit: object): hit is { definition_index: number } {
    return typeof (hit as { definition_index?: unknown }).definition_index === 'number';
}

function has_additional_definitions(
    hit: object,
): hit is { additional_definitions: AdditionalDefinitionEntry[] } {
    const candidate = (hit as { additional_definitions?: unknown })
        .additional_definitions;
    return Array.isArray(candidate);
}

/**
 * Represents a matched symbol for hover display.
 * Used to collect all matching symbols before formatting.
 */
export interface SymbolMatch {
    /** The category of the matched symbol */
    type: 'local_macro' | 'global_macro' | 'program' | 'scalar' | 'matrix' | 'variable';
    /** The formatted hover content for this symbol */
    content: MarkupContent;
}

/**
 * Hover Provider class for generating hover information.
 *
 * Provides hover for:
 * - Built-in commands: syntax and description from CommandDB
 * - User-defined macros: definition location and value
 * - User-defined programs: signature and location
 * - Variables: type and label information (best-effort)
 * - Block delimiters: information about embedded language block syntax
 *
 * Symbol precedence: User-defined symbols take precedence over built-in commands.
 *
 * Context-Aware Behavior:
 * - In Stata context: Normal hover for all symbols
 * - In Mata/Python context: Suppress Stata command hover, still provide macro hover
 * - For block delimiters: Provide hover info about embedded language block syntax
 */
export class HoverProvider {
    private command_db: CommandDatabase;
    private context_tracker?: IContextTracker;

    constructor(command_db: CommandDatabase, context_tracker?: IContextTracker) {
        this.command_db = command_db;
        this.context_tracker = context_tracker;
    }

    /**
     * Get hover information for a position in the document.
     *
     * Uses collect_all_symbol_matches() to gather all matching symbols, then
     * format_multi_symbol_hover() to format them appropriately:
     * - Single match: returns content directly without heading
     * - Multiple matches: adds markdown headings and separators for each section
     *
     * @param document - The document state
     * @param position - The cursor position
     * @param workspace_symbols - Optional workspace-level symbols for cross-file resolution
     * @param scope_resolver - Optional scope resolver for cross-file awareness
     * @param cross_file_config - Optional cross-file config for scope resolution
     * @param cancellation_token - Optional cancellation token
     * @returns Hover information or null if no hover available
     */
    async get_hover(
        document: DocumentState,
        position: Position,
        workspace_symbols?: SymbolTable,
        scope_resolver?: ScopeResolver,
        cross_file_config?: Partial<ScopeResolverConfig>,

        cancellation_token?: CancellationToken,
        workspace_root?: string,
        workspace_indexer?: WorkspaceIndexer,
    ): Promise<Hover | null> {
        // Check cancellation before starting (Req 5.1)
        if (cancellation_token?.isCancellationRequested) {
            return null;
        }

        // Use context tracker from document state if available
        if (!this.context_tracker && document.context_tracker) {
            this.context_tracker = document.context_tracker;
        }

        // Suppress hover inside comments
        if (is_cursor_in_comment(document, position)) {
            return null;
        }

        // Suppress hover inside string literals. Embedded macro references in
        // compound strings are separate tokens (MACRO_REF_LOCAL / MACRO_REF_GLOBAL),
        // so this only matches literal text.
        if (is_cursor_in_string_literal(document, position)) {
            return null;
        }

        // Get the word at the cursor position
        const word_info = this.get_word_at_position(document, position);
        if (!word_info) {
            return null;
        }

        const { word, range } = word_info;

        // Get current language context
        const my_context = this.context_tracker
            ? this.context_tracker.get_context_at_position(position)
            : LanguageContext.STATA;

        // Resolve scope if scope_resolver is provided
        let resolved_scope: ResolvedScope | undefined;
        if (scope_resolver) {
            const resolve_config = build_scope_resolver_config(cross_file_config);
            resolved_scope = await scope_resolver.resolve(
                document.uri,
                document.content,
                resolve_config,
                cancellation_token
            );
        }

        // Check for block delimiter hover (works in any context)
        const delimiter_hover = this.get_block_delimiter_hover(word, my_context, document, position);
        if (delimiter_hover) {
            return { contents: delimiter_hover, range };
        }

        // In embedded language context, only check for macros (suppress other Stata-specific hover)
        if (my_context !== LanguageContext.STATA) {
            // Macros work in all contexts - check local and global macros only
            const local_macro_content = this.get_local_macro_hover(document, word, resolved_scope, workspace_root, position, workspace_indexer);
            if (local_macro_content) {
                return { contents: local_macro_content, range };
            }
            const global_macro_content = this.get_global_macro_hover(document, word, workspace_symbols, resolved_scope, workspace_root, position, workspace_indexer);
            if (global_macro_content) {
                return { contents: global_macro_content, range };
            }
            return null;
        }

        // Collect all symbol matches using the new collection approach
        const the_symbol_matches = this.collect_all_symbol_matches(
            document,
            position,
            word,
            workspace_symbols,
            resolved_scope,
            workspace_root,
            workspace_indexer,
        );

        // If we have symbol matches, format and return them
        if (the_symbol_matches.length > 0) {
            const formatted_content = this.format_multi_symbol_hover(the_symbol_matches);
            return { contents: formatted_content, range };
        }

        // Function calls can share text with prefix commands. For example,
        // `mi(bar)` is the `missing()` function, not the `mi` prefix command.
        // Checked before the top-level-comma guard so that expression
        // functions inside option arguments (e.g. `vce(mi(bar))`) resolve.
        const expression_function_hover = this.get_expression_function_hover(
            document,
            range,
            word
        );
        if (expression_function_hover) {
            return { contents: expression_function_hover, range };
        }

        // System variables: _rc, _N, _n, _pi, _cons
        const sysvar_hover = this.get_system_variable_hover(word);
        if (sysvar_hover) {
            return { contents: sysvar_hover, range };
        }

        // Past a top-level comma the word is an option name, which shares
        // spellings with Stata commands (e.g. `replace`) and functions
        // (e.g. `sum`). Don't fall through to command/function hover there.
        if (this.is_after_top_level_comma(document, position)) {
            return null;
        }

        // Fallback: Check for subcommand context (not a symbol type)
        const subcommand_hover = this.get_subcommand_hover(document, position, word, cancellation_token);
        if (subcommand_hover) {
            return { contents: subcommand_hover, range };
        }

        // Fallback: Check for built-in command (preserving current behavior)
        const command_hover = this.get_command_hover(word);
        if (command_hover) {
            return { contents: command_hover, range };
        }

        return null;
    }

    /**
     * True when the cursor is past a top-level comma in the current statement,
     * i.e. in option-argument position. Uses the token stream so commas inside
     * strings, macro references, and nested parentheses are ignored correctly.
     *
     * Complexity: O(log N + K) where N is the token count and K is the
     * number of tokens in the current statement. Binary-searches the cursor
     * location, scans backwards to the statement start, then forward-scans
     * that window to preserve the original depth-tracking semantics.
     */
    private is_after_top_level_comma(
        document: DocumentState,
        position: Position
    ): boolean {
        const tokens = document.tokens;
        if (!tokens || tokens.length === 0) {
            return false;
        }

        // Locate the last token that starts strictly before the cursor.
        // Tokens starting at the cursor itself don't contribute, matching
        // the pre-optimization behavior.
        const end_index = find_last_token_starting_before(tokens, position);
        if (end_index < 0) {
            return false;
        }

        // Walk backwards to find the start of the current statement. If
        // no STATEMENT_TERMINATOR is found, the statement starts at the
        // beginning of the file.
        const statement_start_index =
            this.find_statement_start_index(tokens, end_index);

        // Forward scan the statement window, matching the original
        // depth-tracking semantics. A comma counts as top-level whenever
        // the forward-scan paren/bracket depths are both zero when it is
        // encountered, regardless of the cursor's depth.
        let paren_depth = 0;
        let bracket_depth = 0;
        for (let i = statement_start_index; i <= end_index; i++) {
            const token = tokens[i];
            if (token.type === 'LPAREN') {
                paren_depth++;
            } else if (token.type === 'RPAREN') {
                if (paren_depth > 0) paren_depth--;
            } else if (token.type === 'LBRACKET') {
                bracket_depth++;
            } else if (token.type === 'RBRACKET') {
                if (bracket_depth > 0) bracket_depth--;
            } else if (
                token.type === 'COMMA'
                && paren_depth === 0
                && bracket_depth === 0
            ) {
                return true;
            }
        }

        return false;
    }

    /**
     * Index of the first token of the statement containing
     * `end_index`, scanning backward to the previous real statement
     * boundary. A '\n' terminator right after a `///` continuation is
     * trivia, not a boundary — the scan crosses it (and the
     * continuation). Returns 0 when no boundary exists.
     */
    private find_statement_start_index(
        tokens: Token[],
        end_index: number
    ): number {
        for (let i = end_index; i >= 0; i--) {
            if (tokens[i].type === 'STATEMENT_TERMINATOR') {
                if (
                    is_swallowed_continuation_terminator(
                        tokens[i],
                        i > 0 && tokens[i - 1].type === 'CONTINUATION'
                    )
                ) {
                    i--; // skip the continuation too
                    continue;
                }
                return i + 1;
            }
        }
        return 0;
    }

    /**
     * Format multiple symbol matches into a single hover content.
     * Single match: returns content directly without heading.
     * Multiple matches: adds separators between sections.
     *
     * @param matches - Array of SymbolMatch objects to format
     * @returns MarkupContent with formatted hover information
     */
    private format_multi_symbol_hover(matches: SymbolMatch[]): MarkupContent {
        // Single match: return content directly without heading
        if (matches.length === 1) {
            return matches[0].content;
        }

        // Multiple matches: join with separators (no extra headings needed
        // since each section already starts with bold type like "**Local Macro:**")
        const the_sections: string[] = matches.map(my_match => my_match.content.value);

        return {
            kind: MarkupKind.Markdown,
            value: the_sections.join('\n\n---\n\n'),
        };
    }

    /**
     * Get the display heading for a symbol type.
     *
     * @param type - The symbol type
     * @returns Human-readable heading for the symbol type
     */
    private get_symbol_type_heading(type: SymbolMatch['type']): string {
        const headings: Record<SymbolMatch['type'], string> = {
            'local_macro': 'Local Macro',
            'global_macro': 'Global Macro',
            'program': 'Program',
            'scalar': 'Scalar',
            'matrix': 'Matrix',
            'variable': 'Variable',
        };
        return headings[type];
    }

    /**
     * Determine the expected symbol type from the syntax context at position.
     * Returns the symbol type being referenced, or null if ambiguous.
     */
    private get_reference_type_from_context(
        document: DocumentState,
        position: Position,
        _word: string
    ): 'local_macro' | 'global_macro' | 'other' | null {
        // Check the characters before the word to determine reference type
        // Local macro: `word' (backtick before, single quote after)
        // Global macro: $word or ${word}
        // Other: bare identifier (could be variable, program, scalar, matrix)
        
        const line = get_line_text(document, position.line);
        
        // Find the actual start of the word (cursor might be in the middle)
        let word_start = position.character;
        while (word_start > 0 && /[a-zA-Z0-9_]/.test(line[word_start - 1])) {
            word_start--;
        }
        
        // Check for local macro syntax: `word'
        if (word_start > 0 && line[word_start - 1] === '`') {
            return 'local_macro';
        }
        
        // Check for global macro syntax: $word or ${word}
        if (word_start > 0 && line[word_start - 1] === '$') {
            return 'global_macro';
        }
        if (word_start > 1 && line.substring(word_start - 2, word_start) === '${') {
            return 'global_macro';
        }
        
        return 'other';
    }

    /**
     * Check if a symbol reference is out-of-scope for its specific type.
     */
    private is_reference_out_of_scope(
        word: string,
        reference_type: 'local_macro' | 'global_macro' | 'other' | null,
        resolved_scope?: ResolvedScope
    ): boolean {
        if (!resolved_scope || !reference_type) {
            return false;
        }
        
        const out_of_scope = resolved_scope.out_of_scope_symbols.find(s => s.name === word);
        if (!out_of_scope) {
            return false;
        }
        
        // Check if the out-of-scope symbol type matches the reference type
        if (reference_type === 'local_macro' && out_of_scope.type === 'local') {
            return true;
        }
        if (reference_type === 'global_macro' && out_of_scope.type === 'global') {
            return true;
        }
        
        return false;
    }

    /**
     * Get hover content for an out-of-scope symbol.
     * Returns a SymbolMatch with "(out of scope)" indicator if the word matches
     * an out-of-scope symbol of the appropriate type.
     *
     * @param word - The symbol name to look up
     * @param reference_type - The type of reference ('local_macro', 'global_macro', 'other', or null)
     * @param resolved_scope - The resolved scope containing out-of-scope symbols
     * @param current_uri - The current document URI for source link formatting
     * @param workspace_root - Optional workspace root for relative path display
     * @returns SymbolMatch with out-of-scope indicator, or null if not applicable
     */
    private get_out_of_scope_hover(
        word: string,
        reference_type: 'local_macro' | 'global_macro' | 'other' | null,
        resolved_scope: ResolvedScope | undefined,
        current_uri: string,
        workspace_root: string | undefined
    ): SymbolMatch | null {
        // Return null if no resolved scope or reference type is 'other' or null
        if (!resolved_scope || !reference_type || reference_type === 'other') {
            return null;
        }

        // Find matching out-of-scope symbol by name
        const out_of_scope = resolved_scope.out_of_scope_symbols.find(s => s.name === word);
        if (!out_of_scope) {
            return null;
        }

        // Check that the symbol type matches the reference type
        if (reference_type === 'local_macro' && out_of_scope.type !== 'local') {
            return null;
        }
        if (reference_type === 'global_macro' && out_of_scope.type !== 'global') {
            return null;
        }

        // Generate hover content with "(out of scope)" indicator
        const type_label = out_of_scope.type === 'local' ? 'Local Macro' : 'Global Macro';
        const source_link = this.format_source_link(out_of_scope.source_uri, current_uri, workspace_root);
        // Display line as 1-indexed (defined_line is 0-indexed)
        const line_info = `, line ${out_of_scope.defined_line + 1}`;
        const source_info = source_link
            ? `\n\nSource: ${source_link}${line_info}`
            : `\n\nDefined at: this file${line_info}`;

        return {
            type: reference_type === 'local_macro' ? 'local_macro' : 'global_macro',
            content: {
                kind: MarkupKind.Markdown,
                value: `**${type_label}:** \`${word}\` (out of scope)${source_info}`,
            },
        };
    }

    /**
     * Collect all symbol matches for a given word at position.
     * Returns matches in display order: Local Macro, Global Macro, Program, Scalar, Matrix, Variable.
     *
     * When the reference type is explicit (local macro with backtick or global macro with $),
     * only returns matches of that specific type. When the reference type is 'other' (bare identifier),
     * returns all matching symbol types.
     *
     * @param document - The document state
     * @param position - The cursor position
     * @param word - The word to match
     * @param workspace_symbols - Optional workspace-level symbols
     * @param resolved_scope - Optional resolved scope from cross-file resolution
     * @param workspace_root - Optional workspace root for relative path display
     * @returns Array of SymbolMatch objects in display order
     */
    private collect_all_symbol_matches(
        document: DocumentState,
        position: Position,
        word: string,
        workspace_symbols?: SymbolTable,
        resolved_scope?: ResolvedScope,
        workspace_root?: string,
        workspace_indexer?: WorkspaceIndexer,
    ): SymbolMatch[] {
        // Check for out-of-scope symbol matching the reference type.
        const reference_type = this.get_reference_type_from_context(document, position, word);

        // Local-macro references resolve through the scoped/inherited
        // precedence FIRST (#270: a visible program-scoped local wins,
        // an out-of-scope name falls through to the inherited do-file
        // local — all inside get_local_macro_hover); the cross-file
        // out-of-scope display renders only when that resolution has
        // no answer, so it can never hijack a resolvable reference.
        if (reference_type === 'local_macro') {
            const local_macro_content = this.get_local_macro_hover(
                document, word, resolved_scope, workspace_root,
                position, workspace_indexer
            );
            if (local_macro_content) {
                return [{ type: 'local_macro', content: local_macro_content }];
            }
            const out_of_scope_only = this.get_out_of_scope_hover(
                word, reference_type, resolved_scope, document.uri,
                workspace_root
            );
            return out_of_scope_only ? [out_of_scope_only] : [];
        }

        // Check for out-of-scope symbol matching the reference type
        const out_of_scope_match = this.get_out_of_scope_hover(
            word, reference_type, resolved_scope, document.uri, workspace_root
        );
        if (out_of_scope_match) {
            return [out_of_scope_match];
        }

        const the_matches: SymbolMatch[] = [];

        // Explicit global-macro syntax checks only that type;
        // When reference type is 'other' (bare identifier), check all symbol types

        // 1. Check local macros - only for bare identifiers (explicit
        //    local-macro references returned above)
        if (reference_type === 'other') {
            const local_macro_content = this.get_local_macro_hover(document, word, resolved_scope, workspace_root, position, workspace_indexer);
            if (local_macro_content) {
                the_matches.push({ type: 'local_macro', content: local_macro_content });
            }
        }

        // 2. Check global macros - only if reference is global macro or bare identifier
        if (reference_type === 'global_macro' || reference_type === 'other') {
            const global_macro_content = this.get_global_macro_hover(document, word, workspace_symbols, resolved_scope, workspace_root, position, workspace_indexer);
            if (global_macro_content) {
                the_matches.push({ type: 'global_macro', content: global_macro_content });
            }
        }

        // For explicit macro references (local or global), don't check other symbol types
        // Programs, scalars, matrices, and variables are only relevant for bare identifiers
        if (reference_type !== 'other') {
            return the_matches;
        }

        // 3. Check programs (only for bare identifiers)
        const program_content = this.get_program_hover(document, word, workspace_symbols, resolved_scope, workspace_root, position, workspace_indexer);
        if (program_content) {
            the_matches.push({ type: 'program', content: program_content });
        }

        // 4. Check scalars (only for bare identifiers)
        const scalar_content = this.get_scalar_hover(document, word, workspace_symbols, resolved_scope, workspace_root, position, workspace_indexer);
        if (scalar_content) {
            the_matches.push({ type: 'scalar', content: scalar_content });
        }

        // 5. Check matrices (only for bare identifiers)
        const matrix_content = this.get_matrix_hover(document, word, workspace_symbols, resolved_scope, workspace_root, position, workspace_indexer);
        if (matrix_content) {
            the_matches.push({ type: 'matrix', content: matrix_content });
        }

        // 6. Check variables (only for bare identifiers)
        const variable_content = this.get_variable_hover(document, word, workspace_symbols, resolved_scope, workspace_root, position);
        if (variable_content) {
            the_matches.push({ type: 'variable', content: variable_content });
        }

        return the_matches;
    }

    /**
     * Build a redefinition footer for a symbol with additional_definitions.
     * Variants:
     *  - Same-file only: "Redefined at lines 3, 5 — see all references"
     *  - Cross-file only: "Redefined in 2 other files — see all references"
     *  - Mixed: "Redefined at lines 3 and in 2 other files — see all references"
     * Returns empty string when there are no additional definitions.
     */
    /**
     * Aggregate all known definitions of a symbol across the workspace
     * (current file + every indexed file) into a single additional_definitions
     * array, with the `primary` entry excluded (so the caller can append it to
     * the primary hover card).
     *
     * NOTE — deliberately uncached. `find_symbol_definitions` iterates every
     * entry in the indexer's symbol_index, which is O(F) per call. Hover fires
     * per mouse rest, so this is measurable on very large workspaces. The cost
     * pays for cross-file footer accuracy; revisit with an LRU keyed on
     * (workspace_indexer.get_version(), name, type) only if profiling shows it
     * hot. Do not speculate; measure first.
     */
    private collect_workspace_additional_definitions(
        name: string,
        symbol_type: 'program' | 'local' | 'global' | 'scalar' | 'matrix',
        primary: SymbolWithAdditionalDefinitions | undefined,
        workspace_indexer: WorkspaceIndexer | undefined,
        current_uri: string,
    ): AdditionalDefinitionEntry[] {
        const the_accumulated: AdditionalDefinitionEntry[] = [];
        // Start with the primary's own same-file additional_definitions,
        // skipping loop-expanded synthetic entries (their line points at a
        // template statement, not a literal occurrence of the name).
        if (primary?.additional_definitions) {
            for (const my_extra of primary.additional_definitions) {
                if (my_extra.is_expanded) continue;
                the_accumulated.push(my_extra);
            }
        }
        if (!workspace_indexer) {
            return the_accumulated;
        }
        // `get_related_uris` is a method on the real WorkspaceIndexer but may
        // be absent on test stubs; treat that as "no reachability gate".
        const the_candidate_uris = typeof workspace_indexer.get_related_uris === 'function'
            ? (
                symbol_type === 'local'
                    ? workspace_indexer.get_related_uris(current_uri, {
                        include_only: true,
                    })
                    : workspace_indexer.get_related_uris(current_uri)
            )
            : null;
        // Then include every workspace-indexed definition (primary + extras) for
        // files other than the current primary's file.
        const primary_uri = primary?.location?.uri;
        const the_seen_keys = new Set<string>();
        // Prevent double-adding the current primary and its same-file extras.
        if (primary_uri) {
            // The primary's own location is always the hover card's "Source"
            // header — never a footer entry.
            const primary_range = primary?.location?.range;
            if (primary_range) {
                the_seen_keys.add(`${primary_uri}:${primary_range.start.line}`);
            }
            // Post-M-4, analyzer guarantees every extra's `.line` matches
            // `.location.range.start.line`; this keying reflects that
            // invariant and falls back to `.line` only if a test stub
            // supplies an extra without a populated range.
            for (const my_extra of primary?.additional_definitions ?? []) {
                const my_extra_line =
                    my_extra.location?.range?.start?.line ?? my_extra.line;
                the_seen_keys.add(`${my_extra.location.uri}:${my_extra_line}`);
            }
        }
        const the_hits = workspace_indexer.find_symbol_definitions(name, symbol_type);
        for (const my_hit of the_hits) {
            // Skips the hit and its extras. Same-file hits stay:
            // redefinitions within the current file are real.
            if (
                my_hit.sourceUri !== current_uri &&
                is_cross_file_hidden_local(symbol_type, my_hit)
            ) {
                continue;
            }
            const my_location = my_hit.location as
                | { uri: string; range: Range }
                | undefined;
            if (my_location) {
                if (the_candidate_uris && !the_candidate_uris.has(my_location.uri)) {
                    continue;
                }
                if (primary_uri && my_location.uri === primary_uri) {
                    continue;
                }
                // A loop-expanded workspace symbol anchors at the template
                // statement, whose text never contains the concrete name, so it
                // must not be surfaced as a footer entry. Its synthetic extras
                // are skipped below (line ~823); mirror that guard here for the
                // primary hit, matching src/providers/references.ts.
                const hit_is_expanded =
                    'is_expanded' in my_hit
                    && (my_hit as { is_expanded?: boolean }).is_expanded === true;
                const my_key = `${my_location.uri}:${my_location.range?.start?.line ?? -1}`;
                if (!hit_is_expanded && !the_seen_keys.has(my_key)) {
                    the_seen_keys.add(my_key);
                    the_accumulated.push({
                        index: has_definition_index(my_hit)
                            ? my_hit.definition_index
                            : 0,
                        line: my_location.range?.start?.line ?? 0,
                        location: { uri: my_location.uri, range: my_location.range },
                    });
                }
            }
            const the_extras: AdditionalDefinitionEntry[] | undefined =
                has_additional_definitions(my_hit)
                    ? my_hit.additional_definitions
                    : undefined;
            if (the_extras) {
                for (const my_extra of the_extras) {
                    if (my_extra.is_expanded) continue;
                    if (the_candidate_uris && !the_candidate_uris.has(my_extra.location.uri)) {
                        continue;
                    }
                    if (primary_uri && my_extra.location.uri === primary_uri) {
                        continue;
                    }
                    const my_extra_line =
                        my_extra.location?.range?.start?.line ?? my_extra.line;
                    const my_extra_key = `${my_extra.location.uri}:${my_extra_line}`;
                    if (!the_seen_keys.has(my_extra_key)) {
                        the_seen_keys.add(my_extra_key);
                        the_accumulated.push(my_extra);
                    }
                }
            }
        }
        return the_accumulated;
    }

    private format_redefinition_footer(
        primary_uri: string | undefined,
        additional_definitions:
            | Array<{ line: number; location?: { uri: string } }>
            | undefined,
    ): string {
        if (!additional_definitions || additional_definitions.length === 0) {
            return '';
        }
        const same_file_lines: number[] = [];
        const the_other_file_uris = new Set<string>();
        for (const my_extra of additional_definitions) {
            const my_uri = my_extra.location?.uri;
            if (primary_uri && my_uri && my_uri === primary_uri) {
                same_file_lines.push(my_extra.line + 1); // LSP is 0-indexed; hover is 1-indexed.
            } else if (my_uri) {
                the_other_file_uris.add(my_uri);
            } else {
                // Extra with no location — treat as same-file (line-only).
                same_file_lines.push(my_extra.line + 1);
            }
        }
        same_file_lines.sort((a, b) => a - b);

        const has_same_file = same_file_lines.length > 0;
        const has_cross_file = the_other_file_uris.size > 0;
        if (!has_same_file && !has_cross_file) {
            return '';
        }
        const line_word = same_file_lines.length === 1 ? 'line' : 'lines';
        const file_word = the_other_file_uris.size === 1 ? 'other file' : 'other files';

        let body: string;
        if (has_same_file && has_cross_file) {
            body = `Redefined at ${line_word} ${same_file_lines.join(', ')} and in ${the_other_file_uris.size} ${file_word}`;
        } else if (has_same_file) {
            body = `Redefined at ${line_word} ${same_file_lines.join(', ')}`;
        } else {
            body = `Redefined in ${the_other_file_uris.size} ${file_word}`;
        }
        return `\n\n${body} — see all references`;
    }

    /**
     * Safely get visible symbols from a resolved scope, guarding against partial stubs.
     * Returns resolved_scope.symbols when chain is missing/undefined or when position is falsy,
     * otherwise delegates to get_visible_symbols_at for proper position filtering.
     *
     * @param resolved_scope - The resolved scope (may be a partial stub)
     * @param position - Optional cursor position for forward call symbol filtering
     */
    private safe_visible_symbols(
        resolved_scope: ResolvedScope | undefined,
        position?: Position
    ): SymbolTable | undefined {
        if (!resolved_scope) {
            return undefined;
        }
        // For partial stubs without chain, or when position is undefined, use symbols directly
        if (!resolved_scope.chain || !position) {
            return resolved_scope.symbols;
        }
        // Otherwise use position-aware filtering
        return get_visible_symbols_at(resolved_scope, position.line);
    }

    /**
     * The ", line N" suffix shown after a macro's source. For loop-expanded
     * macros the line is the loop-body template statement (e.g. `local x_`i'`),
     * whose text does not contain the concrete name, so it is annotated
     * "(loop-expanded)" rather than presented as a literal occurrence —
     * consistent with find-references skipping those synthetic locations.
     */
    private macro_definition_line_info(macro: MacroSymbol): string {
        if (macro.definition_line === undefined) return '';
        const note = macro.is_expanded ? ' (loop-expanded)' : '';
        return `, line ${macro.definition_line + 1}${note}`;
    }

    /**
     * Get hover info for a local macro only.
     * Checks resolved scope, forward call symbols (with position filtering), and document symbols.
     *
     * @param document - The document state
     * @param word - The macro name to look up
     * @param resolved_scope - Optional resolved scope from cross-file resolution
     * @param workspace_root - Optional workspace root for relative path display
     * @param position - Optional cursor position for forward call symbol filtering
     */
    private get_local_macro_hover(
        document: DocumentState,
        word: string,
        resolved_scope?: ResolvedScope,
        workspace_root?: string,
        position?: Position,
        workspace_indexer?: WorkspaceIndexer,
    ): MarkupContent | null {
        // Scope-aware same-file resolution first (#270).
        const scoped = position
            ? lookup_scoped_local_macro(document.scopes, position, word)
            : { symbol: undefined, forward_only: false, out_of_scope: false };
        if (
            scoped.symbol?.containingScope === 'program' &&
            !scoped.forward_only
        ) {
            // Program locals never cross files (#271) — the visible
            // program-scoped symbol is unconditionally the answer, and
            // it fixes the case where an unrelated same-named local
            // elsewhere in the file holds the flat slot. The workspace
            // indexer is deliberately withheld: the redefinition
            // footer must not pool cross-file same-name locals for a
            // symbol whose identity never crosses files (matching
            // definition/references skipping their cross-file scans).
            return this.render_local_macro_hover(
                document, scoped.symbol, word, workspace_root,
                undefined,
            );
        }
        if (scoped.out_of_scope || scoped.forward_only) {
            // No positionally resolved same-file winner. A cross-file
            // INHERITED do-file local is genuinely defined at this
            // position (the analyzer's cross-file suppression treats
            // it as defined), so it outranks a not-yet-defined
            // same-scope forward local (round-9 gate) and is the only
            // candidate for an out-of-scope name (round-2 gate). The
            // workspace indexer is withheld: its footer keeps
            // same-file hits, so the very sibling or forward
            // program-local would be presented as a "redefinition" of
            // the inherited macro (round-5 gate).
            const inherited = position
                ? find_inherited_dofile_local(
                    resolved_scope, word, position.line, document.uri
                )
                : undefined;
            if (inherited) {
                return this.render_local_macro_hover(
                    document, inherited, word, workspace_root,
                    undefined,
                );
            }
            if (
                scoped.forward_only &&
                scoped.symbol?.containingScope === 'program'
            ) {
                // Forward identity target: navigation-friendly hover
                // for a same-scope reference before its definition.
                return this.render_local_macro_hover(
                    document, scoped.symbol, word, workspace_root,
                    undefined,
                );
            }
            if (scoped.out_of_scope) {
                return null;
            }
            // Do-file forward: fall through to the resolved-scope /
            // flat paths, which own do-file-level precedence.
        }

        // Do-file-scoped or no scoped opinion: unchanged — the
        // resolved scope / flat fallback also apply CROSS-FILE
        // execution-order precedence that document.scopes (a
        // same-file-only structure) cannot see.
        const local_macro_symbols = this.safe_visible_symbols(resolved_scope, position);
        if (local_macro_symbols) {
            const local_macro = local_macro_symbols.localMacros.get(word);
            if (local_macro) {
                return this.render_local_macro_hover(
                    document, local_macro, word, workspace_root,
                    workspace_indexer,
                );
            }
        }

        // Fallback to document symbols
        const local_macro = document.symbols.localMacros.get(word);
        if (local_macro) {
            return this.render_local_macro_hover(
                document, local_macro, word, workspace_root,
                workspace_indexer,
            );
        }

        return null;
    }

    /**
     * Render the hover markdown for a resolved local-macro symbol
     * (shared by the scoped, resolved-scope, and flat lookups above).
     */
    private render_local_macro_hover(
        document: DocumentState,
        local_macro: MacroSymbol,
        word: string,
        workspace_root?: string,
        workspace_indexer?: WorkspaceIndexer,
    ): MarkupContent {
        const source_link = this.format_source_link(local_macro.sourceUri, document.uri, workspace_root);
        const line_info = this.macro_definition_line_info(local_macro);
        const source_info = source_link
            ? `\n\nSource: ${source_link}${line_info}`
            : `\n\nDefined at: this file${line_info}`;
        // Use inline code for short values, code block for multi-line
        const expansion_text = local_macro.value
            ? (local_macro.value.includes('\n')
                ? `\n\nExpansion:\n\`\`\`\n${local_macro.value}\n\`\`\``
                : `\n\nExpansion: \`${local_macro.value}\``)
            : '';
        const the_combined_extras = this.collect_workspace_additional_definitions(
            word, 'local', local_macro, workspace_indexer, document.uri,
        );
        const footer = this.format_redefinition_footer(
            local_macro.location?.uri ?? local_macro.sourceUri,
            the_combined_extras,
        );
        return {
            kind: MarkupKind.Markdown,
            value: `**Local Macro:** \`${word}\`${source_info}${expansion_text}${footer}`,
        };
    }

    /**
     * Get hover info for a global macro only.
     * Checks resolved scope, forward call symbols (with position filtering), and document/workspace symbols.
     *
     * @param document - The document state
     * @param word - The macro name to look up
     * @param workspace_symbols - Optional workspace-level symbols
     * @param resolved_scope - Optional resolved scope from cross-file resolution
     * @param workspace_root - Optional workspace root for relative path display
     * @param position - Optional cursor position for forward call symbol filtering
     */
    private get_global_macro_hover(
        document: DocumentState,
        word: string,
        workspace_symbols?: SymbolTable,
        resolved_scope?: ResolvedScope,
        workspace_root?: string,
        position?: Position,
        workspace_indexer?: WorkspaceIndexer,
    ): MarkupContent | null {
        // Check resolved scope first if available
        const global_macro_symbols = this.safe_visible_symbols(resolved_scope, position);
        if (global_macro_symbols) {
            const global_macro = global_macro_symbols.globalMacros.get(word);
            if (global_macro) {
                const source_link = this.format_source_link(global_macro.sourceUri, document.uri, workspace_root);
                const line_info = this.macro_definition_line_info(global_macro);
                const source_info = source_link
                    ? `\n\nSource: ${source_link}${line_info}`
                    : `\n\nDefined at: this file${line_info}`;
                // Use inline code for short values, code block for multi-line
                const expansion_text = global_macro.value
                    ? (global_macro.value.includes('\n')
                        ? `\n\nExpansion:\n\`\`\`\n${global_macro.value}\n\`\`\``
                        : `\n\nExpansion: \`${global_macro.value}\``)
                    : '';
                const the_combined_extras = this.collect_workspace_additional_definitions(
                    word, 'global', global_macro, workspace_indexer, document.uri,
                );
                const footer = this.format_redefinition_footer(
                    global_macro.location?.uri ?? global_macro.sourceUri,
                    the_combined_extras,
                );
                return {
                    kind: MarkupKind.Markdown,
                    value: `**Global Macro:** \`${word}\`${source_info}${expansion_text}${footer}`,
                };
            }
        }

        // Fallback to document symbols then workspace symbols
        const global_macro = document.symbols.globalMacros.get(word) || workspace_symbols?.globalMacros.get(word);
        if (global_macro) {
            const source_link = this.format_source_link(global_macro.sourceUri, document.uri, workspace_root);
            const line_info = this.macro_definition_line_info(global_macro);
            const source_info = source_link
                ? `\n\nSource: ${source_link}${line_info}`
                : `\n\nDefined at: this file${line_info}`;
            // Use inline code for short values, code block for multi-line
            const expansion_text = global_macro.value
                ? (global_macro.value.includes('\n')
                    ? `\n\nExpansion:\n\`\`\`\n${global_macro.value}\n\`\`\``
                    : `\n\nExpansion: \`${global_macro.value}\``)
                : '';
            const the_combined_extras = this.collect_workspace_additional_definitions(
                word, 'global', global_macro, workspace_indexer, document.uri,
            );
            const footer = this.format_redefinition_footer(
                global_macro.location?.uri ?? global_macro.sourceUri,
                the_combined_extras,
            );
            return {
                kind: MarkupKind.Markdown,
                value: `**Global Macro:** \`${word}\`${source_info}${expansion_text}${footer}`,
            };
        }

        return null;
    }

    /**
     * Get hover info for a scalar only.
     * Lookup precedence: resolved_scope → forward_call_symbols → document.symbols → workspace_symbols
     *
     * @param document - The document state
     * @param word - The scalar name to look up
     * @param workspace_symbols - Optional workspace-level symbols
     * @param resolved_scope - Optional resolved scope from cross-file resolution
     * @param workspace_root - Optional workspace root for relative path display
     * @param position - Optional cursor position for forward call symbol filtering
     */
    private get_scalar_hover(
        document: DocumentState,
        word: string,
        workspace_symbols?: SymbolTable,
        resolved_scope?: ResolvedScope,
        workspace_root?: string,
        position?: Position,
        workspace_indexer?: WorkspaceIndexer,
    ): MarkupContent | null {
        // 1. Check resolved_scope first (highest precedence)
        const scalar_symbols = this.safe_visible_symbols(resolved_scope, position);
        if (scalar_symbols) {
            const scalar = scalar_symbols.scalars.get(word);
            if (scalar) {
                const source_link = this.format_source_link(scalar.sourceUri, document.uri, workspace_root);
                const line_info = scalar.definition_line !== undefined ? `, line ${scalar.definition_line + 1}` : '';
                const source_info = source_link
                    ? `\n\nSource: ${source_link}${line_info}`
                    : `\n\nDefined at: this file${line_info}`;
                const the_combined_extras = this.collect_workspace_additional_definitions(
                    word, 'scalar', scalar, workspace_indexer, document.uri,
                );
                const footer = this.format_redefinition_footer(
                    scalar.location?.uri ?? scalar.sourceUri,
                    the_combined_extras,
                );
                return {
                    kind: MarkupKind.Markdown,
                    value: `**Scalar:** \`${word}\`${source_info}${footer}`,
                };
            }
        }

        // 2. Check document.symbols (current file)
        const doc_scalar = document.symbols?.scalars?.get(word);
        if (doc_scalar) {
            const source_link = this.format_source_link(doc_scalar.sourceUri, document.uri, workspace_root);
            const line_info = doc_scalar.definition_line !== undefined ? `, line ${doc_scalar.definition_line + 1}` : '';
            const source_info = source_link
                ? `\n\nSource: ${source_link}${line_info}`
                : `\n\nDefined at: this file${line_info}`;
            const the_combined_extras = this.collect_workspace_additional_definitions(
                word, 'scalar', doc_scalar, workspace_indexer, document.uri,
            );
            const footer = this.format_redefinition_footer(
                doc_scalar.location?.uri ?? doc_scalar.sourceUri,
                the_combined_extras,
            );
            return {
                kind: MarkupKind.Markdown,
                value: `**Scalar:** \`${word}\`${source_info}${footer}`,
            };
        }

        // 3. Check workspace_symbols (lowest precedence)
        if (workspace_symbols) {
            const ws_scalar = workspace_symbols.scalars?.get(word);
            if (ws_scalar) {
                const source_link = this.format_source_link(ws_scalar.sourceUri, document.uri, workspace_root);
                const line_info = ws_scalar.definition_line !== undefined ? `, line ${ws_scalar.definition_line + 1}` : '';
                const source_info = source_link
                    ? `\n\nSource: ${source_link}${line_info}`
                    : `\n\nDefined at: this file${line_info}`;
                const the_combined_extras = this.collect_workspace_additional_definitions(
                    word, 'scalar', ws_scalar, workspace_indexer, document.uri,
                );
                const footer = this.format_redefinition_footer(
                    ws_scalar.location?.uri ?? ws_scalar.sourceUri,
                    the_combined_extras,
                );
                return {
                    kind: MarkupKind.Markdown,
                    value: `**Scalar:** \`${word}\`${source_info}${footer}`,
                };
            }
        }

        return null;
    }

    /**
     * Get hover info for a matrix only.
     * Lookup precedence: resolved_scope → forward_call_symbols → document.symbols → workspace_symbols
     *
     * @param document - The document state
     * @param word - The matrix name to look up
     * @param workspace_symbols - Optional workspace-level symbols
     * @param resolved_scope - Optional resolved scope from cross-file resolution
     * @param workspace_root - Optional workspace root for relative path display
     * @param position - Optional cursor position for forward call symbol filtering
     */
    private get_matrix_hover(
        document: DocumentState,
        word: string,
        workspace_symbols?: SymbolTable,
        resolved_scope?: ResolvedScope,
        workspace_root?: string,
        position?: Position,
        workspace_indexer?: WorkspaceIndexer,
    ): MarkupContent | null {
        // 1. Check resolved_scope first (highest precedence)
        const matrix_symbols = this.safe_visible_symbols(resolved_scope, position);
        if (matrix_symbols) {
            const matrix = matrix_symbols.matrices.get(word);
            if (matrix) {
                const source_link = this.format_source_link(matrix.sourceUri, document.uri, workspace_root);
                const line_info = matrix.definition_line !== undefined ? `, line ${matrix.definition_line + 1}` : '';
                const source_info = source_link
                    ? `\n\nSource: ${source_link}${line_info}`
                    : `\n\nDefined at: this file${line_info}`;
                const the_combined_extras = this.collect_workspace_additional_definitions(
                    word, 'matrix', matrix, workspace_indexer, document.uri,
                );
                const footer = this.format_redefinition_footer(
                    matrix.location?.uri ?? matrix.sourceUri,
                    the_combined_extras,
                );
                return {
                    kind: MarkupKind.Markdown,
                    value: `**Matrix:** \`${word}\`${source_info}${footer}`,
                };
            }
        }

        // 2. Check document.symbols (current file)
        const doc_matrix = document.symbols?.matrices?.get(word);
        if (doc_matrix) {
            const source_link = this.format_source_link(doc_matrix.sourceUri, document.uri, workspace_root);
            const line_info = doc_matrix.definition_line !== undefined ? `, line ${doc_matrix.definition_line + 1}` : '';
            const source_info = source_link
                ? `\n\nSource: ${source_link}${line_info}`
                : `\n\nDefined at: this file${line_info}`;
            const the_combined_extras = this.collect_workspace_additional_definitions(
                word, 'matrix', doc_matrix, workspace_indexer, document.uri,
            );
            const footer = this.format_redefinition_footer(
                doc_matrix.location?.uri ?? doc_matrix.sourceUri,
                the_combined_extras,
            );
            return {
                kind: MarkupKind.Markdown,
                value: `**Matrix:** \`${word}\`${source_info}${footer}`,
            };
        }

        // 3. Check workspace_symbols (lowest precedence)
        if (workspace_symbols) {
            const ws_matrix = workspace_symbols.matrices?.get(word);
            if (ws_matrix) {
                const source_link = this.format_source_link(ws_matrix.sourceUri, document.uri, workspace_root);
                const line_info = ws_matrix.definition_line !== undefined ? `, line ${ws_matrix.definition_line + 1}` : '';
                const source_info = source_link
                    ? `\n\nSource: ${source_link}${line_info}`
                    : `\n\nDefined at: this file${line_info}`;
                const the_combined_extras = this.collect_workspace_additional_definitions(
                    word, 'matrix', ws_matrix, workspace_indexer, document.uri,
                );
                const footer = this.format_redefinition_footer(
                    ws_matrix.location?.uri ?? ws_matrix.sourceUri,
                    the_combined_extras,
                );
                return {
                    kind: MarkupKind.Markdown,
                    value: `**Matrix:** \`${word}\`${source_info}${footer}`,
                };
            }
        }

        return null;
    }

    /**
     * Get subcommand context for the current position using token-based detection.
     * Verifies that the hovered word is actually at the subcommand position
     * (immediately after the prefix command like 'frame' or 'mi').
     *
     * Uses document.tokens if available for accurate detection, otherwise falls back
     * to line-based heuristics.
     */
    private get_subcommand_context(
        document: DocumentState,
        position: Position,
        hovered_word: string,
        cancellation_token?: CancellationToken
    ): {
        is_subcommand: boolean;
        prefix_command: string | null;
    } {
        // Try token-based detection first if tokens are available
        if (document.tokens && document.tokens.length > 0) {
            return this.get_subcommand_context_from_tokens(document, position, hovered_word, cancellation_token);
        }

        // Fall back to line-based heuristics
        return this.get_subcommand_context_from_line(document, position, hovered_word);
    }

    /**
     * True when the source-text word is recognized as a prefix command with
     * subcommands (e.g. `frame`, `mi`). Stata prefix commands are
     * case-sensitive and canonical-lowercase; `has_subcommands` lowercases
     * internally, so mis-cased forms like `FRAME` need an explicit guard.
     */
    private is_canonical_prefix_with_subcommands(source_word: string): boolean {
        if (source_word !== source_word.toLowerCase()) {
            return false;
        }
        return this.command_db.has_subcommands(source_word);
    }

    /**
     * Token-based subcommand context detection.
     * Finds the hovered token and checks if the previous non-trivia token is a prefix command.
     *
     * Complexity: O(log N + S) where N is the token count and S is the
     * number of tokens in the current statement. Binary-searches the
     * hovered token and scans backwards only as far as the most recent
     * STATEMENT_TERMINATOR.
     */
    private get_subcommand_context_from_tokens(
        document: DocumentState,
        position: Position,
        hovered_word: string,
        cancellation_token?: CancellationToken
    ): {
        is_subcommand: boolean;
        prefix_command: string | null;
    } {
        if (cancellation_token?.isCancellationRequested) {
            return { is_subcommand: false, prefix_command: null };
        }
        const tokens = document.tokens!;
        const STANDARD_PREFIXES = ['by', 'bysort', 'quietly', 'capture', 'noisily', 'qui', 'cap', 'noi'];
        const TRIVIA_TYPES = ['WHITESPACE', 'COMMENT_LINE', 'COMMENT_BLOCK', 'CONTINUATION'];

        // Find the WORD token whose value matches `hovered_word` at the
        // cursor position via binary search. The usual candidate is the
        // token whose range contains the cursor; at a trailing boundary
        // (cursor immediately after the word), the matching token is the
        // preceding one, so we fall back to check it.
        const hovered_token_index = this.find_hovered_word_token_index(
            tokens,
            position,
            hovered_word
        );

        if (hovered_token_index === -1) {
            return { is_subcommand: false, prefix_command: null };
        }

        // Find the start of the current statement (after last STATEMENT_TERMINATOR or start of file)
        const statement_start_index =
            this.find_statement_start_index(tokens, hovered_token_index - 1);

        // Collect non-trivia WORD tokens from statement start to hovered token.
        // Preserve raw source case; Stata commands/prefixes are case-sensitive.
        const the_statement_words: { value: string; index: number }[] = [];
        for (let i = statement_start_index; i <= hovered_token_index; i++) {
            const token = tokens[i];
            if (token.type === 'WORD' && !TRIVIA_TYPES.includes(token.type)) {
                the_statement_words.push({ value: token.value, index: i });
            }
        }

        if (the_statement_words.length < 2) {
            return { is_subcommand: false, prefix_command: null };
        }

        // Skip standard prefixes (by, quietly, capture, etc.)
        let command_word_index = 0;
        while (command_word_index < the_statement_words.length - 1 &&
               STANDARD_PREFIXES.includes(the_statement_words[command_word_index].value)) {
            command_word_index++;
        }

        // Handle "by varlist:" pattern - skip to after colon.
        // Only applies when we skipped a by/bysort prefix; otherwise a stray
        // colon (or mis-cased `BY`) shouldn't bump us past its varlist.
        const BY_PREFIXES = ['by', 'bysort'];
        const skipped_by_prefix = the_statement_words
            .slice(0, command_word_index)
            .some(w => BY_PREFIXES.includes(w.value));
        if (skipped_by_prefix) {
            for (let i = the_statement_words[command_word_index].index; i < hovered_token_index; i++) {
                if (tokens[i].type === 'COLON') {
                    // Find next WORD after colon
                    for (let j = i + 1; j <= hovered_token_index; j++) {
                        if (tokens[j].type === 'WORD') {
                            // Update command_word_index to point to this word
                            for (let k = 0; k < the_statement_words.length; k++) {
                                if (the_statement_words[k].index === j) {
                                    command_word_index = k;
                                    break;
                                }
                            }
                            break;
                        }
                    }
                    break;
                }
            }
        }

        // The word at command_word_index should be the prefix command
        const potential_prefix = the_statement_words[command_word_index].value;

        if (!this.is_canonical_prefix_with_subcommands(potential_prefix)) {
            return { is_subcommand: false, prefix_command: null };
        }

        // The hovered word should be immediately after the prefix command.
        // IMPORTANT: identify the hovered word by token index (not by value),
        // otherwise repeated words in the same statement can be misclassified.
        const hovered_word_index = the_statement_words.findIndex(
            w => w.index === hovered_token_index
        );

        if (hovered_word_index !== command_word_index + 1) {
            return { is_subcommand: false, prefix_command: null };
        }

        // Verify the hovered word is a valid subcommand. Subcommands
        // are case-sensitive and stored canonical-lowercase, so compare
        // exactly: `frame Create` is not valid Stata.
        const subcommands = this.command_db.get_subcommands(potential_prefix);
        if (!subcommands) {
            return { is_subcommand: false, prefix_command: null };
        }

        const is_valid_subcommand = subcommands.some(
            sub => sub.name === hovered_word
        );

        if (!is_valid_subcommand) {
            return { is_subcommand: false, prefix_command: null };
        }

        return { is_subcommand: true, prefix_command: potential_prefix };
    }

    /**
     * Locate the WORD token at the cursor that matches `hovered_word`.
     *
     * Uses `find_token_index_at_position` (LSP [start, end) semantics) and
     * falls back to the preceding token when the cursor sits exactly at
     * the end boundary of a word (e.g. just after the final character).
     * This mirrors the inclusive-end check the linear scan performed.
     */
    private find_hovered_word_token_index(
        tokens: Token[],
        position: Position,
        hovered_word: string
    ): number {
        const is_match = (token: Token): boolean =>
            token.type === 'WORD'
            && token.value === hovered_word
            && token.range.start.line === position.line;

        const covering = find_token_index_at_position(tokens, position);
        if (covering !== -1 && is_match(tokens[covering])) {
            return covering;
        }

        // Cursor may be at the trailing boundary of the word, where the
        // covering token under LSP [start, end) semantics is the next
        // token (e.g. whitespace). Check the immediately preceding token
        // with inclusive-end semantics.
        const prev_index = find_last_token_starting_before(tokens, position);
        if (
            prev_index !== -1
            && prev_index !== covering
            && is_match(tokens[prev_index])
            && tokens[prev_index].range.end.character >= position.character
        ) {
            return prev_index;
        }

        return -1;
    }

    /**
     * Line-based fallback for subcommand context detection.
     */
    private get_subcommand_context_from_line(document: DocumentState, position: Position, hovered_word: string): {
        is_subcommand: boolean;
        prefix_command: string | null;
    } {
        const line = get_line_text(document, position.line);
        if (line === '') {
            return { is_subcommand: false, prefix_command: null };
        }

        // Find word boundaries for the hovered word
        const word_info = this.get_word_at_position(document, position);
        if (!word_info || word_info.word !== hovered_word) {
            return { is_subcommand: false, prefix_command: null };
        }

        const hovered_start = word_info.range.start.character;

        // Get text before the hovered word
        const text_before_hovered = line.substring(0, hovered_start).trim();

        if (text_before_hovered === '') {
            return { is_subcommand: false, prefix_command: null };
        }

        // Split into tokens
        const tokens_before = text_before_hovered.split(/\s+/).filter(t => t.length > 0);

        if (tokens_before.length === 0) {
            return { is_subcommand: false, prefix_command: null };
        }

        // Skip standard prefix commands (by, quietly, capture, etc.).
        // Stata prefix commands are case-sensitive and must be lowercase.
        const standard_prefixes = ['by', 'bysort', 'quietly', 'capture', 'noisily', 'qui', 'cap', 'noi'];
        let command_index = 0;
        while (command_index < tokens_before.length &&
               standard_prefixes.includes(tokens_before[command_index])) {
            command_index++;
        }

        // Handle "by varlist:" pattern only when we actually skipped a
        // lowercase by/bysort prefix. This keeps merge syntax like 1:m, or
        // mis-cased BY, from being treated as a by-prefix colon form.
        const skipped_by = tokens_before
            .slice(0, command_index)
            .some(t => t === 'by' || t === 'bysort');
        if (skipped_by && text_before_hovered.includes(':')) {
            const after_colon = text_before_hovered.split(':').pop()?.trim() || '';
            const words_after_colon = after_colon.split(/\s+/).filter(t => t.length > 0);
            if (words_after_colon.length > 0) {
                // Reset to check words after colon. Preserve source case so
                // mis-cased prefix commands are rejected by the case guard.
                const potential_prefix = words_after_colon[0];
                if (
                    this.is_canonical_prefix_with_subcommands(potential_prefix)
                    && words_after_colon.length === 1
                ) {
                    const subcommands = this.command_db.get_subcommands(potential_prefix);
                    // Exact match: subcommands are case-sensitive.
                    const is_valid = subcommands?.some(
                        sub => sub.name === hovered_word
                    );
                    if (is_valid) {
                        return { is_subcommand: true, prefix_command: potential_prefix };
                    }
                }
                return { is_subcommand: false, prefix_command: null };
            }
        }

        if (command_index >= tokens_before.length) {
            return { is_subcommand: false, prefix_command: null };
        }

        // The token at command_index should be the prefix command.
        // Preserve source case so mis-cased prefixes (e.g. `FRAME`) are
        // rejected by the case guard.
        const potential_prefix = tokens_before[command_index];

        if (!this.is_canonical_prefix_with_subcommands(potential_prefix)) {
            return { is_subcommand: false, prefix_command: null };
        }

        // Verify the hovered word is immediately after the prefix command
        if (command_index !== tokens_before.length - 1) {
            return { is_subcommand: false, prefix_command: null };
        }

        // Verify the hovered word is a valid subcommand. Exact match:
        // subcommands are case-sensitive and stored canonical-lowercase.
        const subcommands = this.command_db.get_subcommands(potential_prefix);
        if (!subcommands) {
            return { is_subcommand: false, prefix_command: null };
        }

        const is_valid_subcommand = subcommands.some(
            sub => sub.name === hovered_word
        );

        if (!is_valid_subcommand) {
            return { is_subcommand: false, prefix_command: null };
        }

        return { is_subcommand: true, prefix_command: potential_prefix };
    }

    /**
     * Get hover information for subcommands using command database.
     */
    private get_subcommand_hover(
        document: DocumentState,
        position: Position,
        word: string,
        cancellation_token?: CancellationToken
    ): MarkupContent | null {
        const context = this.get_subcommand_context(document, position, word, cancellation_token);
        if (!context.is_subcommand || !context.prefix_command) {
            return null;
        }

        // The context gate already validated prefix and subcommand with
        // exact case, so both are canonical-lowercase here — compare
        // exactly like the validation sites.
        const prefix = context.prefix_command;

        // Get subcommand from command database
        const subcommands = this.command_db.get_subcommands(prefix);
        if (subcommands) {
            const sub = subcommands.find(s => s.name === word);
            if (sub) {
                // Capitalize prefix name for display
                const prefix_display = prefix.charAt(0).toUpperCase() + prefix.slice(1);
                return {
                    kind: MarkupKind.Markdown,
                    value: `**${prefix_display} Subcommand:** \`${sub.name}\`\n\nSubcommand of \`${prefix}\`.\n\nSee Stata documentation: ${format_help_link(`${prefix} ${sub.name}`)}`
                };
            }
        }

        return null;
    }

    /**
     * Get the word at the given position.
     */
    private get_word_at_position(
        document: DocumentState,
        position: Position
    ): { word: string; range: { start: Position; end: Position } } | null {
        const line = get_line_text(document, position.line);
        if (line === '') return null;
        const character = position.character;

        // Find the start of the word
        let start = character;
        while (start > 0 && /[a-zA-Z0-9_]/.test(line[start - 1])) {
            start--;
        }

        // Find the end of the word
        let end = character;
        while (end < line.length && /[a-zA-Z0-9_]/.test(line[end])) {
            end++;
        }

        if (start === end) return null;

        const word = line.substring(start, end);
        return {
            word,
            range: {
                start: { line: position.line, character: start },
                end: { line: position.line, character: end },
            },
        };
    }

    /**
     * Get hover info for a macro.
     */
    private get_macro_hover(
        document: DocumentState,
        position: Position,
        word: string,
        workspace_symbols?: SymbolTable,
        resolved_scope?: ResolvedScope,
        workspace_root?: string
    ): MarkupContent | null {
        // Check resolved scope first if available
        if (resolved_scope) {
            const local_macro = resolved_scope.symbols.localMacros.get(word);
            if (local_macro) {
                const source_link = this.format_source_link(local_macro.sourceUri, document.uri, workspace_root);
                const line_info = this.macro_definition_line_info(local_macro);
                const source_info = source_link
                    ? `\n\nSource: ${source_link}${line_info}`
                    : `\n\nDefined at: this file${line_info}`;
                return {
                    kind: MarkupKind.Markdown,
                    value: `**Local Macro:** \`${word}\`${source_info}${local_macro.value ? `\n\nExpansion: \`\`\`\n${local_macro.value}\n\`\`\`` : ''}`,
                };
            }

            const global_macro = resolved_scope.symbols.globalMacros.get(word);
            if (global_macro) {
                const source_link = this.format_source_link(global_macro.sourceUri, document.uri, workspace_root);
                const line_info = this.macro_definition_line_info(global_macro);
                const source_info = source_link
                    ? `\n\nSource: ${source_link}${line_info}`
                    : `\n\nDefined at: this file${line_info}`;
                return {
                    kind: MarkupKind.Markdown,
                    value: `**Global Macro:** \`${word}\`${source_info}${global_macro.value ? `\n\nExpansion: \`\`\`\n${global_macro.value}\n\`\`\`` : ''}`,
                };
            }
        }

        // Fallback to original logic
        // Check local macros
        const local_macro = document.symbols.localMacros.get(word);
        if (local_macro) {
            const source_link = this.format_source_link(local_macro.sourceUri, document.uri, workspace_root);
            const line_info = this.macro_definition_line_info(local_macro);
            const source_info = source_link
                ? `\n\nSource: ${source_link}${line_info}`
                : `\n\nDefined at: this file${line_info}`;
            return {
                kind: MarkupKind.Markdown,
                value: `**Local Macro:** \`${word}\`${source_info}${local_macro.value ? `\n\nExpansion: \`\`\`\n${local_macro.value}\n\`\`\`` : ''}`,
            };
        }

        // Check global macros
        const global_macro = document.symbols.globalMacros.get(word) || workspace_symbols?.globalMacros.get(word);
        if (global_macro) {
            const source_link = this.format_source_link(global_macro.sourceUri, document.uri, workspace_root);
            const line_info = this.macro_definition_line_info(global_macro);
            const source_info = source_link
                ? `\n\nSource: ${source_link}${line_info}`
                : `\n\nDefined at: this file${line_info}`;
            return {
                kind: MarkupKind.Markdown,
                value: `**Global Macro:** \`${word}\`${source_info}${global_macro.value ? `\n\nExpansion: \`\`\`\n${global_macro.value}\n\`\`\`` : ''}`,
            };
        }

        return null;
    }

    /**
     * Get hover info for a program.
     * Checks resolved scope, forward call symbols (with position filtering), and document/workspace symbols.
     *
     * @param document - The document state
     * @param word - The program name to look up
     * @param workspace_symbols - Optional workspace-level symbols
     * @param resolved_scope - Optional resolved scope from cross-file resolution
     * @param workspace_root - Optional workspace root for relative path display
     * @param position - Optional cursor position for forward call symbol filtering
     */
    private get_program_hover(
        document: DocumentState,
        word: string,
        workspace_symbols?: SymbolTable,
        resolved_scope?: ResolvedScope,
        workspace_root?: string,
        position?: Position,
        workspace_indexer?: WorkspaceIndexer,
    ): MarkupContent | null {
        // Check resolved scope first if available
        const program_symbols = this.safe_visible_symbols(resolved_scope, position);
        if (program_symbols) {
            const program = program_symbols.programs.get(word);
            if (program) {
                return this.get_hover_for_user_program(
                    program.name,
                    program_symbols,
                    document.uri,
                    workspace_root,
                    workspace_indexer,
                );
            }
        }

        // Fallback to original logic
        // Check document programs
        const program = document.symbols.programs.get(word);
        if (program) {
            return this.get_hover_for_user_program(program.name, document.symbols, document.uri, workspace_root, workspace_indexer);
        }

        // Check workspace programs
        if (workspace_symbols) {
            const ws_program = workspace_symbols.programs.get(word);
            if (ws_program) {
                return this.get_hover_for_user_program(ws_program.name, workspace_symbols, document.uri, workspace_root, workspace_indexer);
            }
        }

        return null;
    }

    /**
     * Get hover info for scalars and matrices.
     */
    private get_scalar_matrix_hover(
        document: DocumentState,
        word: string,
        workspace_symbols?: SymbolTable,
        resolved_scope?: ResolvedScope,
        workspace_root?: string
    ): MarkupContent | null {
        const symbols: SymbolTable | undefined = resolved_scope ? resolved_scope.symbols : (workspace_symbols || document.symbols);
        const scalars: Map<string, ScalarSymbol> = symbols?.scalars instanceof Map ? symbols.scalars : new Map();
        const matrices: Map<string, MatrixSymbol> = symbols?.matrices instanceof Map ? symbols.matrices : new Map();

        const scalar = scalars.get(word);
        if (scalar) {
            const source_link = this.format_source_link(scalar.sourceUri, document.uri, workspace_root);
            const line_info = scalar.definition_line !== undefined ? `, line ${scalar.definition_line + 1}` : '';
            const source_info = source_link
                ? `\n\nSource: ${source_link}${line_info}`
                : `\n\nDefined at: this file${line_info}`;
            return {
                kind: MarkupKind.Markdown,
                value: `**Scalar:** \`${word}\`${source_info}`,
            };
        }

        const matrix = matrices.get(word);
        if (matrix) {
            const source_link = this.format_source_link(matrix.sourceUri, document.uri, workspace_root);
            const line_info = matrix.definition_line !== undefined ? `, line ${matrix.definition_line + 1}` : '';
            const source_info = source_link
                ? `\n\nSource: ${source_link}${line_info}`
                : `\n\nDefined at: this file${line_info}`;
            return {
                kind: MarkupKind.Markdown,
                value: `**Matrix:** \`${word}\`${source_info}`,
            };
        }

        return null;
    }

    /**
     * Get hover info for a variable with cross-file resolution support.
     * Lookup precedence: resolved_scope → forward_call_symbols → document.symbols → workspace_symbols
     *
     * @param document - The document state
     * @param word - The variable name to look up
     * @param workspace_symbols - Optional workspace-level symbols for cross-file resolution
     * @param resolved_scope - Optional resolved scope from cross-file directive resolution
     * @param workspace_root - Optional workspace root for relative path display
     * @param position - Optional cursor position for forward call symbol filtering
     * @returns MarkupContent with variable info or null if not found
     */
    private get_variable_hover(
        document: DocumentState,
        word: string,
        workspace_symbols?: SymbolTable,
        resolved_scope?: ResolvedScope,
        workspace_root?: string,
        position?: Position
    ): MarkupContent | null {
        // 1. Check resolved_scope first (highest precedence)
        const variable_symbols = this.safe_visible_symbols(resolved_scope, position);
        if (variable_symbols) {
            const variable = variable_symbols.variables.get(word);
            if (variable) {
                return this.format_variable_hover(variable, document.uri, workspace_root);
            }
        }

        // 2. Check document.symbols (current file)
        const doc_variable = document.symbols.variables.get(word);
        if (doc_variable) {
            return this.format_variable_hover(doc_variable, document.uri, workspace_root);
        }

        // 3. Check workspace_symbols (lowest precedence)
        if (workspace_symbols) {
            const ws_variable = workspace_symbols.variables.get(word);
            if (ws_variable) {
                return this.format_variable_hover(ws_variable, document.uri, workspace_root);
            }
        }

        return null;
    }

    /**
     * Format variable hover content with source link.
     * Uses the same source link formatting as other symbols for consistency.
     *
     * @param variable - The variable symbol to format
     * @param current_uri - The current document URI for same-file detection
     * @param workspace_root - Optional workspace root for relative path display
     * @returns MarkupContent with formatted variable info
     */
    private format_variable_hover(
        variable: {
            name: string;
            sourceUri?: string;
            type?: string;
            label?: string;
            value_label_name?: string;
            value_labels?: Map<number | string, string>;
            source: string;
            location?: { uri: string; range: { start: { line: number } } };
        },
        current_uri: string,
        workspace_root?: string
    ): MarkupContent {
        // Handle case where sourceUri is undefined (backward compatibility)
        const source_link = variable.sourceUri
            ? this.format_source_link(variable.sourceUri, current_uri, workspace_root)
            : '';

        // Get line info from location if available
        const line_info = variable.location?.range?.start?.line !== undefined
            ? `, line ${variable.location.range.start.line + 1}`
            : '';

        // Format source info: use link for cross-file, "this file" for same file, omit if no sourceUri
        let source_info = '';
        if (variable.sourceUri) {
            source_info = source_link
                ? `\n\nSource: ${source_link}${line_info}`
                : `\n\nDefined at: this file${line_info}`;
        }

        const the_details: string[] = [];

        if (variable.type) {
            the_details.push(
                `Type: ${this.escape_markdown_text(variable.type)}`
            );
        }
        if (variable.label) {
            the_details.push(
                `Label: ${this.escape_markdown_text(variable.label)}`
            );
        }
        if (variable.value_label_name) {
            the_details.push(
                `Value Label: \`${this.escape_markdown_text(variable.value_label_name)}\``
            );
        }

        const value_label_info = this.format_value_label_mappings(
            variable.value_labels
        );
        if (value_label_info) {
            the_details.push(value_label_info);
        }

        const details_text = the_details.length > 0
            ? `\n\n${the_details.join('\n\n')}`
            : '';

        return {
            kind: MarkupKind.Markdown,
            value: `**Variable:** \`${variable.name}\`${details_text}${source_info}`,
        };
    }

    private format_value_label_mappings(
        value_labels?: Map<number | string, string>
    ): string {
        if (!value_labels || value_labels.size === 0) {
            return '';
        }

        const MAX_VALUE_LABEL_ENTRIES = 12;
        const the_entries = Array.from(value_labels.entries()).sort(
            ([value_a], [value_b]) =>
                String(value_a).localeCompare(
                    String(value_b),
                    undefined,
                    { numeric: true }
                )
        );
        const the_visible_entries = the_entries.slice(
            0,
            MAX_VALUE_LABEL_ENTRIES
        );
        const the_lines = the_visible_entries.map(
            ([my_value, my_label]) =>
                `- \`${this.escape_markdown_text(String(my_value))}\` => ${this.escape_markdown_text(my_label)}`
        );

        if (the_entries.length > MAX_VALUE_LABEL_ENTRIES) {
            the_lines.push(
                `- ... and ${the_entries.length - MAX_VALUE_LABEL_ENTRIES} more`
            );
        }

        return `Value Mappings:\n${the_lines.join('\n')}`;
    }

    /**
     * Get hover info for a built-in command.
     */
    private get_command_hover(word: string): MarkupContent | null {
        const command = this.command_db.lookup(word);
        if (command) {
            const is_abbrev =
                word.toLowerCase() !== command.name.toLowerCase();
            return this.format_builtin_command_hover(
                command,
                is_abbrev ? word : undefined
            );
        }

        // Try broadening the search to abbreviations
        const matches = this.command_db.expand_abbreviation(word);
        if (matches.length === 1) {
            const cmd = matches[0];
            return this.format_builtin_command_hover(cmd, word);
        }

        return null;
    }

    private get_expression_function_hover(
        document: DocumentState,
        range: { start: Position; end: Position },
        word: string
    ): MarkupContent | null {
        if (!this.is_followed_by_open_paren(document, range.end)) {
            return null;
        }

        const function_name = this.resolve_expression_function_name(word);
        if (!function_name) {
            return null;
        }

        return this.format_expression_function_hover(
            function_name,
            function_name === word ? undefined : word
        );
    }

    private is_followed_by_open_paren(
        document: DocumentState,
        position: Position
    ): boolean {
        const line = get_line_text(document, position.line);
        let i = position.character;
        while (i < line.length && /\s/.test(line[i])) {
            i++;
        }
        return line[i] === '(';
    }

    resolve_expression_function_name(word: string): string | null {
        // Source of truth: functions discovered from f_*.sthlp in the
        // command database (populated from the cache).
        if (this.command_db.is_function(word)) {
            return word;
        }
        // Fallback only when no functions are loaded (tests / missing cache).
        if (this.command_db.get_all_functions().length === 0
            && STATA_EXPRESSION_FUNCTIONS_FALLBACK.has(word)) {
            return word;
        }
        return STATA_EXPRESSION_FUNCTION_ALIASES.get(word) ?? null;
    }

    private format_expression_function_hover(
        function_name: string,
        abbreviated_as?: string
    ): MarkupContent {
        let hover_text = `**Function:** **${function_name}**()`;
        if (abbreviated_as && abbreviated_as !== function_name) {
            hover_text += ` (abbreviated as \`${abbreviated_as}\`)`;
        }

        // The caller has already classified this token as a function,
        // so always link to the `f_<name>` help topic. The server-side
        // resolver falls back to the bare name when no `f_*.sthlp`
        // exists, so this stays correct even with partial caches.
        const my_help_topic = `f_${function_name}`;
        hover_text += `\n\nSee Stata documentation: ${format_help_link(my_help_topic, `${function_name}()`)}`;

        return {
            kind: MarkupKind.Markdown,
            value: hover_text,
        };
    }

    private get_system_variable_hover(word: string): MarkupContent | null {
        const description = STATA_SYSTEM_VARIABLES.get(word);
        if (!description) return null;
        return {
            kind: MarkupKind.Markdown,
            value: `**System variable:** **${word}** — ${description}\n\nSee Stata documentation: ${format_help_link('_variables')}`,
        };
    }

    private format_builtin_command_hover(
        command: CommandInfo,
        abbreviated_as?: string
    ): MarkupContent {
        let hover_text = `**${command.name}**`;
        if (abbreviated_as && abbreviated_as !== command.name) {
            hover_text += ` (abbreviated as \`${abbreviated_as}\`)`;
        }

        if (command.options && command.options.length > 0) {
            const option_names = command.options.map(opt => opt.name).join(', ');
            hover_text += `\n\n**Options:** ${option_names}`;
        }

        hover_text += `\n\nSee Stata documentation: ${format_help_link(command.name)}`;

        return {
            kind: MarkupKind.Markdown,
            value: hover_text,
        };
    }

    /**
     * Get hover info for block delimiter commands (mata, python, end, end python).
     * Provides information about embedded language block syntax.
     */
    private get_block_delimiter_hover(
        word: string,
        context: LanguageContext,
        document?: DocumentState,
        position?: Position
    ): MarkupContent | null {
        const my_lower_word = word.toLowerCase();

        // Mata block delimiters
        if (my_lower_word === 'mata') {
            return {
                kind: MarkupKind.Markdown,
                value: `**Mata Block Start**\n\nStarts a Mata (matrix programming language) block.\n\n**Syntax:**\n- \`mata\` - Start multi-line Mata block (must end with \`end\`)\n- \`mata:\` - Single-line Mata statement\n\n**Example:**\n\`\`\`stata\nmata\n  // Mata code here\nend\n\`\`\``,
            };
        }

        // Python block delimiters
        if (my_lower_word === 'python') {
            return {
                kind: MarkupKind.Markdown,
                value: `**Python Block Start**\n\nStarts a Python block.\n\n**Syntax:**\n- \`python\` - Start multi-line Python block (must end with \`end\`)\n- \`python:\` - Single-line Python statement\n\n**Example:**\n\`\`\`stata\npython\n  # Python code here\nend\n\`\`\``,
            };
        }

        // End command - check if it closes a Mata or Python block
        if (my_lower_word === 'end') {
            // If we're in Mata context, it closes a Mata block
            if (context === LanguageContext.MATA) {
                return {
                    kind: MarkupKind.Markdown,
                    value: `**End Mata Block**\n\nCloses a Mata block started with \`mata\`.\n\n**Syntax:** \`end\`\n\nMust be used to close multi-line Mata blocks. Single-line \`mata:\` statements do not require \`end\`.`,
                };
            }

            // If we're in Python context, it closes a Python block
            if (context === LanguageContext.PYTHON) {
                return {
                    kind: MarkupKind.Markdown,
                    value: `**End Python Block**\n\nCloses a Python block started with \`python\`.\n\n**Syntax:** \`end\`\n\nMust be used to close multi-line Python blocks. Single-line \`python:\` statements do not require \`end\`.`,
                };
            }

            // If we're in Stata context but have a context tracker, check if this 'end' closes a block
            if (context === LanguageContext.STATA && this.context_tracker && document && position) {
                const my_context_tracker = this.context_tracker;
                const the_context_ranges = my_context_tracker.get_all_context_ranges();

                // Check if this position is on an end delimiter
                for (const my_range of the_context_ranges) {
                    if (my_range.end_delimiter) {
                        const my_end_range = my_range.end_delimiter.range;
                        if (position.line === my_end_range.start.line) {
                            // This is an end delimiter
                            if (my_range.context === LanguageContext.MATA) {
                                return {
                                    kind: MarkupKind.Markdown,
                                    value: `**End Mata Block**\n\nCloses a Mata block started with \`mata\`.\n\n**Syntax:** \`end\`\n\nMust be used to close multi-line Mata blocks. Single-line \`mata:\` statements do not require \`end\`.`,
                                };
                            } else if (my_range.context === LanguageContext.PYTHON) {
                                return {
                                    kind: MarkupKind.Markdown,
                                    value: `**End Python Block**\n\nCloses a Python block started with \`python\`.\n\n**Syntax:** \`end\`\n\nMust be used to close multi-line Python blocks. Single-line \`python:\` statements do not require \`end\`.`,
                                };
                            }
                        }
                    }
                }
            }
        }

        return null;
    }

    /**
     * Get hover info for a user-defined program with signature.
     * Formats the signature in Stata help-style.
     */
    private get_hover_for_user_program(
        program_name: string,
        workspace_symbols?: SymbolTable,
        current_uri?: string,
        workspace_root?: string,
        workspace_indexer?: WorkspaceIndexer,
    ): MarkupContent | null {
        // Check document programs first
        const program = workspace_symbols?.programs.get(program_name);
        if (!program) {
            return null;
        }

        const source_link = this.format_source_link(program.sourceUri, current_uri || '', workspace_root);
        const the_combined_extras = this.collect_workspace_additional_definitions(
            program_name, 'program', program, workspace_indexer, current_uri || program.sourceUri,
        );
        const footer = this.format_redefinition_footer(
            program.location?.uri ?? program.sourceUri,
            the_combined_extras,
        );

        // If program has a signature, format it
        if (program.signature) {
            const formatted_signature = this.format_signature_for_hover(program.signature);
            const source_info = source_link ? `**Source:** ${source_link}` : `**Defined at:** \`${program.sourceUri}\``;
            return {
                kind: MarkupKind.Markdown,
                value: `**Program:** \`${program.name}\`\n\n${formatted_signature}\n\n${source_info}${footer}`,
            };
        }

        // Fallback to basic program info if no signature
        const source_info = source_link ? `**Source:** ${source_link}` : `**Defined at:** \`${program.sourceUri}\``;
        return {
            kind: MarkupKind.Markdown,
            value: `**Program:** \`${program.name}\`\n\n${source_info}${footer}`,
        };
    }

    /**
     * Get hover info for an option in a user program call.
     * Shows type, default, and required status.
     */
    private get_hover_for_option(
        program_name: string,
        option_name: string,
        workspace_symbols?: SymbolTable
    ): MarkupContent | null {
        if (!workspace_symbols) {
            return null;
        }

        const program = workspace_symbols.programs.get(program_name);
        if (!program || !program.signature) {
            return null;
        }

        // Find the option in the signature (option name matching can be case-insensitive)
        const my_option = program.signature.options.find(
            opt => opt.name.toLowerCase() === option_name.toLowerCase()
        );

        if (!my_option) {
            return null;
        }

        return this.format_option_for_hover(my_option);
    }

    /**
     * Format a program signature in Stata help-style.
     * Shows arguments in order and options with types and defaults.
     */
    private format_signature_for_hover(signature: ProgramSignature): string {
        let result = '**Syntax:**\n\n```stata\n';

        // Add arguments
        for (const arg of signature.arguments) {
            const arg_text = this.format_argument_for_hover(arg);
            result += arg_text + ' ';
        }

        // Add options section if present
        if (signature.options.length > 0) {
            result += '[, ';
            const option_texts = signature.options.map(opt => this.format_option_name_for_hover(opt));
            result += option_texts.join(' ');
            result += ']';
        }

        // Add arbitrary options marker if present
        if (signature.allowsArbitraryOptions) {
            result += ' *';
        }

        result += '\n```\n\n';

        // Add options details if present
        if (signature.options.length > 0) {
            result += '**Options:**\n\n';
            for (const opt of signature.options) {
                result += this.format_option_details_for_hover(opt);
            }
        }

        return result;
    }

    /**
     * Format an argument for hover display.
     */
    private format_argument_for_hover(arg: ArgumentSpec): string {
        const type_display = this.get_argument_type_display(arg.type);
        if (arg.isOptional) {
            return `[${type_display}]`;
        }
        return type_display;
    }

    /**
     * Get display text for an argument type.
     */
    private get_argument_type_display(type: string): string {
        const type_map: Record<string, string> = {
            'varlist': 'varlist',
            'varname': 'varname',
            'newvarname': 'newvarname',
            'anything': 'anything',
            'if': '[if exp]',
            'in': '[in range]',
            'using': 'using filename',
            'exp': '= exp',
            'name': 'name',
        };
        return type_map[type] || type;
    }

    /**
     * Format an option name for hover display.
     */
    private format_option_name_for_hover(opt: OptionSpec): string {
        let result = opt.name;

        if (opt.argumentType) {
            result += `(${opt.argumentType}`;
            if (opt.defaultValue) {
                result += ` default(${opt.defaultValue})`;
            }
            result += ')';
        }

        if (opt.isRequired) {
            result = '*' + result;
        }

        return result;
    }

    /**
     * Format option details for hover display.
     */
    private format_option_details_for_hover(opt: OptionSpec): string {
        let result = `- **${opt.name}**`;

        if (opt.isRequired) {
            result += ' (required)';
        } else if (opt.isOptional) {
            result += ' (optional)';
        }

        if (opt.argumentType) {
            result += ` - Argument type: \`${opt.argumentType}\``;
        }

        if (opt.defaultValue) {
            result += ` - Default: \`${opt.defaultValue}\``;
        }

        result += '\n';

        return result;
    }

    /**
     * Format an option for hover display.
     */
    private format_option_for_hover(opt: OptionSpec): MarkupContent {
        let result = `**Option:** \`${opt.name}\`\n\n`;

        if (opt.isRequired) {
            result += '**Status:** Required\n\n';
        } else if (opt.isOptional) {
            result += '**Status:** Optional\n\n';
        }

        if (opt.argumentType) {
            result += `**Argument Type:** \`${opt.argumentType}\`\n\n`;
        }

        if (opt.defaultValue) {
            result += `**Default Value:** \`${opt.defaultValue}\`\n\n`;
        }

        result += `**Minimum Abbreviation:** \`${opt.minAbbreviation}\``;

        return {
            kind: MarkupKind.Markdown,
            value: result,
        };
    }

    /**
     * Check if a string looks like a URI (has a scheme).
     * Excludes single-letter schemes to avoid matching Windows drive paths (C:\...).
     */
    private looks_like_uri_scheme(str: string): boolean {
        return /^[a-zA-Z][a-zA-Z0-9+.-]+:/.test(str);
    }

    /**
     * Normalize a file URI or filesystem path to an absolute filesystem path.
     * Returns null for non-file URIs.
     */
    private normalize_file_path(uri_or_path: string): string | null {
        if (uri_or_path.startsWith('file://')) {
            return URI.parse(uri_or_path).fsPath;
        }
        if (this.looks_like_uri_scheme(uri_or_path)) {
            return null;
        }
        return path.resolve(uri_or_path);
    }

    /**
     * Escape markdown special characters in link display text.
     */
    private escape_markdown_link_text(text: string): string {
        return text.replace(/[\\[\]()]/g, '\\$&');
    }

    private escape_markdown_text(text: string): string {
        return text
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(MARKDOWN_TEXT_ESCAPE_PATTERN, '\\$1');
    }

    /**
     * Convert file:// URI to filesystem path and calculate relative path when file is within workspace root.
     * Returns full path when file is outside workspace, or the original URI for non-file URIs.
     */
    private get_display_path(uri: string, workspace_root?: string): string {
        const fs_path = this.normalize_file_path(uri);

        if (fs_path === null) {
            return uri;
        }

        if (!workspace_root) {
            return fs_path;
        }

        const workspace_fs_path = this.normalize_file_path(workspace_root);
        if (workspace_fs_path === null) {
            return fs_path;
        }

        const relative = path.relative(workspace_fs_path, fs_path);

        // If relative path starts with '..' or is absolute, file is outside workspace
        if (relative.startsWith('..') || path.isAbsolute(relative)) {
            return fs_path;
        }

        return relative;
    }

    /**
     * Format source link for cross-file symbols.
     * Returns empty string when sourceUri equals currentUri (same file).
     * Returns markdown link format [display_path](file_uri) for file URIs.
     * Returns plain text `<uri>` for non-file URIs.
     */
    private format_source_link(source_uri: string, current_uri: string, workspace_root?: string): string {
        const source_path = this.normalize_file_path(source_uri);
        const current_path = this.normalize_file_path(current_uri);

        // For non-file URIs, return plain text
        if (source_path === null) {
            return `\`${source_uri}\``;
        }

        // Same file check (only for file paths)
        if (current_path !== null && source_path === current_path) {
            return '';
        }

        const display_path = this.get_display_path(source_uri, workspace_root);
        const escaped_display = this.escape_markdown_link_text(display_path);
        const link_target = source_uri.startsWith('file://') ? source_uri : URI.file(source_path).toString();
        return `[${escaped_display}](${link_target})`;
    }
}
