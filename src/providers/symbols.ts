/**
 * Symbol Provider for Sight
 *
 * Provides document symbols and workspace symbols.
 */

import {
    DocumentSymbol,
    SymbolInformation,
    SymbolKind,
} from 'vscode-languageserver';
import { Position, Range } from 'vscode-languageserver-textdocument';
import { DocumentState } from '../document-store';
import { SymbolTable, StataNode, EmbeddedLanguageBlockNode } from '../types';
import { get_line_text } from '../utils/line-utils';
import * as path from 'path';

/**
 * Check if a position falls within a range (inclusive on both ends).
 * A position on the last line of a range is considered inside the range.
 *
 * @param position - The position to check
 * @param range - The range to check against
 * @returns true if position is within range (inclusive)
 */
export function is_position_in_range(position: Position, range: Range): boolean {
    // Check if position is before range start
    if (position.line < range.start.line) {
        return false;
    }
    if (position.line === range.start.line && position.character < range.start.character) {
        return false;
    }

    // Check if position is after range end
    if (position.line > range.end.line) {
        return false;
    }
    if (position.line === range.end.line && position.character > range.end.character) {
        return false;
    }

    return true;
}

/**
 * Calculate the "size" of a range for comparison purposes.
 * Smaller ranges are preferred when multiple programs contain a position.
 *
 * This intentionally prioritizes line span over character span, and avoids
 * negative sizes for oddly-shaped ranges.
 */
function calculate_range_size(range: Range): number {
    const line_span = Math.max(0, range.end.line - range.start.line);
    if (line_span > 0) {
        // Any multi-line range is larger than any single-line range.
        return line_span * 1000000 + Math.max(0, range.end.character);
    }

    const char_span = Math.max(0, range.end.character - range.start.character);
    return char_span;
}

/**
 * Program info for containment checking.
 */
export interface ProgramInfo {
    symbol: DocumentSymbol;
    range: Range;
}

/**
 * Find the smallest program that contains a given position.
 * Returns null if no program contains the position.
 *
 * @param position - The position to check (typically macro definition start)
 * @param program_infos - Map of program names to their symbols and ranges
 * @returns The DocumentSymbol of the smallest containing program, or null
 */
export function find_containing_program(
    position: Position,
    program_infos: Map<string, ProgramInfo>
): DocumentSymbol | null {
    let smallest_program: DocumentSymbol | null = null;
    let smallest_size = Infinity;

    for (const [_name, info] of program_infos) {
        if (is_position_in_range(position, info.range)) {
            const my_size = calculate_range_size(info.range);
            if (my_size < smallest_size) {
                smallest_size = my_size;
                smallest_program = info.symbol;
            }
        }
    }

    return smallest_program;
}

/**
 * Symbol Provider class.
 */
