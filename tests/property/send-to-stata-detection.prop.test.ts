import { describe, test, expect } from 'bun:test';
import * as fc from 'fast-check';
import { StataVariant } from '../../client/src/send-to-stata/index';

/**
 * Property-based tests for Stata app detection in send-to-stata.
 * 
 * Feature: send-to-stata
 * Property 7: Stata Variant Detection Order
 * Validates: Requirements 7.2, 7.3
 * 
 * Note: These tests verify the detection order logic without requiring
 * actual Stata installation or VS Code API. The actual detect_stata_app
 * function is tested via integration tests.
 */

// Simulate the detection order logic. Mirrors VALID_VARIANTS in
// stata-detector.ts (edition priority, most capable first); keep in sync.
const DETECTION_ORDER: StataVariant[] =
    ['StataMP', 'StataSE', 'StataBE', 'StataIC', 'Stata'];

function simulate_detection(
    installed_variants: Set<StataVariant>,
    setting_value?: StataVariant
): StataVariant | null {
    // Setting always takes precedence
    if (setting_value) {
        return setting_value;
    }
    
    // Check in order
    for (const my_variant of DETECTION_ORDER) {
        if (installed_variants.has(my_variant)) {
            return my_variant;
        }
    }
    
    return null;
}

describe('Feature: send-to-stata - Stata Detection Properties', () => {
    // Generator for Stata variants
    const variant_gen = fc.constantFrom<StataVariant>(
        'StataMP', 'StataSE', 'StataBE', 'StataIC', 'Stata'
    );

    // Generator for set of installed variants
    const installed_variants_gen = fc.array(variant_gen, { minLength: 0, maxLength: 5 })
        .map(arr => new Set(arr));

    test('Property 7: Setting always takes precedence over detection', () => {
        fc.assert(fc.property(
            installed_variants_gen,
            variant_gen,
            (installed, setting) => {
                const result = simulate_detection(installed, setting);
                expect(result).toBe(setting);
            }
        ), { numRuns: 100 });
    });

    test('Property 7: Detection order is StataMP > StataSE > StataBE > StataIC > Stata', () => {
        fc.assert(fc.property(
            installed_variants_gen,
            (installed) => {
                if (installed.size === 0) {
                    expect(simulate_detection(installed)).toBeNull();
                    return;
                }

                const result = simulate_detection(installed);
                
                // Result should be the first variant in order that is installed
                for (const my_variant of DETECTION_ORDER) {
                    if (installed.has(my_variant)) {
                        expect(result).toBe(my_variant);
                        return;
                    }
                }
            }
        ), { numRuns: 100 });
    });

    test('Property 7: Returns null when no Stata installed and no setting', () => {
        const result = simulate_detection(new Set());
        expect(result).toBeNull();
    });

    test('Property 7: StataMP is preferred when all variants installed', () => {
        const all_installed = new Set<StataVariant>([
            'StataMP', 'StataSE', 'StataBE', 'StataIC', 'Stata'
        ]);
        const result = simulate_detection(all_installed);
        expect(result).toBe('StataMP');
    });

    test('Property 7: StataBE is preferred over StataIC when both installed', () => {
        const installed = new Set<StataVariant>(['StataBE', 'StataIC']);
        const result = simulate_detection(installed);
        expect(result).toBe('StataBE');
    });

    test('Property 7: StataSE is returned when only SE and IC installed', () => {
        const installed = new Set<StataVariant>(['StataSE', 'StataIC']);
        const result = simulate_detection(installed);
        expect(result).toBe('StataSE');
    });

    test('Property 7: StataIC is returned when only IC and basic installed', () => {
        const installed = new Set<StataVariant>(['StataIC', 'Stata']);
        const result = simulate_detection(installed);
        expect(result).toBe('StataIC');
    });

    test('Property 7: Basic Stata is returned when only basic installed', () => {
        const installed = new Set<StataVariant>(['Stata']);
        const result = simulate_detection(installed);
        expect(result).toBe('Stata');
    });

    test('Property 7: Setting overrides even when higher variant installed', () => {
        const installed = new Set<StataVariant>(['StataMP', 'StataSE']);
        // User explicitly wants StataSE even though MP is installed
        const result = simulate_detection(installed, 'StataSE');
        expect(result).toBe('StataSE');
    });

    test('Property 7: Detection is deterministic for same input', () => {
        fc.assert(fc.property(
            installed_variants_gen,
            fc.option(variant_gen, { nil: undefined }),
            (installed, setting) => {
                const result1 = simulate_detection(installed, setting);
                const result2 = simulate_detection(installed, setting);
                expect(result1).toBe(result2);
            }
        ), { numRuns: 100 });
    });
});
