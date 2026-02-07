/**
 * References Provider for Sight
 *
 * Provides find-references functionality for macros, programs, variables, and other symbols.
 * Context-aware: maintains symbol reference resolution across embedded language contexts.
 */

import {
    Location,
    Position,
    Range,
    ReferenceContext,
    CancellationToken,
} from 'vscode-languageserver';
import { DocumentState } from '../document-store';
import { LanguageContext, Token, ContextRange } from '../types';
import { get_line_text } from '../utils/line-utils';
import type { WorkspaceIndexer } from '../indexer';
import type { IContextTracker } from '../context-tracker/types';

export interface ReferenceSearchContext {
    symbol_name: string;
    symbol_type: 'local_macro' | 'global_macro' | 'program' | 'variable' | 'scalar' | 'matrix';
    include_declaration: boolean;
}

export interface TokenMatch {
    uri: string;
    range: Range;
}

export interface IdentifiedSymbol {
    name: string;
    type: 'local_macro' | 'global_macro' | 'program' | 'variable' | 'scalar' | 'matrix';
    range: Range;
}

export class ReferencesProvider {
    /**
     * Extract symbol name from local macro token value.
     * Strips backtick and quote from `name' format.
     */
    private extract_local_macro_name(token_value: string): string {
        if (token_value.startsWith('`') && token_value.endsWith("'")) {
            return token_value.slice(1, -1);
        }
        return token_value;
    }

    /**
     * Extract symbol name from global macro token value.
     * Strips $ and braces from $name or ${name} formats.
     */
    private extract_global_macro_name(token_value: string): string {
        if (token_value.startsWith('${') && token_value.endsWith('}')) {
            return token_value.slice(2, -1);
        }
        if (token_value.startsWith('$')) {
            return token_value.slice(1);
        }
        return token_value;
    }

    /**
     * Build a Set of line numbers that are within embedded language contexts.
     * O(m) preprocessing to enable O(1) lookup per token.
     */
    private build_embedded_context_lines(context_ranges?: ContextRange[]): Set<number> {
        const embedded_lines = new Set<number>();
        if (!context_ranges) return embedded_lines;

        for (const my_range of context_ranges) {
            if (my_range.context !== LanguageContext.STATA) {
                for (let line = my_range.range.start.line; line <= my_range.range.end.line; line++) {
                    embedded_lines.add(line);
                }
            }
        }
        return embedded_lines;
    }

    /**
     * Scan tokens in a file for references to a symbol.
     * 
     * @param tokens - Tokens from the file
     * @param uri - File URI
     * @param search_context - Symbol to search for
     * @param context_ranges - Embedded language context ranges (optional)
     * @returns Array of matching token locations
     */
    scan_tokens_for_references(
        tokens: Token[],
        uri: string,
        search_context: ReferenceSearchContext,
        context_ranges?: ContextRange[],
        cancellation_token?: CancellationToken
    ): TokenMatch[] {
        const matches: TokenMatch[] = [];
        const is_macro = search_context.symbol_type === 'local_macro' || 
                         search_context.symbol_type === 'global_macro';

        // Pre-build embedded context lookup for O(1) checks - avoids O(n*m)
        const embedded_lines = is_macro ? null : this.build_embedded_context_lines(context_ranges);

        for (let i = 0; i < tokens.length; i++) {
            // Periodic cancellation check (Req 5.3, 5.4)
            if (i % 500 === 0 && cancellation_token?.isCancellationRequested) {
                return matches;
            }

            const token = tokens[i];
            let token_name: string | null = null;

            // Extract name based on token type and search context
            switch (search_context.symbol_type) {
                case 'local_macro':
                    if (token.type === 'MACRO_REF_LOCAL') {
                        token_name = this.extract_local_macro_name(token.value);
                    }
                    break;
                case 'global_macro':
                    if (token.type === 'MACRO_REF_GLOBAL') {
                        token_name = this.extract_global_macro_name(token.value);
                    }
                    break;
                case 'program':
                case 'variable':
                case 'scalar':
                case 'matrix':
                    if (token.type === 'WORD') {
                        token_name = token.value;
                    }
                    break;
            }

            // Case-sensitive comparison
            if (token_name === search_context.symbol_name) {
                // For non-macro symbols, exclude matches in embedded contexts (O(1) lookup)
                if (embedded_lines && embedded_lines.has(token.range.start.line)) {
                    continue;
                }
                
                matches.push({
                    uri,
                    range: token.range
                });
            }
        }

        return matches;
    }

