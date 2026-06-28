import { describe, test, expect } from 'bun:test';
import { DirectiveParser } from '../../src/directive-parser';

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
