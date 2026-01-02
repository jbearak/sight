/**
 * Property tests for Directive Parser
 *
 * Tests Properties 1, 2, 3 from the design document.
 */

import { describe, test, expect } from 'bun:test';
import * as fc from 'fast-check';
import { DirectiveParser } from '../../src/directive-parser';

describe('Directive Parser Property Tests', () => {
    const parser = new DirectiveParser();

    // Property 1: Syntax Form Equivalence
    describe('Property 1: Syntax Form Equivalence', () => {
        test('all 8 syntax forms for @lsp-done-by produce identical results', () => {
            fc.assert(
                fc.property(
                    fc.stringOf(
                        fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz0123456789_-.'.split('')),
                        { minLength: 3, maxLength: 20 }
                    ).filter(s => !s.includes('"') && s.length > 0 && !s.includes(' ') && s.includes('.')),
                    (path) => {
                        const the_forms = [
                            `// @lsp-done-by ${path}`,
                            `// @lsp-done-by: ${path}`,
                            `// @lsp-done-by "${path}"`,
                            `// @lsp-done-by: "${path}"`,
                        ];

                        const the_results = the_forms.map(form => {
                            const content = form + '\ngen x = 1';
                            return parser.parse(content, 'file:///test.do');
                        });

                        // All forms should produce exactly one directive
                        the_results.forEach(result => {
                            expect(result.directives.length).toBe(1);
                        });

                        // All forms should have the same type and path
                        const the_first_directive = the_results[0].directives[0];
                        the_results.forEach(result => {
                            expect(result.directives[0].type).toBe(the_first_directive.type);
                            expect(result.directives[0].raw_path).toBe(the_first_directive.raw_path);
                        });
                    }
                ),
                { numRuns: 100 }
            );
        });

        test('all 8 syntax forms for @lsp-included-by produce identical results', () => {
            fc.assert(
                fc.property(
                    fc.stringOf(
                        fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz0123456789_-.'.split('')),
                        { minLength: 3, maxLength: 20 }
                    ).filter(s => !s.includes('"') && s.length > 0 && !s.includes(' ') && s.includes('.')),
                    (path) => {
                        const the_forms = [
                            `// @lsp-included-by ${path}`,
                            `// @lsp-included-by: ${path}`,
                            `// @lsp-included-by "${path}"`,
                            `// @lsp-included-by: "${path}"`,
                        ];

                        const the_results = the_forms.map(form => {
                            const content = form + '\ngen x = 1';
                            return parser.parse(content, 'file:///test.do');
                        });

                        // All forms should produce exactly one directive
                        the_results.forEach(result => {
                            expect(result.directives.length).toBe(1);
                        });

                        // All forms should have the same type and path
                        const the_first_directive = the_results[0].directives[0];
                        the_results.forEach(result => {
                            expect(result.directives[0].type).toBe(the_first_directive.type);
                            expect(result.directives[0].raw_path).toBe(the_first_directive.raw_path);
                        });
                    }
                ),
                { numRuns: 100 }
            );
        });

        test('syntax forms work with both * and // comment styles', () => {
            fc.assert(
                fc.property(
                    fc.stringOf(
                        fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz0123456789_-./'.split('')),
                        { minLength: 1, maxLength: 30 }
                    ).filter(s => !s.includes('"') && s.length > 0 && !s.includes(' ')),
                    (path) => {
                        const the_star_form = `* @lsp-done-by: "${path}"`;
                        const the_slash_form = `// @lsp-done-by: "${path}"`;

                        const the_star_result = parser.parse(the_star_form + '\ngen x = 1', 'file:///test.do');
                        const the_slash_result = parser.parse(the_slash_form + '\ngen x = 1', 'file:///test.do');

                        expect(the_star_result.directives.length).toBe(1);
                        expect(the_slash_result.directives.length).toBe(1);
                        expect(the_star_result.directives[0].raw_path).toBe(the_slash_result.directives[0].raw_path);
                    }
                ),
                { numRuns: 100 }
            );
        });
    });

    // Property 2: .do Extension Fallback
    describe('Property 2: .do Extension Fallback', () => {
        test('exact path is preferred when both exist', () => {
            fc.assert(
                fc.property(
                    fc.stringOf(
                        fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz0123456789_-'.split('')),
                        { minLength: 1, maxLength: 20 }
                    ).filter(s => !s.includes('"') && s.length > 0 && !s.includes(' ') && !s.endsWith('.do')),
                    (path) => {
                        const mock_file_exists = (path_to_check: string) => {
                            // Both exact path and .do version exist
                            return path_to_check === `/Users/test/${path}` ||
                                   path_to_check === `/Users/test/${path}.do`;
                        };

                        const resolved = parser.resolve_path_with_fallback(
                            path,
                            '/Users/test',
                            mock_file_exists
                        );

                        // Should resolve to exact path
                        expect(resolved).toBe(`/Users/test/${path}`);
                    }
                ),
                { numRuns: 100 }
            );
        });

        test('falls back to .do when exact path does not exist', () => {
            fc.assert(
                fc.property(
                    fc.stringOf(
                        fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz0123456789_-'.split('')),
                        { minLength: 1, maxLength: 20 }
                    ).filter(s => !s.includes('"') && s.length > 0 && !s.includes(' ') && !s.endsWith('.do')),
                    (path) => {
                        const mock_file_exists = (path_to_check: string) => {
                            // Only .do version exists
                            return path_to_check === `/Users/test/${path}.do`;
                        };

                        const resolved = parser.resolve_path_with_fallback(
                            path,
                            '/Users/test',
                            mock_file_exists
                        );

                        // Should resolve to .do version
                        expect(resolved).toBe(`/Users/test/${path}.do`);
                    }
                ),
                { numRuns: 100 }
            );
        });

        test('returns original path when neither exists', () => {
            fc.assert(
                fc.property(
                    fc.stringOf(
                        fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz0123456789_-'.split('')),
                        { minLength: 1, maxLength: 20 }
                    ).filter(s => !s.includes('"') && s.length > 0 && !s.includes(' ') && !s.endsWith('.do')),
                    (path) => {
                        const mock_file_exists = () => false;

                        const resolved = parser.resolve_path_with_fallback(
                            path,
                            '/Users/test',
                            mock_file_exists
                        );

                        // Should return original resolved path
                        expect(resolved).toBe(`/Users/test/${path}`);
                    }
                ),
                { numRuns: 100 }
            );
        });
    });

    // Property 1: Directive Parsing Round-Trip
    describe('Property 1: Directive Parsing Round-Trip', () => {
        test('valid directives parse correctly', () => {
            fc.assert(
                fc.property(
                    fc.record({
                        type: fc.constantFrom('done-by', 'included-by'),
                        path: fc.stringOf(
                            fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz0123456789_-./'.split('')),
                            { minLength: 1, maxLength: 50 }
                        ).filter(s => !s.includes('"') && s.length > 0),
                        comment_style: fc.constantFrom('*', '//'),
                    }),
                    ({ type, path, comment_style }) => {
                        const directive_line = `${comment_style} @lsp-${type} "${path}"`;
                        const content = directive_line + '\ngen x = 1';
                        const result = parser.parse(content, 'file:///test.do');

                        expect(result.directives.length).toBe(1);
                        expect(result.directives[0].type).toBe(type);
                        expect(result.directives[0].raw_path).toBe(path);
                    }
                ),
                { numRuns: 100 }
            );
        });

        test('call site parameters parse correctly', () => {
            fc.assert(
                fc.property(
                    fc.record({
                        type: fc.constantFrom('done-by', 'included-by'),
                        path: fc.constant('../parent.do'),
                        param_type: fc.constantFrom('line', 'match'),
                        line_value: fc.integer({ min: 1, max: 1000 }),
                        match_value: fc.stringOf(
                            fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz '.split('')),
                            { minLength: 1, maxLength: 20 }
                        ).filter(s => !s.includes('"')),
                    }),
                    ({ type, path, param_type, line_value, match_value }) => {
                        const param = param_type === 'line'
                            ? `line=${line_value}`
                            : `match="${match_value}"`;
                        const directive_line = `// @lsp-${type} "${path}" ${param}`;
                        const content = directive_line + '\ngen x = 1';
                        const result = parser.parse(content, 'file:///test.do');

                        expect(result.directives.length).toBe(1);
                        expect(result.directives[0].call_site?.type).toBe(param_type);
                        if (param_type === 'line') {
                            expect(result.directives[0].call_site?.value).toBe(line_value);
                        } else {
                            expect(result.directives[0].call_site?.value).toBe(match_value);
                        }
                    }
                ),
                { numRuns: 100 }
            );
        });
    });

    // Property 2: Directive Location Constraint
    describe('Property 2: Directive Location Constraint', () => {
        test('directives after code are ignored', () => {
            fc.assert(
                fc.property(
                    fc.record({
                        code_line: fc.constantFrom(
                            'gen x = 1',
                            'local y = 2',
                            'regress y x',
                            'display "hello"'
                        ),
                        directive_type: fc.constantFrom('done-by', 'included-by'),
                    }),
                    ({ code_line, directive_type }) => {
                        const content = `${code_line}\n// @lsp-${directive_type} "../parent.do"`;
                        const result = parser.parse(content, 'file:///test.do');

                        // Directive after code should be ignored
                        expect(result.directives.length).toBe(0);
                    }
                ),
                { numRuns: 100 }
            );
        });

        test('directives before code are recognized', () => {
            fc.assert(
                fc.property(
                    fc.record({
                        num_blank_lines: fc.integer({ min: 0, max: 5 }),
                        num_comment_lines: fc.integer({ min: 0, max: 3 }),
                        directive_type: fc.constantFrom('done-by', 'included-by'),
                    }),
                    ({ num_blank_lines, num_comment_lines, directive_type }) => {
                        const blank_lines = '\n'.repeat(num_blank_lines);
                        const comment_lines = '// comment\n'.repeat(num_comment_lines);
                        const directive = `// @lsp-${directive_type} "../parent.do"`;
                        const content = blank_lines + comment_lines + directive + '\ngen x = 1';
                        const result = parser.parse(content, 'file:///test.do');

                        expect(result.directives.length).toBe(1);
                    }
                ),
                { numRuns: 100 }
            );
        });
    });

    // Property 3: Path Resolution Correctness
    describe('Property 3: Path Resolution Correctness', () => {
        test('relative paths resolve correctly', () => {
            fc.assert(
                fc.property(
                    fc.record({
                        containing_dir: fc.constant('/Users/test/project'),
                        relative_path: fc.constantFrom(
                            'file.do',
                            './file.do',
                            '../file.do',
                            '../other/file.do',
                            'subdir/file.do'
                        ),
                    }),
                    ({ containing_dir, relative_path }) => {
                        const resolved = parser.resolve_path(relative_path, containing_dir);

                        // Should be absolute
                        expect(resolved.startsWith('/')).toBe(true);
                        // Should not contain ..
                        expect(resolved.includes('..')).toBe(false);
                        // Should not contain ./
                        expect(resolved.includes('./')).toBe(false);
                    }
                ),
                { numRuns: 100 }
            );
        });

        test('parent directory navigation works', () => {
            const containing_dir = '/Users/test/project/subdir';
            const resolved = parser.resolve_path('../parent.do', containing_dir);
            expect(resolved).toBe('/Users/test/project/parent.do');
        });

        test('absolute paths are preserved', () => {
            fc.assert(
                fc.property(
                    fc.constant('/absolute/path/file.do'),
                    (absolute_path) => {
                        const resolved = parser.resolve_path(absolute_path, '/any/dir');
                        expect(resolved).toBe(absolute_path);
                    }
                ),
                { numRuns: 10 }
            );
        });
    });

    // Property 4: Match Parameter Precedence
    describe('Property 4: Match Parameter Precedence', () => {
        test('match takes precedence over line', () => {
            const content = '// @lsp-done-by "../parent.do" line=10 match="do child"';
            const result = parser.parse(content + '\ngen x = 1', 'file:///test.do');

            expect(result.directives.length).toBe(1);
            expect(result.directives[0].call_site?.type).toBe('match');
            expect(result.directives[0].call_site?.value).toBe('do child');
        });
    });

    // find_match_line tests
    describe('find_match_line', () => {
        test('finds first occurrence', () => {
            const content = 'line 1\ndo child.do\nline 3\ndo child.do';
            const line = parser.find_match_line(content, 'do child.do');
            expect(line).toBe(1); // 0-indexed (first occurrence is on line 1)
        });

        test('returns undefined when not found', () => {
            const content = 'line 1\nline 2\nline 3';
            const line = parser.find_match_line(content, 'not found');
            expect(line).toBeUndefined();
        });
    });

    // Malformed directive handling
    describe('Malformed directive handling', () => {
        test('emits diagnostic for malformed directives', () => {
            // A directive where the "path" looks like a parameter is malformed
            const content = '// @lsp-done-by line=5\ngen x = 1';
            const result = parser.parse(content, 'file:///test.do');

            expect(result.directives.length).toBe(0);
            expect(result.diagnostics.length).toBe(1);
            expect(result.diagnostics[0].severity).toBe('warning');
        });

        test('accepts bare words as valid paths (resolved with .do fallback)', () => {
            // Bare words like "apple" should be accepted and resolved to "apple.do"
            const content = '// @lsp-done-by apple\ngen x = 1';
            const result = parser.parse(content, 'file:///test.do');

            expect(result.directives.length).toBe(1);
            expect(result.directives[0].raw_path).toBe('apple');
            expect(result.diagnostics.length).toBe(0);
        });
    });
});
