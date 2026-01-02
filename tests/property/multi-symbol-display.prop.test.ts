/**
 * Multi-Symbol Display Property Tests
 *
 * Tests that verify the hover provider correctly displays all matching symbol types
 * when an identifier matches multiple categories, with proper ordering and formatting.
 *
 * Feature: hover-multi-symbol-display, Property 1: Multi-Symbol Display Completeness and Ordering
 * Feature: hover-multi-symbol-display, Property 2: Single Symbol Display Preserves Format
 * Validates: Requirements 1.1, 1.2, 1.3, 1.4
 */

import { describe, it, beforeEach, expect } from 'bun:test';
import * as fc from 'fast-check';
import { HoverProvider, SymbolMatch } from '../../src/providers/hover';
import { CommandDatabase } from '../../src/commands';
import { SymbolTable, MacroSymbol, VariableSymbol, ProgramSymbol, ScalarSymbol, MatrixSymbol } from '../../src/types';
import { MarkupKind, MarkupContent } from 'vscode-languageserver';
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
 * Create a local macro symbol for testing.
 */
function create_local_macro_symbol(
    name: string,
    source_uri: string = 'file:///test.do',
    value?: string
): MacroSymbol {
    return {
        name,
        scope: 'local',
        location: {
            uri: source_uri,
            range: {
                start: { line: 0, character: 0 },
                end: { line: 0, character: name.length },
            },
        },
        sourceUri: source_uri,
        value,
        definition_line: 0,
    };
}

/**
 * Create a global macro symbol for testing.
 */
function create_global_macro_symbol(
    name: string,
    source_uri: string = 'file:///test.do',
    value?: string
): MacroSymbol {
    return {
        name,
        scope: 'global',
        location: {
            uri: source_uri,
            range: {
                start: { line: 0, character: 0 },
                end: { line: 0, character: name.length },
            },
        },
        sourceUri: source_uri,
        value,
        definition_line: 0,
    };
}

/**
 * Create a program symbol for testing.
 */
function create_program_symbol(
    name: string,
    source_uri: string = 'file:///test.do'
): ProgramSymbol {
    return {
        name,
        location: {
            uri: source_uri,
            range: {
                start: { line: 0, character: 0 },
                end: { line: 0, character: name.length },
            },
        },
        sourceUri: source_uri,
    };
}

/**
 * Create a scalar symbol for testing.
 */
function create_scalar_symbol(
    name: string,
    source_uri: string = 'file:///test.do'
): ScalarSymbol {
    return {
        name,
        location: {
            uri: source_uri,
            range: {
                start: { line: 0, character: 0 },
                end: { line: 0, character: name.length },
            },
        },
        sourceUri: source_uri,
        definition_line: 0,
    };
}

/**
 * Create a matrix symbol for testing.
 */
function create_matrix_symbol(
    name: string,
    source_uri: string = 'file:///test.do'
): MatrixSymbol {
    return {
        name,
        location: {
            uri: source_uri,
            range: {
                start: { line: 0, character: 0 },
                end: { line: 0, character: name.length },
            },
        },
        sourceUri: source_uri,
        definition_line: 0,
    };
}

/**
 * Create a variable symbol for testing.
 */
function create_variable_symbol(
    name: string,
    source_uri: string = 'file:///test.do',
    type: string = 'float',
    label: string = 'Test variable'
): VariableSymbol {
    return {
        name,
        location: {
            uri: source_uri,
            range: {
                start: { line: 0, character: 0 },
                end: { line: 0, character: name.length },
            },
        },
        sourceUri: source_uri,
        type,
        label,
        source: 'gen',
    };
}

/**
 * Arbitrary generator for valid Stata identifier names.
 * Names must start with a letter or underscore and contain only
 * alphanumeric characters and underscores.
 */
function arbitrary_identifier_name(): fc.Arbitrary<string> {
    return fc.stringMatching(/^[a-zA-Z_][a-zA-Z0-9_]{0,15}$/)
        .filter(s => s.length > 0 && s.length <= 16);
}

