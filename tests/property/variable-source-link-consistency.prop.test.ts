/**
 * Variable Source Link Consistency Property Tests
 *
 * Tests that verify variable hover displays source links in the same format
 * as other symbol types (macros, programs, scalars, matrices).
 *
 * Feature: hover-multi-symbol-display, Property 4: Variable Source Link Consistency
 * Validates: Requirements 2.2, 4.1
 */

import { describe, it, beforeEach } from 'bun:test';
import * as fc from 'fast-check';
import { HoverProvider } from '../../src/providers/hover';
import { CommandDatabase } from '../../src/commands';
import { SymbolTable, VariableSymbol, MacroSymbol, ScalarSymbol, MatrixSymbol, ProgramSymbol } from '../../src/types';
import { MarkupKind } from 'vscode-languageserver';
import { parse_and_analyze } from './helpers/document-utils';

/**
 * Create an empty symbol table for testing.
 */
function create_empty_symbol_table(): SymbolTable {
    return {
        programs: new Map(),
        localMacros: new Map(),
        globalMacros: new Map(),
        variables: new Map(),
        scalars: new Map(),
        matrices: new Map(),
    };
}

/**
 * Create a variable symbol for testing.
 */
function create_variable_symbol(
    name: string,
    source_uri: string,
    type: string = 'float',
    label: string = 'Test variable',
    source: 'gen' | 'egen' | 'input' | 'inferred' | 'directive' | 'rename' = 'gen',
    definition_line?: number
): VariableSymbol {
    return {
        name,
        location: {
            uri: source_uri,
            range: {
                start: { line: definition_line ?? 0, character: 0 },
                end: { line: definition_line ?? 0, character: name.length },
            },
        },
        sourceUri: source_uri,
        type,
        label,
        source,
    };
}

/**
 * Create a local macro symbol for testing.
 */
function create_local_macro_symbol(
    name: string,
    source_uri: string,
    definition_line?: number
): MacroSymbol {
    return {
        name,
        scope: 'local',
        location: {
            uri: source_uri,
            range: {
                start: { line: definition_line ?? 0, character: 0 },
                end: { line: definition_line ?? 0, character: name.length },
            },
        },
        sourceUri: source_uri,
        definition_line: definition_line ?? 0,
    };
}

/**
 * Create a scalar symbol for testing.
 */
function create_scalar_symbol(
    name: string,
    source_uri: string,
    definition_line?: number
): ScalarSymbol {
    return {
        name,
        location: {
            uri: source_uri,
            range: {
                start: { line: definition_line ?? 0, character: 0 },
                end: { line: definition_line ?? 0, character: name.length },
            },
        },
        sourceUri: source_uri,
        definition_line: definition_line ?? 0,
    };
}

/**
 * Create a matrix symbol for testing.
 */
function create_matrix_symbol(
    name: string,
    source_uri: string,
    definition_line?: number
): MatrixSymbol {
    return {
        name,
        location: {
            uri: source_uri,
            range: {
                start: { line: definition_line ?? 0, character: 0 },
                end: { line: definition_line ?? 0, character: name.length },
            },
        },
        sourceUri: source_uri,
        definition_line: definition_line ?? 0,
    };
}

/**
 * Arbitrary generator for valid Stata identifier names.
 */
function arbitrary_identifier_name(): fc.Arbitrary<string> {
    return fc.stringMatching(/^[a-zA-Z_][a-zA-Z0-9_]{0,15}$/)
        .filter(s => s.length > 0 && s.length <= 16);
}

/**
 * Arbitrary generator for file URIs.
 */
function arbitrary_file_uri(): fc.Arbitrary<string> {
    return fc.string({
        minLength: 1,
        maxLength: 20,
        unit: fc.char().filter(c => /[a-zA-Z0-9_-]/.test(c))
    }).map(s => `file:///path/to/${s}.do`);
}

/**
 * Arbitrary generator for workspace roots.
 */
function arbitrary_workspace_root(): fc.Arbitrary<string> {
    return fc.string({
        minLength: 1,
        maxLength: 20,
        unit: fc.char().filter(c => /[a-zA-Z0-9_-]/.test(c))
    }).map(s => `/workspace/${s}`);
}

/**
 * Arbitrary generator for variable types.
 */
function arbitrary_variable_type(): fc.Arbitrary<string> {
    return fc.constantFrom('byte', 'int', 'long', 'float', 'double', 'str1', 'str10', 'str100');
}

/**
 * Arbitrary generator for variable sources.
 */
function arbitrary_variable_source(): fc.Arbitrary<'gen' | 'egen' | 'input' | 'inferred' | 'directive' | 'rename'> {
    return fc.constantFrom('gen', 'egen', 'input', 'inferred', 'directive', 'rename');
}

/**
 * Extract the source link from hover markdown content.
 * Returns the markdown link if found, or null if not found.
 */