export class SymbolProvider {
    /**
     * Get document symbols for a file.
     *
     * Builds hierarchical symbols where local macros are nested under their
     * containing programs. Programs, globals, scalars, matrices, and embedded
     * blocks remain top-level.
     *
     * @param document - The document state
     * @returns Array of DocumentSymbol
     */
    get_document_symbols(document: DocumentState): DocumentSymbol[] {
        const symbols: DocumentSymbol[] = [];

        // 1. Build program symbols first with empty children arrays
        // Store program info for containment checking
        const program_infos = new Map<string, ProgramInfo>();

        for (const [_name, program] of document.symbols.programs) {
            // Defensive: only include programs defined in this document.
            // (Prevents accidental cross-file contamination if symbols are ever merged.)
            if (program.sourceUri !== document.uri) {
                continue;
            }

            // Prefer AST ranges if available for accuracy
            const my_program_range = this.get_program_range(document, program.name)
                || program.location.range;

            // Prefer selecting just the identifier for better UX in outline views.
            const my_program_selection_range =
                this.get_program_name_range(document, program.name, my_program_range)
                || my_program_range;

            const my_program_symbol: DocumentSymbol = {
                name: program.name,
                kind: SymbolKind.Function,
                range: my_program_range,
                selectionRange: my_program_selection_range,
                detail: 'Program',
                children: [],
            };

            symbols.push(my_program_symbol);
            program_infos.set(program.name, {
                symbol: my_program_symbol,
                range: my_program_range,
            });
        }

        // 2. Add global macros (defined in this file) - always top-level
        for (const [name, macro] of document.symbols.globalMacros) {
            if (macro.sourceUri === document.uri) {
                symbols.push({
                    name: `${name}`,
                    kind: SymbolKind.Variable,
                    range: macro.location.range,
                    selectionRange: macro.location.range,
                    detail: 'Global Macro',
                });
            }
        }

        // 3. Add local macros - nest under containing program or add as top-level
        for (const [name, macro] of document.symbols.localMacros) {
            if (macro.sourceUri === document.uri) {
                const my_local_symbol: DocumentSymbol = {
                    name: `\`${name}'`,
                    kind: SymbolKind.Variable,
                    range: macro.location.range,
                    selectionRange: macro.location.range,
                    detail: 'Local Macro',
                };

                // Check if this local macro is inside any program
                const my_containing_program = find_containing_program(
                    macro.location.range.start,
                    program_infos
                );

                if (my_containing_program) {
                    // Add as child of the containing program
                    if (!my_containing_program.children) {
                        my_containing_program.children = [];
                    }
                    my_containing_program.children.push(my_local_symbol);
                } else {
                    // Add as top-level symbol
                    symbols.push(my_local_symbol);
                }
            }
        }

        // Ensure stable outline ordering: sort nested local macros by position
        for (const [_name, info] of program_infos) {
            if (info.symbol.children && info.symbol.children.length > 1) {
                info.symbol.children.sort((a, b) => {
                    if (a.range.start.line !== b.range.start.line) {
                        return a.range.start.line - b.range.start.line;
                    }
                    if (a.range.start.character !== b.range.start.character) {
                        return a.range.start.character - b.range.start.character;
                    }
                    return a.name.localeCompare(b.name);
                });
            }
        }

        // 4. Add scalars (defined in this file)
        for (const [name, scalar] of document.symbols.scalars) {
            if (scalar.sourceUri === document.uri) {
                symbols.push({
                    name: name,
                    kind: SymbolKind.Variable,
                    range: scalar.location.range,
                    selectionRange: scalar.location.range,
                    detail: 'Scalar',
                });
            }
        }

        // 5. Add matrices (defined in this file)
        for (const [name, matrix] of document.symbols.matrices) {
            if (matrix.sourceUri === document.uri) {
                symbols.push({
                    name: name,
                    kind: SymbolKind.Variable,
                    range: matrix.location.range,
                    selectionRange: matrix.location.range,
                    detail: 'Matrix',
                });
            }
        }

        // 6. Add embedded language blocks as structural elements
        if (document.ast) {
            const the_embedded_blocks = this.extract_embedded_blocks(
                document.ast.nodes
            );
            for (const my_block of the_embedded_blocks) {
                const my_language_label =
                    my_block.language === 'mata' ? 'Mata Block' : 'Python Block';
                symbols.push({
                    name: my_language_label,
                    kind: SymbolKind.Module,
                    range: my_block.range,
                    selectionRange: my_block.range,
                    detail: `${my_language_label} (${my_block.start_command})`,
                });
            }
        }

        // Stable, file-order outline: sort top-level symbols by their start position.
        // (Children ordering is handled separately for nested local macros.)
        symbols.sort((a, b) => {
            if (a.range.start.line !== b.range.start.line) {
                return a.range.start.line - b.range.start.line;
            }
            if (a.range.start.character !== b.range.start.character) {
                return a.range.start.character - b.range.start.character;
            }
            return a.name.localeCompare(b.name);
        });

        return symbols;
    }

    /**
     * Get the range for a program from the AST if available.
     * Falls back to null if AST is not available or program not found.
     *
     * Searches recursively through control flow bodies in case programs
     * appear in unusual locations (defensive).
     *
     * @param document - The document state
     * @param program_name - The name of the program to find
     * @returns The program's range from AST, or null
     */
    private get_program_range(
        document: DocumentState,
        program_name: string
    ): Range | null {
        if (!document.ast) {
            return null;
        }

        return this.find_program_range_in_nodes(document.ast.nodes, program_name);
    }

    /**
     * Recursively search for a program node by name.
     *
     * @param nodes - Array of AST nodes to search
     * @param program_name - The name of the program to find
     * @returns The program's range, or null if not found
     */
    private find_program_range_in_nodes(
        nodes: StataNode[],
        program_name: string
    ): Range | null {
        for (const my_node of nodes) {
            if (my_node.type === 'program' && my_node.name === program_name) {
                return my_node.range;
            }

            // Recurse into control flow bodies (defensive - programs shouldn't
            // be nested, but this handles edge cases)
            if (
                my_node.type === 'if' ||
                my_node.type === 'else' ||
                my_node.type === 'foreach' ||
                my_node.type === 'forvalues' ||
                my_node.type === 'while' ||
                my_node.type === 'frame'
            ) {
                const my_result = this.find_program_range_in_nodes(
                    my_node.body,
                    program_name
                );
                if (my_result) {
                    return my_result;
                }
            }
        }

        return null;
    }

