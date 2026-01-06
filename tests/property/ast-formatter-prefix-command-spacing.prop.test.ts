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
});
