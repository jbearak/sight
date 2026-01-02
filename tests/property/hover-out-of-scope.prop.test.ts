import { init_tracker_from_source } from '../test-context-helper';
/**
 * Property-based tests for hover out-of-scope display feature.
 *
 * Tests the 4 properties from the design document:
 * - Property 1: Out-of-Scope Indicator Presence
 * - Property 2: Source Information Inclusion
 * - Property 3: No Fallthrough for Out-of-Scope Macros
 * - Property 4: Reference Type Matching
 */

import { describe, test, expect, beforeEach } from 'bun:test';
import * as fc from 'fast-check';
import { HoverProvider } from '../../src/providers/hover';
import { CommandDatabase } from '../../src/command-database';
import { DocumentState } from '../../src/document-store';
import { Position, MarkupKind } from 'vscode-languageserver';
import { ResolvedScope, OutOfScopeSymbol, SymbolTable } from '../../src/types';
import { ContextTracker } from '../../src/context-tracker';

// ============================================================================
// Generators
// ============================================================================

/**
 * Generate valid Stata identifier names.
 * Rules: Must start with letter or underscore, followed by letters, digits, or underscores.
 * Max length 32 characters (Stata limit).
 */
function arbitrary_stata_identifier(): fc.Arbitrary<string> {
    const my_first_char = fc.oneof(
        fc.integer({ min: 65, max: 90 }),  // A-Z
        fc.integer({ min: 97, max: 122 }), // a-z
        fc.constant(95)                     // _
    );

    const my_rest_char = fc.oneof(
        fc.integer({ min: 65, max: 90 }),  // A-Z
        fc.integer({ min: 97, max: 122 }), // a-z
        fc.integer({ min: 48, max: 57 }),  // 0-9
        fc.constant(95)                     // _
    );

    return fc
        .tuple(my_first_char, fc.array(my_rest_char, { minLength: 0, maxLength: 15 }))
        .map(([my_first, my_rest]) => {
            const my_first_str = String.fromCharCode(my_first);
            const my_rest_str = my_rest.map((my_code) => String.fromCharCode(my_code)).join('');
            return my_first_str + my_rest_str;
        });
}

/**
 * Generate source URIs in file:// format.
 */
function arbitrary_source_uri(): fc.Arbitrary<string> {
    return fc.tuple(
        fc.stringMatching(/^[a-z][a-z0-9_]*$/),
        fc.constantFrom('.do', '.ado', '.doh')
    ).map(([my_name, my_ext]) => `file:///test/${my_name}${my_ext}`);
}

/**
 * Generate definition line numbers (0-indexed, reasonable range 0-1000).
 */
function arbitrary_definition_line(): fc.Arbitrary<number> {
    return fc.integer({ min: 0, max: 1000 });
}

/**
 * Generate reference syntax contexts.
 */
type ReferenceSyntax = 'local_macro' | 'global_macro' | 'bare_identifier';

function arbitrary_reference_syntax(): fc.Arbitrary<ReferenceSyntax> {
    return fc.constantFrom('local_macro', 'global_macro', 'bare_identifier');
}

/**
 * Generate out-of-scope symbol type matching the reference syntax.
 */
function arbitrary_out_of_scope_type(): fc.Arbitrary<'local' | 'global'> {
    return fc.constantFrom('local', 'global');
}

// ============================================================================
// Test Fixtures
// ============================================================================

/**
 * Create an empty symbol table.
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
 * Create a minimal DocumentState for testing hover.
 */
function create_test_document_state(
    content: string,
    uri: string = 'file:///test/current.do'
): DocumentState {
    const my_context_tracker = new ContextTracker();
    init_tracker_from_source(my_context_tracker, content);

    // Build line offsets
    const my_line_offsets: number[] = [0];
    for (let my_i = 0; my_i < content.length; my_i++) {
        if (content[my_i] === '\n') {
            my_line_offsets.push(my_i + 1);
        }
    }

    return {
        uri,
        version: 1,
        content,
        tokens: [],
        ast: { nodes: [] },
        symbols: create_empty_symbol_table(),
        diagnostics: [],
        context_ranges: my_context_tracker.get_all_context_ranges(),
        context_tracker: my_context_tracker,
        line_offsets: my_line_offsets,
        forward_calls: [],
    };
}

/**
 * Create a ResolvedScope with out-of-scope symbols.
 */
