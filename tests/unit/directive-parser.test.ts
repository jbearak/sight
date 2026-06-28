import { describe, test, expect } from 'bun:test';
import { DirectiveParser } from '../../src/directive-parser';
import { has_trailing_ignore_directive } from '../../src/utils/directives';

describe('has_trailing_ignore_directive', () => {
    test('matches a trailing same-line ignore comment (both prefixes)', () => {
        expect(has_trailing_ignore_directive('gen x = 1 // sight: ignore')).toBe(true);
        expect(has_trailing_ignore_directive('gen x = 1 // @lsp-ignore')).toBe(true);
    });

    test('does not match ignore-next or non-ignore lines', () => {
        // ignore-next targets the next statement, not the same line.
        expect(has_trailing_ignore_directive('gen x = 1 // sight: ignore-next')).toBe(false);
        expect(has_trailing_ignore_directive('gen x = 1 // a normal comment')).toBe(false);
        expect(has_trailing_ignore_directive('gen x = 1')).toBe(false);
    });
});

describe('DirectiveParser', () => {
    test('resolve_path normalizes Windows-style separators for relative paths', () => {
        const parser = new DirectiveParser();
        const containing_dir = '/Users/test/project/subdir';

        const resolved = parser.resolve_path('..\\parent.do', containing_dir);
        expect(resolved).toBe('/Users/test/project/parent.do');
    });

    describe('Flexible Syntax Forms', () => {
        const parser = new DirectiveParser();

        test('parses @lsp-done-by without colon and without quotes', () => {
            const content = '// @lsp-done-by parent.do\ngen x = 1';
            const result = parser.parse(content, 'file:///test.do');
            expect(result.directives.length).toBe(1);
            expect(result.directives[0].type).toBe('done-by');
            expect(result.directives[0].raw_path).toBe('parent.do');
        });

        test('parses @lsp-done-by with colon and without quotes', () => {
            const content = '// @lsp-done-by: parent.do\ngen x = 1';
            const result = parser.parse(content, 'file:///test.do');
            expect(result.directives.length).toBe(1);
            expect(result.directives[0].type).toBe('done-by');
            expect(result.directives[0].raw_path).toBe('parent.do');
        });

        test('parses @lsp-done-by without colon and with quotes', () => {
            const content = '// @lsp-done-by "parent.do"\ngen x = 1';
            const result = parser.parse(content, 'file:///test.do');
            expect(result.directives.length).toBe(1);
            expect(result.directives[0].type).toBe('done-by');
            expect(result.directives[0].raw_path).toBe('parent.do');
        });

        test('parses @lsp-done-by with colon and with quotes', () => {
            const content = '// @lsp-done-by: "parent.do"\ngen x = 1';
            const result = parser.parse(content, 'file:///test.do');
            expect(result.directives.length).toBe(1);
            expect(result.directives[0].type).toBe('done-by');
            expect(result.directives[0].raw_path).toBe('parent.do');
        });

        test('parses @lsp-included-by without colon and without quotes', () => {
            const content = '// @lsp-included-by utils.do\ngen x = 1';
            const result = parser.parse(content, 'file:///test.do');
            expect(result.directives.length).toBe(1);
            expect(result.directives[0].type).toBe('included-by');
            expect(result.directives[0].raw_path).toBe('utils.do');
        });

        test('parses @lsp-included-by with colon and without quotes', () => {
            const content = '// @lsp-included-by: utils.do\ngen x = 1';
            const result = parser.parse(content, 'file:///test.do');
            expect(result.directives.length).toBe(1);
            expect(result.directives[0].type).toBe('included-by');
            expect(result.directives[0].raw_path).toBe('utils.do');
        });

        test('parses @lsp-included-by without colon and with quotes', () => {
            const content = '// @lsp-included-by "utils.do"\ngen x = 1';
            const result = parser.parse(content, 'file:///test.do');
            expect(result.directives.length).toBe(1);
            expect(result.directives[0].type).toBe('included-by');
            expect(result.directives[0].raw_path).toBe('utils.do');
        });

        test('parses @lsp-included-by with colon and with quotes', () => {
            const content = '// @lsp-included-by: "utils.do"\ngen x = 1';
            const result = parser.parse(content, 'file:///test.do');
            expect(result.directives.length).toBe(1);
            expect(result.directives[0].type).toBe('included-by');
            expect(result.directives[0].raw_path).toBe('utils.do');
        });

        test('parses directives with * comment style', () => {
            const content = '* @lsp-done-by: parent.do\ngen x = 1';
            const result = parser.parse(content, 'file:///test.do');
            expect(result.directives.length).toBe(1);
            expect(result.directives[0].type).toBe('done-by');
        });

        test('parses directives with // comment style', () => {
            const content = '// @lsp-done-by: parent.do\ngen x = 1';
            const result = parser.parse(content, 'file:///test.do');
            expect(result.directives.length).toBe(1);
            expect(result.directives[0].type).toBe('done-by');
        });

        test('parses canonical sight prefix in Stata comments', () => {
            const content = `// sight: done-by: "parent.do"
* sight: included-by utils.do
gen x = 1`;
            const result = parser.parse(content, 'file:///test.do');

            expect(result.directives.length).toBe(2);
            expect(result.directives[0].type).toBe('done-by');
            expect(result.directives[0].raw_path).toBe('parent.do');
            expect(result.directives[1].type).toBe('included-by');
            expect(result.directives[1].raw_path).toBe('utils.do');
        });

        test('does not parse bare sight prefix as a Stata comment', () => {
            const content = 'sight: done-by "parent.do"\ngen x = 1';
            const result = parser.parse(content, 'file:///test.do');

            expect(result.directives.length).toBe(0);
        });

        test('does not parse # sight as a directive prefix', () => {
            const content = '// # sight: done-by "parent.do"\ngen x = 1';
            const result = parser.parse(content, 'file:///test.do');

            expect(result.directives.length).toBe(0);
        });

        test('does not parse directives embedded in prose comments', () => {
            const content = `// note sight: done-by: "parent.do"
* note @lsp-included-by: "utils.do"
gen x = 1`;
            const result = parser.parse(content, 'file:///test.do');

            expect(result.directives.length).toBe(0);
        });

        test('does not parse directives from block comments', () => {
            const content = '/* sight: done-by: "parent.do" */\ngen x = 1';
            const result = parser.parse(content, 'file:///test.do');

            expect(result.directives.length).toBe(0);
        });

        test('does not flag a non-directive word starting with a backward keyword', () => {
            // `done-bytes` begins with `done-by` but is not a directive.
            const content = '// sight: done-bytes are not a directive\ngen x = 1';
            const result = parser.parse(content, 'file:///test.do');

            expect(result.directives.length).toBe(0);
            expect(result.diagnostics.some(d => d.message.includes('Malformed'))).toBe(false);
        });

        test('does not honor // or * directives nested in multi-line block comments', () => {
            // A `//` or `*` line inside a /* ... */ block is block-commented out,
            // so the directive must stay inert across all scanners.
            const slash = '/*\n// sight: include: "setup.do"\n// sight: local fake\n*/\ngen x = 1';
            const star = '/*\n * sight: do: "setup.do"\n * sight: local fake\n */\ngen x = 1';

            const r_slash = parser.parse_forward_call_directives(slash, 'file:///t.do');
            const r_slash_decl = parser.parse_declaration_directives(slash, 'file:///t.do');
            const r_star = parser.parse_forward_call_directives(star, 'file:///t.do');
            const r_star_decl = parser.parse_declaration_directives(star, 'file:///t.do');

            expect(r_slash.forward_calls.length).toBe(0);
            expect(r_slash_decl.declarations.length).toBe(0);
            expect(r_star.forward_calls.length).toBe(0);
            expect(r_star_decl.declarations.length).toBe(0);
        });

        test('does not honor directives inside a line-spanning comment (* /* ... */)', () => {
            // A line-leading `*` followed by a block opener makes the lexer span
            // a single line comment across the lines; directives on the interior
            // lines are inert, consistent with the analyzer.
            const spanning = [
                '* /*',
                '// sight: done-by: "parent.do"',
                '// sight: include: "setup.do"',
                '// sight: local fake',
                '*/',
                'gen x = 1',
            ].join('\n');

            expect(parser.parse(spanning, 'file:///t.do').directives.length).toBe(0);
            expect(parser.parse_forward_call_directives(spanning, 'file:///t.do').forward_calls.length).toBe(0);
            expect(parser.parse_declaration_directives(spanning, 'file:///t.do').declarations.length).toBe(0);
        });

        test('does not honor a directive on the opening line of a line-spanning comment', () => {
            // `* sight: local fake /*` opens a comment span; the directive-looking
            // opening line is part of the comment and must be inert.
            const span_opener = [
                '* sight: local fake /*',
                '// sight: local inner',
                '*/',
                "display `fake'",
            ].join('\n');
            expect(parser.parse_declaration_directives(span_opener, 'file:///t.do').declarations.length).toBe(0);
        });

        test('ignore-next skips a block comment to reach the next directive', () => {
            const content = [
                '// sight: ignore-next',
                '/*',
                'note',
                '*/',
                '// sight: do: "child.do"',
            ].join('\n');
            // The block comment is trivia; ignore-next targets the do directive,
            // so no forward call is registered.
            expect(parser.parse_forward_call_directives(content, 'file:///t.do').forward_calls.length).toBe(0);
        });

        test('ignore-next skips a single-line block comment to reach the next directive', () => {
            const content = [
                '// sight: ignore-next',
                '/* block */',
                '// sight: do: "child.do"',
            ].join('\n');
            expect(parser.parse_forward_call_directives(content, 'file:///t.do').forward_calls.length).toBe(0);
        });

        test('a single-line block comment does not stop header directive parsing', () => {
            const content = [
                '/* header */',
                '// sight: done-by: "parent.do"',
                'gen x = 1',
            ].join('\n');
            const result = parser.parse(content, 'file:///t.do');
            expect(result.directives.length).toBe(1);
            expect(result.directives[0].type).toBe('done-by');
        });

        test('does not infer a call site from a do statement inside a block comment', () => {
            const blocked = 'clear\n/*\ndo "child.do"\n*/\ngen z = 1';
            const real = 'clear\ndo "child.do"\ngen z = 1';

            expect(parser.infer_call_site_for_file(blocked, 'child.do')).toBeUndefined();
            expect(parser.infer_call_site_for_file(real, 'child.do')).toBe(1);
        });

        test('still infers a call site for a real do with a trailing block comment', () => {
            // Only lines whose leading text is inside a block comment are inert;
            // a real `do` followed by an inline block comment is a real call.
            const trailing = 'clear\ndo "child.do" /* run the child */\ngen z = 1';
            expect(parser.infer_call_site_for_file(trailing, 'child.do')).toBe(1);
        });

        test('parses canonical sight working-directory directives', () => {
            const content = '// sight: wd: "../data"\ngen x = 1';
            const result = parser.parse(content, 'file:///project/scripts/test.do');

            expect(result.working_directory?.path).toBe('../data');
            expect(result.working_directory?.directive_form).toBe('wd');
        });
    });

    describe('.do Extension Fallback', () => {
        const parser = new DirectiveParser();

        test('prefers exact path when it exists', () => {
            const mock_file_exists = (path_to_check: string) => {
                return path_to_check === '/Users/test/parent.do';
            };

            const resolved = parser.resolve_path_with_fallback(
                'parent.do',
                '/Users/test',
                mock_file_exists
            );
            expect(resolved).toBe('/Users/test/parent.do');
        });

        test('falls back to .do extension when exact path does not exist', () => {
            const mock_file_exists = (path_to_check: string) => {
                return path_to_check === '/Users/test/parent.do';
            };

            const resolved = parser.resolve_path_with_fallback(
                'parent',
                '/Users/test',
                mock_file_exists
            );
            expect(resolved).toBe('/Users/test/parent.do');
        });

        test('returns original path when neither exists', () => {
            const mock_file_exists = () => false;

            const resolved = parser.resolve_path_with_fallback(
                'parent',
                '/Users/test',
                mock_file_exists
            );
            expect(resolved).toBe('/Users/test/parent');
        });

        test('does not append .do to paths that already end in .do', () => {
            const mock_file_exists = (path_to_check: string) => {
                return path_to_check === '/Users/test/parent.do';
            };

            const resolved = parser.resolve_path_with_fallback(
                'parent.do',
                '/Users/test',
                mock_file_exists
            );
            expect(resolved).toBe('/Users/test/parent.do');
        });

        test('handles relative paths with .do fallback', () => {
            const mock_file_exists = (path_to_check: string) => {
                return path_to_check === '/Users/test/project/utils.do';
            };

            const resolved = parser.resolve_path_with_fallback(
                '../utils',
                '/Users/test/project/subdir',
                mock_file_exists
            );
            expect(resolved).toBe('/Users/test/project/utils.do');
        });
    });

    describe('Backward Compatibility', () => {
        const parser = new DirectiveParser();

        test('continues to recognize spec form with colon and quotes', () => {
            const content = '// @lsp-done-by: "parent.do"\ngen x = 1';
            const result = parser.parse(content, 'file:///test.do');
            expect(result.directives.length).toBe(1);
            expect(result.directives[0].type).toBe('done-by');
        });

        test('continues to recognize legacy form without colon', () => {
            const content = '// @lsp-done-by parent.do\ngen x = 1';
            const result = parser.parse(content, 'file:///test.do');
            expect(result.directives.length).toBe(1);
            expect(result.directives[0].type).toBe('done-by');
        });

        test('handles mixed syntax styles in same file', () => {
            const content = `// @lsp-done-by parent.do
* @lsp-included-by: "utils.do"
gen x = 1`;
            const result = parser.parse(content, 'file:///test.do');
            expect(result.directives.length).toBe(2);
            expect(result.directives[0].type).toBe('done-by');
            expect(result.directives[1].type).toBe('included-by');
        });
    });

    describe('Forward Call Directives - Malformed Cases', () => {
        const parser = new DirectiveParser();

        test('rejects unquoted line= as path', () => {
            const content = '// @lsp-do line=5\ngen x = 1';
            const result = parser.parse(content, 'file:///test.do');
            expect(result.forward_calls?.length ?? 0).toBe(0);
            expect(result.diagnostics.length).toBe(1);
            expect(result.diagnostics[0].message).toContain('Malformed directive');
        });

        test('rejects unquoted match= as path', () => {
            const content = '// @lsp-run match="foo"\ngen x = 1';
            const result = parser.parse(content, 'file:///test.do');
            expect(result.forward_calls?.length ?? 0).toBe(0);
            expect(result.diagnostics.length).toBe(1);
            expect(result.diagnostics[0].message).toContain('Malformed directive');
        });

        test('rejects LINE= (case insensitive) as path', () => {
            const content = '// @lsp-include LINE=10\ngen x = 1';
            const result = parser.parse(content, 'file:///test.do');
            expect(result.forward_calls?.length ?? 0).toBe(0);
            expect(result.diagnostics.length).toBe(1);
            expect(result.diagnostics[0].message).toContain('Malformed directive');
        });

        test('accepts valid unquoted path', () => {
            const content = '// @lsp-do: callee.do\ngen x = 1';
            const result = parser.parse(content, 'file:///test.do');
            expect(result.forward_calls?.length ?? 0).toBe(1);
            expect(result.forward_calls![0].raw_path).toBe('callee.do');
            expect(result.diagnostics.length).toBe(0);
        });

        test('accepts quoted path with line= parameter', () => {
            const content = '// @lsp-do: "callee.do" line=5\ngen x = 1';
            const result = parser.parse(content, 'file:///test.do');
            expect(result.forward_calls?.length ?? 0).toBe(1);
            expect(result.forward_calls![0].raw_path).toBe('callee.do');
            expect(result.forward_calls![0].call_site_line).toBe(4); // 0-indexed
        });

        test('reports a forward directive head with empty match="" as malformed', () => {
            // Parity with backward directives: a forward-directive head that does
            // not fully parse should warn rather than be silently dropped.
            const content = '// sight: do: "setup.do" match=""\ngen x = 1';
            const result = parser.parse_forward_call_directives(content, 'file:///test.do');

            expect(result.forward_calls?.length ?? 0).toBe(0);
            expect(result.diagnostics.some(d => d.message.includes('Malformed directive'))).toBe(true);
        });

        test('does not flag a non-directive word starting with a keyword', () => {
            const content = '// sight: doctor notes here\ngen x = 1';
            const result = parser.parse_forward_call_directives(content, 'file:///test.do');

            expect(result.forward_calls?.length ?? 0).toBe(0);
            expect(result.diagnostics.length).toBe(0);
        });

        test('reports a forward directive with no space after the colon as malformed', () => {
            const content = '// sight: do:"setup.do"\ngen x = 1';
            const result = parser.parse_forward_call_directives(content, 'file:///test.do');

            expect(result.forward_calls?.length ?? 0).toBe(0);
            expect(result.diagnostics.some(d => d.message.includes('Malformed directive'))).toBe(true);
        });

        test('accepts canonical sight forward directives', () => {
            const content = '// sight: include: "callee.do" line=5\ngen x = 1';
            const result = parser.parse(content, 'file:///test.do');

            expect(result.forward_calls?.length ?? 0).toBe(1);
            expect(result.forward_calls![0].type).toBe('include');
            expect(result.forward_calls![0].raw_path).toBe('callee.do');
            expect(result.forward_calls![0].call_site_line).toBe(4);
        });
    });

    describe('Call-site match= with escaped quotes', () => {
        const parser = new DirectiveParser();

        test('backward directive with escaped quotes in match= is recognized (docs/cross-file.md)', () => {
            // Documented form: match="do \"analysis.do\""
            const content =
                '// sight: done-by: "orchestrator.do" match="do \\"analysis.do\\""\nlocal x 1';
            const result = parser.parse(content, 'file:///child.do');

            expect(result.directives.length).toBe(1);
            expect(result.directives[0].raw_path).toBe('orchestrator.do');
            // The captured value is unescaped so it matches the literal parent text.
            expect(result.directives[0].call_site).toEqual({
                type: 'match',
                value: 'do "analysis.do"',
            });
            expect(result.diagnostics.length).toBe(0);
        });

        test('escaped match= value resolves against parent content', () => {
            const parent = ['clear', 'do "analysis.do"', 'gen z = 1'].join('\n');
            const line = parser.find_match_line(parent, 'do "analysis.do"');
            expect(line).toBe(1);
        });

        test('empty match="" does not resolve to a line-0 match call site', () => {
            // An empty match string matches every line; it must not become an
            // explicit call site (which would silently resolve to line 0).
            const content = '// sight: done-by: "parent.do" match=""\nlocal y 1';
            const result = parser.parse(content, 'file:///child.do');

            expect(result.directives.some(d => d.call_site?.type === 'match')).toBe(false);
        });

        test('forward directive with escaped quotes in match= is recognized', () => {
            // The match= target line exists in this file, so the call site
            // resolves with no diagnostics.
            const content =
                '// sight: do: "callee.do" match="do \\"inner.do\\""\ndo "inner.do"\ngen x = 1';
            const result = parser.parse(content, 'file:///test.do');

            expect(result.forward_calls?.length ?? 0).toBe(1);
            expect(result.forward_calls![0].raw_path).toBe('callee.do');
            expect(result.forward_calls![0].call_site_line).toBe(1);
            expect(result.diagnostics.length).toBe(0);
        });
    });
});


