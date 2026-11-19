/**
 * The abbreviation index answers exactly what a scan of the map with
 * `startsWith` answers, through any sequence of additions, earlier
 * redeclarations and changes made without telling the index.
 */
import { describe, expect, it } from 'bun:test';
import * as fc from 'fast-check';
import {
    has_name_with_prefix,
    index_name_prefixes,
} from '../../src/analyzer/name-prefix-index';

// A small alphabet with both cases, so prefixes collide often and
// case must be kept apart.
const NAME = fc.stringMatching(/^[aAb_][aAb_0]{0,4}$/);

type Step =
    | { kind: 'add'; name: string; line: number }
    | { kind: 'add_unindexed'; name: string; line: number }
    | { kind: 'query'; prefix: string; line: number };

const STEP: fc.Arbitrary<Step> = fc.oneof(
    fc.record({
        kind: fc.constant('add' as const),
        name: NAME,
        line: fc.nat(20),
    }),
    fc.record({
        kind: fc.constant('add_unindexed' as const),
        name: NAME,
        line: fc.nat(20),
    }),
    fc.record({
        kind: fc.constant('query' as const),
        prefix: fc.stringMatching(/^[aAb_0]{0,5}$/),
        line: fc.nat(20),
    })
);

function naive(
    names: ReadonlyMap<string, { line: number }>,
    prefix: string,
    line: number
): boolean {
    for (const [my_name, my_value] of names) {
        if (my_name.startsWith(prefix) && my_value.line <= line) return true;
    }
    return false;
}

describe('name prefix index', () => {
    it('agrees with a startsWith scan', () => {
        fc.assert(fc.property(fc.array(STEP, { maxLength: 60 }), (the_steps) => {
            const names = new Map<string, { line: number }>();
            for (const my_step of the_steps) {
                if (my_step.kind === 'query') {
                    expect(has_name_with_prefix(
                        names, my_step.prefix, my_step.line,
                        (my_value) => my_value.line
                    )).toBe(naive(names, my_step.prefix, my_step.line));
                    continue;
                }
                // Keep the earliest line, as declaration directives do.
                const existing = names.get(my_step.name);
                if (existing !== undefined && existing.line <= my_step.line) {
                    continue;
                }
                names.set(my_step.name, { line: my_step.line });
                if (my_step.kind === 'add') {
                    index_name_prefixes(names, my_step.name, my_step.line);
                } else if (existing !== undefined) {
                    // A change the index cannot see by size: tell it.
                    index_name_prefixes(names, my_step.name, my_step.line);
                }
            }
        }), { numRuns: 300 });
    });

    it('matches names in exact case', () => {
        const names = new Map([['Price', 0]]);
        expect(has_name_with_prefix(names, 'Pri')).toBe(true);
        expect(has_name_with_prefix(names, 'pri')).toBe(false);
    });
});

describe('name prefix index work', () => {
    /** A map that counts how many times it is iterated in full. */
    class CountingMap<K, V> extends Map<K, V> {
        iterations = 0;
        override [Symbol.iterator](): MapIterator<[K, V]> {
            this.iterations++;
            return super[Symbol.iterator]();
        }
        override keys(): MapIterator<K> {
            this.iterations++;
            return super.keys();
        }
        override entries(): MapIterator<[K, V]> {
            this.iterations++;
            return super.entries();
        }
    }

    it('scans the map a constant number of times across interleaved adds and lookups', () => {
        const names = new CountingMap<string, number>();
        for (let i = 0; i < 2000; i++) {
            const name = `v${i}_long`;
            names.set(name, 0);
            index_name_prefixes(names, name);
            expect(has_name_with_prefix(names, `v${i}_`)).toBe(true);
            expect(has_name_with_prefix(names, `w${i}`)).toBe(false);
        }
        // The first lookup builds the index; later ones never rescan.
        expect(names.iterations).toBeLessThanOrEqual(2);
    });
});
