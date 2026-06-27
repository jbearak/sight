/**
 * Regression tests for the CodeQL `js/polynomial-redos` fixes.
 *
 * Each test pairs (a) a behavior check that the rewritten matcher still
 * recognizes the same inputs it did before, with (b) a worst-case timing check
 * proving the matcher no longer degrades to polynomial time. The pathological
 * strings mirror the witnesses CodeQL reported for each alert. A vulnerable
 * (O(n^2)) implementation would take many seconds on these ~100k-char inputs;
 * the linear replacements finish in milliseconds, so the generous 1s bound is
 * safe against CI jitter while still failing loudly on a regression.
 */

import { describe, it, expect } from 'bun:test';
import {
    extract_sections,
    extract_banner_name,
    extract_block_comment_heading,
} from '../../src/providers/section-detector';
import { contains_markdown } from '../../src/comment-processor/comment-analysis';
import { SemanticAnalyzer } from '../../src/analyzer';
import { compute_line_offsets } from '../../src/utils/line-utils';

const TIME_BUDGET_MS = 1000;
const PUMP = 100_000;

function elapsed_ms(fn: () => void): number {
    const my_start = performance.now();
    fn();
    return performance.now() - my_start;
}

function section_names(content: string): string[] {
    const my_offsets = compute_line_offsets(content);
    return extract_sections(content, my_offsets).map(s => s.name);
}

describe('ReDoS regression: section-detector single-line patterns', () => {
    it('still detects slash-, star-, and starred-inline sections', () => {
        expect(section_names('// Data prep ----')).toEqual(['Data prep']);
        expect(section_names('* Data prep ====')).toEqual(['Data prep']);
        expect(section_names('** Data prep **')).toEqual(['Data prep']);
        expect(section_names('*** Data prep ***')).toEqual(['Data prep']);
        // Names containing internal delimiter-like text are preserved.
        expect(section_names('// a -- b ====')).toEqual(['a -- b']);
    });

    it('still rejects lines without a valid trailing delimiter', () => {
        // Fewer than 4 delimiter chars, or no whitespace separator.
        expect(section_names('// not a section ---')).toEqual([]);
        expect(section_names('// ----')).toEqual([]);
        expect(section_names('* just a comment')).toEqual([]);
    });

    it('handles whitespace-heavy pathological lines in linear time', () => {
        // Witness: "// !" then many spaces, never reaching a delimiter.
        const my_slash = '// !' + ' '.repeat(PUMP);
        const my_star = '* !' + ' '.repeat(PUMP);
        const my_starred = '** !' + ' '.repeat(PUMP);
        const my_ms = elapsed_ms(() => {
            section_names(my_slash);
            section_names(my_star);
            section_names(my_starred);
        });
        expect(my_ms).toBeLessThan(TIME_BUDGET_MS);
    });
});

describe('ReDoS regression: section-detector trailing-strip helpers', () => {
    it('still strips trailing delimiter/whitespace from banner names', () => {
        expect(extract_banner_name('* Methods ====')).toBe('Methods');
        expect(extract_banner_name('// === Results === ')).toBe('Results');
        expect(extract_block_comment_heading(' * Overview ** ')).toBe('Overview');
    });

    it('handles long trailing delimiter runs in linear time', () => {
        // The callers `.trim()` first, so a whitespace pump never reaches the
        // trailing-strip helper; delimiter chars (`=`, `*`) survive trim and do
        // exercise `strip_trailing`'s scan.
        const my_banner = '* Methods ' + '='.repeat(PUMP);
        const my_heading = ' * Overview ' + '*'.repeat(PUMP);
        let my_banner_name: string | null = null;
        let my_heading_name: string | null = null;
        const my_ms = elapsed_ms(() => {
            my_banner_name = extract_banner_name(my_banner);
            my_heading_name = extract_block_comment_heading(my_heading);
        });
        expect(my_ms).toBeLessThan(TIME_BUDGET_MS);
        // And the long run is still stripped down to the heading text.
        expect(my_banner_name).toBe('Methods');
        expect(my_heading_name).toBe('Overview');
    });
});

describe('ReDoS regression: markdown link detection', () => {
    // The link check is exactly equivalent to the old `/\[.+\]\(.+\)/`; these
    // cases pin that equivalence (a `[`, then `](`, then `)` on one line).
    it('still detects markdown links and non-links', () => {
        expect(contains_markdown('see [docs](http://x)')).toBe(true);
        expect(contains_markdown('q [docs](http://x?a=1&b=2)')).toBe(true);
        // URLs with nested parens and bracketed link text match, as the old
        // greedy `.+` regex did.
        expect(contains_markdown('[wiki](https://en.wikipedia.org/wiki/Foo_(bar))'))
            .toBe(true);
        expect(contains_markdown('[a [b]](url)')).toBe(true);
        expect(contains_markdown('plain text only')).toBe(false);
        // Like the old regex: empty text/URL and links spanning any JS line
        // terminator do not count (each `.+` needs >=1 char and `.` never
        // crosses LF, CR, LS, or PS).
        expect(contains_markdown('[x]()')).toBe(false);
        expect(contains_markdown('[]( )')).toBe(false);
        expect(contains_markdown('[x](a\nb)')).toBe(false);
        expect(contains_markdown('[a](b\rc)')).toBe(false);
        expect(contains_markdown('[a](b\u2028c)')).toBe(false);
        // A space (not a line terminator) is a valid `.`, so this is a link.
        expect(contains_markdown('[a]( )')).toBe(true);
    });

    it('handles the "[a](" repetition witness in linear time', () => {
        // Many "](" with no closing ')' — the pump that made the old
        // `\[.+\]\(.+\)` backtrack. It is not a link (no ')'), so detection is
        // correctly negative; the point is that it resolves in linear time.
        const my_content = '[a](' + 'a]('.repeat(PUMP);
        let my_result = true;
        const my_ms = elapsed_ms(() => {
            my_result = contains_markdown(my_content);
        });
        expect(my_ms).toBeLessThan(TIME_BUDGET_MS);
        expect(my_result).toBe(false);
    });
});

describe('ReDoS regression: analyzer macro-reference extraction', () => {
    const analyzer = new SemanticAnalyzer();

    it('still extracts local and global macro references', () => {
        expect(analyzer.extract_macro_refs_from_extended_args("`a' + `b'"))
            .toEqual(['a', 'b']);
        expect(analyzer.extract_macro_refs_from_extended_args('${x} + $y'))
            .toEqual(['x', 'y']);
    });

    it('handles unterminated local/global witnesses in linear time', () => {
        // Witness 24: backtick then many non-quote chars, no closing quote.
        // Each backtick is a candidate start; the old `[^']+` overlapped across
        // them, the new `[^'`]+` cannot.
        const my_local = '`' + '`&'.repeat(PUMP);
        // Witness 25: many "${" with no closing brace. The old `[^}]+` spanned
        // every "${" from each start (O(n^2)); the new `[^{}]+` stops at the
        // next "{".
        const my_global = '${'.repeat(PUMP);
        const my_ms = elapsed_ms(() => {
            analyzer.extract_macro_refs_from_extended_args(my_local);
            analyzer.extract_macro_refs_from_extended_args(my_global);
        });
        expect(my_ms).toBeLessThan(TIME_BUDGET_MS);
    });
});