function create_resolved_scope_with_out_of_scope(
    out_of_scope_symbols: OutOfScopeSymbol[]
): ResolvedScope {
    return {
        chain: [],
        symbols: create_empty_symbol_table(),
        out_of_scope_symbols,
        diagnostics: [],
        has_directives: true,
    };
}

/**
 * Create a ResolvedScope with in-scope symbols.
 */
function create_resolved_scope_with_in_scope(
    symbol_name: string,
    symbol_type: 'local' | 'global',
    source_uri: string,
    definition_line: number
): ResolvedScope {
    const my_symbols = create_empty_symbol_table();
    
    if (symbol_type === 'local') {
        my_symbols.localMacros.set(symbol_name, {
            name: symbol_name,
            scope: 'local',
            location: {
                uri: source_uri,
                range: {
                    start: { line: definition_line, character: 0 },
                    end: { line: definition_line, character: symbol_name.length },
                },
            },
            sourceUri: source_uri,
            value: 'test_value',
            definition_line,
        });
    } else {
        my_symbols.globalMacros.set(symbol_name, {
            name: symbol_name,
            scope: 'global',
            location: {
                uri: source_uri,
                range: {
                    start: { line: definition_line, character: 0 },
                    end: { line: definition_line, character: symbol_name.length },
                },
            },
            sourceUri: source_uri,
            value: 'test_value',
            definition_line,
        });
    }

    return {
        chain: [],
        symbols: my_symbols,
        out_of_scope_symbols: [],
        diagnostics: [],
        has_directives: true,
    };
}

/**
 * Build document content with a macro reference at a specific position.
 */
function build_document_with_reference(
    symbol_name: string,
    reference_syntax: ReferenceSyntax
): { content: string; position: Position } {
    let my_reference: string;
    let my_word_offset: number;

    switch (reference_syntax) {
        case 'local_macro':
            my_reference = `\`${symbol_name}'`;
            my_word_offset = 1; // After backtick
            break;
        case 'global_macro':
            my_reference = `$${symbol_name}`;
            my_word_offset = 1; // After $
            break;
        case 'bare_identifier':
            my_reference = symbol_name;
            my_word_offset = 0;
            break;
    }

    const my_content = `display ${my_reference}\n`;
    const my_position: Position = {
        line: 0,
        character: 8 + my_word_offset, // "display " is 8 chars
    };

    return { content: my_content, position: my_position };
}

// ============================================================================
// Property Tests
// ============================================================================

