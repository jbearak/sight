/**
 * Syntax Command Hover Provider Property Tests
 *
 * Tests that verify hover information for user-defined programs with syntax
 * commands:
 * - Property 18: Hover Signature Formatting
 * - Property 19: Option Hover Information
 * - Property 20: Hover Error Handling
 *
 * Feature: syntax-command-parsing, Property 18: Hover Signature Formatting
 * Feature: syntax-command-parsing, Property 19: Option Hover Information
 * Feature: syntax-command-parsing, Property 20: Hover Error Handling
 * Validates: Requirements 4.1, 4.2, 4.3
 */

import { describe, it, beforeEach } from 'bun:test';
import * as fc from 'fast-check';
import { HoverProvider } from '../../src/providers/hover';
import { CommandDatabase } from '../../src/commands';
import {
    ProgramSignature,
    ArgumentSpec,
    OptionSpec,
    SymbolTable,
    ProgramSymbol,
} from '../../src/types';
import { DocumentState } from '../../src/document-store';
import { arbitrary_identifier } from './generators/primitives';

/**
 * Helper to create a minimal document state for testing.
 */
function create_test_document(content: string, symbols?: Partial<SymbolTable>): DocumentState {
    return {
        uri: 'file:///test.do',
        version: 1,
        content,
        ast: null,
        symbols: {
            programs: symbols?.programs || new Map(),
            localMacros: symbols?.localMacros || new Map(),
            globalMacros: symbols?.globalMacros || new Map(),
            variables: symbols?.variables || new Map(),
        },
        diagnostics: [],
    };
}

/**
 * Generate a valid program signature with arguments and options.
 */
function arbitrary_program_signature(): fc.Arbitrary<ProgramSignature> {
    const my_argument_types = [
        'varlist',
        'varname',
        'newvarname',
        'anything',
        'if',
        'in',
        'using',
        'exp',
        'name',
    ];

    const my_option_types = [
        'real',
        'integer',
        'string',
        'varlist',
        'name',
        'filename',
        'numlist',
        'varname',
        'passthru',
    ];

    const my_argument_spec = fc
        .tuple(
            fc.constantFrom(...my_argument_types),
            fc.boolean(),
            fc.integer({ min: 0, max: 100 })
        )
        .map(([my_type, my_optional, my_line]) => ({
            type: my_type as any,
            isOptional: my_optional,
            range: {
                start: { line: my_line, character: 0 },
                end: { line: my_line, character: 10 },
            },
        }));

    const my_option_spec = fc
        .tuple(
            arbitrary_identifier(),
            fc.boolean(),
            fc.boolean(),
            fc.option(fc.constantFrom(...my_option_types)),
            fc.option(fc.stringMatching(/^[a-zA-Z0-9_]+$/)),
            fc.integer({ min: 0, max: 100 })
        )
        .map(([my_name, my_required, my_optional, my_arg_type, my_default, my_line]) => ({
            name: my_name,
            minAbbreviation: my_name.charAt(0).toUpperCase(),
            isRequired: my_required,
            isOptional: my_optional,
            argumentType: my_arg_type as any,
            defaultValue: my_default,
            range: {
                start: { line: my_line, character: 0 },
                end: { line: my_line, character: 10 },
            },
        }));

    return fc
        .tuple(
            fc.array(my_argument_spec, { maxLength: 3 }),
            fc.array(my_option_spec, { maxLength: 5 }),
            fc.boolean()
        )
        .map(([my_arguments, my_options, my_allows_arbitrary]) => ({
            arguments: my_arguments,
            options: my_options,
            allowsArbitraryOptions: my_allows_arbitrary,
            syntaxRanges: [
                {
                    start: { line: 0, character: 0 },
                    end: { line: 0, character: 50 },
                },
            ],
        }));
}

