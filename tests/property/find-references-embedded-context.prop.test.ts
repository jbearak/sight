/**
 * Property Test: Embedded Language Context Handling for Find References
 * 
 * Feature: find-references
 * Property 9: Macros Cross Embedded Contexts
 * Property 10: Non-Macros Excluded from Embedded Contexts
 * 
 * Validates: Requirements 8.1, 8.2, 8.3, 8.4
 */

import { describe, it, expect } from 'bun:test';
import * as fc from 'fast-check';
import { ReferencesProvider, ReferenceSearchContext } from '../../src/providers/references';
import { Token, ContextRange, LanguageContext } from '../../src/types';

/**
 * Helper to create a ContextRange with required fields.
 */
function create_context_range(
    context: LanguageContext,
    start_line: number,
    end_line: number
): ContextRange {
    return {
        context,
        range: {
            start: { line: start_line, character: 0 },
            end: { line: end_line, character: 0 }
        },
        start_delimiter: {
            command: context === LanguageContext.MATA ? 'mata' : 'python',
            range: {
                start: { line: start_line, character: 0 },
                end: { line: start_line, character: 4 }
            }
        },
        is_single_line: false
    };
}

describe('Feature: find-references, Property 9: Macros Cross Embedded Contexts', () => {
    const provider = new ReferencesProvider();

    // Generator for valid Stata identifiers
    const arbitrary_identifier = fc.stringOf(
        fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz_'.split('')),
        { minLength: 2, maxLength: 10 }
    ).filter(s => /^[a-zA-Z_]/.test(s));

    it('should include local macro references in Mata blocks', () => {
        fc.assert(
            fc.property(
                arbitrary_identifier,
                (macro_name) => {
                    const search_context: ReferenceSearchContext = {
                        symbol_name: macro_name,
                        symbol_type: 'local_macro',
                        include_declaration: false
                    };

                    // Create tokens with a local macro in Mata context
                    const tokens: Token[] = [
                        {
                            type: 'MACRO_REF_LOCAL',
                            value: `\`${macro_name}'`,
                            range: {
                                start: { line: 5, character: 4 },
                                end: { line: 5, character: 4 + macro_name.length + 2 }
                            }
                        }
                    ];

                    // Create context ranges indicating Mata block
                    const context_ranges: ContextRange[] = [
                        create_context_range(LanguageContext.MATA, 3, 10)
                    ];

                    const matches = provider.scan_tokens_for_references(
                        tokens,
                        'file:///test.do',
                        search_context,
                        context_ranges
                    );

                    // Macros should be found even in Mata blocks
                    expect(matches.length).toBe(1);
                }
            ),
            { numRuns: 100 }
        );
    });

    it('should include global macro references in Python blocks', () => {
        fc.assert(
            fc.property(
                arbitrary_identifier,
                (macro_name) => {
                    const search_context: ReferenceSearchContext = {
                        symbol_name: macro_name,
                        symbol_type: 'global_macro',
                        include_declaration: false
                    };

                    // Create tokens with a global macro in Python context
                    const tokens: Token[] = [
                        {
                            type: 'MACRO_REF_GLOBAL',
                            value: `$${macro_name}`,
                            range: {
                                start: { line: 8, character: 10 },
                                end: { line: 8, character: 10 + macro_name.length + 1 }
                            }
                        }
                    ];

                    // Create context ranges indicating Python block
                    const context_ranges: ContextRange[] = [
                        create_context_range(LanguageContext.PYTHON, 5, 15)
                    ];

                    const matches = provider.scan_tokens_for_references(
                        tokens,
                        'file:///test.do',
                        search_context,
                        context_ranges
                    );

                    // Macros should be found even in Python blocks
                    expect(matches.length).toBe(1);
                }
            ),
            { numRuns: 100 }
        );
    });

    it('should include macro references across all contexts', () => {
        fc.assert(
            fc.property(
                arbitrary_identifier,
                (macro_name) => {
                    const search_context: ReferenceSearchContext = {
                        symbol_name: macro_name,
                        symbol_type: 'local_macro',
                        include_declaration: false
                    };

                    // Create tokens in different contexts
                    const tokens: Token[] = [
                        // In Stata context
                        {
                            type: 'MACRO_REF_LOCAL',
                            value: `\`${macro_name}'`,
                            range: {
                                start: { line: 1, character: 0 },
                                end: { line: 1, character: macro_name.length + 2 }
                            }
                        },
                        // In Mata context
                        {
                            type: 'MACRO_REF_LOCAL',
                            value: `\`${macro_name}'`,
                            range: {
                                start: { line: 5, character: 0 },
                                end: { line: 5, character: macro_name.length + 2 }
                            }
                        },
                        // In Python context
                        {
                            type: 'MACRO_REF_LOCAL',
                            value: `\`${macro_name}'`,
                            range: {
                                start: { line: 15, character: 0 },
                                end: { line: 15, character: macro_name.length + 2 }
                            }
                        }
                    ];

                    const context_ranges: ContextRange[] = [
                        create_context_range(LanguageContext.MATA, 3, 10),
                        create_context_range(LanguageContext.PYTHON, 12, 20)
                    ];

                    const matches = provider.scan_tokens_for_references(
                        tokens,
                        'file:///test.do',
                        search_context,
                        context_ranges
                    );

                    // All macro references should be found
                    expect(matches.length).toBe(3);
                }
            ),
            { numRuns: 100 }
        );
    });
});

