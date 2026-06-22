/**
 * Completion Provider for Sight
 *
 * Provides context-aware completion suggestions for Stata code.
 * Supports command, option, macro, variable, and program completions.
 */

import {
    CompletionItem,
    CompletionItemKind,
    InsertTextFormat,
    MarkupKind,
    Position,
    CancellationToken,
    Range,
} from 'vscode-languageserver';
import { DocumentState } from '../document-store';
import { CommandDatabase } from '../command-database';
import {
    CommandInfo,
    SymbolTable,
    Token,
    StataNode,
    OptionSpec,
    ResolvedScope,
    CompletionRankingFactors,
    ArgumentSpec,
    ProgramSignature,
    ProgramNode,
    ProgramSymbol,
    ScopeResolverConfig,
    MacroSymbol,
    ScalarSymbol,
    MatrixSymbol,
    StataLSPConfig,
} from '../types';
import { IContextTracker, LanguageContext } from '../context-tracker/types';
import { CompletionPrefixCache } from '../utils/lru-cache';
import { SymbolIndexCache } from '../utils/symbol-index-cache';
import { ScopeResolver } from '../scope-resolver';
import { build_scope_resolver_config } from '../scope-resolver';
import {
    get_visible_forward_call_sites,
    get_visible_symbols_at,
    filter_forward_site_symbols,
} from '../scope-resolver';
import { create_empty_symbol_table, merge_symbol_tables } from '../analyzer';
import { isPathDirective, isFileCommand, hasStataExtension } from '../utils/file-path-utils';
import { logger } from '../utils/logger';
import * as fs from 'fs';
import * as path from 'path';

import {
    compute_macro_replacement_range,
    detect_macro_context,
    has_closing_delimiter,
    MacroCompletionContext
} from './completion/macro-completion';
import { get_line_text, get_line_count } from '../utils/line-utils';
import { format_help_link } from '../utils/help-link';

/**
 * Map ForwardCallSite.effective_type to directive_type for ranking.
 * 'include' -> 'included-by', else 'done-by'
 */
function map_effective_type_to_directive(effective_type: 'include' | 'do'): 'included-by' | 'done-by' {
    return effective_type === 'include' ? 'included-by' : 'done-by';
}

/**
 * Compute a ranking key for completion items based on multiple factors.
 * Lower values indicate higher priority.
 */
export function compute_ranking_key(factors: CompletionRankingFactors): string {
    // Priority order (lexicographic): scope_depth (0-9), directive_type (0-3), symbol_type (00-63), parent_uri, alphabetical.
    // NOTE: Avoid NUL (\0) padding in sortText. Some clients/editors can behave oddly with NULs.
    const scope_priority = Math.min(factors.scope_depth, 9);

    const directive_priority =
        factors.directive_type === 'current' ? 0 :
        factors.directive_type === 'included-by' ? 1 :
        factors.directive_type === 'done-by' ? 2 : 3;

    let symbol_priority: number;
    if (factors.symbol_type === 'user-program') {
        symbol_priority = 0;
    } else if (factors.symbol_type === 'local-macro') {
        symbol_priority = 10; // 1.0 - current-file locals rank highest
    } else if (factors.symbol_type === 'program-argument') {
        // Program arguments get special ranking between current-file locals and parent locals.
        // - In current context: after current-file locals (1.0) but before globals (2.0).
        // - In non-current contexts (only used in tests / defensive fallback): rank ahead of
        //   parent locals so they still appear before inherited locals.
        symbol_priority = factors.directive_type === 'current' ? 15 : 5;
    } else if (factors.symbol_type === 'global-macro') {
        symbol_priority = 20; // 2.0
    } else if (factors.symbol_type === 'variable') {
        symbol_priority = 30; // 3.0
    } else if (factors.symbol_type === 'scalar') {
        symbol_priority = 40; // 4.0
    } else if (factors.symbol_type === 'matrix') {
        symbol_priority = 50; // 5.0
    } else {
        // Built-in commands: use priority tier for sub-ordering
        // Tier 1 = 61, Tier 2 = 62, Tier 3 = 63
        const command_tier = factors.command_priority || 3;
        symbol_priority = 60 + command_tier;
    }

    const symbol_priority_padded = symbol_priority.toString().padStart(2, '0');

    // Tie-breakers (avoid padding):
    // - parent_uri differentiates same-named symbols from different parents
    // - alphabetical_order provides stable ordering
    const parent_uri = (factors.parent_uri || '').toLowerCase();
    const name = factors.alphabetical_order.toLowerCase();

    // Use separators to avoid accidental concatenation ambiguity.
    return `${scope_priority}${directive_priority}${symbol_priority_padded}|${parent_uri}|${name}`;
}

/**
 * Completion context types
 */
export type CompletionContext =
    | { type: 'command' }
    | { type: 'option'; command: string }
    | MacroCompletionContext
    | { type: 'variable' }
    | { type: 'program' }
    | { type: 'directive_path'; directive: string; partial_path?: string }
    | { type: 'command_path'; command: string; partial_path?: string }
    | { type: 'subcommand'; prefix_command: string }
    | { type: 'fallback' };

/**
 * Client capabilities for completion
 */
export interface CompletionClientCapabilities {
    snippet_support: boolean;
}

/**
 * Detect the completion context at a given position in the document.
 *
 * @param document - The document state
 * @param position - The cursor position
 * @param tokens - Optional token stream for more accurate detection
 * @param command_db - Optional command database for subcommand detection
 * @returns The detected completion context
 */
export function detect_completion_context(
    document: DocumentState,
    position: Position,
    tokens?: Token[],
    command_db?: CommandDatabase
): CompletionContext {
    // Bounds check using line count
    if (position.line >= get_line_count(document)) {
        return { type: 'fallback' };
    }

    const current_line = get_line_text(document, position.line);
    const text_before_cursor = current_line.substring(0, position.character);

    // Check for extended macro function context (`: list`, `: word`, etc.)
    const extended_macro_context = detect_extended_macro_context(text_before_cursor, position);
    if (extended_macro_context) {
        return extended_macro_context;
    }

    // Check for directive path context (e.g., @lsp-done-by:)
    const directive_context = detect_directive_context(text_before_cursor);
    if (directive_context) {
        return directive_context;
    }

    // Check for command path context (e.g., do file.do)
    const command_path_context = detect_command_path_context(text_before_cursor);
    if (command_path_context) {
        return command_path_context;
    }

    // Check for macro context first (highest priority)
    const macro_context = detect_macro_context(text_before_cursor, document, position);
    if (macro_context) {
        return macro_context;
    }

    // Check for option context (after comma)
    const option_context = detect_option_context(text_before_cursor, document, position);
    if (option_context) {
        return option_context;
    }

    // Check for subcommand context (after prefix command like 'frame ')
    const subcommand_context = detect_subcommand_context(text_before_cursor, command_db);
    if (subcommand_context) {
        return subcommand_context;
    }

    // Check for command context (start of statement)
    if (is_command_context(text_before_cursor)) {
        return { type: 'command' };
    }

    // Check for variable context (after command name)
    if (is_variable_context(text_before_cursor)) {
        return { type: 'variable' };
    }

    // Default to fallback
    return { type: 'fallback' };
}

/**
 * Detect if we're inside an extended macro function context.
 *
 * Extended macro functions use the colon syntax:
 *   local result : list macA | macB
 *   local result : word count `macname'
 *   local result : subinstr local(str) "old" "new", count(local)
 *   local result : length local(str)
 *   local result : piece 1 2 of `macname'
 *   local result : type varname
 *   local result : format varname
 *   local result : variable label varname
 *   local result : value label varname
 *   local result : data label
 *   local result : display %9.2f 3.14159
 *   local result : permname stub
 *   local result : tempvar
 *   local result : tempfile
 */
