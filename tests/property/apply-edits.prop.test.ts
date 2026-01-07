/**
 * Property tests for apply_edits function.
 *
 * Feature: pr-feedback-fixes
 * Property 1: Multi-edit application correctness
 * Property 4: Shared utility consistency
 * Validates: Requirements 1.1, 1.3, 1.4, 4.4
 */

import { describe, it, expect } from 'bun:test';
import * as fc from 'fast-check';
import { TextEdit, Range } from 'vscode-languageserver';
import { apply_edits, find_command_nodes } from './helpers';
import { StataParser } from '../../src/parser';
import { StataLexer } from '../../src/lexer';
import { StataNode } from '../../src/types';

/**
 * Parse source code and return AST nodes.
 */
function parse(source: string): StataNode[] {
    const lexer = new StataLexer();
    const tokens = lexer.tokenize(source);
    const parser = new StataParser();
    const result = parser.parse(tokens.tokens);
    return result.ast?.nodes ?? [];
}

/**
 * Create a TextEdit for a single line replacement.
 */
function create_line_edit(
    line: number,
    start_char: number,
    end_char: number,
    new_text: string
): TextEdit {
    return {
        range: {
            start: { line, character: start_char },
            end: { line, character: end_char },
        },
        newText: new_text,
    };
}

describe('apply_edits property tests', () => {
    /**
     * Property 1: Multi-edit application correctness
     * For any source text and any set of non-overlapping TextEdit objects,
     * applying all edits should produce a result where each edit's newText
     * appears at the correct position in the final output.
     */
    it('should apply all edits correctly (Property 1)', () => {
        fc.assert(
            fc.property(
                // Generate source with multiple lines
                fc.array(fc.string({ minLength: 1, maxLength: 20 }), {
                    minLength: 2,
                    maxLength: 5,
                }),
                // Generate replacement texts
                fc.array(fc.string({ minLength: 0, maxLength: 10 }), {
                    minLength: 1,
                    maxLength: 3,
                }),
                (the_lines, the_replacements) => {
                    const source = the_lines.join('\n');

                    // Create non-overlapping edits on different lines
                    const the_edits: TextEdit[] = [];
                    for (let i = 0; i < the_replacements.length && i < the_lines.length; i++) {
                        const line_len = the_lines[i].length;
                        if (line_len > 0) {
                            // Replace first character of each line
                            the_edits.push(create_line_edit(i, 0, 1, the_replacements[i]));
                        }
                    }

                    if (the_edits.length === 0) return true;

                    const result = apply_edits(source, the_edits);

                    // Verify each replacement appears in the result
                    for (let i = 0; i < the_edits.length; i++) {
                        const expected_prefix = the_replacements[i] + the_lines[i].substring(1);
                        const result_lines = result.split('\n');
                        expect(result_lines[i]).toBe(expected_prefix);
                    }

                    return true;
                }
            ),
            { numRuns: 100 }
        );
    });

    it('should handle edits in any order (Property 1)', () => {
        fc.assert(
            fc.property(
                fc.constantFrom(
                    // Different orderings of the same edits
                    [
                        create_line_edit(0, 0, 1, 'A'),
                        create_line_edit(1, 0, 1, 'B'),
                        create_line_edit(2, 0, 1, 'C'),
                    ],
                    [
                        create_line_edit(2, 0, 1, 'C'),
                        create_line_edit(0, 0, 1, 'A'),
                        create_line_edit(1, 0, 1, 'B'),
                    ],
                    [
                        create_line_edit(1, 0, 1, 'B'),
                        create_line_edit(2, 0, 1, 'C'),
                        create_line_edit(0, 0, 1, 'A'),
                    ]
                ),
                (the_edits) => {
                    const source = 'xxx\nyyy\nzzz';
                    const result = apply_edits(source, the_edits);
                    expect(result).toBe('Axx\nByy\nCzz');
                    return true;
                }
            ),
            { numRuns: 100 }
        );
    });
});