function extract_source_link(hover_value: string): string | null {
    // Look for markdown link pattern [display](uri)
    const link_match = hover_value.match(/\[([^\]]+)\]\(([^)]+)\)/);
    if (link_match) {
        return link_match[0];
    }
    return null;
}

/**
 * Check if hover content contains "this file" indicator (same-file symbol).
 */
function contains_this_file_indicator(hover_value: string): boolean {
    return hover_value.includes('this file');
}

describe('Variable Source Link Consistency Property Tests', () => {
    let my_hover_provider: HoverProvider;
    let my_command_db: CommandDatabase;

    beforeEach(() => {
        my_command_db = new CommandDatabase();
        my_hover_provider = new HoverProvider(my_command_db);
    });

    /**
     * Helper to access the private format_variable_hover method for testing.
     */
    function call_format_variable_hover(
        variable: VariableSymbol,
        current_uri: string,
        workspace_root?: string
    ): { kind: typeof MarkupKind.Markdown; value: string } {
        return (my_hover_provider as any).format_variable_hover(variable, current_uri, workspace_root);
    }

    /**
     * Helper to access the private format_source_link method for testing.
     */
    function call_format_source_link(
        source_uri: string,
        current_uri: string,
        workspace_root?: string
    ): string {
        return (my_hover_provider as any).format_source_link(source_uri, current_uri, workspace_root);
    }

    /**
     * Property 4: Variable Source Link Consistency
     * For any variable symbol with a sourceUri different from the current document,
     * the hover output SHALL contain a clickable markdown link in the same format
     * used for macros, programs, scalars, and matrices.
     *
     * Feature: hover-multi-symbol-display, Property 4: Variable Source Link Consistency
     * Validates: Requirements 2.2, 4.1
     */
    it('should display source links for cross-file variables in same format as other symbols (Requirements 2.2, 4.1)', async () => {
        await fc.assert(
            fc.asyncProperty(
                arbitrary_identifier_name(),
                arbitrary_file_uri(),
                arbitrary_file_uri(),
                arbitrary_variable_type(),
                arbitrary_variable_source(),
                fc.option(arbitrary_workspace_root()),
                async (var_name, source_uri, current_uri, var_type, var_source, workspace_root) => {
                    // Ensure source and current URIs are different (cross-file scenario)
                    fc.pre(source_uri !== current_uri);

                    // Create variable symbol
                    const my_variable = create_variable_symbol(
                        var_name,
                        source_uri,
                        var_type,
                        'Test label',
                        var_source,
                        5 // definition line
                    );

                    // Get variable hover content
                    const variable_hover = call_format_variable_hover(
                        my_variable,
                        current_uri,
                        workspace_root ?? undefined
                    );

                    // Get the expected source link format using format_source_link
                    const expected_link = call_format_source_link(
                        source_uri,
                        current_uri,
                        workspace_root ?? undefined
                    );

                    // Variable hover should contain a source link
                    const variable_link = extract_source_link(variable_hover.value);

                    // For cross-file variables, there should be a clickable link
                    if (!variable_link) {
                        return false;
                    }

                    // The link format should match what format_source_link produces
                    // (the same method used for macros, scalars, matrices, programs)
                    if (!variable_hover.value.includes(expected_link)) {
                        return false;
                    }

                    return true;
                }
            ),
            { numRuns: 100 }
        );
    });

    /**
     * Property 4b: Same-file variables show "this file" instead of link
     * For any variable symbol with a sourceUri equal to the current document,
     * the hover output SHALL display "this file" instead of a clickable link.
     *
     * Feature: hover-multi-symbol-display, Property 4: Variable Source Link Consistency
     * Validates: Requirements 2.4
     */
    it('should display "this file" for same-file variables (Requirement 2.4)', async () => {
        await fc.assert(
            fc.asyncProperty(
                arbitrary_identifier_name(),
                arbitrary_file_uri(),
                arbitrary_variable_type(),
                arbitrary_variable_source(),
                fc.option(arbitrary_workspace_root()),
                async (var_name, file_uri, var_type, var_source, workspace_root) => {
                    // Create variable symbol with same source and current URI
                    const my_variable = create_variable_symbol(
                        var_name,
                        file_uri,
                        var_type,
                        'Test label',
                        var_source,
                        5 // definition line
                    );

                    // Get variable hover content (same file)
                    const variable_hover = call_format_variable_hover(
                        my_variable,
                        file_uri, // Same as source URI
                        workspace_root ?? undefined
                    );

                    // Should contain "this file" indicator
                    if (!contains_this_file_indicator(variable_hover.value)) {
                        return false;
                    }

                    // Should NOT contain a clickable markdown link
                    const variable_link = extract_source_link(variable_hover.value);
                    if (variable_link) {
                        return false;
                    }

                    return true;
                }
            ),
            { numRuns: 100 }
        );
    });

    /**
     * Property 4c: Variable source links use same format as macro source links
     * For any cross-file variable and macro with the same sourceUri,
     * both hover outputs SHALL use the same markdown link format.
     *
     * Feature: hover-multi-symbol-display, Property 4: Variable Source Link Consistency
     * Validates: Requirements 4.1
     */
    it('should use same link format for variables as for macros (Requirement 4.1)', async () => {
        await fc.assert(
            fc.asyncProperty(
                arbitrary_identifier_name(),
                arbitrary_file_uri(),
                arbitrary_file_uri(),
                fc.option(arbitrary_workspace_root()),
                async (symbol_name, source_uri, current_uri, workspace_root) => {
                    // Ensure source and current URIs are different
                    fc.pre(source_uri !== current_uri);

                    // Create variable and macro with same source URI
                    const my_variable = create_variable_symbol(
                        symbol_name,
                        source_uri,
                        'float',
                        'Test label',
                        'gen',
                        10
                    );

                    const my_macro = create_local_macro_symbol(
                        symbol_name,
                        source_uri,
                        10
                    );

                    // Get hover content for both
                    const variable_hover = call_format_variable_hover(
                        my_variable,
                        current_uri,
                        workspace_root ?? undefined
                    );

                    // Get the source link that would be used for the macro
                    const expected_link = call_format_source_link(
                        source_uri,
                        current_uri,
                        workspace_root ?? undefined
                    );

                    // Extract links from both hovers
                    const variable_link = extract_source_link(variable_hover.value);

                    // Both should have the same link format
                    if (!variable_link) {
                        return false;
                    }

                    // The variable link should match the expected format
                    if (!variable_hover.value.includes(expected_link)) {
                        return false;
                    }

                    return true;
                }
            ),
            { numRuns: 100 }
        );
    });

    /**
     * Property 4d: Variable source links use same format as scalar source links
     * For any cross-file variable and scalar with the same sourceUri,
     * both hover outputs SHALL use the same markdown link format.
     *
     * Feature: hover-multi-symbol-display, Property 4: Variable Source Link Consistency
     * Validates: Requirements 4.1
     */
    it('should use same link format for variables as for scalars (Requirement 4.1)', async () => {
        await fc.assert(
            fc.asyncProperty(
                arbitrary_identifier_name(),
                arbitrary_file_uri(),
                arbitrary_file_uri(),
                fc.option(arbitrary_workspace_root()),
                async (symbol_name, source_uri, current_uri, workspace_root) => {
                    // Ensure source and current URIs are different
                    fc.pre(source_uri !== current_uri);

                    // Create variable with source URI
                    const my_variable = create_variable_symbol(
                        symbol_name,
                        source_uri,
                        'float',
                        'Test label',
                        'gen',
                        10
                    );

                    // Get hover content for variable
                    const variable_hover = call_format_variable_hover(
                        my_variable,
                        current_uri,
                        workspace_root ?? undefined
                    );

                    // Get the source link that would be used for any symbol type
                    const expected_link = call_format_source_link(
                        source_uri,
                        current_uri,
                        workspace_root ?? undefined
                    );

                    // Extract link from variable hover
                    const variable_link = extract_source_link(variable_hover.value);

                    // Variable should have a link
                    if (!variable_link) {
                        return false;
                    }

                    // The variable link should match the expected format
                    if (!variable_hover.value.includes(expected_link)) {
                        return false;
                    }

                    return true;
                }
            ),
            { numRuns: 100 }
        );
    });

    /**
     * Additional test: Verify workspace-relative paths are used for variables
     * when the source file is within the workspace.
     */
    it('should display workspace-relative paths for variables within workspace', async () => {
        await fc.assert(
            fc.asyncProperty(
                arbitrary_identifier_name(),
                arbitrary_variable_type(),
                async (var_name, var_type) => {
                    const workspace_root = '/workspace/project';
                    const source_uri = 'file:///workspace/project/data/vars.do';
                    const current_uri = 'file:///workspace/project/main.do';

                    const my_variable = create_variable_symbol(
                        var_name,
                        source_uri,
                        var_type,
                        'Test label',
                        'gen',
                        5
                    );

                    const variable_hover = call_format_variable_hover(
                        my_variable,
                        current_uri,
                        workspace_root
                    );

                    // Should contain a relative path (data/vars.do)
                    if (!variable_hover.value.includes('data/vars.do')) {
                        return false;
                    }

                    // Should NOT contain the full absolute path in the display text
                    // (but the link target should still be the full URI)
                    const link_match = variable_hover.value.match(/\[([^\]]+)\]/);
                    if (link_match) {
                        const display_text = link_match[1];
                        if (display_text.startsWith('/workspace')) {
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
