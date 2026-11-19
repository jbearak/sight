/**
 * Checking abbreviated variable references must not scan every known
 * variable per reference. A file that creates n variables and reads
 * each by an abbreviation (`gen v1_long = 1` ... `sum v1_`) cost
 * O(n^2) prefix comparisons: 32 million at n = 8,000.
 *
 * The bound is on growth, not on time: analysis of 8x the lines must
 * take well under the 64x a quadratic check takes. Each size keeps its
 * fastest of several runs, so a slow run (GC, JIT) does not count.
 */
import { describe, expect, it } from 'bun:test';
import { SemanticAnalyzer } from '../../src/analyzer';
import { StataLexer } from '../../src/lexer';
import { StataParser } from '../../src/parser';
import { StataDiagnosticCode } from '../../src/types';

function source(count: number, interleaved: boolean): string {
    const the_lines = ['set obs 1'];
    if (interleaved) {
        for (let i = 0; i < count; i++) {
            the_lines.push(`gen v${i}_long = 1`, `sum v${i}_`);
        }
    } else {
        for (let i = 0; i < count; i++) the_lines.push(`gen v${i}_long = 1`);
        for (let i = 0; i < count; i++) the_lines.push(`sum v${i}_`);
    }
    return the_lines.join('\n') + '\n';
}

/** Fastest analysis time of `source`, and its undefined variables. */
function fastest_analysis_ms(text: string): { time_ms: number; undefined_count: number } {
    const tokens = new StataLexer().tokenize(text).tokens;
    const ast = new StataParser().parse(tokens).ast;
    let time_ms = Number.POSITIVE_INFINITY;
    let undefined_count = -1;
    for (let i = 0; i < 5; i++) {
        const start_ms = performance.now();
        const result = new SemanticAnalyzer().analyze(
            ast, 'file:///scaling.do', undefined,
            { undefined_variable_enabled: true }, tokens
        );
        time_ms = Math.min(time_ms, performance.now() - start_ms);
        undefined_count = result.diagnostics.filter((my_diagnostic) =>
            my_diagnostic.code === StataDiagnosticCode.UNDEFINED_VARIABLE
        ).length;
    }
    return { time_ms, undefined_count };
}

describe('undefined-variable check scaling', () => {
    for (const interleaved of [false, true]) {
        const shape = interleaved ? 'interleaved' : 'grouped';
        it(`grows about linearly with abbreviated references (${shape})`, () => {
            // Warm up the JIT so the small size is not inflated.
            fastest_analysis_ms(source(500, interleaved));
            const small = fastest_analysis_ms(source(1000, interleaved));
            const large = fastest_analysis_ms(source(8000, interleaved));
            expect(small.undefined_count).toBe(0);
            expect(large.undefined_count).toBe(0);
            // Linear is about 8x; quadratic about 64x.
            expect(large.time_ms / small.time_ms).toBeLessThan(24);
        }, 60_000);
    }
});

/**
 * Each recognized `rename` checked the whole token stream, twice, for
 * a wildcard beside its names: 1,288,012 token visits for 400
 * successive renames. Counted, not timed: every element read and
 * every full iteration of the token array is a visit.
 */
describe('rename wildcard check scaling', () => {
    function token_visits(command: string, count: number): number {
        const the_lines = ['gen x0 = 1'];
        for (let i = 0; i < count; i++) {
            the_lines.push(`${command} x${i} x${i + 1}`);
        }
        const tokens = new StataLexer().tokenize(the_lines.join('\n') + '\n').tokens;
        const ast = new StataParser().parse(tokens).ast;
        let visits = 0;
        const counted = new Proxy(tokens, {
            get(target, key, receiver) {
                if (key === Symbol.iterator) {
                    return function* () {
                        for (const my_token of target) {
                            visits++;
                            yield my_token;
                        }
                    };
                }
                if (typeof key === 'string' && /^\d+$/.test(key)) visits++;
                return Reflect.get(target, key, receiver);
            },
        });
        new SemanticAnalyzer().analyze(
            ast, 'file:///rename.do', undefined,
            { undefined_variable_enabled: true }, counted
        );
        return visits / tokens.length;
    }

    for (const my_command of ['rena', 'rename']) {
        it(`visits each token a bounded number of times (${my_command})`, () => {
            const small = token_visits(my_command, 200);
            const large = token_visits(my_command, 400);
            // Per-token visits stay flat; a scan per rename doubles them.
            expect(large).toBeLessThan(small * 1.25);
            expect(large).toBeLessThan(30);
        });
    }
});
