/**
 * Property tests for Working Directory Directive
 *
 * Tests Properties 1-4, 11 from the design document.
 * Feature: working-directory-directive
 */

import { describe, test, expect } from 'bun:test';
import * as fc from 'fast-check';
import { DirectiveParser } from '../../src/directive-parser';

describe('Working Directory Directive Property Tests', () => {
    const parser = new DirectiveParser();

    // Generator for valid path strings
    const path_gen = fc.stringOf(
        fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz0123456789_-./'.split('')),
        { minLength: 1, maxLength: 30 }
    ).filter(s => !s.includes('"') && s.length > 0 && !s.includes(' '));

    // All directive synonyms
    const the_synonyms = [
        'working-directory',
        'working-dir',
        'current-directory',
        'current-dir',
        'cd',
        'wd',
    ];

    /**
     * Property 1: Directive Parsing Accepts All Synonym Forms
     * *For any* valid path string and any directive synonym, the DirectiveParser
     * should correctly extract the path from both quoted and unquoted forms,
     * producing equivalent results.
     * **Validates: Requirements 1.1, 1.2**
     */
    describe('Property 1: Directive Parsing Accepts All Synonym Forms', () => {
        test('all synonym forms produce equivalent results with quoted paths', () => {
            fc.assert(
                fc.property(
                    path_gen,
                    fc.constantFrom(...the_synonyms),
                    (my_path, my_synonym) => {
                        const content = `// @lsp-${my_synonym}: "${my_path}"\ngen x = 1`;
                        const result = parser.parse(content, 'file:///test/script.do');

                        expect(result.working_directory).toBeDefined();
                        expect(result.working_directory!.path).toBe(my_path);
                        expect(result.working_directory!.directive_form).toBe(my_synonym);
                    }
                ),
                { numRuns: 100 }
            );
        });

        test('all synonym forms produce equivalent results with unquoted paths', () => {
            fc.assert(
                fc.property(
                    path_gen,
                    fc.constantFrom(...the_synonyms),
                    (my_path, my_synonym) => {
                        const content = `// @lsp-${my_synonym} ${my_path}\ngen x = 1`;
                        const result = parser.parse(content, 'file:///test/script.do');

                        expect(result.working_directory).toBeDefined();
                        expect(result.working_directory!.path).toBe(my_path);
                    }
                ),
                { numRuns: 100 }
            );
        });

        test('quoted and unquoted forms produce same path', () => {
            fc.assert(
                fc.property(
                    path_gen,
                    fc.constantFrom(...the_synonyms),
                    (my_path, my_synonym) => {
                        const quoted_content = `// @lsp-${my_synonym}: "${my_path}"\ngen x = 1`;
                        const unquoted_content = `// @lsp-${my_synonym} ${my_path}\ngen x = 1`;

                        const quoted_result = parser.parse(quoted_content, 'file:///test/script.do');
                        const unquoted_result = parser.parse(unquoted_content, 'file:///test/script.do');

                        expect(quoted_result.working_directory!.path).toBe(
                            unquoted_result.working_directory!.path
                        );
                    }
                ),
                { numRuns: 100 }
            );
        });

        test('works with both * and // comment styles', () => {
            fc.assert(
                fc.property(
                    path_gen,
                    fc.constantFrom(...the_synonyms),
                    (my_path, my_synonym) => {
                        const star_content = `* @lsp-${my_synonym}: "${my_path}"\ngen x = 1`;
                        const slash_content = `// @lsp-${my_synonym}: "${my_path}"\ngen x = 1`;

                        const star_result = parser.parse(star_content, 'file:///test/script.do');
                        const slash_result = parser.parse(slash_content, 'file:///test/script.do');

                        expect(star_result.working_directory).toBeDefined();
                        expect(slash_result.working_directory).toBeDefined();
                        expect(star_result.working_directory!.path).toBe(
                            slash_result.working_directory!.path
                        );
                    }
                ),
                { numRuns: 100 }
            );
        });
    });

    /**
     * Property 2: Header-Only Constraint
     * *For any* file content where a working directory directive appears after
     * non-comment, non-blank code, the DirectiveParser should return undefined
     * for working_directory (directive is ignored).
     * **Validates: Requirements 1.3**
     */
    describe('Property 2: Header-Only Constraint', () => {
        test('directives after code are ignored', () => {
            fc.assert(
                fc.property(
                    path_gen,
                    fc.constantFrom(...the_synonyms),
                    fc.constantFrom(
                        'gen x = 1',
                        'local y = 2',
                        'regress y x',
                        'display "hello"'
                    ),
                    (my_path, my_synonym, my_code) => {
                        const content = `${my_code}\n// @lsp-${my_synonym}: "${my_path}"`;
                        const result = parser.parse(content, 'file:///test/script.do');

                        // Directive after code should be ignored
                        expect(result.working_directory).toBeUndefined();
                    }
                ),
                { numRuns: 100 }
            );
        });

        test('directives before code are recognized', () => {
            fc.assert(
                fc.property(
                    path_gen,
                    fc.constantFrom(...the_synonyms),
                    fc.integer({ min: 0, max: 5 }),
                    fc.integer({ min: 0, max: 3 }),
                    (my_path, my_synonym, num_blank_lines, num_comment_lines) => {
                        const blank_lines = '\n'.repeat(num_blank_lines);
                        const comment_lines = '// comment\n'.repeat(num_comment_lines);
                        const directive = `// @lsp-${my_synonym}: "${my_path}"`;
                        const content = blank_lines + comment_lines + directive + '\ngen x = 1';
                        const result = parser.parse(content, 'file:///test/script.do');

                        expect(result.working_directory).toBeDefined();
                        expect(result.working_directory!.path).toBe(my_path);
                    }
                ),
                { numRuns: 100 }
            );
        });
    });

    /**
     * Property 3: Multiple Directive Warning
     * *For any* file header containing multiple working directory directives
     * (even if using different synonyms), the DirectiveParser should use the
     * last directive's path and emit exactly one warning diagnostic.
     * **Validates: Requirements 1.4**
     */
    describe('Property 3: Multiple Directive Warning', () => {
        test('last directive wins and warning is emitted', () => {
            fc.assert(
                fc.property(
                    path_gen,
                    path_gen,
                    fc.constantFrom(...the_synonyms),
                    fc.constantFrom(...the_synonyms),
                    (first_path, second_path, first_synonym, second_synonym) => {
                        // Ensure paths are different for meaningful test
                        const actual_second_path = first_path === second_path
                            ? second_path + '_different'
                            : second_path;

                        const content = `// @lsp-${first_synonym}: "${first_path}"\n` +
                            `// @lsp-${second_synonym}: "${actual_second_path}"\n` +
                            'gen x = 1';
                        const result = parser.parse(content, 'file:///test/script.do');

                        // Last directive should win
                        expect(result.working_directory).toBeDefined();
                        expect(result.working_directory!.path).toBe(actual_second_path);

                        // Should have exactly one warning about multiple directives
                        const wd_warnings = result.diagnostics.filter(d =>
                            d.message.includes('Multiple working directory directives')
                        );
                        expect(wd_warnings.length).toBe(1);
                        expect(wd_warnings[0].severity).toBe('warning');
                    }
                ),
                { numRuns: 100 }
            );
        });

        test('single directive produces no warning', () => {
            fc.assert(
                fc.property(
                    path_gen,
                    fc.constantFrom(...the_synonyms),
                    (my_path, my_synonym) => {
                        const content = `// @lsp-${my_synonym}: "${my_path}"\ngen x = 1`;
                        const result = parser.parse(content, 'file:///test/script.do');

                        // Should have no warning about multiple directives
                        const wd_warnings = result.diagnostics.filter(d =>
                            d.message.includes('Multiple working directory directives')
                        );
                        expect(wd_warnings.length).toBe(0);
                    }
                ),
                { numRuns: 100 }
            );
        });
    });

    /**
     * Property 4: Workspace-Relative Flag
     * *For any* working directory directive, the is_workspace_relative flag
     * should be true if and only if the path starts with /.
     * **Validates: Requirements 1.5**
     */
    describe('Property 4: Workspace-Relative Flag', () => {
        test('paths starting with / have is_workspace_relative = true', () => {
            fc.assert(
                fc.property(
                    path_gen.filter(p => !p.startsWith('/')),
                    fc.constantFrom(...the_synonyms),
                    (my_path, my_synonym) => {
                        const workspace_path = '/' + my_path;
                        const content = `// @lsp-${my_synonym}: "${workspace_path}"\ngen x = 1`;
                        const result = parser.parse(content, 'file:///test/script.do');

                        expect(result.working_directory).toBeDefined();
                        expect(result.working_directory!.is_workspace_relative).toBe(true);
                        // The resolved_path should have the leading / stripped
                        expect(result.working_directory!.resolved_path).toBe(my_path);
                    }
                ),
                { numRuns: 100 }
            );
        });

        test('paths not starting with / have is_workspace_relative = false', () => {
            fc.assert(
                fc.property(
                    path_gen.filter(p => !p.startsWith('/')),
                    fc.constantFrom(...the_synonyms),
                    (my_path, my_synonym) => {
                        const content = `// @lsp-${my_synonym}: "${my_path}"\ngen x = 1`;
                        const result = parser.parse(content, 'file:///test/script.do');

                        expect(result.working_directory).toBeDefined();
                        expect(result.working_directory!.is_workspace_relative).toBe(false);
                    }
                ),
                { numRuns: 100 }
            );
        });
    });

    /**
     * Property 11: Round-Trip Parsing
     * *For any* valid working directory directive, parsing then printing should
     * produce an equivalent directive (the path should be preserved).
     * **Validates: Requirements 5.1**
     */
    describe('Property 11: Round-Trip Parsing', () => {
        test('path is preserved through parsing', () => {
            fc.assert(
                fc.property(
                    path_gen,
                    fc.constantFrom(...the_synonyms),
                    (my_path, my_synonym) => {
                        const content = `// @lsp-${my_synonym}: "${my_path}"\ngen x = 1`;
                        const result = parser.parse(content, 'file:///test/script.do');

                        expect(result.working_directory).toBeDefined();
                        expect(result.working_directory!.path).toBe(my_path);
                    }
                ),
                { numRuns: 100 }
            );
        });
    });
});