describe('Hover Out-of-Scope Display Property Tests', () => {
    let hover_provider: HoverProvider;
    let command_db: CommandDatabase;

    beforeEach(() => {
        command_db = new CommandDatabase();
        hover_provider = new HoverProvider(command_db);
    });

    // ========================================================================
    // Property 1: Out-of-Scope Indicator Presence
    // Validates: Requirements 1.1, 2.1, 3.1
    // ========================================================================
    describe('Property 1: Out-of-Scope Indicator Presence', () => {
        /**
         * For any local or global macro reference that matches an out-of-scope symbol,
         * the hover content SHALL contain "(out of scope)".
         */
        test('out-of-scope symbols display "(out of scope)" indicator', async () => {
            await fc.assert(
                fc.asyncProperty(
                    fc.record({
                        symbol_name: arbitrary_stata_identifier(),
                        symbol_type: arbitrary_out_of_scope_type(),
                        source_uri: arbitrary_source_uri(),
                        definition_line: arbitrary_definition_line(),
                    }),
                    async ({ symbol_name, symbol_type, source_uri, definition_line }) => {
                        // Build reference syntax matching the symbol type
                        const my_reference_syntax: ReferenceSyntax = 
                            symbol_type === 'local' ? 'local_macro' : 'global_macro';
                        
                        const { content, position } = build_document_with_reference(
                            symbol_name,
                            my_reference_syntax
                        );

                        const my_document = create_test_document_state(content);
                        
                        const my_out_of_scope_symbol: OutOfScopeSymbol = {
                            name: symbol_name,
                            type: symbol_type,
                            source_uri,
                            defined_line: definition_line,
                            call_site_line: 0,
                            reason: 'after_call_site',
                        };

                        const my_resolved_scope = create_resolved_scope_with_out_of_scope([
                            my_out_of_scope_symbol,
                        ]);

                        const my_hover = await hover_provider.get_hover(
                            my_document,
                            position,
                            undefined,
                            undefined,
                            undefined,
                            undefined,
                            undefined
                        );

                        // Call the internal method directly to test with resolved scope
                        // We need to access the private method via type assertion
                        const provider_any = hover_provider as any;
                        const my_matches = provider_any.collect_all_symbol_matches(
                            my_document,
                            position,
                            symbol_name,
                            undefined,
                            my_resolved_scope,
                            undefined
                        );

                        // Should have exactly one match
                        expect(my_matches.length).toBe(1);
                        
                        // The hover content should contain "(out of scope)"
                        const my_content = my_matches[0].content.value;
                        expect(my_content).toContain('(out of scope)');
                    }
                ),
                { numRuns: 100 }
            );
        });

        /**
         * For any in-scope symbol, the hover content SHALL NOT contain "(out of scope)".
         */
        test('in-scope symbols do NOT display "(out of scope)" indicator', async () => {
            await fc.assert(
                fc.asyncProperty(
                    fc.record({
                        symbol_name: arbitrary_stata_identifier(),
                        symbol_type: arbitrary_out_of_scope_type(),
                        source_uri: arbitrary_source_uri(),
                        definition_line: arbitrary_definition_line(),
                    }),
                    async ({ symbol_name, symbol_type, source_uri, definition_line }) => {
                        // Build reference syntax matching the symbol type
                        const my_reference_syntax: ReferenceSyntax = 
                            symbol_type === 'local' ? 'local_macro' : 'global_macro';
                        
                        const { content, position } = build_document_with_reference(
                            symbol_name,
                            my_reference_syntax
                        );

                        const my_document = create_test_document_state(content);
                        
                        // Create in-scope symbol (not out-of-scope)
                        const my_resolved_scope = create_resolved_scope_with_in_scope(
                            symbol_name,
                            symbol_type,
                            source_uri,
                            definition_line
                        );

                        const provider_any = hover_provider as any;
                        const my_matches = provider_any.collect_all_symbol_matches(
                            my_document,
                            position,
                            symbol_name,
                            undefined,
                            my_resolved_scope,
                            undefined
                        );

                        // Should have at least one match for in-scope symbol
                        expect(my_matches.length).toBeGreaterThanOrEqual(1);
                        
                        // None of the matches should contain "(out of scope)"
                        for (const my_match of my_matches) {
                            expect(my_match.content.value).not.toContain('(out of scope)');
                        }
                    }
                ),
                { numRuns: 100 }
            );
        });
    });

    // ========================================================================
    // Property 2: Source Information Inclusion
    // Validates: Requirements 1.2, 2.2
    // ========================================================================
    describe('Property 2: Source Information Inclusion', () => {
        /**
         * For any out-of-scope macro displayed in hover, the hover content SHALL
         * include the source file path and definition line number.
         */
        test('out-of-scope hover includes source file and line number', async () => {
            await fc.assert(
                fc.asyncProperty(
                    fc.record({
                        symbol_name: arbitrary_stata_identifier(),
                        symbol_type: arbitrary_out_of_scope_type(),
                        source_uri: arbitrary_source_uri(),
                        definition_line: arbitrary_definition_line(),
                    }),
                    async ({ symbol_name, symbol_type, source_uri, definition_line }) => {
                        const my_reference_syntax: ReferenceSyntax = 
                            symbol_type === 'local' ? 'local_macro' : 'global_macro';
                        
                        const { content, position } = build_document_with_reference(
                            symbol_name,
                            my_reference_syntax
                        );

                        const my_document = create_test_document_state(content);
                        
                        const my_out_of_scope_symbol: OutOfScopeSymbol = {
                            name: symbol_name,
                            type: symbol_type,
                            source_uri,
                            defined_line: definition_line,
                            call_site_line: 0,
                            reason: 'after_call_site',
                        };

                        const my_resolved_scope = create_resolved_scope_with_out_of_scope([
                            my_out_of_scope_symbol,
                        ]);

                        const provider_any = hover_provider as any;
                        const my_matches = provider_any.collect_all_symbol_matches(
                            my_document,
                            position,
                            symbol_name,
                            undefined,
                            my_resolved_scope,
                            undefined
                        );

                        expect(my_matches.length).toBe(1);
                        
                        const my_content = my_matches[0].content.value;
                        
                        // Should include line number (1-indexed in display)
                        const my_display_line = definition_line + 1;
                        expect(my_content).toContain(`line ${my_display_line}`);
                        
                        // Should include source information (either "Source:" or "Defined at:")
                        expect(
                            my_content.includes('Source:') || my_content.includes('Defined at:')
                        ).toBe(true);
                    }
                ),
                { numRuns: 100 }
            );
        });
    });

    // ========================================================================
    // Property 3: No Fallthrough for Out-of-Scope Macros
    // Validates: Requirements 1.3, 2.3
    // ========================================================================
    describe('Property 3: No Fallthrough for Out-of-Scope Macros', () => {
        /**
         * For any local or global macro reference that matches an out-of-scope symbol,
         * the hover SHALL return exactly one match of the corresponding macro type,
         * even when other symbol types (variables, programs) with the same name exist.
         */
        test('out-of-scope macro returns single match without fallthrough', async () => {
            await fc.assert(
                fc.asyncProperty(
                    fc.record({
                        symbol_name: arbitrary_stata_identifier(),
                        symbol_type: arbitrary_out_of_scope_type(),
                        source_uri: arbitrary_source_uri(),
                        definition_line: arbitrary_definition_line(),
                    }),
                    async ({ symbol_name, symbol_type, source_uri, definition_line }) => {
                        const my_reference_syntax: ReferenceSyntax = 
                            symbol_type === 'local' ? 'local_macro' : 'global_macro';
                        
                        const { content, position } = build_document_with_reference(
                            symbol_name,
                            my_reference_syntax
                        );

                        const my_document = create_test_document_state(content);
                        
                        // Add a variable with the same name to the document symbols
                        // to test that we don't fall through to it
                        my_document.symbols.variables.set(symbol_name, {
                            name: symbol_name,
                            location: {
                                uri: my_document.uri,
                                range: {
                                    start: { line: 0, character: 0 },
                                    end: { line: 0, character: symbol_name.length },
                                },
                            },
                            sourceUri: my_document.uri,
                            source: 'gen',
                        });

                        // Add a program with the same name
                        my_document.symbols.programs.set(symbol_name, {
                            name: symbol_name,
                            location: {
                                uri: my_document.uri,
                                range: {
                                    start: { line: 0, character: 0 },
                                    end: { line: 0, character: symbol_name.length },
                                },
                            },
                            sourceUri: my_document.uri,
                        });

                        const my_out_of_scope_symbol: OutOfScopeSymbol = {
                            name: symbol_name,
                            type: symbol_type,
                            source_uri,
                            defined_line: definition_line,
                            call_site_line: 0,
                            reason: 'after_call_site',
                        };

                        const my_resolved_scope = create_resolved_scope_with_out_of_scope([
                            my_out_of_scope_symbol,
                        ]);

                        const provider_any = hover_provider as any;
                        const my_matches = provider_any.collect_all_symbol_matches(
                            my_document,
                            position,
                            symbol_name,
                            undefined,
                            my_resolved_scope,
                            undefined
                        );

                        // Should return exactly one match (the out-of-scope macro)
                        expect(my_matches.length).toBe(1);
                        
                        // The match should be of the correct macro type
                        const my_expected_type = symbol_type === 'local' ? 'local_macro' : 'global_macro';
                        expect(my_matches[0].type).toBe(my_expected_type);
                        
                        // Should NOT include variable or program information
                        expect(my_matches[0].content.value).not.toContain('Variable');
                        expect(my_matches[0].content.value).not.toContain('Program');
                    }
                ),
                { numRuns: 100 }
            );
        });
    });

    // ========================================================================
    // Property 4: Reference Type Matching
    // Validates: Requirements 4.1, 4.2, 4.3
    // ========================================================================
    describe('Property 4: Reference Type Matching', () => {
        /**
         * For any reference with local macro syntax (backtick-quote),
         * the hover SHALL only check out-of-scope local macros.
         */
        test('local macro syntax only matches out-of-scope local macros', async () => {
            await fc.assert(
                fc.asyncProperty(
                    fc.record({
                        symbol_name: arbitrary_stata_identifier(),
                        source_uri: arbitrary_source_uri(),
                        definition_line: arbitrary_definition_line(),
                    }),
                    async ({ symbol_name, source_uri, definition_line }) => {
                        // Use local macro syntax
                        const { content, position } = build_document_with_reference(
                            symbol_name,
                            'local_macro'
                        );

                        const my_document = create_test_document_state(content);
                        
                        // Create an out-of-scope GLOBAL macro with the same name
                        const my_out_of_scope_global: OutOfScopeSymbol = {
                            name: symbol_name,
                            type: 'global', // Global, not local
                            source_uri,
                            defined_line: definition_line,
                            call_site_line: 0,
                            reason: 'after_call_site',
                        };

                        const my_resolved_scope = create_resolved_scope_with_out_of_scope([
                            my_out_of_scope_global,
                        ]);

                        const provider_any = hover_provider as any;
                        const my_matches = provider_any.collect_all_symbol_matches(
                            my_document,
                            position,
                            symbol_name,
                            undefined,
                            my_resolved_scope,
                            undefined
                        );

                        // Should NOT match the global macro when using local syntax
                        // (returns empty array since no local out-of-scope symbol exists)
                        const my_out_of_scope_matches = my_matches.filter(
                            (m: any) => m.content.value.includes('(out of scope)')
                        );
                        expect(my_out_of_scope_matches.length).toBe(0);
                    }
                ),
                { numRuns: 100 }
            );
        });

        /**
         * For any reference with global macro syntax ($ prefix),
         * the hover SHALL only check out-of-scope global macros.
         */
        test('global macro syntax only matches out-of-scope global macros', async () => {
            await fc.assert(
                fc.asyncProperty(
                    fc.record({
                        symbol_name: arbitrary_stata_identifier(),
                        source_uri: arbitrary_source_uri(),
                        definition_line: arbitrary_definition_line(),
                    }),
                    async ({ symbol_name, source_uri, definition_line }) => {
                        // Use global macro syntax
                        const { content, position } = build_document_with_reference(
                            symbol_name,
                            'global_macro'
                        );

                        const my_document = create_test_document_state(content);
                        
                        // Create an out-of-scope LOCAL macro with the same name
                        const my_out_of_scope_local: OutOfScopeSymbol = {
                            name: symbol_name,
                            type: 'local', // Local, not global
                            source_uri,
                            defined_line: definition_line,
                            call_site_line: 0,
                            reason: 'after_call_site',
                        };

                        const my_resolved_scope = create_resolved_scope_with_out_of_scope([
                            my_out_of_scope_local,
                        ]);

                        const provider_any = hover_provider as any;
                        const my_matches = provider_any.collect_all_symbol_matches(
                            my_document,
                            position,
                            symbol_name,
                            undefined,
                            my_resolved_scope,
                            undefined
                        );

                        // Should NOT match the local macro when using global syntax
                        const my_out_of_scope_matches = my_matches.filter(
                            (m: any) => m.content.value.includes('(out of scope)')
                        );
                        expect(my_out_of_scope_matches.length).toBe(0);
                    }
                ),
                { numRuns: 100 }
            );
        });

        /**
         * For any bare identifier reference, the hover SHALL NOT display
         * out-of-scope macro information.
         */
        test('bare identifier does NOT display out-of-scope macro info', async () => {
            await fc.assert(
                fc.asyncProperty(
                    fc.record({
                        symbol_name: arbitrary_stata_identifier(),
                        symbol_type: arbitrary_out_of_scope_type(),
                        source_uri: arbitrary_source_uri(),
                        definition_line: arbitrary_definition_line(),
                    }),
                    async ({ symbol_name, symbol_type, source_uri, definition_line }) => {
                        // Use bare identifier syntax (no backtick or $)
                        const { content, position } = build_document_with_reference(
                            symbol_name,
                            'bare_identifier'
                        );

                        const my_document = create_test_document_state(content);
                        
                        // Create an out-of-scope macro (either local or global)
                        const my_out_of_scope_symbol: OutOfScopeSymbol = {
                            name: symbol_name,
                            type: symbol_type,
                            source_uri,
                            defined_line: definition_line,
                            call_site_line: 0,
                            reason: 'after_call_site',
                        };

                        const my_resolved_scope = create_resolved_scope_with_out_of_scope([
                            my_out_of_scope_symbol,
                        ]);

                        const provider_any = hover_provider as any;
                        const my_matches = provider_any.collect_all_symbol_matches(
                            my_document,
                            position,
                            symbol_name,
                            undefined,
                            my_resolved_scope,
                            undefined
                        );

                        // Should NOT display out-of-scope macro info for bare identifiers
                        const my_out_of_scope_matches = my_matches.filter(
                            (m: any) => m.content.value.includes('(out of scope)')
                        );
                        expect(my_out_of_scope_matches.length).toBe(0);
                    }
                ),
                { numRuns: 100 }
            );
        });
    });
});
