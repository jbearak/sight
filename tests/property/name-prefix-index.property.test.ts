/**
 * The abbreviation index answers exactly what a scan of the map with
 * `startsWith` answers, through any sequence of additions and earlier
 * redeclarations made by its owner. Changes made behind the owner's
 * back (between analyses) are seen by the next index, never by a
 * cached one: a module-level cache keyed on the map's size once
 * returned stale answers after a same-size replacement.
 */
import { describe, expect, it } from 'bun:test';
import * as fc from 'fast-check';
import { NamePrefixIndex } from '../../src/analyzer/name-prefix-index';
import { SemanticAnalyzer } from '../../src/analyzer';
import { StataLexer } from '../../src/lexer';
import { StataParser } from '../../src/parser';

// A small alphabet with both cases, so prefixes collide often and
// case must be kept apart.
const NAME = fc.stringMatching(/^[aAb_][aAb_0]{0,4}$/);

type Step =
    | { kind: 'add'; name: string; line: number }
    | { kind: 'external_set'; name: string; line: number }
    | { kind: 'external_delete'; name: string }
    | { kind: 'query'; prefix: string; line: number };

const STEP: fc.Arbitrary<Step> = fc.oneof(
    fc.record({
        kind: fc.constant('add' as const),
        name: NAME,
        line: fc.nat(20),
    }),
    fc.record({
        kind: fc.constant('external_set' as const),
        name: NAME,
        line: fc.nat(20),
    }),
    fc.record({
        kind: fc.constant('external_delete' as const),
        name: NAME,
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
            const line_of = (my_value: { line: number }): number => my_value.line;
            let index = new NamePrefixIndex(names, line_of);
            for (const my_step of the_steps) {
                switch (my_step.kind) {
                    case 'query':
                        expect(index.has(my_step.prefix, my_step.line))
                            .toBe(naive(names, my_step.prefix, my_step.line));
                        break;
                    case 'add': {
                        // Keep the earliest line, as declaration
                        // directives do.
                        const existing = names.get(my_step.name);
                        if (existing !== undefined && existing.line <= my_step.line) {
                            break;
                        }
                        names.set(my_step.name, { line: my_step.line });
                        index.add(my_step.name, my_step.line);
                        break;
                    }
                    case 'external_set':
                        // A change the owner did not make: a new
                        // analysis starts a new index.
                        names.set(my_step.name, { line: my_step.line });
                        index = new NamePrefixIndex(names, line_of);
                        break;
                    case 'external_delete':
                        names.delete(my_step.name);
                        index = new NamePrefixIndex(names, line_of);
                        break;
                }
            }
        }), { numRuns: 300 });
    });

    it('matches names in exact case', () => {
        const index = new NamePrefixIndex(new Map([['Price', 0]]));
        expect(index.has('Pri')).toBe(true);
        expect(index.has('pri')).toBe(false);
    });
});

describe('declared variables changed between analyses', () => {
    function undefined_messages(
        declared: Map<string, { line: number }>
    ): string[] {
        const tokens = new StataLexer().tokenize('su oldp newp\n').tokens;
        const ast = new StataParser().parse(tokens).ast;
        return new SemanticAnalyzer().analyze(
            ast, 'file:///main.do', undefined,
            { declared_variables: declared, undefined_variable_enabled: true },
            tokens
        ).diagnostics.map((my_diagnostic) => my_diagnostic.message);
    }

    it('sees a key replaced by another of the same count', () => {
        const declared = new Map([['oldprice', { line: 0 }]]);
        expect(undefined_messages(declared)).toEqual(['newp may not be defined']);
        declared.delete('oldprice');
        declared.set('newprice', { line: 0 });
        expect(undefined_messages(declared)).toEqual(['oldp may not be defined']);
    });

    it('sees a key moved to a later line', () => {
        const declared = new Map([
            ['oldprice', { line: 0 }],
            ['newprice', { line: 0 }],
        ]);
        expect(undefined_messages(declared)).toEqual([]);
        declared.set('newprice', { line: 5 });
        expect(undefined_messages(declared)).toEqual(['newp may not be defined']);
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
        const index = new NamePrefixIndex(names);
        for (let i = 0; i < 2000; i++) {
            const name = `v${i}_long`;
            names.set(name, 0);
            index.add(name);
            expect(index.has(`v${i}_`)).toBe(true);
            expect(index.has(`w${i}`)).toBe(false);
        }
        // The first lookup builds the index; later ones never rescan.
        expect(names.iterations).toBeLessThanOrEqual(1);
    });
});
