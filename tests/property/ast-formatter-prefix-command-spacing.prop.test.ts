/**
 * Property Tests: AST Formatter Prefix Command Spacing
 *
 * Tests for the AST formatter's handling of prefix commands with colons,
 * ensuring proper spacing and preservation of syntax.
 *
 * Feature: ast-formatter-prefix-command-spacing
 */

import { describe, it, expect, beforeEach } from 'bun:test';
import * as fc from 'fast-check';
import { StataParser } from '../../src/parser';
import { StataLexer } from '../../src/lexer';
import { PrettyPrinter } from '../../src/pretty-printer';
import {
    for_each_formatter_mode_property,
    create_formatter_config,
    FormatterMode,
} from './helpers/formatter-test-utils';
import { format_document } from '../../src/providers/formatter';

describe('AST Formatter Prefix Command Spacing Property Tests', () => {
    let my_parser: StataParser;
    let my_lexer: StataLexer;
    let my_printer: PrettyPrinter;

    beforeEach(() => {
        my_parser = new StataParser();
        my_lexer = new StataLexer();
        my_printer = new PrettyPrinter();
    });

    function parseAndFormat(source: string): string {
        const lex_result = my_lexer.tokenize(source);
        const parse_result = my_parser.parse(lex_result.tokens);
        return my_printer.print(parse_result.ast);
    }

    /**
     * Property 1: Prefix Colon Spacing
     * For any command with a prefix command and colon, formatting should produce
     * a space (not newline) after the colon, keeping the prefix and main command
     * on the same line.
     *
     * Feature: ast-formatter-prefix-command-spacing, Property 1: Prefix Colon Spacing
     * Validates: Requirements 1.1, 1.2, 1.3
     */
    describe('Property 1: Prefix Colon Spacing', () => {
        it('should produce space (not newline) after prefix colon', () => {
            const prefix_gen = fc.constantFrom('quietly', 'capture', 'noisily', 'qui', 'cap', 'noi');
            const command_gen = fc.constantFrom('display', 'summarize', 'regress', 'generate', 'list');
            const arg_gen = fc.constantFrom('"hello"', 'var1', 'x y', '');

            fc.assert(
                fc.property(prefix_gen, command_gen, arg_gen, (prefix, command, arg) => {
                    const source = `${prefix}: ${command}${arg ? ' ' + arg : ''}`;
                    const output = parseAndFormat(source);

                    // Output should be on a single line (no newlines except at end)
                    const lines = output.trim().split('\n');
                    if (lines.length !== 1) {
                        return false;
                    }

                    // Output should contain the colon followed by space
                    if (!output.includes(': ')) {
                        return false;
                    }

                    return true;
                }),
                { numRuns: 100 }
            );
        });

        it('should format capture frame this: that with space after colon', () => {
            const output = parseAndFormat('capture frame this: that');
            expect(output.trim()).toBe('capture frame this: that');
        });

        it('should format frame bh: unab raw_vars_bh _all with space after colon', () => {
            const output = parseAndFormat('frame bh: unab raw_vars_bh _all');
            // The frame prefix colon is preserved, but unab's colon qualifier is Task 3
            expect(output).toContain('frame bh:');
            expect(output.trim().split('\n').length).toBe(1); // Single line
        });

        it('should format quietly: display "hello" with space after colon', () => {
            const output = parseAndFormat('quietly: display "hello"');
            expect(output.trim()).toBe('quietly: display "hello"');
        });
    });

    /**
     * Property 2: Colon Preservation
     * For any command with a colon qualifier (e.g., unab varname: _all),
     * formatting should preserve the colon in the output with a space after it.
     *
     * Feature: ast-formatter-prefix-command-spacing, Property 2: Colon Preservation
     * Validates: Requirements 2.1, 2.2, 2.3
     */
    describe('Property 2: Colon Preservation', () => {
        it('should preserve colon in unab command', () => {
            const macro_name_gen = fc.stringOf(fc.constantFrom('a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'), { minLength: 1, maxLength: 8 });
            const varlist_gen = fc.constantFrom('_all', 'var*', 'x y z', 'myvar');

            fc.assert(
                fc.property(macro_name_gen, varlist_gen, (macro_name, varlist) => {
                    const source = `unab ${macro_name}: ${varlist}`;
                    const output = parseAndFormat(source);

                    // Output should contain the colon
                    if (!output.includes(':')) {
                        return false;
                    }

                    // Output should have space after colon
                    if (!output.includes(': ')) {
                        return false;
                    }

                    return true;
                }),
                { numRuns: 100 }
            );
        });

        it('should format unab merp: _all with colon preserved', () => {
            const output = parseAndFormat('unab merp: _all');
            expect(output.trim()).toBe('unab merp: _all');
        });

        it('should format unab vars: var1 var2 with colon preserved', () => {
            const output = parseAndFormat('unab vars: var1 var2');
            expect(output.trim()).toBe('unab vars: var1 var2');
        });
    });

    /**
     * Property 5: Frame Prefix Spacing
     * For any frame prefix command, formatting should add spaces between frame,
     * the frame name, and after the colon.
     *
     * Feature: ast-formatter-prefix-command-spacing, Property 5: Frame Prefix Spacing
     * Validates: Requirements 5.1, 5.2, 5.3
     */
    describe('Property 5: Frame Prefix Spacing', () => {
        it('should add spaces between frame, frame name, and after colon', () => {
            const frame_name_gen = fc.stringOf(fc.constantFrom('a', 'b', 'c', 'd', 'e', 'f'), { minLength: 1, maxLength: 8 });
            const command_gen = fc.constantFrom('display', 'summarize', 'list', 'describe');

            fc.assert(
                fc.property(frame_name_gen, command_gen, (frame_name, command) => {
                    const source = `frame ${frame_name}: ${command}`;
                    const output = parseAndFormat(source);

                    // Should have space after 'frame'
                    if (!output.includes('frame ')) {
                        return false;
                    }

                    // Should have colon followed by space
                    if (!output.includes(': ')) {
                        return false;
                    }

                    // Should be on single line
                    const lines = output.trim().split('\n');
                    return lines.length === 1;
                }),
                { numRuns: 100 }
            );
        });

        it('should format capture frame this: that correctly', () => {
            const output = parseAndFormat('capture frame this: that');
            expect(output.trim()).toBe('capture frame this: that');
            expect(output).toContain('capture ');
            expect(output).toContain('frame ');
            expect(output).toContain(': ');
        });
    });

    /**
     * Property 7: Prefix Command Chain Spacing
     * For any command with multiple prefix commands, formatting should add spaces
     * between each prefix command and maintain all components on a single line.
     *
     * Feature: ast-formatter-prefix-command-spacing, Property 7: Prefix Chain Spacing
     * Validates: Requirements 7.1, 7.2, 7.3
     */
    describe('Property 7: Prefix Command Chain Spacing', () => {
        it('should add spaces between multiple prefix commands', () => {
            const prefix1_gen = fc.constantFrom('quietly', 'capture', 'noisily');
            const prefix2_gen = fc.constantFrom('quietly', 'capture', 'noisily');
            const command_gen = fc.constantFrom('display', 'summarize', 'list');

            fc.assert(
                fc.property(prefix1_gen, prefix2_gen, command_gen, (prefix1, prefix2, command) => {
                    // Skip if same prefix (not typical usage)
                    if (prefix1 === prefix2) return true;

                    const source = `${prefix1} ${prefix2}: ${command}`;
                    const output = parseAndFormat(source);

                    // Should be on single line
                    const lines = output.trim().split('\n');
                    if (lines.length !== 1) {
                        return false;
                    }

                    // Should have spaces between prefixes
                    if (!output.includes(`${prefix1} `)) {
                        return false;
                    }

                    return true;
                }),
                { numRuns: 100 }
            );
        });

        it('should format capture quietly: display correctly', () => {
            const output = parseAndFormat('capture quietly: display "test"');
            expect(output.trim()).toBe('capture quietly: display "test"');
        });
    });
});

