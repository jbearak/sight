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
import {
    StataNode,
    EmbeddedLanguageBlockNode,
    WorkspaceSymbolMatch,
    WorkspaceSymbolSource,
} from '../types';
import { get_line_text, get_line_count } from '../utils/line-utils';
import { enumerate_scoped_local_macros } from '../utils/scoped-locals';
import { extract_sections, RawSection } from './section-detector';
import * as path from 'path';

/** LSP end-of-line sentinel (max 32-bit signed int) */
const LSP_EOL_CHARACTER = 2147483647;

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
 * Compute level-aware section ranges using a stack-based O(n) algorithm.
 * Backported from Raven's HierarchyBuilder::compute_section_ranges().
 *
 * For each section at level N, the range ends at the line before the next
 * section at level <= N. Sections with no subsequent sibling/ancestor extend
 * to the last line of the document.
 *
 * Mutates the sections array in place (updates range.end).
 * Preserves selection_range unchanged.
 *
 * @param sections - Array of RawSection entries (must be sorted by start line)
 * @param line_count - Total number of lines in the document
 */
export function compute_section_ranges(sections: RawSection[], line_count: number): void {
    if (sections.length === 0 || line_count === 0) return;

    // Ensure sorted by start line
    sections.sort((a, b) => a.range.start.line - b.range.start.line);

    // Stack of indices into sections array
    const my_stack: number[] = [];

    for (let my_i = 0; my_i < sections.length; my_i++) {
        const my_current_level = sections[my_i].level;
        const my_current_start = sections[my_i].range.start.line;

        // Pop stack entries with level >= current_level
        while (my_stack.length > 0) {
            const my_top_idx = my_stack[my_stack.length - 1];
            const my_top_level = sections[my_top_idx].level;
            if (my_top_level >= my_current_level) {
                // End this section at the line before current section starts
                const my_end_line = my_current_start > 0 ? my_current_start - 1 : 0;
                sections[my_top_idx].range.end = {
                    line: my_end_line,
                    character: LSP_EOL_CHARACTER,
                };
                my_stack.pop();
            } else {
                break;
            }
        }

        my_stack.push(my_i);
    }

    // Remaining stack entries extend to EOF
    const my_last_line = line_count - 1;
    while (my_stack.length > 0) {
        const my_top_idx = my_stack.pop()!;
        sections[my_top_idx].range.end = {
            line: my_last_line,
            character: LSP_EOL_CHARACTER,
        };
    }
}

/**
 * Nest sections hierarchically and insert existing symbols into sections.
 *
 * 1. Converts RawSection entries to DocumentSymbol with kind Module
 * 2. Builds section hierarchy by level (deeper sections nest under shallower)
 * 3. Inserts existing symbols into their deepest containing section
 * 4. Symbols not inside any section remain at root level
 *
 * @param sections - Array of RawSection entries with computed ranges
 * @param existing_symbols - Existing DocumentSymbol entries (programs, macros, etc.)
 * @returns Merged array of DocumentSymbol with section hierarchy
 */
