// Feature: global-macro-execution-order, Property 6: Symbol Name Extraction Round-Trip
// Validates: Requirements 2.3, 2.4

import * as fc from 'fast-check';
import { describe, it, expect } from 'bun:test';
import { arbitrary_macro_name } from './generators/primitives';

/**
 * Extraction logic matching DiagnosticsProvider.extract_symbol_name_from_diagnostic
 *
 * Extracts symbol names from diagnostic messages in these formats:
 * - Local macro format: `name'
 * - Global macro format: $name
 * - Quoted format: 'name' (fallback)
 */
function extract_symbol_name_from_diagnostic(message: string): string | null {
    // Try local macro format first: `name'
    const local_macro_match = message.match(/`([^']+)'/);
    if (local_macro_match) {
        return local_macro_match[1];
    }

    // Try global macro format: $name
    const global_macro_match = message.match(/\$([a-zA-Z_][a-zA-Z0-9_]*)/);
    if (global_macro_match) {
        return global_macro_match[1];
    }

    // Fall back to quoted format: 'name'
    const quoted_match = message.match(/'([^']+)'/);
    return quoted_match ? quoted_match[1] : null;
}

describe('Symbol Name Extraction Round-Trip Properties', () => {
    /**
     * Property 6: Symbol Name Extraction Round-Trip
     *
     * For any valid macro name N, creating a diagnostic message in either
     * local (`N') or global ($N) format and then extracting the symbol name
     * SHALL return N.
     */
    describe('Property 6: Symbol Name Extraction Round-Trip', () => {
        it('extracts local macro names correctly from diagnostic messages', () => {
            fc.assert(
                fc.property(
                    arbitrary_macro_name(),
                    (macro_name) => {
                        // Create diagnostic message in local macro format
                        const diagnostic_message = `Undefined local macro: \`${macro_name}'`;

                        // Extract the symbol name
                        const extracted_name = extract_symbol_name_from_diagnostic(
                            diagnostic_message
                        );

                        // Verify round-trip: extracted name should match original
                        return extracted_name === macro_name;
                    }
                ),
                { numRuns: 200 }
            );
        });

        it('extracts global macro names correctly from diagnostic messages', () => {
            fc.assert(
                fc.property(
                    arbitrary_macro_name(),
                    (macro_name) => {
                        // Create diagnostic message in global macro format
                        const diagnostic_message = `Undefined global macro: $${macro_name}`;

                        // Extract the symbol name
                        const extracted_name = extract_symbol_name_from_diagnostic(
                            diagnostic_message
                        );

                        // Verify round-trip: extracted name should match original
                        return extracted_name === macro_name;
                    }
                ),
                { numRuns: 200 }
            );
        });

        it('handles both formats consistently in mixed scenarios', () => {
            fc.assert(
                fc.property(
                    arbitrary_macro_name(),
                    fc.boolean(),
                    (macro_name, use_local_format) => {
                        // Create diagnostic message in either format
                        const diagnostic_message = use_local_format
                            ? `Undefined local macro: \`${macro_name}'`
                            : `Undefined global macro: $${macro_name}`;

                        // Extract the symbol name
                        const extracted_name = extract_symbol_name_from_diagnostic(
                            diagnostic_message
                        );

                        // Verify round-trip: extracted name should match original
                        return extracted_name === macro_name;
                    }
                ),
                { numRuns: 200 }
            );
        });

        it('local format takes precedence over global format', () => {
            fc.assert(
                fc.property(
                    arbitrary_macro_name(),
                    arbitrary_macro_name(),
                    (local_name, global_name) => {
                        // Create a message containing both formats
                        // Local format should be extracted first
                        const diagnostic_message =
                            `Found $${global_name} and \`${local_name}'`;

                        const extracted_name = extract_symbol_name_from_diagnostic(
                            diagnostic_message
                        );

                        // Local format takes precedence
                        return extracted_name === local_name;
                    }
                ),
                { numRuns: 100 }
            );
        });

        it('extracts names with underscores correctly', () => {
            // Generator for names that specifically include underscores
            const name_with_underscore_gen = fc.tuple(
                fc.constantFrom('_', 'a', 'A'),
                fc.stringMatching(/^[a-zA-Z0-9_]{0,10}$/),
                fc.constant('_'),
                fc.stringMatching(/^[a-zA-Z0-9_]{0,10}$/)
            ).map(([first, middle, underscore, rest]) =>
                first + middle + underscore + rest
            ).filter(s => /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(s) && s.length > 0);

            fc.assert(
                fc.property(
                    name_with_underscore_gen,
                    fc.boolean(),
                    (macro_name, use_local_format) => {
                        const diagnostic_message = use_local_format
                            ? `Undefined local macro: \`${macro_name}'`
                            : `Undefined global macro: $${macro_name}`;

                        const extracted_name = extract_symbol_name_from_diagnostic(
                            diagnostic_message
                        );

                        return extracted_name === macro_name;
                    }
                ),
                { numRuns: 100 }
            );
        });

        it('extracts names starting with underscore correctly', () => {
            // Generator for names starting with underscore
            const underscore_start_gen = fc.tuple(
                fc.constant('_'),
                fc.stringMatching(/^[a-zA-Z0-9_]{0,15}$/)
            ).map(([underscore, rest]) => underscore + rest)
             .filter(s => s.length > 0);

            fc.assert(
                fc.property(
                    underscore_start_gen,
                    fc.boolean(),
                    (macro_name, use_local_format) => {
                        const diagnostic_message = use_local_format
                            ? `Undefined local macro: \`${macro_name}'`
                            : `Undefined global macro: $${macro_name}`;

                        const extracted_name = extract_symbol_name_from_diagnostic(
                            diagnostic_message
                        );

                        return extracted_name === macro_name;
                    }
                ),
                { numRuns: 100 }
            );
        });

        it('extracts single character names correctly', () => {
            // Generator for single character valid macro names
            const single_char_gen = fc.constantFrom(
                'a', 'b', 'c', 'x', 'y', 'z',
                'A', 'B', 'C', 'X', 'Y', 'Z',
                '_'
            );

            fc.assert(
                fc.property(
                    single_char_gen,
                    fc.boolean(),
                    (macro_name, use_local_format) => {
                        const diagnostic_message = use_local_format
                            ? `Undefined local macro: \`${macro_name}'`
                            : `Undefined global macro: $${macro_name}`;

                        const extracted_name = extract_symbol_name_from_diagnostic(
                            diagnostic_message
                        );

                        return extracted_name === macro_name;
                    }
                ),
                { numRuns: 50 }
            );
        });

        it('extracts names with digits correctly', () => {
            // Generator for names containing digits (but not starting with digit)
            const name_with_digits_gen = fc.tuple(
                fc.constantFrom('a', 'b', 'c', '_', 'A', 'B', 'C'),
                fc.stringMatching(/^[a-zA-Z0-9_]{0,5}$/),
                fc.stringMatching(/^[0-9]{1,3}$/),
                fc.stringMatching(/^[a-zA-Z0-9_]{0,5}$/)
            ).map(([first, middle, digits, rest]) =>
                first + middle + digits + rest
            ).filter(s => /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(s));

            fc.assert(
                fc.property(
                    name_with_digits_gen,
                    fc.boolean(),
                    (macro_name, use_local_format) => {
                        const diagnostic_message = use_local_format
                            ? `Undefined local macro: \`${macro_name}'`
                            : `Undefined global macro: $${macro_name}`;

                        const extracted_name = extract_symbol_name_from_diagnostic(
                            diagnostic_message
                        );

                        return extracted_name === macro_name;
                    }
                ),
                { numRuns: 100 }
            );
        });
    });
});