describe('DirectiveParser - Case-Sensitive Call Site Inference', () => {
    const parser = new DirectiveParser();

    test('infer_call_site_for_file should NOT match "Do" (uppercase D)', () => {
        // Stata is case-sensitive: "Do" is not a valid command
        const parent_content = `global setup 1
Do "child.do"
global after 2
`;
        const result = parser.infer_call_site_for_file(parent_content, 'child.do');
        // Should NOT find a match because "Do" is not lowercase "do"
        expect(result).toBeUndefined();
    });

    test('infer_call_site_for_file should match lowercase "do"', () => {
        const parent_content = `global setup 1
do "child.do"
global after 2
`;
        const result = parser.infer_call_site_for_file(parent_content, 'child.do');
        // Should find match at line 1 (0-indexed)
        expect(result).toBe(1);
    });

    test('infer_call_site_for_file should NOT match "Run" (uppercase R)', () => {
        const parent_content = `global setup 1
Run "child.do"
global after 2
`;
        const result = parser.infer_call_site_for_file(parent_content, 'child.do');
        expect(result).toBeUndefined();
    });

    test('infer_call_site_for_file should NOT match "Include" (uppercase I)', () => {
        const parent_content = `global setup 1
Include "child.do"
global after 2
`;
        const result = parser.infer_call_site_for_file(parent_content, 'child.do');
        expect(result).toBeUndefined();
    });

    test('infer_call_site_for_file should NOT match "DO" (all uppercase)', () => {
        const parent_content = `global setup 1
DO "child.do"
global after 2
`;
        const result = parser.infer_call_site_for_file(parent_content, 'child.do');
        expect(result).toBeUndefined();
    });

    test('infer_call_site_for_file should match lowercase with prefix', () => {
        const parent_content = `global setup 1
quietly do "child.do"
global after 2
`;
        const result = parser.infer_call_site_for_file(parent_content, 'child.do');
        expect(result).toBe(1);
    });

    test('infer_call_site_for_file should NOT treat bare timer as a prefix', () => {
        const parent_content = `global setup 1
timer do "child.do"
global after 2
`;
        const result = parser.infer_call_site_for_file(parent_content, 'child.do');
        expect(result).toBeUndefined();
    });

    test('infer_call_site_for_file should still compare filenames case-insensitively', () => {
        // File extension comparison is allowed to be case-insensitive
        const parent_content = `global setup 1
do "CHILD.DO"
global after 2
`;
        const result = parser.infer_call_site_for_file(parent_content, 'child.do');
        // Should find match because filename comparison is case-insensitive
        expect(result).toBe(1);
    });
});
