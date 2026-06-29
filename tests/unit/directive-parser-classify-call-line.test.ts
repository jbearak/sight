import { describe, test, expect } from 'bun:test';
import { DirectiveParser } from '../../src/directive-parser';

// Tests for issue #240: scope-resolver call-site validation must match the
// directive parser. classify_call_line is the shared single-line classifier;
// find_match_line and the inference scanners must skip block comments and reject
// param-like unquoted tokens.

describe('DirectiveParser.classify_call_line', () => {
    const parser = new DirectiveParser();

    test('classifies real do/run/include commands with a path', () => {
        expect(parser.classify_call_line('do "x.do"')).toBe('do');
        expect(parser.classify_call_line('run x.do')).toBe('run');
        expect(parser.classify_call_line('include "x.do"')).toBe('include');
    });

    test('keeps do-file arguments valid (junk after path is a script arg)', () => {
        // Stata runs `do file arg1 arg2`; the trailing tokens are arguments,
        // not malformed syntax. Must NOT be rejected.
        expect(parser.classify_call_line('do "x.do" arg1 arg2')).toBe('do');
        expect(parser.classify_call_line('do x.do junk')).toBe('do');
    });

    test('classifies prefixed commands', () => {
        expect(parser.classify_call_line('qui do "x.do"')).toBe('do');
        expect(parser.classify_call_line('cap include x.do')).toBe('include');
        expect(parser.classify_call_line('noisily run "x.do"')).toBe('run');
    });

    test('rejects a pathless do command', () => {
        expect(parser.classify_call_line('do ')).toBeUndefined();
        expect(parser.classify_call_line('do')).toBeUndefined();
    });

    test('accepts a real path with a trailing comment', () => {
        // The path token is captured before any trailing comment.
        expect(parser.classify_call_line('do "x.do" /* run it */')).toBe('do');
        expect(parser.classify_call_line('do x.do // run it')).toBe('do');
    });

    test('classifies valid forward directives (both prefixes)', () => {
        expect(parser.classify_call_line('// sight: do: "x.do"')).toBe('do');
        expect(parser.classify_call_line('* sight: include: "x.do"')).toBe('include');
        expect(parser.classify_call_line('// @lsp-run: "x.do"')).toBe('run');
    });

    test('classifies a forward directive with a valid param tail', () => {
        expect(parser.classify_call_line('// sight: do: "x.do" line=2')).toBe('do');
        expect(parser.classify_call_line('// sight: do: "x.do" match="foo"')).toBe('do');
    });

    test('rejects a forward directive with no path (param-like token)', () => {
        // `// sight: do line=5` has no path: `line=5` is a param-like unquoted
        // token, which parse_forward_call_directives also rejects as malformed.
        expect(parser.classify_call_line('// sight: do line=5')).toBeUndefined();
        expect(parser.classify_call_line('// @lsp-do match="foo"')).toBeUndefined();
    });

    test('rejects a forward directive with trailing junk after the path', () => {
        // The directive param tail only accepts line=/match=; trailing `junk`
        // is malformed (unlike a real `do` command, where it would be an arg).
        expect(parser.classify_call_line('// sight: do: "x.do" junk')).toBeUndefined();
    });

    test('returns undefined for a non-call line', () => {
        expect(parser.classify_call_line('gen x = 1')).toBeUndefined();
        expect(parser.classify_call_line('// just a comment')).toBeUndefined();
    });

    test('is single-line: it does not apply @lsp-ignore-next context', () => {
        // classify_call_line has no surrounding context, so an ignore-next on a
        // previous line cannot suppress it. Documents the deliberate out-of-scope
        // behavior for explicit call-site validation (see issue #240 spec).
        expect(parser.classify_call_line('// sight: do: "x.do"')).toBe('do');
    });
});