    /**
     * Find the definition location for a symbol.
     */
    private find_definition(
        document: DocumentState,
        symbol_name: string,
        symbol_type: 'local_macro' | 'global_macro' | 'program' | 'variable' | 'scalar' | 'matrix'
    ): Location | null {
        const symbols = document.symbols;
        
        switch (symbol_type) {
            case 'local_macro': {
                const local_macro = symbols.localMacros.get(symbol_name);
                return local_macro ? { uri: local_macro.location.uri, range: local_macro.location.range } : null;
            }
            case 'global_macro': {
                const global_macro = symbols.globalMacros.get(symbol_name);
                return global_macro ? { uri: global_macro.location.uri, range: global_macro.location.range } : null;
            }
            case 'program': {
                const program = symbols.programs.get(symbol_name);
                return program ? { uri: program.location.uri, range: program.location.range } : null;
            }
            case 'variable': {
                const variable = symbols.variables.get(symbol_name);
                return variable ? { uri: variable.location.uri, range: variable.location.range } : null;
            }
            case 'scalar': {
                const scalar = symbols.scalars.get(symbol_name);
                return scalar ? { uri: scalar.location.uri, range: scalar.location.range } : null;
            }
            case 'matrix': {
                const matrix = symbols.matrices.get(symbol_name);
                return matrix ? { uri: matrix.location.uri, range: matrix.location.range } : null;
            }
            default:
                return null;
        }
    }

    /**
     * Find all references to the symbol at the given position.
     * 
     * @param document - The document state
     * @param position - The cursor position
     * @param context - LSP reference context (includeDeclaration)
     * @param workspace_indexer - Optional workspace indexer for cross-file search
     * @param context_tracker - Optional context tracker for embedded language awareness
     * @returns Promise<Location[]> - Array of reference locations
     */
    async get_references(
        document: DocumentState,
        position: Position,
        context: ReferenceContext,
        workspace_indexer?: WorkspaceIndexer,
        context_tracker?: IContextTracker,
        cancellation_token?: CancellationToken
    ): Promise<Location[]> {
        // Check cancellation before starting (Req 5.3)
        if (cancellation_token?.isCancellationRequested) {
            return [];
        }

        // Check if we're in an embedded language context
        if (context_tracker) {
            const my_context = context_tracker.get_context_at_position(position);
            
            // In embedded language context, only resolve macros
            if (my_context !== LanguageContext.STATA) {
                return await this.get_macro_references_only(
                    document,
                    position,
                    context,
                    workspace_indexer,
                    cancellation_token
                );
            }
        }

        // Identify the symbol at cursor position
        const identified_symbol = this.identify_symbol_at_position(
            document,
            position,
            cancellation_token
        );
        if (!identified_symbol) {
            return [];
        }

        return this.collect_references(
            document,
            identified_symbol.name,
            identified_symbol.type,
            context.includeDeclaration,
            workspace_indexer,
            document.context_ranges,
            cancellation_token
        );
    }

    /**
     * Apply includeDeclaration logic to locations.
     * Shared between get_references and get_macro_references_only.
     */
    private apply_include_declaration(
        locations: Location[],
        definition: Location | null,
        include_declaration: boolean
    ): Location[] {
        if (include_declaration && definition) {
            // Add definition to results if not already present (avoid duplicates)
            const already_has_definition = locations.some(loc =>
                loc.uri === definition.uri &&
                loc.range.start.line === definition.range.start.line &&
                loc.range.start.character === definition.range.start.character &&
                loc.range.end.line === definition.range.end.line &&
                loc.range.end.character === definition.range.end.character
            );
            if (!already_has_definition) {
                locations.push(definition);
            }
        } else if (!include_declaration && definition) {
            // Filter out definition from results
            const filtered_locations = locations.filter(loc => 
                !(loc.uri === definition.uri && 
                  loc.range.start.line === definition.range.start.line &&
                  loc.range.start.character === definition.range.start.character &&
                  loc.range.end.line === definition.range.end.line &&
                  loc.range.end.character === definition.range.end.character)
            );
            return this.sort_locations(filtered_locations);
        }
        return this.sort_locations(locations);
    }

    /**
     * Sort locations by URI, then line, then character.
     */
    private sort_locations(locations: Location[]): Location[] {
        return locations.sort((a, b) => {
            // First compare by URI
            if (a.uri < b.uri) return -1;
            if (a.uri > b.uri) return 1;
            // Then by line
            if (a.range.start.line < b.range.start.line) return -1;
            if (a.range.start.line > b.range.start.line) return 1;
            // Then by character
            if (a.range.start.character < b.range.start.character) return -1;
            if (a.range.start.character > b.range.start.character) return 1;
            return 0;
        });
    }

