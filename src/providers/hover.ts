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
    CancellationToken,
} from 'vscode-languageserver';
import { URI } from 'vscode-uri';
import * as path from 'path';
import { DocumentState } from '../document-store';
import { CommandDatabase } from '../command-database';
import {
    StataNode,
    CommandNode,
    MacroRefNode,
    SymbolTable,
    Token,
    IdentifierNode,
    ProgramSignature,
    OptionSpec,
    ArgumentSpec,
    ResolvedScope,
    ScopeResolverConfig,
} from '../types';
import { IContextTracker } from '../context-tracker/types';
import { LanguageContext } from '../context-tracker/types';
import { ScopeResolver } from '../scope-resolver';
import { build_scope_resolver_config } from '../scope-resolver';
import { get_line_text } from '../utils/line-utils';

const MARKDOWN_TEXT_ESCAPE_PATTERN =
    /([\\`*_{}\[\]()#+\-.!|])/g;

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
        workspace_root?: string
    ): Promise<Hover | null> {
        // Check cancellation before starting (Req 5.1)
        if (cancellation_token?.isCancellationRequested) {
            return null;
        }

        // Use context tracker from document state if available
        if (!this.context_tracker && document.context_tracker) {
            this.context_tracker = document.context_tracker;
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

        // Check if we're in option context BEFORE checking for commands
        const option_context = this.is_in_option_context(document, position);
        if (option_context.in_option_context) {
            // Try to get option hover
            const option_hover = this.get_option_hover(option_context.command_name, word);
            if (option_hover) {
                return { contents: option_hover, range };
            }
            // Don't fall through to command lookup
            return null;
        }

        // Check for block delimiter hover (works in any context)
        const delimiter_hover = this.get_block_delimiter_hover(word, my_context, document, position);
        if (delimiter_hover) {
            return { contents: delimiter_hover, range };
        }

        // In embedded language context, only check for macros (suppress other Stata-specific hover)
        if (my_context !== LanguageContext.STATA) {
            // Macros work in all contexts - check local and global macros only
            const local_macro_content = this.get_local_macro_hover(document, word, resolved_scope, workspace_root, position);
            if (local_macro_content) {
                return { contents: local_macro_content, range };
            }
            const global_macro_content = this.get_global_macro_hover(document, word, workspace_symbols, resolved_scope, workspace_root, position);
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
            workspace_root
        );

        // If we have symbol matches, format and return them
        if (the_symbol_matches.length > 0) {
            const formatted_content = this.format_multi_symbol_hover(the_symbol_matches);
            return { contents: formatted_content, range };
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
        word: string
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
        workspace_root?: string
    ): SymbolMatch[] {
        // Check for out-of-scope symbol matching the reference type
        const reference_type = this.get_reference_type_from_context(document, position, word);
        const out_of_scope_match = this.get_out_of_scope_hover(
            word, reference_type, resolved_scope, document.uri, workspace_root
        );
        if (out_of_scope_match) {
            return [out_of_scope_match];
        }

        const the_matches: SymbolMatch[] = [];

        // When reference type is explicit (local or global macro syntax), only check that type
        // When reference type is 'other' (bare identifier), check all symbol types

        // 1. Check local macros - only if reference is local macro or bare identifier
        if (reference_type === 'local_macro' || reference_type === 'other') {
            const local_macro_content = this.get_local_macro_hover(document, word, resolved_scope, workspace_root, position);
            if (local_macro_content) {
                the_matches.push({ type: 'local_macro', content: local_macro_content });
            }
        }

        // 2. Check global macros - only if reference is global macro or bare identifier
        if (reference_type === 'global_macro' || reference_type === 'other') {
            const global_macro_content = this.get_global_macro_hover(document, word, workspace_symbols, resolved_scope, workspace_root, position);
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
        const program_content = this.get_program_hover(document, word, workspace_symbols, resolved_scope, workspace_root, position);
        if (program_content) {
            the_matches.push({ type: 'program', content: program_content });
        }

        // 4. Check scalars (only for bare identifiers)
        const scalar_content = this.get_scalar_hover(document, word, workspace_symbols, resolved_scope, workspace_root, position);
        if (scalar_content) {
            the_matches.push({ type: 'scalar', content: scalar_content });
        }

        // 5. Check matrices (only for bare identifiers)
        const matrix_content = this.get_matrix_hover(document, word, workspace_symbols, resolved_scope, workspace_root, position);
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
     * Get visible forward call symbols at a given position.
     * Symbols from forward calls are only visible AFTER the call site line.
     *
     * @param resolved_scope - The resolved scope containing forward_call_symbols
     * @param position - The cursor position
     * @returns Array of ForwardCallSite objects that are visible at the position
     */
    private get_visible_forward_call_sites(
        resolved_scope: ResolvedScope | undefined,
        position: Position
    ): import('../types').ForwardCallSite[] {
        if (!resolved_scope?.forward_call_symbols) {
            return [];
        }

        // Filter to only include call sites where cursor is AFTER the call line
        // Symbols become visible after the call site line (cursor_line > call_line)
        return resolved_scope.forward_call_symbols.filter(
            call_site => position.line > call_site.call_line
        );
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
        position?: Position
    ): MarkupContent | null {
        // Check resolved scope first if available
        if (resolved_scope) {
            const local_macro = resolved_scope.symbols.localMacros.get(word);
            if (local_macro) {
                const source_link = this.format_source_link(local_macro.sourceUri, document.uri, workspace_root);
                const line_info = local_macro.definition_line !== undefined ? `, line ${local_macro.definition_line + 1}` : '';
                const source_info = source_link
                    ? `\n\nSource: ${source_link}${line_info}`
                    : `\n\nDefined at: this file${line_info}`;
                // Use inline code for short values, code block for multi-line
                const expansion_text = local_macro.value
                    ? (local_macro.value.includes('\n')
                        ? `\n\nExpansion:\n\`\`\`\n${local_macro.value}\n\`\`\``
                        : `\n\nExpansion: \`${local_macro.value}\``)
                    : '';
                return {
                    kind: MarkupKind.Markdown,
                    value: `**Local Macro:** \`${word}\`${source_info}${expansion_text}`,
                };
            }

            // Check forward call symbols with position filtering
            // Only include symbols where cursor line > call_line (visible AFTER call site)
            if (position && resolved_scope.forward_call_symbols) {
                const the_visible_call_sites = this.get_visible_forward_call_sites(resolved_scope, position);
                for (const my_call_site of the_visible_call_sites) {
                    // For 'include' type, local macros are visible; for 'do' type, they are not
                    if (my_call_site.effective_type === 'include') {
                        const forward_local_macro = my_call_site.symbols.localMacros.get(word);
                        if (forward_local_macro) {
                            const source_link = this.format_source_link(forward_local_macro.sourceUri, document.uri, workspace_root);
                            const line_info = forward_local_macro.definition_line !== undefined ? `, line ${forward_local_macro.definition_line + 1}` : '';
                            const source_info = source_link
                                ? `\n\nSource: ${source_link}${line_info}`
                                : `\n\nDefined at: this file${line_info}`;
                            const expansion_text = forward_local_macro.value
                                ? (forward_local_macro.value.includes('\n')
                                    ? `\n\nExpansion:\n\`\`\`\n${forward_local_macro.value}\n\`\`\``
                                    : `\n\nExpansion: \`${forward_local_macro.value}\``)
                                : '';
                            return {
                                kind: MarkupKind.Markdown,
                                value: `**Local Macro:** \`${word}\`${source_info}${expansion_text}`,
                            };
                        }
                    }
                }
            }
        }

        // Fallback to document symbols
        const local_macro = document.symbols.localMacros.get(word);
        if (local_macro) {
            const source_link = this.format_source_link(local_macro.sourceUri, document.uri, workspace_root);
            const line_info = local_macro.definition_line !== undefined ? `, line ${local_macro.definition_line + 1}` : '';
            const source_info = source_link
                ? `\n\nSource: ${source_link}${line_info}`
                : `\n\nDefined at: this file${line_info}`;
            // Use inline code for short values, code block for multi-line
            const expansion_text = local_macro.value
                ? (local_macro.value.includes('\n')
                    ? `\n\nExpansion:\n\`\`\`\n${local_macro.value}\n\`\`\``
                    : `\n\nExpansion: \`${local_macro.value}\``)
                : '';
            return {
                kind: MarkupKind.Markdown,
                value: `**Local Macro:** \`${word}\`${source_info}${expansion_text}`,
            };
        }

        return null;
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
        position?: Position
    ): MarkupContent | null {
        // Check resolved scope first if available
        if (resolved_scope) {
            const global_macro = resolved_scope.symbols.globalMacros.get(word);
            if (global_macro) {
                const source_link = this.format_source_link(global_macro.sourceUri, document.uri, workspace_root);
                const line_info = global_macro.definition_line !== undefined ? `, line ${global_macro.definition_line + 1}` : '';
                const source_info = source_link
                    ? `\n\nSource: ${source_link}${line_info}`
                    : `\n\nDefined at: this file${line_info}`;
                // Use inline code for short values, code block for multi-line
                const expansion_text = global_macro.value
                    ? (global_macro.value.includes('\n')
                        ? `\n\nExpansion:\n\`\`\`\n${global_macro.value}\n\`\`\``
                        : `\n\nExpansion: \`${global_macro.value}\``)
                    : '';
                return {
                    kind: MarkupKind.Markdown,
                    value: `**Global Macro:** \`${word}\`${source_info}${expansion_text}`,
                };
            }

            // Check forward call symbols with position filtering
            // Global macros are visible from both 'do' and 'include' types
            if (position && resolved_scope.forward_call_symbols) {
                const the_visible_call_sites = this.get_visible_forward_call_sites(resolved_scope, position);
                for (const my_call_site of the_visible_call_sites) {
                    const forward_global_macro = my_call_site.symbols.globalMacros.get(word);
                    if (forward_global_macro) {
                        const source_link = this.format_source_link(forward_global_macro.sourceUri, document.uri, workspace_root);
                        const line_info = forward_global_macro.definition_line !== undefined ? `, line ${forward_global_macro.definition_line + 1}` : '';
                        const source_info = source_link
                            ? `\n\nSource: ${source_link}${line_info}`
                            : `\n\nDefined at: this file${line_info}`;
                        const expansion_text = forward_global_macro.value
                            ? (forward_global_macro.value.includes('\n')
                                ? `\n\nExpansion:\n\`\`\`\n${forward_global_macro.value}\n\`\`\``
                                : `\n\nExpansion: \`${forward_global_macro.value}\``)
                            : '';
                        return {
                            kind: MarkupKind.Markdown,
                            value: `**Global Macro:** \`${word}\`${source_info}${expansion_text}`,
                        };
                    }
                }
            }
        }

        // Fallback to document symbols then workspace symbols
        const global_macro = document.symbols.globalMacros.get(word) || workspace_symbols?.globalMacros.get(word);
        if (global_macro) {
            const source_link = this.format_source_link(global_macro.sourceUri, document.uri, workspace_root);
            const line_info = global_macro.definition_line !== undefined ? `, line ${global_macro.definition_line + 1}` : '';
            const source_info = source_link
                ? `\n\nSource: ${source_link}${line_info}`
                : `\n\nDefined at: this file${line_info}`;
            // Use inline code for short values, code block for multi-line
            const expansion_text = global_macro.value
                ? (global_macro.value.includes('\n')
                    ? `\n\nExpansion:\n\`\`\`\n${global_macro.value}\n\`\`\``
                    : `\n\nExpansion: \`${global_macro.value}\``)
                : '';
            return {
                kind: MarkupKind.Markdown,
                value: `**Global Macro:** \`${word}\`${source_info}${expansion_text}`,
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
        position?: Position
    ): MarkupContent | null {
        // 1. Check resolved_scope first (highest precedence)
        if (resolved_scope) {
            const scalar = resolved_scope.symbols.scalars.get(word);
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

            // Check forward call symbols with position filtering
            if (position && resolved_scope.forward_call_symbols) {
                const the_visible_call_sites = this.get_visible_forward_call_sites(resolved_scope, position);
                for (const my_call_site of the_visible_call_sites) {
                    const forward_scalar = my_call_site.symbols.scalars.get(word);
                    if (forward_scalar) {
                        const source_link = this.format_source_link(forward_scalar.sourceUri, document.uri, workspace_root);
                        const line_info = forward_scalar.definition_line !== undefined ? `, line ${forward_scalar.definition_line + 1}` : '';
                        const source_info = source_link
                            ? `\n\nSource: ${source_link}${line_info}`
                            : `\n\nDefined at: this file${line_info}`;
                        return {
                            kind: MarkupKind.Markdown,
                            value: `**Scalar:** \`${word}\`${source_info}`,
                        };
                    }
                }
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
            return {
                kind: MarkupKind.Markdown,
                value: `**Scalar:** \`${word}\`${source_info}`,
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
                return {
                    kind: MarkupKind.Markdown,
                    value: `**Scalar:** \`${word}\`${source_info}`,
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
        position?: Position
    ): MarkupContent | null {
        // 1. Check resolved_scope first (highest precedence)
        if (resolved_scope) {
            const matrix = resolved_scope.symbols.matrices.get(word);
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

            // Check forward call symbols with position filtering
            if (position && resolved_scope.forward_call_symbols) {
                const the_visible_call_sites = this.get_visible_forward_call_sites(resolved_scope, position);
                for (const my_call_site of the_visible_call_sites) {
                    const forward_matrix = my_call_site.symbols.matrices.get(word);
                    if (forward_matrix) {
                        const source_link = this.format_source_link(forward_matrix.sourceUri, document.uri, workspace_root);
                        const line_info = forward_matrix.definition_line !== undefined ? `, line ${forward_matrix.definition_line + 1}` : '';
                        const source_info = source_link
                            ? `\n\nSource: ${source_link}${line_info}`
                            : `\n\nDefined at: this file${line_info}`;
                        return {
                            kind: MarkupKind.Markdown,
                            value: `**Matrix:** \`${word}\`${source_info}`,
                        };
                    }
                }
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
            return {
                kind: MarkupKind.Markdown,
                value: `**Matrix:** \`${word}\`${source_info}`,
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
                return {
                    kind: MarkupKind.Markdown,
                    value: `**Matrix:** \`${word}\`${source_info}`,
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
     * Token-based subcommand context detection.
     * Finds the hovered token and checks if the previous non-trivia token is a prefix command.
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
        const tokens = document.tokens!;
        const STANDARD_PREFIXES = ['by', 'bysort', 'quietly', 'capture', 'noisily', 'qui', 'cap', 'noi'];
        const TRIVIA_TYPES = ['WHITESPACE', 'COMMENT_LINE', 'COMMENT_BLOCK', 'CONTINUATION'];

        // Find the token at the hovered position
        let hovered_token_index = -1;
        for (let i = 0; i < tokens.length; i++) {
            if (i % 500 === 0 && cancellation_token?.isCancellationRequested) {
                return { is_subcommand: false, prefix_command: null };
            }
            const token = tokens[i];
            if (token.range.start.line === position.line &&
                token.range.start.character <= position.character &&
                token.range.end.character >= position.character &&
                token.type === 'WORD' &&
                token.value.toLowerCase() === hovered_word.toLowerCase()) {
                hovered_token_index = i;
                break;
            }
        }

        if (hovered_token_index === -1) {
            return { is_subcommand: false, prefix_command: null };
        }

        // Find the start of the current statement (after last STATEMENT_TERMINATOR or start of file)
        let statement_start_index = 0;
        for (let i = hovered_token_index - 1; i >= 0; i--) {
            if (tokens[i].type === 'STATEMENT_TERMINATOR') {
                statement_start_index = i + 1;
                break;
            }
        }

        // Collect non-trivia WORD tokens from statement start to hovered token
        const the_statement_words: { value: string; index: number }[] = [];
        for (let i = statement_start_index; i <= hovered_token_index; i++) {
            const token = tokens[i];
            if (token.type === 'WORD' && !TRIVIA_TYPES.includes(token.type)) {
                the_statement_words.push({ value: token.value.toLowerCase(), index: i });
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

        // Handle "by varlist:" pattern - skip to after colon
        // Check if there's a colon between command_word_index and hovered token
        let found_colon = false;
        for (let i = the_statement_words[command_word_index].index; i < hovered_token_index; i++) {
            if (tokens[i].type === 'COLON') {
                found_colon = true;
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

        // The word at command_word_index should be the prefix command
        const potential_prefix = the_statement_words[command_word_index].value;

        // Check if this command has subcommands using the database
        if (!this.command_db.has_subcommands(potential_prefix)) {
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

        // Verify the hovered word is a valid subcommand
        const subcommands = this.command_db.get_subcommands(potential_prefix);
        if (!subcommands) {
            return { is_subcommand: false, prefix_command: null };
        }

        const is_valid_subcommand = subcommands.some(
            sub => sub.name.toLowerCase() === hovered_word.toLowerCase()
        );

        if (!is_valid_subcommand) {
            return { is_subcommand: false, prefix_command: null };
        }

        return { is_subcommand: true, prefix_command: potential_prefix };
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
        if (!word_info || word_info.word.toLowerCase() !== hovered_word.toLowerCase()) {
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

        // Skip standard prefix commands (by, quietly, capture, etc.)
        const standard_prefixes = ['by', 'bysort', 'quietly', 'capture', 'noisily', 'qui', 'cap', 'noi'];
        let command_index = 0;
        while (command_index < tokens_before.length &&
               standard_prefixes.includes(tokens_before[command_index].toLowerCase())) {
            command_index++;
        }

        // Handle "by varlist:" pattern
        if (text_before_hovered.includes(':')) {
            const after_colon = text_before_hovered.split(':').pop()?.trim() || '';
            const words_after_colon = after_colon.split(/\s+/).filter(t => t.length > 0);
            if (words_after_colon.length > 0) {
                // Reset to check words after colon
                const potential_prefix = words_after_colon[0].toLowerCase();
                if (this.command_db.has_subcommands(potential_prefix) && words_after_colon.length === 1) {
                    const subcommands = this.command_db.get_subcommands(potential_prefix);
                    const is_valid = subcommands?.some(
                        sub => sub.name.toLowerCase() === hovered_word.toLowerCase()
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

        // The token at command_index should be the prefix command
        const potential_prefix = tokens_before[command_index].toLowerCase();

        // Check if this command has subcommands using the database
        if (!this.command_db.has_subcommands(potential_prefix)) {
            return { is_subcommand: false, prefix_command: null };
        }

        // Verify the hovered word is immediately after the prefix command
        if (command_index !== tokens_before.length - 1) {
            return { is_subcommand: false, prefix_command: null };
        }

        // Verify the hovered word is a valid subcommand
        const subcommands = this.command_db.get_subcommands(potential_prefix);
        if (!subcommands) {
            return { is_subcommand: false, prefix_command: null };
        }

        const is_valid_subcommand = subcommands.some(
            sub => sub.name.toLowerCase() === hovered_word.toLowerCase()
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

        const prefix = context.prefix_command.toLowerCase();
        const subcommand = word.toLowerCase();

        // Get subcommand from command database
        const subcommands = this.command_db.get_subcommands(prefix);
        if (subcommands) {
            const sub = subcommands.find(s => s.name.toLowerCase() === subcommand);
            if (sub) {
                // Capitalize prefix name for display
                const prefix_display = prefix.charAt(0).toUpperCase() + prefix.slice(1);
                return {
                    kind: MarkupKind.Markdown,
                    value: `**${prefix_display} Subcommand:** \`${sub.name}\`\n\nSubcommand of \`${prefix}\`.\n\nSee Stata documentation: \`help ${prefix} ${sub.name}\``
                };
            }
        }

        return null;
    }

    /**
     * Check if a position is in option context (after a comma).
     */
    private is_in_option_context(
        document: DocumentState,
        position: Position
    ): { in_option_context: boolean; command_name: string | null } {
        const line = get_line_text(document, position.line);
        if (line === '') {
            return { in_option_context: false, command_name: null };
        }
        const text_before_cursor = line.substring(0, position.character);

        // Find last comma not inside quotes or parentheses
        let last_comma_pos = -1;
        let in_quotes = false;
        let paren_depth = 0;
        let quote_char = '';

        for (let i = 0; i < text_before_cursor.length; i++) {
            const char = text_before_cursor[i];

            if (!in_quotes) {
                if (char === '"' || char === "'") {
                    in_quotes = true;
                    quote_char = char;
                } else if (char === '(') {
                    paren_depth++;
                } else if (char === ')') {
                    paren_depth--;
                } else if (char === ',' && paren_depth === 0) {
                    last_comma_pos = i;
                }
            } else {
                if (char === quote_char) {
                    in_quotes = false;
                    quote_char = '';
                }
            }
        }

        if (last_comma_pos >= 0) {
            const text_before_comma = text_before_cursor.substring(0, last_comma_pos);
            const command_name = this.extract_command_name(text_before_comma);
            return { in_option_context: true, command_name };
        }

        return { in_option_context: false, command_name: null };
    }

    /**
     * Extract command name from text, handling prefixes and abbreviations.
     */
    private extract_command_name(text: string): string | null {
        const trimmed = text.trim();
        if (!trimmed) return null;

        // Split into tokens
        const tokens = trimmed.split(/\s+/);
        if (tokens.length === 0) return null;

        // Handle prefix commands
        const prefixes = ['by', 'bysort', 'quietly', 'capture', 'noisily', 'qui', 'cap', 'noi'];
        let command_index = 0;

        // Skip prefix commands
        while (command_index < tokens.length && prefixes.includes(tokens[command_index].toLowerCase())) {
            command_index++;
        }

        if (command_index >= tokens.length) return null;

        let command_name = tokens[command_index];

        // Handle colon syntax (e.g., "merge 1:m" -> "merge")
        if (command_name.includes(':')) {
            command_name = command_name.split(':')[0];
        }

        return command_name;
    }

    /**
     * Get hover information for an option.
     */
    private get_option_hover(command_name: string | null, option_name: string): MarkupContent | null {
        // Don't show hover for options
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
                const line_info = local_macro.definition_line !== undefined ? `, line ${local_macro.definition_line + 1}` : '';
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
                const line_info = global_macro.definition_line !== undefined ? `, line ${global_macro.definition_line + 1}` : '';
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
            const line_info = local_macro.definition_line !== undefined ? `, line ${local_macro.definition_line + 1}` : '';
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
            const line_info = global_macro.definition_line !== undefined ? `, line ${global_macro.definition_line + 1}` : '';
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
        position?: Position
    ): MarkupContent | null {
        // Check resolved scope first if available
        if (resolved_scope) {
            const program = resolved_scope.symbols.programs.get(word);
            if (program) {
                return this.get_hover_for_user_program(program.name, resolved_scope.symbols, document.uri, workspace_root);
            }

            // Check forward call symbols with position filtering
            // Programs are visible from both 'do' and 'include' types
            if (position && resolved_scope.forward_call_symbols) {
                const the_visible_call_sites = this.get_visible_forward_call_sites(resolved_scope, position);
                for (const my_call_site of the_visible_call_sites) {
                    const forward_program = my_call_site.symbols.programs.get(word);
                    if (forward_program) {
                        return this.get_hover_for_user_program(forward_program.name, my_call_site.symbols, document.uri, workspace_root);
                    }
                }
            }
        }

        // Fallback to original logic
        // Check document programs
        const program = document.symbols.programs.get(word);
        if (program) {
            return this.get_hover_for_user_program(program.name, document.symbols, document.uri, workspace_root);
        }

        // Check workspace programs
        if (workspace_symbols) {
            const ws_program = workspace_symbols.programs.get(word);
            if (ws_program) {
                return this.get_hover_for_user_program(ws_program.name, workspace_symbols, document.uri, workspace_root);
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
        const symbols: any = resolved_scope ? resolved_scope.symbols : (workspace_symbols || document.symbols);
        const scalars: Map<string, any> = symbols.scalars instanceof Map ? symbols.scalars : new Map();
        const matrices: Map<string, any> = symbols.matrices instanceof Map ? symbols.matrices : new Map();

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
        if (resolved_scope) {
            const variable = resolved_scope.symbols.variables.get(word);
            if (variable) {
                return this.format_variable_hover(variable, document.uri, workspace_root);
            }

            // Check forward call symbols with position filtering
            // Variables are visible from both 'do' and 'include' types
            if (position && resolved_scope.forward_call_symbols) {
                const the_visible_call_sites = this.get_visible_forward_call_sites(resolved_scope, position);
                for (const my_call_site of the_visible_call_sites) {
                    const forward_variable = my_call_site.symbols.variables.get(word);
                    if (forward_variable) {
                        return this.format_variable_hover(forward_variable, document.uri, workspace_root);
                    }
                }
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
            let hover_text = `**${command.name}**`;

            if (command.options && command.options.length > 0) {
                const option_names = command.options.map(opt => opt.name).join(', ');
                hover_text += `\n\n**Options:** ${option_names}`;
            }

            hover_text += `\n\nSee Stata documentation: \`help ${command.name}\``;

            return {
                kind: MarkupKind.Markdown,
                value: hover_text,
            };
        }

        // Try broadening the search to abbreviations
        const matches = this.command_db.expand_abbreviation(word);
        if (matches.length === 1) {
            const cmd = matches[0];

            let hover_text = `**${cmd.name}** (abbreviated as \`${word}\`)`;

            if (cmd.options && cmd.options.length > 0) {
                const option_names = cmd.options.map(opt => opt.name).join(', ');
                hover_text += `\n\n**Options:** ${option_names}`;
            }

            hover_text += `\n\nSee Stata documentation: \`help ${cmd.name}\``;

            return {
                kind: MarkupKind.Markdown,
                value: hover_text,
            };
        }

        return null;
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
        workspace_root?: string
    ): MarkupContent | null {
        // Check document programs first
        const program = workspace_symbols?.programs.get(program_name);
        if (!program) {
            return null;
        }

        const source_link = this.format_source_link(program.sourceUri, current_uri || '', workspace_root);

        // If program has a signature, format it
        if (program.signature) {
            const formatted_signature = this.format_signature_for_hover(program.signature);
            const source_info = source_link ? `**Source:** ${source_link}` : `**Defined at:** \`${program.sourceUri}\``;
            return {
                kind: MarkupKind.Markdown,
                value: `**Program:** \`${program.name}\`\n\n${formatted_signature}\n\n${source_info}`,
            };
        }

        // Fallback to basic program info if no signature
        const source_info = source_link ? `**Source:** ${source_link}` : `**Defined at:** \`${program.sourceUri}\``;
        return {
            kind: MarkupKind.Markdown,
            value: `**Program:** \`${program.name}\`\n\n${source_info}`,
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
        const optional_marker = arg.isOptional ? '[]' : '';

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
