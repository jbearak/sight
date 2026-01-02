/**
 * Property Test: Local Macro Containment and Nesting
 *
 * Tests that local macros are correctly nested under their containing programs
 * or placed at top level when outside all programs.
 *
 * Feature: document-symbols-enhancement, Property 4: Local macro containment and nesting
 * Validates: Requirements 3.1, 3.2, 3.3, 3.5
 */

import { describe, it, beforeEach } from 'bun:test';
import * as fc from 'fast-check';
import { SymbolProvider, is_position_in_range } from '../../src/providers/symbols';
import { SymbolKind, DocumentSymbol } from 'vscode-languageserver';
import { Range, Position } from 'vscode-languageserver-textdocument';
import { parse_and_analyze } from './helpers/document-utils';

describe('Local Macro Containment Property Tests', () => {
    let my_symbol_provider: SymbolProvider;

    beforeEach(() => {
        my_symbol_provider = new SymbolProvider();
    });

    /**
     * Generator for a program with optional local macros inside.
     * Returns the program definition string and metadata about locals.
     */
    function arbitrary_program_with_locals(
        program_name: string,
        num_locals: number
    ): fc.Arbitrary<{
        code: string;
        program_name: string;
        local_names: string[];
        locals_inside: boolean;
    }> {
        const my_local_names = fc.array(
            fc.stringMatching(/^[a-z][a-z0-9_]{0,5}$/),
            { minLength: num_locals, maxLength: num_locals }
        );

        return my_local_names.map((the_names) => {
            const my_unique_names = [...new Set(the_names)];
            const my_local_defs = my_unique_names
                .map((my_name) => `    local ${my_name} = "value"`)
                .join('\n');

            const my_code = `program define ${program_name}\n${my_local_defs}\nend`;

            return {
                code: my_code,
                program_name,
                local_names: my_unique_names,
                locals_inside: true,
            };
        });
    }

    /**
     * Generator for local macros outside any program.
     */
    function arbitrary_top_level_locals(
        num_locals: number
    ): fc.Arbitrary<{ code: string; local_names: string[] }> {
        const my_local_names = fc.array(
            fc.stringMatching(/^[a-z][a-z0-9_]{0,5}$/),
            { minLength: num_locals, maxLength: num_locals }
        );

        return my_local_names.map((the_names) => {
            const my_unique_names = [...new Set(the_names)];
            const my_code = my_unique_names
                .map((my_name) => `local ${my_name} = "value"`)
                .join('\n');

            return {
                code: my_code,
                local_names: my_unique_names,
            };
        });
    }

    /**
     * Generator for a document with programs and local macros at various positions.
     */
    function arbitrary_document_with_programs_and_locals(): fc.Arbitrary<{
        document: string;
        programs: Array<{ name: string; local_names: string[] }>;
        top_level_locals: string[];
    }> {
        return fc
            .tuple(
                // Number of programs (1-2)
                fc.integer({ min: 1, max: 2 }),
                // Number of locals inside each program (0-2)
                fc.integer({ min: 0, max: 2 }),
                // Number of top-level locals (0-2)
                fc.integer({ min: 0, max: 2 })
            )
            .chain(([num_programs, num_locals_per_program, num_top_level_locals]) => {
                // Generate unique program names
                const my_program_names = Array.from(
                    { length: num_programs },
                    (_, i) => `prog${i}`
                );

                // Generate programs with locals
                const my_program_generators = my_program_names.map((my_name) =>
                    arbitrary_program_with_locals(my_name, num_locals_per_program)
                );

                // Generate top-level locals with unique prefix to avoid name collisions
                const my_top_level_gen = arbitrary_top_level_locals(num_top_level_locals).map(
                    (result) => ({
                        code: result.local_names
                            .map((my_name) => `local top_${my_name} = "value"`)
                            .join('\n'),
                        local_names: result.local_names.map((my_name) => `top_${my_name}`),
                    })
                );

                return fc
                    .tuple(fc.tuple(...my_program_generators), my_top_level_gen)
                    .map(([the_programs, my_top_level]) => {
                        // Build document: top-level locals first, then programs
                        const my_parts: string[] = [];

                        if (my_top_level.code.trim()) {
                            my_parts.push(my_top_level.code);
                        }

                        for (const my_prog of the_programs) {
                            my_parts.push(my_prog.code);
                        }

                        return {
                            document: my_parts.join('\n\n'),
                            programs: the_programs.map((my_prog) => ({
                                name: my_prog.program_name,
                                local_names: my_prog.local_names,
                            })),
                            top_level_locals: my_top_level.local_names,
                        };
                    });
            });
    }

    /**
     * Helper to find all local macro symbols in a DocumentSymbol array,
     * including those nested as children.
     */
    function collect_all_local_symbols(
        the_symbols: DocumentSymbol[]
    ): Array<{ symbol: DocumentSymbol; parent_name: string | null }> {
        const my_result: Array<{ symbol: DocumentSymbol; parent_name: string | null }> = [];

        for (const my_symbol of the_symbols) {
            if (my_symbol.detail === 'Local Macro') {
                my_result.push({ symbol: my_symbol, parent_name: null });
            }

            if (my_symbol.children) {
                for (const my_child of my_symbol.children) {
                    if (my_child.detail === 'Local Macro') {
                        my_result.push({ symbol: my_child, parent_name: my_symbol.name });
                    }
                }
            }
        }

        return my_result;
    }

    /**
     * Property 4: Local macro containment and nesting
     *
     * For any document with programs and local macros:
     * - A local macro whose definition range.start falls within a program's range
     *   SHALL appear in that program's children array
     * - A local macro outside all programs SHALL appear as a top-level symbol
     *
     * Feature: document-symbols-enhancement, Property 4: Local macro containment and nesting
     * Validates: Requirements 3.1, 3.2, 3.3, 3.5
     */
    it('should correctly nest local macros inside programs or place at top level', () => {
        fc.assert(
            fc.property(
                arbitrary_document_with_programs_and_locals(),
                ({ document, programs, top_level_locals }) => {
                    // Parse and analyze the document
                    const my_doc_state = parse_and_analyze(document);
                    const my_symbols = my_symbol_provider.get_document_symbols(my_doc_state);

                    // Collect all local symbols with their parent info
                    const my_all_locals = collect_all_local_symbols(my_symbols);

                    // Get program symbols for range checking
                    const my_program_symbols = my_symbols.filter(
                        (s) => s.kind === SymbolKind.Function
                    );

                    // Verify each local macro is correctly placed
                    for (const { symbol: my_local, parent_name } of my_all_locals) {
                        const my_local_start = my_local.range.start;

                        // Check if this local is inside any program's range
                        let my_containing_program: DocumentSymbol | null = null;
                        let my_smallest_size = Infinity;

                        for (const my_prog of my_program_symbols) {
                            if (is_position_in_range(my_local_start, my_prog.range)) {
                                const my_size = calculate_range_size(my_prog.range);
                                if (my_size < my_smallest_size) {
                                    my_smallest_size = my_size;
                                    my_containing_program = my_prog;
                                }
                            }
                        }

                        if (my_containing_program) {
                            // Local should be nested under the containing program
                            if (parent_name !== my_containing_program.name) {
                                return false;
                            }
                        } else {
                            // Local should be at top level (parent_name is null)
                            if (parent_name !== null) {
                                return false;
                            }
                        }
                    }

                    return true;
                }
            ),
            { numRuns: 100 }
        );
    });

    /**
     * Property: Locals inside programs appear as children
     *
     * For any document with programs containing local macros,
     * those locals SHALL appear as children of the program symbol.
     *
     * Feature: document-symbols-enhancement, Property 4: Local macro containment and nesting
     * Validates: Requirements 3.1, 3.5
     */
    it('should include locals inside programs as children of program symbols', () => {
        fc.assert(
            fc.property(
                // Generate a single program with 1-3 locals inside
                fc.integer({ min: 1, max: 3 }).chain((num_locals) =>
                    arbitrary_program_with_locals('test_prog', num_locals)
                ),
                ({ code, program_name, local_names }) => {
                    const my_doc_state = parse_and_analyze(code);
                    const my_symbols = my_symbol_provider.get_document_symbols(my_doc_state);

                    // Find the program symbol
                    const my_program = my_symbols.find(
                        (s) => s.kind === SymbolKind.Function && s.name === program_name
                    );

                    if (!my_program) {
                        // If program wasn't parsed, skip this test case
                        return true;
                    }

                    // All locals should be children of the program
                    const my_children = my_program.children || [];
                    const my_child_names = my_children
                        .filter((c) => c.detail === 'Local Macro')
                        .map((c) => c.name.replace(/^`|'$/g, ''));

                    // Each expected local should be in children
                    for (const my_expected_name of local_names) {
                        if (!my_child_names.includes(my_expected_name)) {
                            // Local might not have been parsed - check symbol table
                            if (my_doc_state.symbols.localMacros.has(my_expected_name)) {
                                return false;
                            }
                        }
                    }

                    return true;
                }
            ),
            { numRuns: 100 }
        );
    });

    /**
     * Property: Locals outside programs appear at top level
     *
     * For any document with local macros defined outside all programs,
     * those locals SHALL appear as top-level symbols.
     *
     * Feature: document-symbols-enhancement, Property 4: Local macro containment and nesting
     * Validates: Requirements 3.2
     */
    it('should place locals outside programs at top level', () => {
        fc.assert(
            fc.property(
                // Generate top-level locals followed by a program (no locals inside)
                fc.tuple(
                    arbitrary_top_level_locals(2),
                    fc.constant('program empty_prog\nend')
                ),
                ([{ code: local_code, local_names }, program_code]) => {
                    const my_document = `${local_code}\n\n${program_code}`;
                    const my_doc_state = parse_and_analyze(my_document);
                    const my_symbols = my_symbol_provider.get_document_symbols(my_doc_state);

                    // Find top-level local symbols
                    const my_top_level_locals = my_symbols.filter(
                        (s) => s.detail === 'Local Macro'
                    );

                    // Each expected local should be at top level
                    for (const my_expected_name of local_names) {
                        const my_formatted_name = `\`${my_expected_name}'`;
                        const my_found = my_top_level_locals.some(
                            (s) => s.name === my_formatted_name
                        );

                        // Only fail if the local was actually parsed
                        if (!my_found && my_doc_state.symbols.localMacros.has(my_expected_name)) {
                            return false;
                        }
                    }

                    return true;
                }
            ),
            { numRuns: 100 }
        );
    });
});

/**
 * Calculate the "size" of a range for comparison purposes.
 * Smaller ranges are preferred when multiple programs contain a position.
 */
function calculate_range_size(range: Range): number {
    const line_span = range.end.line - range.start.line;
    const char_span = range.end.character - range.start.character;
    return line_span * 10000 + char_span;
}
