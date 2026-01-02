/**
 * Property-based tests for completion ranking system
 */

import { describe, it, expect } from 'bun:test';
import fc from 'fast-check';
import { compute_ranking_key, CompletionRankingFactors } from '../../src/providers/completion';

describe('Completion Ranking', () => {
    describe('compute_ranking_key', () => {
        it('should prioritize lower scope depths', () => {
            fc.assert(fc.property(
                fc.record({
                    directive_type: fc.constantFrom('current', 'included-by', 'done-by'),
                    symbol_type: fc.constantFrom('builtin', 'user-program', 'local-macro', 'global-macro', 'variable', 'scalar', 'matrix'),
                    alphabetical_order: fc.string({ minLength: 1, maxLength: 10 })
                }),
                (base_factors) => {
                    const factors_depth_0: CompletionRankingFactors = { ...base_factors, scope_depth: 0 };
                    const factors_depth_1: CompletionRankingFactors = { ...base_factors, scope_depth: 1 };
                    
                    const key_0 = compute_ranking_key(factors_depth_0);
                    const key_1 = compute_ranking_key(factors_depth_1);
                    
                    expect(key_0 < key_1).toBe(true);
                }
            ));
        });

        it('should prioritize current over included-by over done-by', () => {
            fc.assert(fc.property(
                fc.record({
                    scope_depth: fc.integer({ min: 0, max: 5 }),
                    symbol_type: fc.constantFrom('builtin', 'user-program', 'local-macro', 'global-macro', 'variable', 'scalar', 'matrix'),
                    alphabetical_order: fc.string({ minLength: 1, maxLength: 10 })
                }),
                (base_factors) => {
                    const current_factors: CompletionRankingFactors = { ...base_factors, directive_type: 'current' };
                    const included_factors: CompletionRankingFactors = { ...base_factors, directive_type: 'included-by' };
                    const done_factors: CompletionRankingFactors = { ...base_factors, directive_type: 'done-by' };
                    
                    const current_key = compute_ranking_key(current_factors);
                    const included_key = compute_ranking_key(included_factors);
                    const done_key = compute_ranking_key(done_factors);
                    
                    expect(current_key < included_key).toBe(true);
                    expect(included_key < done_key).toBe(true);
                }
            ));
        });

        it('should prioritize symbol types in correct order (current context)', () => {
            // Note: program-argument ranking is context-dependent (current vs non-current),
            // so we assert the ordering for the current context here.
            fc.assert(fc.property(
                fc.record({
                    scope_depth: fc.integer({ min: 0, max: 5 }),
                    directive_type: fc.constant('current'),
                    alphabetical_order: fc.string({ minLength: 1, maxLength: 10 })
                }),
                (base_factors) => {
                    const symbol_types: Array<CompletionRankingFactors['symbol_type']> = [
                        'user-program',
                        'local-macro',
                        'program-argument',
                        'global-macro',
                        'variable',
                        'scalar',
                        'matrix',
                        'builtin'
                    ];

                    const keys = symbol_types.map(symbol_type =>
                        compute_ranking_key({ ...base_factors, symbol_type })
                    );

                    // Check that keys are in ascending order (higher priority = lower key)
                    for (let i = 0; i < keys.length - 1; i++) {
                        expect(keys[i] < keys[i + 1]).toBe(true);
                    }
                }
            ));
        });

        it('should use alphabetical order as final tiebreaker', () => {
            fc.assert(fc.property(
                fc.record({
                    scope_depth: fc.integer({ min: 0, max: 5 }),
                    directive_type: fc.constantFrom('current', 'included-by', 'done-by'),
                    symbol_type: fc.constantFrom('builtin', 'user-program', 'local-macro', 'global-macro', 'variable', 'scalar', 'matrix')
                }),
                fc.string({ minLength: 1, maxLength: 10 }).filter(s => /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(s)),
                fc.string({ minLength: 1, maxLength: 10 }).filter(s => /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(s)),
                (base_factors, name_a, name_b) => {
                    fc.pre(name_a !== name_b); // Ensure names are different
                    
                    const factors_a: CompletionRankingFactors = { ...base_factors, alphabetical_order: name_a };
                    const factors_b: CompletionRankingFactors = { ...base_factors, alphabetical_order: name_b };
                    
                    const key_a = compute_ranking_key(factors_a);
                    const key_b = compute_ranking_key(factors_b);
                    
                    const expected_order = name_a.toLowerCase().localeCompare(name_b.toLowerCase()) < 0;
                    const actual_order = key_a < key_b;
                    
                    expect(actual_order).toBe(expected_order);
                }
            ));
        });

        it('should handle edge cases correctly', () => {
            // Test maximum scope depth
            const max_depth_factors: CompletionRankingFactors = {
                scope_depth: 15,
                directive_type: 'current',
                symbol_type: 'builtin',
                alphabetical_order: 'test'
            };
            
            const normal_depth_factors: CompletionRankingFactors = {
                scope_depth: 5,
                directive_type: 'current',
                symbol_type: 'builtin',
                alphabetical_order: 'test'
            };
            
            const max_key = compute_ranking_key(max_depth_factors);
            const normal_key = compute_ranking_key(normal_depth_factors);
            
            // Should clamp to 9 and still be comparable
            expect(max_key > normal_key).toBe(true);
            expect(max_key.startsWith('9')).toBe(true);
        });

        it('should produce consistent results', () => {
            fc.assert(fc.property(
                fc.record({
                    scope_depth: fc.integer({ min: 0, max: 10 }),
                    directive_type: fc.constantFrom('current', 'included-by', 'done-by'),
                    symbol_type: fc.constantFrom('builtin', 'user-program', 'local-macro', 'global-macro', 'variable', 'scalar', 'matrix'),
                    alphabetical_order: fc.string({ minLength: 1, maxLength: 10 })
                }),
                (factors) => {
                    const key1 = compute_ranking_key(factors);
                    const key2 = compute_ranking_key(factors);
                    
                    expect(key1).toBe(key2);
                }
            ));
        });
    });
});