    /**
     * Attempt to find the range of the program identifier on the program header line.
     * Falls back to null if it cannot be located reliably.
     */
    private get_program_name_range(
        document: DocumentState,
        program_name: string,
        program_range: Range
    ): Range | null {
        const header_line_index = program_range.start.line;
        const header_line = get_line_text(document, header_line_index);
        if (header_line === undefined) {
            return null;
        }

        const escaped_name = program_name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

        // Common Stata forms:
        // - program <name>
        // - program define <name>
        // - program def <name>
        const name_regex = new RegExp(
            `\\bprogram\\b(?:\\s+(?:define|def))?\\s+(${escaped_name})\\b`,
            'i'
        );

        const match = header_line.match(name_regex);
        if (!match || match.index === undefined) {
            return null;
        }

        const full_match_start = match.index;
        const matched_text = match[0];
        const inner_start_in_match = matched_text.toLowerCase().lastIndexOf(
            program_name.toLowerCase()
        );
        if (inner_start_in_match < 0) {
            return null;
        }

        const name_start_character = full_match_start + inner_start_in_match;
        const name_end_character = name_start_character + program_name.length;

        // Ensure the selection range stays within the program range bounds.
        const start: Position = {
            line: header_line_index,
            character: Math.max(program_range.start.character, name_start_character),
        };
        const end: Position = {
            line: header_line_index,
            character: Math.max(start.character, name_end_character),
        };

        return { start, end };
    }

    /**
     * Extract embedded language blocks from AST nodes recursively.
     *
     * @param nodes - Array of AST nodes
     * @returns Array of embedded language block nodes
     */
    private extract_embedded_blocks(
        nodes: StataNode[]
    ): EmbeddedLanguageBlockNode[] {
        const the_blocks: EmbeddedLanguageBlockNode[] = [];

        for (const my_node of nodes) {
            if (my_node.type === 'embedded_block') {
                the_blocks.push(my_node as EmbeddedLanguageBlockNode);
            } else if (my_node.type === 'program') {
                // Recurse into program body
                the_blocks.push(...this.extract_embedded_blocks(my_node.body));
            } else if (
                my_node.type === 'if' ||
                my_node.type === 'else' ||
                my_node.type === 'foreach' ||
                my_node.type === 'forvalues' ||
                my_node.type === 'while' ||
                my_node.type === 'frame'
            ) {
                // Recurse into control flow body
                the_blocks.push(...this.extract_embedded_blocks(my_node.body));
            }
        }

        return the_blocks;
    }

    /**
     * Get workspace symbols matching a query.
     *
     * @param query - The search query
     * @param all_documents - All open documents (for local symbols if desired)
     * @param workspace_symbols - Merged symbols from the workspace indexer
     * @returns Array of SymbolInformation
     */
    get_workspace_symbols(
        query: string,
        all_documents: DocumentState[],
        workspace_symbols?: SymbolTable
    ): SymbolInformation[] {
        const symbols: SymbolInformation[] = [];
        const lower_query = query.toLowerCase();

        // 1. Check workspace-wide symbols (programs and global macros)
        if (workspace_symbols) {
            // Check programs
            for (const [name, program] of workspace_symbols.programs) {
                if (program.name.toLowerCase().includes(lower_query)) {
                    symbols.push({
                        name: program.name,
                        kind: SymbolKind.Function,
                        location: {
                            uri: program.sourceUri,
                            range: program.location.range,
                        },
                        containerName: 'Program',
                    });
                }
            }

            // Check global macros
            for (const [name, macro] of workspace_symbols.globalMacros) {
                if (name.toLowerCase().includes(lower_query)) {
                    symbols.push({
                        name: `${name}`,
                        kind: SymbolKind.Variable,
                        location: {
                            uri: macro.sourceUri,
                            range: macro.location.range,
                        },
                        containerName: 'Global Macro',
                    });
                }
            }
        }

        // 2. Check currently open documents for local symbols (macros, variables)
        // that match, and embedded language blocks
        for (const document of all_documents) {
            // Check local macros
            for (const [name, macro] of document.symbols.localMacros) {
                if (name.toLowerCase().includes(lower_query)) {
                    symbols.push({
                        name: `\`${name}'`,
                        kind: SymbolKind.Variable,
                        location: {
                            uri: macro.sourceUri,
                            range: macro.location.range,
                        },
                        containerName: `Local Macro in ${path.basename(document.uri)}`,
                    });
                }
            }

            // Check variables
            for (const [name, variable] of document.symbols.variables) {
                if (name.toLowerCase().includes(lower_query)) {
                    symbols.push({
                        name: name,
                        kind: SymbolKind.Field,
                        location: {
                            uri: variable.sourceUri,
                            range: variable.location.range,
                        },
                        containerName: `Variable in ${path.basename(document.uri)}`,
                    });
                }
            }

            // Check embedded language blocks
            if (document.ast) {
                const the_embedded_blocks = this.extract_embedded_blocks(
                    document.ast.nodes
                );
                for (const my_block of the_embedded_blocks) {
                    const my_language_label =
                        my_block.language === 'mata'
                            ? 'Mata Block'
                            : 'Python Block';
                    if (my_language_label.toLowerCase().includes(lower_query)) {
                        symbols.push({
                            name: my_language_label,
                            kind: SymbolKind.Module,
                            location: {
                                uri: document.uri,
                                range: my_block.range,
                            },
                            containerName: `Embedded Language in ${path.basename(
                                document.uri
                            )}`,
                        });
                    }
                }
            }
        }

        return symbols;
    }
}
