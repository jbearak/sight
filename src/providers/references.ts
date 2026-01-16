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
import { LanguageContext } from '../types';
import { get_line_text } from '../utils/line-utils';
import type { WorkspaceIndexer } from '../indexer';
import type { IContextTracker } from '../context-tracker/types';

export interface ReferenceSearchContext {
    symbol_name: string;
    symbol_type: 'local_macro' | 'global_macro' | 'program' | 'variable' | 'scalar' | 'matrix';
    include_declaration: boolean;
}

export interface IdentifiedSymbol {
    name: string;
    type: 'local_macro' | 'global_macro' | 'program' | 'variable' | 'scalar' | 'matrix';
    range: Range;
}

export class ReferencesProvider {
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

        // TODO: Implement actual reference search in Task 2
        // For now, return empty array as per requirements
        return [];
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