export function nest_in_sections(
    sections: RawSection[],
    existing_symbols: DocumentSymbol[]
): DocumentSymbol[] {
    // Convert sections to DocumentSymbol
    const my_section_symbols: Array<DocumentSymbol & { _level: number }> = sections.map(s => ({
        name: s.name,
        kind: SymbolKind.Module,
        range: s.range,
        selectionRange: s.selection_range,
        detail: `Section`,
        children: [],
        _level: s.level,
    }));

    // Build section hierarchy using a stack approach
    const my_root_sections: Array<DocumentSymbol & { _level: number }> = [];
    const my_parent_stack: Array<DocumentSymbol & { _level: number }> = [];

    for (const my_section of my_section_symbols) {
        // Pop stack until we find a parent with level < current
        while (my_parent_stack.length > 0) {
            const my_top = my_parent_stack[my_parent_stack.length - 1];
            if (my_top._level >= my_section._level) {
                my_parent_stack.pop();
            } else {
                break;
            }
        }

        if (my_parent_stack.length > 0) {
            // Nest under parent
            const my_parent = my_parent_stack[my_parent_stack.length - 1];
            if (!my_parent.children) my_parent.children = [];
            my_parent.children.push(my_section);
        } else {
            my_root_sections.push(my_section);
        }

        my_parent_stack.push(my_section);
    }

    // Single-pass symbol assignment using section stack
    const my_root_orphans: DocumentSymbol[] = [];
    const my_section_idx_stack: number[] = [];
    let my_next_section = 0;

    for (const my_symbol of existing_symbols) {
        const my_sym_line = my_symbol.range.start.line;

        // Push sections that start at or before this symbol
        while (
            my_next_section < my_section_symbols.length &&
            my_section_symbols[my_next_section].range.start.line
                <= my_sym_line
        ) {
            my_section_idx_stack.push(my_next_section);
            my_next_section++;
        }

        // Pop sections whose range has ended
        while (my_section_idx_stack.length > 0) {
            const my_top =
                my_section_idx_stack[
                    my_section_idx_stack.length - 1
                ];
            if (
                my_section_symbols[my_top].range.end.line
                    < my_sym_line
            ) {
                my_section_idx_stack.pop();
            } else {
                break;
            }
        }

        // Assign to deepest active section (top of stack)
        if (my_section_idx_stack.length > 0) {
            const my_deepest =
                my_section_idx_stack[
                    my_section_idx_stack.length - 1
                ];
            my_section_symbols[my_deepest].children!.push(
                my_symbol
            );
        } else {
            my_root_orphans.push(my_symbol);
        }
    }

    // Sort children of each section by position
    for (const my_section of my_section_symbols) {
        if (my_section.children && my_section.children.length > 1) {
            my_section.children.sort((a, b) => {
                if (a.range.start.line !== b.range.start.line) {
                    return a.range.start.line - b.range.start.line;
                }
                return a.range.start.character - b.range.start.character;
            });
        }
    }

    // Merge root sections and orphaned symbols, sort by position
    const my_result: DocumentSymbol[] = [
        ...my_root_sections.map(strip_internal_fields),
        ...my_root_orphans,
    ];

    my_result.sort((a, b) => {
        if (a.range.start.line !== b.range.start.line) {
            return a.range.start.line - b.range.start.line;
        }
        return a.range.start.character - b.range.start.character;
    });

    return my_result;
}


/**
 * Strip internal tracking fields from a section DocumentSymbol.
 */