describe('AST Formatter Prefix Command Spacing Unit Tests', () => {
    let my_parser: StataParser;
    let my_lexer: StataLexer;
    let my_printer: PrettyPrinter;

    beforeEach(() => {
        my_parser = new StataParser();
        my_lexer = new StataLexer();
        my_printer = new PrettyPrinter();
    });

    function parseAndFormat(source: string): string {
        const lex_result = my_lexer.tokenize(source);
        const parse_result = my_parser.parse(lex_result.tokens);
        return my_printer.print(parse_result.ast);
    }

    describe('Task 2.3: Unit tests for prefix colon examples', () => {
        it('should format capture frame this: that with space after colon', () => {
            const output = parseAndFormat('capture frame this: that');
            expect(output.trim()).toBe('capture frame this: that');
        });

        it('should format frame bh: unab raw_vars_bh _all with space after colon', () => {
            const output = parseAndFormat('frame bh: unab raw_vars_bh _all');
            // The frame prefix colon is preserved, but unab's colon qualifier is Task 3
            expect(output).toContain('frame bh:');
            expect(output.trim().split('\n').length).toBe(1); // Single line
        });

        it('should format multiple prefix commands with colons', () => {
            const output = parseAndFormat('capture quietly: display "hello"');
            expect(output.trim()).toBe('capture quietly: display "hello"');
        });

        it('should format quietly: display "hello" correctly', () => {
            const output = parseAndFormat('quietly: display "hello"');
            expect(output.trim()).toBe('quietly: display "hello"');
        });

        it('should format noisily: summarize var1 correctly', () => {
            const output = parseAndFormat('noisily: summarize var1');
            expect(output.trim()).toBe('noisily: summarize var1');
        });

        it('should format by varlist: command correctly', () => {
            const output = parseAndFormat('by: summarize var1');
            expect(output.trim()).toBe('by: summarize var1');
        });
    });

    describe('Task 3.3: Unit tests for colon qualifier examples', () => {
        it('should format unab merp: _all with colon preserved', () => {
            const output = parseAndFormat('unab merp: _all');
            expect(output.trim()).toBe('unab merp: _all');
        });

        it('should format unab vars: var1 var2 with colon preserved', () => {
            const output = parseAndFormat('unab vars: var1 var2');
            expect(output.trim()).toBe('unab vars: var1 var2');
        });

        it('should format frame bh: unab raw_vars_bh: _all with both colons preserved', () => {
            const output = parseAndFormat('frame bh: unab raw_vars_bh: _all');
            expect(output.trim()).toBe('frame bh: unab raw_vars_bh: _all');
        });
    });

    /**
     * Property 3: Varlist Preservation
     * For any command with a varlist, formatting should include all varlist items
     * in the output with spaces between them.
     *
     * Feature: ast-formatter-prefix-command-spacing, Property 3: Varlist Preservation
     * Validates: Requirements 3.1, 3.2, 4.1, 4.2, 4.3
     */
    describe('Property 3: Varlist Preservation', () => {
        it('should preserve wildcard varlist items', () => {
            const command_gen = fc.constantFrom('rename', 'drop', 'keep', 'describe', 'summarize');
            const wildcard_gen = fc.constantFrom('*', 'var*', '_*', 'x?');

            fc.assert(
                fc.property(command_gen, wildcard_gen, (command, wildcard) => {
                    const source = `${command} ${wildcard}`;
                    const output = parseAndFormat(source);

                    // Output should contain the wildcard
                    if (!output.includes(wildcard)) {
                        return false;
                    }

                    // Should be on single line
                    const lines = output.trim().split('\n');
                    return lines.length === 1;
                }),
                { numRuns: 100 }
            );
        });

        it('should preserve multiple varlist items with spaces', () => {
            const output = parseAndFormat('summarize var1 var2 var3');
            expect(output.trim()).toBe('summarize var1 var2 var3');
        });

        it('should format rename *, lower with varlist preserved', () => {
            const output = parseAndFormat('rename *, lower');
            expect(output.trim()).toBe('rename *, lower');
        });
    });

    /**
     * Property 4: Option Comma Spacing
     * For any command with options, formatting should emit `, ` (comma followed
     * by space, not newline) before the options.
     *
     * Feature: ast-formatter-prefix-command-spacing, Property 4: Option Comma Spacing
     * Validates: Requirements 3.3
     */
    describe('Property 4: Option Comma Spacing', () => {
        it('should emit comma space before options', () => {
            const command_gen = fc.constantFrom('summarize', 'regress', 'describe', 'list');
            const varlist_gen = fc.constantFrom('var1', 'x y', '*');
            const option_gen = fc.constantFrom('detail', 'nolabel', 'format');

            fc.assert(
                fc.property(command_gen, varlist_gen, option_gen, (command, varlist, option) => {
                    const source = `${command} ${varlist}, ${option}`;
                    const output = parseAndFormat(source);

                    // Output should contain comma followed by space
                    if (!output.includes(', ')) {
                        return false;
                    }

                    // Should be on single line
                    const lines = output.trim().split('\n');
                    return lines.length === 1;
                }),
                { numRuns: 100 }
            );
        });

        it('should format command with only options (no varlist)', () => {
            const output = parseAndFormat('summarize, detail');
            expect(output.trim()).toBe('summarize, detail');
        });
    });

    describe('Task 4.5: Unit tests for varlist and option examples', () => {
        it('should format rename *, lower with varlist and comma spacing', () => {
            const output = parseAndFormat('rename *, lower');
            expect(output.trim()).toBe('rename *, lower');
        });

        it('should format commands with multiple varlist items', () => {
            const output = parseAndFormat('summarize var1 var2 var3, detail');
            expect(output.trim()).toBe('summarize var1 var2 var3, detail');
        });

        it('should format commands with only options (no varlist)', () => {
            const output = parseAndFormat('summarize, detail');
            expect(output.trim()).toBe('summarize, detail');
        });

        it('should format commands with wildcard patterns', () => {
            const output = parseAndFormat('describe var*');
            expect(output.trim()).toBe('describe var*');
        });

        it('should format commands with question mark wildcard', () => {
            const output = parseAndFormat('drop x?');
            expect(output.trim()).toBe('drop x?');
        });
    });

    /**
     * Property 6: Statement Terminator Placement
     * For any complete command, formatting should only add a statement terminator
     * (newline or semicolon) at the end of the complete command, not within the
     * command structure.
     *
     * Feature: ast-formatter-prefix-command-spacing, Property 6: Statement Terminator Placement
     * Validates: Requirements 6.1, 6.2, 6.3
     */
    describe('Property 6: Statement Terminator Placement', () => {
        it('should not add terminator after prefix colon', () => {
            const prefix_gen = fc.constantFrom('quietly', 'capture', 'noisily');
            const command_gen = fc.constantFrom('display', 'summarize', 'list');

            fc.assert(
                fc.property(prefix_gen, command_gen, (prefix, command) => {
                    const source = `${prefix}: ${command}`;
                    const output = parseAndFormat(source);

                    // Should be on single line (only one newline at end)
                    const lines = output.split('\n').filter(l => l.length > 0);
                    return lines.length === 1;
                }),
                { numRuns: 100 }
            );
        });

        it('should not add terminator after comma before options', () => {
            const command_gen = fc.constantFrom('summarize', 'describe', 'list');
            const option_gen = fc.constantFrom('detail', 'nolabel', 'format');

            fc.assert(
                fc.property(command_gen, option_gen, (command, option) => {
                    const source = `${command}, ${option}`;
                    const output = parseAndFormat(source);

                    // Should be on single line
                    const lines = output.split('\n').filter(l => l.length > 0);
                    return lines.length === 1;
                }),
                { numRuns: 100 }
            );
        });

        it('should add terminator only at end of complete command', () => {
            const output = parseAndFormat('capture frame test: display "hello"');
            // Should end with exactly one newline
            expect(output.endsWith('\n')).toBe(true);
            expect(output.trim().split('\n').length).toBe(1);
        });
    });

    /**
     * Property 8: Round-Trip Consistency
     * For any valid Stata command with prefix commands, colons, varlists, or options,
     * formatting then parsing should produce an AST equivalent to the original.
     *
     * Feature: ast-formatter-prefix-command-spacing, Property 8: Round-Trip Consistency
     * Validates: Requirements 8.1, 8.2, 8.3
     */
    describe('Property 8: Round-Trip Consistency', () => {
        it('should produce parseable output for prefix commands', () => {
            const prefix_gen = fc.constantFrom('quietly', 'capture', 'noisily');
            const command_gen = fc.constantFrom('display', 'summarize', 'list');

            fc.assert(
                fc.property(prefix_gen, command_gen, (prefix, command) => {
                    const source = `${prefix}: ${command}`;
                    const output = parseAndFormat(source);

                    // Parse the output
                    const lex_result = my_lexer.tokenize(output);
                    const parse_result = my_parser.parse(lex_result.tokens);

                    // Should parse without errors
                    return parse_result.errors.length === 0 && parse_result.ast.nodes.length > 0;
                }),
                { numRuns: 100 }
            );
        });

        it('should preserve command structure through round-trip', () => {
            const output1 = parseAndFormat('capture frame test: display "hello"');
            const output2 = parseAndFormat(output1.trim());
            expect(output1.trim()).toBe(output2.trim());
        });
    });

    /**
     * Property 9: Edge Case Handling
     * For any command with empty varlists, no arguments, or only options,
     * formatting should handle them without adding spurious spaces or newlines.
     *
     * Feature: ast-formatter-prefix-command-spacing, Property 9: Edge Case Handling
     * Validates: Requirements 9.1, 9.2, 9.3
     */
    describe('Property 9: Edge Case Handling', () => {
        it('should handle commands with no arguments', () => {
            const command_gen = fc.constantFrom('clear', 'exit', 'end');

            fc.assert(
                fc.property(command_gen, (command) => {
                    const source = command;
                    const output = parseAndFormat(source);

                    // Should not have trailing spaces before newline
                    const trimmed = output.trimEnd();
                    return trimmed === command;
                }),
                { numRuns: 100 }
            );
        });

        it('should handle commands with only options', () => {
            const output = parseAndFormat('summarize, detail');
            expect(output.trim()).toBe('summarize, detail');
        });
    });

    /**
     * Property 10: Command Structure Recognition
     * For any CommandNode with prefix, varlist, or options fields, formatting
     * should correctly identify and process each component according to its
     * semantic role.
     *
     * Feature: ast-formatter-prefix-command-spacing, Property 10: Command Structure Recognition
     * Validates: Requirements 10.1, 10.2, 10.3
     */
    describe('Property 10: Command Structure Recognition', () => {
        it('should recognize prefix field in CommandNode', () => {
            const output = parseAndFormat('quietly: display "test"');
            expect(output).toContain('quietly:');
        });

        it('should recognize colon in prefix commands', () => {
            const output = parseAndFormat('capture: display "test"');
            expect(output).toContain('capture:');
        });

        it('should recognize options after comma', () => {
            const output = parseAndFormat('summarize var1, detail');
            expect(output).toContain(', detail');
        });
    });

    /**
     * Property 11: Wildcard Pattern Preservation
     * For any varlist item containing wildcard characters (* or ?), formatting
     * should preserve the pattern without inserting spaces between the variable
     * name and the wildcard character.
     *
     * Feature: ast-formatter-prefix-command-spacing, Property 11: Wildcard Pattern Preservation
     * Validates: Requirements 11.1, 11.2, 11.3
     */
    describe('Property 11: Wildcard Pattern Preservation', () => {
        it('should not insert space within wildcard patterns', () => {
            // Use prefixes that won't be parsed as Stata keywords (if, in, etc.)
            const var_prefix_gen = fc.stringOf(fc.constantFrom('a', 'b', 'c', 'x', 'y', 'z'), { minLength: 3, maxLength: 5 })
                .filter(s => !['if', 'in', 'by'].includes(s));
            const wildcard_gen = fc.constantFrom('*', '?');

            fc.assert(
                fc.property(var_prefix_gen, wildcard_gen, (var_prefix, wildcard) => {
                    const pattern = `${var_prefix}${wildcard}`;
                    const source = `describe ${pattern}`;
                    const output = parseAndFormat(source);

                    // Pattern should be preserved without internal space
                    return output.includes(pattern);
                }),
                { numRuns: 100 }
            );
        });

        it('should add space between separate varlist items', () => {
            const output = parseAndFormat('describe var* other');
            expect(output.trim()).toBe('describe var* other');
        });

        it('should preserve multiple wildcard patterns', () => {
            const output = parseAndFormat('rename old* new*');
            expect(output.trim()).toBe('rename old* new*');
        });
    });
});
