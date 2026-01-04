/**
 * Property Tests: Dual Formatter Execution
 *
 * Feature: dual-formatter-testing
 * Tests the formatter test utilities that enable running tests against
 * both formatter implementations.
 */

import { describe, it, expect } from 'bun:test';
import * as fc from 'fast-check';
import {
    FormatterMode,
    FORMATTER_MODES,
    create_formatter_config,
    skip_for_mode,
    mode_specific_assertion,
    get_mode_suffix,
} from './helpers/formatter-test-utils';

describe('Dual Formatter Execution Property Tests', () => {
    /**
     * Property 2: Config Mode Correctness
     *
     * For any formatter mode value, create_formatter_config(mode) SHALL return
     * a StataLSPConfig where config.formatting.mode equals the input mode.
     *
     * Feature: dual-formatter-testing, Property 2: Config Mode Correctness
     * Validates: Requirements 2.2
     */
    describe('Property 2: Config Mode Correctness', () => {
        it('should create config with correct mode for all formatter modes', () => {
            const mode_arb = fc.constantFrom<FormatterMode>(...FORMATTER_MODES);

            fc.assert(
                fc.property(mode_arb, (mode) => {
                    const my_config = create_formatter_config(mode);

                    // Config should have the correct mode
                    expect(my_config.formatting.mode).toBe(mode);

                    // Config should have all required formatting properties
                    expect(my_config.formatting.indentSize).toBeDefined();
                    expect(my_config.formatting.indentStyle).toBeDefined();

                    return true;
                }),
                { numRuns: 100 }
            );
        });

        it('should preserve other DEFAULT_SETTINGS when creating config', () => {
            const mode_arb = fc.constantFrom<FormatterMode>(...FORMATTER_MODES);

            fc.assert(
                fc.property(mode_arb, (mode) => {
                    const my_config = create_formatter_config(mode);

                    // Other settings should be preserved
                    expect(my_config.diagnostics).toBeDefined();
                    expect(my_config.completion).toBeDefined();
                    expect(my_config.indexing).toBeDefined();

                    return true;
                }),
                { numRuns: 100 }
            );
        });
    });

    /**
     * Property 3: Mode Skip Correctness
     *
     * For any current mode and skip mode, skip_for_mode(current, skip, fn)
     * SHALL execute fn if and only if current !== skip.
     *
     * Feature: dual-formatter-testing, Property 3: Mode Skip Correctness
     * Validates: Requirements 4.1, 4.2
     */
    describe('Property 3: Mode Skip Correctness', () => {
        it('should execute assertion when modes differ', () => {
            const mode_pair_arb = fc.tuple(
                fc.constantFrom<FormatterMode>(...FORMATTER_MODES),
                fc.constantFrom<FormatterMode>(...FORMATTER_MODES)
            );

            fc.assert(
                fc.property(mode_pair_arb, ([current_mode, skip_mode]) => {
                    let my_executed = false;

                    skip_for_mode(current_mode, skip_mode, () => {
                        my_executed = true;
                    });

                    // Assertion should execute if and only if modes differ
                    const should_execute = current_mode !== skip_mode;
                    expect(my_executed).toBe(should_execute);

                    return true;
                }),
                { numRuns: 100 }
            );
        });

        it('should not execute assertion when modes match', () => {
            const mode_arb = fc.constantFrom<FormatterMode>(...FORMATTER_MODES);

            fc.assert(
                fc.property(mode_arb, (mode) => {
                    let my_executed = false;

                    skip_for_mode(mode, mode, () => {
                        my_executed = true;
                    });

                    // Assertion should NOT execute when modes match
                    expect(my_executed).toBe(false);

                    return true;
                }),
                { numRuns: 100 }
            );
        });
    });

    /**
     * Property 4: Test Name Mode Inclusion
     *
     * For any base test name, the generated test names from for_each_formatter_mode
     * SHALL contain the mode identifier (either [source-preserving] or [ast]).
     *
     * Feature: dual-formatter-testing, Property 4: Test Name Mode Inclusion
     * Validates: Requirements 5.2
     */
    describe('Property 4: Test Name Mode Inclusion', () => {
        it('should generate mode suffix containing the mode name', () => {
            const mode_arb = fc.constantFrom<FormatterMode>(...FORMATTER_MODES);

            fc.assert(
                fc.property(mode_arb, (mode) => {
                    const my_suffix = get_mode_suffix(mode);

                    // Suffix should contain the mode name
                    expect(my_suffix).toContain(mode);

                    // Suffix should be in bracket format
                    expect(my_suffix).toMatch(/^\[.+\]$/);

                    return true;
                }),
                { numRuns: 100 }
            );
        });

        it('should generate unique suffixes for each mode', () => {
            const the_suffixes = FORMATTER_MODES.map(mode => get_mode_suffix(mode));

            // All suffixes should be unique
            const the_unique_suffixes = new Set(the_suffixes);
            expect(the_unique_suffixes.size).toBe(FORMATTER_MODES.length);
        });
    });

    /**
     * Additional tests for mode_specific_assertion helper
     */
    describe('mode_specific_assertion helper', () => {
        it('should execute only the assertion for the current mode', () => {
            const mode_arb = fc.constantFrom<FormatterMode>(...FORMATTER_MODES);

            fc.assert(
                fc.property(mode_arb, (mode) => {
                    const my_executed_modes: FormatterMode[] = [];

                    mode_specific_assertion(mode, {
                        'source-preserving': () => my_executed_modes.push('source-preserving'),
                        'ast': () => my_executed_modes.push('ast'),
                    });

                    // Only the current mode's assertion should execute
                    expect(my_executed_modes).toEqual([mode]);

                    return true;
                }),
                { numRuns: 100 }
            );
        });

        it('should handle missing assertions gracefully', () => {
            const mode_arb = fc.constantFrom<FormatterMode>(...FORMATTER_MODES);

            fc.assert(
                fc.property(mode_arb, (mode) => {
                    // Should not throw when assertion for mode is missing
                    expect(() => {
                        mode_specific_assertion(mode, {});
                    }).not.toThrow();

                    return true;
                }),
                { numRuns: 100 }
            );
        });
    });

    /**
     * Test that FORMATTER_MODES contains expected values
     */
    describe('FORMATTER_MODES constant', () => {
        it('should contain both formatter modes', () => {
            expect(FORMATTER_MODES).toContain('source-preserving');
            expect(FORMATTER_MODES).toContain('ast');
            expect(FORMATTER_MODES.length).toBe(2);
        });
    });
});