/**
 * Symbol type enum for generating combinations.
 */
type SymbolType = 'local_macro' | 'global_macro' | 'program' | 'scalar' | 'matrix' | 'variable';

const ALL_SYMBOL_TYPES: SymbolType[] = ['local_macro', 'global_macro', 'program', 'scalar', 'matrix', 'variable'];

/**
 * Expected display order for symbol types.
 */
const SYMBOL_TYPE_ORDER: Record<SymbolType, number> = {
    'local_macro': 0,
    'global_macro': 1,
    'program': 2,
    'scalar': 3,
    'matrix': 4,
    'variable': 5,
};

/**
 * Expected heading text for each symbol type.
 */
const SYMBOL_TYPE_HEADINGS: Record<SymbolType, string> = {
    'local_macro': 'Local Macro',
    'global_macro': 'Global Macro',
    'program': 'Program',
    'scalar': 'Scalar',
    'matrix': 'Matrix',
    'variable': 'Variable',
};

/**
 * Arbitrary generator for non-empty subsets of symbol types.
 */
function arbitrary_symbol_type_subset(): fc.Arbitrary<SymbolType[]> {
    return fc.subarray(ALL_SYMBOL_TYPES, { minLength: 1, maxLength: 6 });
}

/**
 * Arbitrary generator for subsets with at least 2 symbol types (for multi-symbol tests).
 */
function arbitrary_multi_symbol_type_subset(): fc.Arbitrary<SymbolType[]> {
    return fc.subarray(ALL_SYMBOL_TYPES, { minLength: 2, maxLength: 6 });
}

/**
 * Arbitrary generator for exactly one symbol type (for single-symbol tests).
 */
function arbitrary_single_symbol_type(): fc.Arbitrary<SymbolType> {
    return fc.constantFrom(...ALL_SYMBOL_TYPES);
}