describe('Syntax Command Hover Provider Property Tests', () => {
    let my_hover_provider: HoverProvider;
    let my_command_db: CommandDatabase;

    beforeEach(() => {
        my_command_db = new CommandDatabase();
        my_hover_provider = new HoverProvider(my_command_db);
    });

    /**
     * Property 18: Hover Signature Formatting
     * For any program with a signature, hovering over the program name should
     * display the signature in Stata help-style formatting.
     *
     * Feature: syntax-command-parsing, Property 18: Hover Signature Formatting
     * Validates: Requirements 4.1
     */
    it('should format program signatures in Stata help-style', async () => {
        fc.assert(
            fc.asyncProperty(
                arbitrary_identifier(),
                arbitrary_program_signature(),
                async (my_program_name, my_signature) => {
                    // Create a program symbol with the signature
                    const my_program_symbol: ProgramSymbol = {
                        name: my_program_name,
                        location: {
                            uri: 'file:///test.do',
                            range: {
                                start: { line: 0, character: 0 },
                                end: { line: 0, character: 10 },
                            },
                        },
                        sourceUri: 'file:///test.do',
                        signature: my_signature,
                    };

                    // Create workspace symbols with the program
                    const my_workspace_symbols: SymbolTable = {
                        // Programs are case-sensitive and stored with original case
                        programs: new Map([[my_program_name, my_program_symbol]]),
                        localMacros: new Map(),
                        globalMacros: new Map(),
                        variables: new Map(),
                    };

                    // Create a document that references the program
                    const my_content = `${my_program_name}`;
                    const my_doc = create_test_document(my_content);

                    // Get hover at the program name
                    const my_hover = await my_hover_provider.get_hover(
                        my_doc,
                        { line: 0, character: 1 },
                        my_workspace_symbols
                    );

                    // Should return hover information
                    if (!my_hover) {
                        return false;
                    }

                    // Should have contents
                    if (!my_hover.contents) {
                        return false;
                    }

                    // Contents should be markdown
                    if (typeof my_hover.contents !== 'object' || !('value' in my_hover.contents)) {
                        return false;
                    }

                    const my_value = my_hover.contents.value;

                    // Should contain program name
                    if (!my_value.includes(my_program_name)) {
                        return false;
                    }

                    // Should contain "Syntax" section
                    if (!my_value.includes('Syntax')) {
                        return false;
                    }

                    // Should contain code block markers for syntax
                    if (!my_value.includes('```stata')) {
                        return false;
                    }

                    // If there are arguments, should show them
                    if (my_signature.arguments.length > 0) {
                        // At least one argument type should be mentioned
                        const my_has_arg_type = my_signature.arguments.some(arg =>
                            my_value.includes(arg.type)
                        );
                        if (!my_has_arg_type) {
                            return false;
                        }
                    }

                    // If there are options, should show options section
                    if (my_signature.options.length > 0) {
                        if (!my_value.includes('Options')) {
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
     * Property 19: Option Hover Information
     * For any option in a user program signature, the hover provider should
     * be able to format option information with type, default, and required status.
     *
     * Feature: syntax-command-parsing, Property 19: Option Hover Information
     * Validates: Requirements 4.2
     */
    it('should format option information with type, default, and required status', async () => {
        fc.assert(
            fc.asyncProperty(
                arbitrary_identifier(),
                arbitrary_program_signature(),
                async (my_program_name, my_signature) => {
                    // Skip if no options
                    if (my_signature.options.length === 0) {
                        return true;
                    }

                    // Create a program symbol with the signature
                    const my_program_symbol: ProgramSymbol = {
                        name: my_program_name,
                        location: {
                            uri: 'file:///test.do',
                            range: {
                                start: { line: 0, character: 0 },
                                end: { line: 0, character: 10 },
                            },
                        },
                        sourceUri: 'file:///test.do',
                        signature: my_signature,
                    };

                    // Create workspace symbols with the program
                    const my_workspace_symbols: SymbolTable = {
                        // Programs are case-sensitive and stored with original case
                        programs: new Map([[my_program_name, my_program_symbol]]),
                        localMacros: new Map(),
                        globalMacros: new Map(),
                        variables: new Map(),
                    };

                    // Test that the signature formatting includes option information
                    const my_content = `${my_program_name}`;
                    const my_doc = create_test_document(my_content);

                    // Get hover at the program name
                    const my_hover = await my_hover_provider.get_hover(
                        my_doc,
                        { line: 0, character: 1 },
                        my_workspace_symbols
                    );

                    // Should return hover information
                    if (!my_hover) {
                        return false;
                    }

                    if (typeof my_hover.contents !== 'object' || !('value' in my_hover.contents)) {
                        return false;
                    }

                    const my_value = my_hover.contents.value;

                    // Should contain "Options" section
                    if (!my_value.includes('Options')) {
                        return false;
                    }

                    // For each option, verify its information is present
                    for (const my_option of my_signature.options) {
                        // Should contain option name
                        if (!my_value.includes(my_option.name)) {
                            return false;
                        }

                        // Should indicate required status
                        if (my_option.isRequired) {
                            if (!my_value.includes('required')) {
                                return false;
                            }
                        }

                        // Should show argument type if present
                        if (my_option.argumentType) {
                            if (!my_value.includes(my_option.argumentType)) {
                                return false;
                            }
                        }

                        // Should show default if present
                        if (my_option.defaultValue) {
                            if (!my_value.includes(my_option.defaultValue)) {
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
     * Property 20: Hover Error Handling
     * For any hover request with unavailable signature data, the hover provider
     * should fail silently without throwing an exception.
     *
     * Feature: syntax-command-parsing, Property 20: Hover Error Handling
     * Validates: Requirements 4.3
     */
    it('should fail silently for missing signatures', async () => {
        fc.assert(
            fc.asyncProperty(
                // Prefix to avoid collisions with Stata built-ins (e.g., _n,
                // _N, _pi, _rc, _cons) and built-in function names that the
                // hover provider responds to even without a program symbol.
                arbitrary_identifier().map((id) => `nonexistent_${id}`),
                async (my_program_name) => {
                    // Create workspace symbols WITHOUT the program
                    const my_workspace_symbols: SymbolTable = {
                        programs: new Map(),
                        localMacros: new Map(),
                        globalMacros: new Map(),
                        variables: new Map(),
                    };

                    // Create a document that references a non-existent program
                    const my_content = `${my_program_name}`;
                    const my_doc = create_test_document(my_content);

                    // Get hover at the program name - should not throw
                    let my_hover = null;
                    try {
                        my_hover = await my_hover_provider.get_hover(
                            my_doc,
                            { line: 0, character: 1 },
                            my_workspace_symbols
                        );
                    } catch {
                        // Should not throw
                        return false;
                    }

                    // Should return null gracefully
                    return my_hover === null;
                }
            ),
            { numRuns: 100 }
        );
    });

    /**
     * Extended Property: Hover with Arbitrary Options
     * For any program with allowsArbitraryOptions flag, the hover should
     * indicate this capability.
     *
     * Feature: syntax-command-parsing, Property 18 (extended): Arbitrary Options
     * Validates: Requirements 4.1
     */
    it('should indicate arbitrary options support in hover', async () => {
        fc.assert(
            fc.asyncProperty(
                arbitrary_identifier(),
                arbitrary_program_signature(),
                async (my_program_name, my_signature) => {
                    // Only test signatures that allow arbitrary options
                    if (!my_signature.allowsArbitraryOptions) {
                        return true;
                    }

                    // Create a program symbol with the signature
                    const my_program_symbol: ProgramSymbol = {
                        name: my_program_name,
                        location: {
                            uri: 'file:///test.do',
                            range: {
                                start: { line: 0, character: 0 },
                                end: { line: 0, character: 10 },
                            },
                        },
                        sourceUri: 'file:///test.do',
                        signature: my_signature,
                    };

                    // Create workspace symbols with the program
                    const my_workspace_symbols: SymbolTable = {
                        // Programs are case-sensitive and stored with original case
                        programs: new Map([[my_program_name, my_program_symbol]]),
                        localMacros: new Map(),
                        globalMacros: new Map(),
                        variables: new Map(),
                    };

                    // Create a document that references the program
                    const my_content = `${my_program_name}`;
                    const my_doc = create_test_document(my_content);

                    // Get hover at the program name
                    const my_hover = await my_hover_provider.get_hover(
                        my_doc,
                        { line: 0, character: 1 },
                        my_workspace_symbols
                    );

                    // Should return hover information
                    if (!my_hover) {
                        return false;
                    }

                    if (typeof my_hover.contents !== 'object' || !('value' in my_hover.contents)) {
                        return false;
                    }

                    const my_value = my_hover.contents.value;

                    // Should contain asterisk marker for arbitrary options
                    if (!my_value.includes('*')) {
                        return false;
                    }

                    return true;
                }
            ),
            { numRuns: 100 }
        );
    });
});
