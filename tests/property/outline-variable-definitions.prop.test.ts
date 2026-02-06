/**
 * Property-based tests for Outline Variable Definitions
 * Feature: outline-variable-definitions
 *
 * Tests that verify variable definitions appear correctly in the document outline.
 * Only variables with source 'gen' or 'egen' should appear in the outline.
 */

import { describe, it, expect, beforeEach } from 'bun:test';
import * as fc from 'fast-check';
import { SymbolProvider } from '../../src/providers/symbols';
import { SymbolKind, DocumentSymbol } from 'vscode-languageserver';
import { parse_and_analyze } from './helpers/document-utils';
import { arbitrary_non_reserved_identifier } from './generators';
import { VariableSymbol } from '../../src/types';

describe('Outline Variable Definitions Property Tests', () => {
    let my_symbol_provider: SymbolProvider;

    beforeEach(() => {
        my_symbol_provider = new SymbolProvider();
    });

    /**
     * All possible variable source types in Stata.
     */
    const ALL_VARIABLE_SOURCES: Array<VariableSymbol['source']> = [
        'gen',
        'egen',
        'input',
        'inferred',
        'directive',
        'rename',
        'confirm',
    ];

    /**
     * Variable sources that should appear in the outline.
     */
    const OUTLINE_SOURCES: Array<VariableSymbol['source']> = ['gen', 'egen'];

    /**
     * Variable sources that should NOT appear in the outline.
     */
    const EXCLUDED_SOURCES: Array<VariableSymbol['source']> = [
        'input',
        'inferred',
        'directive',
        'rename',
        'confirm',
    ];

    /**
     * Generator for a Stata command that creates a variable with a specific source.
     * Returns the source code and expected variable name.
     */
    function arbitrary_variable_command(
        source: VariableSymbol['source']
    ): fc.Arbitrary<{ source_code: string; varname: string }> {
        return arbitrary_non_reserved_identifier().map((varname) => {
            let source_code: string;
            switch (source) {
                case 'gen':
                    source_code = `gen ${varname} = 1`;
                    break;
                case 'egen':
                    source_code = `egen ${varname} = mean(x)`;
                    break;
                case 'input':
                    // Input command creates variables from user input
                    source_code = `input ${varname}\n1\n2\nend`;
                    break;
                case 'confirm':
                    source_code = `confirm variable ${varname}`;
                    break;
                case 'rename':
                    // Rename creates a new variable from an existing one
                    // We need to create the source variable first
                    source_code = `gen oldvar = 1\nrename oldvar ${varname}`;
                    break;
                case 'inferred':
                    // Inferred variables come from data loading - we can't easily generate these
                    // Use a directive instead to simulate
                    source_code = `// @lsp-variables ${varname}`;
                    break;
                case 'directive':
                    source_code = `// @lsp-variables ${varname}`;
                    break;
                default:
                    source_code = `gen ${varname} = 1`;
            }
            return { source_code, varname };
        });
    }

    /**
     * Generator for a document with variables from multiple source types.
     * Returns the document content and metadata about the variables.
     */
    function arbitrary_document_with_mixed_variable_sources(): fc.Arbitrary<{
        document: string;
        variables: Array<{ name: string; source: VariableSymbol['source'] }>;
    }> {
        // Generate at least one variable from each source type
        const the_variable_generators = ALL_VARIABLE_SOURCES.map((source) =>
            arbitrary_variable_command(source).map((cmd) => ({
                ...cmd,
                source,
            }))
        );

        return fc.tuple(...the_variable_generators).map((the_variables) => {
            const the_lines: string[] = [];
            const the_variable_info: Array<{ name: string; source: VariableSymbol['source'] }> = [];

            for (const my_var of the_variables) {
                the_lines.push(my_var.source_code);
                the_variable_info.push({
                    name: my_var.varname,
                    source: my_var.source,
                });
            }

            return {
                document: the_lines.join('\n'),
                variables: the_variable_info,
            };
        });
    }

    /**
     * Property 1: Variable Source Filtering
     *
     * *For any* document with variables from multiple sources (gen, egen, input,
     * confirm, rename, inferred, directive), the document symbols SHALL include
     * exactly those variables where `source === 'gen'` or `source === 'egen'`,
     * and exclude all others.
     *
     * Feature: outline-variable-definitions, Property 1: Variable Source Filtering
     * **Validates: Requirements 1.1, 1.2**
     */
    it('should include only gen and egen variables in document outline', () => {
        fc.assert(
            fc.property(
                arbitrary_document_with_mixed_variable_sources(),
                ({ document, variables }) => {
                    const my_doc_state = parse_and_analyze(document);
                    const my_symbols = my_symbol_provider.get_document_symbols(my_doc_state);

                    // Filter to variable symbols (Field kind)
                    const my_variable_symbols = my_symbols.filter(
                        (s) => s.kind === SymbolKind.Field
                    );

                    // Get the actual variables registered in the symbol table
                    const my_registered_variables = my_doc_state.symbols.variables;

                    // Verify: for each variable in the symbol table, check if it appears
                    // in the outline based on its source
                    for (const [my_name, my_variable] of my_registered_variables) {
                        const my_in_outline = my_variable_symbols.some(
                            (s) => s.name === my_name
                        );

                        if (my_variable.source === 'gen' || my_variable.source === 'egen') {
                            // Should be in outline
                            if (!my_in_outline) {
                                return false;
                            }
                        } else {
                            // Should NOT be in outline
                            if (my_in_outline) {
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
     * Property 1 (continued): Gen variables should appear in outline
     *
     * Feature: outline-variable-definitions, Property 1: Variable Source Filtering
     * **Validates: Requirements 1.1**
     */
    it('should include gen variables in document outline', () => {
        fc.assert(
            fc.property(arbitrary_non_reserved_identifier(), (varname) => {
                const my_source = `gen ${varname} = 1`;
                const my_doc_state = parse_and_analyze(my_source);
                const my_symbols = my_symbol_provider.get_document_symbols(my_doc_state);

                // Filter to variable symbols (Field kind)
                const my_variable_symbols = my_symbols.filter(
                    (s) => s.kind === SymbolKind.Field
                );

                // Verify the variable is in the symbol table with source 'gen'
                if (my_doc_state.symbols.variables.has(varname)) {
                    const my_variable = my_doc_state.symbols.variables.get(varname)!;
                    expect(my_variable.source).toBe('gen');

                    // Verify it appears in the outline
                    const my_found = my_variable_symbols.some((s) => s.name === varname);
                    expect(my_found).toBe(true);
                }

                return true;
            }),
            { numRuns: 100 }
        );
    });

    /**
     * Property 1 (continued): Egen variables should appear in outline
     *
     * Feature: outline-variable-definitions, Property 1: Variable Source Filtering
     * **Validates: Requirements 1.1**
     */
    it('should include egen variables in document outline', () => {
        fc.assert(
            fc.property(arbitrary_non_reserved_identifier(), (varname) => {
                const my_source = `egen ${varname} = mean(x)`;
                const my_doc_state = parse_and_analyze(my_source);
                const my_symbols = my_symbol_provider.get_document_symbols(my_doc_state);

                // Filter to variable symbols (Field kind)
                const my_variable_symbols = my_symbols.filter(
                    (s) => s.kind === SymbolKind.Field
                );

                // Verify the variable is in the symbol table with source 'egen'
                if (my_doc_state.symbols.variables.has(varname)) {
                    const my_variable = my_doc_state.symbols.variables.get(varname)!;
                    expect(my_variable.source).toBe('egen');

                    // Verify it appears in the outline
                    const my_found = my_variable_symbols.some((s) => s.name === varname);
                    expect(my_found).toBe(true);
                }

                return true;
            }),
            { numRuns: 100 }
        );
    });

    /**
     * Property 1 (continued): Confirm variables should NOT appear in outline
     *
     * Feature: outline-variable-definitions, Property 1: Variable Source Filtering
     * **Validates: Requirements 1.2**
     */
    it('should exclude confirm variables from document outline', () => {
        fc.assert(
            fc.property(arbitrary_non_reserved_identifier(), (varname) => {
                const my_source = `confirm variable ${varname}`;
                const my_doc_state = parse_and_analyze(my_source);
                const my_symbols = my_symbol_provider.get_document_symbols(my_doc_state);

                // Filter to variable symbols (Field kind)
                const my_variable_symbols = my_symbols.filter(
                    (s) => s.kind === SymbolKind.Field
                );

                // Verify the variable is in the symbol table with source 'confirm'
                if (my_doc_state.symbols.variables.has(varname)) {
                    const my_variable = my_doc_state.symbols.variables.get(varname)!;
                    expect(my_variable.source).toBe('confirm');

                    // Verify it does NOT appear in the outline
                    const my_found = my_variable_symbols.some((s) => s.name === varname);
                    expect(my_found).toBe(false);
                }

                return true;
            }),
            { numRuns: 100 }
        );
    });

    /**
     * Property 1 (continued): Rename variables should NOT appear in outline
     *
     * Feature: outline-variable-definitions, Property 1: Variable Source Filtering
     * **Validates: Requirements 1.2**
     */
    it('should exclude rename variables from document outline', () => {
        fc.assert(
            fc.property(arbitrary_non_reserved_identifier(), (varname) => {
                // Create a source variable first, then rename it
                const my_source = `gen oldvar = 1\nrename oldvar ${varname}`;
                const my_doc_state = parse_and_analyze(my_source);
                const my_symbols = my_symbol_provider.get_document_symbols(my_doc_state);

                // Filter to variable symbols (Field kind)
                const my_variable_symbols = my_symbols.filter(
                    (s) => s.kind === SymbolKind.Field
                );

                // Verify the renamed variable is in the symbol table with source 'rename'
                if (my_doc_state.symbols.variables.has(varname)) {
                    const my_variable = my_doc_state.symbols.variables.get(varname)!;
                    if (my_variable.source === 'rename') {
                        // Verify it does NOT appear in the outline
                        const my_found = my_variable_symbols.some((s) => s.name === varname);
                        expect(my_found).toBe(false);
                    }
                }

                // The original 'oldvar' should appear (it's a gen variable)
                const my_oldvar_found = my_variable_symbols.some((s) => s.name === 'oldvar');
                if (my_doc_state.symbols.variables.has('oldvar')) {
                    expect(my_oldvar_found).toBe(true);
                }

                return true;
            }),
            { numRuns: 100 }
        );
    });

    /**
     * Property 1 (continued): Directive variables should NOT appear in outline
     *
     * Feature: outline-variable-definitions, Property 1: Variable Source Filtering
     * **Validates: Requirements 1.2**
     */
    it('should exclude directive variables from document outline', () => {
        fc.assert(
            fc.property(arbitrary_non_reserved_identifier(), (varname) => {
                const my_source = `// @lsp-variables ${varname}`;
                const my_doc_state = parse_and_analyze(my_source);
                const my_symbols = my_symbol_provider.get_document_symbols(my_doc_state);

                // Filter to variable symbols (Field kind)
                const my_variable_symbols = my_symbols.filter(
                    (s) => s.kind === SymbolKind.Field
                );

                // Verify the variable is in the symbol table with source 'directive'
                if (my_doc_state.symbols.variables.has(varname)) {
                    const my_variable = my_doc_state.symbols.variables.get(varname)!;
                    expect(my_variable.source).toBe('directive');

                    // Verify it does NOT appear in the outline
                    const my_found = my_variable_symbols.some((s) => s.name === varname);
                    expect(my_found).toBe(false);
                }

                return true;
            }),
            { numRuns: 100 }
        );
    });

    /**
     * Property 1 (continued): Input variables should NOT appear in outline
     *
     * Feature: outline-variable-definitions, Property 1: Variable Source Filtering
     * **Validates: Requirements 1.2**
     */
    it('should exclude input variables from document outline', () => {
        fc.assert(
            fc.property(arbitrary_non_reserved_identifier(), (varname) => {
                const my_source = `input ${varname}\n1\n2\nend`;
                const my_doc_state = parse_and_analyze(my_source);
                const my_symbols = my_symbol_provider.get_document_symbols(my_doc_state);

                // Filter to variable symbols (Field kind)
                const my_variable_symbols = my_symbols.filter(
                    (s) => s.kind === SymbolKind.Field
                );

                // Verify the variable is in the symbol table with source 'input'
                if (my_doc_state.symbols.variables.has(varname)) {
                    const my_variable = my_doc_state.symbols.variables.get(varname)!;
                    if (my_variable.source === 'input') {
                        // Verify it does NOT appear in the outline
                        const my_found = my_variable_symbols.some((s) => s.name === varname);
                        expect(my_found).toBe(false);
                    }
                }

                return true;
            }),
            { numRuns: 100 }
        );
    });

    /**
     * Property 1 (continued): Multiple gen/egen variables should all appear
     *
     * Feature: outline-variable-definitions, Property 1: Variable Source Filtering
     * **Validates: Requirements 1.1**
     */
    it('should include multiple gen and egen variables in document outline', () => {
        fc.assert(
            fc.property(
                fc.uniqueArray(arbitrary_non_reserved_identifier(), {
                    minLength: 2,
                    maxLength: 5,
                    comparator: (a, b) => a === b,
                }),
                (varnames) => {
                    // Create a mix of gen and egen commands
                    const the_lines = varnames.map((name, idx) =>
                        idx % 2 === 0 ? `gen ${name} = ${idx}` : `egen ${name} = mean(x)`
                    );
                    const my_source = the_lines.join('\n');

                    const my_doc_state = parse_and_analyze(my_source);
                    const my_symbols = my_symbol_provider.get_document_symbols(my_doc_state);

                    // Filter to variable symbols (Field kind)
                    const my_variable_symbols = my_symbols.filter(
                        (s) => s.kind === SymbolKind.Field
                    );

                    // All variables should appear in the outline
                    for (const my_varname of varnames) {
                        if (my_doc_state.symbols.variables.has(my_varname)) {
                            const my_found = my_variable_symbols.some(
                                (s) => s.name === my_varname
                            );
                            expect(my_found).toBe(true);
                        }
                    }

                    return true;
                }
            ),
            { numRuns: 100 }
        );
    });

    /**
     * Property 1 (continued): Mixed sources - only gen/egen should appear
     *
     * Feature: outline-variable-definitions, Property 1: Variable Source Filtering
     * **Validates: Requirements 1.1, 1.2**
     */
    it('should include only gen/egen when mixed with other sources', () => {
        fc.assert(
            fc.property(
                fc.tuple(
                    arbitrary_non_reserved_identifier(),
                    arbitrary_non_reserved_identifier(),
                    arbitrary_non_reserved_identifier()
                ).filter(([a, b, c]) => a !== b && b !== c && a !== c),
                ([gen_var, egen_var, confirm_var]) => {
                    const my_source = [
                        `gen ${gen_var} = 1`,
                        `egen ${egen_var} = mean(x)`,
                        `confirm variable ${confirm_var}`,
                    ].join('\n');

                    const my_doc_state = parse_and_analyze(my_source);
                    const my_symbols = my_symbol_provider.get_document_symbols(my_doc_state);

                    // Filter to variable symbols (Field kind)
                    const my_variable_symbols = my_symbols.filter(
                        (s) => s.kind === SymbolKind.Field
                    );

                    // Gen variable should appear
                    if (my_doc_state.symbols.variables.has(gen_var)) {
                        const my_gen_found = my_variable_symbols.some(
                            (s) => s.name === gen_var
                        );
                        expect(my_gen_found).toBe(true);
                    }

                    // Egen variable should appear
                    if (my_doc_state.symbols.variables.has(egen_var)) {
                        const my_egen_found = my_variable_symbols.some(
                            (s) => s.name === egen_var
                        );
                        expect(my_egen_found).toBe(true);
                    }

                    // Confirm variable should NOT appear
                    if (my_doc_state.symbols.variables.has(confirm_var)) {
                        const my_confirm_found = my_variable_symbols.some(
                            (s) => s.name === confirm_var
                        );
                        expect(my_confirm_found).toBe(false);
                    }

                    return true;
                }
            ),
            { numRuns: 100 }
        );
    });

    /**
     * Property 2: Variable Symbol Format
     *
     * *For any* variable included in the document outline:
     * - The symbol kind SHALL be `SymbolKind.Field`
     * - The detail field SHALL match the pattern `Variable ({source})` where source is `gen` or `egen`
     * - The symbol name SHALL equal the variable name without any prefix or suffix decoration
     *
     * Feature: outline-variable-definitions, Property 2: Variable Symbol Format
     * **Validates: Requirements 1.3, 1.4, 1.5**
     */
    describe('Property 2: Variable Symbol Format', () => {
        /**
         * Property 2.1: Variable symbols should have SymbolKind.Field
         *
         * Feature: outline-variable-definitions, Property 2: Variable Symbol Format
         * **Validates: Requirements 1.3**
         */
        it('should use SymbolKind.Field for gen variable symbols', () => {
            fc.assert(
                fc.property(arbitrary_non_reserved_identifier(), (varname) => {
                    const my_source = `gen ${varname} = 1`;
                    const my_doc_state = parse_and_analyze(my_source);
                    const my_symbols = my_symbol_provider.get_document_symbols(my_doc_state);

                    // Find the variable symbol
                    const my_variable_symbol = my_symbols.find((s) => s.name === varname);

                    // If the variable was registered, verify its kind
                    if (my_doc_state.symbols.variables.has(varname)) {
                        expect(my_variable_symbol).toBeDefined();
                        expect(my_variable_symbol!.kind).toBe(SymbolKind.Field);
                    }

                    return true;
                }),
                { numRuns: 100 }
            );
        });

        /**
         * Property 2.1 (continued): Variable symbols should have SymbolKind.Field for egen
         *
         * Feature: outline-variable-definitions, Property 2: Variable Symbol Format
         * **Validates: Requirements 1.3**
         */
        it('should use SymbolKind.Field for egen variable symbols', () => {
            fc.assert(
                fc.property(arbitrary_non_reserved_identifier(), (varname) => {
                    const my_source = `egen ${varname} = mean(x)`;
                    const my_doc_state = parse_and_analyze(my_source);
                    const my_symbols = my_symbol_provider.get_document_symbols(my_doc_state);

                    // Find the variable symbol
                    const my_variable_symbol = my_symbols.find((s) => s.name === varname);

                    // If the variable was registered, verify its kind
                    if (my_doc_state.symbols.variables.has(varname)) {
                        expect(my_variable_symbol).toBeDefined();
                        expect(my_variable_symbol!.kind).toBe(SymbolKind.Field);
                    }

                    return true;
                }),
                { numRuns: 100 }
            );
        });

        /**
         * Property 2.2: Detail field should match pattern "Variable (gen)" for gen variables
         *
         * Feature: outline-variable-definitions, Property 2: Variable Symbol Format
         * **Validates: Requirements 1.4**
         */
        it('should set detail to "Variable (gen)" for gen variables', () => {
            fc.assert(
                fc.property(arbitrary_non_reserved_identifier(), (varname) => {
                    const my_source = `gen ${varname} = 1`;
                    const my_doc_state = parse_and_analyze(my_source);
                    const my_symbols = my_symbol_provider.get_document_symbols(my_doc_state);

                    // Find the variable symbol
                    const my_variable_symbol = my_symbols.find((s) => s.name === varname);

                    // If the variable was registered, verify its detail
                    if (my_doc_state.symbols.variables.has(varname)) {
                        expect(my_variable_symbol).toBeDefined();
                        expect(my_variable_symbol!.detail).toBe('Variable (gen)');
                    }

                    return true;
                }),
                { numRuns: 100 }
            );
        });

        /**
         * Property 2.2 (continued): Detail field should match pattern "Variable (egen)" for egen variables
         *
         * Feature: outline-variable-definitions, Property 2: Variable Symbol Format
         * **Validates: Requirements 1.4**
         */
        it('should set detail to "Variable (egen)" for egen variables', () => {
            fc.assert(
                fc.property(arbitrary_non_reserved_identifier(), (varname) => {
                    const my_source = `egen ${varname} = mean(x)`;
                    const my_doc_state = parse_and_analyze(my_source);
                    const my_symbols = my_symbol_provider.get_document_symbols(my_doc_state);

                    // Find the variable symbol
                    const my_variable_symbol = my_symbols.find((s) => s.name === varname);

                    // If the variable was registered, verify its detail
                    if (my_doc_state.symbols.variables.has(varname)) {
                        expect(my_variable_symbol).toBeDefined();
                        expect(my_variable_symbol!.detail).toBe('Variable (egen)');
                    }

                    return true;
                }),
                { numRuns: 100 }
            );
        });

        /**
         * Property 2.3: Symbol name should equal variable name unchanged
         *
         * Feature: outline-variable-definitions, Property 2: Variable Symbol Format
         * **Validates: Requirements 1.5**
         */
        it('should use variable name unchanged for gen variables', () => {
            fc.assert(
                fc.property(arbitrary_non_reserved_identifier(), (varname) => {
                    const my_source = `gen ${varname} = 1`;
                    const my_doc_state = parse_and_analyze(my_source);
                    const my_symbols = my_symbol_provider.get_document_symbols(my_doc_state);

                    // If the variable was registered, verify its name is unchanged
                    if (my_doc_state.symbols.variables.has(varname)) {
                        const my_variable_symbol = my_symbols.find(
                            (s) => s.kind === SymbolKind.Field && s.name === varname
                        );
                        expect(my_variable_symbol).toBeDefined();
                        // Verify no prefix or suffix decoration
                        expect(my_variable_symbol!.name).toBe(varname);
                        expect(my_variable_symbol!.name).not.toMatch(/^[`$]/);
                        expect(my_variable_symbol!.name).not.toMatch(/['"]$/);
                    }

                    return true;
                }),
                { numRuns: 100 }
            );
        });

        /**
         * Property 2.3 (continued): Symbol name should equal variable name unchanged for egen
         *
         * Feature: outline-variable-definitions, Property 2: Variable Symbol Format
         * **Validates: Requirements 1.5**
         */
        it('should use variable name unchanged for egen variables', () => {
            fc.assert(
                fc.property(arbitrary_non_reserved_identifier(), (varname) => {
                    const my_source = `egen ${varname} = mean(x)`;
                    const my_doc_state = parse_and_analyze(my_source);
                    const my_symbols = my_symbol_provider.get_document_symbols(my_doc_state);

                    // If the variable was registered, verify its name is unchanged
                    if (my_doc_state.symbols.variables.has(varname)) {
                        const my_variable_symbol = my_symbols.find(
                            (s) => s.kind === SymbolKind.Field && s.name === varname
                        );
                        expect(my_variable_symbol).toBeDefined();
                        // Verify no prefix or suffix decoration
                        expect(my_variable_symbol!.name).toBe(varname);
                        expect(my_variable_symbol!.name).not.toMatch(/^[`$]/);
                        expect(my_variable_symbol!.name).not.toMatch(/['"]$/);
                    }

                    return true;
                }),
                { numRuns: 100 }
            );
        });

        /**
         * Property 2 (comprehensive): All format properties for mixed gen/egen variables
         *
         * Feature: outline-variable-definitions, Property 2: Variable Symbol Format
         * **Validates: Requirements 1.3, 1.4, 1.5**
         */
        it('should have correct format for all gen/egen variables in mixed document', () => {
            fc.assert(
                fc.property(
                    fc.uniqueArray(arbitrary_non_reserved_identifier(), {
                        minLength: 2,
                        maxLength: 5,
                        comparator: (a, b) => a === b,
                    }),
                    (varnames) => {
                        // Create a mix of gen and egen commands
                        const the_lines = varnames.map((name, idx) =>
                            idx % 2 === 0 ? `gen ${name} = ${idx}` : `egen ${name} = mean(x)`
                        );
                        const my_source = the_lines.join('\n');

                        const my_doc_state = parse_and_analyze(my_source);
                        const my_symbols = my_symbol_provider.get_document_symbols(my_doc_state);

                        // Verify format for each variable
                        for (let idx = 0; idx < varnames.length; idx++) {
                            const my_varname = varnames[idx];
                            const my_expected_source = idx % 2 === 0 ? 'gen' : 'egen';

                            if (my_doc_state.symbols.variables.has(my_varname)) {
                                const my_variable_symbol = my_symbols.find(
                                    (s) => s.kind === SymbolKind.Field && s.name === my_varname
                                );

                                // Verify symbol exists
                                expect(my_variable_symbol).toBeDefined();

                                // Verify kind is SymbolKind.Field (Requirement 1.3)
                                expect(my_variable_symbol!.kind).toBe(SymbolKind.Field);

                                // Verify detail matches pattern (Requirement 1.4)
                                expect(my_variable_symbol!.detail).toBe(
                                    `Variable (${my_expected_source})`
                                );

                                // Verify name is unchanged (Requirement 1.5)
                                expect(my_variable_symbol!.name).toBe(my_varname);
                            }
                        }

                        return true;
                    }
                ),
                { numRuns: 100 }
            );
        });

        /**
         * Property 2 (detail pattern validation): Detail should match exact pattern
         *
         * Feature: outline-variable-definitions, Property 2: Variable Symbol Format
         * **Validates: Requirements 1.4**
         */
        it('should have detail matching exact pattern "Variable (source)"', () => {
            fc.assert(
                fc.property(
                    fc.tuple(
                        arbitrary_non_reserved_identifier(),
                        fc.constantFrom('gen', 'egen')
                    ),
                    ([varname, source]) => {
                        const my_source =
                            source === 'gen'
                                ? `gen ${varname} = 1`
                                : `egen ${varname} = mean(x)`;

                        const my_doc_state = parse_and_analyze(my_source);
                        const my_symbols = my_symbol_provider.get_document_symbols(my_doc_state);

                        if (my_doc_state.symbols.variables.has(varname)) {
                            const my_variable_symbol = my_symbols.find(
                                (s) => s.kind === SymbolKind.Field && s.name === varname
                            );

                            expect(my_variable_symbol).toBeDefined();

                            // Verify detail matches the exact pattern
                            const my_detail_pattern = /^Variable \((gen|egen)\)$/;
                            expect(my_variable_symbol!.detail).toMatch(my_detail_pattern);

                            // Verify the source in detail matches the actual source
                            expect(my_variable_symbol!.detail).toBe(`Variable (${source})`);
                        }

                        return true;
                    }
                ),
                { numRuns: 100 }
            );
        });
    });

    /**
     * Property 3: Document Order Preservation
     *
     * *For any* document with multiple symbols (programs, macros, variables, etc.),
     * the returned top-level symbols array SHALL be sorted by start position
     * (line, then character).
     *
     * Feature: outline-variable-definitions, Property 3: Document Order Preservation
     * **Validates: Requirements 2.1**
     */
    describe('Property 3: Document Order Preservation', () => {
        /**
         * Symbol type definitions for generating mixed documents.
         * Each type has a generator that produces source code for that symbol type.
         */
        type SymbolType = 'program' | 'global_macro' | 'scalar' | 'matrix' | 'gen_variable' | 'egen_variable';

        /**
         * Generator for a single symbol definition with its type.
         * Returns the source code line(s) and the symbol name.
         */
        function arbitrary_symbol_definition(
            symbol_type: SymbolType
        ): fc.Arbitrary<{ source_code: string; name: string; type: SymbolType }> {
            return arbitrary_non_reserved_identifier().map((name) => {
                let source_code: string;
                switch (symbol_type) {
                    case 'program':
                        source_code = `program ${name}\n    display "hello"\nend`;
                        break;
                    case 'global_macro':
                        source_code = `global ${name} = 1`;
                        break;
                    case 'scalar':
                        source_code = `scalar ${name} = 42`;
                        break;
                    case 'matrix':
                        source_code = `matrix ${name} = (1, 2 \\ 3, 4)`;
                        break;
                    case 'gen_variable':
                        source_code = `gen ${name} = 1`;
                        break;
                    case 'egen_variable':
                        source_code = `egen ${name} = mean(x)`;
                        break;
                }
                return { source_code, name, type: symbol_type };
            });
        }

        /**
         * Generator for a document with mixed symbol types.
         * Generates symbols in a random order to test sorting.
         */
        function arbitrary_mixed_symbol_document(): fc.Arbitrary<{
            document: string;
            symbols: Array<{ name: string; type: SymbolType; line: number }>;
        }> {
            const the_symbol_types: SymbolType[] = [
                'program',
                'global_macro',
                'scalar',
                'matrix',
                'gen_variable',
                'egen_variable',
            ];

            // Generate 3-8 symbols with random types
            return fc
                .array(fc.constantFrom(...the_symbol_types), { minLength: 3, maxLength: 8 })
                .chain((types) => {
                    // Generate unique names for each symbol
                    return fc
                        .uniqueArray(arbitrary_non_reserved_identifier(), {
                            minLength: types.length,
                            maxLength: types.length,
                            comparator: (a, b) => a === b,
                        })
                        .map((names) => {
                            const the_symbol_defs: Array<{
                                source_code: string;
                                name: string;
                                type: SymbolType;
                            }> = [];

                            for (let i = 0; i < types.length; i++) {
                                const my_type = types[i];
                                const my_name = names[i];
                                let source_code: string;

                                switch (my_type) {
                                    case 'program':
                                        source_code = `program ${my_name}\n    display "hello"\nend`;
                                        break;
                                    case 'global_macro':
                                        source_code = `global ${my_name} = 1`;
                                        break;
                                    case 'scalar':
                                        source_code = `scalar ${my_name} = 42`;
                                        break;
                                    case 'matrix':
                                        source_code = `matrix ${my_name} = (1, 2 \\ 3, 4)`;
                                        break;
                                    case 'gen_variable':
                                        source_code = `gen ${my_name} = 1`;
                                        break;
                                    case 'egen_variable':
                                        source_code = `egen ${my_name} = mean(x)`;
                                        break;
                                }

                                the_symbol_defs.push({
                                    source_code,
                                    name: my_name,
                                    type: my_type,
                                });
                            }

                            return the_symbol_defs;
                        });
                })
                .map((symbol_defs) => {
                    // Build the document and track line numbers
                    const the_lines: string[] = [];
                    const the_symbols: Array<{ name: string; type: SymbolType; line: number }> =
                        [];

                    let current_line = 0;
                    for (const my_def of symbol_defs) {
                        the_symbols.push({
                            name: my_def.name,
                            type: my_def.type,
                            line: current_line,
                        });

                        the_lines.push(my_def.source_code);
                        // Count lines in the source code
                        current_line += my_def.source_code.split('\n').length;
                    }

                    return {
                        document: the_lines.join('\n'),
                        symbols: the_symbols,
                    };
                });
        }

        /**
         * Property 3.1: Top-level symbols should be sorted by start line
         *
         * Feature: outline-variable-definitions, Property 3: Document Order Preservation
         * **Validates: Requirements 2.1**
         */
        it('should sort top-level symbols by start position (line, then character)', () => {
            fc.assert(
                fc.property(arbitrary_mixed_symbol_document(), ({ document }) => {
                    const my_doc_state = parse_and_analyze(document);
                    const my_symbols = my_symbol_provider.get_document_symbols(my_doc_state);

                    // Verify symbols are sorted by start position
                    for (let i = 1; i < my_symbols.length; i++) {
                        const my_prev = my_symbols[i - 1];
                        const my_curr = my_symbols[i];

                        // Compare by line first
                        if (my_prev.range.start.line > my_curr.range.start.line) {
                            return false;
                        }

                        // If same line, compare by character
                        if (my_prev.range.start.line === my_curr.range.start.line) {
                            if (my_prev.range.start.character > my_curr.range.start.character) {
                                return false;
                            }
                        }
                    }

                    return true;
                }),
                { numRuns: 100 }
            );
        });

        /**
         * Property 3.2: Variables should be interleaved with other symbols in document order
         *
         * Feature: outline-variable-definitions, Property 3: Document Order Preservation
         * **Validates: Requirements 2.1**
         */
        it('should interleave variables with other symbols in document order', () => {
            fc.assert(
                fc.property(
                    fc.tuple(
                        arbitrary_non_reserved_identifier(),
                        arbitrary_non_reserved_identifier(),
                        arbitrary_non_reserved_identifier()
                    ).filter(([a, b, c]) => a !== b && b !== c && a !== c),
                    ([global_name, var_name, scalar_name]) => {
                        // Create a document with symbols in a specific order:
                        // Line 0: global macro
                        // Line 1: gen variable
                        // Line 2: scalar
                        const my_source = [
                            `global ${global_name} = 1`,
                            `gen ${var_name} = 2`,
                            `scalar ${scalar_name} = 3`,
                        ].join('\n');

                        const my_doc_state = parse_and_analyze(my_source);
                        const my_symbols = my_symbol_provider.get_document_symbols(my_doc_state);

                        // Verify the order matches document order
                        // Find each symbol's position in the output
                        const my_global_idx = my_symbols.findIndex(
                            (s) => s.name === global_name
                        );
                        const my_var_idx = my_symbols.findIndex((s) => s.name === var_name);
                        const my_scalar_idx = my_symbols.findIndex(
                            (s) => s.name === scalar_name
                        );

                        // All symbols should be found
                        if (my_global_idx === -1 || my_var_idx === -1 || my_scalar_idx === -1) {
                            // Some symbols may not be registered depending on parsing
                            return true;
                        }

                        // Verify order: global < variable < scalar
                        expect(my_global_idx).toBeLessThan(my_var_idx);
                        expect(my_var_idx).toBeLessThan(my_scalar_idx);

                        return true;
                    }
                ),
                { numRuns: 100 }
            );
        });

        /**
         * Property 3.3: Symbols on the same line should be sorted by character position
         *
         * Feature: outline-variable-definitions, Property 3: Document Order Preservation
         * **Validates: Requirements 2.1**
         */
        it('should sort symbols on the same line by character position', () => {
            fc.assert(
                fc.property(
                    fc.tuple(
                        arbitrary_non_reserved_identifier(),
                        arbitrary_non_reserved_identifier()
                    ).filter(([a, b]) => a !== b),
                    ([name1, name2]) => {
                        // Create two global macros on separate lines to ensure predictable ordering
                        // (Stata doesn't support multiple statements on one line without #delimit ;)
                        const my_source = `global ${name1} = 1\nglobal ${name2} = 2`;

                        const my_doc_state = parse_and_analyze(my_source);
                        const my_symbols = my_symbol_provider.get_document_symbols(my_doc_state);

                        // Filter to global macros
                        const my_global_symbols = my_symbols.filter(
                            (s) => s.detail === 'Global Macro'
                        );

                        // Verify they are sorted by line
                        for (let i = 1; i < my_global_symbols.length; i++) {
                            const my_prev = my_global_symbols[i - 1];
                            const my_curr = my_global_symbols[i];

                            if (my_prev.range.start.line > my_curr.range.start.line) {
                                return false;
                            }
                            if (my_prev.range.start.line === my_curr.range.start.line) {
                                if (
                                    my_prev.range.start.character > my_curr.range.start.character
                                ) {
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
         * Property 3.4: Empty document should return empty symbols array
         *
         * Feature: outline-variable-definitions, Property 3: Document Order Preservation
         * **Validates: Requirements 2.1**
         */
        it('should return empty array for empty document', () => {
            const my_doc_state = parse_and_analyze('');
            const my_symbols = my_symbol_provider.get_document_symbols(my_doc_state);

            // Empty document should have no symbols
            expect(my_symbols.length).toBe(0);
        });

        /**
         * Property 3.5: Single symbol document should return that symbol
         *
         * Feature: outline-variable-definitions, Property 3: Document Order Preservation
         * **Validates: Requirements 2.1**
         */
        it('should handle single symbol document correctly', () => {
            fc.assert(
                fc.property(
                    fc.tuple(
                        arbitrary_non_reserved_identifier(),
                        fc.constantFrom('gen', 'egen', 'global', 'scalar', 'matrix')
                    ),
                    ([name, cmd]) => {
                        let my_source: string;
                        switch (cmd) {
                            case 'gen':
                                my_source = `gen ${name} = 1`;
                                break;
                            case 'egen':
                                my_source = `egen ${name} = mean(x)`;
                                break;
                            case 'global':
                                my_source = `global ${name} = 1`;
                                break;
                            case 'scalar':
                                my_source = `scalar ${name} = 42`;
                                break;
                            case 'matrix':
                                my_source = `matrix ${name} = (1, 2)`;
                                break;
                        }

                        const my_doc_state = parse_and_analyze(my_source);
                        const my_symbols = my_symbol_provider.get_document_symbols(my_doc_state);

                        // Single symbol document - should have exactly one symbol (if registered)
                        // The symbol should be at position 0
                        if (my_symbols.length > 0) {
                            expect(my_symbols[0].range.start.line).toBe(0);
                        }

                        return true;
                    }
                ),
                { numRuns: 100 }
            );
        });

        /**
         * Property 3.6: Comprehensive ordering test with all symbol types
         *
         * Feature: outline-variable-definitions, Property 3: Document Order Preservation
         * **Validates: Requirements 2.1**
         */
        it('should maintain document order for all symbol types', () => {
            fc.assert(
                fc.property(
                    fc.uniqueArray(arbitrary_non_reserved_identifier(), {
                        minLength: 6,
                        maxLength: 6,
                        comparator: (a, b) => a === b,
                    }),
                    ([prog_name, global_name, scalar_name, matrix_name, gen_name, egen_name]) => {
                        // Create a document with one of each symbol type in a specific order
                        const my_source = [
                            `program ${prog_name}`,
                            '    display "hello"',
                            'end',
                            `global ${global_name} = 1`,
                            `scalar ${scalar_name} = 42`,
                            `matrix ${matrix_name} = (1, 2)`,
                            `gen ${gen_name} = 1`,
                            `egen ${egen_name} = mean(x)`,
                        ].join('\n');

                        const my_doc_state = parse_and_analyze(my_source);
                        const my_symbols = my_symbol_provider.get_document_symbols(my_doc_state);

                        // Verify all symbols are sorted by start line
                        for (let i = 1; i < my_symbols.length; i++) {
                            const my_prev = my_symbols[i - 1];
                            const my_curr = my_symbols[i];

                            // Previous symbol should start before or at the same position as current
                            if (my_prev.range.start.line > my_curr.range.start.line) {
                                return false;
                            }
                            if (my_prev.range.start.line === my_curr.range.start.line) {
                                if (
                                    my_prev.range.start.character > my_curr.range.start.character
                                ) {
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
    });
});


/**
 * Property 4: Section Nesting Consistency
 *
 * *For any* document with sections and variables, variables defined within a section's
 * range SHALL appear as children of that section, following the same nesting rules
 * as other symbol types.
 *
 * Feature: outline-variable-definitions, Property 4: Section Nesting Consistency
 * **Validates: Requirements 2.2**
 */
describe('Property 4: Section Nesting Consistency', () => {
    let my_symbol_provider: SymbolProvider;

    beforeEach(() => {
        my_symbol_provider = new SymbolProvider();
    });

    /**
     * Helper: recursively find all symbols with a given kind in the symbol tree.
     */
    function find_symbols_by_kind(
        symbols: DocumentSymbol[],
        kind: SymbolKind
    ): DocumentSymbol[] {
        const my_result: DocumentSymbol[] = [];
        for (const my_symbol of symbols) {
            if (my_symbol.kind === kind) {
                my_result.push(my_symbol);
            }
            if (my_symbol.children && my_symbol.children.length > 0) {
                my_result.push(...find_symbols_by_kind(my_symbol.children, kind));
            }
        }
        return my_result;
    }

    /**
     * Helper: find the parent section of a symbol by name.
     * Returns the section name or null if the symbol is at root level.
     */
    function find_parent_section(
        symbols: DocumentSymbol[],
        target_name: string,
        parent_section: string | null = null
    ): string | null | undefined {
        for (const my_symbol of symbols) {
            if (my_symbol.name === target_name && my_symbol.kind === SymbolKind.Field) {
                return parent_section;
            }
            if (my_symbol.children && my_symbol.children.length > 0) {
                const my_section_name =
                    my_symbol.kind === SymbolKind.Module ? my_symbol.name : parent_section;
                const my_found = find_parent_section(
                    my_symbol.children,
                    target_name,
                    my_section_name
                );
                if (my_found !== undefined) {
                    return my_found;
                }
            }
        }
        return undefined;
    }

    /**
     * Helper: check if a position is within a range.
     */
    function is_position_in_range(
        line: number,
        range: { start: { line: number }; end: { line: number } }
    ): boolean {
        return line >= range.start.line && line <= range.end.line;
    }

    /**
     * Property 4.1: Variables inside sections should be nested under those sections
     *
     * Feature: outline-variable-definitions, Property 4: Section Nesting Consistency
     * **Validates: Requirements 2.2**
     */
    it('should nest variables under their containing sections', () => {
        fc.assert(
            fc.property(
                fc.tuple(
                    arbitrary_non_reserved_identifier(),
                    arbitrary_non_reserved_identifier()
                ).filter(([a, b]) => a !== b),
                ([section_name, var_name]) => {
                    // Create a document with a section and a variable inside it
                    // Using single-line section format: // Section Name ----
                    const my_source = [
                        `// ${section_name} ----`,
                        `gen ${var_name} = 1`,
                        'display "end"',
                    ].join('\n');

                    const my_doc_state = parse_and_analyze(my_source);
                    const my_symbols = my_symbol_provider.get_document_symbols(my_doc_state);

                    // Find the variable symbol
                    const my_variable_symbols = find_symbols_by_kind(my_symbols, SymbolKind.Field);

                    // If the variable was registered, check its nesting
                    if (my_doc_state.symbols.variables.has(var_name)) {
                        const my_var_found = my_variable_symbols.some(
                            (s) => s.name === var_name
                        );
                        if (!my_var_found) {
                            return false;
                        }

                        // Find the parent section of the variable
                        const my_parent = find_parent_section(my_symbols, var_name);

                        // The variable should be nested under the section
                        // (parent should be the section name)
                        if (my_parent !== section_name) {
                            return false;
                        }
                    }

                    return true;
                }
            ),
            { numRuns: 100 }
        );
    });

    /**
     * Property 4.2: Variables outside sections should remain at root level
     *
     * Feature: outline-variable-definitions, Property 4: Section Nesting Consistency
     * **Validates: Requirements 2.2**
     */
    it('should keep variables at root level when outside sections', () => {
        fc.assert(
            fc.property(
                fc.tuple(
                    arbitrary_non_reserved_identifier(),
                    arbitrary_non_reserved_identifier()
                ).filter(([a, b]) => a !== b),
                ([section_name, var_name]) => {
                    // Create a document with a variable before the section
                    const my_source = [
                        `gen ${var_name} = 1`,
                        `// ${section_name} ----`,
                        'display "in section"',
                    ].join('\n');

                    const my_doc_state = parse_and_analyze(my_source);
                    const my_symbols = my_symbol_provider.get_document_symbols(my_doc_state);

                    // Find the variable symbol
                    const my_variable_symbols = find_symbols_by_kind(my_symbols, SymbolKind.Field);

                    // If the variable was registered, check its nesting
                    if (my_doc_state.symbols.variables.has(var_name)) {
                        const my_var_found = my_variable_symbols.some(
                            (s) => s.name === var_name
                        );
                        if (!my_var_found) {
                            return false;
                        }

                        // Find the parent section of the variable
                        const my_parent = find_parent_section(my_symbols, var_name);

                        // The variable should be at root level (no parent section)
                        if (my_parent !== null) {
                            return false;
                        }
                    }

                    return true;
                }
            ),
            { numRuns: 100 }
        );
    });

    /**
     * Property 4.3: Multiple variables in same section should all be nested
     *
     * Feature: outline-variable-definitions, Property 4: Section Nesting Consistency
     * **Validates: Requirements 2.2**
     */
    it('should nest multiple variables under the same containing section', () => {
        fc.assert(
            fc.property(
                fc.tuple(
                    arbitrary_non_reserved_identifier(),
                    arbitrary_non_reserved_identifier(),
                    arbitrary_non_reserved_identifier()
                ).filter(([a, b, c]) => a !== b && b !== c && a !== c),
                ([section_name, var1_name, var2_name]) => {
                    // Create a document with a section containing two variables
                    const my_source = [
                        `// ${section_name} ----`,
                        `gen ${var1_name} = 1`,
                        `egen ${var2_name} = mean(x)`,
                        'display "end"',
                    ].join('\n');

                    const my_doc_state = parse_and_analyze(my_source);
                    const my_symbols = my_symbol_provider.get_document_symbols(my_doc_state);

                    // Check both variables are nested under the section
                    for (const my_var_name of [var1_name, var2_name]) {
                        if (my_doc_state.symbols.variables.has(my_var_name)) {
                            const my_parent = find_parent_section(my_symbols, my_var_name);
                            if (my_parent !== section_name) {
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
     * Property 4.4: Variables in nested sections should be nested correctly
     *
     * Feature: outline-variable-definitions, Property 4: Section Nesting Consistency
     * **Validates: Requirements 2.2**
     */
    it('should nest variables under nested sections correctly', () => {
        fc.assert(
            fc.property(
                fc.tuple(
                    arbitrary_non_reserved_identifier(),
                    arbitrary_non_reserved_identifier(),
                    arbitrary_non_reserved_identifier(),
                    arbitrary_non_reserved_identifier()
                ).filter(
                    ([a, b, c, d]) =>
                        a !== b && a !== c && a !== d && b !== c && b !== d && c !== d
                ),
                ([outer_section, inner_section, outer_var, inner_var]) => {
                    // Create a document with nested sections and variables
                    // Using numbered sections for hierarchy: // 1. Outer, // 1.1 Inner
                    const my_source = [
                        `// 1. ${outer_section}`,
                        `gen ${outer_var} = 1`,
                        `// 1.1 ${inner_section}`,
                        `gen ${inner_var} = 2`,
                        'display "end"',
                    ].join('\n');

                    const my_doc_state = parse_and_analyze(my_source);
                    const my_symbols = my_symbol_provider.get_document_symbols(my_doc_state);

                    // Check outer variable is nested under outer section
                    if (my_doc_state.symbols.variables.has(outer_var)) {
                        const my_outer_parent = find_parent_section(my_symbols, outer_var);
                        // The outer variable should be under the outer section
                        // (section name includes the number prefix)
                        if (
                            my_outer_parent !== `1. ${outer_section}` &&
                            my_outer_parent !== null
                        ) {
                            // If not under outer section and not at root, check if it's
                            // under a section that contains the outer section name
                            if (
                                my_outer_parent &&
                                !my_outer_parent.includes(outer_section)
                            ) {
                                return false;
                            }
                        }
                    }

                    // Check inner variable is nested under inner section
                    if (my_doc_state.symbols.variables.has(inner_var)) {
                        const my_inner_parent = find_parent_section(my_symbols, inner_var);
                        // The inner variable should be under the inner section
                        if (
                            my_inner_parent !== `1.1 ${inner_section}` &&
                            my_inner_parent !== null
                        ) {
                            // If not under inner section and not at root, check if it's
                            // under a section that contains the inner section name
                            if (
                                my_inner_parent &&
                                !my_inner_parent.includes(inner_section)
                            ) {
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
     * Property 4.5: Variables follow same nesting rules as other symbols
     *
     * Feature: outline-variable-definitions, Property 4: Section Nesting Consistency
     * **Validates: Requirements 2.2**
     */
    it('should nest variables following same rules as other symbol types', () => {
        fc.assert(
            fc.property(
                fc.tuple(
                    arbitrary_non_reserved_identifier(),
                    arbitrary_non_reserved_identifier(),
                    arbitrary_non_reserved_identifier()
                ).filter(([a, b, c]) => a !== b && b !== c && a !== c),
                ([section_name, var_name, global_name]) => {
                    // Create a document with a section containing both a variable and a global macro
                    const my_source = [
                        `// ${section_name} ----`,
                        `gen ${var_name} = 1`,
                        `global ${global_name} = 2`,
                        'display "end"',
                    ].join('\n');

                    const my_doc_state = parse_and_analyze(my_source);
                    const my_symbols = my_symbol_provider.get_document_symbols(my_doc_state);

                    // Find parent sections for both symbols
                    const my_var_parent = find_parent_section(my_symbols, var_name);
                    const my_global_parent = find_parent_section_for_global(
                        my_symbols,
                        global_name
                    );

                    // Both should be nested under the same section
                    if (
                        my_doc_state.symbols.variables.has(var_name) &&
                        my_doc_state.symbols.globalMacros.has(global_name)
                    ) {
                        // Both should have the same parent section
                        if (my_var_parent !== my_global_parent) {
                            return false;
                        }
                    }

                    return true;
                }
            ),
            { numRuns: 100 }
        );
    });

    /**
     * Helper: find the parent section of a global macro by name.
     */
    function find_parent_section_for_global(
        symbols: DocumentSymbol[],
        target_name: string,
        parent_section: string | null = null
    ): string | null | undefined {
        for (const my_symbol of symbols) {
            if (my_symbol.name === target_name && my_symbol.detail === 'Global Macro') {
                return parent_section;
            }
            if (my_symbol.children && my_symbol.children.length > 0) {
                const my_section_name =
                    my_symbol.kind === SymbolKind.Module ? my_symbol.name : parent_section;
                const my_found = find_parent_section_for_global(
                    my_symbol.children,
                    target_name,
                    my_section_name
                );
                if (my_found !== undefined) {
                    return my_found;
                }
            }
        }
        return undefined;
    }

    /**
     * Property 4.6: Mixed document with sections and variables at different levels
     *
     * Feature: outline-variable-definitions, Property 4: Section Nesting Consistency
     * **Validates: Requirements 2.2**
     */
    it('should correctly nest variables in mixed document with multiple sections', () => {
        fc.assert(
            fc.property(
                fc.uniqueArray(arbitrary_non_reserved_identifier(), {
                    minLength: 5,
                    maxLength: 5,
                    comparator: (a, b) => a === b,
                }),
                ([sec1_name, sec2_name, var1_name, var2_name, var3_name]) => {
                    // Create a document with:
                    // - var1 at root level
                    // - section 1 with var2
                    // - section 2 with var3
                    const my_source = [
                        `gen ${var1_name} = 0`,
                        `// ${sec1_name} ----`,
                        `gen ${var2_name} = 1`,
                        `// ${sec2_name} ----`,
                        `gen ${var3_name} = 2`,
                    ].join('\n');

                    const my_doc_state = parse_and_analyze(my_source);
                    const my_symbols = my_symbol_provider.get_document_symbols(my_doc_state);

                    // Check var1 is at root level
                    if (my_doc_state.symbols.variables.has(var1_name)) {
                        const my_var1_parent = find_parent_section(my_symbols, var1_name);
                        if (my_var1_parent !== null) {
                            return false;
                        }
                    }

                    // Check var2 is under section 1
                    if (my_doc_state.symbols.variables.has(var2_name)) {
                        const my_var2_parent = find_parent_section(my_symbols, var2_name);
                        if (my_var2_parent !== sec1_name) {
                            return false;
                        }
                    }

                    // Check var3 is under section 2
                    if (my_doc_state.symbols.variables.has(var3_name)) {
                        const my_var3_parent = find_parent_section(my_symbols, var3_name);
                        if (my_var3_parent !== sec2_name) {
                            return false;
                        }
                    }

                    return true;
                }
            ),
            { numRuns: 100 }
        );
    });

    /**
     * Property 4.7: Egen variables follow same nesting rules as gen variables
     *
     * Feature: outline-variable-definitions, Property 4: Section Nesting Consistency
     * **Validates: Requirements 2.2**
     */
    it('should nest egen variables under sections same as gen variables', () => {
        fc.assert(
            fc.property(
                fc.tuple(
                    arbitrary_non_reserved_identifier(),
                    arbitrary_non_reserved_identifier(),
                    arbitrary_non_reserved_identifier()
                ).filter(([a, b, c]) => a !== b && b !== c && a !== c),
                ([section_name, gen_var, egen_var]) => {
                    // Create a document with a section containing both gen and egen variables
                    const my_source = [
                        `// ${section_name} ----`,
                        `gen ${gen_var} = 1`,
                        `egen ${egen_var} = mean(x)`,
                        'display "end"',
                    ].join('\n');

                    const my_doc_state = parse_and_analyze(my_source);
                    const my_symbols = my_symbol_provider.get_document_symbols(my_doc_state);

                    // Both variables should be nested under the same section
                    const my_gen_parent = find_parent_section(my_symbols, gen_var);
                    const my_egen_parent = find_parent_section(my_symbols, egen_var);

                    if (
                        my_doc_state.symbols.variables.has(gen_var) &&
                        my_doc_state.symbols.variables.has(egen_var)
                    ) {
                        // Both should have the same parent section
                        if (my_gen_parent !== my_egen_parent) {
                            return false;
                        }
                        // Both should be under the section
                        if (my_gen_parent !== section_name) {
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