describe('DirectiveParser.find_match_line block-comment awareness', () => {
    const parser = new DirectiveParser();

    test('skips a match inside a /* ... */ block comment', () => {
        const content = [
            '/*',
            'do "child.do"',   // line 1: inside block comment, inert
            '*/',
            'global mid 1',
            'do "child.do"',   // line 4: the real call
        ].join('\n');
        expect(parser.find_match_line(content, 'do "child.do"')).toBe(4);
    });

    test('returns undefined when the only match is block-commented', () => {
        const content = [
            '/*',
            'do "child.do"',
            '*/',
        ].join('\n');
        expect(parser.find_match_line(content, 'do "child.do"')).toBeUndefined();
    });

    test('finds a non-block-commented match normally', () => {
        const content = ['display 1', 'do "child.do"', 'display 2'].join('\n');
        expect(parser.find_match_line(content, 'do "child.do"')).toBe(1);
    });

    test('finds a live call after a leading inline block comment (span-aware)', () => {
        // `/* note */ do "child.do"` has the do AFTER the */, which is live code.
        // Span-aware search checks the match POSITION (col 11), which is outside
        // the comment span [0,10), so the match is found on line 0.
        const content = ['/* note */ do "child.do"'].join('\n');
        expect(parser.find_match_line(content, 'do "child.do"')).toBe(0);
    });

    test('skips a match inside a trailing inline block comment', () => {
        // `display 1 /* do "child.do" */` has the match text INSIDE an inline
        // block comment on an otherwise-active line; it must be skipped, and the
        // real call on a later line found instead.
        const content = [
            'display 1 /* do "child.do" */',
            'do "child.do"',
        ].join('\n');
        expect(parser.find_match_line(content, 'do "child.do"')).toBe(1);
    });

    test('returns undefined when the only match is in a trailing inline comment', () => {
        const content = ['display 1 /* do "child.do" */'].join('\n');
        expect(parser.find_match_line(content, 'do "child.do"')).toBeUndefined();
    });

    test('an empty match string terminates over block-commented content', () => {
        // Regression: an unbounded indexOf('') scan would never terminate on a
        // multi-line block comment (every position stays inside the span). The
        // key guarantee is that the call returns rather than hanging.
        const commented = ['/*', 'x', '*/'].join('\n');
        expect(typeof parser.find_match_line(commented, '')).toBe('number');
        const with_code = ['display 1', '/*', 'x', '*/'].join('\n');
        expect(parser.find_match_line(with_code, '')).toBe(0);
    });
});

describe('inference scanners reject param-like unquoted directive tokens', () => {
    const parser = new DirectiveParser();

    test('find_all_call_sites_for_file ignores `do line=5` for child line=5.do', () => {
        // Without the guard, `// sight: do line=5` would capture `line=5` and
        // wrongly match a child literally named line=5.do (issue #240 Finding B).
        const parent = ['display 1', '// sight: do line=5'].join('\n');
        expect(parser.find_all_call_sites_for_file(parent, 'line=5.do')).toEqual([]);
    });

    test('a real command targeting line=5.do still matches', () => {
        const parent = ['do "line=5.do"'].join('\n');
        const sites = parser.find_all_call_sites_for_file(parent, 'line=5.do');
        expect(sites.length).toBe(1);
        expect(sites[0].call_type).toBe('do');
    });

    test('a normal forward directive still matches', () => {
        const parent = ['// sight: do: "child.do"'].join('\n');
        const sites = parser.find_all_call_sites_for_file(parent, 'child.do');
        expect(sites.length).toBe(1);
        expect(sites[0].call_type).toBe('do');
    });

    // The guard lives in all three inference scanners; assert each so the
    // shared invariant cannot regress in just one of them.
    test('infer_call_type_for_file ignores `do line=5` for child line=5.do', () => {
        const parent = ['display 1', '// sight: do line=5'].join('\n');
        expect(parser.infer_call_type_for_file(parent, 'line=5.do')).toBeUndefined();
    });

    test('infer_call_site_for_file ignores `do line=5` for child line=5.do', () => {
        const parent = ['display 1', '// sight: do line=5'].join('\n');
        expect(parser.infer_call_site_for_file(parent, 'line=5.do')).toBeUndefined();
    });

    test('infer_call_type_for_file still matches a normal forward directive', () => {
        const parent = ['// sight: do: "child.do"'].join('\n');
        expect(parser.infer_call_type_for_file(parent, 'child.do')).toEqual({
            line: 0,
            call_type: 'do',
        });
    });

    test('inference scanners match a real command path', () => {
        const parent = ['do child.do'].join('\n');
        expect(parser.infer_call_site_for_file(parent, 'child.do')).toBe(0);
        const sites = parser.find_all_call_sites_for_file(parent, 'child.do');
        expect(sites.length).toBe(1);
        expect(sites[0].call_type).toBe('do');
    });
});
