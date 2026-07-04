/**
 * Property tests for the `sight: standalone` directive (issue #208).
 *
 * A header-only, no-argument marker. Properties:
 * 1. Both prefixes (`sight:` / `@lsp-`), both comment styles (`//` / `*`),
 *    and the optional trailing colon all parse equivalently.
 * 2. Header-only constraint: the marker is inert after the first
 *    non-blank, non-comment line.
 * 3. Combining with backward directives never filters the raw directive
 *    list and never emits a parser-level diagnostic (the ignored-directive
 *    warning is resolver-root-emitted).
 */

import { describe, test, expect } from 'bun:test';
import * as fc from 'fast-check';
import { DirectiveParser } from '../../src/directive-parser';

describe('Standalone Directive Property Tests', () => {
    const parser = new DirectiveParser();

    const prefix_gen = fc.constantFrom('sight: ', '@lsp-');
    const comment_gen = fc.constantFrom('//', '*');
    const colon_gen = fc.constantFrom('', ':');
    const spaces_gen = fc.stringOf(fc.constant(' '), {
        minLength: 0, maxLength: 3,
    });

    const path_gen = fc.stringOf(
        fc.constantFrom(
            ...'abcdefghijklmnopqrstuvwxyz0123456789_-./'.split('')
        ),
        { minLength: 1, maxLength: 20 }
    ).filter(s => !s.includes('"') && !s.includes(' '));

    describe('Property 1: All spelling forms parse equivalently', () => {
        test('prefix x comment style x colon x whitespace all set standalone', () => {
            fc.assert(
                fc.property(
                    prefix_gen, comment_gen, colon_gen, spaces_gen,
                    (my_prefix, my_comment, my_colon, my_spaces) => {
                        const my_line =
                            `${my_comment} ${my_prefix}standalone` +
                            `${my_colon}${my_spaces}`;
                        const result = parser.parse(
                            `${my_line}\ngen x = 1`,
                            'file:///test/script.do'
                        );
                        expect(result.standalone).toBeDefined();
                        expect(result.standalone!.directive_form)
                            .toBe('standalone');
                        expect(result.standalone!.range.start.line).toBe(0);
                        expect(result.diagnostics.length).toBe(0);
                    }
                ),
                { numRuns: 100 }
            );
        });
    });

    describe('Property 2: Header-only constraint', () => {
        test('the marker after a code line is inert', () => {
            fc.assert(
                fc.property(
                    prefix_gen, comment_gen,
                    fc.integer({ min: 0, max: 5 }),
                    (my_prefix, my_comment, my_leading_comments) => {
                        const the_lines: string[] = [];
                        for (let i = 0; i < my_leading_comments; i++) {
                            the_lines.push('// a header comment');
                        }
                        the_lines.push('gen x = 1');
                        the_lines.push(
                            `${my_comment} ${my_prefix}standalone`
                        );
                        const result = parser.parse(
                            the_lines.join('\n'),
                            'file:///test/script.do'
                        );
                        expect(result.standalone).toBeUndefined();
                    }
                ),
                { numRuns: 100 }
            );
        });

        test('the marker below blank/comment header lines is recognized', () => {
            fc.assert(
                fc.property(
                    prefix_gen,
                    fc.integer({ min: 0, max: 5 }),
                    (my_prefix, my_header_lines) => {
                        const the_lines: string[] = [];
                        for (let i = 0; i < my_header_lines; i++) {
                            the_lines.push(i % 2 === 0
                                ? '// a header comment'
                                : '');
                        }
                        the_lines.push(`// ${my_prefix}standalone`);
                        the_lines.push('gen x = 1');
                        const result = parser.parse(
                            the_lines.join('\n'),
                            'file:///test/script.do'
                        );
                        expect(result.standalone).toBeDefined();
                        expect(result.standalone!.range.start.line)
                            .toBe(my_header_lines);
                    }
                ),
                { numRuns: 100 }
            );
        });
    });

    describe('Property 3: Coexistence with backward directives', () => {
        test('raw directives stay unfiltered; no parser-level diagnostic', () => {
            fc.assert(
                fc.property(
                    prefix_gen,
                    fc.constantFrom('done-by', 'run-by', 'included-by'),
                    path_gen,
                    fc.boolean(),
                    (my_prefix, my_backward_type, my_path,
                     standalone_first) => {
                        const my_standalone_line =
                            `// ${my_prefix}standalone`;
                        const my_backward_line =
                            `// ${my_prefix}${my_backward_type}: ` +
                            `"${my_path}"`;
                        const the_header = standalone_first
                            ? [my_standalone_line, my_backward_line]
                            : [my_backward_line, my_standalone_line];
                        const result = parser.parse(
                            [...the_header, 'gen x = 1'].join('\n'),
                            'file:///test/script.do'
                        );
                        expect(result.standalone).toBeDefined();
                        expect(result.directives.length).toBe(1);
                        expect(result.diagnostics.length).toBe(0);
                    }
                ),
                { numRuns: 100 }
            );
        });
    });
});
