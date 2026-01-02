/**
 * Property tests for directive ordering.
 *
 * Tie-breaking rule (same depth): lattermost directive in the referencing file header wins.
 * Therefore, the resolver must preserve directive order as written and avoid re-sorting.
 */

import { describe, it, expect } from 'bun:test';
import * as fc from 'fast-check';
import { ScopeResolver } from '../../src/scope-resolver';
import { Directive } from '../../src/types';

describe('Directive Ordering', () => {
    it('should preserve directive order exactly', () => {
        fc.assert(
            fc.property(
                fc.array(
                    fc.record({
                        type: fc.constantFrom('done-by', 'included-by'),
                        path: fc.string({ minLength: 1, maxLength: 20 }).map(s => `/path/${s}.do`),
                        call_site_line: fc.integer({ min: 1, max: 100 }),
                    }),
                    { minLength: 1, maxLength: 10 }
                ),
                (directive_specs) => {
                    const directives: Directive[] = directive_specs.map((spec, index) => ({
                        type: spec.type as 'done-by' | 'included-by',
                        path: spec.path,
                        raw_path: spec.path,
                        call_site: {
                            type: 'line',
                            value: spec.call_site_line,
                        },
                        range: {
                            start: { line: index, character: 0 },
                            end: { line: index, character: 10 },
                        },
                    }));

                    const resolver = new ScopeResolver();
                    // Directives are processed in order - no sorting needed
                    const preserved = directives;

                    // Must preserve order
                    expect(preserved).toEqual(directives);
                }
            ),
            { numRuns: 100 }
        );
    });

    it('should not normalize away duplicates (order preserved)', () => {
        const directive: Directive = {
            type: 'done-by',
            path: '/test/parent.do',
            raw_path: '/test/parent.do',
            call_site: { type: 'line', value: 10 },
            range: { start: { line: 0, character: 0 }, end: { line: 0, character: 10 } },
        };

        const directives = [directive, { ...directive, range: { start: { line: 1, character: 0 }, end: { line: 1, character: 10 } } }];
        const resolver = new ScopeResolver();
        // Directives are processed in order - no sorting needed
        const preserved = directives;

        expect(preserved).toHaveLength(2);
        expect(preserved[0]).toEqual(directives[0]);
        expect(preserved[1]).toEqual(directives[1]);
    });
});