function detect_extended_macro_context(text_before_cursor: string, position: Position): CompletionContext | null {
    // Pattern: local/global macname : function_name ...
    const extended_macro_pattern = /^\s*(local|global)\s+\w+\s*:\s*(\w+)\s*/i;
    const match = text_before_cursor.match(extended_macro_pattern);

    if (match) {
        const function_name = match[2].toLowerCase();
        const after_function = text_before_cursor.substring(match[0].length);

        // List functions - suggest macros after operators and at start
        if (function_name === 'list') {
            // Check if cursor is after 'local name: list' or after operators
            if (after_function === '' ||
                /^[\w]*$/.test(after_function) ||
                /[\s&|\-]\s*$/.test(after_function) ||
                /[\s&|\-]\s*[\w]*$/.test(after_function)) {
                // Use a safe fallback position that ensures range computation starts from cursor
                return { 
                    type: 'macro', 
                    scope: 'local', 
                    form: 'local', 
                    delimiterStart: Position.create(position.line, -1), // Virtual delimiter at start of line
                    identifierRange: Range.create(position, position) 
                };
            }
        }

        // Word functions - suggest macros for string arguments
        if (function_name === 'word') {
            // word count `macname' or word # of `macname'
            if (/^(count|[0-9]+(\s+of)?)(\s+`[\w]*)?$/.test(after_function)) {
                return { 
                    type: 'macro', 
                    scope: 'local', 
                    form: 'local', 
                    delimiterStart: Position.create(position.line, -1),
                    identifierRange: Range.create(position, position) 
                };
            }
        }

        // String functions - suggest macros for string arguments
        if (['subinstr', 'length', 'piece'].includes(function_name)) {
            // For these functions, suggest macros when we see incomplete macro references
            if (/`[\w]*$/.test(after_function)) {
                return { 
                    type: 'macro', 
                    scope: 'local', 
                    form: 'local', 
                    delimiterStart: Position.create(position.line, -1),
                    identifierRange: Range.create(position, position) 
                };
            }
        }

        // Property functions - suggest variables
        if (['type', 'format', 'label'].includes(function_name)) {
            return { type: 'variable' };
        }

        // Variable/value label functions
        if (function_name === 'variable' || function_name === 'value') {
            // Check if we're after "variable label" or "value label"
            if (/^label\s*$/.test(after_function)) {
                return { type: 'variable' };
            }
        }

        // Other functions don't need completion suggestions
        if (['display', 'permname', 'tempvar', 'tempfile', 'data'].includes(function_name)) {
            return null;
        }
    }

    return null;
}

/**
 * Detect if we're in an option context (after comma in a command).
 */
function detect_option_context(
    text_before_cursor: string,
    _document: DocumentState,
    _position: Position
): CompletionContext | null {
    // Find the last comma that's not inside quotes or parentheses
    let paren_depth = 0;
    let bracket_depth = 0;
    let in_string = false;
    let last_comma_pos = -1;

    for (let i = 0; i < text_before_cursor.length; i++) {
        const char = text_before_cursor[i];
        const next_char = text_before_cursor[i + 1] || '';

        // Track string boundaries
        if (char === '"' && !in_string) {
            in_string = true;
            continue;
        }
        if (in_string && char === '"') {
            if (next_char === '"') {
                i++; // Skip escaped quote
                continue;
            }
            in_string = false;
            continue;
        }
        if (in_string) continue;

        // Track parentheses and brackets
        if (char === '(') paren_depth++;
        if (char === ')') paren_depth--;
        if (char === '[') bracket_depth++;
        if (char === ']') bracket_depth--;

        // Track commas at top level
        if (char === ',' && paren_depth === 0 && bracket_depth === 0) {
            last_comma_pos = i;
        }
    }

    // If we found a comma, we're in option context
    if (last_comma_pos >= 0) {
        // Try to find the command name from the text before the comma
        // This is more reliable than AST lookup because the AST may incorrectly
        // parse text after the comma as a new command (e.g., "rename *,l" parses
        // "l" as a separate command, but we want "rename")
        const text_before_comma = text_before_cursor.substring(0, last_comma_pos).trim();
        const command_name = extract_command_name(text_before_comma);
        
        // Prefer text-based extraction over AST lookup for option context
        // AST lookup can be wrong when the option prefix looks like a command
        return { type: 'option', command: command_name || '' };
    }

    return null;
}

/**
 * Extract the command name from text (simple heuristic).
 */
function extract_command_name(text: string): string | null {
    const PREFIX_COMMANDS = ['by', 'bysort', 'quietly', 'qui', 'capture', 'cap', 'noisily', 'noi'];
    
    // Handle "by varlist:" prefix - but not merge syntax like "merge 1:m"
    let working_text = text;
    if (text.includes(':')) {
        // Check if this looks like a "by varlist:" pattern
        const colon_pos = text.indexOf(':');
        const text_before_colon = text.substring(0, colon_pos).trim();
        const text_after_colon = text.substring(colon_pos + 1).trim();
        
        // If the text before colon starts with "by" or "bysort", then it's "by varlist:" syntax
        const words_before = text_before_colon.split(/\s+/);
        
        if (words_before.length >= 2 && 
            ['by', 'bysort'].includes(words_before[0].toLowerCase()) &&
            text_after_colon.length > 0) {
            working_text = text_after_colon;
        }
        // Otherwise, keep the original text (e.g., "merge 1:m" case)
    }
    
    const the_words = working_text.split(/\s+/).filter(w => w.length > 0);
    
    // Skip prefix commands to find the main command
    for (const my_word of the_words) {
        const lower_word = my_word.toLowerCase();
        if (!PREFIX_COMMANDS.includes(lower_word)) {
            return my_word;
        }
    }
    
    return null;
}

/**
 * Detect if we're in a directive path context (e.g., after @lsp-done-by:).
 */
function detect_directive_context(text_before_cursor: string): CompletionContext | null {
    // Check if we're inside a comment
    const comment_match = text_before_cursor.match(/^\s*(\/\/|\*)\s*(.*)$/);
    if (!comment_match) {
        return null;
    }
    
    const comment_content = comment_match[2];
    
    // Look for @lsp-* directive pattern
    const directive_pattern = /(@lsp-[a-zA-Z-]+)\s*:\s*(.*)$/;
    const directive_match = comment_content.match(directive_pattern);
    
    if (directive_match) {
        const directive = directive_match[1];
        const path_part = directive_match[2];
        
        // Check if this is a path directive
        if (isPathDirective(directive)) {
            return {
                type: 'directive_path',
                directive,
                partial_path: path_part.trim()
            };
        }
    }
    
    return null;
}

/**
 * Detect if we're in a command path context (e.g., after "do ").
 */
function detect_command_path_context(text_before_cursor: string): CompletionContext | null {
    // Don't detect command path context if there's a comma (that's option context)
    if (text_before_cursor.includes(',')) {
        return null;
    }
    
    // Look for file command followed by space
    const command_pattern = /^\s*(\w+)\s+(.*)$/;
    const command_match = text_before_cursor.match(command_pattern);
    
    if (command_match) {
        const command = command_match[1];
        const path_part = command_match[2];
        
        // Check if this is a file command
        if (isFileCommand(command)) {
            return {
                type: 'command_path',
                command,
                partial_path: path_part.trim()
            };
        }
    }
    
    return null;
}

/**
 * Detect if we're in a subcommand context (after a prefix command like 'frame ' or 'mi ').
 * Returns the prefix command name if we're at the subcommand position.
 * Uses the command database to determine which commands have subcommands.
 */
function detect_subcommand_context(text_before_cursor: string, command_db?: CommandDatabase): CompletionContext | null {
    // Don't detect subcommand context if there's a comma (that's option context)
    if (text_before_cursor.includes(',')) {
        return null;
    }
    
    const trimmed = text_before_cursor.trim();
    const the_words = trimmed.split(/\s+/).filter(w => w.length > 0);
    
    if (the_words.length === 0) {
        return null;
    }
    
    // Skip standard prefix commands (by, quietly, capture, etc.)
    const STANDARD_PREFIXES = ['by', 'bysort', 'quietly', 'qui', 'capture', 'cap', 'noisily', 'noi'];
    let command_index = 0;
    while (command_index < the_words.length && 
           STANDARD_PREFIXES.includes(the_words[command_index].toLowerCase())) {
        command_index++;
    }
    
    // Handle "by varlist:" pattern - skip to after colon
    if (trimmed.includes(':')) {
        const after_colon = trimmed.split(':').pop()?.trim() || '';
        const words_after_colon = after_colon.split(/\s+/).filter(w => w.length > 0);
        if (words_after_colon.length > 0) {
            const potential_prefix = words_after_colon[0].toLowerCase();
            // Check if this command has subcommands using the database
            if (command_db && command_db.has_subcommands(potential_prefix)) {
                const words_after_prefix = words_after_colon.length - 1;
                if (words_after_prefix === 0 && text_before_cursor.endsWith(' ')) {
                    return { type: 'subcommand', prefix_command: potential_prefix };
                }
                if (words_after_prefix === 1 && !text_before_cursor.endsWith(' ')) {
                    return { type: 'subcommand', prefix_command: potential_prefix };
                }
            }
        }
        return null;
    }
    
    if (command_index >= the_words.length) {
        return null;
    }
    
    const potential_prefix = the_words[command_index].toLowerCase();
    
    // Check if this command has subcommands using the database
    if (!command_db || !command_db.has_subcommands(potential_prefix)) {
        return null;
    }
    
    // We're in subcommand context if:
    // 1. We're right after the prefix command with a space (e.g., "frame ")
    // 2. We're typing the subcommand (e.g., "frame cr")
    const words_after_prefix = the_words.length - command_index - 1;
    
    if (words_after_prefix === 0 && text_before_cursor.endsWith(' ')) {
        // Right after "frame " - suggest subcommands
        return { type: 'subcommand', prefix_command: potential_prefix };
    }
    
    if (words_after_prefix === 1 && !text_before_cursor.endsWith(' ')) {
        // Typing the subcommand (e.g., "frame cr") - suggest subcommands
        return { type: 'subcommand', prefix_command: potential_prefix };
    }
    
    return null;
}

/**
 * Check if we're at the start of a statement (command context).
 */
function is_command_context(
    text_before_cursor: string
): boolean {
    const trimmed = text_before_cursor.trim();

    // Empty line or only whitespace = command context
    if (trimmed === '') {
        return true;
    }

    // Check if we're after a prefix command (by, bysort, quietly, capture, etc.)
    // Note: "by varlist:" is a prefix, so we need to handle the colon
    const PREFIX_COMMANDS = ['by', 'bysort', 'quietly', 'qui', 'capture', 'cap', 'noisily', 'noi'];
    
    // Split by whitespace but preserve structure
    const the_words = trimmed.split(/\s+/);
    
    // Check for "by varlist:" pattern - everything before colon is the by prefix
    if (trimmed.includes(':')) {
        const parts = trimmed.split(':');
        const before_colon = parts[0].trim();
        const after_colon = parts.slice(1).join(':').trim();
        
        // Check if before colon starts with a prefix command
        const first_word = before_colon.split(/\s+/)[0].toLowerCase();
        if (PREFIX_COMMANDS.includes(first_word)) {
            // We're after "by varlist:" - check what's after the colon
            if (after_colon === '' || !after_colon.includes(' ')) {
                // Empty or typing first word after colon = command context
                return true;
            }
        }
    }

    // If all words so far are prefix commands (without colon), we're still in command context
    let all_prefixes = true;
    for (const my_word of the_words) {
        const lower_word = my_word.toLowerCase().replace(/:$/, ''); // Remove trailing colon
        if (!PREFIX_COMMANDS.includes(lower_word)) {
            all_prefixes = false;
            break;
        }
    }

    if (all_prefixes) {
        return true;
    }

    // Check if we're typing the first word (command name)
    // This is true if there's only one word and no space after it
    if (the_words.length === 1 && !text_before_cursor.endsWith(' ')) {
        // Check if the word could be a prefix
        const lower_word = the_words[0].toLowerCase();
        for (const prefix of PREFIX_COMMANDS) {
            if (prefix.startsWith(lower_word)) {
                return true;
            }
        }
        // Still typing the command name
        return true;
    }

    return false;
}

/**
 * Check if we're in a variable context (after command name, before options).
 */
function is_variable_context(text_before_cursor: string): boolean {
    const trimmed = text_before_cursor.trim();
    const the_words = trimmed.split(/\s+/);

    // Need at least two words (prefix/command + something) or one word with space
    if (the_words.length >= 2 || (the_words.length === 1 && text_before_cursor.endsWith(' '))) {
        // Check if we haven't hit the comma (options section) yet
        if (!trimmed.includes(',')) {
            // We're in the varlist section
            return true;
        }
    }

    return false;
}

/**
 * Check if a position is within a range.
 */
function is_position_in_range(
    position: Position,
    range: { start: { line: number; character: number }; end: { line: number; character: number } }
): boolean {
    // Check if position is after start
    if (position.line < range.start.line) return false;
    if (position.line === range.start.line && position.character < range.start.character) return false;

    // Check if position is before end
    if (position.line > range.end.line) return false;
    if (position.line === range.end.line && position.character > range.end.character) return false;

    return true;
}


/**
 * Completion Provider class for generating context-aware completions.
 */
export class CompletionProvider {
    private command_db: CommandDatabase;
    private client_capabilities: CompletionClientCapabilities;
    private context_tracker?: IContextTracker;
    private prefix_cache: CompletionPrefixCache<CompletionItem>;
    private symbol_cache: SymbolIndexCache;
    private cache_size: number;
    private prefix_max_items: number;
    
    // Merged symbol cache to avoid repetitive merging on every completion request
    private merged_cache: Map<string, { symbols: SymbolTable; doc_version: number; workspace_version: number }> = new Map();

    constructor(
        command_db?: CommandDatabase,
        client_capabilities?: CompletionClientCapabilities,
        context_tracker?: IContextTracker,
        cache_size: number = 200,
        prefix_max_items: number = 200
    ) {
        this.command_db = command_db || new CommandDatabase();
        this.client_capabilities = client_capabilities || { snippet_support: false };
        this.context_tracker = context_tracker;
        this.cache_size = cache_size;
        this.prefix_max_items = prefix_max_items;
        this.prefix_cache = new CompletionPrefixCache<CompletionItem>(
            this.cache_size,
            this.prefix_max_items
        );
        this.symbol_cache = new SymbolIndexCache();
    }

    /**
     * Reconfigure cache sizing after project or editor settings change.
     */
    configure_completion(
        config: Partial<StataLSPConfig['completion']> | undefined
    ): void {
        const next_cache_size =
            typeof config?.cacheSize === 'number' && config.cacheSize > 0
                ? config.cacheSize
                : this.cache_size;
        const next_prefix_max_items =
            typeof config?.prefixMaxItems === 'number' &&
                config.prefixMaxItems > 0
                ? config.prefixMaxItems
                : this.prefix_max_items;

        if (
            next_cache_size === this.cache_size &&
            next_prefix_max_items === this.prefix_max_items
        ) {
            return;
        }

        this.cache_size = next_cache_size;
        this.prefix_max_items = next_prefix_max_items;
        this.prefix_cache = new CompletionPrefixCache<CompletionItem>(
            this.cache_size,
            this.prefix_max_items
        );
        this.merged_cache.clear();
        this.symbol_cache = new SymbolIndexCache();
    }

    /**
     * Set client capabilities (e.g., after initialization).
     */
    set_client_capabilities(capabilities: CompletionClientCapabilities): void {
        this.client_capabilities = capabilities;
    }

    /**
     * Set the context tracker for context-aware completions.
     */
    set_context_tracker(context_tracker: IContextTracker): void {
        this.context_tracker = context_tracker;
    }

    /**
     * Invalidate the prefix cache when command database changes.
     * Call this when built-in commands, ado paths, or workspace symbols change.
     */
    invalidate_prefix_cache(): void {
        const db_version = this.command_db.get_cache_version();
        this.prefix_cache.invalidate_on_db_change(db_version);
    }

    /**
     * Build the Global-Mode in-scope symbol bag: workspace symbols merged with
     * document symbols, then current-file-only overrides applied for all
     * non-variable categories (locals, globals, programs, scalars, matrices).
     * Workspace variables remain in the merged bag so they flow through the
     * workspace-wide variable completion path. Workspace non-variable symbols
     * from other files are surfaced separately via
     * `partition_symbols_for_completion` as out-of-scope entries.
     */
    private build_merged_map(
        workspace_symbols: SymbolTable,
        document_symbols: SymbolTable,
        document_uri: string,
        document_version: number
    ): SymbolTable {
        // Filter workspace symbols to exclude stale ones from current document
        const filtered_workspace = this.get_filtered_workspace_symbols(
            workspace_symbols,
            document_uri,
            document_version
        );

        // Merge with document symbols on top (fresh symbols win)
        const merged = merge_symbol_tables(filtered_workspace, document_symbols);

        // Global-Mode rule: local macros are only visible from the current file.
        // Strip workspace localMacros; keep the document's own localMacros.
        // Workspace globals, programs, scalars, and matrices are surfaced
        // through the out-of-scope partition (callers receive them via
        // `out_of_scope_symbols`), so they should not enter the in-scope bag
        // silently. Variables are intentionally left untouched so they remain
        // workspace-wide.
        return {
            ...merged,
            localMacros: new Map(document_symbols.localMacros),
            globalMacros: new Map(document_symbols.globalMacros),
            programs: new Map(document_symbols.programs),
            scalars: new Map(document_symbols.scalars),
            matrices: new Map(document_symbols.matrices),
        };
    }

    /**
     * Get merged symbols with caching.
     * Returns cached result if available and valid, otherwise builds and caches new result.
     */
    private get_merged_symbols(
        workspace_symbols: SymbolTable,
        document_symbols: SymbolTable,
        document_uri: string,
        document_version: number,
        workspace_version: number
    ): SymbolTable {
        const cache_key = document_uri;
        const cached = this.merged_cache.get(cache_key);
        
        // Check if cache is valid
        if (cached && 
            cached.doc_version === document_version && 
            cached.workspace_version === workspace_version) {
            return cached.symbols;
        }
        
        // Build new merged map
        const merged_symbols = this.build_merged_map(
            workspace_symbols,
            document_symbols,
            document_uri,
            document_version
        );
        
        // Cache the result
        this.merged_cache.set(cache_key, {
            symbols: merged_symbols,
            doc_version: document_version,
            workspace_version
        });
        
        return merged_symbols;
    }

    /**
     * Build an `out_of_scope` view of workspace symbols for completion.
     *
     * Includes workspace globals, programs, scalars, and matrices that are:
     *   - not already present (by name) in the `in_scope` bag for the same kind, and
     *   - not defined in the current document.
     *
     * `localMacros` and `variables` are always returned as empty maps:
     *   - Local macros are file-scoped and never show up as out-of-scope.
     *   - Variables stay workspace-wide via the existing in-scope path.
     */
    private partition_symbols_for_completion(
        document: DocumentState,
        workspace_symbols: SymbolTable | undefined,
        in_scope: SymbolTable,
        resolved_scope?: ResolvedScope,
    ): SymbolTable {
        const empty: SymbolTable = {
            programs: new Map(),
            localMacros: new Map(),
            globalMacros: new Map(),
            variables: new Map(),
            scalars: new Map(),
            matrices: new Map(),
        };
        if (!workspace_symbols) {
            return empty;
        }

        // Symbols already recorded in resolved_scope.out_of_scope_symbols
        // (e.g., call-site-filtered parent-file globals) should stay hidden —
        // they are already surfaced through resolved_scope's own out-of-scope
        // bucket and must not be promoted into the workspace out-of-scope view.
        const filtered_by_call_site = new Set<string>();
        if (resolved_scope) {
            for (const oos of resolved_scope.out_of_scope_symbols) {
                filtered_by_call_site.add(`${oos.type}:${oos.name}`);
            }
        }

        const keep_out_of_scope = <T extends { sourceUri: string }>(
            workspace_map: Map<string, T>,
            in_scope_map: Map<string, unknown>,
            kind: 'program' | 'global' | 'scalar' | 'matrix',
        ): Map<string, T> => {
            const out = new Map<string, T>();
            for (const [name, symbol] of workspace_map) {
                if (symbol.sourceUri === document.uri) continue;
                if (in_scope_map.has(name)) continue;
                if (filtered_by_call_site.has(`${kind}:${name}`)) continue;
                out.set(name, symbol);
            }
            return out;
        };

        return {
            programs: keep_out_of_scope(workspace_symbols.programs, in_scope.programs, 'program'),
            localMacros: new Map(),
            globalMacros: keep_out_of_scope(workspace_symbols.globalMacros, in_scope.globalMacros, 'global'),
            variables: new Map(),
            scalars: keep_out_of_scope(workspace_symbols.scalars, in_scope.scalars, 'scalar'),
            matrices: keep_out_of_scope(workspace_symbols.matrices, in_scope.matrices, 'matrix'),
        };
    }

    /**
     * Get filtered workspace symbols using cache.
     */
    private get_filtered_workspace_symbols(
        workspace_symbols: SymbolTable,
        document_uri: string,
        document_version: number
    ): SymbolTable {
        return this.symbol_cache.get_filtered_symbols(workspace_symbols, document_uri, document_version);
    }

    /**
     * Get completions for a document at a given position.
     *
     * @param document - The document state
     * @param position - The cursor position
     * @param trigger_character - Optional trigger character
     * @param scope_resolver - Optional scope resolver for cross-file awareness
     * @param workspace_symbols - Optional workspace-wide symbol table
     * @param cross_file_config - Optional cross-file config for scope resolution
     * @param workspace_version - Optional workspace version for cache validation
     * @param cancellation_token - Optional cancellation token
     * @returns Array of completion items
     */
    async get_completions(
        document: DocumentState,
        position: Position,
        trigger_character?: string,
        scope_resolver?: ScopeResolver,
        workspace_symbols?: SymbolTable,
        cross_file_config?: Partial<ScopeResolverConfig>,
        workspace_version?: number,
        cancellation_token?: CancellationToken,
        graph_version?: number
    ): Promise<CompletionItem[]> {
        const profile_enabled = process.env.SIGHT_COMPLETION_PROFILE === '1';
        const start_time_ms = profile_enabled ? Date.now() : 0;
        try {
            // Sync caches with combined workspace + graph version to ensure
            // invalidation when either workspace symbols or auto-parent edges change
            const combined_version = (workspace_version ?? 0) + (graph_version ?? 0);
            if (workspace_version !== undefined || graph_version !== undefined) {
                this.prefix_cache.invalidate_on_workspace_change(combined_version);
                this.symbol_cache.invalidate_workspace(combined_version);
            }

            // === SYNC PHASE: Fast early returns and context detection ===
            // Defensive early return for newline trigger character
            if (trigger_character === '\n') {
                return [];
            }

            // Brace trigger suppression: only provide completions if we're in a macro context
            // When `{` is the trigger, it should only trigger completions for global macro
            // braced form (e.g., `${name}`). If the character before `{` is not `$`, return empty.
            if (trigger_character === '{') {
                // Use line_offsets for O(1) position lookup if available
                const line_start = document.line_offsets?.[position.line] ?? 0;
                // position.character is AFTER the trigger character was typed
                // So character - 2 gives us the character before the `{`
                const char_before_brace_index = line_start + position.character - 2;
                if (char_before_brace_index < 0 || document.content[char_before_brace_index] !== '$') {
                    return [];
                }
            }

            // Use context tracker from document state if available
            if (!this.context_tracker && document.context_tracker) {
                this.context_tracker = document.context_tracker;
            }

            // Get current language context (sync)
            const my_current_context = this.context_tracker
                ? this.context_tracker.get_context_at_position(position)
                : LanguageContext.STATA;

            // Detect completion context (sync)
            const context = detect_completion_context(document, position, undefined, this.command_db);

            // Fast path: embedded context with no macro - return early
            if (my_current_context !== LanguageContext.STATA && context.type !== 'macro') {
                const my_boundary_completions = this.get_block_boundary_completions(document, position);
                return my_boundary_completions;
            }

            // === ASYNC PHASE: Scope resolution (only if needed) ===
            let resolved_scope: ResolvedScope | undefined;
            let symbols_for_completion: SymbolTable = document.symbols;

            if (scope_resolver) {
                const resolve_config = build_scope_resolver_config(cross_file_config);
                const temp_scope = await scope_resolver.resolve(
                    document.uri,
                    document.content,
                    resolve_config,
                    cancellation_token
                );
                const has_directives = temp_scope.has_directives;
                const has_auto_parents = temp_scope.has_auto_parents;
                const visible_forward_overlay =
                    this.get_annotated_visible_forward_symbols(
                        temp_scope,
                        position.line,
                    );

                if (has_directives || has_auto_parents) {
                    // With directives: use reachable scope chain (precision).
                    // get_visible_symbols_at already resolves forward calls
                    // with correct precedence; re-merging visible_forward_overlay
                    // would let forward symbols win a second time. Instead, copy
                    // annotations only onto entries whose winner is the forward-
                    // call version.
                    resolved_scope = temp_scope;
                    symbols_for_completion = this.copy_forward_annotations(
                        get_visible_symbols_at(temp_scope, position.line),
                        visible_forward_overlay,
                    );
                } else if (workspace_symbols) {
                    // No directives: use cached merged symbols (workspace + document)
                    const merged_workspace_symbols = this.get_merged_symbols(
                        workspace_symbols,
                        document.symbols,
                        document.uri,
                        document.version || 0,
                        workspace_version || 0,
                    );
                    symbols_for_completion = merge_symbol_tables(
                        merged_workspace_symbols,
                        visible_forward_overlay,
                    );
                } else {
                    symbols_for_completion = merge_symbol_tables(
                        document.symbols,
                        visible_forward_overlay,
                    );
                }
            } else if (workspace_symbols) {
                // No scope resolver, but we can still provide workspace symbols if available
                // Use cached merged symbols
                symbols_for_completion = this.get_merged_symbols(
                    workspace_symbols,
                    document.symbols,
                    document.uri,
                    document.version || 0,
                    workspace_version || 0
                );
            }

            const out_of_scope_symbols = this.partition_symbols_for_completion(
                document,
                workspace_symbols,
                symbols_for_completion,
                resolved_scope,
            );

            // === SYNC PHASE: Generate completions ===
            const the_completions: CompletionItem[] = [];

            // Check for quote snippet triggers - add snippets but continue to
            // also add macro completions
            if (trigger_character === '`' || trigger_character === '"') {
                const quote_completions = this.get_quote_snippet_completions(
                    document,
                    position,
                    trigger_character
                );
                the_completions.push(...quote_completions);

                // For backtick trigger, also add local macro completions
                if (trigger_character === '`') {
                    // Create artificial local context for backtick trigger
                    const local_context: MacroCompletionContext = {
                        type: 'macro',
                        scope: 'local',
                        form: 'local',
                        delimiterStart: Position.create(position.line, position.character - 1),
                        identifierRange: Range.create(position, position)
                    };
                    
                    const macro_completions = this.get_macro_completions(
                        local_context,
                        document,
                        position,
                        symbols_for_completion,
                        out_of_scope_symbols,
                        resolved_scope
                    );
                    the_completions.push(...macro_completions);
                    return the_completions;
                }

                // For compound quote (backtick + double-quote), just return snippet
                if (quote_completions.length > 0) {
                    return the_completions;
                }
            }

            // Generate completions based on context
            switch (context.type) {
                case 'command':
                    // Suppress command completions in embedded language contexts
                    if (my_current_context !== LanguageContext.STATA) {
                        return [];
                    }
                    return this.get_command_completions(document, position, symbols_for_completion, out_of_scope_symbols, resolved_scope);

                case 'option':
                    // Suppress option completions in embedded language contexts
                    if (my_current_context !== LanguageContext.STATA) {
                        return [];
                    }
                    return this.get_option_completions(context.command, document, position, symbols_for_completion);

                case 'macro':
                    // Always provide macro completions (macros work in all contexts)
                    return this.get_macro_completions(context, document, position, symbols_for_completion, out_of_scope_symbols, resolved_scope);

                case 'variable':
                    // Suppress variable completions in embedded language contexts
                    if (my_current_context !== LanguageContext.STATA) {
                        return [];
                    }
                    return this.get_variable_completions(document, position, symbols_for_completion, out_of_scope_symbols, resolved_scope);

                case 'program':
                    // Suppress program completions in embedded language contexts
                    if (my_current_context !== LanguageContext.STATA) {
                        return [];
                    }
                    return this.get_program_completions(document, position, symbols_for_completion, out_of_scope_symbols, resolved_scope);

                case 'directive_path':
                    // File path completions for directives (e.g., @lsp-done-by:)
                    return this.get_directive_path_completions(context.directive, context.partial_path || '', document);

                case 'command_path':
                    // File path completions for commands (e.g., do, run, include)
                    return this.get_command_path_completions(context.command, context.partial_path || '', document);

                case 'subcommand':
                    // Suppress subcommand completions in embedded language contexts
                    if (my_current_context !== LanguageContext.STATA) {
                        return [];
                    }
                    return this.get_subcommand_completions(context.prefix_command, document, position);

                case 'fallback':
                default:
                    // In embedded contexts, return empty for fallback
                    if (my_current_context !== LanguageContext.STATA) {
                        return [];
                    }
                    return this.get_fallback_completions(document, position);
            }
        } finally {
            if (profile_enabled) {
                const elapsed_ms = Date.now() - start_time_ms;
                logger.debug(
                    `completion[${document.uri}] v${document.version ?? 0} returned ${workspace_symbols ? 'workspace' : 'document'} symbols in ${elapsed_ms}ms`
                );
            }
        }
    }

    /**
     * Get command completions from the command database.
     * User-defined programs take precedence over built-in commands.
     * Results are cached by prefix and context.
     */
    private get_command_completions(
        document: DocumentState,
        position: Position,
        symbols: SymbolTable,
        out_of_scope: SymbolTable,
        resolved_scope?: ResolvedScope
    ): CompletionItem[] {
        const prefix = this.get_word_at_position(document, position);

        // Return empty if no prefix typed (reduces noise on empty lines)
        if (prefix === '') {
            return [];
        }
        
        // Include cursor line in cache context because the caller passes
        // `symbols` that were computed via get_visible_symbols_at(...,
        // position.line) and a visible_forward_overlay scoped to the same
        // line. Without the line in the key, completions from one cursor
        // position could be served for another position on the same document
        // version, producing stale/mis-scoped results.
        const cache_context = `command:${position.line}`;
        const document_version = document.version || 0;

        // Check cache first
        const cached_result = this.prefix_cache.get_with_context(prefix, cache_context, document_version);
        if (cached_result !== undefined) {
            return cached_result;
        }

        const the_completions: CompletionItem[] = [];
        const seen_labels = new Set<string>();

        // symbols are pre-selected by caller (reachable scope vs full workspace vs document)

        // First, add user-defined programs (higher precedence)
        if (symbols.programs.size > 0) {
            for (const [name, program] of symbols.programs) {
                if (prefix === '' || name.toLowerCase().startsWith(prefix.toLowerCase())) {
                    seen_labels.add(name.toLowerCase());
                    const symbol_info = this.get_completion_symbol_provenance(
                        program,
                        document.uri,
                        resolved_scope,
                    );
                    
                    const ranking_factors: CompletionRankingFactors = {
                        scope_depth: symbol_info.depth,
                        directive_type: symbol_info.directive_type,
                        symbol_type: 'user-program',
                        alphabetical_order: program.name,
                        parent_uri: program.sourceUri
                    };
                    
                    // Add source file annotation for cross-file symbols
                    let detail = 'User-defined program';
                    if (symbol_info.source_path) {
                        detail += ` (from ${symbol_info.source_path})`;
                    }
                    
                    the_completions.push({
                        label: program.name,
                        kind: CompletionItemKind.Function,
                        detail,
                        documentation: `Defined at ${program.sourceUri}`,
                        sortText: compute_ranking_key(ranking_factors),
                    });
                }
            }
        }

        // Out-of-scope workspace programs (from other files with no resolved link)
        for (const [name, program] of out_of_scope.programs) {
            if (prefix !== '' && !name.toLowerCase().startsWith(prefix.toLowerCase())) {
                continue;
            }
            // Skip if shadowed by an in-scope user program (same casing
            // convention as the in-scope program loop's seen_labels.add above).
            if (seen_labels.has(name.toLowerCase())) continue;
            // Do not shadow built-in commands: if a Stata built-in with the
            // same name exists, the built-in wins over the out-of-scope
            // workspace program. Mirror the lookup used by the built-in
            // command loop below (command_db.lookup / search).
            if (this.command_db.lookup(name)) continue;

            const ranking_factors: CompletionRankingFactors = {
                scope_depth: 0,
                directive_type: 'out-of-scope',
                symbol_type: 'user-program',
                alphabetical_order: program.name,
                parent_uri: program.sourceUri,
            };

            const source_path = this.get_relative_path(program.sourceUri);

            the_completions.push({
                label: program.name,
                kind: CompletionItemKind.Function,
                detail: `User-defined program (out of scope — from ${source_path})`,
                documentation: `Defined at ${program.sourceUri}`,
                sortText: compute_ranking_key(ranking_factors),
            });
            // Note: we intentionally do NOT add to seen_labels here. Doing so
            // would cause an out-of-scope program to suppress a same-name
            // built-in command in the next loop, which is the opposite of the
            // intended precedence (built-in > out-of-scope).
        }

        // Then add built-in commands (lower precedence)
        const the_commands = prefix === ''
            ? this.command_db.get_all()
            : this.command_db.search(prefix);

        for (const my_command of the_commands) {
            // Skip if shadowed by user program
            if (seen_labels.has(my_command.name.toLowerCase())) {
                continue;
            }

            // Sort by abbreviation length within the same tier so
            // commands with shorter abbreviations (more "canonical")
            // sort first. This is prefix-independent so it works when
            // VS Code caches completions (isIncomplete: false) and
            // filters client-side on subsequent keystrokes.
            const my_abbrev_sort = my_command.minAbbreviation.length
                .toString()
                .padStart(2, '0');
            const ranking_factors: CompletionRankingFactors = {
                scope_depth: 0,
                directive_type: 'current',
                symbol_type: 'builtin',
                alphabetical_order: my_abbrev_sort + my_command.name,
                parent_uri: document.uri,
                command_priority: my_command.priority,
            };

            const completion = this.create_command_completion(my_command);
            completion.sortText = compute_ranking_key(ranking_factors);
            the_completions.push(completion);
            
            // Note: We no longer add separate abbreviation completions to avoid duplicates.
            // The full command name is sufficient - users can type the abbreviation and
            // it will match the full command.
        }

        // Cache the result (trimmed to configured limit)
        const cached = this.prefix_cache.set_with_context(prefix, cache_context, the_completions, document_version);

        return cached;
    }

    /**
     * Get file path completions for directive contexts (e.g., @lsp-done-by:).
     */
    private get_directive_path_completions(
        directive: string,
        partial_path: string,
        document: DocumentState
    ): CompletionItem[] {
        // For @lsp-working-directory, only show directories
        const directories_only = directive.toLowerCase().includes('working') || 
                                directive.toLowerCase().includes('current') ||
                                directive.toLowerCase().includes('cd') ||
                                directive.toLowerCase().includes('wd');
        
        return this.get_file_path_completions(partial_path, document, directories_only);
    }

    /**
     * Get file path completions for command contexts (e.g., do, run, include).
     */
    private get_command_path_completions(
        command: string,
        partial_path: string,
        document: DocumentState
    ): CompletionItem[] {
        // All file commands show files, not directories only
        return this.get_file_path_completions(partial_path, document, false);
    }

    /**
     * Get subcommand completions for prefix commands like 'frame' or 'mi'.
     * Looks up the prefix command in the command database and returns its subcommands.
     */
    private get_subcommand_completions(
        prefix_command: string,
        document: DocumentState,
        position: Position
    ): CompletionItem[] {
        const the_completions: CompletionItem[] = [];
        
        // Look up subcommands from the database
        const subcommands = this.command_db.get_subcommands(prefix_command);
        if (!subcommands || subcommands.length === 0) {
            return the_completions;
        }
        
        // Get the prefix being typed (if any)
        const prefix = this.get_word_at_position(document, position).toLowerCase();
        
        // Capitalize prefix name for display
        const prefix_display = prefix_command.charAt(0).toUpperCase() + prefix_command.slice(1);
        
        // Add each subcommand as a completion
        for (const my_subcommand of subcommands) {
            // Filter by prefix if user is typing
            if (prefix && !my_subcommand.name.toLowerCase().startsWith(prefix)) {
                continue;
            }
            
            the_completions.push({
                label: my_subcommand.name,
                kind: CompletionItemKind.Keyword,
                detail: `${prefix_display} subcommand`,
                documentation: {
                    kind: MarkupKind.Markdown,
                    value: `Subcommand of \`${prefix_command}\`. See ${format_help_link(prefix_command + ' ' + my_subcommand.name)}`,
                },
                sortText: '0' + my_subcommand.name, // Sort before other completions
            });
        }
        
        return the_completions;
    }

    /**
     * Get file path completions based on partial path.
     */
    private get_file_path_completions(
        partial_path: string,
        document: DocumentState,
        directories_only: boolean
    ): CompletionItem[] {
        const completions: CompletionItem[] = [];
        
        try {
            // Get workspace root from document URI
            const workspace_root = this.get_workspace_root(document.uri);
            if (!workspace_root) {
                return completions;
            }

            // Resolve base directory from partial path
            let base_dir = workspace_root;
            let search_prefix = '';

            if (partial_path) {
                // Remove quotes if present
                const clean_path = partial_path.replace(/^["']|["']$/g, '');
                
                if (clean_path.includes('/')) {
                    const path_parts = clean_path.split('/');
                    search_prefix = path_parts.pop() || '';
                    const dir_path = path_parts.join('/');
                    base_dir = path.resolve(workspace_root, dir_path);
                } else {
                    search_prefix = clean_path;
                }
            }

            // Check if base directory exists
            if (!fs.existsSync(base_dir) || !fs.statSync(base_dir).isDirectory()) {
                return completions;
            }

            // Read directory contents
            const entries = fs.readdirSync(base_dir, { withFileTypes: true });

            for (const entry of entries) {
                // Skip hidden files/directories
                if (entry.name.startsWith('.')) {
                    continue;
                }

                // Filter by prefix if provided
                if (search_prefix && !entry.name.toLowerCase().startsWith(search_prefix.toLowerCase())) {
                    continue;
                }

                if (entry.isDirectory()) {
                    // Always include directories
                    completions.push({
                        label: entry.name + '/',
                        kind: CompletionItemKind.Folder,
                        detail: 'Directory',
                        insertText: entry.name + '/',
                        sortText: `0_${entry.name}` // Directories first
                    });
                } else if (!directories_only && entry.isFile()) {
                    // Include files only if not directories_only
                    const is_stata_file = hasStataExtension(entry.name);
                    
                    completions.push({
                        label: entry.name,
                        kind: is_stata_file ? CompletionItemKind.File : CompletionItemKind.Text,
                        detail: is_stata_file ? 'Stata file' : 'File',
                        insertText: entry.name,
                        sortText: is_stata_file ? `1_${entry.name}` : `2_${entry.name}` // Stata files before other files
                    });
                }
            }

        } catch (error) {
            // Silently handle filesystem errors
            console.warn('Error reading directory for file path completion:', error);
        }

        return completions;
    }

    /**
     * Extract workspace root from document URI.
     */
    private get_workspace_root(document_uri: string): string | null {
        try {
            // Convert file:// URI to local path
            const file_path = document_uri.replace(/^file:\/\//, '');
            
            // Find workspace root by looking for common markers
            let current_dir = path.dirname(file_path);
            
            while (current_dir !== path.dirname(current_dir)) {
                // Check for common workspace markers
                const markers = ['.git', 'sight.toml', '.sight.json', 'package.json', '.vscode'];
                
                for (const marker of markers) {
                    if (fs.existsSync(path.join(current_dir, marker))) {
                        return current_dir;
                    }
                }
                
                current_dir = path.dirname(current_dir);
            }
            
            // Fallback to document directory
            return path.dirname(file_path);
        } catch {
            return null;
        }
    }

    /**
     * Get option completions for a specific command.
     * Results are cached by command name and context.
     */
    private get_option_completions(
        command_name: string,
        document: DocumentState,
        position: Position,
        symbols?: SymbolTable
    ): CompletionItem[] {
        // Get the option prefix (text after the last comma)
        const option_prefix = this.get_option_prefix_at_position(document, position);
        
        // Check if it's a user-defined program first (before prefix check)
        // Check current document symbols first
        const user_program = document.symbols.programs.get(command_name);
        if (user_program && user_program.signature) {
            return this.get_completions_for_user_program_call_with_program(user_program, document, position);
        }
        
        // Also check workspace/merged symbols for cross-file programs
        if (symbols) {
            const workspace_program = symbols.programs.get(command_name);
            if (workspace_program && workspace_program.signature) {
                return this.get_completions_for_user_program_call_with_program(workspace_program, document, position);
            }
        }
        
        const cache_context = `option:${command_name}:${option_prefix}`;
        const document_version = document.version || 0;

        // Check cache first
        const cached_result = this.prefix_cache.get_with_context(option_prefix, cache_context, document_version);
        if (cached_result !== undefined) {
            return cached_result;
        }

        const the_completions: CompletionItem[] = [];

        if (!command_name) {
            return the_completions;
        }

        // Look up command in database
        const command_info = this.command_db.lookup(command_name);
        if (!command_info) {
            // Try abbreviation expansion
            const the_matches = this.command_db.expand_abbreviation(command_name);
            if (the_matches.length === 1) {
                return this.get_option_completions(the_matches[0].name, document, position, symbols);
            }
            
            return the_completions;
        }

        // Filter options by prefix
        const prefix_lower = option_prefix.toLowerCase();
        
        // Add options for this command
        for (const my_option of command_info.options) {
            // Filter by prefix
            if (!my_option.name.toLowerCase().startsWith(prefix_lower)) {
                continue;
            }
            
            the_completions.push({
                label: my_option.name,
                kind: CompletionItemKind.Property,
                detail: `Option for ${command_info.name}`,
                insertText: my_option.hasArgument ? `${my_option.name}()` : my_option.name,
                documentation: `Option for ${command_info.name}`,
                sortText: '1' + my_option.name,
            });
            
            // Note: We no longer add separate abbreviation completions to avoid duplicates.
            // The full option name is sufficient - users can type the abbreviation and
            // it will match the full option.
        }

        // Cache the result (trimmed to configured limit)
        const cached = this.prefix_cache.set_with_context(option_prefix, cache_context, the_completions, document_version);

        return cached;
    }
    
    /**
     * Get the option prefix at the current position (text after the last comma).
     */
    private get_option_prefix_at_position(document: DocumentState, position: Position): string {
        if (position.line >= get_line_count(document)) {
            return '';
        }
        
        const current_line = get_line_text(document, position.line);
        const text_before_cursor = current_line.substring(0, position.character);
        
        // Find the last comma that's not inside quotes or parentheses
        let paren_depth = 0;
        let in_string = false;
        let last_comma_pos = -1;
        
        for (let i = 0; i < text_before_cursor.length; i++) {
            const char = text_before_cursor[i];
            const next_char = text_before_cursor[i + 1] || '';
            
            // Track string boundaries
            if (char === '"' && !in_string) {
                in_string = true;
                continue;
            }
            if (in_string && char === '"') {
                if (next_char === '"') {
                    i++; // Skip escaped quote
                    continue;
                }
                in_string = false;
                continue;
            }
            if (in_string) continue;
            
            // Track parentheses
            if (char === '(') paren_depth++;
            if (char === ')') paren_depth--;
            
            // Track commas at top level
            if (char === ',' && paren_depth === 0) {
                last_comma_pos = i;
            }
        }
        
        if (last_comma_pos < 0) {
            return '';
        }
        
        // Get text after the last comma and extract the word prefix
        const text_after_comma = text_before_cursor.substring(last_comma_pos + 1).trim();
        
        // Extract the word being typed (alphanumeric characters)
        const word_match = text_after_comma.match(/^([a-zA-Z_][a-zA-Z0-9_]*)?$/);
        if (word_match) {
            return word_match[1] || '';
        }
        
        return '';
    }

    /**
     * Get macro completions from the symbol table.
     * Filters by prefix (case-insensitive) and sorts alphabetically.
     *
     * @param context - The detected macro context (with form and delimiters)
     * @param document - The document state
     * @param position - The cursor position for prefix extraction
     * @param resolved_scope - Optional resolved scope for cross-file symbols
     * @returns Array of completion items filtered by prefix and sorted alphabetically
     */
    private get_macro_completions(
        context: MacroCompletionContext,
        document: DocumentState,
        position: Position,
        symbols: SymbolTable,
        out_of_scope: SymbolTable,
        resolved_scope?: ResolvedScope
    ): CompletionItem[] {
        // Use context.form to determine scope and delimiter behavior
        const scope = context.scope;
        
        // Compute replacement range using the enhanced context
        const replacement_range = compute_macro_replacement_range(document, position, context);
        
        // Extract prefix from replacement range
        // Note: document is DocumentState, not TextDocument, so we extract from content manually
        let prefix = '';
        
        if (replacement_range.start.line < get_line_count(document)) {
            const line_content = get_line_text(document, replacement_range.start.line);
            prefix = line_content.substring(replacement_range.start.character, replacement_range.end.character);
        }
        const prefix_lower = prefix.toLowerCase();
        
        const the_completions: CompletionItem[] = [];
        const seen_labels = new Set<string>();

        const current_program = scope === 'local'
            ? this.detect_cursor_in_program_body(document, position)
            : null;

        // CRITICAL FIX: Ensure 'symbols' actually has content and is a valid SymbolTable.
        // In unit tests, partial or mock objects might be passed.
        // Ensure we are accessing the Maps correctly and handling plain objects if necessary.
        let the_macros: Map<string, MacroSymbol>;
        if (scope === 'local') {
            const localMacros = symbols.localMacros;
            if (localMacros instanceof Map) {
                the_macros = localMacros;
            } else if (localMacros && typeof localMacros === 'object') {
                the_macros = new Map(Object.entries(localMacros));
            } else {
                the_macros = new Map();
            }
        } else {
            const globalMacros = symbols.globalMacros;
            if (globalMacros instanceof Map) {
                the_macros = globalMacros;
            } else if (globalMacros && typeof globalMacros === 'object') {
                the_macros = new Map(Object.entries(globalMacros));
            } else {
                the_macros = new Map();
            }
        }
        
        // Build lowercase index for faster prefix matching
        // This avoids calling toLowerCase() for each symbol in the loop
        const lowercase_index = new Map<string, string>();
        for (const name of the_macros.keys()) {
            lowercase_index.set(name, name.toLowerCase());
        }

        // Determine if we need to add closing delimiter based on context
        let needs_closing_delimiter = false;
        let closing_char = '';
        
        if (context.form === 'local') {
            closing_char = "'";
            needs_closing_delimiter = !has_closing_delimiter(document, replacement_range.end, closing_char);
        } else if (context.form === 'global-braced') {
            closing_char = '}';
            needs_closing_delimiter = !has_closing_delimiter(document, replacement_range.end, closing_char);
        }
        // global-unbraced: no suffix needed

        for (const [name, macro] of the_macros) {
            // Case-insensitive prefix match using pre-computed lowercase index
            const name_lower = lowercase_index.get(name) || name.toLowerCase();
            if (!(prefix === '' || name_lower.startsWith(prefix_lower))) {
                continue;
            }

            // For local macro completions, respect position within the current file.
            // Stata locals are only visible on lines after their definition — a local defined
            // below the cursor line cannot be referenced at the cursor. Only applies when the
            // macro is defined in the current document; inherited locals from parent files
            // (via include-chain) are already call-site-filtered by the scope resolver.
            if (scope === 'local' && macro.sourceUri === document.uri) {
                const def_line = macro.definition_line ?? macro.location?.range?.start?.line;
                if (typeof def_line === 'number' && def_line > position.line) {
                    continue;
                }
            }

            // For local macro completions, respect program scoping.
            // - If cursor is inside a program: include locals defined in that program + locals defined at file scope.
            // - If cursor is outside any program: exclude locals defined inside programs.
            if (scope === 'local' && document.ast) {
                const macro_pos = macro.location?.range?.start;
                if (macro_pos) {
                    const containing_program = this.find_program_containing_position(
                        document.ast.nodes,
                        macro_pos
                    );

                    if (current_program) {
                        // Inside a program: allow locals from this program OR from file scope.
                        if (containing_program && containing_program.name !== current_program.name) {
                            continue;
                        }
                    } else {
                        // Outside any program: exclude locals defined inside any program.
                        if (containing_program) {
                            continue;
                        }
                    }
                }
            }

            // Determine scope proximity for ranking
            const symbol_info = this.get_completion_symbol_provenance(
                macro,
                document.uri,
                resolved_scope,
            );

            const ranking_factors: CompletionRankingFactors = {
                scope_depth: symbol_info.depth,
                directive_type: symbol_info.directive_type,
                symbol_type: scope === 'local' ? 'local-macro' : 'global-macro',
                alphabetical_order: name,
                parent_uri: macro.sourceUri,
            };

            // Add source file annotation for cross-file symbols
            let detail = `${scope} macro`;
            if (symbol_info.source_path) {
                detail += ` (from ${symbol_info.source_path})`;
            }

            // Compute newText with optional closing delimiter
            const new_text = name + (needs_closing_delimiter ? closing_char : '');

            the_completions.push({
                label: name,
                kind: CompletionItemKind.Variable,
                detail,
                documentation: macro.value ? `Value: ${macro.value}` : undefined,
                sortText: compute_ranking_key(ranking_factors),
                textEdit: {
                    range: replacement_range,
                    newText: new_text,
                },
            });
            seen_labels.add(name);
        }

        // Add program arguments if we're inside a program body and looking for local macros.
        // If a program argument name collides with a local macro completion, prefer the
        // program argument annotation/ranking.
        if (scope === 'local' && current_program && current_program.signature) {
            const program_arguments = this.extract_program_arguments(current_program.signature);

            for (const arg_name of program_arguments) {
                // Case-insensitive prefix match
                if (!(prefix === '' || arg_name.toLowerCase().startsWith(prefix_lower))) {
                    continue;
                }

                // Remove any existing completion with the same label (e.g., if the symbol table
                // contains a local macro for a syntax-generated argument like `varlist`).
                for (let i = the_completions.length - 1; i >= 0; i--) {
                    if (the_completions[i].label === arg_name) {
                        the_completions.splice(i, 1);
                    }
                }

                const ranking_factors: CompletionRankingFactors = {
                    scope_depth: 0,
                    directive_type: 'current',
                    symbol_type: 'program-argument',
                    alphabetical_order: arg_name,
                    parent_uri: document.uri,
                };

                // Compute newText with closing apostrophe for local macro
                const new_text = arg_name + (needs_closing_delimiter ? "'" : '');

                the_completions.push({
                    label: arg_name,
                    kind: CompletionItemKind.Variable,
                    detail: 'Program argument',
                    documentation: `Argument from program ${current_program.name}`,
                    sortText: compute_ranking_key(ranking_factors),
                    textEdit: {
                        range: replacement_range,
                        newText: new_text,
                    },
                });
            }
        }

        // Out-of-scope pass: emit workspace globals that aren't part of the
        // in-scope bag, labelled so the user sees that accepting them will
        // trigger an undefined-symbol diagnostic. Skip entirely for locals —
        // local macros are file-scoped and never offered workspace-wide.
        const scope_is_local = context.scope === 'local';
        if (!scope_is_local) {
            const out_map = out_of_scope.globalMacros;
            for (const [name, macro] of out_map) {
                const name_lower = name.toLowerCase();
                if (!(prefix === '' || name_lower.startsWith(prefix_lower))) {
                    continue;
                }
                if (seen_labels.has(name)) {
                    continue;
                }

                const ranking_factors: CompletionRankingFactors = {
                    scope_depth: 0,
                    directive_type: 'out-of-scope',
                    symbol_type: 'global-macro',
                    alphabetical_order: name,
                    parent_uri: macro.sourceUri,
                };

                const source_path = this.get_relative_path(macro.sourceUri);
                const new_text = name + (needs_closing_delimiter ? closing_char : '');

                the_completions.push({
                    label: name,
                    kind: CompletionItemKind.Variable,
                    detail: `global macro (out of scope — from ${source_path})`,
                    documentation: macro.value ? `Value: ${macro.value}` : undefined,
                    sortText: compute_ranking_key(ranking_factors),
                    textEdit: {
                        range: replacement_range,
                        newText: new_text,
                    },
                });
                seen_labels.add(name);
            }
        }

        return the_completions;
    }

    /**
     * Get variable completions from the symbol table.
     */
    private get_variable_completions(
        document: DocumentState,
        position: Position,
        symbols: SymbolTable,
        out_of_scope: SymbolTable,
        resolved_scope?: ResolvedScope
    ): CompletionItem[] {
        const the_completions: CompletionItem[] = [];
        const seen_labels = new Set<string>();

        // Compute replacement range
        let replacement_range: Range;
        
        if (position.line < get_line_count(document)) {
            const current_line = get_line_text(document, position.line);
            const text_before_cursor = current_line.substring(0, position.character);
            
            // Find start of word
            let word_start = text_before_cursor.length;
            while (word_start > 0) {
                const char = text_before_cursor[word_start - 1];
                if (!/[a-zA-Z0-9_]/.test(char)) {
                    break;
                }
                word_start--;
            }
            
            replacement_range = Range.create(
                Position.create(position.line, word_start),
                position
            );
        } else {
            replacement_range = Range.create(position, position);
        }

        // Variables
        for (const [name, variable] of symbols.variables) {
            const symbol_info = this.get_completion_symbol_provenance(
                variable,
                document.uri,
                resolved_scope,
            );

            const ranking_factors: CompletionRankingFactors = {
                scope_depth: symbol_info.depth,
                directive_type: symbol_info.directive_type,
                symbol_type: 'variable',
                alphabetical_order: name,
                parent_uri: variable.sourceUri
            };

            // Add source file annotation for cross-file symbols
            let detail = variable.type ? `${variable.type} variable` : 'Variable';
            if (symbol_info.source_path) {
                detail += ` (from ${symbol_info.source_path})`;
            }

            the_completions.push({
                label: name,
                kind: CompletionItemKind.Field,
                detail,
                documentation: variable.label || `Created via ${variable.source}`,
                sortText: compute_ranking_key(ranking_factors),
                textEdit: {
                    range: replacement_range,
                    newText: name,
                },
                filterText: name,
            });
            seen_labels.add(name);
        }

        // Scalars
        const scalars: Map<string, ScalarSymbol> = symbols.scalars instanceof Map ? symbols.scalars : new Map();
        for (const [name, scalar] of scalars) {
            const symbol_info = this.get_completion_symbol_provenance(
                scalar,
                document.uri,
                resolved_scope,
            );

            const ranking_factors: CompletionRankingFactors = {
                scope_depth: symbol_info.depth,
                directive_type: symbol_info.directive_type,
                symbol_type: 'scalar',
                alphabetical_order: name,
                parent_uri: scalar.sourceUri
            };

            let detail = 'Scalar';
            if (symbol_info.source_path) {
                detail += ` (from ${symbol_info.source_path})`;
            }

            the_completions.push({
                label: name,
                kind: CompletionItemKind.Constant,
                detail,
                documentation: `Defined at ${scalar.sourceUri}`,
                sortText: compute_ranking_key(ranking_factors),
                textEdit: {
                    range: replacement_range,
                    newText: name,
                },
                filterText: name,
            });
            seen_labels.add(name);
        }

        // Matrices
        const matrices: Map<string, MatrixSymbol> = symbols.matrices instanceof Map ? symbols.matrices : new Map();
        for (const [name, matrix] of matrices) {
            const symbol_info = this.get_completion_symbol_provenance(
                matrix,
                document.uri,
                resolved_scope,
            );

            const ranking_factors: CompletionRankingFactors = {
                scope_depth: symbol_info.depth,
                directive_type: symbol_info.directive_type,
                symbol_type: 'matrix',
                alphabetical_order: name,
                parent_uri: matrix.sourceUri
            };

            let detail = 'Matrix';
            if (symbol_info.source_path) {
                detail += ` (from ${symbol_info.source_path})`;
            }

            the_completions.push({
                label: name,
                kind: CompletionItemKind.Struct,
                detail,
                documentation: `Defined at ${matrix.sourceUri}`,
                sortText: compute_ranking_key(ranking_factors),
                textEdit: {
                    range: replacement_range,
                    newText: name,
                },
                filterText: name,
            });
            seen_labels.add(name);
        }

        // Out-of-scope pass: emit workspace scalars and matrices that are
        // not already in-scope. Variables stay workspace-wide through the
        // in-scope path and are intentionally skipped here.
        for (const [name, scalar] of out_of_scope.scalars) {
            if (seen_labels.has(name)) continue;

            const ranking_factors: CompletionRankingFactors = {
                scope_depth: 0,
                directive_type: 'out-of-scope',
                symbol_type: 'scalar',
                alphabetical_order: name,
                parent_uri: scalar.sourceUri,
            };
            const source_path = this.get_relative_path(scalar.sourceUri);

            the_completions.push({
                label: name,
                kind: CompletionItemKind.Constant,
                detail: `Scalar (out of scope — from ${source_path})`,
                documentation: `Defined at ${scalar.sourceUri}`,
                sortText: compute_ranking_key(ranking_factors),
                textEdit: {
                    range: replacement_range,
                    newText: name,
                },
                filterText: name,
            });
            seen_labels.add(name);
        }

        for (const [name, matrix] of out_of_scope.matrices) {
            if (seen_labels.has(name)) continue;

            const ranking_factors: CompletionRankingFactors = {
                scope_depth: 0,
                directive_type: 'out-of-scope',
                symbol_type: 'matrix',
                alphabetical_order: name,
                parent_uri: matrix.sourceUri,
            };
            const source_path = this.get_relative_path(matrix.sourceUri);

            the_completions.push({
                label: name,
                kind: CompletionItemKind.Struct,
                detail: `Matrix (out of scope — from ${source_path})`,
                documentation: `Defined at ${matrix.sourceUri}`,
                sortText: compute_ranking_key(ranking_factors),
                textEdit: {
                    range: replacement_range,
                    newText: name,
                },
                filterText: name,
            });
            seen_labels.add(name);
        }

        return the_completions;
    }

    /**
     * Get program completions from the symbol table.
     */
    private get_program_completions(
        document: DocumentState,
        position: Position,
        symbols: SymbolTable,
        out_of_scope: SymbolTable,
        resolved_scope?: ResolvedScope
    ): CompletionItem[] {
        const the_completions: CompletionItem[] = [];
        const seen_labels = new Set<string>();

        for (const [name, program] of symbols.programs) {
            const symbol_info = this.get_completion_symbol_provenance(
                program,
                document.uri,
                resolved_scope,
            );

            const ranking_factors: CompletionRankingFactors = {
                scope_depth: symbol_info.depth,
                directive_type: symbol_info.directive_type,
                symbol_type: 'user-program',
                alphabetical_order: program.name,
                parent_uri: program.sourceUri
            };

            // Add source file annotation for cross-file symbols
            let detail = 'User-defined program';
            if (symbol_info.source_path) {
                detail += ` (from ${symbol_info.source_path})`;
            }

            the_completions.push({
                label: program.name,
                kind: CompletionItemKind.Function,
                detail,
                documentation: `Defined at ${program.sourceUri}`,
                sortText: compute_ranking_key(ranking_factors),
            });
            seen_labels.add(name);
        }

        for (const [name, program] of out_of_scope.programs) {
            if (seen_labels.has(name)) continue;

            const ranking_factors: CompletionRankingFactors = {
                scope_depth: 0,
                directive_type: 'out-of-scope',
                symbol_type: 'user-program',
                alphabetical_order: program.name,
                parent_uri: program.sourceUri,
            };

            const source_path = this.get_relative_path(program.sourceUri);

            the_completions.push({
                label: program.name,
                kind: CompletionItemKind.Function,
                detail: `User-defined program (out of scope — from ${source_path})`,
                documentation: `Defined at ${program.sourceUri}`,
                sortText: compute_ranking_key(ranking_factors),
            });
            seen_labels.add(name);
        }

        return the_completions;
    }

    /**
     * Get fallback completions when AST is unavailable.
     * Returns command database completions as a fallback.
     * Returns empty list if no prefix is typed (aligns with Requirement 6.4).
     */
    private get_fallback_completions(
        document: DocumentState,
        position: Position
    ): CompletionItem[] {
        // Check for empty prefix - return empty if no prefix typed
        const prefix = this.get_word_at_position(document, position);
        if (prefix === '') {
            return [];
        }

        const the_completions: CompletionItem[] = [];
        const the_commands = this.command_db.get_all();

        for (const my_command of the_commands) {
            the_completions.push(this.create_command_completion(my_command));
        }

        return the_completions;
    }

    /**
     * Get block boundary completions for embedded language blocks.
     * Suggests 'end' or 'end python' when at the boundary of a block.
     */
    private get_block_boundary_completions(
        document: DocumentState,
        position: Position
    ): CompletionItem[] {
        const the_completions: CompletionItem[] = [];

        if (!this.context_tracker) {
            return the_completions;
        }

        // Get the current context range
        const my_context_range = this.context_tracker.get_context_range_at_position(position);
        if (!my_context_range) {
            return the_completions;
        }

        // Check if we're at the start of a line (potential block boundary)
        if (position.line >= get_line_count(document)) {
            return the_completions;
        }

        const current_line = get_line_text(document, position.line);
        const text_before_cursor = current_line.substring(0, position.character);
        const trimmed = text_before_cursor.trim();

        // Only suggest block-ending commands if we're at the start of a line
        // (or after whitespace)
        if (trimmed === '' && my_context_range.context !== LanguageContext.STATA) {
            if (my_context_range.context === LanguageContext.MATA) {
                the_completions.push({
                    label: 'end',
                    kind: CompletionItemKind.Keyword,
                    detail: 'End mata block',
                    documentation: 'Closes the current mata block',
                    sortText: '0end',
                });
            } else if (my_context_range.context === LanguageContext.PYTHON) {
                the_completions.push({
                    label: 'end',
                    kind: CompletionItemKind.Keyword,
                    detail: 'End python block',
                    documentation: 'Closes the current python block',
                    sortText: '0end',
                });
            }
        }

        return the_completions;
    }

    /**
     * Get quote snippet completions for backtick and compound quote triggers.
     */
    private get_quote_snippet_completions(
        document: DocumentState,
        position: Position,
        trigger_character: string
    ): CompletionItem[] {
        const the_completions: CompletionItem[] = [];

        // Check the character before the trigger to determine context
        if (position.line >= get_line_count(document)) {
            return the_completions;
        }

        const current_line = get_line_text(document, position.line);
        // The trigger character is at position.character - 1 (already typed)
        const char_before_trigger = position.character > 1
            ? current_line[position.character - 2]
            : '';

        if (trigger_character === '`') {
            // Offer local macro snippet
            the_completions.push(this.create_local_macro_snippet());
        } else if (trigger_character === '"') {
            // Check if the character before the " is a backtick
            if (char_before_trigger === '`') {
                // Offer compound quote snippet
                the_completions.push(this.create_compound_quote_snippet());
            }
        }

        return the_completions;
    }

    /**
     * Create a completion item for a command.
     */
    private create_command_completion(command: CommandInfo): CompletionItem {
        // Build detail from options list instead of syntax
        let detail: string | undefined;
        if (command.options && command.options.length > 0) {
            const option_names = command.options.slice(0, 5).map(opt => opt.name);
            detail = `Options: ${option_names.join(', ')}`;
            if (command.options.length > 5) {
                detail += `, ... (+${command.options.length - 5} more)`;
            }
        }

        // Get enhanced help content if available, otherwise use help link
        const help_content = this.command_db.get_help_content(command.name, 'markdown');
        const documentation = help_content ? {
            kind: 'markdown' as const,
            value: help_content
        } : {
            kind: 'markdown' as const,
            value: `See Stata documentation: ${format_help_link(command.name)}`,
        };

        return {
            label: command.name,
            kind: CompletionItemKind.Keyword,
            detail,
            documentation,
            sortText: '1' + command.name,
        };
    }

    /**
     * Create a completion item for a command abbreviation.
     */
    private create_abbreviation_completion(command: CommandInfo): CompletionItem {
        // Get enhanced help content if available, otherwise use help link
        const help_content = this.command_db.get_help_content(command.name, 'markdown');
        const documentation = help_content ? {
            kind: 'markdown' as const,
            value: help_content + `\n\n*Abbreviation for \`${command.name}\`*`
        } : {
            kind: 'markdown' as const,
            value: `See Stata documentation: ${format_help_link(command.name)}\n\n*Abbreviation for \`${command.name}\`*`,
        };

        return {
            label: command.minAbbreviation,
            kind: CompletionItemKind.Keyword,
            detail: `Abbreviation for ${command.name}`,
            insertText: command.minAbbreviation,
            documentation,
            sortText: '2' + command.minAbbreviation,
        };
    }

    /**
     * Create a snippet completion for local macro reference.
     */
    private create_local_macro_snippet(): CompletionItem {
        if (this.client_capabilities.snippet_support) {
            return {
                label: 'Local macro reference',
                kind: CompletionItemKind.Snippet,
                detail: "Insert `name' with closing quote",
                insertText: '`${1:name}\'$0',
                insertTextFormat: InsertTextFormat.Snippet,
                filterText: '`',
                sortText: '1', // Sort after actual macros so users see real macros first
            };
        } else {
            return {
                label: 'Local macro reference',
                kind: CompletionItemKind.Snippet,
                detail: "Insert `name' with closing quote",
                insertText: "`'",
                filterText: '`',
                sortText: '1', // Sort after actual macros
            };
        }
    }

    /**
     * Create a snippet completion for compound quote.
     */
    private create_compound_quote_snippet(): CompletionItem {
        if (this.client_capabilities.snippet_support) {
            return {
                label: 'Compound quote string',
                kind: CompletionItemKind.Snippet,
                detail: 'Insert `"text"\' compound quote',
                insertText: '`"${1:text}"\'$0',
                insertTextFormat: InsertTextFormat.Snippet,
                filterText: '`"',
                sortText: '0',
            };
        } else {
            return {
                label: 'Compound quote string',
                kind: CompletionItemKind.Snippet,
                detail: 'Insert `"text"\' compound quote',
                insertText: '`""\'',
                filterText: '`"',
                sortText: '0',
            };
        }
    }
    /**
     * Get the word being typed at the cursor position.
     */
    private get_word_at_position(document: DocumentState, position: Position): string {
        if (position.line >= get_line_count(document)) {
            return '';
        }

        const current_line = get_line_text(document, position.line);
        const text_before_cursor = current_line.substring(0, position.character);

        // Find the start of the current word
        let word_start = text_before_cursor.length;
        while (word_start > 0) {
            const char = text_before_cursor[word_start - 1];
            if (!/[a-zA-Z0-9_]/.test(char)) {
                break;
            }
            word_start--;
        }

        return text_before_cursor.substring(word_start);
    }

    /**
     * Compute the replacement range for macro completions.
     * Wrapper method that calls the standalone function.
     * 
     * @param document - The document state
     * @param position - The cursor position
     * @param context - The macro context (local or global)
     * @returns Range object with start and end positions
     */
    compute_macro_replacement_range(
        document: DocumentState,
        position: Position,
        context: MacroCompletionContext
    ): Range {
        return compute_macro_replacement_range(document, position, context);
    }

    /**
     * Extract the macro name prefix from text before cursor.
     * Derives prefix from the computed replacement range.
     *
     * @param document - The document state
     * @param position - The cursor position
     * @param context - The macro context
     * @returns The prefix string (empty if replacement range is empty)
     */
    get_macro_prefix(
        document: DocumentState,
        position: Position,
        context: MacroCompletionContext
    ): string {
        const replacement_range = compute_macro_replacement_range(document, position, context);
        
        // Extract text from replacement range
        if (replacement_range.start.line >= get_line_count(document)) {
            return '';
        }
        
        const line = get_line_text(document, replacement_range.start.line);
        return line.substring(replacement_range.start.character, replacement_range.end.character);
    }

    /**
     * Extract prefix for local macro (text after last unmatched backtick).
     * Handles compound quotes `" which should not be treated as macro starts.
     * Also handles extended macro syntax (`: list macname`).
     */
    private get_local_macro_prefix(text_before_cursor: string): string {
        // First check for extended macro syntax (`: list ...`)
        const extended_prefix = this.get_extended_macro_prefix(text_before_cursor);
        if (extended_prefix !== null) {
            return extended_prefix;
        }

        let backtick_count = 0;
        let apostrophe_count = 0;
        let last_backtick_pos = -1;

        for (let i = 0; i < text_before_cursor.length; i++) {
            const char = text_before_cursor[i];
            const next_char = text_before_cursor[i + 1] || '';

            if (char === '`' && next_char !== '"') {
                backtick_count++;
                last_backtick_pos = i;
            } else if (char === "'" && backtick_count > apostrophe_count) {
                apostrophe_count++;
            }
        }

        // If we have an unmatched backtick, extract prefix after it
        if (backtick_count > apostrophe_count && last_backtick_pos >= 0) {
            return text_before_cursor.substring(last_backtick_pos + 1);
        }

        // Handle case where text ends with complete macro reference `name'
        // Extract the macro name (without the closing apostrophe) as the prefix
        if (last_backtick_pos >= 0 && text_before_cursor.endsWith("'")) {
            const after_backtick = text_before_cursor.substring(last_backtick_pos + 1);
            // Remove the trailing apostrophe to get the prefix
            return after_backtick.slice(0, -1);
        }

        return '';
    }

    /**
     * Extract prefix for extended macro syntax.
     * Returns the partial macro name being typed, or null if not in extended
     * macro context.
     */
    private get_extended_macro_prefix(text_before_cursor: string): string | null {
        // Pattern: local/global macname : function_name ...
        const extended_macro_pattern = /^\s*(local|global)\s+\w+\s*:\s*(\w+)\s*/i;
        const match = text_before_cursor.match(extended_macro_pattern);

        if (!match) {
            return null;
        }

        const function_name = match[2].toLowerCase();
        const after_function = text_before_cursor.substring(match[0].length);

        // List functions - extract macro name after operators or at start
        if (function_name === 'list') {
            // Match patterns like: "macA", "macA - ", "macA - macB", "- macC"
            const list_patterns = [
                /(?:^|[\s&|\-])\s*(\w*)$/,  // After operator or at start
                /^(\w*)$/                   // Just the macro name
            ];
            
            for (const pattern of list_patterns) {
                const list_match = after_function.match(pattern);
                if (list_match) {
                    return list_match[1];
                }
            }
        }

        // Word functions - extract macro name from backtick references
        if (function_name === 'word') {
            const macro_match = after_function.match(/`(\w*)$/);
            if (macro_match) {
                return macro_match[1];
            }
        }

        // String functions - extract macro name from backtick references
        if (['subinstr', 'length', 'piece'].includes(function_name)) {
            const macro_match = after_function.match(/`(\w*)$/);
            if (macro_match) {
                return macro_match[1];
            }
        }

        return '';
    }

    /**
     * Extract prefix for global macro (text after $ or ${).
     * Handles both $name and ${name} forms.
     */
    private get_global_macro_prefix(text_before_cursor: string): string {
        // Find last $ that starts a macro reference
        for (let i = text_before_cursor.length - 1; i >= 0; i--) {
            if (text_before_cursor[i] === '$') {
                const after_dollar = text_before_cursor.substring(i + 1);

                // Handle ${name} form
                if (after_dollar.startsWith('{')) {
                    if (!after_dollar.includes('}')) {
                        return after_dollar.substring(1); // Skip the {
                    }
                    continue; // Closed brace, keep looking
                }

                // Handle $name form - check if still typing
                if (/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(after_dollar) || after_dollar === '') {
                    return after_dollar;
                }
            }
        }
        return '';
    }

    /**
     * Get completions for a user program call using a program symbol directly.
     * Looks up the program signature and filters options by partial abbreviation.
     *
     * @param program_symbol - The program symbol with signature
     * @param document - The document state
     * @param position - The cursor position for extracting partial option
     * @returns Array of completion items for the program's options
     */
    get_completions_for_user_program_call_with_program(
        program_symbol: ProgramSymbol,
        document: DocumentState,
        position: Position
    ): CompletionItem[] {
        const the_completions: CompletionItem[] = [];

        if (!program_symbol.signature) {
            return the_completions;
        }

        const my_signature = program_symbol.signature;

        // Extract partial option being typed
        const my_partial_option = this.get_partial_option_at_position(document, position);

        // Get all options from the signature
        const my_options = my_signature.options;

        // Compute disambiguated abbreviations across all options
        const my_abbrev_map = this.compute_disambiguated_abbreviations(my_options);

        // Filter options by partial abbreviation and format completions
        for (const my_option of my_options) {
            const my_min_abbrev = my_abbrev_map.get(my_option.name) || my_option.minAbbreviation;

            // Check if option matches the partial abbreviation
            if (my_partial_option === '' || 
                my_min_abbrev.toLowerCase().startsWith(my_partial_option.toLowerCase())) {
                the_completions.push(
                    this.format_option_completion(my_option, my_min_abbrev, my_signature.allowsArbitraryOptions)
                );
            }
        }

        return the_completions;
    }

    /**
     * Get completions for a user program call.
     * Looks up the program signature and filters options by partial abbreviation.
     *
     * @param program_name - The name of the user program
     * @param document - The document state
     * @param position - The cursor position for extracting partial option
     * @returns Array of completion items for the program's options
     */
    get_completions_for_user_program_call(
        program_name: string,
        document: DocumentState,
        position: Position
    ): CompletionItem[] {
        const the_completions: CompletionItem[] = [];

        // Look up program in symbol table
        const my_program = document.symbols.programs.get(program_name);
        if (!my_program || !my_program.signature) {
            return the_completions;
        }

        const my_signature = my_program.signature;

        // Extract partial option being typed
        const my_partial_option = this.get_partial_option_at_position(document, position);

        // Get all options from the signature
        const my_options = my_signature.options;

        // Compute disambiguated abbreviations across all options
        const my_abbrev_map = this.compute_disambiguated_abbreviations(my_options);

        // Filter options by partial abbreviation and format completions
        for (const my_option of my_options) {
            const my_min_abbrev = my_abbrev_map.get(my_option.name) || my_option.minAbbreviation;

            // Check if option matches the partial abbreviation
            if (my_partial_option === '' || 
                my_min_abbrev.toLowerCase().startsWith(my_partial_option.toLowerCase())) {
                the_completions.push(
                    this.format_option_completion(my_option, my_min_abbrev, my_signature.allowsArbitraryOptions)
                );
            }
        }

        return the_completions;
    }

    /**
     * Extract the partial option being typed at the cursor position.
     * Returns the text after the last comma (or space if no comma).
     *
     * @param document - The document state
     * @param position - The cursor position
     * @returns The partial option text
     */
    private get_partial_option_at_position(document: DocumentState, position: Position): string {
        if (position.line >= get_line_count(document)) {
            return '';
        }

        const current_line = get_line_text(document, position.line);
        const text_before_cursor = current_line.substring(0, position.character);

        // Find the last comma
        let last_comma_pos = -1;
        let paren_depth = 0;
        let bracket_depth = 0;

        for (let i = 0; i < text_before_cursor.length; i++) {
            const char = text_before_cursor[i];

            if (char === '(') paren_depth++;
            if (char === ')') paren_depth--;
            if (char === '[') bracket_depth++;
            if (char === ']') bracket_depth--;

            if (char === ',' && paren_depth === 0 && bracket_depth === 0) {
                last_comma_pos = i;
            }
        }

        // Extract text after the last comma (or from start if no comma)
        const start_pos = last_comma_pos >= 0 ? last_comma_pos + 1 : 0;
        const partial_text = text_before_cursor.substring(start_pos).trim();

        // Extract the word being typed (alphanumeric + underscore)
        let word_start = partial_text.length;
        while (word_start > 0) {
            const char = partial_text[word_start - 1];
            if (!/[a-zA-Z0-9_]/.test(char)) {
                break;
            }
            word_start--;
        }

        return partial_text.substring(word_start);
    }

    /**
     * Compute disambiguated abbreviations for a set of options.
     * Increases abbreviation length until each option has a unique abbreviation.
     *
     * @param options - The options to compute abbreviations for
     * @returns Map of option name to disambiguated abbreviation
     */
    private compute_disambiguated_abbreviations(
        options: OptionSpec[]
    ): Map<string, string> {
        const my_abbrev_map = new Map<string, string>();

        // Start with minimum abbreviations
        for (const my_option of options) {
            my_abbrev_map.set(my_option.name, my_option.minAbbreviation);
        }

        // Check for conflicts and widen abbreviations as needed
        let has_conflicts = true;
        let abbrev_length = 1;

        while (has_conflicts && abbrev_length <= 50) {
            has_conflicts = false;
            const abbrev_counts = new Map<string, number>();

            // Count occurrences of each abbreviation
            for (const my_option of options) {
                const my_abbrev = my_option.name.substring(0, abbrev_length).toLowerCase();
                abbrev_counts.set(my_abbrev, (abbrev_counts.get(my_abbrev) || 0) + 1);
            }

            // Update abbreviations for conflicting options
            for (const my_option of options) {
                const my_abbrev = my_option.name.substring(0, abbrev_length).toLowerCase();
                if (abbrev_counts.get(my_abbrev)! > 1) {
                    has_conflicts = true;
                    my_abbrev_map.set(my_option.name, my_abbrev);
                }
            }

            abbrev_length++;
        }

        // If still conflicts, use full names
        if (has_conflicts) {
            for (const my_option of options) {
                my_abbrev_map.set(my_option.name, my_option.name);
            }
        }

        return my_abbrev_map;
    }

    /**
     * Format an option as a completion item.
     * Includes description, placeholders for arguments, and required/optional differentiation.
     *
     * @param option - The option specification
     * @param min_abbrev - The minimum abbreviation for this option
     * @param allows_arbitrary - Whether the program allows arbitrary options
     * @returns Formatted completion item
     */
    format_option_completion(
        option: OptionSpec,
        min_abbrev: string,
        _allows_arbitrary: boolean
    ): CompletionItem {
        // Generate description from type
        const my_description = this.generate_option_description(option);

        // Determine insert text (with placeholders if has argument)
        let my_insert_text = option.name;
        if (option.argumentType) {
            my_insert_text = `${option.name}()`;
        }

        // Create completion item
        const my_completion: CompletionItem = {
            label: option.name,
            kind: CompletionItemKind.Property,
            detail: my_description,
            insertText: my_insert_text,
            documentation: this.generate_option_documentation(option, min_abbrev),
            sortText: (option.isRequired ? '0' : '1') + option.name,
        };

        return my_completion;
    }

    /**
     * Generate a description for an option based on its type.
     *
     * @param option - The option specification
     * @returns Description string
     */
    private generate_option_description(option: OptionSpec): string {
        let my_description = '';

        if (option.isRequired) {
            my_description += '[Required] ';
        }

        if (option.argumentType) {
            const my_type_desc = this.get_type_description(option.argumentType);
            my_description += my_type_desc;

            if (option.defaultValue) {
                my_description += ` (default: ${option.defaultValue})`;
            }
        } else {
            my_description += 'Boolean option';
        }

        return my_description;
    }

    /**
     * Get a human-readable description for an argument type.
     *
     * @param type - The argument type
     * @returns Description string
     */
    private get_type_description(type: string): string {
        const type_descriptions: Record<string, string> = {
            'real': 'numeric value',
            'integer': 'integer value',
            'string': 'string value',
            'varlist': 'variable list',
            'varname': 'variable name',
            'name': 'name',
            'filename': 'filename',
            'numlist': 'number list',
            'passthru': 'pass-through argument',
        };

        return type_descriptions[type] || type;
    }

    /**
     * Generate documentation for an option.
     *
     * @param option - The option specification
     * @param min_abbrev - The minimum abbreviation
     * @returns Documentation object
     */
    private generate_option_documentation(
        option: OptionSpec,
        min_abbrev: string
    ): { kind: 'markdown'; value: string } {
        let my_doc = `**Option:** \`${option.name}\`\n\n`;

        if (min_abbrev !== option.name) {
            my_doc += `**Abbreviation:** \`${min_abbrev}\`\n\n`;
        }

        if (option.isRequired) {
            my_doc += '**Required:** Yes\n\n';
        }

        if (option.argumentType) {
            const my_type_desc = this.get_type_description(option.argumentType);
            my_doc += `**Type:** ${my_type_desc}\n\n`;

            if (option.defaultValue) {
                my_doc += `**Default:** \`${option.defaultValue}\`\n\n`;
            }
        }

        return {
            kind: 'markdown',
            value: my_doc,
        };
    }

    private annotate_symbol_map<T extends object>(
        symbols: Map<string, T>,
        scope_depth: number,
        directive_type: 'done-by' | 'included-by' | 'current',
    ): Map<string, T> {
        return new Map(
            Array.from(symbols.entries()).map(([name, symbol]) => [
                name,
                {
                    ...symbol,
                    scope_depth,
                    directive_type,
                } as T,
            ]),
        );
    }

    /**
     * Apply annotations from `annotated_overlay` onto entries in `visible`
     * whose winning `sourceUri` matches. `get_visible_symbols_at` already
     * resolves forward-call precedence, so we must NOT re-merge the overlay on
     * top — that would let forward-call symbols win a second time. Instead we
     * keep the visible map as-is and only copy `scope_depth` / `directive_type`
     * onto the entries where the forward-call version was the winner.
     * Produces new wrapper objects; never mutates shared symbols.
     */
    private copy_forward_annotations(
        visible: SymbolTable,
        annotated_overlay: SymbolTable,
    ): SymbolTable {
        type AnnotatedLike = {
            sourceUri?: string;
            scope_depth?: number;
            directive_type?: 'done-by' | 'included-by' | 'current';
        };
        const copy_kind = <T extends { sourceUri?: string }>(
            visible_map: Map<string, T>,
            overlay_map: Map<string, T>,
        ): Map<string, T> => {
            const the_result = new Map<string, T>();
            for (const [my_name, my_symbol] of visible_map) {
                const overlay_symbol = overlay_map.get(my_name) as T & AnnotatedLike | undefined;
                if (
                    overlay_symbol &&
                    overlay_symbol.sourceUri === my_symbol.sourceUri &&
                    (overlay_symbol.scope_depth !== undefined ||
                        overlay_symbol.directive_type !== undefined)
                ) {
                    the_result.set(my_name, {
                        ...my_symbol,
                        scope_depth: overlay_symbol.scope_depth,
                        directive_type: overlay_symbol.directive_type,
                    } as T);
                } else {
                    the_result.set(my_name, my_symbol);
                }
            }
            return the_result;
        };
        return {
            programs: copy_kind(visible.programs, annotated_overlay.programs),
            localMacros: copy_kind(visible.localMacros, annotated_overlay.localMacros),
            globalMacros: copy_kind(visible.globalMacros, annotated_overlay.globalMacros),
            variables: copy_kind(visible.variables, annotated_overlay.variables),
            scalars: copy_kind(visible.scalars, annotated_overlay.scalars),
            matrices: copy_kind(visible.matrices, annotated_overlay.matrices),
        };
    }

    private get_annotated_visible_forward_symbols(
        resolved_scope: ResolvedScope | undefined,
        cursor_line: number,
    ): SymbolTable {
        let the_result = create_empty_symbol_table();
        const current_file_symbols = resolved_scope && resolved_scope.chain.length > 0
            ? resolved_scope.chain[0].symbols
            : undefined;

        for (const my_call_site of get_visible_forward_call_sites(
            resolved_scope,
            cursor_line,
        )) {
            const directive_type = map_effective_type_to_directive(
                my_call_site.effective_type,
            );
            const filtered_site_symbols = filter_forward_site_symbols(
                my_call_site.symbols,
                current_file_symbols,
                my_call_site.call_line,
                cursor_line,
            );
            const annotated_symbols: SymbolTable = {
                programs: this.annotate_symbol_map(
                    filtered_site_symbols.programs,
                    1,
                    directive_type,
                ),
                localMacros: my_call_site.effective_type === 'include'
                    ? this.annotate_symbol_map(
                        filtered_site_symbols.localMacros,
                        1,
                        directive_type,
                    )
                    : new Map(),
                globalMacros: this.annotate_symbol_map(
                    filtered_site_symbols.globalMacros,
                    1,
                    directive_type,
                ),
                variables: this.annotate_symbol_map(
                    filtered_site_symbols.variables,
                    1,
                    directive_type,
                ),
                scalars: this.annotate_symbol_map(
                    filtered_site_symbols.scalars,
                    1,
                    directive_type,
                ),
                matrices: this.annotate_symbol_map(
                    filtered_site_symbols.matrices,
                    1,
                    directive_type,
                ),
            };

            the_result = merge_symbol_tables(the_result, annotated_symbols);
        }

        return the_result;
    }

    private get_completion_symbol_provenance(
        symbol: { sourceUri: string },
        document_uri: string,
        resolved_scope?: ResolvedScope,
    ): {
        depth: number;
        directive_type: 'done-by' | 'included-by' | 'current';
        source_path?: string;
    } {
        let depth = 0;
        let directive_type: 'done-by' | 'included-by' | 'current' = 'current';
        let show_source = false;

        // Narrow type for annotated symbols with optional metadata
        type AnnotatedSymbol = {
            sourceUri: string;
            scope_depth?: number;
            directive_type?: 'current' | 'included-by' | 'done-by';
        };
        const annotated = symbol as AnnotatedSymbol;

        if (resolved_scope && symbol.sourceUri !== document_uri) {
            const symbol_info = this.get_symbol_depth(symbol.sourceUri, resolved_scope);
            depth = symbol_info.depth;
            directive_type = symbol_info.directive_type;
            show_source = true;
        }

        if (
            typeof annotated.scope_depth === 'number' &&
            (depth === 0 || depth === 999 || !resolved_scope)
        ) {
            depth = annotated.scope_depth;
        }

        if (
            annotated.directive_type === 'current' ||
            annotated.directive_type === 'included-by' ||
            annotated.directive_type === 'done-by'
        ) {
            directive_type = annotated.directive_type;
            show_source = symbol.sourceUri !== document_uri;
        }

        return {
            depth,
            directive_type,
            source_path: show_source && symbol.sourceUri !== document_uri
                ? this.get_relative_path(symbol.sourceUri)
                : undefined,
        };
    }

    /**
     * Get the depth and directive type of a symbol in the resolved scope chain.
     * Returns depth (0 for current file) and directive type.
     */
    private get_symbol_depth(symbol_uri: string, resolved_scope: ResolvedScope): { depth: number; directive_type: 'done-by' | 'included-by' | 'current' } {
        for (const entry of resolved_scope.chain) {
            if (entry.uri === symbol_uri) {
                return { 
                    depth: entry.depth, 
                    directive_type: entry.depth === 0 ? 'current' : entry.directive_type 
                };
            }
        }
        return { depth: 999, directive_type: 'done-by' }; // Unknown/distant
    }

    /**
     * Get a relative path for display in completion details.
     * Extracts just the filename for brevity.
     */
    private get_relative_path(uri: string): string {
        try {
            const path_parts = uri.split('/');
            return path_parts[path_parts.length - 1] || uri;
        } catch {
            return uri;
        }
    }

    /**
     * Get the argument local name mapping for a program signature.
     * Maps argument types to their implicit local macro names.
     */
    private get_argument_local_name(arg: ArgumentSpec): string | null {
        if (!arg || !arg.type) {
            return null;
        }
        if (arg.type === 'anything' && arg.name) {
            return arg.name;
        }
        return arg.type;
    }

    /**
     * Extract program arguments from a program signature.
     * Returns the implicit local macros created by the syntax command.
     */
    private extract_program_arguments(signature: ProgramSignature): string[] {
        const the_arguments: string[] = [];
        
        for (const arg of signature.arguments) {
            const local_name = this.get_argument_local_name(arg);
            if (local_name) {
                the_arguments.push(local_name);
            }
        }
        
        return the_arguments;
    }

    /**
     * Detect if cursor is inside a program body.
     * Returns the program node if found, null otherwise.
     */
    private detect_cursor_in_program_body(
        document: DocumentState,
        position: Position
    ): ProgramNode | null {
        if (!document.ast) {
            return null;
        }

        return this.find_program_containing_position(document.ast.nodes, position);
    }

    /**
     * Recursively search for program containing the given position.
     */
    private find_program_containing_position(
        nodes: StataNode[],
        position: Position
    ): ProgramNode | null {
        for (const node of nodes) {
            if (node.type === 'program') {
                // Check if position is within program body (not just the program declaration)
                if (this.is_position_in_program_body(position, node)) {
                    return node;
                }
            }
            
            // Recurse into nested structures
            if (node.type === 'if' || node.type === 'else' || 
                node.type === 'foreach' || node.type === 'forvalues' || 
                node.type === 'while' || node.type === 'frame') {
                const result = this.find_program_containing_position(node.body, position);
                if (result) return result;
            }
        }
        
        return null;
    }

    /**
     * Check if position is within a program's body (not the declaration line).
     */
    private is_position_in_program_body(position: Position, program: ProgramNode): boolean {
        // Position must be within program range
        if (!is_position_in_range(position, program.range)) {
            return false;
        }
        
        // Position must be after the program declaration line
        if (position.line <= program.range.start.line) {
            return false;
        }
        
        return true;
    }
}
