/**
 * Workspace Symbol Completeness Property Tests
 *
 * Tests that verify workspace symbol search includes all symbol types from
 * the workspace index: programs, global macros, local macros, variables,
 * scalars, and matrices.
 *
 * Feature: workspace-symbol-completeness
 */

import { describe, it, beforeEach } from 'bun:test';
import * as fc from 'fast-check';
import { SymbolProvider } from '../../src/providers/symbols';
import { SymbolKind } from 'vscode-languageserver';
import { SymbolTable } from '../../src/types';
import { arbitrary_identifier } from './generators/primitives';

describe('Workspace Symbol Completeness Property Tests', () => {
    let my_symbol_provider: SymbolProvider;

    beforeEach(() => {
        my_symbol_provider = new SymbolProvider();
    });

    /**
     * Helper to create a symbol table with generated symbols.
     */
    function create_symbol_table(symbols: {
        programs?: Array<{ name: string }>;
        globalMacros?: Array<{ name: string }>;
        localMacros?: Array<{ name: string }>;
        variables?: Array<{ name: string }>;
        scalars?: Array<{ name: string }>;
        matrices?: Array<{ name: string }>;
    }): SymbolTable {
        const my_range = {
            start: { line: 0, character: 0 },
            end: { line: 0, character: 10 },
        };
        const my_uri = 'file:///workspace/test.do';

        return {
            programs: new Map(
                (symbols.programs || []).map((p) => [
                    p.name,
                    {
                        name: p.name,
                        sourceUri: my_uri,
                        location: { uri: my_uri, range: my_range },
                    },
                ])
            ),
            globalMacros: new Map(
                (symbols.globalMacros || []).map((m) => [
                    m.name,
                    {
                        name: m.name,
                        sourceUri: my_uri,
                        scope: 'global' as const,
                        value: 'test',
                        location: { uri: my_uri, range: my_range },
                    },
                ])
            ),
            localMacros: new Map(
                (symbols.localMacros || []).map((m) => [
                    m.name,
                    {
                        name: m.name,
                        sourceUri: my_uri,
                        scope: 'local' as const,
                        value: 'test',
                        location: { uri: my_uri, range: my_range },
                    },
                ])
            ),
            variables: new Map(
                (symbols.variables || []).map((v) => [
                    v.name,
                    {
                        name: v.name,
                        sourceUri: my_uri,
                        location: { uri: my_uri, range: my_range },
                    },
                ])
            ),
            scalars: new Map(
                (symbols.scalars || []).map((s) => [
                    s.name,
                    {
                        name: s.name,
                        sourceUri: my_uri,
                        location: { uri: my_uri, range: my_range },
                    },
                ])
            ),
            matrices: new Map(
                (symbols.matrices || []).map((m) => [
                    m.name,
                    {
                        name: m.name,
                        sourceUri: my_uri,
                        location: { uri: my_uri, range: my_range },
                    },
                ])
            ),
        };
    }

    /**
     * Property 1: All Matching Symbols Included
     * For any workspace symbol table and query string, all symbols whose names
     * contain the query (case-insensitive) SHALL appear in the results.
     *
     * Feature: workspace-symbol-completeness, Property 1: All Matching Symbols Included
     * Validates: Requirements 1.1, 2.1, 3.1, 4.1, 5.1, 5.2
     */
    it('should include all matching symbols from workspace index', () => {
        fc.assert(
            fc.property(
                fc.record({
                    programs: fc.array(fc.record({ name: arbitrary_identifier() }), { maxLength: 3 }),
                    globalMacros: fc.array(fc.record({ name: arbitrary_identifier() }), { maxLength: 3 }),
                    localMacros: fc.array(fc.record({ name: arbitrary_identifier() }), { maxLength: 3 }),
                    variables: fc.array(fc.record({ name: arbitrary_identifier() }), { maxLength: 3 }),
                    scalars: fc.array(fc.record({ name: arbitrary_identifier() }), { maxLength: 3 }),
                    matrices: fc.array(fc.record({ name: arbitrary_identifier() }), { maxLength: 3 }),
                }),
                fc.string({ minLength: 0, maxLength: 5 }),
                (my_symbols, my_query) => {
                    const my_workspace_symbols = create_symbol_table(my_symbols);
                    const my_results = my_symbol_provider.get_workspace_symbols(
                        my_query,
                        [],
                        my_workspace_symbols
                    );

                    const my_lower_query = my_query.toLowerCase();
                    // Use composite key with containerName to avoid collisions
                    const my_result_keys = new Set(
                        my_results.map((r) => `${r.containerName}:${r.name}`)
                    );

                    // Check programs
                    for (const my_prog of my_symbols.programs || []) {
                        if (my_prog.name.toLowerCase().includes(my_lower_query)) {
                            if (!my_result_keys.has(`Program:${my_prog.name}`)) return false;
                        }
                    }

                    // Check global macros
                    for (const my_macro of my_symbols.globalMacros || []) {
                        if (my_macro.name.toLowerCase().includes(my_lower_query)) {
                            if (!my_result_keys.has(`Global Macro:${my_macro.name}`)) return false;
                        }
                    }

                    // Check local macros (name format: `name')
                    for (const my_macro of my_symbols.localMacros || []) {
                        if (my_macro.name.toLowerCase().includes(my_lower_query)) {
                            if (!my_result_keys.has(`Local Macro:\`${my_macro.name}'`)) return false;
                        }
                    }

                    // Check variables
                    for (const my_var of my_symbols.variables || []) {
                        if (my_var.name.toLowerCase().includes(my_lower_query)) {
                            if (!my_result_keys.has(`Variable:${my_var.name}`)) return false;
                        }
                    }

                    // Check scalars
                    for (const my_scalar of my_symbols.scalars || []) {
                        if (my_scalar.name.toLowerCase().includes(my_lower_query)) {
                            if (!my_result_keys.has(`Scalar:${my_scalar.name}`)) return false;
                        }
                    }

                    // Check matrices
                    for (const my_matrix of my_symbols.matrices || []) {
                        if (my_matrix.name.toLowerCase().includes(my_lower_query)) {
                            if (!my_result_keys.has(`Matrix:${my_matrix.name}`)) return false;
                        }
                    }

                    return true;
                }
            ),
            { numRuns: 100 }
        );
    });

    /**
     * Property 2: Correct Symbol Format Per Type
     * For any symbol returned from workspace symbol search, the SymbolInformation
     * SHALL have the correct kind and containerName for its type.
     *
     * Feature: workspace-symbol-completeness, Property 2: Correct Symbol Format Per Type
     * Validates: Requirements 1.2, 2.2, 3.2, 4.2
     */
    it('should return correct format per symbol type', () => {
        fc.assert(
            fc.property(
                fc.record({
                    programs: fc.array(fc.record({ name: arbitrary_identifier() }), { minLength: 1, maxLength: 2 }),
                    globalMacros: fc.array(fc.record({ name: arbitrary_identifier() }), { minLength: 1, maxLength: 2 }),
                    localMacros: fc.array(fc.record({ name: arbitrary_identifier() }), { minLength: 1, maxLength: 2 }),
                    variables: fc.array(fc.record({ name: arbitrary_identifier() }), { minLength: 1, maxLength: 2 }),
                    scalars: fc.array(fc.record({ name: arbitrary_identifier() }), { minLength: 1, maxLength: 2 }),
                    matrices: fc.array(fc.record({ name: arbitrary_identifier() }), { minLength: 1, maxLength: 2 }),
                }),
                (my_symbols) => {
                    const my_workspace_symbols = create_symbol_table(my_symbols);
                    const my_results = my_symbol_provider.get_workspace_symbols(
                        '',
                        [],
                        my_workspace_symbols
                    );

                    for (const my_result of my_results) {
                        switch (my_result.containerName) {
                            case 'Program':
                                if (my_result.kind !== SymbolKind.Function) return false;
                                break;
                            case 'Global Macro':
                                if (my_result.kind !== SymbolKind.Variable) return false;
                                break;
                            case 'Local Macro':
                                if (my_result.kind !== SymbolKind.Variable) return false;
                                // Local macros should have backtick-quote syntax
                                if (!my_result.name.startsWith('`') || !my_result.name.endsWith("'")) {
                                    return false;
                                }
                                break;
                            case 'Variable':
                                if (my_result.kind !== SymbolKind.Field) return false;
                                break;
                            case 'Scalar':
                                if (my_result.kind !== SymbolKind.Variable) return false;
                                break;
                            case 'Matrix':
                                if (my_result.kind !== SymbolKind.Variable) return false;
                                break;
                        }
                    }

                    return true;
                }
            ),
            { numRuns: 100 }
        );
    });

    /**
     * Property 3: Case-Insensitive Query Matching
     * For any symbol name and any query that is a case-variant substring of that
     * name, the symbol SHALL appear in the search results.
     *
     * Feature: workspace-symbol-completeness, Property 3: Case-Insensitive Query Matching
     * Validates: Requirements 6.1
     */
    it('should match symbols case-insensitively', () => {
        fc.assert(
            fc.property(
                arbitrary_identifier(),
                fc.constantFrom('upper', 'lower', 'mixed'),
                (my_name, my_case_variant) => {
                    // Create a query that is a case-variant of the name
                    let my_query: string;
                    switch (my_case_variant) {
                        case 'upper':
                            my_query = my_name.toUpperCase();
                            break;
                        case 'lower':
                            my_query = my_name.toLowerCase();
                            break;
                        case 'mixed':
                            my_query = my_name
                                .split('')
                                .map((c, i) => (i % 2 === 0 ? c.toUpperCase() : c.toLowerCase()))
                                .join('');
                            break;
                    }

                    const my_workspace_symbols = create_symbol_table({
                        variables: [{ name: my_name }],
                        scalars: [{ name: my_name }],
                        matrices: [{ name: my_name }],
                        localMacros: [{ name: my_name }],
                    });

                    const my_results = my_symbol_provider.get_workspace_symbols(
                        my_query,
                        [],
                        my_workspace_symbols
                    );

                    // Should find all 4 symbol types
                    return my_results.length === 4;
                }
            ),
            { numRuns: 100 }
        );
    });
});
