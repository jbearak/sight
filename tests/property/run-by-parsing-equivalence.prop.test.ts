/**
 * Property tests for @lsp-run-by parsing equivalence
 *
 * Tests Property 6 from the working-directory-inheritance design document:
 * For any valid @lsp-done-by directive (quoted path, unquoted path, with call-site parameters),
 * the equivalent @lsp-run-by directive SHALL produce an identical Directive object (with type: 'done-by').
 *
 * **Feature: working-directory-inheritance, Property 6: @lsp-run-by Parsing Equivalence**
 * **Validates: Requirements 2.1, 2.2, 2.4**
 */

import { describe, test, expect } from 'bun:test';
import * as fc from 'fast-check';
import { DirectiveParser } from '../../src/directive-parser';

describe('Property 6: @lsp-run-by Parsing Equivalence', () => {
    const parser = new DirectiveParser();

    test('@lsp-run-by produces identical Directive as @lsp-done-by for quoted paths', () => {
        fc.assert(
            fc.property(
                fc.stringOf(
                    fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz0123456789_-./'.split('')),
                    { minLength: 1, maxLength: 30 }
                ).filter(s => !s.includes('"') && s.length > 0 && !s.includes(' ')),
                fc.constantFrom('*', '//'),
                (path, comment_style) => {
                    const done_by_content = `${comment_style} @lsp-done-by: "${path}"\ngen x = 1`;
                    const run_by_content = `${comment_style} @lsp-run-by: "${path}"\ngen x = 1`;

                    const done_by_result = parser.parse(done_by_content, 'file:///test.do');
                    const run_by_result = parser.parse(run_by_content, 'file:///test.do');

                    // Both should produce exactly one directive
                    expect(done_by_result.directives.length).toBe(1);
                    expect(run_by_result.directives.length).toBe(1);

                    // Both should have type 'done-by' (run-by maps to done-by)
                    expect(done_by_result.directives[0].type).toBe('done-by');
                    expect(run_by_result.directives[0].type).toBe('done-by');

                    // Both should have identical raw_path
                    expect(run_by_result.directives[0].raw_path).toBe(done_by_result.directives[0].raw_path);

                    // Both should have identical resolved path
                    expect(run_by_result.directives[0].path).toBe(done_by_result.directives[0].path);
                }
            ),
            { numRuns: 100 }
        );
    });

    test('@lsp-run-by produces identical Directive as @lsp-done-by for unquoted paths', () => {
        fc.assert(
            fc.property(
                fc.stringOf(
                    fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz0123456789_-.'.split('')),
                    { minLength: 3, maxLength: 20 }
                ).filter(s => !s.includes('"') && s.length > 0 && !s.includes(' ') && s.includes('.')),
                fc.constantFrom('*', '//'),
                (path, comment_style) => {
                    const done_by_content = `${comment_style} @lsp-done-by ${path}\ngen x = 1`;
                    const run_by_content = `${comment_style} @lsp-run-by ${path}\ngen x = 1`;

                    const done_by_result = parser.parse(done_by_content, 'file:///test.do');
                    const run_by_result = parser.parse(run_by_content, 'file:///test.do');

                    // Both should produce exactly one directive
                    expect(done_by_result.directives.length).toBe(1);
                    expect(run_by_result.directives.length).toBe(1);

                    // Both should have type 'done-by'
                    expect(done_by_result.directives[0].type).toBe('done-by');
                    expect(run_by_result.directives[0].type).toBe('done-by');

                    // Both should have identical raw_path
                    expect(run_by_result.directives[0].raw_path).toBe(done_by_result.directives[0].raw_path);
                }
            ),
            { numRuns: 100 }
        );
    });

    test('@lsp-run-by produces identical Directive as @lsp-done-by with line= parameter', () => {
        fc.assert(
            fc.property(
                fc.constant('../parent.do'),
                fc.integer({ min: 1, max: 1000 }),
                fc.constantFrom('*', '//'),
                (path, line_value, comment_style) => {
                    const done_by_content = `${comment_style} @lsp-done-by: "${path}" line=${line_value}\ngen x = 1`;
                    const run_by_content = `${comment_style} @lsp-run-by: "${path}" line=${line_value}\ngen x = 1`;

                    const done_by_result = parser.parse(done_by_content, 'file:///test.do');
                    const run_by_result = parser.parse(run_by_content, 'file:///test.do');

                    // Both should produce exactly one directive
                    expect(done_by_result.directives.length).toBe(1);
                    expect(run_by_result.directives.length).toBe(1);

                    // Both should have type 'done-by'
                    expect(run_by_result.directives[0].type).toBe('done-by');

                    // Both should have identical call_site
                    expect(run_by_result.directives[0].call_site?.type).toBe('line');
                    expect(run_by_result.directives[0].call_site?.value).toBe(line_value);
                    expect(run_by_result.directives[0].call_site?.type).toBe(done_by_result.directives[0].call_site?.type);
                    expect(run_by_result.directives[0].call_site?.value).toBe(done_by_result.directives[0].call_site?.value);
                }
            ),
            { numRuns: 100 }
        );
    });

    test('@lsp-run-by produces identical Directive as @lsp-done-by with match= parameter', () => {
        fc.assert(
            fc.property(
                fc.constant('../parent.do'),
                fc.stringOf(
                    fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz '.split('')),
                    { minLength: 1, maxLength: 20 }
                ).filter(s => !s.includes('"')),
                fc.constantFrom('*', '//'),
                (path, match_value, comment_style) => {
                    const done_by_content = `${comment_style} @lsp-done-by: "${path}" match="${match_value}"\ngen x = 1`;
                    const run_by_content = `${comment_style} @lsp-run-by: "${path}" match="${match_value}"\ngen x = 1`;

                    const done_by_result = parser.parse(done_by_content, 'file:///test.do');
                    const run_by_result = parser.parse(run_by_content, 'file:///test.do');

                    // Both should produce exactly one directive
                    expect(done_by_result.directives.length).toBe(1);
                    expect(run_by_result.directives.length).toBe(1);

                    // Both should have type 'done-by'
                    expect(run_by_result.directives[0].type).toBe('done-by');

                    // Both should have identical call_site
                    expect(run_by_result.directives[0].call_site?.type).toBe('match');
                    expect(run_by_result.directives[0].call_site?.value).toBe(match_value);
                    expect(run_by_result.directives[0].call_site?.type).toBe(done_by_result.directives[0].call_site?.type);
                    expect(run_by_result.directives[0].call_site?.value).toBe(done_by_result.directives[0].call_site?.value);
                }
            ),
            { numRuns: 100 }
        );
    });

    test('all syntax forms for @lsp-run-by produce identical results', () => {
        fc.assert(
            fc.property(
                fc.stringOf(
                    fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz0123456789_-.'.split('')),
                    { minLength: 3, maxLength: 20 }
                ).filter(s => !s.includes('"') && s.length > 0 && !s.includes(' ') && s.includes('.')),
                (path) => {
                    const the_forms = [
                        `// @lsp-run-by ${path}`,
                        `// @lsp-run-by: ${path}`,
                        `// @lsp-run-by "${path}"`,
                        `// @lsp-run-by: "${path}"`,
                    ];

                    const the_results = the_forms.map(form => {
                        const content = form + '\ngen x = 1';
                        return parser.parse(content, 'file:///test.do');
                    });

                    // All forms should produce exactly one directive
                    the_results.forEach(result => {
                        expect(result.directives.length).toBe(1);
                    });

                    // All forms should have type 'done-by' (run-by maps to done-by)
                    the_results.forEach(result => {
                        expect(result.directives[0].type).toBe('done-by');
                    });

                    // All forms should have the same raw_path
                    const the_first_directive = the_results[0].directives[0];
                    the_results.forEach(result => {
                        expect(result.directives[0].raw_path).toBe(the_first_directive.raw_path);
                    });
                }
            ),
            { numRuns: 100 }
        );
    });

    test('malformed @lsp-run-by emits diagnostic', () => {
        // A directive where the "path" looks like a parameter is malformed
        const content = '// @lsp-run-by line=5\ngen x = 1';
        const result = parser.parse(content, 'file:///test.do');

        expect(result.directives.length).toBe(0);
        expect(result.diagnostics.length).toBe(1);
        expect(result.diagnostics[0].severity).toBe('warning');
        expect(result.diagnostics[0].message).toContain('sight: run-by');
    });
});