describe('Feature: find-references, Property 10: Non-Macros Excluded from Embedded Contexts', () => {
    const provider = new ReferencesProvider();

    // Generator for valid Stata identifiers
    const arbitrary_identifier = fc.stringOf(
        fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz_'.split('')),
        { minLength: 2, maxLength: 10 }
    ).filter(s => /^[a-zA-Z_]/.test(s));

    it('should exclude program references in Mata blocks', () => {
        fc.assert(
            fc.property(
                arbitrary_identifier,
                (program_name) => {
                    const search_context: ReferenceSearchContext = {
                        symbol_name: program_name,
                        symbol_type: 'program',
                        include_declaration: false
                    };

                    // Create tokens with a program call in Mata context
                    const tokens: Token[] = [
                        {
                            type: 'WORD',
                            value: program_name,
                            range: {
                                start: { line: 5, character: 4 },
                                end: { line: 5, character: 4 + program_name.length }
                            }
                        }
                    ];

                    // Create context ranges indicating Mata block
                    const context_ranges: ContextRange[] = [
                        create_context_range(LanguageContext.MATA, 3, 10)
                    ];

                    const matches = provider.scan_tokens_for_references(
                        tokens,
                        'file:///test.do',
                        search_context,
                        context_ranges
                    );

                    // Program references in Mata should be excluded
                    expect(matches.length).toBe(0);
                }
            ),
            { numRuns: 100 }
        );
    });

    it('should exclude variable references in Python blocks', () => {
        fc.assert(
            fc.property(
                arbitrary_identifier,
                (var_name) => {
                    const search_context: ReferenceSearchContext = {
                        symbol_name: var_name,
                        symbol_type: 'variable',
                        include_declaration: false
                    };

                    // Create tokens with a variable in Python context
                    const tokens: Token[] = [
                        {
                            type: 'WORD',
                            value: var_name,
                            range: {
                                start: { line: 8, character: 10 },
                                end: { line: 8, character: 10 + var_name.length }
                            }
                        }
                    ];

                    // Create context ranges indicating Python block
                    const context_ranges: ContextRange[] = [
                        create_context_range(LanguageContext.PYTHON, 5, 15)
                    ];

                    const matches = provider.scan_tokens_for_references(
                        tokens,
                        'file:///test.do',
                        search_context,
                        context_ranges
                    );

                    // Variable references in Python should be excluded
                    expect(matches.length).toBe(0);
                }
            ),
            { numRuns: 100 }
        );
    });

    it('should include non-macro references in Stata context only', () => {
        fc.assert(
            fc.property(
                arbitrary_identifier,
                (program_name) => {
                    const search_context: ReferenceSearchContext = {
                        symbol_name: program_name,
                        symbol_type: 'program',
                        include_declaration: false
                    };

                    // Create tokens in different contexts
                    const tokens: Token[] = [
                        // In Stata context (should be included)
                        {
                            type: 'WORD',
                            value: program_name,
                            range: {
                                start: { line: 1, character: 0 },
                                end: { line: 1, character: program_name.length }
                            }
                        },
                        // In Mata context (should be excluded)
                        {
                            type: 'WORD',
                            value: program_name,
                            range: {
                                start: { line: 5, character: 0 },
                                end: { line: 5, character: program_name.length }
                            }
                        },
                        // In Stata context again (should be included)
                        {
                            type: 'WORD',
                            value: program_name,
                            range: {
                                start: { line: 25, character: 0 },
                                end: { line: 25, character: program_name.length }
                            }
                        }
                    ];

                    const context_ranges: ContextRange[] = [
                        create_context_range(LanguageContext.MATA, 3, 10)
                    ];

                    const matches = provider.scan_tokens_for_references(
                        tokens,
                        'file:///test.do',
                        search_context,
                        context_ranges
                    );

                    // Only Stata context references should be found
                    expect(matches.length).toBe(2);
                    expect(matches[0].range.start.line).toBe(1);
                    expect(matches[1].range.start.line).toBe(25);
                }
            ),
            { numRuns: 100 }
        );
    });

    it('should exclude scalar and matrix references in embedded contexts', () => {
        fc.assert(
            fc.property(
                arbitrary_identifier,
                fc.constantFrom('scalar', 'matrix') as fc.Arbitrary<'scalar' | 'matrix'>,
                (symbol_name, symbol_type) => {
                    const search_context: ReferenceSearchContext = {
                        symbol_name,
                        symbol_type,
                        include_declaration: false
                    };

                    // Create tokens in embedded context
                    const tokens: Token[] = [
                        {
                            type: 'WORD',
                            value: symbol_name,
                            range: {
                                start: { line: 7, character: 0 },
                                end: { line: 7, character: symbol_name.length }
                            }
                        }
                    ];

                    const context_ranges: ContextRange[] = [
                        create_context_range(LanguageContext.MATA, 5, 10)
                    ];

                    const matches = provider.scan_tokens_for_references(
                        tokens,
                        'file:///test.do',
                        search_context,
                        context_ranges
                    );

                    // Scalar/matrix references in embedded context should be excluded
                    expect(matches.length).toBe(0);
                }
            ),
            { numRuns: 100 }
        );
    });
});
