/**
 * Formatter Test Utilities
 *
 * Provides helper functions for running formatter tests against both
 * formatter implementations (source-preserving and AST-based).
 *
 * Usage:
 *   import { for_each_formatter_mode, create_formatter_config } from './formatter-test-utils';
 *
 *   for_each_formatter_mode('should format correctly', (mode) => {
 *       const config = create_formatter_config(mode);
 *       // ... test logic
 *   });
 */

import { describe, it, expect } from 'bun:test';
import * as fc from 'fast-check';
import { StataLSPConfig } from '../../../src/types';
import { DEFAULT_SETTINGS } from '../../../src/server-handlers';

/**
 * Formatter mode type for parameterized testing.
 */
export type FormatterMode = 'source-preserving' | 'ast';

/**
 * All formatter modes for iteration.
 */
export const FORMATTER_MODES: FormatterMode[] = ['source-preserving', 'ast'];

/**
 * Creates a StataLSPConfig with the specified formatter mode.
 *
 * @param mode - The formatter mode to use
 * @returns StataLSPConfig configured for the specified mode
 */
export function create_formatter_config(mode: FormatterMode): StataLSPConfig {
    return {
        ...DEFAULT_SETTINGS,
        formatting: {
            ...DEFAULT_SETTINGS.formatting,
            mode,
        },
    };
}

/**
 * Runs a test function for each formatter mode.
 * Creates separate test cases with mode-specific names.
 *
 * @param test_name - Base name for the test
 * @param test_fn - Test function that receives the formatter mode
 */
export function for_each_formatter_mode(
    test_name: string,
    test_fn: (mode: FormatterMode) => void | Promise<void>
): void {
    for (const my_mode of FORMATTER_MODES) {
        it(`${test_name} [${my_mode}]`, async () => {
            await test_fn(my_mode);
        });
    }
}

/**
 * Runs a property test for each formatter mode.
 * Wraps fast-check property tests with mode parameterization.
 *
 * @param test_name - Base name for the test
 * @param arbitrary - fast-check arbitrary for generating test data
 * @param property_fn - Property function that receives mode and generated data
 * @param num_runs - Number of test runs (default: 100)
 */
export function for_each_formatter_mode_property<T>(
    test_name: string,
    arbitrary: fc.Arbitrary<T>,
    property_fn: (mode: FormatterMode, data: T) => boolean | void,
    num_runs: number = 100
): void {
    for (const my_mode of FORMATTER_MODES) {
        it(`${test_name} [${my_mode}]`, () => {
            fc.assert(
                fc.property(arbitrary, (data) => {
                    return property_fn(my_mode, data);
                }),
                { numRuns: num_runs }
            );
        });
    }
}

/**
 * Runs an async property test for each formatter mode.
 * Wraps fast-check async property tests with mode parameterization.
 *
 * @param test_name - Base name for the test
 * @param arbitrary - fast-check arbitrary for generating test data
 * @param property_fn - Async property function that receives mode and generated data
 * @param num_runs - Number of test runs (default: 100)
 */
export function for_each_formatter_mode_async_property<T>(
    test_name: string,
    arbitrary: fc.Arbitrary<T>,
    property_fn: (mode: FormatterMode, data: T) => Promise<boolean | void>,
    num_runs: number = 100
): void {
    for (const my_mode of FORMATTER_MODES) {
        it(`${test_name} [${my_mode}]`, async () => {
            await fc.assert(
                fc.asyncProperty(arbitrary, async (data) => {
                    return property_fn(my_mode, data);
                }),
                { numRuns: num_runs }
            );
        });
    }
}

/**
 * Skips an assertion for a specific formatter mode.
 * Use when behavior legitimately differs between modes.
 *
 * @param mode - Current formatter mode
 * @param skip_mode - Mode to skip the assertion for
 * @param assertion_fn - Assertion function to conditionally execute
 */
export function skip_for_mode(
    mode: FormatterMode,
    skip_mode: FormatterMode,
    assertion_fn: () => void
): void {
    if (mode !== skip_mode) {
        assertion_fn();
    }
}

/**
 * Runs mode-specific assertions.
 *
 * @param mode - Current formatter mode
 * @param assertions - Object mapping modes to assertion functions
 */
export function mode_specific_assertion(
    mode: FormatterMode,
    assertions: Partial<Record<FormatterMode, () => void>>
): void {
    const my_assertion = assertions[mode];
    if (my_assertion) {
        my_assertion();
    }
}

/**
 * Gets the test name suffix for a formatter mode.
 * Useful for generating descriptive test names.
 *
 * @param mode - The formatter mode
 * @returns The mode suffix string (e.g., "[source-preserving]")
 */
export function get_mode_suffix(mode: FormatterMode): string {
    return `[${mode}]`;
}
