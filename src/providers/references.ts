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
        context_ranges?: ContextRange[]
    ): TokenMatch[] {
        const matches: TokenMatch[] = [];

        for (const token of tokens) {
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
            case 'local_macro':
                const local_macro = symbols.localMacros.get(symbol_name);
                return local_macro ? { uri: local_macro.location.uri, range: local_macro.location.range } : null;
            
            case 'global_macro':
                const global_macro = symbols.globalMacros.get(symbol_name);
                return global_macro ? { uri: global_macro.location.uri, range: global_macro.location.range } : null;
            
            case 'program':
                const program = symbols.programs.get(symbol_name);
                return program ? { uri: program.location.uri, range: program.location.range } : null;
            
            case 'variable':
                const variable = symbols.variables.get(symbol_name);
                return variable ? { uri: variable.location.uri, range: variable.location.range } : null;
            
            case 'scalar':
                const scalar = symbols.scalars.get(symbol_name);
                return scalar ? { uri: scalar.location.uri, range: scalar.location.range } : null;
            
            case 'matrix':
                const matrix = symbols.matrices.get(symbol_name);
                return matrix ? { uri: matrix.location.uri, range: matrix.location.range } : null;
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
        context_tracker?: IContextTracker
    ): Promise<Location[]> {
        // Check if we're in an embedded language context
        if (context_tracker) {
            const my_context = context_tracker.get_context_at_position(position);
            
            // In embedded language context, only resolve macros
            if (my_context !== LanguageContext.STATA) {
                return await this.get_macro_references_only(
                    document,
                    position,
                    context,
                    workspace_indexer
                );
            }
        }

        // Identify the symbol at cursor position
        const identified_symbol = this.identify_symbol_at_position(document, position);
        if (!identified_symbol) {
            return [];
        }

        // Create search context
        const search_context: ReferenceSearchContext = {
            symbol_name: identified_symbol.name,
            symbol_type: identified_symbol.type,
            include_declaration: context.includeDeclaration
        };

        const locations: Location[] = [];

        // Find definition if needed for includeDeclaration handling
        const definition = this.find_definition(document, identified_symbol.name, identified_symbol.type);

        // 1. Search current document tokens (fresh/in-memory content)
        if (document.tokens) {
            const matches = this.scan_tokens_for_references(
                document.tokens,
                document.uri,
                search_context
            );
            
            for (const match of matches) {
                locations.push({
                    uri: match.uri,
                    range: match.range
                });
            }
        }

        // 2. Search all other indexed files from WorkspaceIndexer
        if (workspace_indexer) {
            const indexed_files = workspace_indexer.get_indexed_files();
            let file_count = 0;
            
            for (const [uri, file_data] of indexed_files.entries()) {
                // Skip the current document (already searched with fresh content)
                if (uri === document.uri) {
                    continue;
                }
                
                const matches = this.scan_tokens_for_references(
                    file_data.tokens,
                    uri,
                    search_context,
                    file_data.context_ranges
                );
                
                for (const match of matches) {
                    locations.push({
                        uri: match.uri,
                        range: match.range
                    });
                }
                
                // Yield to event loop periodically to avoid blocking
                file_count++;
                if (file_count % 10 === 0) {
                    await new Promise(resolve => setTimeout(resolve, 0));
                }
            }
        }

        // Handle includeDeclaration flag
        if (context.includeDeclaration && definition) {
            // Add definition as first result
            locations.unshift(definition);
        } else if (!context.includeDeclaration && definition) {
            // Filter out definition from results
            const filtered_locations = locations.filter(loc => 
                !(loc.uri === definition.uri && 
                  loc.range.start.line === definition.range.start.line &&
                  loc.range.start.character === definition.range.start.character &&
                  loc.range.end.line === definition.range.end.line &&
                  loc.range.end.character === definition.range.end.character)
            );
            return filtered_locations;
        }

        return locations;
    }

    /**
     * Get the word at the given position.
     */
    private get_word_at_position(
        document: DocumentState,
        position: Position
    ): { word: string; range: Range } | null {
        const line = get_line_text(document, position.line);
        
        // Check if line exists
        if (document.line_offsets) {
            if (position.line >= document.line_offsets.length) return null;
        } else {
            if (line === '' && position.line > 0) {
                let newline_count = 0;
                for (let i = 0; i < document.content.length; i++) {
                    if (document.content[i] === '\n') {
                        newline_count++;
                    }
                }
                if (position.line > newline_count) return null;
            }
        }
        
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
        position: Position
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

        // For other symbols, we need to check the token type at position
        // This is a simplified implementation - actual token analysis would be more precise
        if (document.tokens) {
            for (const token of document.tokens) {
                if (this.position_in_range(position, token.range)) {
                    switch (token.type) {
                        case 'MACRO_REF_LOCAL':
                            return { name: word, type: 'local_macro', range };
                        case 'MACRO_REF_GLOBAL':
                            return { name: word, type: 'global_macro', range };
                        case 'WORD':
                            // Could be program, variable, scalar, or matrix - default to program
                            return { name: word, type: 'program', range };
                    }
                }
            }
        }

        // Default to program if we can't determine the type
        return {
            name: word,
            type: 'program',
            range,
        };
    }

    /**
     * Handle macro references in embedded language contexts.
     */
    private async get_macro_references_only(
        document: DocumentState,
        position: Position,
        context: ReferenceContext,
        workspace_indexer?: WorkspaceIndexer
    ): Promise<Location[]> {
        const identified_symbol = this.identify_symbol_at_position(document, position);
        if (!identified_symbol || (identified_symbol.type !== 'local_macro' && identified_symbol.type !== 'global_macro')) {
            return [];
        }

        // TODO: Implement macro-only reference search
        return [];
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