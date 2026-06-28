/**
 * Property tests for Declaration Directive Parsing
 *
 * Feature: lsp-declare-symbols
 * Tests Properties 1, 2, 3, 4 from the design document.
 */

import { describe, test, expect } from 'bun:test';
import * as fc from 'fast-check';
import { DirectiveParser } from '../../src/directive-parser';
import { DeclarationDirectiveType } from '../../src/types';

describe('Declaration Directive Property Tests', () => {
    const parser = new DirectiveParser();

    // Generator for valid Stata identifiers
    const stata_identifier = fc.stringOf(
        fc.constantFrom(...'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_'.split('')),
        { minLength: 1, maxLength: 32 }
    ).filter(s => /^[a-zA-Z_]/.test(s)); // Must start with letter or underscore

    // Generator for declaration directive types
    const directive_type = fc.constantFrom('local', 'global', 'scalar', 'matrix', 'program') as fc.Arbitrary<DeclarationDirectiveType>;

    // Generator for comment styles
    const comment_style = fc.constantFrom('*', '//');

    /**
     * Property 1: Directive Parsing Correctness
     *
     * For any valid directive type (local, global, scalar, matrix, program) and any valid
     * Stata identifier, when the directive @lsp-{type} {name} appears in a comment line,
     * the parser SHALL produce a DeclarationDirective with the correct type and extracted name.
     *
     * **Validates: Requirements 1.1, 1.2, 1.3, 1.4, 1.5, 1.7**
     */
    describe('Property 1: Directive Parsing Correctness', () => {
        test('valid declaration directives parse correctly', () => {
            fc.assert(
                fc.property(
                    fc.record({
                        type: directive_type,
                        name: stata_identifier,
                        comment_style: comment_style,
                        line_position: fc.integer({ min: 0, max: 10 }),
                    }),
                    ({ type, name, comment_style, line_position }) => {
                        // Build content with directive at specified line position
                        const the_prefix_lines = Array(line_position).fill('gen x = 1').join('\n');
                        const directive_line = `${comment_style} @lsp-${type} ${name}`;
                        const content = the_prefix_lines + (line_position > 0 ? '\n' : '') + directive_line + '\ngen y = 2';

                        const result = parser.parse(content, 'file:///test.do');

                        // Should find exactly one declaration directive
                        expect(result.declaration_directives.length).toBe(1);
                        expect(result.declaration_directives[0].type).toBe(type);
                        expect(result.declaration_directives[0].name).toBe(name);
                        expect(result.diagnostics.filter(d =>
                            d.message.includes('Declaration directive')
                        ).length).toBe(0);
                    }
                ),
                { numRuns: 100 }
            );
        });

        test('all five directive types are recognized', () => {
            const the_types: DeclarationDirectiveType[] = ['local', 'global', 'scalar', 'matrix', 'program'];

            for (const my_type of the_types) {
                const content = `// @lsp-${my_type} myvar\ngen x = 1`;
                const result = parser.parse(content, 'file:///test.do');

                expect(result.declaration_directives.length).toBe(1);
                expect(result.declaration_directives[0].type).toBe(my_type);
                expect(result.declaration_directives[0].name).toBe('myvar');
            }
        });
    });

    /**
     * Property 2: Comment Style Invariance
     *
     * For any valid declaration directive content, parsing the directive in a * comment
     * style SHALL produce the same DeclarationDirective as parsing it in a // comment style.
     *
     * **Validates: Requirements 1.6**
     */
    describe('Property 2: Comment Style Invariance', () => {
        test('star and slash comments produce equivalent results', () => {
            fc.assert(
                fc.property(
                    fc.record({
                        type: directive_type,
                        name: stata_identifier,
                    }),
                    ({ type, name }) => {
                        const star_content = `* @lsp-${type} ${name}\ngen x = 1`;
                        const slash_content = `// @lsp-${type} ${name}\ngen x = 1`;

                        const star_result = parser.parse(star_content, 'file:///test.do');
                        const slash_result = parser.parse(slash_content, 'file:///test.do');

                        // Both should produce exactly one declaration
                        expect(star_result.declaration_directives.length).toBe(1);
                        expect(slash_result.declaration_directives.length).toBe(1);

                        // Type and name should match
                        expect(star_result.declaration_directives[0].type).toBe(
                            slash_result.declaration_directives[0].type
                        );
                        expect(star_result.declaration_directives[0].name).toBe(
                            slash_result.declaration_directives[0].name
                        );
                    }
                ),
                { numRuns: 100 }
            );
        });
    });

    /**
     * Property 3: Single Argument Acceptance
     *
     * For any valid Stata identifier with optional trailing whitespace, a declaration
     * directive containing only that identifier SHALL be accepted without producing
     * a diagnostic warning.
     *
     * **Validates: Requirements 2.1, 2.3**
     */
    describe('Property 3: Single Argument Acceptance', () => {
        test('single argument with trailing whitespace is accepted', () => {
            fc.assert(
                fc.property(
                    fc.record({
                        type: directive_type,
                        name: stata_identifier,
                        trailing_spaces: fc.integer({ min: 0, max: 10 }),
                    }),
                    ({ type, name, trailing_spaces }) => {
                        const trailing = ' '.repeat(trailing_spaces);
                        const content = `// @lsp-${type} ${name}${trailing}\ngen x = 1`;

                        const result = parser.parse(content, 'file:///test.do');

                        // Should produce exactly one declaration with no warnings
                        expect(result.declaration_directives.length).toBe(1);
                        expect(result.declaration_directives[0].name).toBe(name);

                        // No declaration-related diagnostics
                        const declaration_diagnostics = result.diagnostics.filter(d =>
                            d.message.includes('Declaration directive')
                        );
                        expect(declaration_diagnostics.length).toBe(0);
                    }
                ),
                { numRuns: 100 }
            );
        });
    });

    /**
     * Property 4: Multiple Arguments
     *
     * For any declaration directive containing two or more space-separated tokens
     * after the directive keyword, the parser SHALL produce one declaration per name.
     *
     * **Validates: Requirements 2.2**
     */
    describe('Property 4: Multiple Arguments', () => {
        test('multiple arguments produce one declaration per name', () => {
            fc.assert(
                fc.property(
                    fc.record({
                        type: directive_type,
                        first_arg: stata_identifier,
                        second_arg: stata_identifier,
                        extra_args: fc.array(stata_identifier, { minLength: 0, maxLength: 3 }),
                    }),
                    ({ type, first_arg, second_arg, extra_args }) => {
                        const the_args = [first_arg, second_arg, ...extra_args];
                        const all_args = the_args.join(' ');
                        const content = `// @lsp-${type} ${all_args}\ngen x = 1`;

                        const result = parser.parse(content, 'file:///test.do');

                        // Should produce one declaration per name
                        expect(result.declaration_directives.length).toBe(the_args.length);
                        for (let i = 0; i < the_args.length; i++) {
                            expect(result.declaration_directives[i].type).toBe(type);
                            expect(result.declaration_directives[i].name).toBe(the_args[i]);
                        }

                        // No diagnostics
                        const declaration_diagnostics = result.diagnostics.filter(d =>
                            d.message.includes('Declaration directive')
                        );
                        expect(declaration_diagnostics.length).toBe(0);
                    }
                ),
                { numRuns: 100 }
            );
        });

        test('missing argument produces warning diagnostic', () => {
            fc.assert(
                fc.property(
                    fc.record({
                        type: directive_type,
                        trailing_spaces: fc.integer({ min: 0, max: 5 }),
                    }),
                    ({ type, trailing_spaces }) => {
                        const trailing = ' '.repeat(trailing_spaces);
                        const content = `// @lsp-${type}${trailing}\ngen x = 1`;

                        const result = parser.parse(content, 'file:///test.do');

                        // Should NOT produce a declaration
                        expect(result.declaration_directives.length).toBe(0);

                        // Should produce a warning diagnostic
                        const declaration_diagnostics = result.diagnostics.filter(d =>
                            d.message.includes('requires at least one argument')
                        );
                        expect(declaration_diagnostics.length).toBe(1);
                        expect(declaration_diagnostics[0].severity).toBe('warning');
                    }
                ),
                { numRuns: 100 }
            );
        });
    });

    // Additional edge case tests
    describe('Edge Cases', () => {
        test('directives can appear anywhere in file', () => {
            const content = `gen x = 1
local y = 2
// @lsp-local myvar
display \`myvar'
// @lsp-global config
display \$config`;

            const result = parser.parse(content, 'file:///test.do');

            expect(result.declaration_directives.length).toBe(2);
            expect(result.declaration_directives[0].name).toBe('myvar');
            expect(result.declaration_directives[0].type).toBe('local');
            expect(result.declaration_directives[1].name).toBe('config');
            expect(result.declaration_directives[1].type).toBe('global');
        });

        test('non-declaration directives are not confused', () => {
            const content = `// @lsp-done-by "../parent.do"
// @lsp-local myvar
gen x = 1`;

            const result = parser.parse(content, 'file:///test.do');

            // Should have one cross-file directive and one declaration directive
            expect(result.directives.length).toBe(1);
            expect(result.directives[0].type).toBe('done-by');
            expect(result.declaration_directives.length).toBe(1);
            expect(result.declaration_directives[0].type).toBe('local');
        });

        test('canonical # sight declaration directives parse like @lsp aliases', () => {
            const content = `// # sight: local myvar
* # sight: global config
// # sight: scalar: my_scalar`;

            const result = parser.parse(content, 'file:///test.do');

            expect(result.declaration_directives.map(d => [d.type, d.name])).toEqual([
                ['local', 'myvar'],
                ['global', 'config'],
                ['scalar', 'my_scalar'],
            ]);
        });
    });
});