function strip_internal_fields(section: DocumentSymbol & { _level: number }): DocumentSymbol {
    const { _level, ...my_clean } = section;
    // Recursively strip children
    if (my_clean.children) {
        my_clean.children = my_clean.children.map(child => {
            if ('_level' in child) {
                return strip_internal_fields(child as DocumentSymbol & { _level: number });
            }
            return child;
        });
    }
    return my_clean;
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

        // 3. Add local macros - nest under containing program or add as
        //    top-level. Enumerate per scope (#270): the flat view keeps
        //    one representative per name, dropping same-named locals
        //    declared in other program scopes from the outline.
        for (const [name, macro] of enumerate_scoped_local_macros(
            document.scopes, document.symbols.localMacros
        )) {
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

        // 6. Add variables (gen/egen only) - defined in this file
        for (const [name, variable] of document.symbols.variables) {
            if (variable.sourceUri === document.uri) {
                // Only include gen and egen sources
                if (variable.source === 'gen' || variable.source === 'egen') {
                    symbols.push({
                        name: name,
                        kind: SymbolKind.Field,
                        range: variable.location.range,
                        selectionRange: variable.location.range,
                        detail: `Variable (${variable.source})`,
                    });
                }
            }
        }

        // 7. Add embedded language blocks as structural elements
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

        // 8. Extract sections from document content and integrate
        const my_sections = extract_sections(document.content, document.line_offsets);
        if (my_sections.length > 0) {
            const my_line_count = get_line_count(document);
            compute_section_ranges(my_sections, my_line_count);
            return nest_in_sections(my_sections, symbols);
        }

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
     * Returns one SymbolInformation per (name, file, type) triple via the
     * `WorkspaceSymbolSource`. Open-document symbols come from fresh in-memory
     * tables so unsaved edits appear immediately.
     *
     * @param query - The search query
     * @param all_documents - All open documents (fresh in-memory symbols)
     * @param workspace_source - Workspace-wide symbol search source
     * @returns Array of SymbolInformation
     */
    get_workspace_symbols(
        query: string,
        all_documents: DocumentState[],
        workspace_source?: WorkspaceSymbolSource
    ): SymbolInformation[] {
        const symbols: SymbolInformation[] = [];
        const lower_query = query.toLowerCase();

        // Build set of open document URIs so the overlay owns those URIs
        const the_open_document_uris = new Set(
            all_documents.map((my_document) => my_document.uri)
        );

        // 1. Pull workspace-wide matches from the source, skipping any whose
        //    URI is covered by an open document (overlay owns those).
        if (workspace_source) {
            const the_matches = workspace_source.find_all_symbol_definitions(query);
            for (const my_match of the_matches) {
                if (the_open_document_uris.has(my_match.uri)) continue;
                symbols.push(this.match_to_symbol_information(my_match));
            }
        }

        // 2. Overlay fresh symbols from open documents across all six symbol
        //    types plus embedded-language blocks.
        for (const document of all_documents) {
            const my_basename = path.basename(document.uri);

            // Programs
            for (const my_program of document.symbols.programs.values()) {
                if (my_program.name.toLowerCase().includes(lower_query)) {
                    symbols.push({
                        name: my_program.name,
                        kind: SymbolKind.Function,
                        location: {
                            uri: my_program.sourceUri,
                            range: my_program.location.range,
                        },
                        containerName: `Program in ${my_basename}`,
                    });
                }
            }

            // Global macros
            for (const [my_name, my_macro] of document.symbols.globalMacros) {
                if (my_name.toLowerCase().includes(lower_query)) {
                    symbols.push({
                        name: my_name,
                        kind: SymbolKind.Variable,
                        location: {
                            uri: my_macro.sourceUri,
                            range: my_macro.location.range,
                        },
                        containerName: `Global Macro in ${my_basename}`,
                    });
                }
            }

            // Local macros — per scope (#270), same rationale as the
            // document outline above.
            for (const [my_name, my_macro] of enumerate_scoped_local_macros(
                document.scopes, document.symbols.localMacros
            )) {
                if (my_name.toLowerCase().includes(lower_query)) {
                    symbols.push({
                        name: `\`${my_name}'`,
                        kind: SymbolKind.Variable,
                        location: {
                            uri: my_macro.sourceUri,
                            range: my_macro.location.range,
                        },
                        containerName: `Local Macro in ${my_basename}`,
                    });
                }
            }

            // Variables
            for (const [my_name, my_variable] of document.symbols.variables) {
                if (my_name.toLowerCase().includes(lower_query)) {
                    symbols.push({
                        name: my_name,
                        kind: SymbolKind.Field,
                        location: {
                            uri: my_variable.sourceUri,
                            range: my_variable.location.range,
                        },
                        containerName: `Variable in ${my_basename}`,
                    });
                }
            }

            // Scalars
            for (const [my_name, my_scalar] of document.symbols.scalars) {
                if (my_name.toLowerCase().includes(lower_query)) {
                    symbols.push({
                        name: my_name,
                        kind: SymbolKind.Variable,
                        location: {
                            uri: my_scalar.sourceUri,
                            range: my_scalar.location.range,
                        },
                        containerName: `Scalar in ${my_basename}`,
                    });
                }
            }

            // Matrices
            for (const [my_name, my_matrix] of document.symbols.matrices) {
                if (my_name.toLowerCase().includes(lower_query)) {
                    symbols.push({
                        name: my_name,
                        kind: SymbolKind.Variable,
                        location: {
                            uri: my_matrix.sourceUri,
                            range: my_matrix.location.range,
                        },
                        containerName: `Matrix in ${my_basename}`,
                    });
                }
            }

            // Embedded language blocks
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
                            containerName: `Embedded Language in ${my_basename}`,
                        });
                    }
                }
            }
        }

        return symbols;
    }

    /**
     * Convert a WorkspaceSymbolMatch to a SymbolInformation entry.
     *
     * Note: containerName values here are WITHOUT the `in <basename>` suffix —
     * that suffix is reserved for the open-document overlay entries.
     */
    private match_to_symbol_information(
        match: WorkspaceSymbolMatch
    ): SymbolInformation {
        switch (match.kind) {
            case 'program':
                return {
                    name: match.name,
                    kind: SymbolKind.Function,
                    location: { uri: match.uri, range: match.range },
                    containerName: 'Program',
                };
            case 'global_macro':
                return {
                    name: match.name,
                    kind: SymbolKind.Variable,
                    location: { uri: match.uri, range: match.range },
                    containerName: 'Global Macro',
                };
            case 'local_macro':
                return {
                    name: `\`${match.name}'`,
                    kind: SymbolKind.Variable,
                    location: { uri: match.uri, range: match.range },
                    containerName: 'Local Macro',
                };
            case 'variable':
                return {
                    name: match.name,
                    kind: SymbolKind.Field,
                    location: { uri: match.uri, range: match.range },
                    containerName: 'Variable',
                };
            case 'scalar':
                return {
                    name: match.name,
                    kind: SymbolKind.Variable,
                    location: { uri: match.uri, range: match.range },
                    containerName: 'Scalar',
                };
            case 'matrix':
                return {
                    name: match.name,
                    kind: SymbolKind.Variable,
                    location: { uri: match.uri, range: match.range },
                    containerName: 'Matrix',
                };
        }
    }
}