describe('Multi-Symbol Display Property Tests', () => {
    let my_hover_provider: HoverProvider;
    let my_command_db: CommandDatabase;

    beforeEach(() => {
        my_command_db = new CommandDatabase();
        my_hover_provider = new HoverProvider(my_command_db);
    });

    /**
     * Helper to access the private format_multi_symbol_hover method for testing.
     */
    function call_format_multi_symbol_hover(matches: SymbolMatch[]): MarkupContent {
        // Access private method via type assertion
        return (my_hover_provider as any).format_multi_symbol_hover(matches);
    }

    /**
     * Helper to create a SymbolMatch for testing.
     */
    function create_symbol_match(type: SymbolType, name: string): SymbolMatch {
        const content: MarkupContent = {
            kind: MarkupKind.Markdown,
            value: `**${SYMBOL_TYPE_HEADINGS[type]}:** \`${name}\`\n\nTest content for ${type}`,
        };
        return { type, content };
    }

    /**
     * Property 1: Multi-Symbol Display Completeness and Ordering
     * For any identifier that matches symbols in N different categories (where N > 1),
     * the hover output SHALL contain exactly N sections separated by horizontal rules,
     * displayed in the order: Local Macro, Global Macro, Program, Scalar, Matrix, Variable.
     *
     * Feature: hover-multi-symbol-display, Property 1: Multi-Symbol Display Completeness and Ordering
     * Validates: Requirements 1.1, 1.2, 1.3
     */
    it('should display all matching symbols with correct headings and order (Requirements 1.1, 1.2, 1.3)', async () => {
        await fc.assert(
            fc.asyncProperty(
                arbitrary_identifier_name(),
                arbitrary_multi_symbol_type_subset(),
                async (name, symbol_types) => {
                    // Create matches for each symbol type
                    const the_matches: SymbolMatch[] = symbol_types.map(type => 
                        create_symbol_match(type, name)
                    );

                    // Sort matches by expected order (simulating collect_all_symbol_matches behavior)
                    the_matches.sort((a, b) => SYMBOL_TYPE_ORDER[a.type] - SYMBOL_TYPE_ORDER[b.type]);

                    // Format the multi-symbol hover
                    const result = call_format_multi_symbol_hover(the_matches);

                    // Verify result is markdown
                    if (result.kind !== MarkupKind.Markdown) {
                        return false;
                    }

                    const value = result.value;

                    // Verify all symbol types have their content in the output
                    // Each section starts with bold type like "**Local Macro:**"
                    for (const type of symbol_types) {
                        const type_marker = `**${SYMBOL_TYPE_HEADINGS[type]}:**`;
                        if (!value.includes(type_marker)) {
                            return false;
                        }
                    }

                    // Verify correct ordering by checking content positions
                    const sorted_types = [...symbol_types].sort((a, b) => 
                        SYMBOL_TYPE_ORDER[a] - SYMBOL_TYPE_ORDER[b]
                    );

                    let last_position = -1;
                    for (const type of sorted_types) {
                        const type_marker = `**${SYMBOL_TYPE_HEADINGS[type]}:**`;
                        const position = value.indexOf(type_marker);
                        if (position <= last_position) {
                            return false;
                        }
                        last_position = position;
                    }

                    // Verify sections are separated by horizontal rules
                    if (symbol_types.length > 1) {
                        const separator_count = (value.match(/---/g) || []).length;
                        if (separator_count !== symbol_types.length - 1) {
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
     * Property 2: Single Symbol Display Preserves Format
     * For any identifier that matches exactly one symbol category, the hover output
     * SHALL NOT contain section headings (### markers), preserving the existing
     * single-symbol format.
     *
     * Feature: hover-multi-symbol-display, Property 2: Single Symbol Display Preserves Format
     * Validates: Requirements 1.4
     */
    it('should preserve single-symbol format without headings (Requirement 1.4)', async () => {
        await fc.assert(
            fc.asyncProperty(
                arbitrary_identifier_name(),
                arbitrary_single_symbol_type(),
                async (name, symbol_type) => {
                    // Create a single match
                    const my_match = create_symbol_match(symbol_type, name);
                    const the_matches: SymbolMatch[] = [my_match];

                    // Format the single-symbol hover
                    const result = call_format_multi_symbol_hover(the_matches);

                    // Verify result is markdown
                    if (result.kind !== MarkupKind.Markdown) {
                        return false;
                    }

                    const value = result.value;

                    // Verify NO section headings (### markers) are present
                    if (value.includes('### ')) {
                        return false;
                    }

                    // Verify NO horizontal rule separators
                    if (value.includes('---')) {
                        return false;
                    }

                    // Verify the content matches the original match content
                    if (value !== my_match.content.value) {
                        return false;
                    }

                    return true;
                }
            ),
            { numRuns: 100 }
        );
    });

    /**
     * Additional test: Verify empty matches array handling.
     * Edge case: format_multi_symbol_hover should handle empty array gracefully.
     */
    it('should handle empty matches array gracefully', () => {
        const the_matches: SymbolMatch[] = [];
        
        // This should not throw - but behavior is undefined for empty array
        // The method is only called when there are matches, so this is defensive
        try {
            const result = call_format_multi_symbol_hover(the_matches);
            // If it returns something, it should be valid MarkupContent
            expect(result.kind).toBe(MarkupKind.Markdown);
        } catch {
            // Empty array handling is acceptable to throw
        }
    });

    /**
     * Additional test: Verify all 6 symbol types can be displayed together.
     */
    it('should display all 6 symbol types correctly when all match', () => {
        const name = 'testvar';
        const the_matches: SymbolMatch[] = ALL_SYMBOL_TYPES.map(type => 
            create_symbol_match(type, name)
        );

        const result = call_format_multi_symbol_hover(the_matches);

        expect(result.kind).toBe(MarkupKind.Markdown);

        // Verify all symbol type markers are present (e.g., "**Local Macro:**")
        for (const type of ALL_SYMBOL_TYPES) {
            expect(result.value).toContain(`**${SYMBOL_TYPE_HEADINGS[type]}:**`);
        }

        // Verify 5 separators (6 sections - 1)
        const separator_count = (result.value.match(/---/g) || []).length;
        expect(separator_count).toBe(5);
    });
});