    /**
     * Get the word at the given position.
     */
    private get_word_at_position(
        document: DocumentState,
        position: Position
    ): { word: string; range: Range } | null {
        const line = get_line_text(document, position.line);
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
     * Identify the symbol at the cursor position and determine its type.
     */
    private identify_symbol_at_position(
        document: DocumentState,
        position: Position,
        cancellation_token?: CancellationToken
    ): IdentifiedSymbol | null {
        const word_info = this.get_word_at_position(document, position);
        if (!word_info) {
            return null;
        }

        const { word, range } = word_info;
        const line = get_line_text(document, position.line);
        
        // Check for macro references by looking at surrounding context
        const char_before_start = range.start.character > 0 ? line[range.start.character - 1] : '';
        const chars_before_start = range.start.character >= 2 ? line.substring(range.start.character - 2, range.start.character) : char_before_start;
        
        // Global macro: $name or ${name}
        if (char_before_start === '$' || chars_before_start === '${') {
            return {
                name: word,
                type: 'global_macro',
                range,
            };
        }
        
        // Local macro: `name'
        if (char_before_start === '`') {
            return {
                name: word,
                type: 'local_macro',
                range,
            };
        }

        // Use line-bucketed index for O(1) line lookup when
        // available; fall back to linear scan otherwise
        if (cancellation_token?.isCancellationRequested) {
            return null;
        }
        const the_tokens_to_check: Token[] | undefined =
            document.token_line_index?.size > 0
                ? document.token_line_index.get(position.line)
                : document.tokens;
        if (the_tokens_to_check) {
            for (const my_token of the_tokens_to_check) {
                if (this.position_in_range(position, my_token.range)) {
                    switch (my_token.type) {
                        case 'MACRO_REF_LOCAL':
                            return { name: word, type: 'local_macro', range };
                        case 'MACRO_REF_GLOBAL':
                            return { name: word, type: 'global_macro', range };
                        case 'WORD':
                            // Use symbol table to determine type
                            if (document.symbols.programs.has(word)) {
                                return { name: word, type: 'program', range };
                            }
                            if (document.symbols.variables.has(word)) {
                                return { name: word, type: 'variable', range };
                            }
                            if (document.symbols.scalars.has(word)) {
                                return { name: word, type: 'scalar', range };
                            }
                            if (document.symbols.matrices.has(word)) {
                                return { name: word, type: 'matrix', range };
                            }
                            return null;
                    }
                }
            }
        }

        // Return null if we can't determine the type reliably
        return null;
    }

    /**
     * Handle macro references in embedded language contexts.
     * Macros work across all contexts (Stata, Mata, Python).
     */
    private async get_macro_references_only(
        document: DocumentState,
        position: Position,
        context: ReferenceContext,
        workspace_indexer?: WorkspaceIndexer,
        cancellation_token?: CancellationToken
    ): Promise<Location[]> {
        const identified_symbol = this.identify_symbol_at_position(
            document,
            position,
            cancellation_token
        );
        if (!identified_symbol || (identified_symbol.type !== 'local_macro' && identified_symbol.type !== 'global_macro')) {
            return [];
        }

        return this.collect_references(
            document,
            identified_symbol.name,
            identified_symbol.type,
            context.includeDeclaration,
            workspace_indexer,
            undefined, // No context_ranges filtering for macros (they work across all contexts)
            cancellation_token
        );
    }

    /**
     * Shared helper to collect references across current document and workspace.
     */
    private async collect_references(
        document: DocumentState,
        symbol_name: string,
        symbol_type: 'local_macro' | 'global_macro' | 'program' | 'variable' | 'scalar' | 'matrix',
        include_declaration: boolean,
        workspace_indexer?: WorkspaceIndexer,
        context_ranges?: ContextRange[],
        cancellation_token?: CancellationToken
    ): Promise<Location[]> {
        const search_context: ReferenceSearchContext = {
            symbol_name,
            symbol_type,
            include_declaration
        };

        const locations: Location[] = [];
        const definition = this.find_definition(document, symbol_name, symbol_type);

        // Search current document
        if (document.tokens) {
            const matches = this.scan_tokens_for_references(
                document.tokens,
                document.uri,
                search_context,
                context_ranges,
                cancellation_token
            );
            for (const my_match of matches) {
                locations.push({ uri: my_match.uri, range: my_match.range });
            }
        }

        // Check cancellation before workspace scan (Req 5.3)
        if (cancellation_token?.isCancellationRequested) {
            return this.apply_include_declaration(locations, definition, include_declaration);
        }

        // Search workspace-indexed files (Req 13.3)
        if (workspace_indexer) {
            const indexed_files = workspace_indexer.get_indexed_files();
            let file_count = 0;
            
            for (const [uri, file_data] of indexed_files.entries()) {
                // Periodic cancellation check during workspace scan (Req 13.3)
                if (cancellation_token?.isCancellationRequested) {
                    break;
                }

                if (uri === document.uri) continue;
                
                const matches = this.scan_tokens_for_references(
                    file_data.tokens,
                    uri,
                    search_context,
                    file_data.context_ranges,
                    cancellation_token
                );
                for (const my_match of matches) {
                    locations.push({ uri: my_match.uri, range: my_match.range });
                }
                
                file_count++;
                // Yield every 10 files to avoid blocking the event loop,
                // then re-check cancellation after yielding (Req 13.3)
                if (file_count % 10 === 0) {
                    await new Promise(resolve => setTimeout(resolve, 0));
                    if (cancellation_token?.isCancellationRequested) {
                        break;
                    }
                }
            }
        }

        return this.apply_include_declaration(locations, definition, include_declaration);
    }

    /**
     * Check if a position is within a range.
     */
    private position_in_range(position: Position, range: Range): boolean {
        if (position.line < range.start.line || position.line > range.end.line) {
            return false;
        }
        if (position.line === range.start.line && position.character < range.start.character) {
            return false;
        }
        if (position.line === range.end.line && position.character >= range.end.character) {
            return false;
        }
        return true;
    }
}