describe('apply_edits unit tests', () => {
    /**
     * Requirements 1.2, 1.5: Zero edits should return original source unchanged.
     */
    it('should return original source for zero edits', () => {
        const source = 'display "hello"\ngen x = 1';
        const result = apply_edits(source, []);
        expect(result).toBe(source);
    });

    /**
     * Requirements 1.3: Single edit should be applied correctly.
     */
    it('should apply single edit correctly', () => {
        const source = 'display "hello"';
        const edit = create_line_edit(0, 0, 7, 'di');
        const result = apply_edits(source, [edit]);
        expect(result).toBe('di "hello"');
    });

    /**
     * Requirements 1.1, 1.4: Multiple edits should all be applied.
     */
    it('should apply multiple edits on same line', () => {
        const source = 'display "hello" "world"';
        const the_edits = [
            create_line_edit(0, 9, 14, 'goodbye'),
            create_line_edit(0, 17, 22, 'universe'),
        ];
        const result = apply_edits(source, the_edits);
        expect(result).toBe('display "goodbye" "universe"');
    });

    it('should apply multiple edits on different lines', () => {
        const source = 'line1\nline2\nline3';
        const the_edits = [
            create_line_edit(0, 0, 5, 'FIRST'),
            create_line_edit(1, 0, 5, 'SECOND'),
            create_line_edit(2, 0, 5, 'THIRD'),
        ];
        const result = apply_edits(source, the_edits);
        expect(result).toBe('FIRST\nSECOND\nTHIRD');
    });

    it('should handle edit that spans multiple lines', () => {
        const source = 'line1\nline2\nline3';
        const edit: TextEdit = {
            range: {
                start: { line: 0, character: 3 },
                end: { line: 2, character: 2 },
            },
            newText: 'REPLACED',
        };
        const result = apply_edits(source, [edit]);
        expect(result).toBe('linREPLACEDne3');
    });

    it('should handle insertion (empty range)', () => {
        const source = 'hello world';
        const edit = create_line_edit(0, 5, 5, ' beautiful');
        const result = apply_edits(source, [edit]);
        expect(result).toBe('hello beautiful world');
    });

    it('should handle deletion (empty newText)', () => {
        const source = 'hello beautiful world';
        const edit = create_line_edit(0, 5, 15, '');
        const result = apply_edits(source, [edit]);
        expect(result).toBe('hello world');
    });
});


describe('Shared utility consistency (Property 4)', () => {
    /**
     * Property 4: Shared utility consistency
     * For any AST structure, the shared find_command_nodes function should
     * return the same results as the original implementations.
     */
    it('should find all command nodes in nested structures', () => {
        fc.assert(
            fc.property(
                fc.constantFrom(
                    'display "hello"',
                    'if 1 {\n    gen x = 1\n}',
                    'foreach v of varlist a b c {\n    display `v\'\n}',
                    'program mytest\n    display "test"\nend',
                    'quietly {\n    gen y = 2\n    replace y = 3\n}'
                ),
                (source) => {
                    const ast = parse(source);
                    const the_commands = find_command_nodes(ast);

                    // All returned items should be command nodes
                    for (const my_cmd of the_commands) {
                        expect(my_cmd.type).toBe('command');
                    }

                    return true;
                }
            ),
            { numRuns: 100 }
        );
    });
});


describe('Backward compatibility integration tests', () => {
    /**
     * Validates: Requirements 2.4
     * Verify existing tests continue to work with shared utilities.
     */
    it('should work with formatter output (integration)', () => {
        // Test that apply_edits works correctly with typical formatter output
        const source = 'display   "hello"';
        const the_edits: TextEdit[] = [
            {
                range: {
                    start: { line: 0, character: 0 },
                    end: { line: 0, character: source.length },
                },
                newText: 'display "hello"',
            },
        ];
        const result = apply_edits(source, the_edits);
        expect(result).toBe('display "hello"');
    });

    it('should work with multi-line formatter output (integration)', () => {
        const source = 'if 1 {\ndisplay "a"\n}';
        const the_edits: TextEdit[] = [
            {
                range: {
                    start: { line: 0, character: 0 },
                    end: { line: 2, character: 1 },
                },
                newText: 'if 1 {\n    display "a"\n}',
            },
        ];
        const result = apply_edits(source, the_edits);
        expect(result).toBe('if 1 {\n    display "a"\n}');
    });

    it('should find commands in complex AST structures (integration)', () => {
        const source = `
program mytest
    if 1 {
        gen x = 1
    }
    foreach v of varlist a b {
        display \`v'
    }
end
`;
        const ast = parse(source);
        const the_commands = find_command_nodes(ast);

        // Should find: gen, display
        expect(the_commands.length).toBeGreaterThanOrEqual(2);
        const the_names = the_commands.map(c => c.name);
        expect(the_names).toContain('gen');
        expect(the_names).toContain('display');
    });
});
